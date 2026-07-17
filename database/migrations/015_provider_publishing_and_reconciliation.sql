-- Milestone D2 — Meta provider publishing, retries and reconciliation.
--
-- D1 built the durable job system and the rolling automation buffer; nothing
-- published to a provider. D2 adds REAL Facebook Pages / Instagram Professional /
-- Threads publishing adapters and the durable jobs that drive them. Publishing
-- operates on the existing scheduled_posts + scheduled_post_targets rows (one
-- target per selected account). This migration adds the target-level PUBLISH
-- state and the publish-attempt ledger that makes publishing idempotent and
-- reconcilable — an uncertain provider result is checked against the provider,
-- never blindly re-published.
--
-- IMPORTANT: live provider calls are gated behind ENABLE_LIVE_PROVIDER_PUBLISHING
-- (default false). This migration only prepares the schema; it publishes nothing.
--
-- Additive and backward-compatible:
--   * scheduled_post_targets gains publish_status (a richer axis than the legacy
--     `status`, defaulted so existing rows are valid), last_publish_attempt_id
--     (a soft pointer, no FK — mirrors media_asset_references.reference_id), and
--     attention_reason. The existing target columns attempt_count / next_attempt_at
--     / remote_post_id / remote_post_url / provider_response_json / last_error_*
--     / published_at already exist and were previously unused — D2 wires them.
--   * publish_attempts is a new table.
--   * migrations 010-014 are untouched; existing rows stay valid.
--
-- Run order: after 014_automation_buffer_and_durable_jobs.sql (so 010 -> 011 ->
-- 012 -> 013 -> 014 -> 015). No data backfill (existing targets default to
-- publish_status 'scheduled'). Applied manually; no automated migration runner.
-- Do not run on production without the D2 staging checklist.

-- -----------------------------------------------------------------------------
-- scheduled_post_targets — per-target publish state
-- -----------------------------------------------------------------------------
ALTER TABLE `scheduled_post_targets`
  ADD COLUMN `publish_status`
    ENUM('draft','waiting_approval','scheduled','publishing','submitted','reconciling','published','retry_scheduled','failed','cancelled','attention_needed','skipped')
    NOT NULL DEFAULT 'scheduled'
    COMMENT 'per-target publish state; one target succeeding never hides another failing' AFTER `status`,
  ADD COLUMN `last_publish_attempt_id` BIGINT UNSIGNED NULL DEFAULT NULL
    COMMENT 'soft pointer to the latest publish_attempts row (no FK, mirrors reference_id)' AFTER `publish_status`,
  ADD COLUMN `attention_reason` VARCHAR(255) NULL DEFAULT NULL AFTER `last_publish_attempt_id`,
  ADD KEY `idx_spt_publish_due` (`publish_status`, `next_attempt_at`);

-- -----------------------------------------------------------------------------
-- publish_attempts — the audit + reconciliation ledger (safe fields only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `publish_attempts` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`                  BIGINT UNSIGNED NOT NULL,
  `scheduled_post_id`        BIGINT UNSIGNED NOT NULL,
  `scheduled_post_target_id` BIGINT UNSIGNED NOT NULL,
  `social_account_id`        BIGINT UNSIGNED NULL DEFAULT NULL,
  `background_job_id`        BIGINT UNSIGNED NULL DEFAULT NULL,
  `provider`                 ENUM('meta','instagram','threads') NOT NULL,
  `status`                   ENUM('started','submitted','published','reconciling','retryable_failure','permanent_failure','unknown_result','blocked') NOT NULL DEFAULT 'started',
  `idempotency_key`          VARCHAR(191)    NOT NULL,
  `provider_container_id`    VARCHAR(255)    NULL DEFAULT NULL,
  `provider_post_id`         VARCHAR(255)    NULL DEFAULT NULL,
  `provider_request_id`      VARCHAR(255)    NULL DEFAULT NULL,
  `provider_status`          VARCHAR(64)     NULL DEFAULT NULL,
  `attempt_number`           INT UNSIGNED    NOT NULL DEFAULT 1,
  `error_category`           VARCHAR(64)     NULL DEFAULT NULL,
  `safe_error_message`       VARCHAR(1024)   NULL DEFAULT NULL,
  `started_at`               DATETIME        NULL DEFAULT NULL,
  `submitted_at`             DATETIME        NULL DEFAULT NULL,
  `published_at`             DATETIME        NULL DEFAULT NULL,
  `last_checked_at`          DATETIME        NULL DEFAULT NULL,
  `next_reconcile_at`        DATETIME        NULL DEFAULT NULL,
  `created_at`               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_publish_attempts_idempotency` (`idempotency_key`),
  KEY `idx_publish_attempts_target` (`scheduled_post_target_id`, `created_at`),
  KEY `idx_publish_attempts_post` (`scheduled_post_id`),
  KEY `idx_publish_attempts_reconcile` (`status`, `next_reconcile_at`),
  KEY `idx_publish_attempts_user` (`user_id`),
  CONSTRAINT `fk_publish_attempts_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_publish_attempts_post`
    FOREIGN KEY (`scheduled_post_id`) REFERENCES `scheduled_posts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_publish_attempts_target`
    FOREIGN KEY (`scheduled_post_target_id`) REFERENCES `scheduled_post_targets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_publish_attempts_account`
    FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
