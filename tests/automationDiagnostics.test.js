// Automation refill diagnostics — the safe, read-time explanation of
// "only N of M expected posts are prepared", distinguishing a worker still
// draining from a real shortfall from failures. No internal ids.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAutomationService } from '../src/services/automationService.js';

function svcWith(byStatus, over = {}) {
  const automation = {
    id: '1', userId: '5', name: 'A', status: 'active', mode: 'review', timezone: 'Asia/Karachi',
    selectedPlatforms: ['facebook'], selectedAccountIds: ['9'], selectedWeekdays: [1, 2, 3, 4, 5, 6, 7],
    postingTimes: ['09:00'], postsPerDay: 1, generationHorizonDays: 7, minimumReadyDays: 7,
    lowBufferDays: 3, missedPostPolicy: 'skip', plannerRunId: '10',
    generatedThroughDate: null, attentionReason: null, lastRefillAt: null, nextRefillAt: null,
    createdAt: null, stoppedAt: null, startDate: null, endDate: null, rhythmKey: 'balanced',
    ...over,
  };
  const automations = {
    async findAutomationByIdForUser(id, userId) {
      return String(id) === automation.id && String(userId) === automation.userId ? automation : null;
    },
    async listAutomationsForUser() { return [automation]; },
    async bufferStats() { return { readyDays: Number(byStatus.ready ?? 0), through: null, byStatus }; },
    async listSlotsForAutomation() { return []; },
  };
  return createAutomationService({ automations });
}

test('diagnostics: worker still preparing — 2 of 7 ready, 5 pending', async () => {
  const a = await svcWith({ ready: 2, planned: 5 }).getAutomation('5', '1');
  assert.ok(a.diagnostics, 'diagnostics present');
  assert.equal(a.diagnostics.expected, 7, 'a Mon-Sun, ahead-7 automation expects 7');
  assert.equal(a.diagnostics.ready, 2);
  assert.equal(a.diagnostics.pending, 5);
  assert.equal(a.diagnostics.prepared, 7);
  assert.equal(a.diagnostics.reason, 'preparing', 'worker-lag, not a shortfall');
});

test('diagnostics: a genuine refill shortfall — fewer prepared than expected, none pending', async () => {
  const a = await svcWith({ ready: 2, planned: 0 }).getAutomation('5', '1');
  assert.equal(a.diagnostics.reason, 'shortfall');
  assert.equal(a.diagnostics.prepared, 2);
});

test('diagnostics: failures present are called out', async () => {
  const a = await svcWith({ ready: 5, planned: 0, failed: 2 }).getAutomation('5', '1');
  assert.equal(a.diagnostics.reason, 'failures');
  assert.equal(a.diagnostics.failed, 2);
});

test('diagnostics: fully prepared is "ok"', async () => {
  const a = await svcWith({ ready: 7 }).getAutomation('5', '1');
  assert.equal(a.diagnostics.reason, 'ok');
  assert.equal(a.diagnostics.expected, 7);
});

test('diagnostics: a 3-weekday automation expects fewer than 7', async () => {
  const a = await svcWith({ ready: 1, planned: 0 }, { selectedWeekdays: [1, 3, 5] }).getAutomation('5', '1');
  // Only Mon/Wed/Fri fall in the next 7 days -> expected 3.
  assert.equal(a.diagnostics.expected, 3, 'expected follows the selected weekdays, not the horizon');
});
