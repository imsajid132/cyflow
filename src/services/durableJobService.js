/**
 * The durable job runtime: claim one job, run its registered handler under a
 * heartbeated lease, then decide completed / retry-with-backoff / failed from the
 * outcome. Generic — it knows nothing about automations; the automation handlers
 * are injected as a { jobType -> async (job) => void } registry.
 *
 * Retry policy:
 *   - a handler that returns normally  -> completed
 *   - a handler that throws a PERMANENT error (bad credential, disconnected
 *     account, invalid config) -> failed immediately, no more provider calls
 *   - a handler that throws a TRANSIENT error (timeout, provider blip) -> retried
 *     with capped exponential backoff + jitter, until max_attempts, then failed
 *
 * An unclassified throw is treated as transient (so a blip self-heals) but still
 * capped by max_attempts, so a real bug fails instead of looping forever.
 */

import { JOB_ERROR_CATEGORY } from '../config/constants.js';
import { addSecondsUtc } from '../utils/time.js';
import * as defaultJobs from '../repositories/backgroundJobRepository.js';

/** A job failure the worker can classify. Carries a SAFE, user-free reason. */
export class JobError extends Error {
  constructor(message, { category = JOB_ERROR_CATEGORY.TRANSIENT } = {}) {
    super(message);
    this.name = 'JobError';
    this.jobCategory = category;
  }
}
export class TransientJobError extends JobError {
  constructor(message) { super(message, { category: JOB_ERROR_CATEGORY.TRANSIENT }); this.name = 'TransientJobError'; }
}
export class PermanentJobError extends JobError {
  constructor(message) { super(message, { category: JOB_ERROR_CATEGORY.PERMANENT }); this.name = 'PermanentJobError'; }
}

/** Classify any thrown value. Explicit category wins; unknown -> transient. */
export function classifyError(err) {
  if (err && err.jobCategory === JOB_ERROR_CATEGORY.PERMANENT) return JOB_ERROR_CATEGORY.PERMANENT;
  if (err && err.jobCategory === JOB_ERROR_CATEGORY.TRANSIENT) return JOB_ERROR_CATEGORY.TRANSIENT;
  // Validation / configuration problems will not fix themselves on retry.
  if (err && (err.name === 'ValidationError' || err.name === 'ConfigurationError')) {
    return JOB_ERROR_CATEGORY.PERMANENT;
  }
  return JOB_ERROR_CATEGORY.TRANSIENT;
}

export function createDurableJobService({
  jobs = defaultJobs,
  handlers = {},
  logging = { record: async () => {} },
  now = () => new Date(),
  random = Math.random,
  options = {},
} = {}) {
  const leaseMs = Number.isFinite(options.leaseMs) ? options.leaseMs : 120000;
  const heartbeatMs = Number.isFinite(options.heartbeatMs) ? options.heartbeatMs : 30000;
  const baseRetrySeconds = Number.isFinite(options.baseRetrySeconds) ? options.baseRetrySeconds : 30;
  const maxRetrySeconds = Number.isFinite(options.maxRetrySeconds) ? options.maxRetrySeconds : 3600;
  const jitterRatio = Number.isFinite(options.jitterRatio) ? options.jitterRatio : 0.25;

  /**
   * Backoff for the Nth attempt: base * 2^(attempt-1), capped, then a positive
   * jitter of up to jitterRatio. Bounded to [backoff, backoff*(1+jitterRatio)].
   */
  function backoffSeconds(attempt) {
    const exp = baseRetrySeconds * (2 ** Math.max(0, attempt - 1));
    const capped = Math.min(maxRetrySeconds, exp);
    const jitter = capped * jitterRatio * random();
    return Math.round(capped + jitter);
  }

  async function runHandler(job) {
    const handler = handlers[job.jobType];
    if (!handler) throw new PermanentJobError(`No handler registered for job type ${job.jobType}`);
    // Heartbeat the lease while the handler works, so a long slow job (a real
    // OpenAI/HCTI round-trip) is not mistaken for a crashed worker.
    let timer = null;
    if (heartbeatMs > 0 && typeof setInterval === 'function') {
      timer = setInterval(() => {
        jobs.heartbeatJob({ jobId: job.id, workerId: job.lockedBy, leaseMs, now: now() }).catch(() => {});
      }, heartbeatMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
    try {
      await handler(job);
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  /**
   * Claim and run at most one job. Returns { ran:false } when the queue is empty,
   * or { ran:true, jobId, jobType, outcome } where outcome is
   * completed | retry_scheduled | failed.
   */
  async function runOne({ workerId, jobTypes = null } = {}) {
    const job = await jobs.claimNextJob({ workerId, leaseMs, now: now(), jobTypes });
    if (!job) return { ran: false };

    try {
      await runHandler(job);
      await jobs.completeJob({ jobId: job.id, workerId, now: now() });
      return { ran: true, jobId: job.id, jobType: job.jobType, outcome: 'completed' };
    } catch (err) {
      const category = classifyError(err);
      const message = safeMessage(err);
      const attemptsUsed = job.attemptCount; // already incremented by claim
      if (category === JOB_ERROR_CATEGORY.TRANSIENT && attemptsUsed < job.maxAttempts) {
        const delay = backoffSeconds(attemptsUsed);
        await jobs.retryJob({
          jobId: job.id, workerId, availableAt: addSecondsUtc(delay, now()),
          errorCategory: category, errorMessage: message,
        });
        return { ran: true, jobId: job.id, jobType: job.jobType, outcome: 'retry_scheduled', retryInSeconds: delay };
      }
      await jobs.failJob({ jobId: job.id, workerId, errorCategory: category, errorMessage: message, now: now() });
      await logging.record('job.failed', {
        userId: job.userId, level: 'warn', message: 'Background job failed',
        context: { jobType: job.jobType, category, automationId: job.automationId },
      }).catch(() => {});
      return { ran: true, jobId: job.id, jobType: job.jobType, outcome: 'failed', category };
    }
  }

  /** Drain the queue: run jobs until none remain or `max` have run. */
  async function drain({ workerId, jobTypes = null, max = 100 } = {}) {
    const outcomes = [];
    for (let i = 0; i < max; i += 1) {
      const res = await runOne({ workerId, jobTypes });
      if (!res.ran) break;
      outcomes.push(res);
    }
    return outcomes;
  }

  async function recoverStale({ limit = 50 } = {}) {
    const result = await jobs.recoverStaleJobs({ now: now(), limit });
    if (result.reclaimed || result.failed) {
      await logging.record('job.stale_recovered', {
        level: 'warn', message: 'Recovered stale jobs',
        context: { reclaimed: result.reclaimed, failed: result.failed },
      }).catch(() => {});
    }
    return result;
  }

  async function stats() {
    return jobs.jobStats({ now: now() });
  }

  return { runOne, drain, recoverStale, stats, backoffSeconds, _options: { leaseMs, heartbeatMs, baseRetrySeconds, maxRetrySeconds, jitterRatio } };
}

function safeMessage(err) {
  const msg = err && typeof err.message === 'string' ? err.message : 'Unknown job error';
  return msg.length > 500 ? msg.slice(0, 500) : msg;
}

export default { createDurableJobService, JobError, TransientJobError, PermanentJobError, classifyError };
