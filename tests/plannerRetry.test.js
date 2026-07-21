/**
 * The Phase 4.8 retry regression, reproduced.
 *
 * Live symptom: an item was "Generation failed". The user clicked Retry. The
 * weekly card showed visibly new copy, the item stayed failed with "Too similar
 * to a recent post: a similar angle, the same hashtags, the same writing
 * format", and the edit drawer still showed the PREVIOUS copy.
 *
 * Three distinct defects sat behind that, and each has a test here:
 *
 *   1. The retry compared the new copy against the item's OWN stored
 *      fingerprint. Same pillar, same service, same hashtags, same format —
 *      because it is literally the same item — so the soft axes matched and the
 *      post was condemned as a duplicate of itself.
 *   2. The retry wrote `caption` but never `platform_captions_json`, so the
 *      per-platform copy stayed stale. That is what the queue publishes, so a
 *      retried post would have gone out with its OLD text.
 *   3. The retry never refreshed the item's fingerprint, so the stale signals
 *      persisted for the next comparison.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlannerService } from '../src/services/plannerService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';
import { PLANNER_ITEM_STATUS } from '../src/config/constants.js';
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

const USER = '5';
const NOW = new Date('2026-07-13T06:00:00Z');
const noopLogging = { record: async () => {} };

/**
 * The post the plan first generated, with the Threads version written for
 * Threads rather than trimmed from the Instagram one.
 */
const ORIGINAL = Object.freeze({
  headline: 'A concrete checklist for value',
  caption: [
    'A concrete checklist for value when hiring SEO help. Most people paying for search work cannot tell you what they are getting for it, and that is not their fault.',
    'Ask what will change on the site this month. Ask which pages are being worked on and why those. Ask what the reporting will actually show you, and whether you can see the work itself rather than a summary of it.',
    'If the answers are vague, that is the answer. Good work survives specific questions about it.',
  ].join('\n\n'),
  hashtags: ['#seo', '#smallbusiness'],
  variants: {
    threads: {
      headline: 'A concrete checklist for value',
      caption: [
        'Most people paying for SEO could not tell you what they got for it last month. That is not their fault.',
        'Ask which pages were worked on and why those ones. A vague answer is itself the answer.',
      ].join('\n\n'),
      hashtags: [],
    },
  },
});

/**
 * The retry: genuinely different opening, angle and wording. Same service, same
 * weekday pillar, and — deliberately — THE SAME HASHTAGS.
 *
 * The reported failure named "a similar angle, the same hashtags, the same
 * writing format". Those are precisely the axes that match when an item is
 * compared against ITSELF: the pillar, service, format and template are the
 * item's own, and a brand reuses its hashtags. Keeping the hashtags identical
 * here is what reproduces the live bug rather than a milder version of it, and
 * it is also the case requirement 7 says must be allowed: same service, same
 * pillar, new angle.
 */
const RETRIED = Object.freeze({
  headline: 'What SEO work is worth paying for',
  caption: [
    'What SEO work is actually worth paying for changes with the size of the site. A five-page brochure and a two-thousand page shop have almost nothing in common beyond the label.',
    'On a small site the wins are usually structural and finite: the titles, the internal links, the handful of pages that carry the business. On a large one the work is systemic, and the reporting has to be too.',
    'So the useful question is not what an agency charges. It is what they think your site needs first, and whether their answer changes when they look at it.',
  ].join('\n\n'),
  hashtags: ['#seo', '#smallbusiness'],
  variants: {
    threads: {
      headline: 'What SEO work is worth paying for',
      caption: [
        'A five-page brochure site and a two-thousand page shop get sold the same SEO package. They have almost nothing in common.',
        'Ask what they think your site needs first. If the answer does not change once they have looked at it, it was never about your site.',
      ].join('\n\n'),
      hashtags: [],
    },
  },
});

function build(extra = {}) {
  const socialAccounts = createFakeSocialAccountRepository();
  const posts = createFakePostRepository({ socialAccounts });
  const media = createFakeMediaAssetRepository();
  const businessProfiles = createFakeBusinessProfileRepository();
  const preferences = createFakePlannerPreferenceRepository();
  const runs = createFakePlannerRunRepository();
  const openai = extra.openai ?? createFakePlannerOpenAI();
  const images = extra.images ?? { ...createFakeSocialImageService(), isReadyForUser: async () => true };

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
  return { svc, socialAccounts, posts, businessProfiles, preferences, runs, openai, images, media };
}

/** Instagram Professional and Threads only. No Facebook Page is connected. */
async function seedAccounts(socialAccounts) {
  const rows = [
    ['instagram_professional', 'instagram', 'ig_1'],
    ['threads_profile', 'threads', 'th_1'],
  ];
  for (const [accountType, provider, id] of rows) {
    // eslint-disable-next-line no-await-in-loop
    await socialAccounts.upsertSocialAccount({
      userId: USER, provider, accountType, providerAccountId: id,
      displayName: 'Cyfrow Solutions', username: 'cyfrow',
      encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active',
    });
  }
}

async function seedProfile(businessProfiles) {
  return businessProfiles.createOrUpdateProfile(USER, {
    businessName: 'Cyfrow Solutions',
    businessCategory: 'SEO agency',
    services: ['SEO Audit'],
    defaultCallToAction: 'Ask us',
    primaryColor: '#111827',
    websiteUrl: 'https://cyfrowsolutions.com',
  });
}

const RUN = Object.freeze({
  startDate: '2026-07-14', planLength: 1, cadence: 'every_day',
  times: ['09:00'], postsPerDay: 1, timezone: 'Asia/Karachi',
  platforms: ['instagram', 'threads'], contentRhythmPreset: 'balanced',
});

/**
 * The exact live scenario: one item that generated, then hard-failed, whose
 * retry produces genuinely different copy.
 */
async function failedItemAwaitingRetry(overrides = {}) {
  const openai = createFakePlannerOpenAI({ scripted: [ORIGINAL, RETRIED] });
  const ctx = build({ openai, ...overrides });
  await seedAccounts(ctx.socialAccounts);
  await seedProfile(ctx.businessProfiles);

  const plan = await ctx.svc.generatePlan(USER, RUN);
  const item = plan.items[0];

  // Put it in the state the user reported: a hard failure awaiting a retry.
  await ctx.runs.updateItem(item.id, USER, {
    approvalStatus: PLANNER_ITEM_STATUS.GENERATION_FAILED,
    qualityStatus: 'generation_failed',
    qualityFailures: ['post copy is too short for instagram: 40 words, needs at least 120'],
    duplicationNotes: 'Too similar to a recent post: a similar angle, the same hashtags.',
  });

  return { ctx, plan, item: await ctx.runs.findItemByIdForUser(item.id, USER) };
}

// --- root cause 1: the item was compared against itself ---------------------

test('a retry is not condemned as a duplicate of its own previous version', async () => {
  /*
   * Measured against the real engine, the item-versus-itself comparison scores:
   *
   *   caption 0.21, headline 0, opening 0.08   <- the words are GENUINELY new
   *   topic 1.0, hashtags 1.0, cta 1.0, structure 1.0  <- the item's identity
   *
   * ...which produced exactly the message the user saw ("a similar angle, the
   * same hashtags, the same writing format") and, with the full brief context,
   * a score of 0.9 — the hard-duplicate threshold — so the post stayed failed
   * no matter how different the writing was. The post was condemned by its own
   * identity, not by its words.
   */
  const { ctx, item } = await failedItemAwaitingRetry();
  assert.equal(item.approvalStatus, PLANNER_ITEM_STATUS.GENERATION_FAILED);

  const after = await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });

  assert.notEqual(
    after.approvalStatus,
    PLANNER_ITEM_STATUS.GENERATION_FAILED,
    `a genuinely different retry must recover, not stay failed: ${after.duplicationNotes}`,
  );
  assert.equal(after.approvalStatus, PLANNER_ITEM_STATUS.NEEDS_REVIEW);
  assert.match(after.caption, /worth paying for/, 'the new copy must be stored');

  // The heart of it: nothing to compare against means nothing to warn about.
  // A warning here can only have come from the item comparing with itself.
  assert.equal(
    after.duplicationNotes,
    null,
    `the item was flagged as similar to itself: ${after.duplicationNotes}`,
  );
  assert.ok(
    after.duplicationScore < 0.45,
    `self-comparison inflated the duplication score to ${after.duplicationScore}`,
  );
});

test('the item under retry is excluded from the duplicate history by id', async () => {
  const { ctx, item } = await failedItemAwaitingRetry();
  const seen = [];
  const original = ctx.runs.listRecentFingerprintsForUser;
  ctx.runs.listRecentFingerprintsForUser = async (userId, options) => {
    seen.push(options);
    return original.call(ctx.runs, userId, options);
  };

  await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });

  assert.ok(seen.length > 0, 'the retry must consult the duplicate history');
  for (const options of seen) {
    assert.equal(String(options.excludeItemId), String(item.id),
      'the item being retried must be excluded by id');
    assert.ok(options.sinceUtc, 'the lookback must be time-bounded, as generation is');
  }
});

test('an earlier failed attempt for the same item never counts against its retry', async () => {
  // Two retries in a row. The second must not be blocked by the first, which is
  // the same item's own history.
  const { ctx, item } = await failedItemAwaitingRetry();
  const first = await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });
  assert.notEqual(first.approvalStatus, PLANNER_ITEM_STATUS.GENERATION_FAILED);

  const second = await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });
  assert.notEqual(
    second.approvalStatus,
    PLANNER_ITEM_STATUS.GENERATION_FAILED,
    `a second retry must not self-block: ${second.duplicationNotes}`,
  );
});

// --- duplicate protection is NOT disabled -----------------------------------

test('a real duplicate of ANOTHER item is still rejected', async () => {
  /*
   * The fix must not be "stop comparing". A retry that reproduces a DIFFERENT
   * item's post is still a duplicate and must be caught.
   */
  const openai = createFakePlannerOpenAI({ scripted: [ORIGINAL] }); // always the same post
  const ctx = build({ openai });
  await seedAccounts(ctx.socialAccounts);
  await seedProfile(ctx.businessProfiles);

  // Two days: both generate the identical scripted post.
  const plan = await ctx.svc.generatePlan(USER, { ...RUN, planLength: 2 });
  assert.equal(plan.items.length, 2);

  // The second item repeats the first: it must be flagged, not waved through.
  const second = plan.items[1];
  assert.ok(second.duplicationScore > 0, 'an identical sibling must score above zero');
  assert.ok(
    second.approvalStatus === PLANNER_ITEM_STATUS.GENERATION_FAILED
    || second.duplicationNotes,
    'duplicate protection must still fire for a genuine repeat of another item',
  );
});

test('the same service and pillar with a new angle is allowed', async () => {
  const { ctx, item } = await failedItemAwaitingRetry();
  const before = await ctx.runs.findItemByIdForUser(item.id, USER);

  const after = await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });

  // Same weekday pillar and same service as before, deliberately.
  assert.equal(after.contentPillar, before.contentPillar);
  assert.notEqual(after.approvalStatus, PLANNER_ITEM_STATUS.GENERATION_FAILED);
});

// --- root cause 2: one canonical copy source --------------------------------

test('a retry updates the per-platform copy, not just the caption', async () => {
  /*
   * `platform_captions_json` is what the queue publishes. The retry used to
   * write only `generated_caption`, so the two diverged and a retried post would
   * have gone out with its OLD text while the card showed the new one.
   */
  const { ctx, item } = await failedItemAwaitingRetry();
  const before = await ctx.runs.findItemByIdForUser(item.id, USER);
  assert.ok(before.platformCaptions?.instagram?.caption, 'the fixture needs per-platform copy');

  await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });
  const after = await ctx.runs.findItemByIdForUser(item.id, USER);

  for (const platform of ['instagram', 'threads']) {
    assert.ok(after.platformCaptions[platform], `${platform} lost its copy`);
    assert.notEqual(
      after.platformCaptions[platform].caption,
      before.platformCaptions[platform].caption,
      `${platform} still holds the stale pre-retry copy`,
    );
  }
  // The canonical caption and the primary platform's copy must agree.
  const primary = after.platformTargets[0];
  assert.equal(after.platformCaptions[primary].caption, after.caption,
    'the caption and the primary platform copy must be the same text');
});

test('Retry image changes ONLY the image — caption, headline, hashtags and service are untouched', async () => {
  /*
   * Retry image must re-render the picture and nothing else: the approved copy,
   * per-platform copy, headline, hashtags and assigned service stay byte-for-byte.
   * This is the isolation the board's "Retry image" and the drawer rely on.
   */
  const { ctx, item } = await failedItemAwaitingRetry();
  const before = await ctx.runs.findItemByIdForUser(item.id, USER);

  const after = await ctx.svc.regenerateItem(USER, item.id, 'image');

  // A new image asset was attached (the render succeeded via the fake).
  assert.ok(after.mediaAssetId ?? after.media, 'a new image is attached');
  // Everything textual is IDENTICAL to before.
  const raw = await ctx.runs.findItemByIdForUser(item.id, USER);
  assert.equal(raw.caption, before.caption, 'caption unchanged');
  assert.equal(raw.headline, before.headline, 'headline unchanged');
  assert.deepEqual(raw.hashtags, before.hashtags, 'hashtags unchanged');
  assert.equal(JSON.stringify(raw.platformCaptions), JSON.stringify(before.platformCaptions), 'per-platform copy unchanged');
  assert.equal(raw.templateKey, before.templateKey, 'assigned poster/template unchanged');
  assert.equal(raw.contentFormat ?? null, before.contentFormat ?? null, 'writing format unchanged');
});

test('the queue receives the retried copy, never the pre-retry copy', async () => {
  const { ctx, plan, item } = await failedItemAwaitingRetry();
  await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });
  await ctx.svc.setItemStatus(USER, item.id, 'approved');
  const { queued } = await ctx.svc.queueApproved(USER, plan.run.id);

  const post = ctx.posts._posts.find((p) => String(p.id) === String(queued[0].postId));
  const delivered = post.generated_platform_captions_json;
  assert.deepEqual(Object.keys(delivered).sort(), ['instagram', 'threads']);
  for (const platform of ['instagram', 'threads']) {
    assert.ok(
      !delivered[platform].caption.includes('A concrete checklist for value when hiring'),
      `${platform} queued the stale pre-retry copy`,
    );
  }
});

test('a retry refreshes the stored fingerprint', async () => {
  const { ctx, item } = await failedItemAwaitingRetry();
  const before = await ctx.runs.findItemByIdForUser(item.id, USER);
  await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });
  const after = await ctx.runs.findItemByIdForUser(item.id, USER);

  assert.notDeepEqual(
    after.fingerprint?.openingText,
    before.fingerprint?.openingText,
    'a stale fingerprint would poison the next comparison',
  );
});

// --- state after a successful retry -----------------------------------------

test('a successful retry clears the old failure details', async () => {
  const { ctx, item } = await failedItemAwaitingRetry();
  const after = await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });

  assert.equal(after.qualityStatus, 'needs_review');
  assert.equal(after.qualityFailures, null, 'stale failure reasons must not survive a success');
  assert.ok(after.regenerationCount > 0);
});

test('a retry preserves the schedule, platforms, template and timezone', async () => {
  const { ctx, item } = await failedItemAwaitingRetry();
  const before = await ctx.runs.findItemByIdForUser(item.id, USER);
  const after = await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });

  assert.deepEqual(after.platformTargets, ['instagram', 'threads']);
  assert.ok(!after.platformTargets.includes('facebook'), 'a retry must never add Facebook');
  assert.equal(after.scheduledFor, before.scheduledFor);
  assert.equal(after.originalTimezone, 'Asia/Karachi');
  assert.equal(after.templateKey, before.templateKey);
  assert.equal(after.contentPillar, before.contentPillar);
});

test('regenerating post copy does not regenerate the image', async () => {
  const calls = [];
  const images = {
    ...createFakeSocialImageService(),
    isReadyForUser: async () => true,
    generateSocialImage: async (input) => { calls.push(input); return { imageId: 'x', sourceUrl: 'https://e/x.png', width: 1080, height: 1080 }; },
  };
  const { ctx, item } = await failedItemAwaitingRetry({ images });
  const before = await ctx.runs.findItemByIdForUser(item.id, USER);
  const countAfterGeneration = calls.length;

  await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });

  assert.equal(calls.length, countAfterGeneration, 'a post-copy retry must not render a new image');
  const after = await ctx.runs.findItemByIdForUser(item.id, USER);
  assert.equal(after.mediaAssetId, before.mediaAssetId, 'the existing image must be kept');
});

// --- the retry is told why it failed ----------------------------------------

test('a retry receives the exact previous failure reasons', async () => {
  const { ctx, item } = await failedItemAwaitingRetry();
  const before = ctx.openai._calls.length;
  await ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true });

  // The PRIMARY retry call, not the platform-variant calls that follow it (a
  // variant is written against the new primary and carries `siblingCopy`).
  const retryCalls = ctx.openai._calls.slice(before);
  const primary = retryCalls.find((c) => !c.siblingCopy);
  assert.ok(primary, 'the retry must make a primary generation call');

  assert.ok(Array.isArray(primary.styleIssues), 'the retry must pass the prior failure reasons');
  assert.ok(
    primary.styleIssues.some((r) => /too short for instagram/.test(r)),
    `the exact prior reasons must reach the generator: ${JSON.stringify(primary.styleIssues)}`,
  );
  // ...including the similarity complaint, so it does not repeat the angle.
  assert.ok(
    primary.styleIssues.some((r) => /Too similar/i.test(r)),
    'the prior duplication note must reach the retry too',
  );
  assert.ok(
    primary.avoidOpenings?.length,
    'the retry must be told which openings are already taken, including its own',
  );
});
