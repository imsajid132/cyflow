import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDurableJobService, TransientJobError, PermanentJobError, classifyError,
} from '../src/services/durableJobService.js';
import { JOB_ERROR_CATEGORY } from '../src/config/constants.js';
import { fromMysqlUtc } from '../src/utils/time.js';
import { createFakeBackgroundJobRepository } from './helpers/fakes.js';

const AT = new Date('2026-07-18T09:00:00Z');
const svc = (jobs, handlers, opts = {}) => createDurableJobService({
  jobs, handlers, now: () => AT, random: () => 0, options: { heartbeatMs: 0, ...opts },
});

test('enqueueJob is idempotent on the idempotency key', async () => {
  const jobs = createFakeBackgroundJobRepository();
  const a = await jobs.enqueueJob({ jobType: 'automation_refill', idempotencyKey: 'k1', automationId: '1' });
  const b = await jobs.enqueueJob({ jobType: 'automation_refill', idempotencyKey: 'k1', automationId: '1' });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.job.id, b.job.id);
  assert.equal(jobs._jobs.length, 1);
});

test('two workers competing for one job: exactly one executes the expensive op', async () => {
  const jobs = createFakeBackgroundJobRepository();
  await jobs.enqueueJob({ jobType: 'work', idempotencyKey: 'solo', automationId: '1' });
  let executions = 0;
  const handlers = { work: async () => { executions += 1; } };
  const workerA = svc(jobs, handlers);
  const workerB = svc(jobs, handlers);
  const [ra, rb] = await Promise.all([
    workerA.runOne({ workerId: 'A' }),
    workerB.runOne({ workerId: 'B' }),
  ]);
  assert.equal(executions, 1, 'the handler ran exactly once');
  const ran = [ra, rb].filter((r) => r.ran);
  const idle = [ra, rb].filter((r) => !r.ran);
  assert.equal(ran.length, 1, 'one worker ran the job');
  assert.equal(idle.length, 1, 'the other found nothing to claim');
});

test('a successful handler completes the job', async () => {
  const jobs = createFakeBackgroundJobRepository();
  await jobs.enqueueJob({ jobType: 'work', idempotencyKey: 'ok', automationId: '1' });
  const res = await svc(jobs, { work: async () => {} }).runOne({ workerId: 'W' });
  assert.equal(res.outcome, 'completed');
  assert.equal((await jobs.findJobByIdempotencyKey('ok')).status, 'completed');
});

test('a transient failure schedules a backed-off retry (not a permanent fail)', async () => {
  const jobs = createFakeBackgroundJobRepository();
  await jobs.enqueueJob({ jobType: 'work', idempotencyKey: 'retry', automationId: '1', maxAttempts: 5 });
  const res = await svc(jobs, { work: async () => { throw new TransientJobError('provider blip'); } })
    .runOne({ workerId: 'W' });
  assert.equal(res.outcome, 'retry_scheduled');
  const j = await jobs.findJobByIdempotencyKey('retry');
  assert.equal(j.status, 'retry_scheduled');
  assert.ok(fromMysqlUtc(j.availableAt) > AT, 'available_at moved into the future for backoff');
});

test('a permanent failure fails immediately with no retry', async () => {
  const jobs = createFakeBackgroundJobRepository();
  await jobs.enqueueJob({ jobType: 'work', idempotencyKey: 'perm', automationId: '1', maxAttempts: 5 });
  const res = await svc(jobs, { work: async () => { throw new PermanentJobError('missing OpenAI key'); } })
    .runOne({ workerId: 'W' });
  assert.equal(res.outcome, 'failed');
  assert.equal(res.category, JOB_ERROR_CATEGORY.PERMANENT);
  assert.equal((await jobs.findJobByIdempotencyKey('perm')).status, 'failed');
});

test('a transient failure at the attempt cap fails instead of looping forever', async () => {
  const jobs = createFakeBackgroundJobRepository();
  // maxAttempts 1: the claim increments attempt_count to 1, so it is already at cap.
  await jobs.enqueueJob({ jobType: 'work', idempotencyKey: 'capped', automationId: '1', maxAttempts: 1 });
  const res = await svc(jobs, { work: async () => { throw new TransientJobError('still failing'); } })
    .runOne({ workerId: 'W' });
  assert.equal(res.outcome, 'failed');
});

test('backoff is exponential, capped, and jittered within bounds', async () => {
  const jobs = createFakeBackgroundJobRepository();
  const base = createDurableJobService({ jobs, now: () => AT, random: () => 0, options: { baseRetrySeconds: 30, maxRetrySeconds: 3600, jitterRatio: 0.25, heartbeatMs: 0 } });
  assert.equal(base.backoffSeconds(1), 30); // 30 * 2^0
  assert.equal(base.backoffSeconds(2), 60); // 30 * 2^1
  assert.equal(base.backoffSeconds(3), 120);
  assert.equal(base.backoffSeconds(10), 3600); // capped
  // With random()->~1 jitter adds up to 25%.
  const jittered = createDurableJobService({ jobs, now: () => AT, random: () => 0.999, options: { baseRetrySeconds: 30, jitterRatio: 0.25, heartbeatMs: 0 } });
  const d = jittered.backoffSeconds(1);
  assert.ok(d >= 30 && d <= 30 * 1.25 + 1, `jittered backoff ${d} within [30, 37.5]`);
});

test('classifyError: explicit category wins, validation is permanent, unknown is transient', () => {
  assert.equal(classifyError(new PermanentJobError('x')), JOB_ERROR_CATEGORY.PERMANENT);
  assert.equal(classifyError(new TransientJobError('x')), JOB_ERROR_CATEGORY.TRANSIENT);
  const v = new Error('bad'); v.name = 'ValidationError';
  assert.equal(classifyError(v), JOB_ERROR_CATEGORY.PERMANENT);
  assert.equal(classifyError(new Error('who knows')), JOB_ERROR_CATEGORY.TRANSIENT);
});

test('a crashed worker (expired lease) is recovered without duplicating the job', async () => {
  const jobs = createFakeBackgroundJobRepository();
  await jobs.enqueueJob({ jobType: 'work', idempotencyKey: 'crash', automationId: '1', maxAttempts: 5 });
  // Claim but never complete — simulate a crash mid-run.
  const claimed = await jobs.claimNextJob({ workerId: 'dead', leaseMs: 60000, now: AT });
  assert.equal(claimed.status, 'running');
  // Before the lease expires, nobody else can claim it.
  assert.equal(await jobs.claimNextJob({ workerId: 'other', now: new Date(AT.getTime() + 30000) }), null);
  // After the lease expires, recovery reclaims it (same row, same key).
  const later = new Date(AT.getTime() + 120000);
  const rec = await jobs.recoverStaleJobs({ now: later, limit: 10 });
  assert.equal(rec.reclaimed, 1);
  const reclaimed = await jobs.claimNextJob({ workerId: 'fresh', now: later });
  assert.equal(reclaimed.idempotencyKey, 'crash');
  assert.equal(jobs._jobs.length, 1, 'no duplicate job was created');
  assert.equal(reclaimed.attemptCount, 2, 'attempt count carried across the recovery');
});

test('drain runs all runnable jobs then stops', async () => {
  const jobs = createFakeBackgroundJobRepository();
  for (const k of ['a', 'b', 'c']) await jobs.enqueueJob({ jobType: 'work', idempotencyKey: k, automationId: '1' });
  const outcomes = await svc(jobs, { work: async () => {} }).drain({ workerId: 'W', max: 10 });
  assert.equal(outcomes.length, 3);
  assert.ok(outcomes.every((o) => o.outcome === 'completed'));
});

test('a named lease is exclusive until it expires', async () => {
  const jobs = createFakeBackgroundJobRepository();
  assert.equal(await jobs.acquireLease({ lockName: 'tick', owner: 'A', ttlMs: 60000, now: AT }), true);
  assert.equal(await jobs.acquireLease({ lockName: 'tick', owner: 'B', ttlMs: 60000, now: AT }), false);
  const later = new Date(AT.getTime() + 120000);
  assert.equal(await jobs.acquireLease({ lockName: 'tick', owner: 'B', ttlMs: 60000, now: later }), true);
});
