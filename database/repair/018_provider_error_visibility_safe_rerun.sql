-- =============================================================================
-- 018, made safe to run on a database that may already have part of it.
--
-- WHY THIS FILE EXISTS. The live database was missing every column migration 018
-- adds, and the application asks for them on every read of a planner item. The
-- symptom was seventy background jobs failing with "Unknown column 'image_status'
-- in 'SELECT'" and a week that never built — the code was correct and the
-- database was a version behind.
--
-- The original 018 is written to run exactly once. This is the same change with
-- `IF NOT EXISTS` on every step, so it can be run on a database in ANY state:
-- already migrated, partly migrated, or not at all. Nothing is dropped, nothing
-- is rewritten, no existing row is touched.
--
-- Every column added here holds a category token, a SAFE user-facing message, a
-- status code or a timestamp. No key, token, provider response or post content.
--
-- Run it in the hosting panel's SQL window against the application database.
-- Safe to run twice.
-- =============================================================================

-- --- planner_run_items: the image render lifecycle -------------------------
ALTER TABLE `planner_run_items`
  ADD COLUMN IF NOT EXISTS `image_status` VARCHAR(32) NOT NULL DEFAULT 'not_requested'
    COMMENT 'not_requested|queued|rendering|retrying|ready|failed' AFTER `media_asset_id`,
  ADD COLUMN IF NOT EXISTS `image_provider` VARCHAR(32) NULL DEFAULT NULL
    COMMENT 'safe provider id' AFTER `image_status`,
  ADD COLUMN IF NOT EXISTS `image_error_category` VARCHAR(48) NULL DEFAULT NULL
    COMMENT 'normalized category token; never a provider body' AFTER `image_provider`,
  ADD COLUMN IF NOT EXISTS `image_error_code` VARCHAR(64) NULL DEFAULT NULL
    COMMENT 'stable machine token for the failure' AFTER `image_error_category`,
  ADD COLUMN IF NOT EXISTS `image_error_message` VARCHAR(1024) NULL DEFAULT NULL
    COMMENT 'SAFE user-facing message only' AFTER `image_error_code`,
  ADD COLUMN IF NOT EXISTS `image_http_status` SMALLINT UNSIGNED NULL DEFAULT NULL
    AFTER `image_error_message`,
  ADD COLUMN IF NOT EXISTS `image_retryable` TINYINT(1) NULL DEFAULT NULL
    AFTER `image_http_status`,
  ADD COLUMN IF NOT EXISTS `image_attempt_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0
    AFTER `image_retryable`,
  ADD COLUMN IF NOT EXISTS `image_last_attempt_at` DATETIME NULL DEFAULT NULL
    AFTER `image_attempt_count`;

CREATE INDEX IF NOT EXISTS `idx_pri_image_status`
  ON `planner_run_items` (`planner_run_id`, `image_status`);

-- --- user_integrations: the provider health panel ---------------------------
ALTER TABLE `user_integrations`
  ADD COLUMN IF NOT EXISTS `connection_label` VARCHAR(120) NULL DEFAULT NULL
    COMMENT 'operator-set name for this connection',
  ADD COLUMN IF NOT EXISTS `last_success_at` DATETIME NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `last_failure_at` DATETIME NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `last_error_category` VARCHAR(48) NULL DEFAULT NULL
    COMMENT 'normalized category token only',
  ADD COLUMN IF NOT EXISTS `last_error_message` VARCHAR(1024) NULL DEFAULT NULL
    COMMENT 'SAFE user-facing message only',
  ADD COLUMN IF NOT EXISTS `last_health_check_at` DATETIME NULL DEFAULT NULL;

-- --- confirm it worked ------------------------------------------------------
--
-- SHOW COLUMNS, not information_schema: a shared-hosting database user is
-- granted its own schema and nothing else, so querying information_schema fails
-- with "Access denied" — and a verification step that cannot run on the machine
-- it is meant to verify is worse than none, because the error looks like the
-- migration failed when the columns are already in place.
--
-- Expect 9 rows from the first and 6 from the second.
SHOW COLUMNS FROM `planner_run_items` LIKE 'image\_%';

SHOW COLUMNS FROM `user_integrations` WHERE `Field` IN
  ('connection_label','last_success_at','last_failure_at',
   'last_error_category','last_error_message','last_health_check_at');
