// A planned week, built durably.
//
// Seven posts is fourteen model calls and seven renders — five to eight minutes.
// No browser waits that long, and the product says the work must not depend on
// the app staying open, so each post is a durable job. These tests pin the parts
// that make that safe: one job per day, a retry that cannot post twice, and a
// week that lands in the same rows the rest of the application already reads.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWeekService } from '../src/services/aiStudio/weekService.js';
import { JOB_TYPES, PLANNER_ITEM_STATUS, IMAGE_RENDER_STATUS, PROVIDER_NAMES } from '../src/config/constants.js';

const BRAND = {
  businessName: 'NYC Waterproofing',
  industry: 'Waterproofing contractor',
  services: ['Basement Waterproofing', 'French Drain Installation'],
  primary: '#0b1a2e', secondary: '#1e3a8a', accent: '#dc2626',
  images: [
    { url: 'https://x.test/a.jpg', alt: 'Facade', chosen: true },
    { url: 'https://x.test/b.jpg', alt: 'Logo', chosen: false },
  ],
};

const PLAN = Array.from({ length: 7 }, (_, i) => ({
  day: i + 1, job: 'introduce', angle: `Angle ${i + 1}`, service: 'Basement Waterproofing', why: 'For owners.',
}));

/** A whole fake world: runs, jobs, media, the planner and the designer. */
function build({ planner, generatePost } = {}) {
  const runsStore = [];
  const itemsStore = [];
  const enqueued = [];
  let nextRun = 1;

  const runs = {
    createRun: async (input) => {
      const run = { id: String(nextRun++), ...input, startDate: input.startDate, timezone: input.timezone };
      runsStore.push(run);
      return run;
    },
    findRunByIdForUser: async (id, userId) =>
      runsStore.find((r) => String(r.id) === String(id) && String(r.userId) === String(userId)) || null,
    // Newest first, as the repository returns them.
    listRunsForUser: async (userId) =>
      runsStore.filter((r) => String(r.userId) === String(userId)).slice().reverse(),
    listItemsForRun: async (runId) => itemsStore.filter((i) => String(i.plannerRunId) === String(runId)),
    createItem: async (input) => {
      const item = { id: String(itemsStore.length + 1), ...input };
      itemsStore.push(item);
      return item;
    },
    updateRun: async (id, userId, fields) => {
      const run = runsStore.find((r) => String(r.id) === String(id));
      if (run) Object.assign(run, fields);
      return run;
    },
  };

  const jobs = { enqueueJob: async (job) => { enqueued.push(job); return { job, created: true }; } };
  // Items are updated in place by regeneration; the store holds objects, so a
  // patch has to land on the one the service was given.
  runs.updateItem = async (itemId, uid, fields) => {
    const item = itemsStore.find((i) => String(i.id) === String(itemId));
    if (item) Object.assign(item, fields);
    return item || null;
  };
  const uploads = [];
  const mediaLibraryService = {
    uploadImage: async (userId, file) => { uploads.push(file); return { id: `media_${uploads.length}` }; },
  };

  const svc = createWeekService({
    runs,
    jobs,
    mediaLibraryService,
    // No network in unit tests. The photograph path has its own file
    // (posterPhoto.test.js); left unstubbed this would really try to resolve
    // x.test on every run.
    fetchPhoto: async () => ({ photo: null, reason: 'unreachable' }),
    planner: planner || (async () => PLAN),
    generatePost: generatePost || (async () => ({
      copy: {
        headline: 'Dry basements', subtext: 'We stop water', cta: 'Get a quote',
        captions: { facebook: 'FB copy', instagram: 'IG copy', threads: 'TH copy' },
        hashtags: ['#waterproofing'],
      },
      markup: '<svg/>',
      png: Buffer.from('89504e470d0a1a0a', 'hex'),
      imageError: null,
    })),
    now: () => new Date('2026-07-26T08:00:00Z'),
  });

  return { svc, runsStore, itemsStore, enqueued, uploads, parts: { runs, mediaLibraryService, fetchPhoto: async () => ({ photo: null, reason: 'unreachable' }), planner: async () => PLAN, generatePost: async () => ({ copy: { headline: "H", subtext: "", cta: "", captions: { facebook: "FB" }, hashtags: [] }, png: Buffer.from("89504e470d0a1a0a","hex"), imageError: null }) } };
}

test('starting a week returns the plan at once and queues one job per day', async () => {
  const { svc, enqueued, runsStore } = build();
  const out = await svc.startWeek('7', BRAND, { timezone: 'Asia/Karachi' });

  // The plan comes back in the response: seven ideas the user can see while the
  // posters are still being built.
  assert.equal(out.plan.length, 7);
  assert.ok(out.runId);

  assert.equal(enqueued.length, 7, 'one durable job per day');
  assert.ok(enqueued.every((j) => j.jobType === JOB_TYPES.AI_STUDIO_POST));
  // A replayed request cannot double a post: the key is the run and the day.
  const keys = enqueued.map((j) => j.idempotencyKey);
  assert.equal(new Set(keys).size, 7);
  assert.match(keys[0], /^ai_studio:\d+:day:1$/);

  // The brand and plan are stored ON the run, so a later profile edit cannot
  // change a week that is already generating.
  const run = runsStore[0];
  assert.equal(run.settings.engine, 'ai_studio');
  assert.equal(run.settings.brand.businessName, 'NYC Waterproofing');
  assert.equal(run.settings.plan.length, 7);
  assert.equal(run.timezone, 'Asia/Karachi');
});

test('a post job builds that day post, with its own angle and all three platforms', async () => {
  const angles = [];
  const { svc, itemsStore } = build({
    generatePost: async (input) => {
      angles.push(input.angle);
      return {
        copy: {
          headline: `Head ${input.angle}`, subtext: '', cta: '',
          captions: { facebook: 'FB', instagram: 'IG', threads: 'TH' }, hashtags: ['#x'],
        },
        png: Buffer.from('89504e470d0a1a0a', 'hex'), imageError: null,
      };
    },
  });
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 3 } });

  assert.equal(itemsStore.length, 1);
  const item = itemsStore[0];
  assert.equal(item.position, 2, 'day 3 is the third post');
  assert.ok(angles[0].includes('Angle 3'), 'the post is built from ITS day angle, not a generic one');
  assert.deepEqual(item.platformTargets, ['facebook', 'instagram', 'threads']);
  assert.equal(item.platformCaptions.instagram.caption, 'IG');
  assert.equal(item.approvalStatus, PLANNER_ITEM_STATUS.NEEDS_REVIEW, 'a week is reviewed, never auto-approved');
  assert.equal(item.imageStatus, IMAGE_RENDER_STATUS.READY);
  assert.equal(item.mediaAssetId, 'media_1');
  assert.equal(item.fingerprint.day, 3);
});

/*
 * The job may run twice — a lost lease, a worker restart mid-flight. Building
 * the post again would give the user two posts for one day, and later two
 * published posts.
 */
test('a retried job does not build the same day twice', async () => {
  const { svc, itemsStore } = build();
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 2 } });
  await svc.runPostJob({ userId: '7', payload: { runId, day: 2 } });
  assert.equal(itemsStore.length, 1, 'the second run is a no-op');
});

test('the run is marked ready only when every planned day exists', async () => {
  const { svc, runsStore } = build();
  const { runId } = await svc.startWeek('7', BRAND);
  for (let day = 1; day <= 6; day += 1) {
    // eslint-disable-next-line no-await-in-loop
    await svc.runPostJob({ userId: '7', payload: { runId, day } });
  }
  assert.notEqual(runsStore[0].status, 'review', 'six of seven is not a finished week');
  await svc.runPostJob({ userId: '7', payload: { runId, day: 7 } });
  assert.equal(runsStore[0].status, 'review', 'a finished week is one to REVIEW, not one that is done');
});

test('a poster that fails to render still leaves a post, with a safe retryable state', async () => {
  const { svc, itemsStore, uploads } = build({
    generatePost: async () => ({
      copy: { headline: 'H', subtext: '', cta: '', captions: { facebook: 'FB' }, hashtags: [] },
      png: null,
      imageError: new Error('render service unavailable'),
    }),
  });
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });

  const item = itemsStore[0];
  assert.equal(item.caption, 'FB', 'the copy still shipped');
  assert.equal(item.imageStatus, IMAGE_RENDER_STATUS.FAILED);
  assert.equal(item.imageProvider, PROVIDER_NAMES.AI_STUDIO);
  assert.ok(item.imageErrorMessage, 'the reason is recorded, never a silent "no image"');
  assert.equal(uploads.length, 0);
});

test('progress reports the plan and how much of it is built', async () => {
  const { svc } = build();
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });
  await svc.runPostJob({ userId: '7', payload: { runId, day: 2 } });

  const week = await svc.getWeek('7', runId);
  assert.equal(week.total, 7);
  assert.equal(week.ready, 2);
  assert.equal(week.plan.length, 7);
  assert.equal(week.posts.length, 2);
  assert.equal(week.posts[0].day, 1);
  assert.equal(week.posts[0].captions.instagram, 'IG copy');

  // Another user's week is not readable.
  assert.equal(await svc.getWeek('999', runId), null);
});

/*
 * A week takes five to eight minutes to build, which is long enough to close the
 * tab — and the run id only ever lived in that tab. Without finding the week by
 * asking, a refresh abandoned posters that were still being made and would keep
 * being made: finished work nobody could reach.
 */
test('the week in progress is found without being given its id', async () => {
  const { svc, runsStore } = build();
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });

  const week = await svc.findLatestWeek('7');
  assert.equal(week.runId, runId);
  assert.equal(week.ready, 1);
  assert.equal(week.total, 7);

  // A run that is not a studio week is not the week to restore.
  runsStore.push({ id: '999', userId: '7', settings: { engine: 'something_else' } });
  assert.equal((await svc.findLatestWeek('7')).runId, runId);

  // Someone else's week is not this user's, and a user with none gets none.
  assert.equal(await svc.findLatestWeek('123'), null);
});

test('a week for a user who does not own the run does nothing', async () => {
  const { svc, itemsStore } = build();
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '999', payload: { runId, day: 1 } });
  assert.equal(itemsStore.length, 0, 'ownership is checked before any work');
});

/*
 * ---- regeneration ---------------------------------------------------------
 *
 * Two separate asks, because they are two separate dissatisfactions. Someone who
 * does not like the picture is not asking for the words to be rewritten.
 */

/** A week service whose jobs table can be read back, as regeneration needs. */
function withJobStore(extra = {}) {
  const enqueued = [];
  const jobRows = [];
  const base = build();
  const svc = createWeekService({
    ...base.parts,
    jobs: {
      enqueueJob: async (job) => { enqueued.push(job); jobRows.push({ ...job, status: 'pending', attemptCount: 0 }); return { created: true }; },
      listJobsByKeyPrefix: async (userId, prefix) =>
        jobRows.filter((j) => String(j.idempotencyKey).startsWith(prefix)),
    },
    ...extra,
  });
  return { svc, enqueued, jobRows, items: base.itemsStore };
}

test('regenerating a poster designs again without rewriting the words', async () => {
  const designs = [];
  const { svc, enqueued, items } = withJobStore({
    designOnly: async (input) => {
      designs.push(input);
      return { markup: '<svg/>', png: Buffer.from('89504e470d0a1a0a', 'hex'), imageError: null };
    },
    generateCopy: async () => { throw new Error('copy must NOT be rewritten for a poster'); },
  });

  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });
  const before = { ...items[0] };

  const asked = await svc.requestRegenerate('7', runId, 1, 'poster');
  assert.equal(asked.queued, true);
  const job = enqueued.find((j) => j.payload?.regenerate === 'poster');
  assert.ok(job, 'a durable job carries the work, so a closed tab does not lose it');
  assert.match(job.idempotencyKey, /^ai_studio:\d+:day:1:poster:1$/);
  // The card can say so before the worker even starts.
  assert.equal(items[0].imageStatus, IMAGE_RENDER_STATUS.QUEUED);

  await svc.runPostJob(job);

  assert.equal(designs.length, 1, 'exactly one design call');
  assert.equal(designs[0].content.headline, before.headline, 'the poster keeps its own words');
  assert.equal(items[0].caption, before.caption, 'the captions are untouched');
  assert.equal(items[0].imageStatus, IMAGE_RENDER_STATUS.READY);
  assert.equal(items[0].mediaAssetId, 'media_2', 'the new poster replaced the old one');
  assert.equal(items[0].regenerationCount, 1);
});

test('regenerating captions writes new copy and leaves the poster alone', async () => {
  const { svc, enqueued, items } = withJobStore({
    generateCopy: async () => ({
      headline: 'IGNORED', subtext: '', cta: '',
      captions: { facebook: 'Second FB', instagram: 'Second IG', threads: 'Second TH' },
      hashtags: ['#new'],
    }),
    designOnly: async () => { throw new Error('the poster must NOT be redrawn for a caption'); },
  });

  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 2 } });
  const posterBefore = items[0].mediaAssetId;
  const headlineBefore = items[0].headline;

  await svc.requestRegenerate('7', runId, 2, 'caption');
  const job = enqueued.find((j) => j.payload?.regenerate === 'caption');
  await svc.runPostJob(job);

  assert.equal(items[0].platformCaptions.instagram.caption, 'Second IG');
  assert.equal(items[0].caption, 'Second FB');
  assert.deepEqual(items[0].hashtags, ['#new']);
  assert.equal(items[0].mediaAssetId, posterBefore, 'the poster is the same file');
  assert.equal(
    items[0].headline, headlineBefore,
    'the on-poster words are SET IN THE IMAGE: changing them here would describe a poster that says something else',
  );
});

/*
 * An impatient double-click should not buy two posters: each is a model call and
 * a render, and the second would overwrite the first for nothing.
 */
test('asking twice while one is still running is refused, not queued', async () => {
  const { svc, enqueued } = withJobStore({
    designOnly: async () => ({ markup: '<svg/>', png: Buffer.from('89504e470d0a1a0a', 'hex'), imageError: null }),
  });
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });

  const first = await svc.requestRegenerate('7', runId, 1, 'poster');
  const second = await svc.requestRegenerate('7', runId, 1, 'poster');

  assert.equal(first.queued, true);
  assert.equal(second.queued, false);
  assert.equal(second.alreadyRunning, true);
  assert.equal(enqueued.filter((j) => j.payload?.regenerate === 'poster').length, 1);
});

/*
 * A failed retry that also erased the poster the user already had would punish
 * them for asking.
 */
test('a regeneration that fails leaves the poster the user already had', async () => {
  const { svc, enqueued, items } = withJobStore({
    designOnly: async () => ({ markup: null, png: null, imageError: new Error('render service unavailable') }),
  });
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });
  const kept = items[0].mediaAssetId;

  await svc.requestRegenerate('7', runId, 1, 'poster');
  const job = enqueued.find((j) => j.payload?.regenerate === 'poster');
  await assert.rejects(() => svc.runPostJob(job), 'it throws so the durable job retries');

  assert.equal(items[0].mediaAssetId, kept, 'the old poster is still there');
  assert.equal(items[0].imageStatus, IMAGE_RENDER_STATUS.READY, 'and is still shown as ready');
  assert.ok(items[0].imageErrorMessage, 'with the reason recorded');
});

test('a day that is being redone says which half of it is busy', async () => {
  const { svc, jobRows, items } = withJobStore({
    designOnly: async () => ({ markup: '<svg/>', png: Buffer.from('89504e470d0a1a0a', 'hex'), imageError: null }),
  });
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });
  await svc.runPostJob({ userId: '7', payload: { runId, day: 2 } });
  await svc.requestRegenerate('7', runId, 1, 'poster');
  await svc.requestRegenerate('7', runId, 2, 'caption');

  const week = await svc.getWeek('7', runId);
  const byDay = new Map(week.posts.map((p) => [p.day, p]));
  assert.equal(byDay.get(1).regenerating, 'poster');
  assert.equal(byDay.get(2).regenerating, 'caption');

  // A finished regeneration is no longer "busy".
  jobRows.forEach((j) => { j.status = 'completed'; });
  const after = await svc.getWeek('7', runId);
  assert.equal(after.posts.every((p) => p.regenerating === null), true);
  assert.equal(items.length, 2);
});

test('another user cannot regenerate this week, and neither can a day that is not there', async () => {
  const { svc, enqueued } = withJobStore();
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });

  assert.equal(await svc.requestRegenerate('999', runId, 1, 'poster'), null, 'ownership first');
  assert.equal(await svc.requestRegenerate('7', runId, 6, 'poster'), null, 'a day with no post');
  assert.equal(await svc.requestRegenerate('7', runId, 1, 'everything'), null, 'only the two named pieces');
  assert.equal(enqueued.filter((j) => j.payload?.regenerate).length, 0);
});

/*
 * ---- activate --------------------------------------------------------------
 *
 * The end of the product's single path: choose the accounts, choose a timezone
 * and a daily time, press once. One post goes out straight away and the rest
 * follow one a day, for ever, without the app being open.
 */

/** A service whose queueing is recorded rather than performed. */
function withQueue(extra = {}) {
  const base = build();
  const queued = [];
  const svc = createWeekService({
    ...base.parts,
    jobs: { enqueueJob: async () => ({ created: true }), listJobsByKeyPrefix: async () => [] },
    queue: async (userId, runId, itemIds) => { queued.push({ userId, runId, itemIds }); return { queued: itemIds, skipped: [] }; },
    now: () => new Date('2026-07-28T04:00:00Z'), // 09:00 in Asia/Karachi
    ...extra,
  });
  return { svc, queued, items: base.itemsStore, runs: base.runsStore };
}

async function seedWeek(svc, days = 3) {
  const { runId } = await svc.startWeek('7', BRAND);
  for (let d = 1; d <= days; d += 1) {
    // eslint-disable-next-line no-await-in-loop
    await svc.runPostJob({ userId: '7', payload: { runId, day: d } });
  }
  return runId;
}

test('activating schedules the first post now and the rest one a day', async () => {
  const { svc, queued, items, runs: runsStore } = withQueue();
  const runId = await seedWeek(svc, 3);

  const out = await svc.activateWeek('7', runId, {
    accountIds: ['11', '12', '11'],
    timezone: 'Asia/Karachi',
    dailyTime: '18:30',
  });

  assert.equal(out.queued, 3);
  assert.deepEqual(out.accountIds, ['11', '12'], 'the same account twice is still one account');
  assert.equal(out.dailyTime, '18:30');

  /*
   * The first post must be in the FUTURE. Queueing skips a slot whose time has
   * passed, so scheduling "now" would silently drop the one post the user was
   * promised would go immediately.
   */
  assert.equal(items[0].scheduledFor, '2026-07-28 04:02:00');
  // 18:30 Karachi is 13:30 UTC. Today's 18:30 is still ahead of 04:02, so the
  // daily run starts TODAY for post 2.
  assert.equal(items[1].scheduledFor, '2026-07-28 13:30:00');
  assert.equal(items[2].scheduledFor, '2026-07-29 13:30:00');
  assert.ok(items.every((i) => i.originalTimezone === 'Asia/Karachi'));

  // Activating IS the approval: the review step is the screen they pressed it on.
  assert.ok(items.every((i) => i.approvalStatus === PLANNER_ITEM_STATUS.APPROVED));

  /*
   * The selection lives on the RUN. Queueing deliberately holds no account list
   * of its own — an earlier version built one and attached seven Facebook Pages
   * to a single post.
   */
  assert.deepEqual(runsStore[0].settings.selectedAccountIds, ['11', '12']);
  assert.equal(runsStore[0].timezone, 'Asia/Karachi');
  assert.equal(queued.length, 1, 'queueing is called once, not per item');
});

/*
 * Wall clock, not "every 24 hours". Someone who picks 09:00 means nine in the
 * morning every morning.
 */
test('a daily time that has already passed today starts tomorrow', async () => {
  const { svc, items } = withQueue();
  const runId = await seedWeek(svc, 2);

  // 04:00 UTC is 09:00 in Karachi, so 06:00 local is already gone.
  await svc.activateWeek('7', runId, { accountIds: ['11'], timezone: 'Asia/Karachi', dailyTime: '06:00' });

  assert.equal(items[0].scheduledFor, '2026-07-28 04:02:00', 'the first still goes now');
  assert.equal(items[1].scheduledFor, '2026-07-29 01:00:00', 'tomorrow 06:00 Karachi = 01:00 UTC');
});

test('the same daily time means the same wall clock in any timezone', async () => {
  for (const [tz, expected] of [
    ['Asia/Karachi', '2026-07-28 13:30:00'],
    ['America/New_York', '2026-07-28 22:30:00'],
    ['UTC', '2026-07-28 18:30:00'],
  ]) {
    const { svc, items } = withQueue();
    // eslint-disable-next-line no-await-in-loop
    const runId = await seedWeek(svc, 2);
    // eslint-disable-next-line no-await-in-loop
    await svc.activateWeek('7', runId, { accountIds: ['11'], timezone: tz, dailyTime: '18:30' });
    assert.equal(items[1].scheduledFor, expected, `${tz} 18:30`);
  }
});

test('activating refuses what it cannot honour', async () => {
  const { svc, queued } = withQueue();
  const runId = await seedWeek(svc, 2);

  await assert.rejects(
    () => svc.activateWeek('7', runId, { accountIds: [], timezone: 'UTC', dailyTime: '09:00' }),
    /at least one account/i,
    'nowhere to send it is not a schedule',
  );
  await assert.rejects(
    () => svc.activateWeek('7', runId, { accountIds: ['11'], timezone: 'Mars/Olympus', dailyTime: '09:00' }),
    /timezone/i,
  );
  for (const bad of ['', '9am', '25:00', '09:60', '9:5']) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      () => svc.activateWeek('7', runId, { accountIds: ['11'], timezone: 'UTC', dailyTime: bad }),
      /time of day/i,
      `"${bad}" is not a time`,
    );
  }
  assert.equal(queued.length, 0, 'nothing was queued by a refused activation');
  // Another user's week cannot be activated.
  assert.equal(await svc.activateWeek('999', runId, { accountIds: ['11'], timezone: 'UTC', dailyTime: '09:00' }), null);
});

/*
 * A week whose posts never appear has to be EXPLAINABLE. Half an hour of "0 / 7"
 * with nothing on screen to say why is the failure this covers: waiting and
 * "gave up after three tries" looked identical, and one of them needs the user
 * to do something.
 */
test('each unbuilt day reports which kind of "not yet" it is', async () => {
  const jobRows = [
    { id: '1', status: 'completed', idempotencyKey: 'ai_studio:1:day:1', attemptCount: 1, lastErrorCategory: null, lastErrorMessage: null },
    { id: '2', status: 'running', idempotencyKey: 'ai_studio:1:day:2', attemptCount: 1, lastErrorCategory: null, lastErrorMessage: null },
    { id: '3', status: 'pending', idempotencyKey: 'ai_studio:1:day:3', attemptCount: 0, lastErrorCategory: null, lastErrorMessage: null },
    { id: '4', status: 'retry_scheduled', idempotencyKey: 'ai_studio:1:day:4', attemptCount: 2, lastErrorCategory: 'rate_limited', lastErrorMessage: 'The AI is busy right now.' },
    { id: '5', status: 'failed', idempotencyKey: 'ai_studio:1:day:5', attemptCount: 3, lastErrorCategory: 'timeout', lastErrorMessage: 'The AI did not answer in time.' },
  ];
  const { svc, parts } = build();
  const withJobs = createWeekService({
    ...parts,
    jobs: { enqueueJob: async () => ({ created: true }), listJobsByKeyPrefix: async () => jobRows },
  });

  const { runId } = await withJobs.startWeek('7', BRAND);
  await withJobs.runPostJob({ userId: '7', payload: { runId, day: 1 } });

  const week = await withJobs.getWeek('7', runId);
  const byDay = new Map(week.days.map((d) => [d.day, d]));

  assert.equal(byDay.get(1).state, 'built');
  assert.equal(byDay.get(2).state, 'building');
  assert.equal(byDay.get(3).state, 'queued');
  assert.equal(byDay.get(4).state, 'retrying', 'a backoff after a transient failure is not "queued"');
  assert.equal(byDay.get(5).state, 'failed');
  assert.equal(byDay.get(5).error, 'The AI did not answer in time.', 'the reason reaches the screen');
  assert.equal(byDay.get(5).attempts, 3);
  assert.equal(week.failed, 1, 'the count says a week finished with a gap');
  assert.ok(svc, 'built helper is used');
});

/*
 * A poster that quietly has no photograph is indistinguishable from one that
 * was never meant to have one, and the owner is the only person who can fix
 * "that picture is a WebP" or "that address is gone". The same rule as never
 * turning a provider failure into a silent null.
 */
test('a post records whether it got a photograph, and why not', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  // A picture that arrived.
  const withPhoto = build();
  const svcOk = createWeekService({
    ...withPhoto.parts,
    fetchPhoto: async () => ({ photo: { dataUri: 'data:image/jpeg;base64,AA', mime: 'image/jpeg', bytes: 9 }, reason: null }),
    jobs: { enqueueJob: async () => ({ created: true }), listJobsByKeyPrefix: async () => [] },
  });
  const runA = (await svcOk.startWeek('7', BRAND)).runId;
  await svcOk.runPostJob({ userId: '7', payload: { runId: runA, day: 1 } });
  let week = await svcOk.getWeek('7', runA);
  assert.equal(week.posts[0].photo.used, true);
  assert.equal(week.posts[0].photo.reason, null);

  // A picture in a format the renderer cannot draw. The post is still built.
  const withoutPhoto = build();
  const svcNo = createWeekService({
    ...withoutPhoto.parts,
    fetchPhoto: async () => ({ photo: null, reason: 'unsupported_format' }),
    jobs: { enqueueJob: async () => ({ created: true }), listJobsByKeyPrefix: async () => [] },
  });
  const runB = (await svcNo.startWeek('7', BRAND)).runId;
  await svcNo.runPostJob({ userId: '7', payload: { runId: runB, day: 1 } });
  week = await svcNo.getWeek('7', runB);
  assert.equal(week.posts[0].photo.used, false);
  assert.match(week.posts[0].photo.reason, /JPEG and PNG/, 'a sentence the owner can act on, not a code');
  assert.ok(week.posts[0].headline, 'and the post itself is fine');
  assert.ok(png);
});

/*
 * A picture the user never ticked is a different situation from one that could
 * not be downloaded, and they need different answers.
 */
test('no ticked photograph says so, rather than blaming the website', async () => {
  const bare = build();
  const svc = createWeekService({
    ...bare.parts,
    fetchPhoto: async () => { throw new Error('must not be called'); },
    jobs: { enqueueJob: async () => ({ created: true }), listJobsByKeyPrefix: async () => [] },
  });
  const runId = (await svc.startWeek('7', { ...BRAND, images: [] })).runId;
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });

  const week = await svc.getWeek('7', runId);
  assert.equal(week.posts[0].photo.used, false);
  assert.match(week.posts[0].photo.reason, /ticked/i);
});

/*
 * ---- what one account may spend ------------------------------------------
 *
 * A week is fourteen model calls and seven renders, and every account on this
 * deployment shares ONE key and ONE small server. Without a bound, the first
 * curious person takes the service away from everyone else. These tests pin
 * that the bound is real, that it is counted from the rows rather than a
 * counter that can drift, and that it says so BEFORE the button rather than at
 * the moment of refusal.
 */

/** A service whose clock and run history the test controls. */
function withRuns(existing, at = '2026-07-26T08:00:00Z') {
  const base = build();
  const store = [...existing];
  return createWeekService({
    ...base.parts,
    runs: {
      ...base.parts.runs,
      listRunsForUser: async () => store.slice().reverse(),
      createRun: async (input) => {
        const run = { id: String(store.length + 1), ...input, createdAt: at.replace('T', ' ').replace('Z', '') };
        store.push(run);
        return run;
      },
    },
    jobs: { enqueueJob: async () => ({ created: true }), listJobsByKeyPrefix: async () => [] },
    now: () => new Date(at),
  });
}

const studioRun = (createdAt) => ({ userId: '7', settings: { engine: 'ai_studio' }, createdAt });

test('two weeks in seven days, and the third is refused with a reason', async () => {
  const svc = withRuns([
    studioRun('2026-07-24 10:00:00'),
    studioRun('2026-07-25 10:00:00'),
  ]);

  const left = await svc.weeksRemaining('7');
  assert.equal(left.limit, 2);
  assert.equal(left.used, 2);
  assert.equal(left.remaining, 0);
  assert.ok(left.nextAvailableAt, 'and it says when one comes back');

  await assert.rejects(
    () => svc.startWeek('7', BRAND),
    /limit for now/i,
    'the refusal explains itself rather than failing silently',
  );
});

test('a week that has aged past seven days does not count', async () => {
  // 2026-07-18 is more than seven days before 2026-07-26.
  const svc = withRuns([studioRun('2026-07-18 10:00:00'), studioRun('2026-07-25 10:00:00')]);
  const left = await svc.weeksRemaining('7');
  assert.equal(left.used, 1, 'a rolling seven days, not a calendar week');
  assert.equal(left.remaining, 1);
  const out = await svc.startWeek('7', BRAND);
  assert.ok(out.runId, 'and the week is allowed');
});

/*
 * The allowance is checked BEFORE the planning call, because the planning call
 * is the first thing that costs money.
 */
test('a refused week never reaches the model', async () => {
  let planned = 0;
  const base = build();
  const svc = createWeekService({
    ...base.parts,
    planner: async () => { planned += 1; return PLAN; },
    runs: { ...base.parts.runs, listRunsForUser: async () => [studioRun('2026-07-25 10:00:00'), studioRun('2026-07-25 11:00:00')] },
    jobs: { enqueueJob: async () => ({ created: true }), listJobsByKeyPrefix: async () => [] },
    now: () => new Date('2026-07-26T08:00:00Z'),
  });
  await assert.rejects(() => svc.startWeek('7', BRAND));
  assert.equal(planned, 0, 'nothing was spent on a week that was never going to be made');
});

test('a run that is not a studio week does not use up the allowance', async () => {
  const svc = withRuns([
    { userId: '7', settings: { engine: 'make' }, createdAt: '2026-07-25 10:00:00' },
    { userId: '7', settings: {}, createdAt: '2026-07-25 11:00:00' },
  ]);
  const left = await svc.weeksRemaining('7');
  assert.equal(left.used, 0);
  assert.equal(left.remaining, 2);
});

/*
 * "I'll just try one more" has no natural stopping point, and every attempt is
 * a model call and a render.
 */
test('regenerations on one week are capped, and the cap says so', async () => {
  const base = build();
  const jobRows = [];
  const svc = createWeekService({
    ...base.parts,
    jobs: {
      enqueueJob: async (job) => { jobRows.push({ ...job, status: 'completed' }); return { created: true }; },
      listJobsByKeyPrefix: async (u, prefix) => jobRows.filter((j) => String(j.idempotencyKey).startsWith(prefix)),
    },
  });
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '7', payload: { runId, day: 1 } });

  // Twelve are allowed; the thirteenth is not.
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const out = await svc.requestRegenerate('7', runId, 1, i % 2 ? 'caption' : 'poster');
    assert.equal(out.queued, true, `regeneration ${i + 1} should be allowed`);
    // Mark it finished so the next one is not refused as "already running".
    jobRows.forEach((j) => { j.status = 'completed'; });
  }
  const refused = await svc.requestRegenerate('7', runId, 1, 'poster');
  assert.equal(refused.queued, false);
  assert.equal(refused.limitReached, true);
  assert.match(refused.message, /limit/i);
});
