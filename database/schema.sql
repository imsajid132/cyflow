-- =============================================================================
-- Cyflow Social — MySQL schema (Phase 1)
-- -----------------------------------------------------------------------------
-- Target:   MySQL 8 / MariaDB 10.4+ (Hostinger), InnoDB, utf8mb4.
-- Timezone: All DATETIME columns store UTC. The application connects with the
--           session time zone set to +00:00, so CURRENT_TIMESTAMP is UTC.
-- Import:   Directly importable into an empty database via phpMyAdmin.
--
-- Foreign key ID columns are BIGINT UNSIGNED to exactly match their parent
-- AUTO_INCREMENT primary keys.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- A. users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(255)    NOT NULL,
  `email`         VARCHAR(255)    NOT NULL,
  `password_hash` VARCHAR(255)    NOT NULL,
  `timezone`      VARCHAR(64)     NOT NULL DEFAULT 'UTC',
  `role`          ENUM('user','admin')     NOT NULL DEFAULT 'user',
  `status`        ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_login_at` DATETIME        NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- B. user_integrations  (per-user HCTI credentials — encrypted only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_integrations` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`                  BIGINT UNSIGNED NOT NULL,
  `hcti_user_id_encrypted`   VARCHAR(512)    NULL DEFAULT NULL,
  `hcti_api_key_encrypted`   VARCHAR(512)    NULL DEFAULT NULL,
  `hcti_encryption_version`  SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `hcti_verified_at`         DATETIME        NULL DEFAULT NULL,
  `created_at`               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_integrations_user` (`user_id`),
  CONSTRAINT `fk_user_integrations_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- C. social_accounts  (connected Facebook / Instagram / Threads accounts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `social_accounts` (
  `id`                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`                   BIGINT UNSIGNED NOT NULL,
  `provider`                  ENUM('meta','instagram','threads') NOT NULL,
  `account_type`              ENUM('facebook_page','instagram_professional','threads_profile') NOT NULL,
  `provider_user_id`          VARCHAR(255)    NULL DEFAULT NULL,
  `provider_account_id`       VARCHAR(255)    NOT NULL,
  `display_name`              VARCHAR(255)    NULL DEFAULT NULL,
  `username`                  VARCHAR(255)    NULL DEFAULT NULL,
  `access_token_encrypted`    TEXT            NULL DEFAULT NULL,
  `refresh_token_encrypted`   TEXT            NULL DEFAULT NULL,
  `token_expires_at`          DATETIME        NULL DEFAULT NULL,
  `refresh_token_expires_at`  DATETIME        NULL DEFAULT NULL,
  `scopes_json`               JSON            NULL DEFAULT NULL,
  `provider_metadata_json`    JSON            NULL DEFAULT NULL,
  `status`                    ENUM('active','expired','revoked','error') NOT NULL DEFAULT 'active',
  `last_verified_at`          DATETIME        NULL DEFAULT NULL,
  `created_at`                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- Prevent connecting the same provider account twice for one user.
  UNIQUE KEY `uq_social_accounts_user_provider_account`
    (`user_id`, `provider`, `provider_account_id`),
  KEY `idx_social_accounts_user` (`user_id`),
  KEY `idx_social_accounts_status` (`status`),
  CONSTRAINT `fk_social_accounts_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- D. oauth_states  (CSRF/PKCE state for OAuth flows — hashed state only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `oauth_states` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`                  BIGINT UNSIGNED NOT NULL,
  `provider`                 ENUM('meta','instagram','threads') NOT NULL,
  `state_hash`               CHAR(64)        NOT NULL,
  `code_verifier_encrypted`  TEXT            NULL DEFAULT NULL,
  `redirect_uri`             VARCHAR(512)    NOT NULL,
  `expires_at`               DATETIME        NOT NULL,
  `consumed_at`              DATETIME        NULL DEFAULT NULL,
  `created_at`               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_oauth_states_state_hash` (`state_hash`),
  KEY `idx_oauth_states_user` (`user_id`),
  KEY `idx_oauth_states_expires` (`expires_at`),
  CONSTRAINT `fk_oauth_states_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- E. scheduled_posts  (a post to be generated + published)
--    NOTE: fk to media_assets is added later (circular dependency).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `scheduled_posts` (
  `id`                                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`                            BIGINT UNSIGNED NOT NULL,
  `title`                              VARCHAR(255)    NULL DEFAULT NULL,
  `prompt`                             TEXT            NULL DEFAULT NULL,
  `status`                             ENUM('draft','queued','processing','published','partial','retrying','failed','cancelled')
                                                       NOT NULL DEFAULT 'draft',
  `scheduled_at_utc`                   DATETIME        NULL DEFAULT NULL,
  `original_timezone`                  VARCHAR(64)     NULL DEFAULT NULL,
  `generated_base_caption`             TEXT            NULL DEFAULT NULL,
  `generated_platform_captions_json`   JSON            NULL DEFAULT NULL,
  `generation_params_json`             JSON            NULL DEFAULT NULL,
  `generated_image_headline`           VARCHAR(255)    NULL DEFAULT NULL,
  `generated_image_subheadline`        VARCHAR(255)    NULL DEFAULT NULL,
  `generated_image_alt_text`           VARCHAR(500)    NULL DEFAULT NULL,
  `openai_response_id`                 VARCHAR(255)    NULL DEFAULT NULL,
  `openai_model`                       VARCHAR(128)    NULL DEFAULT NULL,
  `openai_usage_json`                  JSON            NULL DEFAULT NULL,
  `content_generated_at`               DATETIME        NULL DEFAULT NULL,
  `image_generated_at`                 DATETIME        NULL DEFAULT NULL,
  `template_name`                      VARCHAR(128)    NULL DEFAULT NULL,
  `aspect_ratio`                       VARCHAR(32)     NULL DEFAULT NULL,
  `background_style`                   VARCHAR(64)     NULL DEFAULT NULL,
  `custom_html`                        MEDIUMTEXT      NULL DEFAULT NULL,
  `custom_css`                         MEDIUMTEXT      NULL DEFAULT NULL,
  `hcti_image_id`                      VARCHAR(255)    NULL DEFAULT NULL,
  `hcti_source_url`                    VARCHAR(1024)   NULL DEFAULT NULL,
  `media_asset_id`                     BIGINT UNSIGNED NULL DEFAULT NULL,
  `retry_count`                        INT UNSIGNED    NOT NULL DEFAULT 0,
  `max_retries`                        INT UNSIGNED    NOT NULL DEFAULT 3,
  `next_attempt_at`                    DATETIME        NULL DEFAULT NULL,
  `lock_token`                         VARCHAR(64)     NULL DEFAULT NULL,
  `locked_at`                          DATETIME        NULL DEFAULT NULL,
  `processing_started_at`              DATETIME        NULL DEFAULT NULL,
  `published_at`                       DATETIME        NULL DEFAULT NULL,
  `failed_at`                          DATETIME        NULL DEFAULT NULL,
  `cancelled_at`                       DATETIME        NULL DEFAULT NULL,
  `last_error_code`                    VARCHAR(128)    NULL DEFAULT NULL,
  `last_error_message`                 VARCHAR(1024)   NULL DEFAULT NULL,
  `created_at`                         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- due queued posts: scheduler scans by status + due time
  KEY `idx_sp_due_queued` (`status`, `scheduled_at_utc`),
  -- retryable posts: status + next attempt time
  KEY `idx_sp_retryable` (`status`, `next_attempt_at`),
  -- stale locks: reclaim posts stuck in processing
  KEY `idx_sp_stale_locks` (`status`, `locked_at`),
  -- user post history
  KEY `idx_sp_user_history` (`user_id`, `created_at`),
  -- scheduled time ordering
  KEY `idx_sp_scheduled_at` (`scheduled_at_utc`),
  KEY `idx_sp_media_asset` (`media_asset_id`),
  CONSTRAINT `fk_scheduled_posts_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- G. media_assets  (generated image assets, served via public_token)
--    Defined before F's fk needs it; references scheduled_posts (already exists).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `media_assets` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`            BIGINT UNSIGNED NOT NULL,
  `scheduled_post_id`  BIGINT UNSIGNED NULL DEFAULT NULL,
  `public_token`       VARCHAR(128)    NOT NULL,
  `source_provider`    ENUM('hcti','openai','upload') NOT NULL DEFAULT 'hcti',
  `source_url`         VARCHAR(1024)   NULL DEFAULT NULL,
  `source_asset_id`    VARCHAR(255)    NULL DEFAULT NULL,
  `mime_type`          VARCHAR(128)    NULL DEFAULT NULL,
  `file_extension`     VARCHAR(16)     NULL DEFAULT NULL,
  `status`             ENUM('pending','ready','expired','failed') NOT NULL DEFAULT 'pending',
  `expires_at`         DATETIME        NULL DEFAULT NULL,
  `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_media_assets_public_token` (`public_token`),
  KEY `idx_media_assets_user` (`user_id`),
  KEY `idx_media_assets_post` (`scheduled_post_id`),
  KEY `idx_media_assets_status` (`status`),
  CONSTRAINT `fk_media_assets_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_media_assets_post`
    FOREIGN KEY (`scheduled_post_id`) REFERENCES `scheduled_posts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Close the circular reference: scheduled_posts.media_asset_id -> media_assets.id.
-- If the asset is removed independently, null the pointer on the post.
ALTER TABLE `scheduled_posts`
  ADD CONSTRAINT `fk_scheduled_posts_media_asset`
    FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- F. scheduled_post_targets  (one row per (post, social account) fan-out)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `scheduled_post_targets` (
  `id`                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scheduled_post_id`      BIGINT UNSIGNED NOT NULL,
  `social_account_id`      BIGINT UNSIGNED NOT NULL,
  `status`                 ENUM('pending','processing','retrying','published','failed','skipped','cancelled')
                                           NOT NULL DEFAULT 'pending',
  `provider_options_json`  JSON            NULL DEFAULT NULL,
  `caption_override`       TEXT            NULL DEFAULT NULL,
  `attempt_count`          INT UNSIGNED    NOT NULL DEFAULT 0,
  `last_attempt_at`        DATETIME        NULL DEFAULT NULL,
  `next_attempt_at`        DATETIME        NULL DEFAULT NULL,
  `remote_post_id`         VARCHAR(255)    NULL DEFAULT NULL,
  `remote_post_url`        VARCHAR(1024)   NULL DEFAULT NULL,
  `provider_response_json` JSON            NULL DEFAULT NULL,
  `last_error_code`        VARCHAR(128)    NULL DEFAULT NULL,
  `last_error_message`     VARCHAR(1024)   NULL DEFAULT NULL,
  `published_at`           DATETIME        NULL DEFAULT NULL,
  `created_at`             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_spt_post_account` (`scheduled_post_id`, `social_account_id`),
  KEY `idx_spt_status` (`status`),
  KEY `idx_spt_account` (`social_account_id`),
  KEY `idx_spt_retryable` (`status`, `next_attempt_at`),
  CONSTRAINT `fk_spt_post`
    FOREIGN KEY (`scheduled_post_id`) REFERENCES `scheduled_posts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_spt_account`
    FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- H. activity_logs  (audit/event trail; retained after parent deletion)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id`                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id`                CHAR(36)        NULL DEFAULT NULL,
  `user_id`                   BIGINT UNSIGNED NULL DEFAULT NULL,
  `scheduled_post_id`         BIGINT UNSIGNED NULL DEFAULT NULL,
  `scheduled_post_target_id`  BIGINT UNSIGNED NULL DEFAULT NULL,
  `level`                     ENUM('debug','info','warn','error') NOT NULL DEFAULT 'info',
  `event_type`                VARCHAR(128)    NOT NULL,
  `message`                   VARCHAR(1024)   NULL DEFAULT NULL,
  `context_json`              JSON            NULL DEFAULT NULL,
  `created_at`                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_activity_logs_user` (`user_id`, `created_at`),
  KEY `idx_activity_logs_post` (`scheduled_post_id`),
  KEY `idx_activity_logs_target` (`scheduled_post_target_id`),
  KEY `idx_activity_logs_event` (`event_type`, `created_at`),
  KEY `idx_activity_logs_request` (`request_id`),
  CONSTRAINT `fk_activity_logs_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_activity_logs_post`
    FOREIGN KEY (`scheduled_post_id`) REFERENCES `scheduled_posts` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_activity_logs_target`
    FOREIGN KEY (`scheduled_post_target_id`) REFERENCES `scheduled_post_targets` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- I. api_usage  (metering for OpenAI / HCTI / provider calls; retained)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `api_usage` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT UNSIGNED NULL DEFAULT NULL,
  `scheduled_post_id`   BIGINT UNSIGNED NULL DEFAULT NULL,
  `service`             ENUM('openai','hcti','meta','instagram','threads') NOT NULL,
  `operation`           VARCHAR(128)    NOT NULL,
  `request_identifier`  VARCHAR(255)    NULL DEFAULT NULL,
  `input_units`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `output_units`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `metadata_json`       JSON            NULL DEFAULT NULL,
  `created_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_api_usage_user` (`user_id`, `created_at`),
  KEY `idx_api_usage_service` (`service`, `created_at`),
  KEY `idx_api_usage_post` (`scheduled_post_id`),
  CONSTRAINT `fk_api_usage_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_api_usage_post`
    FOREIGN KEY (`scheduled_post_id`) REFERENCES `scheduled_posts` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- L. business_profiles  (one business profile per user; onboarding + brand)
--    Holds only reviewed/edited business data. No raw page HTML, no secrets.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `business_profiles` (
  `id`                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`                   BIGINT UNSIGNED NOT NULL,
  `business_name`             VARCHAR(160)    NULL DEFAULT NULL,
  `website_url`               VARCHAR(2000)   NULL DEFAULT NULL,
  `business_category`         VARCHAR(80)     NULL DEFAULT NULL,
  `business_description`      VARCHAR(1000)   NULL DEFAULT NULL,
  `phone`                     VARCHAR(40)     NULL DEFAULT NULL,
  `email`                     VARCHAR(254)    NULL DEFAULT NULL,
  `address`                   VARCHAR(255)    NULL DEFAULT NULL,
  `city`                      VARCHAR(120)    NULL DEFAULT NULL,
  `region`                    VARCHAR(120)    NULL DEFAULT NULL,
  `postal_code`               VARCHAR(32)     NULL DEFAULT NULL,
  `country`                   VARCHAR(80)     NULL DEFAULT NULL,
  `primary_color`             VARCHAR(9)      NULL DEFAULT NULL,
  `secondary_color`           VARCHAR(9)      NULL DEFAULT NULL,
  `accent_color`              VARCHAR(9)      NULL DEFAULT NULL,
  `heading_font`              VARCHAR(80)     NULL DEFAULT NULL,
  `body_font`                 VARCHAR(80)     NULL DEFAULT NULL,
  `logo_url`                  VARCHAR(2000)   NULL DEFAULT NULL,
  `logo_media_asset_id`       BIGINT UNSIGNED NULL DEFAULT NULL,
  `favicon_url`               VARCHAR(2000)   NULL DEFAULT NULL,
  `default_language`          VARCHAR(40)     NULL DEFAULT NULL,
  `default_tone`              VARCHAR(40)     NULL DEFAULT NULL,
  `default_call_to_action`    VARCHAR(200)    NULL DEFAULT NULL,
  `services_json`             JSON            NULL DEFAULT NULL,
  `locations_json`            JSON            NULL DEFAULT NULL,
  `social_links_json`         JSON            NULL DEFAULT NULL,
  `extracted_metadata_json`   JSON            NULL DEFAULT NULL,
  `manual_fields_json`        JSON            NULL DEFAULT NULL,
  `source_type`               ENUM('website','manual','mixed') NOT NULL DEFAULT 'manual',
  `onboarding_status`         ENUM('not_started','business_source','analyzing','brand_review','connections','completed')
                                              NOT NULL DEFAULT 'not_started',
  `onboarding_completed_at`   DATETIME        NULL DEFAULT NULL,
  `created_at`                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_business_profiles_user` (`user_id`),
  KEY `idx_business_profiles_status` (`onboarding_status`),
  KEY `idx_business_profiles_logo_asset` (`logo_media_asset_id`),
  CONSTRAINT `fk_business_profiles_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_business_profiles_logo_asset`
    FOREIGN KEY (`logo_media_asset_id`) REFERENCES `media_assets` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- K. data_deletion_requests  (Meta/Threads data-deletion callback receipts)
--    Tracks confirmation codes so the public status endpoint can report on a
--    deletion WITHOUT storing personal data. `provider_user_id` is an opaque
--    provider identifier (never exposed by the status endpoint). No FK to users
--    — a deletion request may outlive the connected account.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `data_deletion_requests` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `confirmation_code` VARCHAR(64)     NOT NULL,
  `provider`          ENUM('meta','instagram','threads') NOT NULL,
  `provider_user_id`  VARCHAR(255)    NULL DEFAULT NULL,
  `status`            ENUM('received','completed','failed') NOT NULL DEFAULT 'received',
  `accounts_removed`  INT UNSIGNED    NOT NULL DEFAULT 0,
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_data_deletion_confirmation` (`confirmation_code`),
  KEY `idx_data_deletion_provider_user` (`provider`, `provider_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- L. planner_preferences  (one row per user: how their weekly plan is built)
--    `autopilot_enabled` / `next_plan_generation_at` are PREPARED for a future
--    scheduler sweep. Nothing reads them yet and nothing publishes.
-- -----------------------------------------------------------------------------
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
  `autopilot_enabled`       TINYINT(1)      NOT NULL DEFAULT 0,
  `next_plan_generation_at` DATETIME        NULL DEFAULT NULL,
  `created_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_planner_preferences_user` (`user_id`),
  KEY `idx_planner_preferences_autopilot` (`autopilot_enabled`, `next_plan_generation_at`),
  CONSTRAINT `fk_planner_preferences_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- M. planner_runs  (one generated plan = a batch of planned posts)
-- -----------------------------------------------------------------------------
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
  KEY `idx_planner_runs_user_created` (`user_id`, `created_at`),
  KEY `idx_planner_runs_user_status` (`user_id`, `status`),
  CONSTRAINT `fk_planner_runs_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_planner_runs_business_profile`
    FOREIGN KEY (`business_profile_id`) REFERENCES `business_profiles` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- N. planner_run_items  (one planned post inside a run)
--    post_id is ON DELETE SET NULL both ways: deleting a planner item never
--    deletes the approved post it produced, and deleting the post leaves the
--    item as a history record.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `planner_run_items` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `planner_run_id`           BIGINT UNSIGNED NOT NULL,
  `user_id`                  BIGINT UNSIGNED NOT NULL,
  `post_id`                  BIGINT UNSIGNED NULL DEFAULT NULL,
  `position`                 INT UNSIGNED    NOT NULL DEFAULT 0,
  `scheduled_for`            DATETIME        NULL DEFAULT NULL,
  `original_timezone`        VARCHAR(64)     NULL DEFAULT NULL,
  `content_type`             VARCHAR(32)     NOT NULL DEFAULT 'educational',
  `goal`                     VARCHAR(32)     NULL DEFAULT NULL,
  `platform_targets_json`    JSON            NULL DEFAULT NULL,
  `template_key`             VARCHAR(128)    NULL DEFAULT NULL,
  `aspect_ratio`             VARCHAR(32)     NULL DEFAULT NULL,
  `background_style`         VARCHAR(64)     NULL DEFAULT NULL,
  `generated_headline`       VARCHAR(255)    NULL DEFAULT NULL,
  `generated_subheadline`    VARCHAR(255)    NULL DEFAULT NULL,
  `generated_summary`        VARCHAR(500)    NULL DEFAULT NULL,
  `generated_caption`        TEXT            NULL DEFAULT NULL,
  `generated_hashtags_json`  JSON            NULL DEFAULT NULL,
  `generated_alt_text`       VARCHAR(500)    NULL DEFAULT NULL,
  `brief`                    VARCHAR(2000)   NULL DEFAULT NULL,
  `media_asset_id`           BIGINT UNSIGNED NULL DEFAULT NULL,
  `approval_status`          ENUM('draft','needs_review','approved','queued','rejected')
                                             NOT NULL DEFAULT 'needs_review',
  `duplication_score`        DECIMAL(4,3)    NOT NULL DEFAULT 0.000,
  `duplication_notes`        VARCHAR(500)    NULL DEFAULT NULL,
  `regeneration_count`       INT UNSIGNED    NOT NULL DEFAULT 0,
  `content_fingerprint_json` JSON            NULL DEFAULT NULL,
  `edited_fields_json`       JSON            NULL DEFAULT NULL,
  `created_at`               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_planner_items_run_position` (`planner_run_id`, `position`),
  KEY `idx_planner_items_run_status` (`planner_run_id`, `approval_status`),
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

-- -----------------------------------------------------------------------------
-- J. sessions  (server-side session store for express-mysql-session)
--    Matches the library's default schema (utf8mb4_bin session_id).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `expires`    INT UNSIGNED NOT NULL,
  `data`       MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

SET FOREIGN_KEY_CHECKS = 1;
