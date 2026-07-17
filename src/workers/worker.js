/**
 * `npm run worker` — the long-running background worker.
 *
 * Continuously claims and runs durable jobs (automation refills + slot
 * generation), recovers stale jobs periodically, backs off when idle, and shuts
 * down gracefully on SIGTERM/SIGINT (stops claiming, lets the in-flight batch
 * finish, closes the pool). It PREPARES ONLY — no provider publishing (that is
 * D2). This process must be kept alive by the host (see the D1 ops runbook);
 * the web server does not run it.
 */

import os from 'node:os';

import { config } from '../config/env.js';
import { checkHealth, closePool } from '../db/pool.js';
import { buildContainer } from '../container.js';
import { runLoop } from './workerRuntime.js';

const workerId = `worker-${os.hostname()}-${process.pid}`;
let stopping = false;

function log(msg) { console.log(`[worker] ${msg}`); }

async function main() {
  log(`starting as ${workerId} in "${config.env}" mode`);
  const db = await checkHealth();
  if (!db.ok) {
    log(`database connection failed (${db.error}). Refusing to start.`);
    process.exit(1);
    return;
  }
  const container = buildContainer();

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    log(`received ${signal}, finishing the current batch then exiting...`);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  const result = await runLoop({
    jobService: container.durableJobService,
    workerId,
    concurrency: config.worker.concurrency,
    pollMs: config.worker.pollSeconds * 1000,
    recoverEveryMs: 60000,
    shouldStop: () => stopping,
  });
  log(`processed ${result.processed} jobs; shutting down`);
  await closePool().catch(() => {});
  process.exit(0);
}

main().catch(async (err) => {
  log(`fatal error: ${err?.message || 'unknown'}`);
  await closePool().catch(() => {});
  process.exit(1);
});
