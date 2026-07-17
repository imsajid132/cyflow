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
import { APP_NAME } from '../config/constants.js';
import { jobStats } from '../repositories/backgroundJobRepository.js';

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
      },
      requestId: req.id ?? null,
    });
  }),
);

export default router;
