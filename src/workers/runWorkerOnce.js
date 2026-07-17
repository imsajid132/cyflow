/**
 * `npm run worker:once` — recover stale jobs, drain the queue, and exit.
 * Suitable for tests, cron-style processing, and manual verification. Prepares
 * content only; it never calls a provider publishing API.
 */

import { checkHealth, closePool } from '../db/pool.js';
import { buildContainer } from '../container.js';
import { drainOnce } from './workerRuntime.js';

const workerId = `once-${process.pid}`;

async function main() {
  const db = await checkHealth();
  if (!db.ok) {
    console.log(`[worker:once] database unreachable (${db.error}) — nothing to do`);
    await closePool();
    process.exit(0);
    return;
  }
  const container = buildContainer();
  const outcomes = await drainOnce({ jobService: container.durableJobService, workerId, max: 1000 });
  const counts = outcomes.reduce((m, o) => { m[o.outcome] = (m[o.outcome] || 0) + 1; return m; }, {});
  console.log(`[worker:once] processed ${outcomes.length} jobs ${JSON.stringify(counts)}`);
  await closePool();
  process.exit(0);
}

main().catch(async (err) => {
  console.log(`[worker:once] fatal error: ${err?.message || 'unknown'}`);
  await closePool().catch(() => {});
  process.exit(1);
});
