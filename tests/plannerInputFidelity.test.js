/**
 * Phase 4.8 — input fidelity.
 *
 * What the user chose for THIS run is what the run gets. The failure this
 * guards against is a saved default quietly winning: a plan generated for
 * Asia/Karachi coming back in a saved American timezone, or a Facebook Page
 * appearing in a plan the user built for Instagram and Threads.
 *
 * The strongest version of the platform test connects ALL THREE providers and
 * selects two. An unselected platform that is not even connected proves
 * nothing; an unselected platform that IS connected and still stays out is the
 * real contract.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlannerService } from '../src/services/plannerService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';
import {
  createFakeSocialAccountRepository,
  createFakePostRepository,
  createFakeMediaAssetRepository,
  createFakeApiUsageRepository,
  createFakeBusinessProfileRepository,
  createFakePlannerPreferenceRepository,
  createFakePlannerRunRepository,
  createFakePlannerOpenAI,
  createFakeSocialImageService,
  fakeWithTransaction,
} from './helpers/fakes.js';

const noopLogging = { record: async () => {} };
const USER = '5';
const NOW = new Date('2026-07-13T06:00:00Z'); // a Monday

function build(extra = {}) {
  const socialAccounts = createFakeSocialAccountRepository();
  const posts = createFakePostRepository({ socialAccounts });
  const media = createFakeMediaAssetRepository();
  const businessProfiles = createFakeBusinessProfileRepository();
  const preferences = createFakePlannerPreferenceRepository();
  const runs = createFakePlannerRunRepository();
  const openai = extra.openai ?? createFakePlannerOpenAI();
  const images = { ...createFakeSocialImageService(), isReadyForUser: async () => true };

  const svc = createPlannerService({
    preferences,
    runs,
    businessProfiles,
    socialAccounts,
    posts,
    mediaRepository: media,
    apiUsage: createFakeApiUsageRepository(),
    openaiContentService: openai,
    socialImageService: images,
    mediaAssetService: createMediaAssetService({ mediaRepository: media }),
    uniqueness: contentUniquenessService,
    logging: noopLogging,
    withTransaction: fakeWithTransaction,
    now: () => NOW,
  });
  return { svc, socialAccounts, businessProfiles, preferences, runs, posts, openai };
}

/** Connect every supported provider, so platform selection is a real choice. */
async function seedAllProviders(socialAccounts) {
  const rows = [
    ['facebook_page', 'meta', 'fb_1'],
    ['instagram_professional', 'instagram', 'ig_1'],
    ['threads_profile', 'threads', 'th_1'],
  ];
  for (const [accountType, provider, id] of rows) {
    // eslint-disable-next-line no-await-in-loop
    await socialAccounts.upsertSocialAccount({
      userId: USER,
      provider,
      accountType,
      providerAccountId: id,
      displayName: 'Account',
      username: 'acct',
      encryptedAccessToken: 'v1:x',
      scopes: [],
      providerMetadata: {},
      status: 'active',
    });
  }
}

async function seedProfile(businessProfiles) {
  return businessProfiles.createOrUpdateProfile(USER, {
    businessName: 'Cyfrow Solutions',
    businessCategory: 'SEO agency',
    services: ['Local SEO', 'On-Page SEO', 'SEO Audit'],
    defaultCallToAction: 'Ask us',
    primaryColor: '#111827',
    websiteUrl: 'https://cyfrowsolutions.com',
  });
}

async function setup(extra = {}) {
  const ctx = build(extra);
  await seedAllProviders(ctx.socialAccounts);
  await seedProfile(ctx.businessProfiles);
  return ctx;
}

/** The run options the brief's controlled test uses. */
const CYFROW_RUN = Object.freeze({
  startDate: '2026-07-14',
  planLength: 7,
  cadence: 'every_day',
  times: ['09:00'],
  postsPerDay: 1,
  timezone: 'Asia/Karachi',
  platforms: ['instagram', 'threads'],
  contentRhythmPreset: 'balanced',
});

// --- timezone ---------------------------------------------------------------

test('Asia/Karachi survives generation, storage and re-read', async () => {
  const ctx = await setup();
  // A saved preference in a DIFFERENT zone, which must not win.
  await ctx.svc.savePreferences(USER, { timezone: 'America/New_York' });

  const plan = await ctx.svc.generatePlan(USER, CYFROW_RUN);
  assert.equal(plan.run.timezone, 'Asia/Karachi');
  assert.equal(plan.run.settings.timezone, 'Asia/Karachi');
  for (const item of plan.items) {
    assert.equal(item.originalTimezone, 'Asia/Karachi', 'every item keeps the run timezone');
  }

  // "Refresh": read the plan back through the ordinary API.
  const reread = await ctx.svc.getPlan(USER, plan.run.id);
  assert.equal(reread.run.timezone, 'Asia/Karachi', 'a refresh must not mutate the run');
});

test('America/New_York survives when it is the explicit choice', async () => {
  const ctx = await setup();
  await ctx.svc.savePreferences(USER, { timezone: 'Asia/Karachi' });
  const plan = await ctx.svc.generatePlan(USER, { ...CYFROW_RUN, timezone: 'America/New_York' });
  assert.equal(plan.run.timezone, 'America/New_York');
});

test('with no explicit timezone the saved preference is used, not UTC', async () => {
  const ctx = await setup();
  await ctx.svc.savePreferences(USER, { timezone: 'Asia/Karachi' });
  const { timezone, ...withoutTz } = CYFROW_RUN;
  const plan = await ctx.svc.generatePlan(USER, withoutTz);
  assert.equal(plan.run.timezone, 'Asia/Karachi');
});

test('an invalid timezone is refused rather than silently replaced', async () => {
  const ctx = await setup();
  await assert.rejects(
    () => ctx.svc.generatePlan(USER, { ...CYFROW_RUN, timezone: 'Mars/Olympus' }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.ok(err.details?.some((d) => d.field === 'timezone'));
      return true;
    },
  );
});

// --- platforms --------------------------------------------------------------

test('Instagram plus Threads never gains Facebook, even with a Page connected', async () => {
  const ctx = await setup();
  // The saved default INCLUDES facebook. The explicit run must still win.
  await ctx.svc.savePreferences(USER, { platforms: ['facebook', 'instagram', 'threads'] });

  const plan = await ctx.svc.generatePlan(USER, CYFROW_RUN);
  assert.deepEqual(plan.run.settings.platforms, ['instagram', 'threads']);
  for (const item of plan.items) {
    assert.deepEqual(item.platformTargets, ['instagram', 'threads'], 'no item may gain Facebook');
    assert.ok(!item.platformTargets.includes('facebook'));
  }
});

test('a Facebook-only plan stays Facebook-only', async () => {
  const ctx = await setup();
  await ctx.svc.savePreferences(USER, { platforms: ['instagram', 'threads'] });
  const plan = await ctx.svc.generatePlan(USER, { ...CYFROW_RUN, platforms: ['facebook'] });
  assert.deepEqual(plan.run.settings.platforms, ['facebook']);
  for (const item of plan.items) assert.deepEqual(item.platformTargets, ['facebook']);
});

test('an unconnected platform cannot be planned for', async () => {
  const ctx = build();
  // Only Threads is connected.
  await ctx.socialAccounts.upsertSocialAccount({
    userId: USER, provider: 'threads', accountType: 'threads_profile',
    providerAccountId: 'th_1', displayName: 'A', username: 'a',
    encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active',
  });
  await seedProfile(ctx.businessProfiles);

  const plan = await ctx.svc.generatePlan(USER, { ...CYFROW_RUN, platforms: ['instagram', 'threads'] });
  assert.deepEqual(plan.run.settings.platforms, ['threads'], 'instagram is not connected, so it is dropped');
});

// --- schedule ---------------------------------------------------------------

test('the chosen dates, times and posts-per-day are exactly what the run stores', async () => {
  const ctx = await setup();
  await ctx.svc.savePreferences(USER, {
    times: ['08:00', '19:00'], postsPerDay: 2, defaultPlanLength: 14, cadence: 'weekdays',
  });

  const plan = await ctx.svc.generatePlan(USER, CYFROW_RUN);
  assert.equal(plan.run.startDate, '2026-07-14');
  assert.equal(plan.run.planLength, 7);
  assert.equal(plan.run.postsPerDay, 1);
  assert.deepEqual(plan.run.settings.times, ['09:00']);
  assert.equal(plan.run.settings.cadence, 'every_day');
  assert.equal(plan.items.length, 7, 'seven days, one post each');
});

test('two posts a day uses both chosen times and invents no third', async () => {
  const ctx = await setup();
  const plan = await ctx.svc.generatePlan(USER, {
    ...CYFROW_RUN, planLength: 2, postsPerDay: 2, times: ['09:00', '17:00'],
  });
  assert.equal(plan.items.length, 4, 'two days x two posts');
  assert.deepEqual(plan.run.settings.times, ['09:00', '17:00']);
  // Every scheduled time is one the user picked.
  const hours = new Set(plan.items.map((i) => String(i.scheduledFor).slice(11, 16)));
  for (const hour of hours) assert.ok(['04:00', '12:00'].includes(hour), `unexpected UTC time ${hour}`);
});

test('asking for more posts a day than times is refused, not padded', async () => {
  const ctx = await setup();
  await assert.rejects(
    () => ctx.svc.generatePlan(USER, { ...CYFROW_RUN, postsPerDay: 3, times: ['09:00'] }),
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    },
    'the planner must never invent a time to fill a slot',
  );
});

// --- rhythm -----------------------------------------------------------------

test('the chosen rhythm preset is what the run resolves and stores', async () => {
  const ctx = await setup();
  await ctx.svc.savePreferences(USER, { contentRhythmPreset: 'growth_promotion' });

  const plan = await ctx.svc.generatePlan(USER, { ...CYFROW_RUN, contentRhythmPreset: 'balanced' });
  assert.equal(plan.run.resolvedRhythm.preset, 'balanced', 'the explicit preset wins');
  assert.equal(plan.run.settings.rhythmPreset, 'balanced');
  // Tuesday (2026-07-14) is the first day: Balanced says Service Promotion.
  assert.equal(plan.items[0].contentPillar, 'service_promotion');
});

test('a saved rhythm applies when the run does not name one', async () => {
  const ctx = await setup();
  await ctx.svc.savePreferences(USER, {
    contentRhythmPreset: 'balanced',
    contentRhythm: { 2: { pillar: 'actionable_tips' } },
  });
  const { contentRhythmPreset, ...withoutRhythm } = CYFROW_RUN;
  const plan = await ctx.svc.generatePlan(USER, withoutRhythm);
  assert.equal(plan.items[0].contentPillar, 'actionable_tips', 'the saved custom Tuesday applies');
});

// --- the snapshot is immutable ----------------------------------------------

test('changing preferences afterwards never rewrites an existing run', async () => {
  const ctx = await setup();
  const plan = await ctx.svc.generatePlan(USER, CYFROW_RUN);

  const before = {
    timezone: plan.run.timezone,
    platforms: [...plan.run.settings.platforms],
    times: [...plan.run.settings.times],
    rhythm: plan.run.resolvedRhythm.preset,
    pillars: plan.items.map((i) => i.contentPillar),
  };

  // The user changes everything about their defaults afterwards.
  await ctx.svc.savePreferences(USER, {
    timezone: 'America/New_York',
    platforms: ['facebook'],
    times: ['06:00'],
    postsPerDay: 5,
    contentRhythmPreset: 'local_business',
    tone: 'promotional',
  });

  const after = await ctx.svc.getPlan(USER, plan.run.id);
  assert.equal(after.run.timezone, before.timezone);
  assert.deepEqual(after.run.settings.platforms, before.platforms);
  assert.deepEqual(after.run.settings.times, before.times);
  assert.equal(after.run.resolvedRhythm.preset, before.rhythm);
  assert.deepEqual(after.items.map((i) => i.contentPillar), before.pillars);
});

test('the run snapshot records the resolved configuration, not the raw request', async () => {
  const ctx = await setup();
  const plan = await ctx.svc.generatePlan(USER, CYFROW_RUN);
  const { settings } = plan.run;

  // Everything needed to explain the plan later, without re-reading preferences.
  for (const key of ['cadence', 'times', 'weekdays', 'postsPerDay', 'platforms', 'timezone', 'startDate', 'rhythmPreset', 'approvalMode']) {
    assert.ok(settings[key] !== undefined, `the snapshot is missing ${key}`);
  }
  assert.ok(plan.run.resolvedRhythm.weekdays, 'the rhythm snapshot must be complete');
  assert.equal(Object.keys(plan.run.resolvedRhythm.weekdays).length, 7);
});

test('a second run does not disturb the first', async () => {
  const ctx = await setup();
  const first = await ctx.svc.generatePlan(USER, CYFROW_RUN);
  const second = await ctx.svc.generatePlan(USER, {
    ...CYFROW_RUN, startDate: '2026-08-01', timezone: 'America/New_York', platforms: ['facebook'],
  });

  assert.notEqual(first.run.id, second.run.id);
  const firstAgain = await ctx.svc.getPlan(USER, first.run.id);
  assert.equal(firstAgain.run.timezone, 'Asia/Karachi');
  assert.deepEqual(firstAgain.run.settings.platforms, ['instagram', 'threads']);
  assert.equal(second.run.timezone, 'America/New_York');
});

// --- fidelity reaches the queue ---------------------------------------------

test('the platform selection reaches the queued post intact', async () => {
  const ctx = await setup();
  const plan = await ctx.svc.generatePlan(USER, { ...CYFROW_RUN, planLength: 1 });
  const item = plan.items[0];

  await ctx.svc.setItemStatus(USER, item.id, 'approved');
  const { queued } = await ctx.svc.queueApproved(USER, plan.run.id);
  assert.equal(queued.length, 1);

  const post = ctx.posts._posts.find((p) => String(p.id) === String(queued[0].postId));
  const delivered = post.generated_platform_captions_json;
  assert.deepEqual(Object.keys(delivered).sort(), ['instagram', 'threads']);
  assert.ok(!Object.keys(delivered).includes('facebook'), 'Facebook must not appear at the queue either');
});
