-- Milestone C2 — post revision history.
--
-- WHAT THIS IS FOR. The Weekly Board now edits each platform's copy
-- independently, retries one platform at a time, and lets a person overwrite the
-- machine's version. A revision row records each of those state changes so the
-- drawer can show "Generated / Retried / Manually edited / Approved / Queued"
-- and let the user see what a previous version said, without keeping the history
-- inside the item row itself.
--
-- WHAT THIS IS NOT. Not a prompt log and not an audit of secrets. It stores the
-- COPY that was produced, never the prompt that produced it, never a key, never
-- a token, never a raw provider response. There is nothing sensitive to leak
-- here because nothing sensitive is written here.
--
-- ONLY a table. Per-platform user-edited state is NOT here: it lives inside the
-- existing platform_captions_json on planner_run_items, because that is already
-- the canonical per-platform store and adding a parallel column would be a
-- second source of truth for the same fact. So this migration is one CREATE
-- TABLE and nothing else — no ALTER, no touch to any existing row.
--
-- Additive and backward-compatible. New table, so existing rows are untouched
-- by definition. The seven+one earlier migrations are unmodified.
--
-- Run order: after 011_customer_openai_credentials.sql. No backfill: items that
-- existed before this simply have no revision history until their next edit,
-- which is the honest state.
--
-- Applied manually; this repository has no automated migration runner.

-- -----------------------------------------------------------------------------
-- post_revisions — one row per real copy state change, per platform
-- -----------------------------------------------------------------------------
--
-- Scoped to a planner_run_item and a platform. scheduled_post_id is nullable and
-- present for the later phase where a manual /create post (not from the planner)
-- carries its own revisions; today every revision is a planner item's, so the FK
-- to planner_run_items is the one that is NOT NULL.
--
-- ON DELETE CASCADE from the item: a deleted post takes its history with it.
-- There is no value in orphan revisions pointing at an item that no longer
-- exists, and keeping them would be a slow leak of rows nobody can reach.
CREATE TABLE IF NOT EXISTS `post_revisions` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT UNSIGNED NOT NULL,
  `planner_run_item_id` BIGINT UNSIGNED NOT NULL,
  `scheduled_post_id`   BIGINT UNSIGNED NULL DEFAULT NULL,
  `platform`            ENUM('facebook','instagram','threads') NOT NULL,
  `revision_type`       ENUM('generated','retry','manual_edit','approved','queued') NOT NULL,
  -- The copy AS IT WAS at this revision. Never a prompt, never a secret.
  `post_copy`           MEDIUMTEXT      NULL DEFAULT NULL,
  `hashtags_json`       JSON            NULL DEFAULT NULL,
  -- The validator's verdict at the moment this revision was recorded, so the
  -- timeline can show that a manual edit was still failing without re-running it.
  `validation_status`   VARCHAR(32)     NULL DEFAULT NULL,
  -- A short content hash of (post_copy + hashtags), so an identical re-save does
  -- not create a duplicate revision. Deterministic and non-secret.
  `content_hash`        CHAR(64)        NULL DEFAULT NULL,
  `created_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- The timeline query: newest revisions for one item.
  KEY `idx_post_revisions_item_created` (`planner_run_item_id`, `created_at`),
  -- The idempotency check: has this exact content already been recorded for this
  -- item and platform?
  KEY `idx_post_revisions_dedup` (`planner_run_item_id`, `platform`, `content_hash`),
  KEY `idx_post_revisions_user` (`user_id`),
  CONSTRAINT `fk_post_revisions_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_post_revisions_item`
    FOREIGN KEY (`planner_run_item_id`) REFERENCES `planner_run_items` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_post_revisions_post`
    FOREIGN KEY (`scheduled_post_id`) REFERENCES `scheduled_posts` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
