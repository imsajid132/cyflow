// Cross-instance scheduler serialisation.
//
// Observed on staging: two managed web instances, both with single-process jobs
// enabled, each running a scheduler tick every minute about three seconds apart.
// Nothing was corrupted — job claims are leased and publishing is keyed by an
// idempotency key — but every sweep ran twice, which doubles database load and
// makes the logs untrustworthy as a record of what actually happened.
//
// The in-process guard cannot help here by construction: the two ticks are in
// different processes. Only the database can decide which one leads.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createBackgroundRunner, SCHEDULER_LOCK, SCHEDULER_LEASE_SECONDS,
} from '../src/jobs/backgroundRunner.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const baseConfig = { scheduler: { batchSize: 10 }, worker: { concurrency: 2 } };

/** A container whose services record what the runner asked them to do. */
function fakeContainer(overrides = {}) {
  const calls = { refills: 0, publishes: 0, recover: 0, providerCalls: 0 };
  return {
    calls,
    automationService: {
      async enqueueDueRefills() { calls.refills += 1; return { due: 1, enqueued: 1 }; },
    },
    publishingService: {
      async enqueueDuePublishTargets() {
        calls.publishes += 1;
        if (!overrides.liveEnabled) return { skipped: 'live_publishing_disabled', enqueued: 0 };
        calls.providerCalls += 1;
        return { due: 1, enqueued: 1 };
      },
    },
    durableJobService: {
      async recoverStale() { calls.recover += 1; return { reclaimed: 0, failed: 0 }; },
    },
  };
}

/**
 * A shared lease store standing in for the `worker_leases` row.
 *
 * One clock serves every caller, exactly as one MySQL serves both web
 * instances — which is the whole point of judging expiry with database time
 * rather than with each instance's own clock.
 */
function sharedLeaseStore(clock = { ms: 0 }) {
  const leases = new Map();
  return {
    clock,
    async acquireLeaseDbTime({ lockName, owner, ttlSeconds }) {
      const held = leases.get(lockName);
      if (held && held.owner !== owner && held.expiresMs > clock.ms) return false;
      leases.set(lockName, { owner, expiresMs: clock.ms + ttlSeconds * 1000 });
      return true;
    },
    async releaseLease({ lockName, owner }) {
      const held = leases.get(lockName);
      if (held && held.owner === owner) { leases.delete(lockName); return true; }
      return false;
    },
  };
}

const instance = (leases, container, opts = {}) => createBackgroundRunner({
  container,
  config: baseConfig,
  logger: opts.logger || (() => {}),
  leases,
  leaseSeconds: SCHEDULER_LEASE_SECONDS,
  ...opts,
});

test('two instances ticking concurrently produce exactly one scheduler sweep', async () => {
  const leases = sharedLeaseStore();
  const a = fakeContainer();
  const b = fakeContainer();

  // Genuinely concurrent, not one and then the other.
  const [resA, resB] = await Promise.all([
    instance(leases, a)._schedulerTick(),
    instance(leases, b)._schedulerTick(),
  ]);

  assert.equal(a.calls.refills + b.calls.refills, 1, 'exactly one instance may run the sweep');
  assert.equal(a.calls.recover + b.calls.recover, 1, 'stale recovery must not run twice either');
  assert.equal(a.calls.publishes + b.calls.publishes, 1, 'due publishing must be consulted once');

  const skipped = [resA, resB].filter((r) => r.skipped);
  assert.equal(skipped.length, 1, 'the loser must skip, not queue and not error');
  assert.equal(skipped[0].reason, 'lease_held');
});

test('the three-seconds-later follower is refused, matching the observed pattern', async () => {
  const clock = { ms: 0 };
  const leases = sharedLeaseStore(clock);
  const leader = fakeContainer();
  const follower = fakeContainer();

  await instance(leases, leader)._schedulerTick();
  clock.ms += 3000;                                   // the observed offset
  const res = await instance(leases, follower)._schedulerTick();

  assert.equal(res.skipped, true, 'the follower three seconds behind must be refused');
  assert.equal(follower.calls.refills, 0, 'it must not run any part of the sweep');
  assert.equal(leader.calls.refills, 1);
});

test('the leader keeps the lease across ticks and the follower stays out', async () => {
  const clock = { ms: 0 };
  const leases = sharedLeaseStore(clock);
  const leader = fakeContainer();
  const follower = fakeContainer();
  const runnerLeader = instance(leases, leader);
  const runnerFollower = instance(leases, follower);

  // Five minutes of the real production rhythm: leader, +3s follower, +57s.
  for (let minute = 0; minute < 5; minute += 1) {
    await runnerLeader._schedulerTick();
    clock.ms += 3000;
    await runnerFollower._schedulerTick();
    clock.ms += 57000;
  }

  assert.equal(leader.calls.refills, 5, 'the leader sweeps once per minute');
  assert.equal(follower.calls.refills, 0, 'the follower never sweeps while the leader lives');
  assert.equal(runnerLeader.status().schedulerLeader, true);
  assert.equal(runnerFollower.status().schedulerLeader, false);
});

test('a crashed leader does not block scheduling for ever', async () => {
  const clock = { ms: 0 };
  const leases = sharedLeaseStore(clock);
  const leader = fakeContainer();
  const survivor = fakeContainer();
  const runnerSurvivor = instance(leases, survivor);

  await instance(leases, leader)._schedulerTick();
  assert.equal(leader.calls.refills, 1);

  // The leader dies without releasing anything: no shutdown hook runs.
  clock.ms += 60_000;
  assert.equal((await runnerSurvivor._schedulerTick()).skipped, true,
    'one minute on the lease is still live, so the survivor correctly waits');

  // Past the TTL the row is reclaimable, with nothing having to notice the crash.
  clock.ms += 35_000;
  const res = await runnerSurvivor._schedulerTick();
  assert.notEqual(res.skipped, true, 'after the TTL the survivor must take over');
  assert.equal(survivor.calls.refills, 1, 'scheduling resumes without human intervention');
  assert.equal(runnerSurvivor.status().schedulerLeader, true);
});

test('the lease TTL outlives the tick interval but not by much', () => {
  // Longer than 60s or the leader loses its own lease between ticks and the two
  // instances start alternating. Very long and a crashed leader blocks
  // scheduling for that whole time.
  assert.ok(SCHEDULER_LEASE_SECONDS > 60, 'the TTL must outlive the 60s tick interval');
  assert.ok(SCHEDULER_LEASE_SECONDS <= 180, 'a crashed leader must not block scheduling for long');
});

test('a graceful shutdown hands the lease over immediately', async () => {
  const clock = { ms: 0 };
  const leases = sharedLeaseStore(clock);
  const survivor = fakeContainer();
  const runnerLeader = instance(leases, fakeContainer(), {
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {},
  });
  const runnerSurvivor = instance(leases, survivor);

  await runnerLeader.start({ drainOnce: async () => [], intervalMs: 60_000 });
  assert.equal(runnerLeader.status().schedulerLeader, true);

  await runnerLeader.stop();
  // No TTL wait: a clean stop releases, so the survivor leads on its next tick.
  clock.ms += 1000;
  const res = await runnerSurvivor._schedulerTick();
  assert.notEqual(res.skipped, true, 'a released lease must be immediately available');
  assert.equal(survivor.calls.refills, 1);
});

test('a lease failure is recorded and does not sweep on a maybe', async () => {
  const container = fakeContainer();
  const leases = {
    async acquireLeaseDbTime() { throw Object.assign(new Error('db gone'), { code: 'ECONNRESET' }); },
  };
  const runner = instance(leases, container);
  const res = await runner._schedulerTick();

  assert.equal(res.error, true, 'the failure is recorded, not thrown');
  // The safe default under uncertainty is to do nothing: an instance that
  // cannot prove it holds the lease might be the second one.
  assert.equal(container.calls.refills, 0, 'an unproven lease must not sweep');
  assert.match(runner.status().lastErrorCategory, /^scheduler:ECONNRESET$/);
});

test('same-process overlap is still blocked, independently of the lease', async () => {
  const leases = sharedLeaseStore();
  let entered = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const container = fakeContainer();
  container.automationService.enqueueDueRefills = async () => {
    entered += 1; await gate; return { enqueued: 0 };
  };
  const runner = instance(leases, container);

  const first = runner._schedulerTick();
  const second = await runner._schedulerTick();
  assert.equal(second.skipped, true, 'the in-process guard remains the second layer');
  assert.equal(entered, 1);
  release();
  await first;
});

test('worker drains stay enabled on every instance, leader or not', async () => {
  const clock = { ms: 0 };
  const leases = sharedLeaseStore(clock);
  const runnerA = instance(leases, fakeContainer());
  const runnerB = instance(leases, fakeContainer());
  let drainsA = 0; let drainsB = 0;

  await runnerA._schedulerTick();
  clock.ms += 3000;
  await runnerB._schedulerTick();          // refused the lease

  await runnerA._workerDrain(async () => { drainsA += 1; return []; });
  await runnerB._workerDrain(async () => { drainsB += 1; return []; });

  // Losing the scheduler lease must not stop an instance processing jobs. Job
  // claims are individually leased in the database, so parallel drains are safe
  // — and having both instances drain is the point of having both instances.
  assert.equal(drainsA, 1);
  assert.equal(drainsB, 1, 'the non-leader must keep draining the durable queue');
});

test('holding the lease does not enable publishing', async () => {
  const leases = sharedLeaseStore();
  const container = fakeContainer({ liveEnabled: false });
  await instance(leases, container)._schedulerTick();
  assert.equal(container.calls.providerCalls, 0,
    'the lease decides WHO sweeps; the publishing flag still decides whether anything is sent');
});

test('the follower does not log every minute', async () => {
  const clock = { ms: 0 };
  const leases = sharedLeaseStore(clock);
  const logs = [];
  const runnerLeader = instance(leases, fakeContainer());
  const runnerFollower = instance(leases, fakeContainer(), { logger: (m) => logs.push(m) });

  for (let i = 0; i < 10; i += 1) {
    await runnerLeader._schedulerTick();
    clock.ms += 3000;
    await runnerFollower._schedulerTick();
    clock.ms += 57000;
  }
  const skips = logs.filter((l) => l.includes('skipped'));
  assert.equal(skips.length, 1, `a follower must not print a line every minute (got ${skips.length})`);
  assert.equal(skips[0], 'scheduler tick skipped (lease held)');
});

test('no lease detail reaches the logs', async () => {
  const clock = { ms: 0 };
  const leases = sharedLeaseStore(clock);
  const logs = [];
  const leader = instance(leases, fakeContainer());
  const follower = instance(leases, fakeContainer(), { logger: (m) => logs.push(m) });
  await leader._schedulerTick();
  clock.ms += 3000;
  await follower._schedulerTick();

  const text = logs.join('\n');
  assert.ok(text.length > 0, 'the follower should log its skip once');
  // The owner embeds a hostname and a pid.
  assert.ok(!text.includes(leader.workerId), 'the lease owner must not be logged');
  assert.ok(!/\bweb-[a-z0-9]/i.test(text), 'no worker identity may appear in a log line');
  assert.ok(!text.includes(String(process.pid)), 'no pid may appear in a log line');
});

test('health reports leadership without exposing the owner', async () => {
  const leases = sharedLeaseStore();
  const runner = instance(leases, fakeContainer());
  await runner._schedulerTick();
  const status = runner.status();

  assert.equal(status.schedulerLeader, true);
  assert.ok(status.lastLeaseAcquiredAt, 'the last renewal must be timestamped');
  const json = JSON.stringify(status);
  assert.ok(!json.includes(runner.workerId), 'the lease owner must never reach /health');
  assert.ok(!json.includes(String(process.pid)), 'no pid may reach /health');
  const forbidden = ['owner', 'leaseOwner', 'host', 'hostname', 'pid'];
  for (const key of Object.keys(status)) {
    assert.ok(!forbidden.includes(key), `"${key}" must not be part of the health shape`);
  }
});

test('the lease uses the existing table and adds no migration', () => {
  const repo = read('src', 'repositories', 'backgroundJobRepository.js');
  assert.match(repo, /export async function acquireLeaseDbTime/);
  // The named-lock table created by migration 014 — no new schema at all.
  assert.match(repo, /FROM worker_leases WHERE lock_name = \? FOR UPDATE/,
    'the lease must serialise on the row, as the existing claim path does');
  // Time comes from the database, so two instances cannot disagree about expiry.
  assert.match(repo, /expires_at > UTC_TIMESTAMP\(\)/);
  assert.match(repo, /DATE_ADD\(UTC_TIMESTAMP\(\), INTERVAL \? SECOND\)/);

  const files = readdirSync(path.join(ROOT, 'database', 'migrations')).filter((f) => f.endsWith('.sql'));
  assert.equal(files.some((f) => f.startsWith('019')), false, 'the lease reuses existing tables and adds no migration (018 is a separate feature)');
  assert.ok(files.includes('018_provider_error_visibility.sql'), '018 is the current migration head');
});

test('the lock name is stable', () => {
  // Changing it would silently un-serialise a running fleet: instances on the
  // old name and the new one would each think they hold the only lease.
  assert.equal(SCHEDULER_LOCK, 'hostinger-single-process-scheduler');
  assert.ok(SCHEDULER_LOCK.length <= 64, 'worker_leases.lock_name is VARCHAR(64)');
});
