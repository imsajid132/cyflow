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
    listItemsForRun: async (runId) => itemsStore.filter((i) => String(i.plannerRunId) === String(runId)),
    createItem: async (input) => { itemsStore.push(input); return input; },
    updateRun: async (id, userId, fields) => {
      const run = runsStore.find((r) => String(r.id) === String(id));
      if (run) Object.assign(run, fields);
      return run;
    },
  };

  const jobs = { enqueueJob: async (job) => { enqueued.push(job); return { job, created: true }; } };
  const uploads = [];
  const mediaLibraryService = {
    uploadImage: async (userId, file) => { uploads.push(file); return { id: `media_${uploads.length}` }; },
  };

  const svc = createWeekService({
    runs,
    jobs,
    mediaLibraryService,
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

  return { svc, runsStore, itemsStore, enqueued, uploads };
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
  assert.equal(week.items.length, 2);

  // Another user's week is not readable.
  assert.equal(await svc.getWeek('999', runId), null);
});

test('a week for a user who does not own the run does nothing', async () => {
  const { svc, itemsStore } = build();
  const { runId } = await svc.startWeek('7', BRAND);
  await svc.runPostJob({ userId: '999', payload: { runId, day: 1 } });
  assert.equal(itemsStore.length, 0, 'ownership is checked before any work');
});
