-- Milestone E — Manual Create Post workspace (Save Draft, Schedule Later, Publish Now).
--
-- D2 shipped provider publishing on scheduled_post_targets; the posts themselves
-- were created through a guided generate-first flow. E turns /create into a full
-- manual workspace: an explicit draft that can be saved incomplete, edited per
-- platform by hand, scheduled for an exact local time, or queued to publish now.
--
-- This migration is ADDITIVE and touches only scheduled_posts. It adds:
--   * post_origin        — honest provenance (manual vs planner vs automation) so
--                          the workspace can tell a hand-written draft from a
--                          generated one. NULL for existing rows (derived on read).
--   * draft_version      — a monotonic version for optimistic concurrency, so two
--                          browser tabs saving the same draft cannot silently clob-
--                          ber each other (a stale write is rejected, never merged).
--   * scheduled_local_*  — the exact local date + time the user entered, preserved
--                          alongside the DST-correct UTC instant so a saved schedule
--                          round-trips into the editor without timezone math drift.
--   * last_manual_edit_at— when the copy was last edited by hand (distinct from the
--                          row's updated_at, which also moves on status changes).
--
-- Manual-post history is recorded in activity_logs (post_revisions is scoped to a
-- planner_run_item by design), so this migration does NOT change post_revisions.
--
-- Run order: after 015_provider_publishing_and_reconciliation.sql (so 010 -> 011 ->
-- 012 -> 013 -> 014 -> 015 -> 016). Migrations 010-015 are untouched; existing
-- rows stay valid (every new column is nullable or defaulted). No data backfill:
-- legacy posts keep post_origin NULL and draft_version 1. Applied manually.

ALTER TABLE `scheduled_posts`
  ADD COLUMN `post_origin`
    ENUM('manual_draft','manual_scheduled','manual_publish_now','planner_generated','automation_generated')
    NULL DEFAULT NULL
    COMMENT 'how this post was created; NULL for legacy rows (derived on read)' AFTER `status`,
  ADD COLUMN `draft_version` INT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'optimistic-concurrency version; a stale save (older version) is rejected' AFTER `post_origin`,
  ADD COLUMN `scheduled_local_date` DATE NULL DEFAULT NULL
    COMMENT 'exact local date the user scheduled (paired with original_timezone)' AFTER `original_timezone`,
  ADD COLUMN `scheduled_local_time` TIME NULL DEFAULT NULL
    COMMENT 'exact local time the user scheduled (paired with original_timezone)' AFTER `scheduled_local_date`,
  ADD COLUMN `last_manual_edit_at` DATETIME NULL DEFAULT NULL
    COMMENT 'when post copy was last edited by hand' AFTER `content_generated_at`,
  ADD KEY `idx_sp_user_origin_status` (`user_id`, `post_origin`, `status`);
