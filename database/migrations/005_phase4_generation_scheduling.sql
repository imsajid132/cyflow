-- =============================================================================
-- Migration 005 — Phase 4: content generation, image options, scheduling
-- -----------------------------------------------------------------------------
-- Adds a few columns to `scheduled_posts` needed by Phase 4: the selected image
-- aspect ratio + background style, the generated image alt text, the generation
-- input parameters (brand/tone/language/etc.), and content/image generation
-- timestamps. All other Phase 4 needs are already covered by the existing
-- scheduled_posts / scheduled_post_targets / media_assets / api_usage tables.
--
-- Safe for the existing production database: additive only (no drops, no data
-- reset). Uses MariaDB's `ADD COLUMN IF NOT EXISTS` so it is idempotent on
-- Hostinger MariaDB. (On MySQL 8 without IF NOT EXISTS, run once.)
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE `scheduled_posts`
  ADD COLUMN IF NOT EXISTS `aspect_ratio`              VARCHAR(32)  NULL DEFAULT NULL AFTER `template_name`,
  ADD COLUMN IF NOT EXISTS `background_style`          VARCHAR(64)  NULL DEFAULT NULL AFTER `aspect_ratio`,
  ADD COLUMN IF NOT EXISTS `generated_image_alt_text`  VARCHAR(500) NULL DEFAULT NULL AFTER `generated_image_subheadline`,
  ADD COLUMN IF NOT EXISTS `generation_params_json`    JSON         NULL DEFAULT NULL AFTER `generated_platform_captions_json`,
  ADD COLUMN IF NOT EXISTS `content_generated_at`      DATETIME     NULL DEFAULT NULL AFTER `openai_usage_json`,
  ADD COLUMN IF NOT EXISTS `image_generated_at`        DATETIME     NULL DEFAULT NULL AFTER `content_generated_at`;
