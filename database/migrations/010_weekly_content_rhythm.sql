-- Phase 4.8 — weekly content rhythm + structured quality state.
--
-- Additive and backward-compatible. Every column is nullable or carries a
-- default, so existing preferences, runs and items keep working untouched:
--
--   * a preference row with no rhythm defaults to the Balanced preset;
--   * a run generated before this migration has NULL resolved_rhythm_json and
--     quality_status, which the reader treats as "legacy plan, no rhythm
--     snapshot" and still displays;
--   * an item generated before this migration has NULL pillar/format/family and
--     NULL quality_status, and renders exactly as it did.
--
-- No existing published or queued content is altered.

-- --- preferences: the user's default rhythm ---------------------------------
ALTER TABLE `planner_preferences`
  ADD COLUMN `content_rhythm_preset` VARCHAR(32) NOT NULL DEFAULT 'balanced'
    COMMENT 'Weekly rhythm preset key (balanced, education_led, ...)'
    AFTER `content_mix_json`,
  ADD COLUMN `content_rhythm_json` JSON NULL DEFAULT NULL
    COMMENT 'Per-weekday overrides for a custom rhythm; NULL = use the preset as-is'
    AFTER `content_rhythm_preset`;

-- --- runs: the frozen rhythm snapshot + run-level quality --------------------
-- resolved_rhythm_json is the immutable resolution of (preset + custom) at
-- generation time. Once written it is never recomputed, so a later change to the
-- user's saved rhythm cannot rewrite an existing plan.
ALTER TABLE `planner_runs`
  ADD COLUMN `resolved_rhythm_json` JSON NULL DEFAULT NULL
    COMMENT 'Frozen weekly-rhythm snapshot used to generate this run'
    AFTER `settings_json`,
  ADD COLUMN `quality_status` VARCHAR(32) NULL DEFAULT NULL
    COMMENT 'Run-level quality roll-up: passed | needs_review | failed'
    AFTER `resolved_rhythm_json`,
  ADD COLUMN `quality_failures_json` JSON NULL DEFAULT NULL
    COMMENT 'Structured hard-failure reasons for a failed run'
    AFTER `quality_status`;

-- --- items: pillar/format/family metadata + structured quality --------------
ALTER TABLE `planner_run_items`
  ADD COLUMN `content_pillar` VARCHAR(48) NULL DEFAULT NULL
    COMMENT 'The strategic pillar this post serves (from the weekday rhythm)'
    AFTER `content_type`,
  ADD COLUMN `content_format` VARCHAR(48) NULL DEFAULT NULL
    COMMENT 'The strategic writing format (mirror of content_type as a stable key)'
    AFTER `content_pillar`,
  ADD COLUMN `audience_problem` VARCHAR(255) NULL DEFAULT NULL
    COMMENT 'The audience concern this post speaks to'
    AFTER `content_format`,
  ADD COLUMN `topic_angle` VARCHAR(255) NULL DEFAULT NULL
    COMMENT 'The structural framing used for this post'
    AFTER `audience_problem`,
  ADD COLUMN `cta_strategy` VARCHAR(32) NULL DEFAULT NULL
    COMMENT 'none | soft | conversational | direct | automatic'
    AFTER `topic_angle`,
  ADD COLUMN `visual_family` VARCHAR(48) NULL DEFAULT NULL
    COMMENT 'The named visual family (resolves to template_key)'
    AFTER `cta_strategy`,
  ADD COLUMN `quality_status` VARCHAR(32) NULL DEFAULT NULL
    COMMENT 'passed | needs_review | generation_failed'
    AFTER `visual_family`,
  ADD COLUMN `quality_failures_json` JSON NULL DEFAULT NULL
    COMMENT 'Structured deterministic + critic failure reasons for this item'
    AFTER `quality_status`;

-- Add 'generation_failed' to the item approval status. Adding an ENUM value is
-- additive: every existing row keeps its current value. A hard failure gets its
-- own status so the UI can refuse to approve it, rather than mislabelling it as
-- an ordinary "needs review".
ALTER TABLE `planner_run_items`
  MODIFY COLUMN `approval_status`
    ENUM('draft','needs_review','approved','queued','rejected','generation_failed')
    NOT NULL DEFAULT 'needs_review';
