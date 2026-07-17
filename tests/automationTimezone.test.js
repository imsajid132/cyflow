import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule } from '../src/services/plannerScheduleService.js';
import { zonedWallTimeToUtc } from '../src/utils/time.js';

// The automation's buffer is computed by buildSchedule, so its DST correctness is
// what these lock down. A fixed local posting time must stay fixed across a DST
// transition — the UTC instant moves, the wall-clock time does not.

test('zonedWallTimeToUtc keeps Asia/Karachi 09:00 at 04:00 UTC (no DST)', () => {
  const utc = zonedWallTimeToUtc({ year: 2026, month: 7, day: 20, hour: 9, minute: 0 }, 'Asia/Karachi');
  assert.equal(utc.toISOString(), '2026-07-20T04:00:00.000Z'); // UTC+5, no DST
});

test('America/New_York spring-forward keeps 09:00 local, shifting the UTC offset', () => {
  // 2026-03-08 is the US spring-forward. Before: EST (UTC-5) -> 09:00 = 14:00Z.
  const before = zonedWallTimeToUtc({ year: 2026, month: 3, day: 7, hour: 9, minute: 0 }, 'America/New_York');
  const after = zonedWallTimeToUtc({ year: 2026, month: 3, day: 9, hour: 9, minute: 0 }, 'America/New_York');
  assert.equal(before.toISOString(), '2026-03-07T14:00:00.000Z'); // EST
  assert.equal(after.toISOString(), '2026-03-09T13:00:00.000Z'); // EDT
});

test('America/New_York fall-back keeps 09:00 local, shifting the UTC offset', () => {
  // 2026-11-01 is the US fall-back. Before: EDT (UTC-4), after: EST (UTC-5).
  const before = zonedWallTimeToUtc({ year: 2026, month: 10, day: 31, hour: 9, minute: 0 }, 'America/New_York');
  const after = zonedWallTimeToUtc({ year: 2026, month: 11, day: 2, hour: 9, minute: 0 }, 'America/New_York');
  assert.equal(before.toISOString(), '2026-10-31T13:00:00.000Z'); // EDT
  assert.equal(after.toISOString(), '2026-11-02T14:00:00.000Z'); // EST
});

test('a buffer spanning a DST boundary produces no duplicate or missing local slot', () => {
  // Daily 09:00 slots over the NY spring-forward week.
  const now = new Date('2026-03-06T00:00:00Z');
  const schedule = buildSchedule({
    startDate: null, planLength: 7, cadence: 'every_day', weekdays: [1, 2, 3, 4, 5, 6, 7],
    times: ['09:00'], postsPerDay: 1, timezone: 'America/New_York', now,
  });
  const localDates = schedule.slots.map((s) => s.localDate);
  // No duplicate local dates, all at 09:00 local.
  assert.equal(new Set(localDates).size, localDates.length, 'no duplicate local dates across the transition');
  assert.ok(schedule.slots.every((s) => s.localTime === '09:00'), 'every slot is 09:00 local');
  // The UTC offset changes across the boundary (14:00Z before, 13:00Z after).
  const utcHours = schedule.slots.map((s) => new Date(`${String(s.scheduledForUtc).replace(' ', 'T')}Z`).getUTCHours());
  assert.ok(utcHours.includes(14) && utcHours.includes(13), 'the UTC hour shifts with DST while local stays 09:00');
});

test('the stored timezone is the original IANA name, never silently UTC', () => {
  const schedule = buildSchedule({
    startDate: null, planLength: 3, cadence: 'every_day', weekdays: [1, 2, 3, 4, 5, 6, 7],
    times: ['09:00'], postsPerDay: 1, timezone: 'Asia/Karachi', now: new Date('2026-07-20T00:00:00Z'),
  });
  assert.equal(schedule.timezone, 'Asia/Karachi');
});
