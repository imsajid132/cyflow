-- Milestone D1 — always-on automation, rolling content buffer and durable jobs.
--
-- Milestone C prepared and reviewed content one plan at a time, by hand. D1 adds
-- an ONGOING automation: a user configures platforms, accounts, timezone,
-- weekdays, local times and a weekly rhythm once, and the system keeps a rolling
-- buffer of future prepared content topped up by DATABASE-BACKED background
-- workers that run while the browser is closed. D1 PREPARES AND QUEUES content
-- only — it never calls a real Facebook/Instagram/Threads publishing API. That
-- is Milestone D2.
--
-- Design: an automation owns ONE backing planner_run (planner_runs gains a
-- content_automation_id back-pointer). Slot generation appends planner_run_items
-- to that run, so the Weekly Board, per-platform copy, revisions and media
-- selection are all reused unchanged. automation_schedule_slots is the buffer's
-- unit and its idempotency ledger; background_jobs is a GENERAL durable queue,
-- deliberately separate from the per-post publish-job columns already on
-- scheduled_posts (those belong to D2 publishing). worker_leases is a small
-- named-lock table for singleton coordination (the scheduler tick, the recovery
-- sweep); job-level leases live on background_jobs itself.
--
-- Additive and backward-compatible:
--   * four NEW tables; nothing existing depends on them;
--   * two NEW nullable columns (planner_runs.content_automation_id,
--     activity_logs.content_automation_id), each with an ON DELETE SET NULL FK,
--     so existing planner runs and activity rows stay valid untouched;
--   * every automation event is a new activity_logs.event_type string — no enum
--     change, no notifications table (attention surfaces via the automation's
--     own status + attention_reason and warn/error activity);
--   * migrations 010, 011, 012 and 013 are untouched.
--
-- Run order: after 013_secure_media_library.sql (so 010 -> 011 -> 012 -> 013 ->
-- 014). No data backfill. Applied manually; this repository has no automated
-- migration runner. Do not run on production without the staging checklist.

-- -----------------------------------------------------------------------------
-- content_automations — the ongoing automation configuration + rolling state
-- -----------------------------------------------------------------------------
--
-- Explicit platform and account selections are AUTHORITATIVE: selected_* is what
-- the automation uses, never "every connected account". config_snapshot_json is
-- the immutable configuration frozen onto already-generated future slots, so
-- editing future settings never rewrites content already prepared.
CREATE TABLE IF NOT EXISTS `content_automations` (
  `id`                        BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id`                   BIGINT UNSIGNED  NOT NULL,
  `business_profile_id`       BIGINT UNSIGNED  NULL DEFAULT NULL,
  `planner_run_id`            BIGINT UNSIGNED  NULL DEFAULT NULL COMMENT 'the backing rolling planner_run this automation appends items to',
  `name`                      VARCHAR(160)     NULL DEFAULT NULL,
  `status`                    ENUM('draft','active','paused','attention_needed','stopped') NOT NULL DEFAULT 'draft',
  `mode`                      ENUM('draft_only','review','autopilot') NOT NULL DEFAULT 'review',
  `timezone`                  VARCHAR(64)      NOT NULL,
  `selected_weekdays_json`    JSON             NOT NULL COMMENT 'ISO weekdays 1..7 the automation posts on',
  `posting_times_json`        JSON             NOT NULL COMMENT 'local HH:MM times per active day',
  `posts_per_day`             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `rhythm_key`                VARCHAR(48)      NULL DEFAULT NULL,
  `selected_platforms_json`   JSON             NOT NULL,
  `selected_account_ids_json` JSON             NOT NULL,
  `start_date`                DATE             NULL DEFAULT NULL,
  `end_date`                  DATE             NULL DEFAULT NULL COMMENT 'NULL = runs indefinitely',
  `generation_horizon_days`   SMALLINT UNSIGNED NOT NULL DEFAULT 14,
  `minimum_ready_days`        SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  `low_buffer_days`           SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  `missed_post_policy`        ENUM('skip','hold','next_safe_time') NOT NULL DEFAULT 'skip',
  `failure_policy`            ENUM('pause','continue') NOT NULL DEFAULT 'pause',
  `config_snapshot_json`      JSON             NULL DEFAULT NULL COMMENT 'immutable config applied to already-generated future slots',
  `generated_through_date`    DATE             NULL DEFAULT NULL,
  `attention_reason`          VARCHAR(255)     NULL DEFAULT NULL,
  `last_refill_at`            DATETIME         NULL DEFAULT NULL,
  `next_refill_at`            DATETIME         NULL DEFAULT NULL,
  `created_at`                DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `stopped_at`                DATETIME         NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_content_automations_user_status` (`user_id`, `status`),
  KEY `idx_content_automations_due_refill` (`status`, `next_refill_at`),
  KEY `idx_content_automations_run` (`planner_run_id`),
  CONSTRAINT `fk_content_automations_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_content_automations_business_profile`
    FOREIGN KEY (`business_profile_id`) REFERENCES `business_profiles` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_content_automations_run`
    FOREIGN KEY (`planner_run_id`) REFERENCES `planner_runs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- planner_runs gains a back-pointer so the backing rolling run can be told apart
-- from an ordinary hand-made plan (the planner history hides automation runs).
ALTER TABLE `planner_runs`
  ADD COLUMN `content_automation_id` BIGINT UNSIGNED NULL DEFAULT NULL
    COMMENT 'set when this run is the rolling backing run of an automation' AFTER `business_profile_id`,
  ADD KEY `idx_planner_runs_automation` (`content_automation_id`),
  ADD CONSTRAINT `fk_planner_runs_automation`
    FOREIGN KEY (`content_automation_id`) REFERENCES `content_automations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- automation_schedule_slots — one row per intended future slot (the buffer unit)
-- -----------------------------------------------------------------------------
--
-- The idempotency ledger for content: a slot is claimed (planned -> generating)
-- before its planner_run_item exists, so a duplicate slot-generation job cannot
-- create a second item. UNIQUE(automation_id, local_date, local_time, sequence)
-- is the "no duplicate date/time slot" guarantee; UNIQUE(idempotency_key) mirrors
-- the job key.
CREATE TABLE IF NOT EXISTS `automation_schedule_slots` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`              BIGINT UNSIGNED NOT NULL,
  `automation_id`        BIGINT UNSIGNED NOT NULL,
  `planner_run_item_id`  BIGINT UNSIGNED NULL DEFAULT NULL,
  `local_date`           DATE            NOT NULL,
  `local_time`           VARCHAR(5)      NOT NULL COMMENT 'HH:MM local wall-clock time',
  `sequence`             TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'nth post within the local day',
  `scheduled_for_utc`    DATETIME        NOT NULL,
  `status`               ENUM('planned','generating','ready','failed','skipped','cancelled') NOT NULL DEFAULT 'planned',
  `idempotency_key`      VARCHAR(191)    NOT NULL,
  `last_error_category`  VARCHAR(64)     NULL DEFAULT NULL,
  `last_error_message`   VARCHAR(1024)   NULL DEFAULT NULL,
  `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_slot_automation_datetime` (`automation_id`, `local_date`, `local_time`, `sequence`),
  UNIQUE KEY `uq_slot_idempotency` (`idempotency_key`),
  KEY `idx_slots_automation_status` (`automation_id`, `status`),
  KEY `idx_slots_scheduled` (`scheduled_for_utc`),
  KEY `idx_slots_item` (`planner_run_item_id`),
  CONSTRAINT `fk_slots_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_slots_automation`
    FOREIGN KEY (`automation_id`) REFERENCES `content_automations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_slots_item`
    FOREIGN KEY (`planner_run_item_id`) REFERENCES `planner_run_items` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- background_jobs — a general database-backed durable job queue
-- -----------------------------------------------------------------------------
--
-- The database is authoritative; a process-local lock is at most a fast first
-- guard. A job is claimed atomically (see the repository's SELECT ... FOR UPDATE
-- + guarded UPDATE) which writes locked_by/locked_until/heartbeat_at. A crashed
-- worker's job becomes reclaimable once locked_until passes. idempotency_key is
-- UNIQUE so a duplicated scheduler tick or user click enqueues the SAME logical
-- job once. job_type is free-text (like activity_logs.event_type) so new job
-- types need no migration.
CREATE TABLE IF NOT EXISTS `background_jobs` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`              BIGINT UNSIGNED NULL DEFAULT NULL,
  `automation_id`        BIGINT UNSIGNED NULL DEFAULT NULL,
  `job_type`             VARCHAR(64)     NOT NULL,
  `status`               ENUM('pending','running','retry_scheduled','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  `idempotency_key`      VARCHAR(191)    NOT NULL,
  `payload_json`         JSON            NULL DEFAULT NULL,
  `scheduled_for`        DATETIME        NULL DEFAULT NULL COMMENT 'logical time the job represents (e.g. the slot time)',
  `available_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'earliest claim time; moved forward for backoff',
  `attempt_count`        INT UNSIGNED    NOT NULL DEFAULT 0,
  `max_attempts`         INT UNSIGNED    NOT NULL DEFAULT 5,
  `locked_by`            VARCHAR(64)     NULL DEFAULT NULL,
  `locked_until`         DATETIME        NULL DEFAULT NULL,
  `heartbeat_at`         DATETIME        NULL DEFAULT NULL,
  `last_error_category`  VARCHAR(64)     NULL DEFAULT NULL,
  `last_error_message`   VARCHAR(1024)   NULL DEFAULT NULL,
  `completed_at`         DATETIME        NULL DEFAULT NULL,
  `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jobs_idempotency` (`idempotency_key`),
  KEY `idx_jobs_claimable` (`status`, `available_at`),
  KEY `idx_jobs_lease` (`status`, `locked_until`),
  KEY `idx_jobs_automation` (`automation_id`, `status`),
  KEY `idx_jobs_user` (`user_id`),
  CONSTRAINT `fk_jobs_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_jobs_automation`
    FOREIGN KEY (`automation_id`) REFERENCES `content_automations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- worker_leases — small named singleton locks for cross-process coordination
-- -----------------------------------------------------------------------------
--
-- Used to keep one scheduler tick / one recovery sweep from stampeding when more
-- than one worker runs. Correctness never depends on this (job idempotency keys
-- and job leases do); it only avoids redundant work. A lease is reclaimable once
-- expires_at passes.
CREATE TABLE IF NOT EXISTS `worker_leases` (
  `lock_name`    VARCHAR(64)  NOT NULL,
  `owner`        VARCHAR(64)  NOT NULL,
  `acquired_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`   DATETIME     NOT NULL,
  `heartbeat_at` DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`lock_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- activity_logs gains an automation reference so per-automation history is a
-- simple indexed read rather than a JSON scan. Nullable + SET NULL, so an
-- automation event survives the automation's deletion as an anonymous audit row.
ALTER TABLE `activity_logs`
  ADD COLUMN `content_automation_id` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `scheduled_post_target_id`,
  ADD KEY `idx_activity_logs_automation` (`content_automation_id`, `created_at`),
  ADD CONSTRAINT `fk_activity_logs_automation`
    FOREIGN KEY (`content_automation_id`) REFERENCES `content_automations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
