// Phase 4.7: cadence / timezone / slot arithmetic.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSchedule,
  normalizeTimes,
  normalizeWeekdays,
  weekdaysForCadence,
  parseTime,
  parseDateOnly,
  todayInZone,
  nextWeeklyRunAt,
} from '../src/services/plannerScheduleService.js';
import { PLANNER_LIMITS } from '../src/config/constants.js';
import { fromMysqlUtc } from '../src/utils/time.js';

// A fixed "now" so these tests never depend on the wall clock.
const NOW = new Date('2026-07-13T06:00:00Z'); // a Monday

test('parseTime accepts only HH:MM in 24h range', () => {
  assert.deepEqual(parseTime('09:30'), { hour: 9, minute: 30 });
  assert.deepEqual(parseTime('00:00'), { hour: 0, minute: 0 });
  assert.deepEqual(parseTime('23:59'), { hour: 23, minute: 59 });
  for (const bad of ['24:00', '9:30', '09:60', 'noon', '', null, '09:30:00']) {
    assert.equal(parseTime(bad), null, `${bad} must be rejected`);
  }
});

test('parseDateOnly rejects impossible dates instead of rolling over', () => {
  assert.equal(parseDateOnly('2026-02-31'), null, 'JS would roll this to March');
  assert.equal(parseDateOnly('2026-13-01'), null);
  assert.equal(parseDateOnly('26-01-01'), null);
  assert.equal(parseDateOnly(null), null);
  assert.equal(parseDateOnly('2026-07-13').toISOString(), '2026-07-13T00:00:00.000Z');
});

test('times are de-duplicated, sorted, capped, and never empty', () => {
  assert.deepEqual(normalizeTimes(['12:00', '09:00', '12:00']), ['09:00', '12:00']);
  assert.deepEqual(normalizeTimes(['bad', '09:00']), ['09:00']);
  // An empty or fully invalid list falls back rather than producing no posts.
  assert.deepEqual(normalizeTimes([]), ['09:00']);
  assert.deepEqual(normalizeTimes(null), ['09:00']);
  assert.deepEqual(normalizeTimes(['nope']), ['09:00']);
  assert.equal(normalizeTimes(['01:00', '02:00', '03:00', '04:00', '05:00', '06:00']).length,
    PLANNER_LIMITS.MAX_TIMES_PER_DAY);
});

test('weekday selections are normalized to unique sorted ISO numbers', () => {
  assert.deepEqual(normalizeWeekdays([5, 1, 5, 3]), [1, 3, 5]);
  assert.deepEqual(normalizeWeekdays([0, 8, -1, 'x']), []);
  assert.deepEqual(normalizeWeekdays(null), []);
});

test('cadence maps to the right weekdays', () => {
  assert.deepEqual(weekdaysForCadence('every_day'), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(weekdaysForCadence('weekdays'), [1, 2, 3, 4, 5]);
  assert.deepEqual(weekdaysForCadence('selected_weekdays', [2, 4]), [2, 4]);
  assert.deepEqual(weekdaysForCadence('custom', [6, 7]), [6, 7]);
  // An empty selection falls back to every day rather than generating nothing.
  assert.deepEqual(weekdaysForCadence('selected_weekdays', []), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(weekdaysForCadence('nonsense'), [1, 2, 3, 4, 5, 6, 7]);
});

test('a 7-day every-day plan produces one slot per day', () => {
  const { slots, startDate, endDate } = buildSchedule({
    startDate: '2026-07-14', planLength: 7, cadence: 'every_day',
    times: ['09:00'], timezone: 'UTC', now: NOW,
  });
  assert.equal(slots.length, 7);
  assert.equal(startDate, '2026-07-14');
  assert.equal(endDate, '2026-07-20');
  assert.deepEqual(slots.map((s) => s.localDate), [
    '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17',
    '2026-07-18', '2026-07-19', '2026-07-20',
  ]);
  for (const slot of slots) assert.equal(slot.localTime, '09:00');
});

test('weekdays-only skips the weekend inside the same 7-day window', () => {
  // The window is 7 CALENDAR days; cadence filters which get posts.
  const { slots } = buildSchedule({
    startDate: '2026-07-13', planLength: 7, cadence: 'weekdays',
    times: ['09:00'], timezone: 'UTC', now: NOW,
  });
  assert.equal(slots.length, 5);
  assert.deepEqual(slots.map((s) => s.weekday), [1, 2, 3, 4, 5]);
  assert.equal(slots.some((s) => s.localDate === '2026-07-18'), false, 'Saturday must be skipped');
  assert.equal(slots.some((s) => s.localDate === '2026-07-19'), false, 'Sunday must be skipped');
});

test('selected weekdays produce only those days', () => {
  const { slots } = buildSchedule({
    startDate: '2026-07-13', planLength: 14, cadence: 'selected_weekdays',
    weekdays: [2, 4], times: ['10:00'], timezone: 'UTC', now: NOW,
  });
  assert.deepEqual([...new Set(slots.map((s) => s.weekday))], [2, 4]);
  assert.equal(slots.length, 4, 'two weekdays across two weeks');
});

test('multiple daily times produce multiple ordered slots per day', () => {
  const { slots } = buildSchedule({
    startDate: '2026-07-14', planLength: 3, cadence: 'every_day',
    times: ['17:30', '09:00'], timezone: 'UTC', now: NOW,
  });
  assert.equal(slots.length, 6);
  // Sorted within each day.
  assert.deepEqual(slots.slice(0, 2).map((s) => s.localTime), ['09:00', '17:30']);
  assert.deepEqual(slots.map((s) => s.localDate), [
    '2026-07-14', '2026-07-14', '2026-07-15', '2026-07-15', '2026-07-16', '2026-07-16',
  ]);
});

test('slots are timezone-aware: local wall time converts to the right UTC instant', () => {
  const { slots } = buildSchedule({
    startDate: '2026-07-14', planLength: 1, cadence: 'every_day',
    times: ['09:00'], timezone: 'Asia/Karachi', now: NOW, // UTC+5, no DST
  });
  assert.equal(slots.length, 1);
  const utc = fromMysqlUtc(slots[0].scheduledForUtc);
  assert.equal(utc.getUTCHours(), 4, '09:00 PKT is 04:00 UTC');
  assert.equal(slots[0].localTime, '09:00', 'the local time the user chose is preserved');
});

test('a DST boundary keeps the local time fixed, not the UTC offset', () => {
  // Europe/London goes GMT->BST on 2026-03-29. 09:00 local must stay 09:00.
  const { slots } = buildSchedule({
    startDate: '2026-03-28', planLength: 3, cadence: 'every_day',
    times: ['09:00'], timezone: 'Europe/London',
    now: new Date('2026-03-01T00:00:00Z'),
  });
  assert.equal(slots.length, 3);
  const hoursUtc = slots.map((s) => fromMysqlUtc(s.scheduledForUtc).getUTCHours());
  // Before the switch 09:00 local == 09:00 UTC; after it, 08:00 UTC.
  assert.deepEqual(hoursUtc, [9, 8, 8]);
  for (const slot of slots) assert.equal(slot.localTime, '09:00');
});

test('slots already in the past are skipped rather than generated', () => {
  // "Now" is 06:00 UTC on the 13th; the 05:00 slot that day has passed.
  const { slots, skippedPast } = buildSchedule({
    startDate: '2026-07-13', planLength: 2, cadence: 'every_day',
    times: ['05:00', '22:00'], timezone: 'UTC', now: NOW,
  });
  assert.equal(skippedPast, 1);
  assert.equal(slots.length, 3, 'day 1 keeps only 22:00; day 2 keeps both');
  assert.equal(slots[0].localTime, '22:00');
  for (const slot of slots) {
    assert.ok(fromMysqlUtc(slot.scheduledForUtc).getTime() > NOW.getTime());
  }
});

test('plan length is clamped and the run is capped', () => {
  const long = buildSchedule({
    startDate: '2026-07-14', planLength: 999, cadence: 'every_day',
    times: ['09:00'], timezone: 'UTC', now: NOW,
  });
  assert.equal(long.slots.length, PLANNER_LIMITS.MAX_PLAN_LENGTH);

  // Length x times must never exceed the per-run ceiling.
  const dense = buildSchedule({
    startDate: '2026-07-14', planLength: 14, cadence: 'every_day',
    times: ['08:00', '12:00', '16:00', '20:00'], timezone: 'UTC', now: NOW,
  });
  assert.equal(dense.slots.length, PLANNER_LIMITS.MAX_ITEMS_PER_RUN);

  const short = buildSchedule({ planLength: 0, times: ['09:00'], timezone: 'UTC', now: NOW });
  assert.ok(short.slots.length >= 0);
});

test('an invalid timezone falls back to UTC instead of throwing', () => {
  const { timezone, slots } = buildSchedule({
    startDate: '2026-07-14', planLength: 1, cadence: 'every_day',
    times: ['09:00'], timezone: 'Not/AZone', now: NOW,
  });
  assert.equal(timezone, 'UTC');
  assert.equal(slots.length, 1);
});

test('no start date means "today in the user timezone"', () => {
  // 2026-07-13T18:00Z is already the 14th in Asia/Karachi (UTC+5).
  const instant = new Date('2026-07-13T20:00:00Z');
  assert.equal(todayInZone(instant, 'Asia/Karachi').toISOString().slice(0, 10), '2026-07-14');
  assert.equal(todayInZone(instant, 'UTC').toISOString().slice(0, 10), '2026-07-13');

  const { startDate } = buildSchedule({
    planLength: 3, cadence: 'every_day', times: ['23:00'],
    timezone: 'Asia/Karachi', now: instant,
  });
  assert.equal(startDate, '2026-07-14');
});

test('nextWeeklyRunAt is one week out (autopilot preparation only)', () => {
  const next = nextWeeklyRunAt(NOW);
  assert.equal(next, '2026-07-20 06:00:00');
});
