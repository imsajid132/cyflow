-- Phase 4.7.2 — per-platform post copy.
--
-- Until now the planner generated copy ONCE, for the first target platform, and
-- fanned the identical string out to Facebook, Instagram and Threads at queue
-- time. Three platforms received byte-identical text, which is why Threads read
-- like a trimmed Instagram post: it was literally the same post.
--
-- `platform_captions_json` holds the per-platform copy:
--
--   { "facebook":  { "caption": "...", "hashtags": ["#a"] },
--     "instagram": { "caption": "...", "hashtags": ["#a","#b"] },
--     "threads":   { "caption": "...", "hashtags": [] } }
--
-- `generated_caption` is KEPT and still holds the primary platform's copy. It
-- remains the canonical field for the review board, the fingerprint and every
-- caller written before this phase, so nothing that reads an item breaks. The
-- new column is additive: an item with a NULL value simply has no per-platform
-- variants yet and falls back to `generated_caption`, which is exactly the old
-- behaviour.

ALTER TABLE `planner_run_items`
  ADD COLUMN `platform_captions_json` JSON NULL DEFAULT NULL
    COMMENT 'Per-platform post copy + hashtags; NULL falls back to generated_caption'
    AFTER `generated_hashtags_json`;
