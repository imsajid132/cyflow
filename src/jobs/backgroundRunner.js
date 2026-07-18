/**
 * Single-process background runner.
 *
 * Managed Node hosts run exactly one process from `npm start`: no cron, no
 * second process, no SSH-launched worker that survives. On such a host the
 * durable job queue never advances — posts sit queued, automations never refill,
 * exports never build and deletions never complete, while the app looks
 * perfectly healthy.
 *
 * This runs the scheduler and worker responsibilities on a timer inside the web
 * process. It contains NO scheduling, publishing, automation, retry,
 * reconciliation, lease or job-processing logic of its own: every operation is a
 * call into the same services `src/scheduler/runOnce.js` and
 * `src/workers/worker.js` drive. Those entry points remain the correct choice on
 * any host that can run separate processes.
 *
 * Two independent single-flight guards (one for the scheduler tick, one for the
 * worker drain) stop this process from overlapping itself. They are deliberately
 * NOT the cross-process safety mechanism — see `start()`.
 */

/**
 * The named lock that serialises the scheduler tick across instances.
 *
 * A managed host may keep several web instances alive at once. Observed on
 * staging: two instances, both with single-process jobs on, each running a
 * scheduler tick every minute about three seconds apart. Nothing was corrupted
 * — job claims are leased and publishing is keyed by idempotency — but every
 * sweep ran twice, which doubles database load and makes the logs untrustworthy
 * as a record of what actually happened.
 */
export const SCHEDULER_LOCK = 'hostinger-single-process-scheduler';

/**
 * Lease lifetime, in seconds.
 *
 * Longer than the 60s tick interval, so the holder still owns it when it comes
 * back to renew and a follower three seconds behind is refused. Short enough
 * that a crashed leader stops blocking scheduling within about one and a half
 * cycles rather than indefinitely — the lease expires on its own; nothing has
 * to notice the crash.
 */
export const SCHEDULER_LEASE_SECONDS = 90;

import os from 'node:os';

/** Lifecycle log lines. Never carries post content, tokens or provider bodies. */
const defaultLogger = (message) => console.log(`[jobs] ${message}`);

/**
 * A safe error category. Errors from a job can carry a provider response body or
 * a connection string in their message, so only a coarse classification and the
 * error's own code ever escape — never the message text.
 */
export function errorCategory(err) {
  const code = err?.code;
  if (typeof code === 'string' && code) return code;
  if (err?.name === 'AbortError') return 'timeout';
  return 'unknown_error';
}

/**
 * @param {object} deps
 * @param {object} deps.container    built container (services already wired)
 * @param {object} deps.config       validated config
 * @param {Function} [deps.logger]
 * @param {Function} [deps.setIntervalFn] injectable for tests
 * @param {Function} [deps.clearIntervalFn]
 * @param {Function} [deps.now]      injectable clock, returns an ISO string
 */
export function createBackgroundRunner({
  container,
  config,
  logger = defaultLogger,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => new Date().toISOString(),
  // Defaults to the container's repository; injectable so tests can run two
  // competing runners against one shared lease store.
  leases = container?.backgroundJobRepository,
  leaseSeconds = SCHEDULER_LEASE_SECONDS,
}) {
  /*
   * Identity must be unique per PROCESS, not per host. During a redeploy a
   * managed host briefly runs the old and new instances together; if both used
   * the same worker id, each would see the other's claimed jobs as its own and
   * the lease would stop protecting anything.
   */
  const workerId = `web-${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  const state = {
    mode: 'hostinger_single_process',
    workerId,
    running: false,
    stopping: false,
    schedulerStartedAt: null,
    schedulerCompletedAt: null,
    schedulerRunning: false,
    workerStartedAt: null,
    workerCompletedAt: null,
    workerRunning: false,
    ticks: 0,
    drains: 0,
    lastErrorCategory: null,
    lastErrorAt: null,
    schedulerLeader: false,
    lastLeaseAcquiredAt: null,
    skippedTicks: 0,
  };

  let timer = null;
  // Resolves when no bounded operation is in flight. Shutdown awaits it so the
  // database pool is never closed underneath a running job.
  let inFlight = Promise.resolve();

  const track = (promise) => {
    inFlight = inFlight.then(() => promise).catch(() => {});
    return promise;
  };

  function recordError(scope, err) {
    state.lastErrorCategory = `${scope}:${errorCategory(err)}`;
    state.lastErrorAt = now();
    // Category only. An error message can contain a provider response body.
    logger(`background operation failed safely (${state.lastErrorCategory})`);
  }

  /**
   * One scheduler tick: exactly what `scheduler/runOnce.js` does, minus the
   * process teardown. Each step is independently guarded so one failing step
   * cannot stop the others.
   */
  async function schedulerTick() {
    if (state.schedulerRunning || state.stopping) return { skipped: true };
    state.schedulerRunning = true;
    state.schedulerStartedAt = now();
    const summary = { refills: 0, publishes: 0, recovered: 0, skippedPublishing: false };
    try {
      /*
       * Cross-instance gate. The in-process guard above only stops THIS process
       * overlapping itself; a managed host runs several instances, and on
       * staging two of them ran the same sweep a few seconds apart every
       * minute. The lease is the thing that makes the tick singular, and it is
       * taken in the database against database time, so instances cannot
       * disagree about whether it has expired.
       *
       * The lease is deliberately NOT released after a successful tick: holding
       * it across the interval is what refuses the follower three seconds
       * later. The leader renews it on its own next tick, and it expires by
       * itself if the leader dies.
       */
      if (leases?.acquireLeaseDbTime) {
        const acquired = await leases.acquireLeaseDbTime({
          lockName: SCHEDULER_LOCK,
          owner: workerId,
          ttlSeconds: leaseSeconds,
        });
        if (!acquired) {
          const wasLeader = state.schedulerLeader;
          state.schedulerLeader = false;
          state.skippedTicks += 1;
          // Once on the transition, then hourly. A follower would otherwise
          // print an identical line every minute for the life of the instance.
          if (wasLeader || state.skippedTicks === 1 || state.skippedTicks % 60 === 0) {
            logger('scheduler tick skipped (lease held)');
          }
          return { skipped: true, reason: 'lease_held' };
        }
        state.schedulerLeader = true;
        state.lastLeaseAcquiredAt = now();
      }

      const limit = config.scheduler.batchSize * 5;

      const refills = await container.automationService.enqueueDueRefills({ limit });
      summary.refills = refills?.enqueued || 0;

      // The publishing service itself refuses when live publishing is off and
      // returns { skipped: 'live_publishing_disabled' }. That guard is NOT
      // reimplemented here: one switch, in one place.
      const publishes = await container.publishingService.enqueueDuePublishTargets({ limit });
      if (publishes?.skipped) summary.skippedPublishing = true;
      else summary.publishes = publishes?.enqueued || 0;

      // Jobs whose owner died mid-run (a redeploy, a crash) become claimable
      // again once their lease expires.
      const recovered = await container.durableJobService.recoverStale({ limit: 100 });
      summary.recovered = recovered?.reclaimed || 0;

      state.ticks += 1;
      state.schedulerCompletedAt = now();
      logger(`scheduler tick completed (refills=${summary.refills}, publish=${summary.skippedPublishing ? 'disabled' : summary.publishes}, recovered=${summary.recovered})`);
      return summary;
    } catch (err) {
      recordError('scheduler', err);
      return { error: true };
    } finally {
      state.schedulerRunning = false;
    }
  }

  /** One bounded worker drain, through the shared workerRuntime. */
  async function workerDrain(drainOnce) {
    if (state.workerRunning || state.stopping) return { skipped: true };
    state.workerRunning = true;
    state.workerStartedAt = now();
    try {
      /*
       * Bounded. An unbounded drain inside the web process would hold the
       * request-serving event loop for as long as the queue is long; a modest
       * cap keeps each pass short and lets the next tick pick up the rest.
       */
      const outcomes = await drainOnce({
        jobService: container.durableJobService,
        workerId,
        max: config.worker.concurrency * 10,
      });
      const processed = Array.isArray(outcomes) ? outcomes.length : (outcomes?.processed || 0);
      state.drains += 1;
      state.workerCompletedAt = now();
      /*
       * Always log the FIRST drain, then only when work was actually done.
       * An idle queue would otherwise print a line every 60 seconds forever,
       * but an operator watching a redeploy needs one positive confirmation
       * that the drain is running at all — silence and "not running" look the
       * same in a log.
       */
      if (processed > 0 || state.drains === 1) {
        logger(`worker drain completed (${processed} job(s))`);
      }
      return { processed };
    } catch (err) {
      recordError('worker', err);
      return { error: true };
    } finally {
      state.workerRunning = false;
    }
  }

  return {
    workerId,

    /**
     * Begin ticking. The caller must have confirmed the database is reachable:
     * a runner that starts against a dead pool just logs failures every minute.
     */
    async start({ drainOnce, intervalMs = 60_000, immediate = true } = {}) {
      if (state.running) return state;
      state.running = true;
      state.stopping = false;
      logger('Hostinger single-process mode enabled');
      /*
       * The two in-process guards above prevent this instance overlapping
       * ITSELF. They are useless across processes, and during a redeploy the
       * host runs two instances at once. Cross-instance safety comes from the
       * database: a job is claimed under a lease, and publishing is keyed by an
       * idempotency key, so a second instance cannot claim a held job or
       * re-send a post that is already in flight.
       */
      const cycle = async () => {
        if (state.stopping) return;
        await track(schedulerTick());
        if (state.stopping) return;
        await track(workerDrain(drainOnce));
      };

      if (immediate) await cycle();

      timer = setIntervalFn(() => { cycle().catch(() => {}); }, intervalMs);
      // Never hold the process open on this timer alone.
      if (typeof timer?.unref === 'function') timer.unref();
      return state;
    },

    /**
     * Stop scheduling new work and wait for any bounded operation already in
     * flight. Called BEFORE the database pool closes, so a running job never
     * loses its connection mid-write.
     */
    async stop() {
      if (!state.running) return;
      state.stopping = true;
      logger('stopping background runner');
      if (timer) { clearIntervalFn(timer); timer = null; }
      await inFlight.catch(() => {});
      /*
       * Hand the lease back on a clean shutdown so the surviving instance takes
       * over on its next tick instead of waiting out the TTL. Best-effort: if
       * the release fails the lease simply expires, which is the same outcome
       * as a crash and is already safe.
       */
      if (state.schedulerLeader && leases?.releaseLease) {
        try {
          await leases.releaseLease({ lockName: SCHEDULER_LOCK, owner: workerId });
          state.schedulerLeader = false;
        } catch { /* the TTL covers this */ }
      }
      state.running = false;
    },

    /** Non-secret operational snapshot for the health endpoint. */
    status() {
      return {
        backgroundMode: 'hostinger_single_process',
        running: state.running,
        schedulerRunning: state.schedulerRunning,
        schedulerStartedAt: state.schedulerStartedAt,
        schedulerCompletedAt: state.schedulerCompletedAt,
        workerRunning: state.workerRunning,
        workerStartedAt: state.workerStartedAt,
        workerCompletedAt: state.workerCompletedAt,
        ticks: state.ticks,
        drains: state.drains,
        lastErrorCategory: state.lastErrorCategory,
        lastErrorAt: state.lastErrorAt,
        /*
         * Which instance is doing the scheduling, and when it last renewed.
         * The lease OWNER is not reported: it embeds a hostname and a pid,
         * which belong in a log, not in a public health response.
         */
        schedulerLeader: state.schedulerLeader,
        lastLeaseAcquiredAt: state.lastLeaseAcquiredAt,
      };
    },

    // Exposed for tests; not part of the operational surface.
    _schedulerTick: schedulerTick,
    _workerDrain: workerDrain,
  };
}

/** The status shape reported when the runner is not enabled. */
export const DISABLED_STATUS = Object.freeze({
  backgroundMode: 'disabled',
  running: false,
});

export default { createBackgroundRunner, errorCategory, DISABLED_STATUS };
