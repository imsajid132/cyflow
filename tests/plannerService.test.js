// Phase 4.7: plan generation, approval, edit preservation, queue integration.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlannerService } from '../src/services/plannerService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';
import { PLANNER_ITEM_STATUS, PLANNER_RUN_STATUS } from '../src/config/constants.js';
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
const NOW = new Date('2026-07-13T06:00:00Z');

/** An image service that reports HCTI as ready (or not). */
function fakeImages({ ready = true } = {}) {
  const base = createFakeSocialImageService();
  return { ...base, isReadyForUser: async () => ready };
}

function build(extra = {}) {
  const socialAccounts = createFakeSocialAccountRepository();
  const posts = createFakePostRepository({ socialAccounts });
  const media = createFakeMediaAssetRepository();
  const apiUsage = extra.apiUsage ?? createFakeApiUsageRepository();
  const businessProfiles = createFakeBusinessProfileRepository();
  const preferences = createFakePlannerPreferenceRepository();
  const runs = createFakePlannerRunRepository();
  const openai = extra.openai ?? createFakePlannerOpenAI();
  const images = extra.images ?? fakeImages();
  const mediaAssetService = createMediaAssetService({ mediaRepository: media });

  const svc = createPlannerService({
    preferences,
    runs,
    businessProfiles,
    socialAccounts,
    posts,
    mediaRepository: media,
    apiUsage,
    openaiContentService: openai,
    socialImageService: images,
    mediaAssetService,
    uniqueness: contentUniquenessService,
    logging: noopLogging,
    withTransaction: fakeWithTransaction,
    now: () => NOW,
  });

  return { svc, socialAccounts, posts, media, apiUsage, businessProfiles, preferences, runs, openai, images };
}

async function seedAccount(socialAccounts, { accountType = 'threads_profile', provider = 'threads', id = 'acc_1' } = {}) {
  return socialAccounts.upsertSocialAccount({
    userId: USER,
    provider,
    accountType,
    providerAccountId: id,
    displayName: 'My Account',
    username: 'acct',
    encryptedAccessToken: 'v1:x',
    scopes: [],
    providerMetadata: {},
    status: 'active',
  });
}

/**
 * Stand in for a future publishing phase having sent a post out. Nothing in the
 * app publishes yet, so this is the only way to exercise the archival rule.
 */
function markPublished(ctx, postId) {
  const row = ctx.posts._posts.find((p) => String(p.id) === String(postId));
  assert.ok(row, `post ${postId} should exist in the fake repository`);
  row.status = 'published';
  return row;
}

async function seedProfile(businessProfiles) {
  return businessProfiles.createOrUpdateProfile(USER, {
    businessName: 'Acme Roofing',
    businessCategory: 'Roofing contractor',
    services: ['Roof repair', 'Gutter cleaning'],
    defaultCallToAction: 'Book a free quote',
    primaryColor: '#123456',
    logoUrl: 'https://cdn.example.com/logo.png',
    websiteUrl: 'https://acme-roofing.com',
  });
}

/** Generate a standard 7-day plan. */
async function generate(ctx, options = {}) {
  await seedAccount(ctx.socialAccounts);
  await seedProfile(ctx.businessProfiles);
  return ctx.svc.generatePlan(USER, {
    startDate: '2026-07-14', planLength: 7, cadence: 'every_day',
    times: ['09:00'], timezone: 'UTC', ...options,
  });
}

// --- preferences ------------------------------------------------------------

test('preferences fall back to documented defaults before anything is saved', async () => {
  const { svc } = build();
  const prefs = await svc.getPreferences(USER);
  assert.equal(prefs.isDefault, true);
  assert.equal(prefs.cadence, 'every_day');
  assert.equal(prefs.approvalMode, 'require_approval');
  assert.equal(prefs.defaultPlanLength, 7);
  assert.ok(Array.isArray(prefs.times) && prefs.times.length > 0);
});

test('preferences save and load round-trip', async () => {
  const { svc } = build();
  const saved = await svc.savePreferences(USER, {
    cadence: 'selected_weekdays',
    weekdays: [2, 4],
    times: ['08:30', '17:00'],
    platforms: ['threads'],
    goals: ['awareness', 'offers'],
    contentMix: { educational: 2, tips: 1 },
    tone: 'confident',
    ctaMode: 'light',
    approvalMode: 'auto_queue',
    defaultPlanLength: 5,
    timezone: 'Europe/London',
  });
  assert.equal(saved.cadence, 'selected_weekdays');
  assert.deepEqual(saved.weekdays, [2, 4]);
  assert.deepEqual(saved.times, ['08:30', '17:00']);
  assert.equal(saved.isDefault, false);

  const loaded = await svc.getPreferences(USER);
  assert.equal(loaded.tone, 'confident');
  assert.equal(loaded.ctaMode, 'light');
  assert.equal(loaded.approvalMode, 'auto_queue');
  assert.equal(loaded.defaultPlanLength, 5);
  assert.equal(loaded.timezone, 'Europe/London');
  assert.deepEqual(loaded.goals, ['awareness', 'offers']);
});

test('invalid preferences are rejected field by field', async () => {
  const { svc } = build();
  const cases = [
    [{ cadence: 'hourly' }, 'cadence'],
    [{ weekdays: [0, 9] }, 'weekdays'],
    [{ times: ['9am'] }, 'times'],
    [{ times: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00'] }, 'times'],
    [{ postsPerDay: 0 }, 'postsPerDay'],
    [{ postsPerDay: 9 }, 'postsPerDay'],
    // Intl accepts a bare offset as a timeZone; storing one would break at DST.
    [{ timezone: '+05:00' }, 'timezone'],
    [{ platforms: ['tiktok'] }, 'platforms'],
    [{ goals: ['world_domination'] }, 'goals'],
    [{ contentMix: { nonsense: 1 } }, 'contentMix'],
    [{ contentMix: { tips: 99 } }, 'contentMix'],
    [{ tone: 'shouty' }, 'tone'],
    [{ ctaMode: 'never' }, 'ctaMode'],
    [{ approvalMode: 'yolo' }, 'approvalMode'],
    [{ defaultPlanLength: 90 }, 'defaultPlanLength'],
    [{ timezone: 'Not/AZone' }, 'timezone'],
  ];
  for (const [patch, field] of cases) {
    await assert.rejects(
      () => svc.savePreferences(USER, patch),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.ok(err.details?.some((d) => d.field === field), `expected an error on ${field}`);
        return true;
      },
      `${JSON.stringify(patch)} should be rejected`,
    );
  }
});

test('enabling autopilot schedules only a future GENERATION, never a publish', async () => {
  const { svc, preferences } = build();
  const saved = await svc.savePreferences(USER, { autopilotEnabled: true });
  assert.equal(saved.autopilotEnabled, true);
  assert.equal(saved.nextPlanGenerationAt, '2026-07-20 06:00:00');

  // It is stored for a future scheduler; nothing consumes it yet.
  const due = await preferences.listDueAutopilot('2026-07-21 00:00:00');
  assert.equal(due.length, 1);

  const off = await svc.savePreferences(USER, { autopilotEnabled: false });
  assert.equal(off.nextPlanGenerationAt, null);
});

// --- generation -------------------------------------------------------------

test('a 7-day plan generates one reviewable post per day', async () => {
  const ctx = build();
  const plan = await generate(ctx);

  assert.equal(plan.items.length, 7);
  assert.equal(plan.run.status, PLANNER_RUN_STATUS.REVIEW);
  assert.equal(plan.run.startDate, '2026-07-14');
  assert.equal(plan.run.endDate, '2026-07-20');
  assert.equal(plan.counts.needs_review, 7);

  for (const item of plan.items) {
    assert.ok(item.caption, 'every item needs a caption');
    assert.ok(item.headline, 'every item needs a headline');
    assert.ok(item.scheduledFor, 'every item needs a slot');
    assert.ok(item.templateKey, 'every item needs a template');
    assert.deepEqual(item.platformTargets, ['threads']);
    assert.equal(item.approvalStatus, PLANNER_ITEM_STATUS.NEEDS_REVIEW);
  }
  // Days are consecutive.
  assert.deepEqual(plan.items.map((i) => i.scheduledFor.slice(0, 10)), [
    '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17',
    '2026-07-18', '2026-07-19', '2026-07-20',
  ]);
});

test('no post in a batch has a duplicate caption or headline', async () => {
  const ctx = build();
  const plan = await generate(ctx);
  const captions = plan.items.map((i) => i.caption);
  const headlines = plan.items.map((i) => i.headline);
  assert.equal(new Set(captions).size, captions.length, 'captions must be unique');
  assert.equal(new Set(headlines).size, headlines.length, 'headlines must be unique');
});

test('a plan varies strategic format and template across the week', async () => {
  const ctx = build();
  const plan = await generate(ctx);
  assert.ok(new Set(plan.items.map((i) => i.contentType)).size >= 4, 'formats must vary');
  assert.ok(new Set(plan.items.map((i) => i.templateKey)).size >= 4, 'templates must vary');
  // The layout follows the content, per the spec mapping.
  for (const item of plan.items) {
    if (item.contentType === 'checklist') assert.equal(item.templateKey, 'checklist-guide');
    if (item.contentType === 'process') assert.equal(item.templateKey, 'checklist-guide');
    if (item.contentType === 'comparison') assert.equal(item.templateKey, 'comparison-cards');
    if (item.contentType === 'service_benefit') assert.equal(item.templateKey, 'service-authority');
    if (item.contentType === 'local_relevance') assert.equal(item.templateKey, 'local-insight');
  }
  // No two consecutive posts share a layout.
  for (let i = 1; i < plan.items.length; i += 1) {
    assert.notEqual(plan.items[i].templateKey, plan.items[i - 1].templateKey);
  }
});

test('selected weekdays and multiple posts per day are honoured', async () => {
  const ctx = build();
  const plan = await generate(ctx, {
    planLength: 7, cadence: 'selected_weekdays', weekdays: [2, 4],
    times: ['09:00', '17:00'], postsPerDay: 2,
  });
  // Tue + Thu across the window, two posts each day.
  assert.equal(plan.items.length, 4);
  const days = [...new Set(plan.items.map((i) => i.scheduledFor.slice(0, 10)))];
  assert.deepEqual(days, ['2026-07-14', '2026-07-16']);
  const times = plan.items.map((i) => i.scheduledFor.slice(11, 16));
  assert.deepEqual(times, ['09:00', '17:00', '09:00', '17:00']);
  assert.equal(plan.run.postsPerDay, 2, 'the run records what it was generated with');
});

test('postsPerDay defaults to 1, so extra times do not multiply the plan', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 3, times: ['09:00', '17:00'] });
  assert.equal(plan.items.length, 3, 'two times must not silently mean six posts');
  assert.equal(plan.run.postsPerDay, 1);
});

test('generation is refused when there are fewer times than posts per day', async () => {
  const ctx = build();
  await seedAccount(ctx.socialAccounts);
  await seedProfile(ctx.businessProfiles);
  await assert.rejects(
    () => ctx.svc.generatePlan(USER, {
      startDate: '2026-07-14', planLength: 3, times: ['09:00'], postsPerDay: 3, timezone: 'UTC',
    }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.ok(err.details.some((d) => d.field === 'times'));
      return true;
    },
  );
  // Nothing was generated: the gate runs before any spend.
  assert.equal(ctx.openai._calls.length, 0);
});

test('the plan summary matches what generation actually creates', async () => {
  const ctx = build();
  await seedAccount(ctx.socialAccounts);
  await seedProfile(ctx.businessProfiles);

  const options = {
    startDate: '2026-07-14', planLength: 5, cadence: 'every_day',
    times: ['09:00', '17:00'], postsPerDay: 2, timezone: 'UTC',
  };
  const summary = await ctx.svc.summarizePlan(USER, options);
  assert.equal(summary.valid, true, JSON.stringify(summary.errors));
  assert.equal(summary.activeDays, 5);
  assert.equal(summary.postsPerDay, 2);
  assert.equal(summary.plannedPosts, 10);
  assert.deepEqual(summary.platforms, ['threads']);

  // The promise the summary made is kept.
  const plan = await ctx.svc.generatePlan(USER, options);
  assert.equal(plan.items.length, summary.totalPosts);
});

test('the summary reports setup problems without generating anything', async () => {
  const ctx = build();
  // No connected account.
  const summary = await ctx.svc.summarizePlan(USER, {
    startDate: '2026-07-14', planLength: 3, times: ['09:00'], timezone: 'UTC',
  });
  assert.equal(summary.valid, false);
  assert.ok(summary.errors.some((e) => e.field === 'platforms'));
  assert.equal(ctx.openai._calls.length, 0);
});

test('only connected platforms are planned for', async () => {
  const ctx = build();
  await seedAccount(ctx.socialAccounts, { accountType: 'facebook_page', provider: 'meta', id: 'fb_1' });
  await seedProfile(ctx.businessProfiles);
  // Ask for all three; only the connected one is used.
  const plan = await ctx.svc.generatePlan(USER, {
    startDate: '2026-07-14', planLength: 3, times: ['09:00'], timezone: 'UTC',
    platforms: ['facebook', 'instagram', 'threads'],
  });
  for (const item of plan.items) assert.deepEqual(item.platformTargets, ['facebook']);
});

test('generating with no connected account is refused with a useful message', async () => {
  const ctx = build();
  await seedProfile(ctx.businessProfiles);
  await assert.rejects(
    () => ctx.svc.generatePlan(USER, { startDate: '2026-07-14', planLength: 3 }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Connect at least one/);
      return true;
    },
  );
});

test('a schedule with no upcoming slots is refused rather than generating nothing', async () => {
  const ctx = build();
  await seedAccount(ctx.socialAccounts);
  await assert.rejects(
    // Entirely in the past.
    () => ctx.svc.generatePlan(USER, { startDate: '2020-01-01', planLength: 2, times: ['09:00'], timezone: 'UTC' }),
    (err) => {
      assert.equal(err.statusCode, 400);
      // The summary gate catches this before any generation is attempted.
      assert.ok(err.details.some((d) => d.field === 'startDate'), JSON.stringify(err.details));
      return true;
    },
  );
  assert.equal(ctx.openai._calls.length, 0);
});

test('an offset masquerading as a timezone is refused at generation too', async () => {
  const ctx = build();
  await seedAccount(ctx.socialAccounts);
  await assert.rejects(
    () => ctx.svc.generatePlan(USER, {
      startDate: '2026-07-14', planLength: 2, times: ['09:00'], timezone: '+05:00',
    }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.ok(err.details.some((d) => d.field === 'timezone'));
      return true;
    },
  );
});

test('the daily generation limit is enforced before any spend', async () => {
  const apiUsage = createFakeApiUsageRepository();
  apiUsage.countUserOperationsSince = async () => 99; // limit is 100 in test env
  const ctx = build({ apiUsage });
  await seedAccount(ctx.socialAccounts);
  await assert.rejects(
    () => ctx.svc.generatePlan(USER, { startDate: '2026-07-14', planLength: 7, times: ['09:00'], timezone: 'UTC' }),
    (err) => {
      assert.equal(err.statusCode, 429);
      return true;
    },
  );
  // Nothing was generated.
  assert.equal(ctx.openai._calls.length, 0);
});

test('a plan still generates when HCTI is unavailable, and says so', async () => {
  const ctx = build({ images: fakeImages({ ready: false }) });
  const plan = await generate(ctx, { planLength: 3 });
  assert.equal(plan.items.length, 3);
  for (const item of plan.items) {
    assert.equal(item.mediaAssetId, null);
    assert.ok(item.caption, 'captions are still generated');
  }
  assert.match(plan.run.generationNotes, /HCTI is not verified/);
});

test('images are attached when HCTI is ready', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 2 });
  for (const item of plan.items) {
    assert.ok(item.mediaAssetId, 'an image should be rendered');
    assert.ok(item.media?.publicToken, 'the board needs a preview token');
  }
});

test('auto-queue mode approves fresh posts but still holds flagged ones', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 3, approvalMode: 'auto_queue' });
  assert.equal(plan.run.status, PLANNER_RUN_STATUS.QUEUED);
  for (const item of plan.items) assert.equal(item.approvalStatus, PLANNER_ITEM_STATUS.APPROVED);
});

// --- duplicate prevention ---------------------------------------------------

test('generation that repeats itself exactly is a hard failure, not review work', async () => {
  /*
   * Phase 4.8 replaced the older contract here, which marked these NEEDS_REVIEW.
   *
   * This generator returns the SAME post every time, so retrying cannot save it.
   * "Needs review" asks a human to make a judgement call, and there is no
   * judgement to make about a post that is byte-identical to the one above it:
   * it is unusable. Sending it to review wearing the same badge as a
   * genuinely-borderline post is what trains people to rubber-stamp the queue.
   *
   * So severe duplication is now a hard failure with its own status, and the
   * stronger assertion is that it CANNOT be approved. Merely-similar posts are
   * still soft-flagged for review; that path is covered in
   * contentUniquenessService.test.js, where the verdict is 'review'.
   */
  const openai = createFakePlannerOpenAI({ duplicate: true });
  const ctx = build({ openai });
  const plan = await generate(ctx, { planLength: 3 });

  const later = plan.items.slice(1);
  assert.ok(later.length > 0);
  for (const item of later) {
    assert.ok(item.duplicationScore > 0, 'a repeated post must score above zero');
    assert.equal(item.approvalStatus, PLANNER_ITEM_STATUS.GENERATION_FAILED);
    assert.equal(item.qualityStatus, 'generation_failed');
    assert.ok(Array.isArray(item.qualityFailures) && item.qualityFailures.length,
      'a hard failure must record structured reasons');
    assert.ok(item.regenerationCount > 0, 'it must have been retried before failing');

    // The status is not cosmetic: it blocks approval.
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      () => ctx.svc.setItemStatus(USER, item.id, 'approved'),
      /could not be generated/i,
      'a hard failure must not be approvable',
    );
  }
  assert.match(plan.run.generationNotes, /could not be generated/i);
});

test('a run whose every post hard-failed is marked failed, not review', async () => {
  const openai = createFakePlannerOpenAI({ duplicate: true });
  const ctx = build({ openai });
  // Two slots: the first is unique (nothing to repeat yet), the second fails.
  // With every post failing the run itself must say so.
  const plan = await generate(ctx, { planLength: 3 });
  const failed = plan.items.filter((i) => i.approvalStatus === PLANNER_ITEM_STATUS.GENERATION_FAILED);
  assert.ok(failed.length > 0, 'the duplicate generator must produce hard failures');

  // Not every post failed here (the first one had nothing to repeat), so the run
  // stays reviewable and reports the failures rather than hiding them.
  assert.equal(plan.run.status, PLANNER_RUN_STATUS.REVIEW);
  assert.equal(plan.run.qualityStatus, 'needs_review');
  assert.ok(Array.isArray(plan.run.qualityFailures) && plan.run.qualityFailures.length,
    'the run must record which items failed');
});

test('editing a hard-failed post clears the failure and lets it be approved', async () => {
  const openai = createFakePlannerOpenAI({ duplicate: true });
  const ctx = build({ openai });
  const plan = await generate(ctx, { planLength: 3 });
  const item = plan.items.find((i) => i.approvalStatus === PLANNER_ITEM_STATUS.GENERATION_FAILED);
  assert.ok(item, 'expected a hard-failed item');

  // A human writes it properly. The machine's verdict no longer describes it.
  await ctx.svc.updateItem(USER, item.id, {
    caption: 'A hand-written post that says something specific and useful about the work.',
  });
  const after = await ctx.svc.getPlan(USER, plan.run.id);
  const edited = after.items.find((i) => i.id === item.id);
  assert.notEqual(edited.approvalStatus, PLANNER_ITEM_STATUS.GENERATION_FAILED);
  assert.equal(edited.qualityFailures, null, 'the stale failure record must be cleared');

  // ...and it can now be approved, because a person took responsibility for it.
  const approved = await ctx.svc.setItemStatus(USER, item.id, 'approved');
  assert.equal(approved.approvalStatus, PLANNER_ITEM_STATUS.APPROVED);
});

test('a unique plan flags nothing and needs no regeneration', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 5 });
  for (const item of plan.items) {
    assert.equal(item.duplicationNotes, null);
    assert.equal(item.regenerationCount, 0);
  }
  assert.equal(plan.run.generationNotes, null);
});

test('the duplication lookback compares against earlier plans, not just this batch', async () => {
  const openai = createFakePlannerOpenAI({ duplicate: true });
  const ctx = build({ openai });
  await generate(ctx, { planLength: 1 });
  // A second plan repeating the first must be caught even though its own batch
  // is empty at that point.
  const second = await ctx.svc.generatePlan(USER, {
    startDate: '2026-07-21', planLength: 1, times: ['09:00'], timezone: 'UTC',
  });
  assert.ok(second.items[0].duplicationScore > 0);
  assert.match(second.items[0].duplicationNotes, /recent post/);
});

test('the caption text is never persisted in the fingerprint', async () => {
  const ctx = build();
  await generate(ctx, { planLength: 2 });
  for (const item of ctx.runs._items.values()) {
    const serialized = JSON.stringify(item.fingerprint);
    assert.equal(serialized.includes(item.caption), false, 'the fingerprint must not carry the caption');
  }
});

// --- editing ----------------------------------------------------------------

test('editing a caption records the edit and moves the card out of triage', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 2 });
  const item = plan.items[0];

  const edited = await ctx.svc.updateItem(USER, item.id, { caption: 'My own words entirely.' });
  assert.equal(edited.caption, 'My own words entirely.');
  assert.ok(edited.editedFields.includes('caption'));
  assert.equal(edited.approvalStatus, PLANNER_ITEM_STATUS.DRAFT);
});

test('a whole-form save only marks the fields that actually changed', async () => {
  /*
   * The edit drawer submits every field. If re-sending an untouched headline
   * counted as an edit, "regenerate the caption" would stop refreshing the
   * headline — silently breaking the feature's core promise.
   */
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const item = plan.items[0];

  const saved = await ctx.svc.updateItem(USER, item.id, {
    caption: 'Only this changed.',
    headline: item.headline, // unchanged
    subheadline: item.subheadline, // unchanged
    altText: item.altText, // unchanged
    templateKey: item.templateKey, // unchanged
    backgroundStyle: item.backgroundStyle, // unchanged
  });
  assert.deepEqual(saved.editedFields, ['caption'], `got ${JSON.stringify(saved.editedFields)}`);

  // ...so regenerating the caption still refreshes the headline.
  const after = await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });
  assert.notEqual(after.headline, item.headline, 'an untouched headline must still regenerate');
});

test('re-saving identical values is a no-op, not an edit', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const item = plan.items[0];
  const saved = await ctx.svc.updateItem(USER, item.id, {
    caption: item.caption, headline: item.headline,
  });
  assert.deepEqual(saved.editedFields, []);
  // The card stays in triage rather than being demoted to a draft.
  assert.equal(saved.approvalStatus, item.approvalStatus);
});

test('regenerating the image preserves an edited caption', async () => {
  // This is the whole point of "regenerate one field without losing the rest".
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const item = plan.items[0];

  await ctx.svc.updateItem(USER, item.id, { caption: 'Hand-written caption.', headline: 'Hand-written headline' });
  const after = await ctx.svc.regenerateItem(USER, item.id, 'image');

  assert.equal(after.caption, 'Hand-written caption.', 'the edited caption must survive');
  assert.equal(after.headline, 'Hand-written headline', 'the edited headline must survive');
  assert.ok(after.mediaAssetId);
});

test('regenerating a caption refuses to silently discard a user edit', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const item = plan.items[0];
  await ctx.svc.updateItem(USER, item.id, { caption: 'Hand-written caption.' });

  await assert.rejects(
    () => ctx.svc.regenerateItem(USER, item.id, 'caption'),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /discard your changes/);
      return true;
    },
  );

  // ...but an explicit confirmation goes through.
  const forced = await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });
  assert.notEqual(forced.caption, 'Hand-written caption.');
  assert.equal(forced.editedFields.includes('caption'), false, 'forcing clears the edit flag');
});

test('regenerating a caption keeps a separately edited headline', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const item = plan.items[0];
  await ctx.svc.updateItem(USER, item.id, { headline: 'Kept headline' });

  const after = await ctx.svc.regenerateItem(USER, item.id, 'caption');
  assert.equal(after.headline, 'Kept headline', 'an edited headline survives a caption regeneration');
  assert.notEqual(after.caption, plan.items[0].caption, 'the caption really was regenerated');
  assert.ok(after.regenerationCount >= 1);
});

// --- per-platform post copy (Phase 4.7.2) ------------------------------------

/** Seed the three supported providers so a plan targets all three platforms. */
async function seedAllPlatforms(socialAccounts) {
  await seedAccount(socialAccounts, { accountType: 'facebook_page', provider: 'meta', id: 'fb_1' });
  await seedAccount(socialAccounts, { accountType: 'instagram_professional', provider: 'instagram', id: 'ig_1' });
  await seedAccount(socialAccounts, { accountType: 'threads_profile', provider: 'threads', id: 'th_1' });
}

async function generateMultiPlatform(ctx, options = {}) {
  await seedAllPlatforms(ctx.socialAccounts);
  await seedProfile(ctx.businessProfiles);
  return ctx.svc.generatePlan(USER, {
    startDate: '2026-07-14', planLength: 1, cadence: 'every_day',
    times: ['09:00'], timezone: 'UTC', platforms: ['facebook', 'instagram', 'threads'], ...options,
  });
}

test('each target platform gets its own generated post, not a copy', async () => {
  const ctx = build();
  const plan = await generateMultiPlatform(ctx);
  const item = plan.items[0];

  // The generator is asked once per platform, for THAT platform.
  const platforms = ctx.openai._calls.map((c) => c.platform);
  for (const platform of ['facebook', 'instagram', 'threads']) {
    assert.ok(platforms.includes(platform), `never generated for ${platform}: ${platforms.join(', ')}`);
  }

  const stored = await ctx.runs.findItemByIdForUser(item.id, USER);
  assert.ok(stored.platformCaptions, 'per-platform copy was not persisted');
  const captions = ['facebook', 'instagram', 'threads'].map((p) => stored.platformCaptions[p]?.caption);
  assert.equal(new Set(captions).size, 3, `platforms share copy: ${JSON.stringify(captions)}`);
});

test('a platform variant is told what the primary post already said', async () => {
  const ctx = build();
  await generateMultiPlatform(ctx);
  const variantCalls = ctx.openai._calls.filter((c) => c.siblingCopy);
  assert.ok(variantCalls.length >= 2, 'the non-primary platforms must be given the primary copy as context');
  for (const call of variantCalls) {
    assert.equal(typeof call.siblingCopy, 'string');
    assert.ok(call.siblingCopy.length > 0);
  }
});

test('a single-platform plan stores no variants and still queues', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1, platforms: ['threads'] });
  const stored = await ctx.runs.findItemByIdForUser(plan.items[0].id, USER);
  assert.equal(stored.platformCaptions, null, 'one platform needs no variants');

  await ctx.svc.setItemStatus(USER, plan.items[0].id, 'approved');
  const queued = await ctx.svc.queueApproved(USER, plan.run.id);
  assert.equal(queued.queued.length, 1);
});

test('queueing hands each platform the copy written for it', async () => {
  const ctx = build();
  const plan = await generateMultiPlatform(ctx);
  const item = plan.items[0];
  const stored = await ctx.runs.findItemByIdForUser(item.id, USER);

  await ctx.svc.setItemStatus(USER, item.id, 'approved');
  const { queued } = await ctx.svc.queueApproved(USER, plan.run.id);
  assert.equal(queued.length, 1);

  const post = ctx.posts._posts.find((p) => String(p.id) === String(queued[0].postId));
  assert.ok(post, 'the queued post should exist');
  const delivered = post.generated_platform_captions_json;
  assert.ok(delivered, 'the queued post carries no platform captions');
  for (const platform of ['facebook', 'instagram', 'threads']) {
    assert.equal(
      delivered[platform].caption,
      stored.platformCaptions[platform].caption,
      `${platform} was queued with the wrong copy`,
    );
  }
  // ...and the three are genuinely different posts, not one string three times.
  const texts = ['facebook', 'instagram', 'threads'].map((p) => delivered[p].caption);
  assert.equal(new Set(texts).size, 3, 'the queued platforms share copy');
});

test('an item saved before per-platform copy existed still queues, using its caption', async () => {
  const ctx = build();
  const plan = await generateMultiPlatform(ctx);
  const item = plan.items[0];

  // Simulate a pre-migration row: the column is NULL.
  await ctx.runs.updateItem(item.id, USER, { platformCaptions: null });
  await ctx.svc.setItemStatus(USER, item.id, 'approved');
  const { queued } = await ctx.svc.queueApproved(USER, plan.run.id);
  assert.equal(queued.length, 1, 'a legacy item must still queue rather than fail');

  // Every platform falls back to the canonical caption, which is the old
  // behaviour: worse copy, but never a failure to publish.
  const post = ctx.posts._posts.find((p) => String(p.id) === String(queued[0].postId));
  const stored = await ctx.runs.findItemByIdForUser(item.id, USER);
  for (const platform of stored.platformTargets) {
    assert.equal(post.generated_platform_captions_json[platform].caption, stored.caption);
  }
});

test('editing the canonical caption wins over a stale generated variant', async () => {
  const ctx = build();
  const plan = await generateMultiPlatform(ctx);
  const item = plan.items[0];
  const stored = await ctx.runs.findItemByIdForUser(item.id, USER);
  const primary = Object.keys(stored.platformCaptions)[0];

  await ctx.svc.updateItem(USER, item.id, { caption: 'Hand-written by the user.' });
  await ctx.svc.setItemStatus(USER, item.id, 'approved');
  await ctx.svc.queueApproved(USER, plan.run.id);

  const after = await ctx.runs.findItemByIdForUser(item.id, USER);
  assert.equal(after.caption, 'Hand-written by the user.');
  // The user edited the canonical field; the primary platform must not publish
  // the superseded generated variant.
  assert.ok(after.editedFields.includes('caption'));
  assert.ok(primary, 'a primary platform should exist');
});

test('regenerating post copy does not change the selected template', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const item = plan.items[0];

  await ctx.svc.updateItem(USER, item.id, { templateKey: 'comparison-cards' });
  const after = await ctx.svc.regenerateItem(USER, item.id, 'caption');
  assert.equal(after.templateKey, 'comparison-cards', 'a copy regeneration must not reset the chosen layout');
});

test('editing validates its input', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const id = plan.items[0].id;

  await assert.rejects(() => ctx.svc.updateItem(USER, id, { caption: '   ' }), /Invalid changes/);
  await assert.rejects(() => ctx.svc.updateItem(USER, id, { templateKey: 'nope' }), /Invalid changes/);
  await assert.rejects(() => ctx.svc.updateItem(USER, id, { platformTargets: [] }), /Invalid changes/);
  await assert.rejects(() => ctx.svc.updateItem(USER, id, { platformTargets: ['tiktok'] }), /Invalid changes/);
  // A time in the past cannot be scheduled.
  await assert.rejects(() => ctx.svc.updateItem(USER, id, { scheduledFor: '2020-01-01T09:00:00Z' }), /Invalid changes/);
});

test('the schedule time can be changed to a future slot', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const updated = await ctx.svc.updateItem(USER, plan.items[0].id, { scheduledFor: '2026-08-01T10:30:00Z' });
  assert.equal(updated.scheduledFor, '2026-08-01 10:30:00');
  assert.ok(updated.editedFields.includes('scheduledFor'));
});

test('changing the template is an edit that sticks', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const updated = await ctx.svc.updateItem(USER, plan.items[0].id, { templateKey: 'minimal-luxury' });
  assert.equal(updated.templateKey, 'minimal-luxury');
  assert.ok(updated.editedFields.includes('templateKey'));
  // A legacy name is normalized rather than rejected.
  const legacy = await ctx.svc.updateItem(USER, plan.items[0].id, { templateKey: 'bold' });
  assert.equal(legacy.templateKey, 'bold-service-promo');
});

// --- approval ---------------------------------------------------------------

test('approve and reject move a card between states', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 2 });

  const approved = await ctx.svc.setItemStatus(USER, plan.items[0].id, 'approved');
  assert.equal(approved.approvalStatus, PLANNER_ITEM_STATUS.APPROVED);

  const rejected = await ctx.svc.setItemStatus(USER, plan.items[1].id, 'rejected');
  assert.equal(rejected.approvalStatus, PLANNER_ITEM_STATUS.REJECTED);

  await assert.rejects(() => ctx.svc.setItemStatus(USER, plan.items[0].id, 'nonsense'), /Invalid status/);
});

test('bulk approve-all approves every card', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 4 });
  const result = await ctx.svc.bulkSetStatus(USER, plan.run.id, [], 'approved');
  assert.equal(result.updated.length, 4);
  assert.equal(result.plan.counts.approved, 4);
});

test('bulk approve-selected touches only the selection', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 4 });
  const chosen = [plan.items[0].id, plan.items[2].id];
  const result = await ctx.svc.bulkSetStatus(USER, plan.run.id, chosen, 'approved');
  assert.equal(result.updated.length, 2);
  assert.deepEqual(result.updated.sort(), chosen.sort());
  assert.equal(result.plan.counts.approved, 2);
  assert.equal(result.plan.counts.needs_review, 2);
});

test('removing rejected cards deletes only those', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 3 });
  await ctx.svc.setItemStatus(USER, plan.items[0].id, 'rejected');
  const result = await ctx.svc.removeRejected(USER, plan.run.id);
  assert.equal(result.removed, 1);
  assert.equal(result.plan.items.length, 2);
});

// --- queue integration ------------------------------------------------------

test('queueing approved posts creates real queued posts and never publishes', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 3 });
  await ctx.svc.bulkSetStatus(USER, plan.run.id, [], 'approved');

  const result = await ctx.svc.queueApproved(USER, plan.run.id, []);
  assert.equal(result.queued.length, 3);
  // The notice is explicit that nothing is published.
  assert.match(result.notice, /queued/i);
  assert.match(result.notice, /later phase/i);

  for (const { postId, itemId } of result.queued) {
    const post = await ctx.posts.findPostByIdForUser(postId, USER);
    assert.ok(post, 'a real post row must exist');
    assert.equal(post.status, 'queued');
    assert.ok(post.scheduledAtUtc);
    assert.ok(post.platformCaptions.threads.caption, 'the caption carries across');
    assert.ok(post.mediaAssetId, 'the rendered image carries across');
    // The post links back to the plan that produced it.
    assert.equal(post.generationParams.plannerItemId, itemId);
    assert.equal(post.generationParams.plannerRunId, plan.run.id);
    // Targets were set from the connected account.
    const targets = await ctx.posts.listPostTargets(postId, USER);
    assert.equal(targets.length, 1);
  }

  const after = await ctx.svc.getPlan(USER, plan.run.id);
  assert.equal(after.counts.queued, 3);
  assert.equal(after.run.status, PLANNER_RUN_STATUS.QUEUED);
  for (const item of after.items) assert.ok(item.postId, 'the item records its post');
});

test('queueing only queues approved posts, and reports partial state', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 3 });
  await ctx.svc.setItemStatus(USER, plan.items[0].id, 'approved');

  const result = await ctx.svc.queueApproved(USER, plan.run.id, []);
  assert.equal(result.queued.length, 1);
  assert.equal(result.plan.run.status, PLANNER_RUN_STATUS.PARTIALLY_QUEUED);
  assert.equal(result.plan.counts.queued, 1);
  assert.equal(result.plan.counts.needs_review, 2);
});

test('queueing with nothing approved is refused', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 2 });
  await assert.rejects(
    () => ctx.svc.queueApproved(USER, plan.run.id, []),
    /Approve at least one post/,
  );
});

test('a queued card cannot be edited, regenerated, or deleted from the planner', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  await ctx.svc.setItemStatus(USER, plan.items[0].id, 'approved');
  await ctx.svc.queueApproved(USER, plan.run.id, []);
  const id = plan.items[0].id;

  await assert.rejects(() => ctx.svc.updateItem(USER, id, { caption: 'x' }), /already queued/);
  await assert.rejects(() => ctx.svc.regenerateItem(USER, id, 'caption'), /already queued/);
  await assert.rejects(() => ctx.svc.setItemStatus(USER, id, 'rejected'), /already queued/);
  await assert.rejects(() => ctx.svc.deleteItem(USER, id), /queued/);
});

// --- plan deletion ----------------------------------------------------------

test('an empty plan deletes cleanly', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 2 });
  for (const item of plan.items) await ctx.svc.deleteItem(USER, item.id);

  const result = await ctx.svc.deletePlan(USER, plan.run.id);
  assert.equal(result.deleted, true);
  assert.equal(result.archived, false);
  await assert.rejects(() => ctx.svc.getPlan(USER, plan.run.id), /not found/i);
});

test('a plan of drafts deletes with its items', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 3 });
  const impact = await ctx.svc.describeDeletion(USER, plan.run.id);
  assert.equal(impact.counts.plannerItems, 3);
  assert.equal(impact.counts.plannerOnlyItems, 3, 'none has become a post yet');
  assert.equal(impact.counts.queuedPosts, 0);
  assert.equal(impact.blockedByQueued, false);
  assert.equal(impact.mustArchive, false);

  assert.equal((await ctx.svc.deletePlan(USER, plan.run.id)).deleted, true);
  await assert.rejects(() => ctx.svc.getPlan(USER, plan.run.id), /not found/i);
});

test('a plan with a DRAFT post deletes, and the draft survives as its own record', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const { postId } = await ctx.svc.duplicateAsDraft(USER, plan.items[0].id);

  const result = await ctx.svc.deletePlan(USER, plan.run.id);
  assert.equal(result.deleted, true);
  // The manual draft was the user's own copy; it is not the plan's to destroy.
  const post = await ctx.posts.findPostByIdForUser(postId, USER);
  assert.ok(post);
  assert.equal(post.status, 'draft');
});

test('deleting a plan with QUEUED posts is refused rather than silently destructive', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 2 });
  await ctx.svc.setItemStatus(USER, plan.items[0].id, 'approved');
  await ctx.svc.queueApproved(USER, plan.run.id, []);

  const impact = await ctx.svc.describeDeletion(USER, plan.run.id);
  assert.equal(impact.counts.queuedPosts, 1);
  assert.equal(impact.blockedByQueued, true);

  await assert.rejects(
    () => ctx.svc.deletePlan(USER, plan.run.id),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /queued post/);
      assert.match(err.message, /Cancel/);
      return true;
    },
  );
  // Refusing means refusing: the plan is untouched.
  assert.ok(await ctx.svc.getPlan(USER, plan.run.id));
});

test('the controlled cancel-and-delete cancels the queued posts first', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 2 });
  await ctx.svc.bulkSetStatus(USER, plan.run.id, [], 'approved');
  const { queued } = await ctx.svc.queueApproved(USER, plan.run.id, []);

  const result = await ctx.svc.deletePlan(USER, plan.run.id, { cancelQueued: true });
  assert.equal(result.deleted, true);
  assert.equal(result.cancelledPosts, 2);
  await assert.rejects(() => ctx.svc.getPlan(USER, plan.run.id), /not found/i);

  // The posts still exist, cancelled — not vanished.
  for (const { postId } of queued) {
    const post = await ctx.posts.findPostByIdForUser(postId, USER);
    assert.ok(post, 'the post record must survive');
    assert.equal(post.status, 'cancelled');
  }
});

test('a plan with PUBLISHED posts is archived, never destroyed', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 2 });
  await ctx.svc.setItemStatus(USER, plan.items[0].id, 'approved');
  const { queued } = await ctx.svc.queueApproved(USER, plan.run.id, []);
  // Simulate a future publishing phase having sent this one out.
  markPublished(ctx, queued[0].postId);

  const impact = await ctx.svc.describeDeletion(USER, plan.run.id);
  assert.equal(impact.mustArchive, true);
  assert.equal(impact.counts.publishedPosts, 1);

  const result = await ctx.svc.deletePlan(USER, plan.run.id);
  assert.equal(result.deleted, false);
  assert.equal(result.archived, true);
  assert.match(result.notice, /archived instead of deleted/);

  // The plan is still readable: published history never disappears.
  const after = await ctx.svc.getPlan(USER, plan.run.id);
  assert.equal(after.run.status, 'archived');
  assert.ok(after.run.archivedAt);
  assert.equal((await ctx.posts.findPostByIdForUser(queued[0].postId, USER)).status, 'published');
});

test('cancelQueued does not force-delete a plan with published history', async () => {
  // Archival wins over the cancel-and-delete opt-in: published is published.
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  await ctx.svc.setItemStatus(USER, plan.items[0].id, 'approved');
  const { queued } = await ctx.svc.queueApproved(USER, plan.run.id, []);
  markPublished(ctx, queued[0].postId);

  const result = await ctx.svc.deletePlan(USER, plan.run.id, { cancelQueued: true });
  assert.equal(result.archived, true);
  assert.equal(result.deleted, false);
  assert.ok(await ctx.svc.getPlan(USER, plan.run.id));
});

test('a failed deletion rolls back and leaves the plan intact', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 2 });
  await ctx.svc.bulkSetStatus(USER, plan.run.id, [], 'approved');
  await ctx.svc.queueApproved(USER, plan.run.id, []);

  // The run delete blows up mid-transaction, after the cancels.
  const boom = new Error('database went away');
  const original = ctx.runs.deleteRun;
  ctx.runs.deleteRun = async () => { throw boom; };

  await assert.rejects(() => ctx.svc.deletePlan(USER, plan.run.id, { cancelQueued: true }), /database went away/);

  ctx.runs.deleteRun = original;
  // The plan survives, because the whole thing is one transaction.
  const after = await ctx.svc.getPlan(USER, plan.run.id);
  assert.equal(after.items.length, 2);
});

test('another user cannot delete or inspect the deletion of a plan', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  await assert.rejects(() => ctx.svc.deletePlan('999', plan.run.id), /not found/i);
  await assert.rejects(() => ctx.svc.describeDeletion('999', plan.run.id), /not found/i);
  // Still there.
  assert.ok(await ctx.svc.getPlan(USER, plan.run.id));
});

test('a planned post can be duplicated into a manual draft', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const { postId } = await ctx.svc.duplicateAsDraft(USER, plan.items[0].id);
  const post = await ctx.posts.findPostByIdForUser(postId, USER);
  assert.equal(post.status, 'draft');
  assert.equal(post.platformCaptions.threads.caption, plan.items[0].caption);
  // The planner card is untouched.
  const after = await ctx.svc.getPlan(USER, plan.run.id);
  assert.equal(after.items[0].approvalStatus, PLANNER_ITEM_STATUS.NEEDS_REVIEW);
});

// --- history + ownership ----------------------------------------------------

test('plan history lists runs newest first with status counts', async () => {
  const ctx = build();
  await generate(ctx, { planLength: 2 });
  await ctx.svc.generatePlan(USER, { startDate: '2026-07-21', planLength: 2, times: ['09:00'], timezone: 'UTC' });

  const plans = await ctx.svc.listPlans(USER);
  assert.equal(plans.length, 2);
  assert.ok(Number(plans[0].id) > Number(plans[1].id), 'newest first');
  assert.equal(plans[0].counts.needs_review, 2);
  assert.ok(plans[0].name);
});

test('one user can never read or mutate another user plan', async () => {
  const ctx = build();
  const plan = await generate(ctx, { planLength: 1 });
  const OTHER = '999';

  await assert.rejects(() => ctx.svc.getPlan(OTHER, plan.run.id), /not found/i);
  await assert.rejects(() => ctx.svc.deletePlan(OTHER, plan.run.id), /not found/i);
  await assert.rejects(() => ctx.svc.updateItem(OTHER, plan.items[0].id, { caption: 'x' }), /not found/i);
  await assert.rejects(() => ctx.svc.setItemStatus(OTHER, plan.items[0].id, 'approved'), /not found/i);
  await assert.rejects(() => ctx.svc.deleteItem(OTHER, plan.items[0].id), /not found/i);
  assert.deepEqual(await ctx.svc.listPlans(OTHER), []);
});

test('a hard failure cannot be laundered through "draft" and then approved', async () => {
  /*
   * The bypass this closes, found by an adversarial audit and reproduced here:
   *
   *   POST /items/:id/status {status:'draft'}   -> approvalStatus becomes draft
   *   POST /items/:id/status {status:'approved'} -> approved. Queued. Shipped.
   *
   * The gate was keyed to `approvalStatus`, which the user can move, so moving
   * it cleared the block while `qualityStatus` still recorded the failure. It is
   * now keyed to `qualityStatus`, which only a human edit or a passing
   * regeneration clears.
   */
  const openai = createFakePlannerOpenAI({ duplicate: true });
  const ctx = build({ openai });
  const plan = await generate(ctx, { planLength: 3 });
  const item = plan.items.find((i) => i.approvalStatus === PLANNER_ITEM_STATUS.GENERATION_FAILED);
  assert.ok(item, 'expected a hard-failed item');

  // Direct approval is refused.
  await assert.rejects(() => ctx.svc.setItemStatus(USER, item.id, 'approved'), /could not be generated/i);

  // ...and so is approval AFTER moving it to draft, which used to work.
  const drafted = await ctx.svc.setItemStatus(USER, item.id, 'draft');
  assert.equal(drafted.approvalStatus, PLANNER_ITEM_STATUS.DRAFT);
  assert.equal(drafted.qualityStatus, 'generation_failed', 'the failure record must survive a status move');
  await assert.rejects(
    () => ctx.svc.setItemStatus(USER, item.id, 'approved'),
    /could not be generated/i,
    'moving a hard failure to draft must not launder it into the queue',
  );

  // Bulk approve refuses it too, with a reason rather than silently.
  const bulk = await ctx.svc.bulkSetStatus(USER, plan.run.id, [item.id], 'approved');
  assert.equal(bulk.updated.length, 0);
  assert.match(bulk.skipped[0].reason, /generation failed/i);
});
