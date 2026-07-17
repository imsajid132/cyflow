import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { runLoop, drainOnce } from '../src/workers/workerRuntime.js';

function fakeJobService({ jobsToRun = 0 } = {}) {
  let remaining = jobsToRun;
  const calls = { runOne: 0, recoverStale: 0, drain: 0 };
  return {
    calls,
    async runOne() { calls.runOne += 1; if (remaining > 0) { remaining -= 1; return { ran: true, outcome: 'completed' }; } return { ran: false }; },
    async recoverStale() { calls.recoverStale += 1; return { reclaimed: 0, failed: 0 }; },
    async drain({ max }) { calls.drain += 1; const out = []; for (let i = 0; i < Math.min(max, jobsToRun); i += 1) out.push({ ran: true, outcome: 'completed' }); return out; },
  };
}

test('runLoop stops promptly when shouldStop flips (graceful shutdown)', async () => {
  const js = fakeJobService({ jobsToRun: 0 });
  let ticks = 0;
  let stop = false;
  const result = await runLoop({
    jobService: js, workerId: 'W', concurrency: 1, pollMs: 0, recoverEveryMs: 999999,
    shouldStop: () => stop, sleepImpl: async () => { ticks += 1; if (ticks >= 3) stop = true; },
  });
  assert.ok(stop, 'the loop observed the stop signal');
  assert.equal(result.processed, 0);
  assert.ok(js.calls.runOne >= 1, 'it attempted to claim work before idling out');
});

test('runLoop processes available work then idles', async () => {
  const js = fakeJobService({ jobsToRun: 3 });
  let stop = false;
  const result = await runLoop({
    jobService: js, workerId: 'W', concurrency: 1, pollMs: 0, recoverEveryMs: 999999,
    shouldStop: () => stop, sleepImpl: async () => { stop = true; }, // stop on first idle
  });
  assert.equal(result.processed, 3, 'ran all three jobs before idling');
});

test('runLoop backs off on idle instead of busy-looping', async () => {
  const js = fakeJobService({ jobsToRun: 0 });
  let sleeps = 0;
  let stop = false;
  await runLoop({
    jobService: js, workerId: 'W', concurrency: 2, pollMs: 5000, recoverEveryMs: 999999,
    shouldStop: () => stop, sleepImpl: async (ms) => { sleeps += 1; assert.equal(ms, 5000); stop = true; },
  });
  assert.equal(sleeps, 1, 'it slept for the poll interval when the queue was empty');
});

test('runLoop runs stale recovery on the first tick', async () => {
  const js = fakeJobService({ jobsToRun: 0 });
  let stop = false;
  await runLoop({
    jobService: js, workerId: 'W', concurrency: 1, pollMs: 0, recoverEveryMs: 60000,
    shouldStop: () => stop, sleepImpl: async () => { stop = true; }, nowMs: () => 1_000_000,
  });
  assert.equal(js.calls.recoverStale, 1, 'stale recovery ran');
});

test('drainOnce recovers then drains', async () => {
  const js = fakeJobService({ jobsToRun: 2 });
  const out = await drainOnce({ jobService: js, workerId: 'W', max: 10 });
  assert.equal(js.calls.recoverStale, 1);
  assert.equal(out.length, 2);
});
