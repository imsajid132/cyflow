-- =============================================================================
-- Migration 007 — Auto content planner + approval workflow (Phase 4.7)
-- -----------------------------------------------------------------------------
-- Adds three tables:
--   * `planner_preferences`  — one row per user (UNIQUE user_id): cadence,
--     posting times, platforms, goals, content mix, tone, CTA/approval mode,
--     and the autopilot flags the future scheduler will read.
--   * `planner_runs`         — one generated plan (a batch of planned posts).
--   * `planner_run_items`    — one planned post inside a run, optionally linked
--     to a real `scheduled_posts` row once it is materialised.
--
-- Safe for the existing production database: additive only. It CREATEs new
-- tables (IF NOT EXISTS) and touches no existing user, integration, OAuth, post,
-- media, business-profile, or deletion-request data. No destructive reset.
--
-- Notes:
--  * Deleting a planner item never deletes the queued post it produced: the FK
--    to `scheduled_posts` is ON DELETE SET NULL. Approved work outlives its plan.
--  * Deleting the post DOES leave the item as a historical record with post_id
--    NULL, which is what the history view expects.
--  * `content_fingerprint_json` holds only small derived similarity signals
--    (normalized token sets / hashes) used by contentUniquenessService — never
--    raw captions, secrets, or personal data.
--  * `autopilot_enabled` exists so the scheduler can be wired up later. Nothing
--    in this phase publishes to any provider; generation stays user-triggered.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- --- per-user planner preferences -------------------------------------------
CREATE TABLE IF NOT EXISTS `planner_preferences` (
  `id`                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`                 BIGINT UNSIGNED NOT NULL,
  `cadence`                 VARCHAR(32)     NOT NULL DEFAULT 'every_day',
  `weekdays_json`           JSON            NULL DEFAULT NULL,
  `times_json`              JSON            NULL DEFAULT NULL,
  `platforms_json`          JSON            NULL DEFAULT NULL,
  `goals_json`              JSON            NULL DEFAULT NULL,
  `content_mix_json`        JSON            NULL DEFAULT NULL,
  `tone`                    VARCHAR(32)     NOT NULL DEFAULT 'professional',
  `cta_mode`                VARCHAR(32)     NOT NULL DEFAULT 'some',
  `approval_mode`           VARCHAR(32)     NOT NULL DEFAULT 'require_approval',
  `default_plan_length`     INT UNSIGNED    NOT NULL DEFAULT 7,
  `timezone`                VARCHAR(64)     NULL DEFAULT NULL,
  -- Autopilot is PREPARED here, not active: no scheduler job reads these yet.
  `autopilot_enabled`       TINYINT(1)      NOT NULL DEFAULT 0,
  `next_plan_generation_at` DATETIME        NULL DEFAULT NULL,
  `created_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_planner_preferences_user` (`user_id`),
  -- the future autopilot sweep: enabled rows that are due
  KEY `idx_planner_preferences_autopilot` (`autopilot_enabled`, `next_plan_generation_at`),
  CONSTRAINT `fk_planner_preferences_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- one generated plan ------------------------------------------------------
CREATE TABLE IF NOT EXISTS `planner_runs` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT UNSIGNED NOT NULL,
  `business_profile_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `name`                VARCHAR(160)    NULL DEFAULT NULL,
  `status`              ENUM('generating','review','partially_queued','queued','archived','failed')
                                        NOT NULL DEFAULT 'generating',
  `start_date`          DATE            NULL DEFAULT NULL,
  `end_date`            DATE            NULL DEFAULT NULL,
  `timezone`            VARCHAR(64)     NULL DEFAULT NULL,
  `plan_length`         INT UNSIGNED    NOT NULL DEFAULT 7,
  `settings_json`       JSON            NULL DEFAULT NULL,
  `generation_notes`    VARCHAR(2000)   NULL DEFAULT NULL,
  `created_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- history list: a user's runs, newest first
  KEY `idx_planner_runs_user_created` (`user_id`, `created_at`),
  KEY `idx_planner_runs_user_status` (`user_id`, `status`),
  CONSTRAINT `fk_planner_runs_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_planner_runs_business_profile`
    FOREIGN KEY (`business_profile_id`) REFERENCES `business_profiles` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- one planned post inside a run -------------------------------------------
CREATE TABLE IF NOT EXISTS `planner_run_items` (
  `id`                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `planner_run_id`          BIGINT UNSIGNED NOT NULL,
  `user_id`                 BIGINT UNSIGNED NOT NULL,
  -- Set once the item is materialised into the real queue. ON DELETE SET NULL:
  -- removing a planner item must never remove an approved, queued post.
  `post_id`                 BIGINT UNSIGNED NULL DEFAULT NULL,
  `position`                INT UNSIGNED    NOT NULL DEFAULT 0,
  `scheduled_for`           DATETIME        NULL DEFAULT NULL,
  `original_timezone`       VARCHAR(64)     NULL DEFAULT NULL,
  `content_type`            VARCHAR(32)     NOT NULL DEFAULT 'educational',
  `goal`                    VARCHAR(32)     NULL DEFAULT NULL,
  `platform_targets_json`   JSON            NULL DEFAULT NULL,
  `template_key`            VARCHAR(128)    NULL DEFAULT NULL,
  `aspect_ratio`            VARCHAR(32)     NULL DEFAULT NULL,
  `background_style`        VARCHAR(64)     NULL DEFAULT NULL,
  `generated_headline`      VARCHAR(255)    NULL DEFAULT NULL,
  `generated_subheadline`   VARCHAR(255)    NULL DEFAULT NULL,
  `generated_summary`       VARCHAR(500)    NULL DEFAULT NULL,
  `generated_caption`       TEXT            NULL DEFAULT NULL,
  `generated_hashtags_json` JSON            NULL DEFAULT NULL,
  `generated_alt_text`      VARCHAR(500)    NULL DEFAULT NULL,
  `brief`                   VARCHAR(2000)   NULL DEFAULT NULL,
  `media_asset_id`          BIGINT UNSIGNED NULL DEFAULT NULL,
  `approval_status`         ENUM('draft','needs_review','approved','queued','rejected')
                                            NOT NULL DEFAULT 'needs_review',
  `duplication_score`       DECIMAL(4,3)    NOT NULL DEFAULT 0.000,
  `duplication_notes`       VARCHAR(500)    NULL DEFAULT NULL,
  `regeneration_count`      INT UNSIGNED    NOT NULL DEFAULT 0,
  -- Small derived similarity signals only — never raw captions or personal data.
  `content_fingerprint_json` JSON           NULL DEFAULT NULL,
  -- True once a human edits a field, so regeneration can preserve their work.
  `edited_fields_json`      JSON            NULL DEFAULT NULL,
  `created_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- board view: a run's items in day/slot order
  KEY `idx_planner_items_run_position` (`planner_run_id`, `position`),
  KEY `idx_planner_items_run_status` (`planner_run_id`, `approval_status`),
  -- duplication lookback: a user's recent planned items
  KEY `idx_planner_items_user_created` (`user_id`, `created_at`),
  KEY `idx_planner_items_post` (`post_id`),
  CONSTRAINT `fk_planner_items_run`
    FOREIGN KEY (`planner_run_id`) REFERENCES `planner_runs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_planner_items_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_planner_items_post`
    FOREIGN KEY (`post_id`) REFERENCES `scheduled_posts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_planner_items_media_asset`
    FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
