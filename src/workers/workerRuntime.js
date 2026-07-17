/**
 * The worker loop, extracted from the process entry so it is unit-testable
 * (graceful stop, idle backoff, periodic stale recovery) without spawning a
 * process. The entry points (worker.js / runWorkerOnce.js) are thin wrappers.
 *
 * The database is the source of truth; this loop only claims and runs jobs. It
 * never busy-loops: when the queue is empty it sleeps for the poll interval.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Drain the queue once and return the outcomes. Suitable for `worker:once`,
 * tests, and manual verification.
 */
export async function drainOnce({ jobService, workerId, max = 500 }) {
  await jobService.recoverStale({ limit: 100 }).catch(() => {});
  return jobService.drain({ workerId, max });
}

/**
 * Run the continuous worker loop until `shouldStop()` returns true. Claims up to
 * `concurrency` jobs per tick; when nothing ran, backs off for `pollMs`. Recovers
 * stale jobs every `recoverEveryMs`. Returns aggregate counters.
 */
export async function runLoop({
  jobService, workerId, concurrency = 2, pollMs = 5000, recoverEveryMs = 60000,
  shouldStop = () => false, sleepImpl = sleep, nowMs = () => Date.now(), onIdle = null,
}) {
  let processed = 0;
  let idleTicks = 0;
  let lastRecovery = 0;
  while (!shouldStop()) {
    if (nowMs() - lastRecovery >= recoverEveryMs) {
      // eslint-disable-next-line no-await-in-loop
      await jobService.recoverStale({ limit: 50 }).catch(() => {});
      lastRecovery = nowMs();
    }
    // eslint-disable-next-line no-await-in-loop
    const batch = await Promise.all(
      Array.from({ length: concurrency }, () => jobService.runOne({ workerId }).catch(() => ({ ran: false }))),
    );
    const ran = batch.filter((r) => r && r.ran).length;
    processed += ran;
    if (ran === 0) {
      idleTicks += 1;
      if (onIdle) onIdle(idleTicks);
      if (shouldStop()) break;
      // eslint-disable-next-line no-await-in-loop
      await sleepImpl(pollMs);
    } else {
      idleTicks = 0;
    }
  }
  return { processed, idleTicks };
}

export default { drainOnce, runLoop };
