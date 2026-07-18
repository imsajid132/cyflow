/**
 * Server entrypoint.
 *
 * Validates configuration (by importing the validated config), verifies the
 * database connection, starts the HTTP server on 0.0.0.0, and installs graceful
 * shutdown + last-resort process guards. Secrets are never printed.
 */

import http from 'node:http';

import { config } from './config/env.js';
import { createApp } from './app.js';
import { checkHealth } from './db/pool.js';
import { gracefulClose } from './shutdown.js';
import { buildContainer } from './container.js';
import { createBackgroundRunner } from './jobs/backgroundRunner.js';
import { drainOnce } from './workers/workerRuntime.js';
import { setBackgroundRunner } from './jobs/backgroundStatus.js';

let server = null;
let app = null;
let backgroundRunner = null;
let shuttingDown = false;

function log(message) {
  // Minimal, secret-free structured logging for lifecycle events.
  console.log(`[server] ${message}`);
}

async function start() {
  // 1) Configuration is validated at import time (config/env.js throws on error).
  log(`Starting Cyflow Social in "${config.env}" mode`);

  // 2) Verify the database connection before accepting traffic.
  const db = await checkHealth();
  if (!db.ok) {
    // Surface a sanitized reason (error code only) and exit.
    log(`Database connection failed (${db.error}). Refusing to start.`);
    process.exit(1);
    return;
  }
  log('Database connection OK');

  // 3) Build the app and listen.
  app = createApp();
  server = http.createServer(app);

  server.listen(config.port, '0.0.0.0', () => {
    log(`Listening on 0.0.0.0:${config.port}`);
    log(`Scheduler ${config.scheduler.enabled ? 'enabled' : 'disabled'}`);
  });

  /*
   * 4) Background jobs, only on a host that cannot run separate processes.
   *
   * Started AFTER the database check above, because a runner pointed at a dead
   * pool just logs a failure every minute. Started after listen() so a slow
   * first tick cannot delay the port opening and make the host think the deploy
   * failed.
   */
  if (config.worker.singleProcessJobs) {
    const container = buildContainer();
    backgroundRunner = createBackgroundRunner({ container, config });
    setBackgroundRunner(backgroundRunner);
    // Not awaited: the first tick runs immediately but must not block startup.
    backgroundRunner.start({ drainOnce, intervalMs: 60_000 }).catch((err) => {
      log(`Background runner failed to start: ${err?.code || 'unknown'}`);
    });
  }

  server.on('error', (err) => {
    log(`HTTP server error: ${err.code || err.name}`);
    process.exit(1);
  });
}

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Received ${signal}, shutting down gracefully...`);

  const forceTimer = setTimeout(() => {
    log('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  try {
    /*
     * The background runner stops FIRST and is awaited, so no job is still
     * mid-write when the pool closes underneath it. Ordered release after that:
     * HTTP server → session store → database pool.
     */
    if (backgroundRunner) {
      await backgroundRunner.stop();
      log('Background runner stopped');
    }
    await gracefulClose({ server, app });
    log('HTTP server, session store, and database pool closed');
    clearTimeout(forceTimer);
    process.exit(exitCode);
  } catch (err) {
    log(`Error during shutdown: ${err?.code || err?.name || 'unknown'}`);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));

process.on('unhandledRejection', (reason) => {
  // Log a sanitized reason; do not print full objects that may hold secrets.
  const detail = reason instanceof Error ? reason.message : 'non-error rejection';
  log(`Unhandled promise rejection: ${detail}`);
  // Corrupt/unknown state — exit non-zero after attempting a clean close.
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err?.message || 'unknown'}`);
  // Corrupt/unknown state — exit non-zero after attempting a clean close.
  shutdown('uncaughtException', 1);
});

start().catch((err) => {
  log(`Fatal startup error: ${err?.message || 'unknown'}`);
  process.exit(1);
});
