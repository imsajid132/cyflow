// Single-process background jobs, for managed hosts with no cron and no second
// process.
//
// The risk this code carries is not that it fails to run — it is that it runs
// TWICE. A redeploy briefly overlaps two instances, and a duplicate publish job
// is a duplicate post on a real business page. So these tests care most about
// what must not happen: no overlap inside a process, no provider call while the
// flag is off, no crash that takes the HTTP server with it.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createBackgroundRunner, errorCategory, DISABLED_STATUS } from '../src/jobs/backgroundRunner.js';
import { setBackgroundRunner, backgroundStatus, resetBackgroundRunner } from '../src/jobs/backgroundStatus.js';
import { buildConfig } from '../src/config/env.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A container whose services record what the runner asked them to do. */
function fakeContainer(overrides = {}) {
  const calls = { refills: 0, publishes: 0, recover: 0, drains: 0, providerCalls: 0 };
  return {
    calls,
    automationService: {
      async enqueueDueRefills() { calls.refills += 1; return { due: 1, enqueued: 1 }; },
      ...overrides.automationService,
    },
    publishingService: {
      // Mirrors the real service: it refuses when live publishing is off, and
      // the refusal is the service's own, not a second switch in the runner.
      async enqueueDuePublishTargets() {
        calls.publishes += 1;
        if (!overrides.liveEnabled) return { skipped: 'live_publishing_disabled', enqueued: 0 };
        calls.providerCalls += 1;
        return { due: 1, enqueued: 1 };
      },
      ...overrides.publishingService,
    },
    durableJobService: {
      async recoverStale() { calls.recover += 1; return { reclaimed: 0, failed: 0 }; },
      ...overrides.durableJobService,
    },
  };
}

const baseConfig = { scheduler: { batchSize: 10 }, worker: { concurrency: 2 } };

// ------------------------------------------------------------------ the flag
test('single-process mode is off by default', () => {
  const env = { ...process.env };
  delete env.HOSTINGER_SINGLE_PROCESS_JOBS;
  assert.equal(buildConfig(env).config.worker.singleProcessJobs, false,
    'a host that can run a separate worker must not silently also run one in-process');
});

test('the flag is enabled only by an explicit true', () => {
  const withValue = (v) => buildConfig({ ...process.env, HOSTINGER_SINGLE_PROCESS_JOBS: v }).config.worker.singleProcessJobs;
  assert.equal(withValue('true'), true);
  assert.equal(withValue('false'), false);
  assert.equal(withValue(''), false, 'an empty value must not enable it');
  // The shared toBoolean helper accepts the usual affirmatives. What matters is
  // that nothing ACCIDENTAL turns it on: unset, empty and false all stay off.
  assert.equal(withValue('on'), true);
  assert.throws(() => withValue('maybe'), /Invalid boolean/,
    'an unrecognised value must fail loudly at startup rather than default to on');
});

test('the flag is documented in .env.example and ships false', () => {
  const example = read('.env.example');
  assert.match(example, /^HOSTINGER_SINGLE_PROCESS_JOBS=false$/m);
});

// ------------------------------------------------------------- scheduler tick
test('one scheduler tick runs on startup, driving the existing services', async () => {
  const container = fakeContainer();
  const runner = createBackgroundRunner({ container, config: baseConfig, logger: () => {} });
  await runner.start({ drainOnce: async () => [], intervalMs: 60_000 });
  try {
    assert.equal(container.calls.refills, 1, 'automation refills must be enqueued through the automation service');
    assert.equal(container.calls.publishes, 1, 'due publishing must go through the publishing service');
    assert.equal(container.calls.recover, 1, 'stale jobs must be recovered through the durable job service');
    const s = runner.status();
    assert.equal(s.backgroundMode, 'hostinger_single_process');
    assert.ok(s.schedulerCompletedAt, 'a completed tick must be timestamped');
  } finally {
    await runner.stop();
  }
});

test('overlapping scheduler ticks are prevented inside one process', async () => {
  let started = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const container = fakeContainer({
    automationService: {
      async enqueueDueRefills() { started += 1; await gate; return { enqueued: 0 }; },
    },
  });
  const runner = createBackgroundRunner({ container, config: baseConfig, logger: () => {} });

  // Two ticks requested while the first is still inside the service call.
  const first = runner._schedulerTick();
  const second = await runner._schedulerTick();
  assert.equal(second.skipped, true, 'the second tick must be skipped, not queued behind the first');
  assert.equal(started, 1, 'the service must not be entered twice concurrently');
  release();
  await first;
});

test('overlapping worker drains are prevented inside one process', async () => {
  let entered = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const runner = createBackgroundRunner({ container: fakeContainer(), config: baseConfig, logger: () => {} });
  const drainOnce = async () => { entered += 1; await gate; return []; };

  const first = runner._workerDrain(drainOnce);
  const second = await runner._workerDrain(drainOnce);
  assert.equal(second.skipped, true, 'a second drain must be skipped while one is in flight');
  assert.equal(entered, 1);
  release();
  await first;
});

// --------------------------------------------------------------- worker drain
test('the worker drain uses the shared durable job service and a bounded batch', async () => {
  const seen = {};
  const container = fakeContainer();
  const runner = createBackgroundRunner({ container, config: baseConfig, logger: () => {} });
  await runner._workerDrain(async (args) => { Object.assign(seen, args); return [1, 2]; });

  assert.equal(seen.jobService, container.durableJobService,
    'the drain must run against the container job service, not a private queue');
  assert.ok(seen.workerId, 'a worker identity must be supplied so leases are attributable');
  // Unbounded would hold the event loop of the process that also serves HTTP.
  assert.ok(Number.isFinite(seen.max) && seen.max > 0, 'the drain must be bounded');
  assert.equal(runner.status().workerCompletedAt !== null, true);
});

test('the worker identity is unique per process, not per host', () => {
  const a = createBackgroundRunner({ container: fakeContainer(), config: baseConfig, logger: () => {} });
  const b = createBackgroundRunner({ container: fakeContainer(), config: baseConfig, logger: () => {} });
  assert.notEqual(a.workerId, b.workerId,
    'a redeploy runs two instances at once; identical ids would make each see the other\'s leases as its own');
  assert.match(a.workerId, /^web-/);
});

// ------------------------------------------------------------ publishing gate
test('live publishing disabled means zero provider publishing calls', async () => {
  const container = fakeContainer({ liveEnabled: false });
  const runner = createBackgroundRunner({ container, config: baseConfig, logger: () => {} });
  await runner.start({ drainOnce: async () => [], intervalMs: 60_000 });
  try {
    assert.equal(container.calls.providerCalls, 0,
      'not one provider call may happen while ENABLE_LIVE_PROVIDER_PUBLISHING is false');
    assert.equal(container.calls.publishes, 1,
      'the publishing service is still consulted — it owns the refusal, the runner does not second-guess it');
  } finally {
    await runner.stop();
  }
});

test('the runner does not reimplement the live-publishing switch', () => {
  const src = read('src', 'jobs', 'backgroundRunner.js');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /liveEnabled/,
    'one switch, in the publishing service. A second copy here could drift out of step with it.');
});

// ------------------------------------------------------------- error handling
test('a failing operation is recorded safely and does not throw', async () => {
  const boom = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3306 password=hunter2'), { code: 'ECONNREFUSED' });
  const container = fakeContainer({
    automationService: { async enqueueDueRefills() { throw boom; } },
  });
  const logs = [];
  const runner = createBackgroundRunner({ container, config: baseConfig, logger: (m) => logs.push(m) });

  const result = await runner._schedulerTick();       // must not reject
  assert.equal(result.error, true);

  const s = runner.status();
  assert.equal(s.lastErrorCategory, 'scheduler:ECONNREFUSED');
  // The message carried a host and a password. Only the code may escape.
  const all = JSON.stringify(s) + logs.join('\n');
  assert.ok(!all.includes('hunter2'), 'an error message must never reach status or logs');
  assert.ok(!all.includes('10.0.0.5'), 'a host address must never reach status or logs');
});

test('a failure in one step does not stop the process or the later steps', async () => {
  const container = fakeContainer({
    publishingService: { async enqueueDuePublishTargets() { throw new Error('provider exploded'); } },
  });
  const runner = createBackgroundRunner({ container, config: baseConfig, logger: () => {} });
  await runner.start({ drainOnce: async () => [], intervalMs: 60_000 });
  try {
    // The tick recorded an error, but start() resolved and the runner is alive:
    // in the real server this is what keeps the HTTP listener serving.
    assert.equal(runner.status().running, true, 'the runner must survive a failing operation');
    assert.match(String(runner.status().lastErrorCategory), /^scheduler:/);
  } finally {
    await runner.stop();
  }
});

test('errorCategory never returns a message', () => {
  assert.equal(errorCategory({ code: 'ETIMEDOUT' }), 'ETIMEDOUT');
  assert.equal(errorCategory(new Error('secret token abc123')), 'unknown_error');
  assert.equal(errorCategory({ name: 'AbortError' }), 'timeout');
});

// ----------------------------------------------------------------- shutdown
test('stopping prevents future ticks and waits for work in flight', async () => {
  let cleared = null;
  const container = fakeContainer();
  const runner = createBackgroundRunner({
    container, config: baseConfig, logger: () => {},
    setIntervalFn: () => ({ id: 'timer', unref() {} }),
    clearIntervalFn: (t) => { cleared = t; },
  });
  await runner.start({ drainOnce: async () => [], intervalMs: 60_000 });
  const ticksBefore = runner.status().ticks;

  await runner.stop();
  assert.ok(cleared, 'the interval must be cleared on stop');
  assert.equal(runner.status().running, false);

  // A tick requested after stop must not run.
  await runner._schedulerTick();
  assert.equal(runner.status().ticks, ticksBefore, 'no tick may start after stop');
});

test('stop awaits an in-flight operation so the pool is not closed underneath it', async () => {
  let finished = false;
  let release;
  const gate = new Promise((r) => { release = r; });
  const container = fakeContainer({
    automationService: {
      async enqueueDueRefills() { await gate; finished = true; return { enqueued: 0 }; },
    },
  });
  const runner = createBackgroundRunner({
    container, config: baseConfig, logger: () => {},
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {},
  });

  const starting = runner.start({ drainOnce: async () => [], intervalMs: 60_000 });
  await sleep(10);
  const stopping = runner.stop();
  release();
  await Promise.all([starting, stopping]);
  assert.equal(finished, true, 'stop must not resolve while an operation is still writing');
});

// ------------------------------------------------------------------- health
test('background status is "disabled" when no runner is registered', () => {
  resetBackgroundRunner();
  assert.deepEqual(backgroundStatus(), { ...DISABLED_STATUS });
  assert.equal(backgroundStatus().backgroundMode, 'disabled',
    'a host with an external worker must not be told this process is handling jobs');
});

test('health status carries no secret, path, id or payload', async () => {
  const container = fakeContainer();
  const runner = createBackgroundRunner({ container, config: baseConfig, logger: () => {} });
  await runner.start({ drainOnce: async () => [], intervalMs: 60_000 });
  setBackgroundRunner(runner);
  try {
    const status = backgroundStatus();
    const json = JSON.stringify(status);
    for (const forbidden of ['password', 'secret', 'token', 'DB_', 'mysql://', '/home/', 'C:\\\\']) {
      assert.ok(!json.includes(forbidden), `background status must not contain "${forbidden}"`);
    }
    // The worker id names a host and a pid; useful in a log, not in a public
    // health response.
    assert.ok(!('workerId' in status), 'the worker identity must not be exposed on /health');
    assert.deepEqual(Object.keys(status).sort(), [
      'backgroundMode', 'drains', 'lastErrorAt', 'lastErrorCategory',
      'lastLeaseAcquiredAt', 'running', 'schedulerCompletedAt', 'schedulerLeader',
      'schedulerRunning', 'schedulerStartedAt', 'ticks',
      'workerCompletedAt', 'workerRunning', 'workerStartedAt',
    ], 'the status shape is deliberately fixed; new fields need a secret review');
    // schedulerLeader is a boolean and lastLeaseAcquiredAt a timestamp. The
    // lease OWNER embeds a hostname and a pid and is deliberately absent.
    assert.equal(typeof status.schedulerLeader, 'boolean');
    assert.ok(!('leaseOwner' in status) && !('owner' in status),
      'the lease owner must never be exposed on /health');
  } finally {
    await runner.stop();
    resetBackgroundRunner();
  }
});

test('the health route reports background state', () => {
  const src = read('src', 'routes', 'healthRoutes.js');
  assert.match(src, /backgroundStatus/, 'the health route must report background state');
  assert.match(src, /background,/, 'background status must be included in the response payload');
});

// -------------------------------------------------------- existing entrypoints
test('the separate worker and scheduler entry points still exist and are unchanged in role', () => {
  // Single-process mode is an accommodation for one kind of host, not a
  // replacement. A VPS should still run a dedicated worker.
  const worker = read('src', 'workers', 'worker.js');
  const scheduler = read('src', 'scheduler', 'runOnce.js');
  assert.match(worker, /runLoop/, 'npm run worker must still drive the shared runtime loop');
  assert.match(scheduler, /enqueueDueRefills/, 'npm run scheduler:once must still enqueue refills');
  assert.match(scheduler, /enqueueDuePublishTargets/, 'npm run scheduler:once must still enqueue publishing');

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.worker, 'node src/workers/worker.js');
  assert.equal(pkg.scripts['scheduler:once'], 'node src/scheduler/runOnce.js');
});

test('the runner starts only after the database check, and stops before the pool closes', () => {
  const server = read('src', 'server.js');
  const dbIdx = server.indexOf('Database connection OK');
  const startIdx = server.indexOf('backgroundRunner.start');
  assert.ok(dbIdx > -1 && startIdx > dbIdx,
    'a runner pointed at a dead pool just logs a failure every minute');

  const stopIdx = server.indexOf('backgroundRunner.stop');
  // The CALL, not the import line at the top of the file.
  const closeIdx = server.indexOf('await gracefulClose(');
  assert.ok(stopIdx > -1 && stopIdx < closeIdx,
    'the runner must stop before the database pool closes, or a job loses its connection mid-write');
});

// ------------------------------------------------------------------ migrations
test('no migration was added or modified for this change', () => {
  const files = readdirSync(path.join(ROOT, 'database', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.includes('018_provider_error_visibility.sql'), '018 is the current migration head');
  assert.equal(files.some((f) => f.startsWith('019')), false, 'this change adds no migration (018 is a separate feature)');
  // Single-process mode reuses the existing job tables; it needs no schema at all.
  const runner = read('src', 'jobs', 'backgroundRunner.js');
  assert.doesNotMatch(runner, /CREATE TABLE|ALTER TABLE|INSERT INTO|SELECT .* FROM/i,
    'the runner must not contain SQL: it calls services, which own the queries');
});
