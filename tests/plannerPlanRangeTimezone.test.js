// The Weekly Board header read "2026-07-18 to 2026-07-25" for posts the user
// had scheduled on the 19th and the 26th — one day early at both ends, and
// disagreeing with every card underneath it.
//
// `scheduled_for` is a UTC INSTANT, not a calendar date. A post at 02:45
// Asia/Karachi is 21:45 UTC the previous day, so taking the first ten
// characters of the stored value yields the previous day's date. The range must
// be resolved in the PLAN's timezone.
//
// These are pure data-shape tests: real UTC instants in, expected local
// calendar dates out. They need no database, and they fail on the old
// behaviour — see the revert note in the release report.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeApp, registerUser } from './helpers/apiHarness.js';

/** The UTC instant for a wall-clock time in a zone, as MySQL would store it. */
function utcInstantFor(localDate, localTime, timeZone) {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh, mm] = localTime.split(':').map(Number);
  // Start from the naive UTC reading, then correct by the zone's offset.
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  const probe = new Date(naive);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(probe).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const seen = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), 0,
  );
  const instant = new Date(naive - (seen - naive));
  return instant.toISOString().slice(0, 19).replace('T', ' ');
}

async function planWith(items, timezone) {
  const { app, overrides } = makeApp();
  const { agent } = await registerUser(app);
  const me = await agent.get('/api/auth/me');
  const userId = String(me.body.data.user.id);
  const runs = overrides.plannerRunRepository;

  const run = await runs.createRun({
    userId, status: 'review', timezone,
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  let position = 0;
  for (const { date, time } of items) {
    // eslint-disable-next-line no-await-in-loop
    await runs.createItem({
      userId, plannerRunId: run.id,
      scheduledFor: utcInstantFor(date, time, timezone),
      originalTimezone: timezone, contentType: 'insight', goal: 'awareness',
      templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
      headline: 'h', subheadline: 's', summary: 's', caption: 'c', altText: 'a',
      hashtags: [], platformTargets: ['facebook'],
      platformCaptions: { facebook: { postCopy: 'c', hashtags: [], validationStatus: 'passed' } },
      approvalStatus: 'needs_review', position: position += 1,
    });
  }
  const res = await agent.get(`/api/planner/plans/${run.id}`);
  return res.body.data.run;
}

test('the reported plan resolves to Jul 19 and Jul 26, not Jul 18 and Jul 25', async () => {
  // The exact staging plan: two Sundays at 02:45 Asia/Karachi.
  const run = await planWith([
    { date: '2026-07-19', time: '02:45' },
    { date: '2026-07-26', time: '02:45' },
  ], 'Asia/Karachi');

  assert.equal(run.startDate, '2026-07-19', 'the first card is Sunday July 19');
  assert.equal(run.endDate, '2026-07-26', 'the last card is Sunday July 26');
  // The precise wrong answer the board displayed.
  assert.notEqual(run.startDate, '2026-07-18', 'the UTC date is a day early');
  assert.notEqual(run.endDate, '2026-07-25', 'the UTC date is a day early');
});

test('the stored instant really is the previous UTC day, so the test has teeth', () => {
  // If this ever stops being true the test above proves nothing.
  const stored = utcInstantFor('2026-07-19', '02:45', 'Asia/Karachi');
  assert.match(stored, /^2026-07-18 21:45/, '02:45 in Karachi is 21:45 UTC on the 18th');
});

test('a single-item plan reports the same day at both ends', async () => {
  const run = await planWith([{ date: '2026-07-19', time: '02:45' }], 'Asia/Karachi');
  assert.equal(run.startDate, '2026-07-19');
  assert.equal(run.endDate, '2026-07-19');
});

test('an empty plan reports null, never a string or an invalid date', async () => {
  const run = await planWith([], 'Asia/Karachi');
  assert.equal(run.startDate, null);
  assert.equal(run.endDate, null);
  for (const v of [run.startDate, run.endDate]) {
    assert.notEqual(v, 'null');
    assert.notEqual(v, 'undefined');
    assert.notEqual(v, 'Invalid Date');
  }
});

test('a month boundary does not roll backwards', async () => {
  // 00:30 on the 1st in Karachi is 19:30 UTC on the last day of the previous
  // month — the same failure, one month wide.
  const run = await planWith([
    { date: '2026-08-01', time: '00:30' },
    { date: '2026-08-09', time: '00:30' },
  ], 'Asia/Karachi');
  assert.equal(run.startDate, '2026-08-01', 'must not report 2026-07-31');
  assert.equal(run.endDate, '2026-08-09');
});

test('a year boundary does not roll backwards', async () => {
  const run = await planWith([
    { date: '2027-01-01', time: '01:00' },
    { date: '2027-01-03', time: '01:00' },
  ], 'Asia/Karachi');
  assert.equal(run.startDate, '2027-01-01', 'must not report 2026-12-31');
  assert.equal(run.endDate, '2027-01-03');
});

test('a zone BEHIND UTC does not roll forwards', async () => {
  // The mirror image: 22:00 in New York is 02:00 UTC the NEXT day, so a naive
  // UTC read is a day late rather than a day early.
  const run = await planWith([
    { date: '2026-07-19', time: '22:00' },
    { date: '2026-07-26', time: '22:00' },
  ], 'America/New_York');
  assert.equal(run.startDate, '2026-07-19', 'must not report 2026-07-20');
  assert.equal(run.endDate, '2026-07-26', 'must not report 2026-07-27');
});

test('a DST transition keeps the local calendar date', async () => {
  // US DST ends 2026-11-01. A post that morning is on the 1st locally whatever
  // the offset does underneath it.
  const run = await planWith([
    { date: '2026-10-31', time: '23:30' },
    { date: '2026-11-01', time: '01:30' },
  ], 'America/New_York');
  assert.equal(run.startDate, '2026-10-31');
  assert.equal(run.endDate, '2026-11-01');
});

test('Asia/Karachi has no DST, so every item in a week keeps its own date', async () => {
  const run = await planWith([
    { date: '2026-07-19', time: '02:45' },
    { date: '2026-07-22', time: '23:59' },
    { date: '2026-07-26', time: '00:01' },
  ], 'Asia/Karachi');
  assert.equal(run.startDate, '2026-07-19');
  assert.equal(run.endDate, '2026-07-26');
});

test('an unknown timezone falls back to UTC rather than throwing', async () => {
  // Built without the helper above, which itself needs a valid zone: the point
  // is that the SERVICE tolerates a bad stored timezone and still returns a
  // real date instead of failing the whole plan load.
  const { app, overrides } = makeApp();
  const { agent } = await registerUser(app);
  const me = await agent.get('/api/auth/me');
  const userId = String(me.body.data.user.id);
  const runs = overrides.plannerRunRepository;
  const run = await runs.createRun({
    userId, status: 'review', timezone: 'Not/AZone',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  await runs.createItem({
    userId, plannerRunId: run.id, scheduledFor: '2026-07-19 12:00:00',
    originalTimezone: 'Not/AZone', contentType: 'insight', goal: 'awareness',
    templateKey: 'editorial-premium', aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'h', subheadline: 's', summary: 's', caption: 'c', altText: 'a',
    hashtags: [], platformTargets: ['facebook'],
    platformCaptions: { facebook: { postCopy: 'c', hashtags: [], validationStatus: 'passed' } },
    approvalStatus: 'needs_review', position: 1,
  });
  const res = await agent.get(`/api/planner/plans/${run.id}`);
  assert.equal(res.status, 200, 'a bad stored timezone must not break the plan');
  assert.match(String(res.body.data.run.startDate), /^\d{4}-\d{2}-\d{2}$/);
});
