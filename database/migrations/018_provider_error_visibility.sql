-- Provider + background-job error visibility.
--
-- Two gaps this closes, both about making a failure VISIBLE instead of silent:
--
--   1. A planner item's image state lived only as a string inside
--      content_fingerprint_json ("imageStatus"), it never moved quality_status
--      or approval_status, and no event was recorded. A failed render was
--      therefore indistinguishable from a never-rendered one — the board showed
--      a bare "No image" with no reason. These columns promote the image
--      lifecycle and its normalized failure to first-class, queryable, safe
--      fields so the board can show "Image failed / HCTI · Credits exhausted"
--      and a "Retry image" action.
--
--   2. The Integrations page could show only "saved / verified". These columns
--      let it show a health panel — an operator-set connection label, the last
--      successful and last failed use, the last safe error category and the last
--      health check — WITHOUT storing any credential material (the masked
--      last-4 is still derived on read from the existing encrypted envelope).
--
-- Safety posture: every new column holds a category token, a SAFE user-facing
-- message, a status code or a timestamp. No key, token, provider body or private
-- post content is ever stored here.
--
-- Run order: after 017_user_data_export_and_deletion.sql (010 -> ... -> 017 ->
-- 018). Additive only; existing rows stay valid (image_status defaults to
-- 'not_requested', which decorateItem overrides to 'ready' whenever a
-- media_asset_id is present, so old rows read correctly without a backfill).
-- Applied manually; no automated migration runner. schema.sql updated to match.

-- -----------------------------------------------------------------------------
-- planner_run_items — image render lifecycle + normalized failure
-- -----------------------------------------------------------------------------
ALTER TABLE `planner_run_items`
  ADD COLUMN `image_status` VARCHAR(32) NOT NULL DEFAULT 'not_requested'
    COMMENT 'not_requested|queued|rendering|retrying|ready|failed'
    AFTER `media_asset_id`,
  ADD COLUMN `image_provider` VARCHAR(32) NULL DEFAULT NULL
    COMMENT 'safe provider id, e.g. hcti' AFTER `image_status`,
  ADD COLUMN `image_error_category` VARCHAR(48) NULL DEFAULT NULL
    COMMENT 'normalized PROVIDER_ERROR_CATEGORY token; never a provider body' AFTER `image_provider`,
  ADD COLUMN `image_error_code` VARCHAR(64) NULL DEFAULT NULL
    COMMENT 'stable machine token for the failure' AFTER `image_error_category`,
  ADD COLUMN `image_error_message` VARCHAR(1024) NULL DEFAULT NULL
    COMMENT 'SAFE user-facing message only' AFTER `image_error_code`,
  ADD COLUMN `image_http_status` SMALLINT UNSIGNED NULL DEFAULT NULL
    AFTER `image_error_message`,
  ADD COLUMN `image_retryable` TINYINT(1) NULL DEFAULT NULL
    AFTER `image_http_status`,
  ADD COLUMN `image_attempt_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0
    AFTER `image_retryable`,
  ADD COLUMN `image_last_attempt_at` DATETIME NULL DEFAULT NULL
    AFTER `image_attempt_count`;

-- Query failed images across a plan quickly (board summary + diagnostics).
CREATE INDEX `idx_pri_image_status` ON `planner_run_items` (`planner_run_id`, `image_status`);

-- -----------------------------------------------------------------------------
-- user_integrations — provider health panel (safe, credential-free)
-- -----------------------------------------------------------------------------
ALTER TABLE `user_integrations`
  ADD COLUMN `hcti_connection_label` VARCHAR(120) NULL DEFAULT NULL
    COMMENT 'operator-chosen name, e.g. "Main HCTI"; not a credential' AFTER `hcti_verified_at`,
  ADD COLUMN `hcti_last_success_at` DATETIME NULL DEFAULT NULL AFTER `hcti_connection_label`,
  ADD COLUMN `hcti_last_failure_at` DATETIME NULL DEFAULT NULL AFTER `hcti_last_success_at`,
  ADD COLUMN `hcti_last_error_category` VARCHAR(48) NULL DEFAULT NULL AFTER `hcti_last_failure_at`,
  ADD COLUMN `hcti_last_checked_at` DATETIME NULL DEFAULT NULL AFTER `hcti_last_error_category`,
  ADD COLUMN `openai_connection_label` VARCHAR(120) NULL DEFAULT NULL
    COMMENT 'operator-chosen name; not a credential' AFTER `openai_verified_at`,
  ADD COLUMN `openai_last_success_at` DATETIME NULL DEFAULT NULL AFTER `openai_connection_label`,
  ADD COLUMN `openai_last_failure_at` DATETIME NULL DEFAULT NULL AFTER `openai_last_success_at`,
  ADD COLUMN `openai_last_error_category` VARCHAR(48) NULL DEFAULT NULL AFTER `openai_last_failure_at`,
  ADD COLUMN `openai_last_checked_at` DATETIME NULL DEFAULT NULL AFTER `openai_last_error_category`;
