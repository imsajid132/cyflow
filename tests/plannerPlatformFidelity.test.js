/**
 * The platforms a plan is generated for are the platforms the user selected.
 *
 * Live reproduction: a fresh three-day plan was created for Instagram
 * Professional and Threads, with Facebook deliberately not selected. Every item
 * came back targeting facebook, threads and instagram, and two of the three
 * were marked "Generation failed" — because the FACEBOOK copy, for a platform
 * that was never chosen, missed its length band:
 *
 *   Facebook has 122 words; minimum is 130
 *   Facebook has 8 paragraphs; required range is 2 to 4
 *
 * The order in the evidence gives it away: facebook, threads, instagram is not
 * the order anyone would tick boxes in. It is the order the accounts were
 * connected in — the user was handed the CONNECTED list, not their selection.
 *
 * Two layers said "connected means selected", and both are covered here:
 *
 *   1. resolvePlatforms returned every connected account when a request named
 *      no platforms.
 *   2. The wizard pre-ticked every connected account when the user had no saved
 *      platform default (see tests/plannerViewConsistency.test.js).
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPlannerService,
  assertPlatformContract,
  normalizePlatformList,
} from '../src/services/plannerService.js';
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

const USER = '9';
const NOW = new Date('2026-07-13T06:00:00Z');
const noopLogging = { record: async () => {} };

/** The live setup: a Facebook Page, Threads and Instagram, connected in that order. */
const ALL_THREE = [
  ['facebook_page', 'meta', 'fb_1'],
  ['threads_profile', 'threads', 'th_1'],
  ['instagram_professional', 'instagram', 'ig_1'],
];

function build(extra = {}) {
  const socialAccounts = createFakeSocialAccountRepository();
  const posts = createFakePostRepository({ socialAccounts });
  const media = createFakeMediaAssetRepository();
  const apiUsage = extra.apiUsage ?? createFakeApiUsageRepository();
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
    apiUsage,
    openaiContentService: openai,
    socialImageService: images,
    mediaAssetService: createMediaAssetService({ mediaRepository: media }),
    uniqueness: contentUniquenessService,
    logging: noopLogging,
    withTransaction: fakeWithTransaction,
    now: () => NOW,
  });
  return { svc, socialAccounts, posts, runs, preferences, businessProfiles, openai, images, apiUsage, media };
}

async function seed(ctx, { connect = ALL_THREE, savedPlatforms = null } = {}) {
  for (const [accountType, provider, id] of connect) {
    // eslint-disable-next-line no-await-in-loop
    await ctx.socialAccounts.upsertSocialAccount({
      userId: USER, provider, accountType, providerAccountId: id,
      displayName: 'Cyfrow Solutions', username: 'cyfrow',
      encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active',
    });
  }
  await ctx.businessProfiles.createOrUpdateProfile(USER, {
    businessName: 'Cyfrow Solutions', businessCategory: 'SEO agency',
    services: ['SEO Audit'], defaultCallToAction: 'Ask us', primaryColor: '#111827',
  });
  if (savedPlatforms) {
    await ctx.preferences.upsertPreferences(USER, { platforms: savedPlatforms, timezone: 'Asia/Karachi' });
  }
  return ctx;
}

/** The live request: a three-day plan, Asia/Karachi, one post per day. */
const REQUEST = Object.freeze({
  startDate: '2026-07-14', planLength: 3, cadence: 'every_day', times: ['09:00'],
  postsPerDay: 1, timezone: 'Asia/Karachi', contentRhythmPreset: 'balanced',
});

const gen = (ctx, options = {}) => ctx.svc.generatePlan(USER, { ...REQUEST, ...options });

// --- 1. the reported bug -----------------------------------------------------

test('Instagram + Threads never becomes Instagram + Threads + Facebook', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'] });

  assert.deepEqual(plan.run.settings.platforms, ['instagram', 'threads']);
  for (const item of plan.items) {
    assert.deepEqual(item.platformTargets, ['instagram', 'threads'], 'an item drifted from the selection');
    assert.ok(!item.platformTargets.includes('facebook'));
  }
  // And nothing was written FOR Facebook, at any point.
  assert.ok(!ctx.openai._calls.some((c) => c.platform === 'facebook'), 'Facebook copy was generated');
});

// --- 2. connected is not selected --------------------------------------------

test('a connected Facebook Page is not selected just by being connected', async () => {
  const ctx = await seed(build(), { connect: ALL_THREE });
  const plan = await gen(ctx, { platforms: ['threads'] });

  assert.deepEqual(plan.run.settings.platforms, ['threads']);
  assert.deepEqual(plan.items[0].platformTargets, ['threads']);
  assert.equal(ctx.openai.callsFor('facebook'), 0);
  assert.equal(ctx.openai.callsFor('instagram'), 0);
});

// --- 3. saved defaults never override the current request --------------------

test('a saved Facebook default does not override this request', async () => {
  // The saved default says all three. The request says two. The request wins.
  const ctx = await seed(build(), { savedPlatforms: ['facebook', 'instagram', 'threads'] });
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'] });

  assert.deepEqual(plan.run.settings.platforms, ['instagram', 'threads']);
  assert.ok(!ctx.openai._calls.some((c) => c.platform === 'facebook'));
});

test('a saved default is used ONLY when the request names no platforms at all', async () => {
  // The saved preference is itself an explicit choice the user made once, so it
  // is a legitimate default — unlike "everything you have ever connected".
  const ctx = await seed(build(), { savedPlatforms: ['threads'] });
  const plan = await gen(ctx);
  assert.deepEqual(plan.run.settings.platforms, ['threads']);
});

// --- 4 & 5. single-platform selections stay single ---------------------------

test('Facebook-only stays Facebook-only', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['facebook'] });
  assert.deepEqual(plan.run.settings.platforms, ['facebook']);
  assert.deepEqual(plan.items[0].platformTargets, ['facebook']);
  assert.equal(ctx.openai.callsFor('instagram'), 0);
  assert.equal(ctx.openai.callsFor('threads'), 0);
});

test('Threads-only stays Threads-only', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['threads'] });
  assert.deepEqual(plan.run.settings.platforms, ['threads']);
  assert.deepEqual(plan.items[0].platformTargets, ['threads']);
  assert.equal(ctx.openai.callsFor('facebook'), 0);
  assert.equal(ctx.openai.callsFor('instagram'), 0);
});

// --- 6. an empty selection is refused, never filled in -----------------------

test('an empty platform selection is refused rather than filled in silently', async () => {
  const ctx = await seed(build());
  await assert.rejects(
    () => gen(ctx, { platforms: [] }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.ok(
        err.details.some((d) => d.field === 'platforms' && /Choose at least one platform/.test(d.message)),
        JSON.stringify(err.details),
      );
      return true;
    },
  );
  assert.equal(ctx.openai._calls.length, 0, 'a refused selection must cost nothing');
});

test('a request that names no platforms, with nothing saved, is refused too', async () => {
  // This is the exact path that produced the bug: no platforms in the request,
  // no saved default, three connected accounts -> "here, have all of them".
  const ctx = await seed(build());
  await assert.rejects(() => gen(ctx), (err) => {
    assert.equal(err.statusCode, 400);
    assert.ok(err.details.some((d) => d.field === 'platforms'), JSON.stringify(err.details));
    return true;
  });
  assert.equal(ctx.openai._calls.length, 0);
});

test('choosing a platform you have not connected says so, rather than substituting one', async () => {
  const ctx = await seed(build(), { connect: [['threads_profile', 'threads', 'th_1']] });
  await assert.rejects(
    () => gen(ctx, { platforms: ['facebook'] }),
    (err) => {
      assert.ok(
        err.details.some((d) => d.field === 'platforms' && /None of the platforms you chose are connected/.test(d.message)),
        JSON.stringify(err.details),
      );
      return true;
    },
  );
  assert.equal(ctx.openai._calls.length, 0);
});

// --- the contract itself -----------------------------------------------------

/*
 * Nothing in normal operation trips this, which is exactly why it is tested
 * directly: an invariant that only runs when something else is already broken
 * gets no coverage from the happy path, and would rot unnoticed until the day
 * it was needed.
 */

test('the contract accepts a plan whose briefs match the selection', () => {
  assert.doesNotThrow(() => assertPlatformContract(
    ['instagram', 'threads'],
    [{ platforms: ['instagram', 'threads'] }, { platforms: ['threads', 'instagram'] }],
  ));
});

test('the contract rejects a brief that gained a platform', () => {
  // The reported bug, as an invariant violation.
  assert.throws(
    () => assertPlatformContract(
      ['instagram', 'threads'],
      [{ platforms: ['instagram', 'threads'] }, { platforms: ['facebook', 'instagram', 'threads'] }],
    ),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /different platforms than you selected/);
      assert.match(err.message, /nothing was charged/i);
      return true;
    },
  );
});

test('the contract rejects a brief that lost a platform', () => {
  assert.throws(() => assertPlatformContract(
    ['instagram', 'threads'],
    [{ platforms: ['instagram'] }],
  ));
});

test('the contract rejects a brief with no platforms at all', () => {
  assert.throws(() => assertPlatformContract(['threads'], [{ platforms: [] }]));
  assert.throws(() => assertPlatformContract(['threads'], [{}]));
});

test('the contract compares identity, not order', () => {
  // Order is meaningful downstream (platforms[0] is the primary), so it is
  // preserved in storage — but two orderings are the same SELECTION, and the
  // contract must not fail a plan over the order its checkboxes were read in.
  assert.doesNotThrow(() => assertPlatformContract(
    ['threads', 'instagram'],
    [{ platforms: ['instagram', 'threads'] }],
  ));
  assert.equal(normalizePlatformList(['threads', 'instagram']), 'instagram,threads');
  assert.equal(normalizePlatformList(['threads', 'threads']), 'threads');
  assert.equal(normalizePlatformList(null), '');
});

// --- 7 & 8. the immutable snapshot and the items agree -----------------------

test('the run snapshot stores exactly the selected platforms', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['threads', 'instagram'] });
  // Order is preserved, not normalised: platforms[0] is the primary the post is
  // written for, and the others are written against it.
  assert.deepEqual(plan.run.settings.platforms, ['threads', 'instagram']);
});

test('every item in the plan matches the run snapshot exactly', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'], planLength: 3 });
  assert.equal(plan.items.length, 3);
  for (const item of plan.items) {
    assert.deepEqual(item.platformTargets, plan.run.settings.platforms);
  }
});

test('a duplicated selection is stored once, not twice', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['threads', 'threads', 'instagram'] });
  assert.deepEqual(plan.run.settings.platforms, ['threads', 'instagram']);
});

// --- 9, 10, 11. the selection survives reload, queue and calendar -------------

test('reloading the plan returns the exact platform list', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'] });

  const reloaded = await ctx.svc.getPlan(USER, plan.run.id);
  assert.deepEqual(reloaded.run.settings.platforms, ['instagram', 'threads']);
  for (const item of reloaded.items) {
    assert.deepEqual(item.platformTargets, ['instagram', 'threads']);
  }
});

test('queueing preserves the exact platform list and touches no Facebook account', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'] });

  for (const item of plan.items) {
    // eslint-disable-next-line no-await-in-loop
    await ctx.svc.setItemStatus(USER, item.id, 'approved');
  }
  const result = await ctx.svc.queueApproved(USER, plan.run.id, []);
  assert.ok(result.queued.length > 0, JSON.stringify(result.skipped));

  // The queued post carries the same platforms, and is attached only to the
  // Instagram and Threads accounts. The connected Facebook Page is untouched.
  const fbAccount = (await ctx.socialAccounts.listAccountsForUser(USER))
    .find((a) => a.accountType === 'facebook_page');
  for (const q of result.queued) {
    const post = await ctx.posts.findPostByIdForUser(q.postId, USER);
    const targetIds = (post.targets || []).map((t) => String(t.socialAccountId ?? t.id));
    assert.ok(!targetIds.includes(String(fbAccount.id)), 'a Facebook account was queued');
  }
});

test('the calendar shows the plan on its real platforms only', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'] });

  const items = await ctx.runs.listItemsForRun(plan.run.id, USER);
  for (const item of items) {
    assert.deepEqual(item.platformTargets, ['instagram', 'threads']);
    assert.ok(!item.platformTargets.includes('facebook'));
  }
});

// --- 12 & 13. an unselected provider costs nothing ---------------------------

test('OpenAI is never called for an unselected provider', async () => {
  const ctx = await seed(build());
  await gen(ctx, { platforms: ['instagram', 'threads'], planLength: 3 });

  const platformsCalled = [...new Set(ctx.openai._calls.map((c) => c.platform))].sort();
  assert.deepEqual(platformsCalled, ['instagram', 'threads']);
});

test('API usage is never recorded for an unselected provider', async () => {
  const apiUsage = createFakeApiUsageRepository();
  const openai = createFakePlannerOpenAI({ apiUsage });
  const ctx = await seed(build({ apiUsage, openai }));
  await gen(ctx, { platforms: ['threads'], planLength: 3 });

  // Usage is booked per provider call, so counting calls counts the spend.
  assert.equal(openai.callsFor('facebook'), 0);
  assert.equal(openai.callsFor('instagram'), 0);
  assert.equal(apiUsage._rows.length, openai._calls.length);
  assert.ok(apiUsage._rows.length > 0, 'the run really did spend something on Threads');
});

test('a plan for two platforms costs two generations per post, not three', async () => {
  const ctx = await seed(build());
  await gen(ctx, { platforms: ['instagram', 'threads'], planLength: 3 });
  // Three posts x two platforms. The third connected account is not billed for.
  assert.equal(ctx.openai.callsFor('instagram'), 3);
  assert.equal(ctx.openai.callsFor('threads'), 3);
  assert.equal(ctx.openai.callsFor('facebook'), 0);
});

// --- 14. a post-copy repair never renders an image ---------------------------

test('HCTI is not called during a post-copy repair', async () => {
  const images = { ...createFakeSocialImageService(), isReadyForUser: async () => true };
  const ctx = await seed(build({ images }));
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'], planLength: 1 });
  const before = images._calls.length;

  await ctx.svc.regenerateItem(USER, plan.items[0].id, 'caption', { force: true });
  assert.equal(images._calls.length, before, 'a copy repair rendered an image');
});

// --- 15 & 16. a repair stays inside the selection ----------------------------

test('a repair of one selected platform never reaches for an unselected one', async () => {
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'], planLength: 1 });
  const callsBefore = ctx.openai._calls.length;

  await ctx.svc.regenerateItem(USER, plan.items[0].id, 'caption', { force: true });

  const during = ctx.openai._calls.slice(callsBefore);
  assert.ok(during.length > 0, 'the retry should have generated something');
  assert.ok(!during.some((c) => c.platform === 'facebook'), 'a retry wrote Facebook copy');
});

test('an item that drifted from its run is refused before it can spend anything', async () => {
  /*
   * The contract, from the regeneration side. An item whose platform_targets no
   * longer match its run cannot be repaired: writing for the drifted list would
   * spend a generation on a platform the user never selected, and "repairing"
   * it by picking a platform for them is the original defect.
   */
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'], planLength: 1 });
  const item = plan.items[0];

  // Simulate the drift this invariant exists to catch.
  await ctx.runs.updateItem(item.id, USER, {
    platformTargets: ['instagram', 'threads', 'facebook'],
  });
  const callsBefore = ctx.openai._calls.length;

  await assert.rejects(
    () => ctx.svc.regenerateItem(USER, item.id, 'caption', { force: true }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /different platforms than the plan/);
      return true;
    },
  );
  assert.equal(ctx.openai._calls.length, callsBefore, 'a rejected mismatch must cost nothing');
});

test('a run with no platform snapshot is left alone, not broken', async () => {
  // Runs from before the snapshot existed are immutable by design. There is
  // nothing to compare against, so nothing is claimed and the retry proceeds.
  const ctx = await seed(build());
  const plan = await gen(ctx, { platforms: ['instagram', 'threads'], planLength: 1 });
  await ctx.runs.updateRun(plan.run.id, USER, { settings: { cadence: 'every_day' } });

  const updated = await ctx.svc.regenerateItem(USER, plan.items[0].id, 'caption', { force: true });
  assert.ok(updated, 'an old run must still be retryable');
});

// --- 17 & 18. failed items cannot be approved or queued ----------------------

test('a hard-failed item cannot be approved, individually or in bulk', async () => {
  const openai = createFakePlannerOpenAI({ duplicate: true });
  const ctx = await seed(build({ openai }));
  const plan = await gen(ctx, { platforms: ['threads'], planLength: 3 });

  const failed = plan.items.filter((i) => i.qualityStatus === 'generation_failed');
  assert.ok(failed.length > 0, 'this fixture should produce hard failures');

  await assert.rejects(
    () => ctx.svc.setItemStatus(USER, failed[0].id, 'approved'),
    /could not be generated/i,
  );

  // ...and bulk approval skips it rather than sneaking it through.
  const result = await ctx.svc.bulkSetStatus(USER, plan.run.id, [failed[0].id], 'approved');
  assert.equal(result.updated.length, 0);
  assert.ok(result.skipped.some((s) => s.id === failed[0].id && /generation failed/.test(s.reason)));
});

test('a hard-failed item is never queued, even if its approval status says otherwise', async () => {
  /*
   * Defence in depth. Reaching the queue requires approvalStatus APPROVED and
   * both approval paths refuse a hard failure, so the two fields can only
   * disagree through a bug — and the cost of that bug is unusable copy sitting
   * in the queue for a future publishing phase.
   */
  const openai = createFakePlannerOpenAI({ duplicate: true });
  const ctx = await seed(build({ openai }));
  const plan = await gen(ctx, { platforms: ['threads'], planLength: 3 });
  const failed = plan.items.find((i) => i.qualityStatus === 'generation_failed');

  // Force the impossible state directly in the repository.
  await ctx.runs.updateItem(failed.id, USER, { approvalStatus: PLANNER_ITEM_STATUS.APPROVED });

  const result = await ctx.svc.queueApproved(USER, plan.run.id, [failed.id]);
  assert.equal(result.queued.length, 0, 'a hard-failed post reached the queue');
  assert.ok(result.skipped.some((s) => /generation failed/.test(s.reason)), JSON.stringify(result.skipped));
});

// --- 19. the summary says what actually happened -----------------------------

test('a plan whose posts fail on LENGTH is not reported as a similarity problem', async () => {
  /*
   * The reported summary. Two posts failed because the Facebook copy was the
   * wrong length, and the plan told the user two posts were "flagged for
   * similarity review" — because `flagged` was true for ANY reason a post was
   * held, and the note only knew how to describe one of them.
   */
  const openai = createFakePlannerOpenAI({
    validate: true,
    /*
     * Two genuinely different posts, each with Facebook copy far too short.
     *
     * Threads leads, so the two posts are DISTINCT where the duplicate check
     * looks (it compares the primary platform's copy across items). If Facebook
     * led, the repair loop's three attempts per post would exhaust the script
     * and hand both posts the same primary caption — making them real
     * duplicates and proving nothing about the wording.
     */
    platformScript: {
      threads: [
        { headline: 'What to ask before you hire', caption: 'Nobody needs to understand search work to tell whether it is being done. They need one straight answer to one plain question.\n\nAsk what changed on the site this month, and on which page. If the reply is a paragraph about momentum, you have your answer already.' },
        { headline: 'Where the reporting hides', caption: 'A report that lists everything and explains nothing is doing a job, just not yours.\n\nPick one page and ask why that one was worked on. The shape of the answer tells you what you are paying for, long before the numbers do.' },
      ],
      facebook: [
        { headline: 'What to ask before you hire', caption: 'Far too short for Facebook.' },
        { headline: 'Where the reporting hides', caption: 'Also much too short to pass.' },
      ],
    },
  });
  const ctx = await seed(build({ openai }));
  const plan = await gen(ctx, { platforms: ['threads', 'facebook'], planLength: 2 });

  const notes = plan.run.generationNotes || '';
  assert.match(notes, /2 posts need another rewrite\./, notes);
  assert.ok(!/similarity/.test(notes), `nothing here is similar to anything: ${notes}`);

  // And the honest detail survives: the reason names the platform and counts.
  const failed = plan.items.filter((i) => i.qualityStatus === 'generation_failed');
  assert.equal(failed.length, 2);
  assert.ok(
    failed[0].qualityFailures.some((r) => /^Facebook has \d+ words; the minimum is 130$/.test(r)),
    JSON.stringify(failed[0].qualityFailures),
  );
});

test('one failing post is described in the singular', async () => {
  const openai = createFakePlannerOpenAI({
    validate: true,
    platformScript: { facebook: ['Far too short for Facebook.'] },
  });
  const ctx = await seed(build({ openai }));
  const plan = await gen(ctx, { platforms: ['facebook'], planLength: 1 });

  assert.match(plan.run.generationNotes, /1 post needs another rewrite\./);
});
