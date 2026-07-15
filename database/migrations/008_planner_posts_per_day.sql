-- =============================================================================
-- Migration 008 — Planner posts-per-day + plan archival (Phase 4.7.1)
-- -----------------------------------------------------------------------------
-- Adds:
--   * `planner_preferences.posts_per_day`  — how many posts each active day gets
--   * `planner_runs.posts_per_day`         — what the run was generated with
--   * `planner_runs.archived_at`           — set when a plan is archived rather
--                                            than destroyed (it has published
--                                            history that must not disappear)
--
-- Safe for the existing production database: additive only, with defaults, so
-- existing rows are valid immediately. Every existing preference and run
-- defaults to 1 post per active day — the behaviour they were generated with.
--
-- Idempotent: uses IF NOT EXISTS, so re-running is harmless.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE `planner_preferences`
  ADD COLUMN IF NOT EXISTS `posts_per_day` TINYINT UNSIGNED NOT NULL DEFAULT 1
    AFTER `default_plan_length`;

ALTER TABLE `planner_runs`
  ADD COLUMN IF NOT EXISTS `posts_per_day` TINYINT UNSIGNED NOT NULL DEFAULT 1
    AFTER `plan_length`,
  ADD COLUMN IF NOT EXISTS `archived_at` DATETIME NULL DEFAULT NULL
    AFTER `generation_notes`;
