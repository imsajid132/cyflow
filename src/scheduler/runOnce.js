/**
 * `npm run scheduler:once` entrypoint.
 *
 * Phase 4 status: content generation + scheduling exist, but PROVIDER PUBLISHING
 * IS NOT IMPLEMENTED. This one-shot run only REPORTS what is queued — it never
 * publishes, never moves queued posts to published, never increments publish
 * attempts, and never calls Meta/Instagram/Threads APIs. Read-only.
 */

import { config } from '../config/env.js';
import { getPool, checkHealth, closePool } from '../db/pool.js';

async function main() {
  console.log(`[scheduler] one-shot run in "${config.env}" mode`);
  console.log(`[scheduler] SCHEDULER_ENABLED=${config.scheduler.enabled}`);

  const db = await checkHealth();
  if (!db.ok) {
    console.log(`[scheduler] database unreachable (${db.error}) — nothing to report`);
    await closePool();
    process.exit(0);
    return;
  }

  // Read-only counts. No writes, no publishing.
  let queued = 0;
  let dueNow = 0;
  try {
    const [q] = await getPool().execute("SELECT COUNT(*) AS n FROM scheduled_posts WHERE status = 'queued'");
    queued = Number(q[0]?.n ?? 0);
    const [d] = await getPool().execute(
      "SELECT COUNT(*) AS n FROM scheduled_posts WHERE status = 'queued' AND scheduled_at_utc IS NOT NULL AND scheduled_at_utc <= UTC_TIMESTAMP()",
    );
    dueNow = Number(d[0]?.n ?? 0);
  } catch (err) {
    console.log(`[scheduler] could not read queue (${err.code || 'error'})`);
    await closePool();
    process.exit(0);
    return;
  }

  console.log(`[scheduler] queued posts: ${queued}`);
  console.log(`[scheduler] posts ready for a future publishing phase (due now): ${dueNow}`);
  console.log('[scheduler] posts published: 0 (provider publishing is not implemented yet)');

  await closePool();
  process.exit(0);
}

main().catch(async (err) => {
  console.log(`[scheduler] fatal error: ${err?.message || 'unknown'}`);
  await closePool().catch(() => {});
  process.exit(1);
});
