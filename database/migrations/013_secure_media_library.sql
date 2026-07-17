-- Milestone C3 — secure media uploads and a reusable asset library.
--
-- media_assets already exists and already holds HCTI-rendered images, keyed by
-- an opaque public_token, with source_provider ENUM('hcti','openai','upload').
-- 'upload' was declared from the start and never used, because there was no
-- upload path. C3 adds one, so this migration fills in the columns an UPLOADED
-- asset needs and a reference table so one asset can be reused by more than one
-- entity.
--
-- Additive and backward-compatible:
--   * every new media_assets column is nullable or defaulted, so existing
--     HCTI rows stay valid and readable exactly as they are — an HCTI asset has
--     NULL storage_key and is served from its source_url as before;
--   * media_asset_references is a new table; nothing depends on it yet, and the
--     old scheduled_posts.media_asset_id pointer and media_assets.scheduled_post_id
--     keep working. References are ADDITIVE reuse tracking layered on top.
--   * migrations 010, 011 and 012 are untouched.
--
-- Run order: after 012_platform_post_revisions.sql. No data backfill. Applied
-- manually; this repository has no automated migration runner.

-- -----------------------------------------------------------------------------
-- media_assets — the fields an uploaded (locally stored) asset needs
-- -----------------------------------------------------------------------------
--
-- storage_driver + storage_key are how bytes are located. An HCTI asset has
-- driver NULL and is proxied from source_url; a local upload has driver 'local'
-- and a server-generated random storage_key. The original filename is stored
-- ONLY as sanitized display metadata and is never a path or a URL.
ALTER TABLE `media_assets`
  ADD COLUMN `storage_driver` VARCHAR(32) NULL DEFAULT NULL
    COMMENT 'Where bytes live: NULL = HCTI proxy (source_url), "local" = filesystem'
    AFTER `source_provider`,
  ADD COLUMN `storage_key` VARCHAR(255) NULL DEFAULT NULL
    COMMENT 'Server-generated opaque key for the stored file. NEVER a filename.'
    AFTER `storage_driver`,
  ADD COLUMN `original_filename` VARCHAR(255) NULL DEFAULT NULL
    COMMENT 'Sanitized display name only. Never used as a path or URL.'
    AFTER `storage_key`,
  ADD COLUMN `file_size_bytes` INT UNSIGNED NULL DEFAULT NULL
    COMMENT 'Actual stored byte size, measured server-side after validation'
    AFTER `original_filename`,
  ADD COLUMN `width` SMALLINT UNSIGNED NULL DEFAULT NULL
    COMMENT 'Actual decoded pixel width'
    AFTER `file_size_bytes`,
  ADD COLUMN `height` SMALLINT UNSIGNED NULL DEFAULT NULL
    COMMENT 'Actual decoded pixel height'
    AFTER `width`,
  ADD COLUMN `alt_text` VARCHAR(500) NULL DEFAULT NULL
    COMMENT 'User-provided alternative text'
    AFTER `height`,
  ADD COLUMN `checksum_sha256` CHAR(64) NULL DEFAULT NULL
    COMMENT 'SHA-256 of the stored bytes, for user-scoped dedup and integrity'
    AFTER `alt_text`,
  -- file_extension has been read by mediaAssetRepository since 4.7 but never
  -- existed as a column: the SELECT would fail against a real database (tests
  -- passed only because the in-memory fake carried it). Adding it here makes the
  -- repository's existing query valid and gives an uploaded asset its extension.
  ADD COLUMN `file_extension` VARCHAR(16) NULL DEFAULT NULL
    COMMENT 'Normalized extension (jpg/png/webp), for the served filename'
    AFTER `checksum_sha256`;

-- Content-based dedup is per user, so the checksum is only ever looked up
-- together with the owner. A composite index serves that lookup and never
-- reveals whether ANOTHER user holds the same bytes.
CREATE INDEX `idx_media_assets_user_checksum`
  ON `media_assets` (`user_id`, `checksum_sha256`);

-- -----------------------------------------------------------------------------
-- media_asset_references — one asset reused by many entities
-- -----------------------------------------------------------------------------
--
-- The old model tied an asset to a single scheduled_post_id. Reuse needs a
-- many-to-many edge, so this records "asset A is used by entity of TYPE at ID".
--
-- reference_type is a small ENUM of GENUINELY supported C3 entities, so a bogus
-- type cannot be written. It is deliberately NOT a free-text column: an
-- unsupported entity is a bug, and the schema refuses it.
--
-- There is no foreign key on reference_id, because it points at different tables
-- depending on reference_type (a polymorphic edge). Referential integrity for it
-- is enforced in the service, which deletes an entity's references when the
-- entity goes. The user_id FK is real and cascades, so deleting a user removes
-- their reference rows.
CREATE TABLE IF NOT EXISTS `media_asset_references` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          BIGINT UNSIGNED NOT NULL,
  `media_asset_id`   BIGINT UNSIGNED NOT NULL,
  `reference_type`   ENUM('planner_run_item','scheduled_post') NOT NULL,
  `reference_id`     BIGINT UNSIGNED NOT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- One asset is referenced by a given entity at most once: a duplicate attach
  -- is a no-op, not a second row.
  UNIQUE KEY `uq_media_ref_asset_entity`
    (`media_asset_id`, `reference_type`, `reference_id`),
  -- "How many references does this asset have?" — the delete-protection query.
  KEY `idx_media_ref_asset` (`media_asset_id`),
  -- "Which assets does this entity use?" and cleanup when an entity is deleted.
  KEY `idx_media_ref_entity` (`reference_type`, `reference_id`),
  KEY `idx_media_ref_user` (`user_id`),
  CONSTRAINT `fk_media_ref_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_media_ref_asset`
    FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
