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

    // 2) Enqueue publish jobs for due, approved, queued targets. Skipped entirely
    //    when ENABLE_LIVE_PROVIDER_PUBLISHING is off (no provider calls at all).
    const publishes = await container.publishingService.enqueueDuePublishTargets({ limit: config.scheduler.batchSize * 5 });
    if (publishes.skipped) {
      console.log(`[scheduler] publishing: ${publishes.skipped} (ENABLE_LIVE_PROVIDER_PUBLISHING=false)`);
    } else {
      console.log(`[scheduler] due publish targets: ${publishes.due}, publish jobs enqueued: ${publishes.enqueued}`);
    }

    // 3) Reclaim jobs abandoned by a crashed worker.
    const recovered = await container.durableJobService.recoverStale({ limit: 100 });
    if (recovered.reclaimed || recovered.failed) {
      console.log(`[scheduler] recovered stale jobs: reclaimed=${recovered.reclaimed}, failed=${recovered.failed}`);
    }

    // 4) Report the job queue (read-only).
    const stats = await container.durableJobService.stats();
    console.log(`[scheduler] jobs pending: ${stats.pending}, running: ${stats.running}, stale: ${stats.stale}`);
    console.log(`[scheduler] live publishing: ${config.publishing.liveEnabled ? 'ENABLED' : 'disabled (default)'}`);
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
