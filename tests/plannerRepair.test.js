/**
 * The generation-boundary and repeated-retry regression, reproduced.
 *
 * Live evidence, planner item 31:
 *
 *   quality_status      generation_failed
 *   regeneration_count  9
 *   duplication_score   0.157      <- nothing is duplicated
 *   duplication_notes   NULL       <- the 4.8 duplicate fix is holding
 *   quality_failures    "post copy is too short for threads: 44 words,
 *                        needs at least 45"
 *                       "the instagram post could not be written to a valid
 *                        length or shape"
 *
 * Everything about that row is in these tests:
 *
 *   1. Threads missed by ONE word, nine times. The prompt asked for "45 to 100
 *      words" because the validator's floor was 45 — the writer was aimed at
 *      the edge it was about to be rejected for missing.
 *   2. The Instagram reason says nothing. The exact measurements existed; the
 *      code threw them away and substituted a sentence.
 *   3. Nine regenerations of an item whose only problem was one word, each one
 *      rewriting BOTH platforms, each one real OpenAI spend.
 *
 * The fake here runs the REAL style guard (`validate: true`), so these failures
 * are produced by the production validator rather than asserted into existence.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlannerService } from '../src/services/plannerService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';
import { PLANNER_ITEM_STATUS, PLANNER_LIMITS } from '../src/config/constants.js';
import { wordCount, postCopyIssues } from '../src/services/contentStyleGuard.js';
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

const USER = '7';
const NOW = new Date('2026-07-13T06:00:00Z');
const noopLogging = { record: async () => {} };

/*
 * Real posts, measured. Each is exactly the length its name claims — asserted
 * below, so a later edit cannot quietly turn the 44-word post into a 46-word
 * one and leave the test passing for the wrong reason.
 */

/** The reported post: one word under the Threads floor of 45. */
const TH_44 = [
  'Most people paying for SEO could not tell you what they got for it last month. Ask which pages were worked on, and why those ones.',
  'A vague answer is itself the answer. You do not need the vocabulary to judge a straight reply.',
].join('\n\n');

/** Its repair: 69 words, and a genuinely different post rather than TH_44 plus padding. */
const TH_REPAIRED = [
  'Ask an agency which pages it worked on last month, and why those ones. The answer tells you more than the report will.',
  'A useful reply sounds like this: the page for the service you actually sell was thin, so it now explains what the job involves. A weak reply talks about visibility.',
  'You do not need the vocabulary to judge a straight answer. That is the whole test.',
].join('\n\n');

/** A Threads post that is already fine, and must never be rewritten. */
const TH_VALID = [
  'Nobody needs to understand search work to tell whether it is being done. They need one straight answer to one plain question.',
  'Ask what changed on the site this month, and on which page. If the reply is a paragraph about momentum, you have your answer already.',
].join('\n\n');

/** Instagram, 108 words: twelve under the floor of 120. */
const IG_108 = [
  'Most people paying for search work cannot say what they got for it last month. That is not a failure of attention on their part. It is what happens when a report is built to look busy rather than to be read.',
  'Ask which pages were touched and why those ones. Ask what changed on them, in plain words, and what the change was meant to do. A good answer is short and specific, and a weak one just talks about visibility and momentum. If the reply arrives dressed in vocabulary, you have learned something anyway, and you have learned it before the invoice rather than after it.',
].join('\n\n');

/** An Instagram post that is already fine, and must never be rewritten. */
const IG_VALID = [
  'Most people paying for search work cannot say what they got for it last month. That is not a failure of attention on their part. It is what happens when a report is built to look busy rather than to be read.',
  'Ask which pages were touched and why those ones. Ask what changed on them, in plain words, and what the change was meant to do. A good answer is short and specific: the page for the service you actually sell was thin, so it now says what the job involves and what it costs to look into. A weak answer talks about visibility and momentum.',
  'None of this needs you to understand technical work. It needs a straight reply. If the reply arrives dressed in vocabulary, you have learned something anyway, and you have learned it before the invoice rather than after it.',
].join('\n\n');

/** Instagram's repair: 136 words, restructured rather than padded. */
const IG_REPAIRED = [
  'A report that lists everything and explains nothing is doing a job, just not yours. It is built to look like work rather than to tell you what happened.',
  'So ask a smaller question. Which page changed this month, and why that one? A good answer is specific enough to check: the page for the service you actually sell explained nothing about the job, so it now says what is involved and what it costs to look into. A weak answer reaches for visibility and momentum, and reaches quickly.',
  'You do not need to know how any of it works to judge the reply. You only need it to be a reply. If it arrives wrapped in vocabulary, that has told you something too, and it has told you before the invoice rather than after it.',
].join('\n\n');

const IG_ONE_PARAGRAPH = IG_VALID.replace(/\n\n/g, ' ');

const HEADLINE = 'What SEO work is worth paying for';

test('the fixtures are the lengths this file claims they are', () => {
  // The whole file is about exact counts. If these drift, every assertion below
  // is measuring something other than what it says.
  assert.equal(wordCount(TH_44), 44);
  assert.equal(wordCount(IG_108), 108);
  assert.deepEqual(postCopyIssues(TH_44, 'threads'), ['Threads has 44 words; the minimum is 45']);
  assert.deepEqual(postCopyIssues(IG_108, 'instagram'), ['Instagram has 108 words; the minimum is 120']);
  // And the good ones really are good, so a preserved sibling is preserved
  // because it passes rather than because the validator is asleep.
  assert.deepEqual(postCopyIssues(TH_VALID, 'threads'), []);
  assert.deepEqual(postCopyIssues(IG_VALID, 'instagram'), []);
  assert.deepEqual(postCopyIssues(TH_REPAIRED, 'threads'), []);
  assert.deepEqual(postCopyIssues(IG_REPAIRED, 'instagram'), []);
});

// --- harness -----------------------------------------------------------------

function repos() {
  const socialAccounts = createFakeSocialAccountRepository();
  return {
    socialAccounts,
    posts: createFakePostRepository({ socialAccounts }),
    media: createFakeMediaAssetRepository(),
    businessProfiles: createFakeBusinessProfileRepository(),
    preferences: createFakePlannerPreferenceRepository(),
    runs: createFakePlannerRunRepository(),
    apiUsage: createFakeApiUsageRepository(),
  };
}

function serviceOver(r, openai, images) {
  return createPlannerService({
    preferences: r.preferences,
    runs: r.runs,
    businessProfiles: r.businessProfiles,
    socialAccounts: r.socialAccounts,
    posts: r.posts,
    mediaRepository: r.media,
    apiUsage: r.apiUsage,
    openaiContentService: openai,
    socialImageService: images,
    mediaAssetService: createMediaAssetService({ mediaRepository: r.media }),
    uniqueness: contentUniquenessService,
    logging: noopLogging,
    withTransaction: fakeWithTransaction,
    now: () => NOW,
  });
}

/** Instagram Professional and Threads. No Facebook Page is connected. */
async function seedAccounts(socialAccounts) {
  for (const [accountType, provider, id] of [
    ['instagram_professional', 'instagram', 'ig_1'],
    ['threads_profile', 'threads', 'th_1'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await socialAccounts.upsertSocialAccount({
      userId: USER, provider, accountType, providerAccountId: id,
      displayName: 'Cyfrow Solutions', username: 'cyfrow',
      encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active',
    });
  }
}

const RUN = Object.freeze({
  startDate: '2026-07-14', planLength: 1, cadence: 'every_day',
  times: ['09:00'], postsPerDay: 1, timezone: 'Asia/Karachi',
  platforms: ['instagram', 'threads'], contentRhythmPreset: 'balanced',
});

/**
 * An item in planner item 31's exact state, with the copy each platform holds
 * stated explicitly.
 *
 * The plan is generated through the real service (so the item has a real
 * fingerprint, real rhythm and real per-platform structure), then the copy and
 * the failure are set to the reported values. The RETRY is then run by a second
 * service wired to the repair script, which is the code actually under test.
 */
async function failedItem({ instagram, threads, failures, images } = {}) {
  const r = repos();
  await seedAccounts(r.socialAccounts);
  await r.businessProfiles.createOrUpdateProfile(USER, {
    businessName: 'Cyfrow Solutions',
    businessCategory: 'SEO agency',
    services: ['SEO Audit'],
    defaultCallToAction: 'Ask us',
    primaryColor: '#111827',
    websiteUrl: 'https://cyfrowsolutions.com',
  });

  const seedImages = { ...createFakeSocialImageService(), isReadyForUser: async () => true };
  const plan = await serviceOver(r, createFakePlannerOpenAI(), seedImages).generatePlan(USER, RUN);
  const created = plan.items[0];

  await r.runs.updateItem(created.id, USER, {
    headline: HEADLINE,
    caption: instagram,
    hashtags: ['#seo'],
    platformCaptions: {
      instagram: { caption: instagram, hashtags: ['#seo'] },
      threads: { caption: threads, hashtags: [] },
    },
    approvalStatus: PLANNER_ITEM_STATUS.GENERATION_FAILED,
    qualityStatus: 'generation_failed',
    qualityFailures: failures,
    // The live row: nothing is duplicated. This is what proves the retry path
    // being exercised is the REPAIR, not the duplicate rewrite.
    duplicationScore: 0.157,
    duplicationNotes: null,
    regenerationCount: 9,
  });

  const item = await r.runs.findItemByIdForUser(created.id, USER);
  return { r, item, plan };
}

/** Wire a repair service whose writer returns these posts, per platform, in order. */
function repairService(r, platformScript, images) {
  const openai = createFakePlannerOpenAI({
    platformScript,
    validate: true,
    apiUsage: r.apiUsage,
  });
  const hcti = images ?? { ...createFakeSocialImageService(), isReadyForUser: async () => true };
  return { svc: serviceOver(r, openai, hcti), openai, hcti };
}

const retry = (svc, item) => svc.regenerateItem(USER, item.id, 'caption', { force: true });

// --- the reported failure: Threads, one word short ---------------------------

test('a 44-word Threads post is repaired, and only Threads is rewritten', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID,
    threads: TH_44,
    failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc, openai } = repairService(r, { threads: [TH_REPAIRED] });

  const updated = await retry(svc, item);

  // Only the broken platform was written. The passing one cost nothing.
  assert.equal(openai.callsFor('threads'), 1, 'Threads should be rewritten exactly once');
  assert.equal(openai.callsFor('instagram'), 0, 'a passing Instagram post must not be rewritten');
  assert.equal(openai.callsFor('facebook'), 0);

  assert.equal(updated.platformCaptions.threads.caption, TH_REPAIRED);
  assert.equal(updated.platformCaptions.instagram.caption, IG_VALID, 'the passing sibling is untouched');
});

test('the repaired Threads copy lands safely above the floor, not on it', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc } = repairService(r, { threads: [TH_REPAIRED] });

  const updated = await retry(svc, item);
  const words = wordCount(updated.platformCaptions.threads.caption);

  assert.deepEqual(postCopyIssues(updated.platformCaptions.threads.caption, 'threads'), []);
  assert.ok(words >= 45, `${words} words is still under the floor`);
  // The point of the fix: not "scraped over the line" but "clear of it".
  assert.ok(words >= 55, `${words} words clears the floor by too little to be safe`);
});

test('a repair adds a real sentence; it never pads the old post to length', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc, openai } = repairService(r, { threads: [TH_REPAIRED] });

  const updated = await retry(svc, item);
  const repaired = updated.platformCaptions.threads.caption;

  // Stored exactly as the writer produced it: the service adds nothing of its
  // own to satisfy a word count.
  assert.equal(repaired, TH_REPAIRED);
  assert.ok(
    !repaired.startsWith(TH_44.slice(0, 40)),
    'the repair is the old post with something bolted on the end',
  );

  // And the writer was told, in the request, not to pad.
  const request = openai._calls.find((c) => c.platform === 'threads');
  const notes = (request.repairNotes ?? []).join(' | ');
  assert.match(notes, /add a useful sentence/i, JSON.stringify(request.repairNotes));
  assert.match(notes, /Do NOT pad with filler/i, JSON.stringify(request.repairNotes));
});

// --- the retry is told the numbers -------------------------------------------

test('a Threads repair is told its actual count, the floor, and the band to aim at', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc, openai } = repairService(r, { threads: [TH_REPAIRED] });
  await retry(svc, item);

  const request = openai._calls.find((c) => c.platform === 'threads');

  // The stored reason reaches the writer verbatim.
  assert.ok(
    (request.styleIssues ?? []).includes('Threads has 44 words; the minimum is 45'),
    JSON.stringify(request.styleIssues),
  );
  // ...along with the band, which is NOT the validator's floor.
  assert.deepEqual(request.targetBand, { min: 55, max: 85 });
});

test('an Instagram repair is told its exact word count, not "invalid length or shape"', async () => {
  const { r, item } = await failedItem({
    instagram: IG_108,
    threads: TH_VALID,
    failures: ['Instagram has 108 words; the minimum is 120'],
  });
  const { svc, openai } = repairService(r, { instagram: [IG_REPAIRED] });
  await retry(svc, item);

  const request = openai._calls.find((c) => c.platform === 'instagram');
  const seen = [...(request.styleIssues ?? []), ...(request.repairNotes ?? [])].join(' | ');

  assert.match(seen, /108 words/, seen);
  assert.match(seen, /minimum is 120/, seen);
  assert.match(seen, /12 words below/, `it should say how far short it fell: ${seen}`);
  assert.ok(!/valid length or shape/.test(seen), seen);
});

test('an Instagram post in one block is told its paragraph count and the range', async () => {
  const { r, item } = await failedItem({
    instagram: IG_ONE_PARAGRAPH,
    threads: TH_VALID,
    failures: ['Instagram has 1 paragraph; it needs 2 to 4'],
  });
  const { svc, openai } = repairService(r, { instagram: [IG_REPAIRED] });
  await retry(svc, item);

  const request = openai._calls.find((c) => c.platform === 'instagram');
  const seen = [...(request.styleIssues ?? []), ...(request.repairNotes ?? [])].join(' | ');

  assert.match(seen, /1 paragraph/, seen);
  assert.match(seen, /2 to 4/, seen);
});

// --- passing platforms are preserved, in both directions ---------------------

test('a passing Threads post is preserved when only Instagram fails', async () => {
  const { r, item } = await failedItem({
    instagram: IG_108, threads: TH_VALID, failures: ['Instagram has 108 words; the minimum is 120'],
  });
  const { svc, openai } = repairService(r, { instagram: [IG_REPAIRED] });

  const updated = await retry(svc, item);

  assert.equal(openai.callsFor('threads'), 0, 'a passing Threads post must not be rewritten');
  assert.equal(updated.platformCaptions.threads.caption, TH_VALID);
  assert.equal(updated.platformCaptions.instagram.caption, IG_REPAIRED);
});

test('when the PRIMARY platform is repaired, the canonical caption follows it', async () => {
  // `caption` is the primary platform's copy, and the board and the resolver
  // both read it. A repair that moved platform_captions_json and left `caption`
  // behind would recreate the divergence 4.8 fixed.
  const { r, item } = await failedItem({
    instagram: IG_108, threads: TH_VALID, failures: ['Instagram has 108 words; the minimum is 120'],
  });
  assert.equal(item.platformTargets[0], 'instagram', 'this test assumes Instagram is primary');

  const { svc } = repairService(r, { instagram: [IG_REPAIRED] });
  const updated = await retry(svc, item);

  assert.equal(updated.caption, IG_REPAIRED);
  assert.equal(updated.platformCaptions.instagram.caption, IG_REPAIRED);
});

test('repairing a SIBLING leaves the canonical caption and the fingerprint alone', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const before = await r.runs.findItemByIdForUser(item.id, USER);
  const { svc } = repairService(r, { threads: [TH_REPAIRED] });

  await retry(svc, item);
  const after = await r.runs.findItemByIdForUser(item.id, USER);

  assert.equal(after.caption, IG_VALID, 'the primary caption did not change, so it must not move');
  // The fingerprint describes the PRIMARY copy. Refreshing it after repairing a
  // sibling would describe text Instagram never held.
  assert.deepEqual(after.fingerprint, before.fingerprint);
});

test('both platforms failing are repaired independently, each within its own budget', async () => {
  // Item 31's real state: threads short AND instagram vague.
  const { r, item } = await failedItem({
    instagram: IG_108,
    threads: TH_44,
    failures: ['Threads has 44 words; the minimum is 45', 'Instagram has 108 words; the minimum is 120'],
  });
  const { svc, openai } = repairService(r, {
    threads: [TH_REPAIRED],
    instagram: [IG_REPAIRED],
  });

  const updated = await retry(svc, item);

  assert.equal(openai.callsFor('threads'), 1);
  assert.equal(openai.callsFor('instagram'), 1);
  assert.equal(updated.qualityStatus, 'needs_review');
  assert.equal(updated.platformCaptions.threads.caption, TH_REPAIRED);
  assert.equal(updated.platformCaptions.instagram.caption, IG_REPAIRED);
});

// --- what a repair must not touch --------------------------------------------

test('a post-copy repair never renders an image and never calls HCTI', async () => {
  const images = { ...createFakeSocialImageService(), isReadyForUser: async () => true };
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'], images,
  });
  const mediaBefore = item.mediaAssetId;
  const { svc, hcti } = repairService(r, { threads: [TH_REPAIRED] }, images);

  const updated = await retry(svc, item);

  assert.equal(hcti._calls.length, 0, 'a post-copy retry must not spend an image render');
  assert.equal(updated.mediaAssetId, mediaBefore, 'the existing image must survive a copy repair');
});

test('a repair changes the copy and nothing else about the post', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const before = await r.runs.findItemByIdForUser(item.id, USER);
  const { svc } = repairService(r, { threads: [TH_REPAIRED] });

  const updated = await retry(svc, item);

  // The selection: Instagram and Threads, in that order, and no Facebook has
  // appeared from the user's connected pages.
  assert.deepEqual(updated.platformTargets, ['instagram', 'threads']);
  assert.ok(!updated.platformTargets.includes('facebook'), 'Facebook was never selected');

  // The schedule, the timezone, the template and the image copy.
  assert.equal(updated.scheduledFor, before.scheduledFor);
  assert.equal(updated.originalTimezone, 'Asia/Karachi');
  assert.equal(updated.originalTimezone, before.originalTimezone);
  assert.equal(updated.templateKey, before.templateKey);
  assert.equal(updated.aspectRatio, before.aspectRatio);
  assert.equal(updated.backgroundStyle, before.backgroundStyle);
  assert.equal(updated.headline, before.headline);
  assert.equal(updated.subheadline, before.subheadline);
  assert.equal(updated.contentPillar, before.contentPillar);
});

test('a user edit on an unaffected platform survives the repair of another', async () => {
  const EDITED = IG_VALID.replace('Most people', 'Almost everyone');
  const { r, item } = await failedItem({
    instagram: EDITED, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  await r.runs.updateItem(item.id, USER, { editedFields: ['caption'] });
  const fresh = await r.runs.findItemByIdForUser(item.id, USER);
  const { svc } = repairService(r, { threads: [TH_REPAIRED] });

  const updated = await retry(svc, fresh);

  assert.equal(updated.caption, EDITED, 'the human wrote this; a Threads repair must not touch it');
  assert.equal(updated.platformCaptions.instagram.caption, EDITED);
});

// --- the failure record ------------------------------------------------------

test('quality failures store the exact platform reasons, never a generic summary', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  // Every attempt comes back one word short: this is item 31's nine retries.
  const { svc } = repairService(r, { threads: [TH_44] });

  const updated = await retry(svc, item);

  assert.equal(updated.qualityStatus, 'generation_failed');
  assert.deepEqual(updated.qualityFailures, ['Threads has 44 words; the minimum is 45']);
  // The exact string the user was given nine times, and which sent them to
  // phpMyAdmin to find out what it meant.
  for (const reason of updated.qualityFailures) {
    assert.ok(!/valid length or shape/.test(reason), reason);
  }
});

test('a failure that cannot be fixed names the platform that failed and no other', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc } = repairService(r, { threads: [TH_44] });

  const updated = await retry(svc, item);

  assert.ok(updated.qualityFailures.every((f) => f.startsWith('Threads')), JSON.stringify(updated.qualityFailures));
  assert.equal(updated.platformCaptions.instagram.caption, IG_VALID, 'the passing platform is still passing');
});

// --- the attempt budget ------------------------------------------------------

test('a platform is attempted three times and then stops', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc, openai } = repairService(r, { threads: [TH_44] });

  await retry(svc, item);

  assert.equal(
    openai.callsFor('threads'),
    PLANNER_LIMITS.MAX_COPY_ATTEMPTS,
    'a writer that fails three times is not asked a fourth time',
  );
});

test('each attempt is a different instruction, and the last is pushed off the edge', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc, openai } = repairService(r, { threads: [TH_44] });
  await retry(svc, item);

  const attempts = openai._calls.filter((c) => c.platform === 'threads');
  assert.equal(attempts.length, 3);

  // Attempts 1 and 2 aim at the safe band; attempt 3, after two misses in the
  // same direction, is aimed higher. Retrying the same prompt three times is
  // what item 31 did nine times.
  assert.deepEqual(attempts[0].targetBand, { min: 55, max: 85 });
  assert.deepEqual(attempts[1].targetBand, { min: 55, max: 85 });
  assert.ok(attempts[2].targetBand.min > 55, JSON.stringify(attempts[2].targetBand));

  // EVERY attempt carries the measurements, including the first: the copy that
  // failed is in the database, so its counts are known before a call is made.
  // Starting a retry blind is what nine of item 31's regenerations were.
  for (const [i, attempt] of attempts.entries()) {
    assert.match((attempt.repairNotes ?? []).join(' '), /44 words/, `attempt ${i + 1} was sent blind`);
  }
});

test('a repair that succeeds on the second attempt does not make a third', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc, openai } = repairService(r, { threads: [TH_44, TH_REPAIRED] });

  const updated = await retry(svc, item);

  assert.equal(openai.callsFor('threads'), 2, 'it stops as soon as the copy is valid');
  assert.equal(updated.qualityStatus, 'needs_review');
});

// --- status and stale detail -------------------------------------------------

test('a successful repair leaves Generation failed and clears the old reasons', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  assert.equal(item.qualityStatus, 'generation_failed');

  const { svc } = repairService(r, { threads: [TH_REPAIRED] });
  const updated = await retry(svc, item);

  assert.equal(updated.qualityStatus, 'needs_review');
  assert.equal(updated.approvalStatus, PLANNER_ITEM_STATUS.NEEDS_REVIEW);
  // A stale reason under a passing post is a lie the user cannot disprove.
  assert.equal(updated.qualityFailures, null);
});

test('a repair that fails stays failed rather than laundering the post', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc } = repairService(r, { threads: [TH_44] });

  const updated = await retry(svc, item);

  assert.equal(updated.qualityStatus, 'generation_failed');
  assert.equal(updated.approvalStatus, PLANNER_ITEM_STATUS.GENERATION_FAILED);
});

test('a retry counts as one regeneration, whatever it had to do internally', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc } = repairService(r, { threads: [TH_44] });

  const updated = await retry(svc, item);

  assert.equal(updated.regenerationCount, 10, 'nine clicks had already happened; this is the tenth');
});

// --- duplicate clicks --------------------------------------------------------

test('two clicks in flight together produce ONE generation and one clear conflict', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc, openai } = repairService(r, { threads: [TH_REPAIRED] });

  // Exactly the reported behaviour: the user clicks, sees nothing happen, and
  // clicks again before the first has returned.
  const [first, second] = await Promise.allSettled([retry(svc, item), retry(svc, item)]);

  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  assert.equal(second.reason.name, 'ConflictError');
  assert.match(second.reason.message, /already being regenerated/i);

  assert.equal(openai.callsFor('threads'), 1, 'the second click must not buy a second generation');
});

test('a blocked click costs the user nothing', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc, openai, hcti } = repairService(r, { threads: [TH_REPAIRED] });
  const usageBefore = r.apiUsage._rows.length;

  const results = await Promise.allSettled([retry(svc, item), retry(svc, item), retry(svc, item)]);

  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter((x) => x.status === 'rejected').length, 2);

  // Usage is booked per provider call, so this is the real question: three
  // clicks, one generation, one usage record, no image render.
  assert.equal(openai._calls.length, 1);
  assert.equal(r.apiUsage._rows.length - usageBefore, 1, 'three clicks must not be charged three times');
  assert.equal(hcti._calls.length, 0);
});

test('the guard releases, so a later retry is allowed', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const { svc, openai } = repairService(r, { threads: [TH_44, TH_44, TH_44, TH_REPAIRED] });

  await retry(svc, item);
  const fresh = await r.runs.findItemByIdForUser(item.id, USER);
  // A sequential second click is a genuine new request, not a double-click, and
  // must work: the guard is for concurrency, not a lockout.
  const updated = await retry(svc, fresh);

  assert.equal(updated.qualityStatus, 'needs_review');
  assert.ok(openai.callsFor('threads') > 3);
});

test('a failed regeneration still releases the guard', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const broken = createFakePlannerOpenAI({ error: new Error('provider down') });
  const svc = serviceOver(r, broken, { ...createFakeSocialImageService(), isReadyForUser: async () => true });

  // Every attempt throws, so the repair returns nothing usable and the item
  // stays failed — but the guard must not be left holding the key.
  await retry(svc, item);
  const again = await retry(svc, await r.runs.findItemByIdForUser(item.id, USER));

  assert.equal(again.qualityStatus, 'generation_failed');
});

test('a provider outage leaves the existing copy in place rather than blanking it', async () => {
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  const broken = createFakePlannerOpenAI({ error: new Error('provider down') });
  const svc = serviceOver(r, broken, { ...createFakeSocialImageService(), isReadyForUser: async () => true });

  const updated = await retry(svc, item);

  assert.equal(updated.platformCaptions.threads.caption, TH_44, 'replacing real copy with nothing is worse');
  assert.equal(updated.platformCaptions.instagram.caption, IG_VALID);
  assert.deepEqual(updated.qualityFailures, ['Threads has 44 words; the minimum is 45']);
});

test('copy that comes back as a paste of its sibling is not quietly accepted', async () => {
  /*
   * The other way a platform's copy can be unusable. It passes every length and
   * grammar rule and is still wrong, because it is the Instagram post wearing a
   * Threads label — the exact defect per-platform generation exists to prevent.
   *
   * A repair that only looked at style rejections would find none here and mark
   * the item passing.
   */
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_44, failures: ['Threads has 44 words; the minimum is 45'],
  });
  // The writer returns the Instagram post, trimmed to a Threads-legal length.
  const PASTED = IG_VALID.split('\n\n').slice(0, 2).join('\n\n');
  const { svc } = repairService(r, { threads: [PASTED] });

  const updated = await retry(svc, item);

  assert.equal(updated.qualityStatus, 'generation_failed', 'one post pasted twice is not a repair');
  assert.ok(
    updated.qualityFailures.some((f) => /repeats the post written for Instagram/.test(f)),
    JSON.stringify(updated.qualityFailures),
  );
});

// --- GENERATION reports exactly what it could not write ----------------------

/*
 * The live row's second reason — "the instagram post could not be written to a
 * valid length or shape" — was written by plan GENERATION, not by the retry.
 * Every test above drives the retry, so without these two the generation path
 * could quietly go back to swallowing its reasons and nothing would notice.
 */

async function planWith(platformScript) {
  const r = repos();
  await seedAccounts(r.socialAccounts);
  await r.businessProfiles.createOrUpdateProfile(USER, {
    businessName: 'Cyfrow Solutions', businessCategory: 'SEO agency',
    services: ['SEO Audit'], defaultCallToAction: 'Ask us',
    primaryColor: '#111827', websiteUrl: 'https://cyfrowsolutions.com',
  });
  const openai = createFakePlannerOpenAI({ platformScript, validate: true, apiUsage: r.apiUsage });
  const images = { ...createFakeSocialImageService(), isReadyForUser: async () => true };
  const plan = await serviceOver(r, openai, images).generatePlan(USER, RUN);
  return { r, openai, item: plan.items[0] };
}

test('generation stores the sibling platform\'s exact reason, not a summary of it', async () => {
  // Instagram writes fine; Threads comes back one word short every time.
  const { item } = await planWith({ instagram: [IG_VALID], threads: [TH_44] });

  assert.equal(item.qualityStatus, 'generation_failed');
  assert.ok(
    item.qualityFailures.includes('Threads has 44 words; the minimum is 45'),
    JSON.stringify(item.qualityFailures),
  );
  for (const reason of item.qualityFailures) {
    assert.ok(!/valid length or shape/.test(reason), `generation swallowed its reason: ${reason}`);
  }
});

test('generation gives a failing sibling platform three attempts and no more', async () => {
  const { openai } = await planWith({ instagram: [IG_VALID], threads: [TH_44] });
  assert.equal(openai.callsFor('threads'), PLANNER_LIMITS.MAX_COPY_ATTEMPTS);
});

test('a sibling repaired on its second attempt is generated clean, with no failure at all', async () => {
  const { item, openai } = await planWith({
    instagram: [IG_VALID],
    threads: [TH_44, TH_REPAIRED],
  });

  assert.equal(openai.callsFor('threads'), 2, 'it stops as soon as the copy is valid');
  assert.equal(item.qualityFailures, null);
  assert.notEqual(item.qualityStatus, 'generation_failed');
});

// --- the duplicate path is not broken by any of this -------------------------

test('a DUPLICATE failure still rewrites the whole post, not just one platform', async () => {
  // A duplicate is an item-level problem: the angle repeats another post, so the
  // primary has to be rewritten and every platform follows it. Narrowing that to
  // one platform would leave the repetition in place.
  const { r, item } = await failedItem({
    instagram: IG_VALID, threads: TH_VALID, failures: ['this post is a near-duplicate of another one'],
  });
  await r.runs.updateItem(item.id, USER, {
    duplicationNotes: 'Too similar to a recent post: a similar angle, the same hashtags.',
    duplicationScore: 0.91,
  });
  const fresh = await r.runs.findItemByIdForUser(item.id, USER);
  const { svc, openai } = repairService(r, {
    instagram: [IG_REPAIRED], threads: [TH_REPAIRED],
  });

  await retry(svc, fresh);

  assert.ok(openai.callsFor('instagram') >= 1, 'the primary must be rewritten for a duplicate');
  assert.ok(openai.callsFor('threads') >= 1, 'and the siblings follow the new primary');
});
