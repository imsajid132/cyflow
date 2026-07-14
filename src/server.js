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
import { checkHealth, closePool } from './db/pool.js';

let server = null;
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
  const app = createApp();
  server = http.createServer(app);

  server.listen(config.port, '0.0.0.0', () => {
    log(`Listening on 0.0.0.0:${config.port}`);
    log(`Scheduler ${config.scheduler.enabled ? 'enabled' : 'disabled'}`);
  });

  server.on('error', (err) => {
    log(`HTTP server error: ${err.code || err.name}`);
    process.exit(1);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Received ${signal}, shutting down gracefully...`);

  const forceTimer = setTimeout(() => {
    log('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      log('HTTP server closed');
    }
    await closePool();
    log('Database pool closed');
    clearTimeout(forceTimer);
    process.exit(0);
  } catch (err) {
    log(`Error during shutdown: ${err?.code || err?.name || 'unknown'}`);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  // Log a sanitized reason; do not print full objects that may hold secrets.
  const detail = reason instanceof Error ? reason.message : 'non-error rejection';
  log(`Unhandled promise rejection: ${detail}`);
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err?.message || 'unknown'}`);
  // Exit after attempting a graceful close — state may be corrupt.
  shutdown('uncaughtException');
});

start().catch((err) => {
  log(`Fatal startup error: ${err?.message || 'unknown'}`);
  process.exit(1);
});
