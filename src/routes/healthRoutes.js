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

// Application version, read once (kept minimal — no other package.json exposure).
const APP_VERSION = process.env.npm_package_version || '1.0.0';

const router = Router();

router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const db = await checkHealth();
    const healthy = db.ok;

    res.status(healthy ? 200 : 503).json({
      success: true,
      data: {
        application: APP_NAME,
        status: healthy ? 'ok' : 'degraded',
        version: APP_VERSION,
        timestampUtc: nowIso(),
        database: { connected: db.ok },
        scheduler: { enabled: config.scheduler.enabled },
      },
      requestId: req.id ?? null,
    });
  }),
);

export default router;
