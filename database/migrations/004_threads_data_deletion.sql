-- =============================================================================
-- Migration 004 — Threads data-deletion callback receipts
-- -----------------------------------------------------------------------------
-- Adds `data_deletion_requests` so the public deletion-status endpoint can
-- report on a Meta/Threads data-deletion request via its confirmation code,
-- WITHOUT storing personal data. Safe to run on an existing Phase 3 database:
-- it only CREATEs a new table (IF NOT EXISTS) and touches no existing data.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

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
