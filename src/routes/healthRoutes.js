/**
 * Health route.
 *
 * GET /health — liveness + dependency status. Deliberately does NOT expose the
 * database name, credentials, environment variables, secrets, or internal
 * paths. Returns HTTP 200 when the app is up and 503 when the database is
 * unreachable (so uptime checks can distinguish degraded state).
 */

import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { checkHealth } from '../db/pool.js';
import { config } from '../config/env.js';
import { nowIso } from '../utils/time.js';
import { APP_NAME, JOB_TYPES } from '../config/constants.js';
import { jobStats, jobStatusCounts, lastJobFailure } from '../repositories/backgroundJobRepository.js';
import { backgroundStatus } from '../jobs/backgroundStatus.js';
import { isClaudeConfigured } from '../services/aiStudio/claudeClient.js';
import { isAiStudioMode } from '../services/aiStudio/aiStudioEngine.js';
import { aiConfigFileUsed } from '../services/aiStudio/aiConfigFile.js';

// Application version, read once (kept minimal — no other package.json exposure).
const APP_VERSION = process.env.npm_package_version || '1.0.0';

const router = Router();

router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const db = await checkHealth();
    const healthy = db.ok;

    // Durable job queue snapshot (safe counts only — never payloads, ids, or
    // credentials). This does NOT assert the worker process is alive: a growing
    // pending/stale count while the web server is up is exactly the signal that
    // the separate worker is down.
    let worker = null;
    if (db.ok) {
      try {
        const stats = await jobStats();
        worker = { pendingJobs: stats.pending, runningJobs: stats.running, staleJobs: stats.stale };
      } catch {
        worker = { pendingJobs: null, runningJobs: null, staleJobs: null };
      }
    }

    // D2: publishing readiness. liveEnabled=false means no post is being sent to
    // any provider — a healthy web server does NOT imply publishing is operational.
    const publishing = { liveEnabled: Boolean(config.publishing?.liveEnabled) };

    /*
     * AI poster studio readiness, as two booleans and nothing else.
     *
     * A deployment where the key never reached the process looks identical from
     * the outside to one where it did: the app is up, the page renders, and the
     * only symptom is "not configured yet" behind a login. That is precisely the
     * state this reports, so it can be checked without signing in.
     *
     * `configured` is the PRESENCE of a key, never its value, length or prefix;
     * `mode` is the flag that decides whether the daily automation uses this
     * engine. Neither reveals a secret.
     */
    // Resolved through the same helpers the engine uses, so this reports what the
    // engine will actually see — including the host-safe alternative names.
    const aiStudio = {
      configured: isClaudeConfigured(),
      mode: isAiStudioMode() ? 'on' : 'off',
      // Where the settings came from, so a misplaced file is diagnosable without
      // signing in. A location, never a value.
      source: aiConfigFileUsed() ? 'file' : 'env',
    };

    /*
     * How the week-building jobs are actually going.
     *
     * A week that never appears is invisible from outside, and the overall
     * pending count cannot tell "no work was ever queued" from "seven jobs
     * failed" — which need opposite fixes. Counts by status, and nothing else:
     * no ids, no payloads, no messages.
     */
    if (db.ok) {
      try {
        aiStudio.jobs = await jobStatusCounts(JOB_TYPES.AI_STUDIO_POST);
        // Counts alone say everything is failing and nothing about why.
        if (aiStudio.jobs?.failed) aiStudio.lastFailure = await lastJobFailure(JOB_TYPES.AI_STUDIO_POST);
      } catch {
        aiStudio.jobs = null;
      }
    }

    /*
     * Whether THIS process is running the jobs, and how its last cycle went.
     * "disabled" is the honest answer on a host with a separate worker: it says
     * this process is not responsible, so a growing pending count above means
     * the external worker is down rather than that this one is idle.
     *
     * Timestamps, counters and an error CATEGORY only — never a job payload, a
     * user id, a storage path or an error message.
     */
    const background = backgroundStatus();

    res.status(healthy ? 200 : 503).json({
      success: true,
      data: {
        application: APP_NAME,
        status: healthy ? 'ok' : 'degraded',
        version: APP_VERSION,
        timestampUtc: nowIso(),
        database: { connected: db.ok },
        scheduler: { enabled: config.scheduler.enabled },
        worker,
        publishing,
        aiStudio,
        background,
      },
      requestId: req.id ?? null,
    });
  }),
);

export default router;
