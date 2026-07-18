-- Milestone G — user data export + account deletion.
--
-- Adds the two ledgers a user needs to (1) download a copy of their data and
-- (2) permanently delete their account. Both are driven by durable background
-- jobs (user_data_export / user_account_deletion) on the D1 job system.
--
-- Security posture, mirroring existing tables:
--   * A download link is a capability. We store ONLY a SHA-256 hash of the token
--     (like oauth_states.state_hash); the raw token is shown once and never kept.
--   * The archive file lives in private storage (storage_driver/storage_key,
--     outside the web root, exactly like media_assets) and is served through a
--     controlled, owner-checked route — never a public path.
--   * account_deletion_requests keeps an opaque confirmation_code receipt whose
--     user_id is nullable, so the receipt can outlive the deleted account (the
--     same choice data_deletion_requests makes for provider callbacks).
--
-- Run order: after 016_manual_publish_workspace.sql (010 -> ... -> 016 -> 017).
-- Additive; migrations 010-016 unchanged; existing rows stay valid. Applied
-- manually (no automated runner). schema.sql updated to match.

-- -----------------------------------------------------------------------------
-- user_data_exports — a prepared, downloadable copy of a user's data
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_data_exports` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`              BIGINT UNSIGNED NOT NULL,
  `status`               ENUM('requested','processing','ready','failed','expired','revoked') NOT NULL DEFAULT 'requested',
  `download_token_hash`  CHAR(64)        NULL DEFAULT NULL COMMENT 'SHA-256 of the one-time download token; raw token never stored',
  `storage_driver`       VARCHAR(32)     NULL DEFAULT NULL,
  `storage_key`          VARCHAR(255)    NULL DEFAULT NULL COMMENT 'private archive location, never surfaced',
  `file_size_bytes`      BIGINT UNSIGNED NULL DEFAULT NULL,
  `error_message`        VARCHAR(1024)   NULL DEFAULT NULL COMMENT 'safe message only',
  `requested_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at`         DATETIME        NULL DEFAULT NULL,
  `expires_at`           DATETIME        NULL DEFAULT NULL,
  `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_data_exports_token` (`download_token_hash`),
  KEY `idx_user_data_exports_user` (`user_id`, `created_at`),
  KEY `idx_user_data_exports_expiry` (`status`, `expires_at`),
  CONSTRAINT `fk_user_data_exports_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- account_deletion_requests — a user-initiated account deletion + its receipt
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `account_deletion_requests` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'nullable: the receipt outlives the deleted user row',
  `status`            ENUM('requested','processing','completed','failed','cancelled') NOT NULL DEFAULT 'requested',
  `confirmation_code` VARCHAR(64)     NOT NULL,
  `reason`            VARCHAR(255)    NULL DEFAULT NULL,
  `requested_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at`      DATETIME        NULL DEFAULT NULL,
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_account_deletion_code` (`confirmation_code`),
  KEY `idx_account_deletion_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
