-- =============================================================================
-- Migration 006 — Business onboarding + website brand extraction (Phase 4.5)
-- -----------------------------------------------------------------------------
-- Adds `business_profiles`: one profile per user (UNIQUE user_id) holding the
-- reviewed/edited business identity, brand, contact, and onboarding state.
--
-- Safe for the existing production database: additive only. It CREATEs a new
-- table (IF NOT EXISTS) and touches no existing user, integration, OAuth, post,
-- media, or deletion-request data. No destructive reset.
--
-- Notes:
--  * No raw page HTML and no secrets are ever stored here.
--  * `extracted_metadata_json` holds only small, non-sensitive analysis notes
--    (e.g. which pages were analyzed, logo source) for the review UI.
--  * Existing users simply have no row yet and are treated as
--    onboarding_status = 'not_started' — they are never locked out.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

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
