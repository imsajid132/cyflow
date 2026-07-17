/**
 * `npm run scheduler:once` — the automation scheduler tick.
 *
 * Finds active automations whose rolling buffer is due and enqueues one
 * idempotent refill job each, recovers any stale jobs, and reports the queue.
 * It PREPARES ONLY: it never publishes, never moves queued posts to published,
 * and never calls a provider API. Run it from cron (e.g. every few minutes); the
 * separate `worker` process is what actually executes the enqueued jobs.
 */

import { config } from '../config/env.js';
import { checkHealth, closePool } from '../db/pool.js';
import { buildContainer } from '../container.js';

async function main() {
  console.log(`[scheduler] one-shot tick in "${config.env}" mode`);

  const db = await checkHealth();
  if (!db.ok) {
    console.log(`[scheduler] database unreachable (${db.error}) — nothing to do`);
    await closePool();
    process.exit(0);
    return;
  }

  const container = buildContainer();
  try {
    // 1) Enqueue refill jobs for due automations (idempotent; a duplicate tick
    //    enqueues the same job once).
    const refills = await container.automationService.enqueueDueRefills({ limit: config.scheduler.batchSize * 5 });
    console.log(`[scheduler] due automations: ${refills.due}, refill jobs enqueued: ${refills.enqueued}`);

    // 2) Reclaim jobs abandoned by a crashed worker.
    const recovered = await container.durableJobService.recoverStale({ limit: 100 });
    if (recovered.reclaimed || recovered.failed) {
      console.log(`[scheduler] recovered stale jobs: reclaimed=${recovered.reclaimed}, failed=${recovered.failed}`);
    }

    // 3) Report the job queue (read-only). No publishing happens anywhere.
    const stats = await container.durableJobService.stats();
    console.log(`[scheduler] jobs pending: ${stats.pending}, running: ${stats.running}, stale: ${stats.stale}`);
    console.log('[scheduler] posts published: 0 (provider publishing is not implemented yet — that is D2)');
  } catch (err) {
    console.log(`[scheduler] tick error: ${err?.code || err?.message || 'unknown'}`);
  }

  await closePool();
  process.exit(0);
}

main().catch(async (err) => {
  console.log(`[scheduler] fatal error: ${err?.message || 'unknown'}`);
  await closePool().catch(() => {});
  process.exit(1);
});
