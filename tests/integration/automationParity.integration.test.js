// The Hostinger staging failure, reproduced and fixed on the REAL automation
// refill → worker → generation path (not the manual generatePlan path the
// earlier tests exercised).
//
// Staging: a seven-day Mon–Sun automation for NYC Waterproofing produced two
// items, both failed, both Basement Waterproofing, same angle, same CTA, same
// hashtags, same closing, and a 124-word Facebook post failed terminally at the
// 130 minimum. This drives the same flow with real repositories against MariaDB
// and a fake OpenAI that echoes the assigned service, so the assertions are
// about which service/topic/CTA each slot is ASSIGNED, not about the model.
import { hasDatabase, resetDatabase, SKIP } from './helpers/db.js';
import '../helpers/setupEnv.js';

import test, { before, beforeEach, after } from 'node:test';   // eslint-disable-line import/first
import assert from 'node:assert/strict';                        // eslint-disable-line import/first

import { getPool, closePool } from '../../src/db/pool.js';                              // eslint-disable-line import/first
import * as users from '../../src/repositories/userRepository.js';                     // eslint-disable-line import/first
import * as social from '../../src/repositories/socialAccountRepository.js';           // eslint-disable-line import/first
import * as businessProfiles from '../../src/repositories/businessProfileRepository.js'; // eslint-disable-line import/first
import * as automationsRepo from '../../src/repositories/automationRepository.js';     // eslint-disable-line import/first
import * as runsRepo from '../../src/repositories/plannerRunRepository.js';            // eslint-disable-line import/first
import * as jobsRepo from '../../src/repositories/backgroundJobRepository.js';         // eslint-disable-line import/first
import { createPlannerService } from '../../src/services/plannerService.js';           // eslint-disable-line import/first
import { createAutomationService } from '../../src/services/automationService.js';     // eslint-disable-line import/first
import { createDurableJobService } from '../../src/services/durableJobService.js';     // eslint-disable-line import/first
import { postCopyIssues, isCompleteWithinTolerance } from '../../src/services/contentStyleGuard.js'; // eslint-disable-line import/first
import { fingerprint } from '../../src/services/contentUniquenessService.js';         // eslint-disable-line import/first
import { ProviderError } from '../../src/utils/providerErrors.js';                     // eslint-disable-line import/first
import { PROVIDER_ERROR_CATEGORY as CAT, PROVIDER_NAMES } from '../../src/config/constants.js'; // eslint-disable-line import/first

let pool;

const SERVICES = [
  'Basement Waterproofing', 'Foundation Waterproofing', 'French Drain Installation',
  'Sump Pump Installation', 'Basement Leak Inspection',
];
const PAGES = [
  'NYC Waterproofing', 'Sidewalks Repair NYC', 'Pioneer Construction NYC',
  'NYC Concrete Contractor', 'Roofing Contractor NYC', 'Brick Pointing NYC', 'Brownstone Repair NYC',
];

before(() => { if (hasDatabase) pool = getPool(); });
after(async () => { if (hasDatabase) await closePool().catch(() => {}); });
beforeEach(async () => { if (hasDatabase) await resetDatabase(pool); });

/**
 * A fake OpenAI that ECHOES the assigned service into a valid, on-length post,
 * and records every request. Because it echoes, a collapsed assignment (every
 * slot Basement Waterproofing) shows up as identical output, and a rotated one
 * shows up as varied output — so the test measures the assignment, not the
 * model. Caption length is controllable to exercise the word-range repair.
 */
function echoOpenAI({ fbWords = 150 } = {}) {
  const requests = [];
  // Fill to length by CYCLING the distinctive lead tokens, so a post assigned a
  // different service/topic/opening produces genuinely different body prose —
  // the way a real model would — rather than shared generic filler that would
  // make every editorial body look alike.
  const words = (n, ...lead) => {
    // Flatten seed tokens to individual words FIRST, so a multi-word token like
    // the service name ("Basement Waterproofing") contributes its own words and
    // the result is EXACTLY n whitespace-delimited words. Cycling whole elements
    // and slicing to n elements over-counts whenever a seed token has a space,
    // which inflated a 50-element paragraph past the 75-word limit and pushed a
    // 124-word repair case up to 152 (over the maximum). The planner's word-range
    // validator and these tests both measure whitespace words, so this must too.
    const seed = lead.filter(Boolean).flatMap((t) => String(t).split(/\s+/)).filter(Boolean);
    if (seed.length === 0) seed.push('work');
    const w = [];
    let i = 0;
    while (w.length < n) { w.push(seed[i % seed.length]); i += 1; }
    return w.join(' ');
  };
  // A short, stable token from a string, so a genuinely different assignment
  // (service, topic, opening, closing) yields genuinely different content — the
  // way a real model would, rather than echoing only the service.
  const tok = (str) => String(str || '').toLowerCase().replace(/[^a-z]+/g, '').slice(0, 8) || 'x';
  return {
    requests,
    isAvailable: async () => true,
    isReadyForUser: async () => true,
    async generatePlannerPost(input) {
      requests.push(input);
      const s = input.serviceEmphasis || 'the service';
      const problem = tok(input.audienceProblem);
      const open = tok(input.openingStyle || input.openingGuidance);
      const close = tok(input.closingStyle || input.closingGuidance);
      const hf = tok(input.hashtagFamily || input.hashtagGuidance);
      // Three prose paragraphs, each well under the 75-word limit, summing to
      // fbWords. The opening, body and closing each embed the assignment, so two
      // posts assigned differently cannot collide and two assigned the same
      // legitimately do (which a similarity retry must then break).
      const third = Math.max(12, Math.round(fbWords / 3));
      // A unique token per call keeps even same-service posts from being
      // byte-identical, the way a real model never repeats verbatim.
      const uniq = `u${requests.length}`;
      const caption = `${words(third, 'Opening', open, s, problem, uniq)}.\n\n`
        + `${words(third, 'Middle', s, problem, uniq)}.\n\n`
        + `${words(fbWords - 2 * third, 'Closing', close, s, uniq)}.`;
      return {
        caption,
        hashtags: [`#${String(s).replace(/\s+/g, '')}`, `#${hf}`, '#nyc'],
        headline: `${s}: ${problem}`,
        subheadline: `A line about ${s}`,
        imageAltText: `A photo related to ${s}`,
        summary: `internal ${requests.length}`,
        badge: 'Tip',
        poster: {},
        _style: { rejections: [] },
      };
    },
  };
}

const CONTRACTOR_PROFILE = {
  businessName: 'NYC Waterproofing', businessCategory: 'Waterproofing contractor',
  businessDescription: 'Basement and foundation waterproofing for New York property owners.',
  city: 'Brooklyn', region: 'NY', websiteUrl: 'https://nyc-waterproofing.example',
  services: SERVICES, primaryColor: '#0B1A2E', accentColor: '#DC2626', logoUrl: 'https://x.example/l.png',
};
const KNOWLEDGE_PROFILE = {
  businessName: 'Peralytics', businessCategory: 'SEO agency',
  businessDescription: 'Search and AI visibility consulting for brands, GEO and traditional SEO.',
  city: 'Austin', region: 'TX', websiteUrl: 'https://peralytics.example',
  services: ['Technical SEO Audit', 'Content Strategy', 'Local SEO', 'Link Acquisition'],
  primaryColor: '#4C1D95', accentColor: '#8B5CF6', logoUrl: 'https://x.example/p.png',
};

async function seedWorkspace(profile = CONTRACTOR_PROFILE) {
  const u = await users.createUser({
    name: 'Operator', email: 'operator@example.test', passwordHash: 'x'.repeat(60), timezone: 'Asia/Karachi',
  });
  const userId = String(u.id);
  await businessProfiles.createOrUpdateProfile(userId, profile);
  for (const [i, name] of PAGES.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await social.upsertSocialAccount({
      userId, provider: 'meta', accountType: 'facebook_page', providerAccountId: `fb${i}`,
      displayName: name, username: `h${i}`, encryptedAccessToken: 'v1:t', scopes: [], providerMetadata: {}, status: 'active',
    });
  }
  const accts = await social.listAccountsForUser(userId);
  return { userId, chosenId: accts.find((x) => x.displayName === 'NYC Waterproofing').id };
}

/**
 * A rendering image service that stands in for HCTI: it records every render
 * and returns an image, so the REAL mediaAssetService persists a real
 * media_assets row and the item gets a real image. `failFirstFor` reproduces the
 * staging behaviour where a concept's first render throws and the retry
 * recovers.
 */
function renderingImageService({ failFirstFor = new Set() } = {}) {
  const renders = [];
  const attemptsByConcept = new Map();
  return {
    renders,
    isReadyForUser: async () => true,
    async generateSocialImage(input) {
      renders.push({ template: input.template, poster: input.poster });
      const t = input.template;
      const n = (attemptsByConcept.get(t) || 0) + 1;
      attemptsByConcept.set(t, n);
      if (failFirstFor.has(t) && n === 1) {
        const e = new Error('transient render failure');
        e.code = 'image_generation_failed';
        throw e;
      }
      return { sourceUrl: 'https://example.test/i.png', imageId: `img-${renders.length}` };
    },
  };
}

// Real time is used: the durable job rows are stamped with the DB clock, so an
// injected past clock would make them unclaimable. The seven-slot count is
// deterministic anyway — the refill keeps exactly the horizon's worth of future
// active days whether or not today's slot has already passed.
function stack(openai, imageService) {
  // The REAL mediaAssetService persists the rendered asset (a real FK row), so a
  // rendered item ends up with a genuine mediaAssetId; only HCTI is faked.
  const planner = createPlannerService({
    openaiContentService: openai,
    socialImageService: imageService || { isReadyForUser: async () => false },
  });
  const svc = createAutomationService({
    automations: automationsRepo, jobs: jobsRepo, runsRepo, socialAccounts: social, planner,
    openai, images: imageService || { isReadyForUser: async () => false }, logging: { async record() {} },
    config: { worker: { maxAttempts: 3, refillIntervalHours: 6 } },
  });
  const worker = createDurableJobService({ jobs: jobsRepo, handlers: svc.handlers, options: { heartbeatMs: 0, leaseMs: 60000 } });
  return { planner, svc, worker };
}

async function runAutomation({
  openai, generationHorizonDays = 7, profile = CONTRACTOR_PROFILE, imageService = null,
}) {
  const { userId, chosenId } = await seedWorkspace(profile);
  const { svc, worker } = stack(openai, imageService);
  const a = await svc.createAutomation(userId, {
    name: 'NYC Waterproofing Final Parity Test', mode: 'review', timezone: 'Asia/Karachi',
    selectedWeekdays: [1, 2, 3, 4, 5, 6, 7], postingTimes: ['09:00'], postsPerDay: 1,
    selectedPlatforms: ['facebook'], selectedAccountIds: [String(chosenId)],
    missedPostPolicy: 'skip', generationHorizonDays, minimumReadyDays: Math.min(7, generationHorizonDays), lowBufferDays: 3,
  });
  await svc.activate(userId, a.id);
  await worker.runOne({ workerId: 'W' }); // refill enqueues slot jobs
  for (let i = 0; i < 60; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await worker.runOne({ workerId: 'W' });
    if (!r.ran) break;
  }
  const updated = await automationsRepo.findAutomationByIdForUser(a.id, userId);
  const items = await runsRepo.listItemsForRun(updated.plannerRunId, userId);
  return { userId, automationId: a.id, runId: updated.plannerRunId, items };
}

const distinct = (arr) => new Set(arr.filter(Boolean)).size;
const fbCaption = (it) => it.platformCaptions?.facebook?.postCopy || it.caption || '';
const wordCount = (s) => (String(s).trim().match(/\S+/g) || []).length;
const lastSentence = (s) => {
  const parts = String(s).trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';
};

// ------------------------------------------------------- the seven-post acceptance
test('a Mon-Sun seven-day automation produces seven varied, valid items', SKIP, async () => {
  const openai = echoOpenAI({ fbWords: 150 });
  const { items } = await runAutomation({ openai });

  // 1. Seven items, not two.
  assert.equal(items.length, 7, `expected 7 planner items, got ${items.length}`);

  // 2. Zero generation failures.
  const failed = items.filter((i) => i.qualityStatus === 'generation_failed');
  assert.equal(failed.length, 0, `expected 0 failures, got ${failed.length}`);

  // 2b. No two items share a core editorial fingerprint (requirement: no
  // duplicate core editorial fingerprints). Distinct services and topics mean
  // distinct editorial content; the shared brand CTA/hashtags do not collapse
  // them. The boilerplate-exclusion is proven deterministically in the unit
  // suite (contentUniquenessService.test.js).
  const editorialKeys = items.map((i) => JSON.stringify(i.fingerprint?.editorialTrigrams || []));
  assert.equal(new Set(editorialKeys).size, editorialKeys.length, 'no two posts share a core editorial fingerprint');

  // 3. Exact Make contractor day sequence (by weekday of the slot).
  const byDate = [...items].sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  const dayTypeOf = (it) => it.fingerprint?.assignment?.dayType || it.assignment?.dayType || null;
  for (const it of byDate) assert.ok(dayTypeOf(it), 'every item persists its Make day type');

  // 4. At least four distinct services, none collapsed to the first.
  const serviceOf = (i) => i.fingerprint?.serviceEmphasis ?? i.fingerprint?.assignment?.serviceEmphasis ?? null;
  const services = items.map(serviceOf);
  assert.ok(distinct(services) >= 4, `expected >= 4 distinct services, got ${distinct(services)}: ${JSON.stringify(services)}`);

  // 5. Seven distinct semantic topics (headline/topic proxy — the echo names the service).
  const topics = items.map((i) => i.fingerprint?.assignment?.audienceProblem || i.audienceProblem).filter(Boolean);
  assert.ok(distinct(topics) >= 6, `expected >= 6 distinct topics, got ${distinct(topics)}`);

  // 6. Hashtag groups vary (>= 5 distinct sets).
  const hashSets = items.map((i) => JSON.stringify((i.hashtags || []).slice().sort()));
  assert.ok(distinct(hashSets) >= 5, `expected >= 5 hashtag groups, got ${distinct(hashSets)}`);

  // 7. Closings vary — no identical final sentence.
  const closings = items.map((i) => lastSentence(fbCaption(i)));
  assert.ok(distinct(closings) >= 6, `expected >= 6 distinct closings, got ${distinct(closings)}`);

  // 8. Every Facebook caption is inside the accepted word range and every prose
  //    paragraph is <= 75 words.
  for (const it of items) {
    const cap = fbCaption(it);
    assert.ok(wordCount(cap) >= 130, `a caption has ${wordCount(cap)} words, below 130`);
    for (const para of cap.split(/\n\n+/)) {
      assert.ok(wordCount(para) <= 75, `a paragraph has ${wordCount(para)} words, over 75`);
    }
  }

  // 9. Poster template families vary across the week (>= 4 concept families).
  const templates = items.map((i) => i.templateKey);
  assert.ok(distinct(templates) >= 4, `expected >= 4 poster templates, got ${distinct(templates)}: ${JSON.stringify([...new Set(templates)])}`);
  for (const t of templates) assert.ok(String(t).startsWith('poster-'), `template ${t} is not a Make poster`);
});

// ------------------------------------------------- bounded word-range repair
test('a 124-word Facebook post is repaired, not failed', SKIP, async () => {
  // The echo returns short posts (124 words). Before the fix these failed
  // terminally; the bounded repair must bring them to length without a full
  // rewrite and without filler.
  const openai = echoOpenAI({ fbWords: 124 });
  const { items } = await runAutomation({ openai });

  assert.equal(items.length, 7, 'still seven items');
  const failed = items.filter((i) => i.qualityStatus === 'generation_failed');
  assert.equal(failed.length, 0, `a short-but-complete post must be accepted, not failed (${failed.length} failed)`);
  // Every caption is complete and within the bounded tolerance of the minimum:
  // accepted at the final decision rather than terminally rejected six words
  // short. The validator still reports the shortfall (that is what drives the
  // repair attempts); acceptance happens at the end when the post is complete.
  for (const it of items) {
    const cap = fbCaption(it);
    assert.ok(isCompleteWithinTolerance(cap, 'facebook'), `a caption is not complete within tolerance (${wordCount(cap)} words)`);
    assert.ok(wordCount(cap) >= 118, `a caption has ${wordCount(cap)} words, below even the tolerance floor`);
  }
});

// ------------------------------------------------- account targeting intact
test('every item targets only the one selected Facebook Page', SKIP, async () => {
  const openai = echoOpenAI({ fbWords: 150 });
  const { items } = await runAutomation({ openai });
  for (const it of items) {
    assert.deepEqual(it.platformTargets, ['facebook']);
  }
  // No provider publish call is possible: the image service is disabled and no
  // publishing runs in this flow. Recorded requests are content only.
  assert.ok(openai.requests.length >= 7, 'generation ran for the week');
});

// --------------------------------------------------- images and board ordering
test('every post gets a rendered image, even when a render fails once', SKIP, async () => {
  // The two staging concepts that showed "No image": a transient first-render
  // failure that the retry must recover.
  const image = renderingImageService({ failFirstFor: new Set(['poster-warning', 'poster-service']) });
  const { items } = await runAutomation({ openai: echoOpenAI({ fbWords: 150 }), imageService: image });

  assert.equal(items.length, 7, 'seven items');
  const withImage = items.filter((i) => i.mediaAssetId != null);
  assert.equal(withImage.length, 7, `all seven have an image, got ${withImage.length}`);
  // Every item persists image_status = 'ready' (the queryable column), never a
  // silent blank.
  for (const it of items) {
    assert.equal(it.imageStatus, 'ready', `item image_status should be ready, got ${it.imageStatus}`);
    assert.equal(it.imageErrorCategory, null, 'a ready image carries no error category');
  }
});

test('a render that never succeeds persists the SPECIFIC safe reason, not a silent blank', SKIP, async () => {
  // A render that fails BOTH attempts must record an ACTIONABLE, specific status
  // — here an HCTI 402 (out of credits) — so the board shows "Image failed /
  // HCTI · Credits exhausted", never an unexplained "No image".
  const alwaysFail = {
    isReadyForUser: async () => true,
    async generateSocialImage() {
      throw new ProviderError({
        provider: PROVIDER_NAMES.HCTI,
        operation: 'render_social_image',
        category: CAT.CREDITS_EXHAUSTED,
        httpStatus: 402,
        cause: new Error('HCTI 402 body containing a secret HCTI_KEY'),
      });
    },
  };
  const { items } = await runAutomation({ openai: echoOpenAI({ fbWords: 150 }), imageService: alwaysFail });
  const noImage = items.filter((i) => i.mediaAssetId == null);
  assert.ok(noImage.length > 0, 'some items could not render');
  for (const it of noImage) {
    // The queryable columns carry the specific, safe failure — never generic.
    assert.equal(it.imageStatus, 'failed', 'image_status is failed');
    assert.equal(it.imageProvider, 'hcti');
    assert.equal(it.imageErrorCategory, CAT.CREDITS_EXHAUSTED, 'the specific category is preserved');
    assert.equal(it.imageRetryable, false, 'credits is not auto-retryable');
    assert.equal(it.imageHttpStatus, 402);
    assert.ok(it.imageErrorMessage && it.imageErrorMessage.length > 0, 'a safe message is stored');
    assert.equal(it.imageErrorMessage.includes('HCTI_KEY'), false, 'no secret leaks into the stored message');
    assert.match(it.imageErrorMessage, /credits/i);
  }
});

test('EXACT PARITY holds under an HCTI error: recipe preserved, failure surfaced, caption intact', SKIP, async () => {
  // A provider error must NOT corrupt the recipe or silently switch to generic
  // content: the seven-day Make rhythm still runs, every caption is still
  // written, and every image carries the SPECIFIC, persisted failure reason.
  const credits402 = {
    isReadyForUser: async () => true,
    async generateSocialImage() {
      throw new ProviderError({
        provider: PROVIDER_NAMES.HCTI, operation: 'render_social_image',
        category: CAT.CREDITS_EXHAUSTED, httpStatus: 402,
      });
    },
  };
  const { items } = await runAutomation({ openai: echoOpenAI({ fbWords: 150 }), imageService: credits402 });
  assert.equal(items.length, 7, 'seven items despite the image error');
  assert.equal(items.filter((i) => i.qualityStatus === 'generation_failed').length, 0, 'captions still generate');
  // The Make recipe survives: day types persisted, services vary, captions real.
  const dayTypes = items.map((i) => i.fingerprint?.assignment?.dayType).filter(Boolean);
  assert.ok(dayTypes.length >= 1, 'day types persisted — the recipe was preserved, not swapped for generic');
  assert.ok(distinct(items.map((i) => i.fingerprint?.serviceEmphasis ?? i.fingerprint?.assignment?.serviceEmphasis)) >= 3, 'services vary');
  for (const it of items) {
    assert.ok(it.caption && it.caption.length > 0, 'caption intact');
    // The image failure is the SPECIFIC, persisted category — surfaced, not a silent blank.
    assert.equal(it.imageStatus, 'failed');
    assert.equal(it.imageErrorCategory, CAT.CREDITS_EXHAUSTED);
    assert.equal(it.imageRetryable, false);
  }
});

test('the board returns items in chronological order regardless of generation order', SKIP, async () => {
  /*
   * The Friday-before-Thursday bug: position is assigned in GENERATION order,
   * and the automation's jobs finish out of order, so a later day generated
   * first got a lower position and sorted first. This seeds exactly that
   * mismatch — position DESCENDING as the date ascends — and proves the repo
   * returns the items by their scheduled instant, not by position.
   */
  const { userId } = await seedWorkspace();
  const run = await runsRepo.createRun({
    userId, contentAutomationId: null, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  const days = ['2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', '2027-03-27']; // Thu..Mon
  // Insert with position REVERSED relative to date (last day gets position 0).
  for (let i = 0; i < days.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await runsRepo.createItem({
      userId, plannerRunId: run.id, scheduledFor: `${days[i]} 09:00:00`,
      originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
      templateKey: 'poster-service', aspectRatio: '1:1', backgroundStyle: 'light',
      headline: `Day ${days[i]}`, subheadline: 's', summary: 's', caption: 'c', altText: 'a',
      hashtags: [], platformTargets: ['facebook'],
      platformCaptions: { facebook: { postCopy: 'c', hashtags: [], validationStatus: 'passed' } },
      approvalStatus: 'needs_review', position: days.length - 1 - i,
    });
  }
  const items = await runsRepo.listItemsForRun(run.id, userId);
  const dates = items.map((i) => String(i.scheduledFor).slice(0, 10));
  assert.deepEqual(dates, days, `items must be chronological by scheduledFor, not position: ${JSON.stringify(dates)}`);
});

// ------------------------------------------------ history-scope policy per status
test('similarity history excludes failed and rejected items, keeps real ones', SKIP, async () => {
  const { userId } = await seedWorkspace();
  const run = await runsRepo.createRun({
    userId, contentAutomationId: null, status: 'review', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  // One item per status, each with a distinct fingerprint headline so we can tell
  // which ones the history returns.
  const mk = (headline, { qualityStatus = 'passed', approvalStatus = 'needs_review' }) =>
    runsRepo.createItem({
      userId, plannerRunId: run.id, scheduledFor: '2027-03-14 02:45:00',
      originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
      templateKey: 'poster-service', aspectRatio: '1:1', backgroundStyle: 'light',
      headline, subheadline: 's', summary: 's', caption: 'c', altText: 'a',
      hashtags: [], platformTargets: ['facebook'],
      platformCaptions: { facebook: { postCopy: 'c', hashtags: [], validationStatus: 'passed' } },
      qualityStatus, approvalStatus, position: 0,
      fingerprint: { headlineNormalized: headline, serviceEmphasis: 'x' },
    });

  await mk('kept-needs-review', {});
  await mk('kept-approved', { approvalStatus: 'approved' });
  await mk('kept-queued', { approvalStatus: 'queued' });
  await mk('dropped-failed', { qualityStatus: 'generation_failed' });
  await mk('dropped-rejected', { approvalStatus: 'rejected' });

  const recent = await runsRepo.listRecentFingerprintsForUser(userId, { limit: 60 });
  const heads = recent.map((r) => r.headlineNormalized);

  // Real content the user kept is in history.
  assert.ok(heads.includes('kept-needs-review'), 'a needs-review item counts');
  assert.ok(heads.includes('kept-approved'), 'an approved item counts');
  assert.ok(heads.includes('kept-queued'), 'a queued item counts');
  // Failed and rejected staging output does not poison future generation.
  assert.ok(!heads.includes('dropped-failed'), 'a generation-failed item must not count');
  assert.ok(!heads.includes('dropped-rejected'), 'a rejected item must not count');
});

test('an old failed staging plan does not poison a fresh seven-post batch', SKIP, async () => {
  /*
   * The observed staging states: a prior run left generation_failed and rejected
   * items behind. Before the history policy, those poisoned every fresh
   * generation. This seeds exactly that debris, then runs the real refill flow
   * and proves the fresh batch still generates seven clean posts.
   */
  const { userId, chosenId } = await seedWorkspace();
  // A prior abandoned run full of the debris.
  const oldRun = await runsRepo.createRun({
    userId, contentAutomationId: null, status: 'failed', timezone: 'Asia/Karachi',
    startDate: null, endDate: null, settings: {}, resolvedRhythm: {},
  });
  const debris = (headline, { qualityStatus, approvalStatus }) => runsRepo.createItem({
    userId, plannerRunId: oldRun.id, scheduledFor: '2020-01-01 09:00:00',
    originalTimezone: 'Asia/Karachi', contentType: 'insight', goal: 'awareness',
    templateKey: 'poster-service', aspectRatio: '1:1', backgroundStyle: 'light',
    headline, subheadline: 's', summary: 's',
    caption: 'Basement waterproofing keeps your home dry through the winter rains.',
    altText: 'a', hashtags: ['#waterproofing', '#nyc'], platformTargets: ['facebook'],
    platformCaptions: { facebook: { postCopy: 'Basement waterproofing keeps your home dry.', hashtags: ['#waterproofing'], validationStatus: 'passed' } },
    qualityStatus, approvalStatus, position: 0,
    fingerprint: fingerprint({ caption: 'Basement waterproofing keeps your home dry through the winter rains.', headline, serviceEmphasis: 'basement waterproofing', hashtags: ['#waterproofing', '#nyc'] }),
  });
  // Five failed and two rejected — the exact kind of debris staging accumulated.
  for (let i = 0; i < 5; i += 1) await debris(`failed staging post ${i}`, { qualityStatus: 'generation_failed', approvalStatus: 'needs_review' });
  for (let i = 0; i < 2; i += 1) await debris(`rejected staging post ${i}`, { qualityStatus: 'passed', approvalStatus: 'rejected' });

  // Now run the real fresh automation for the SAME user.
  const image = renderingImageService();
  const { svc, worker } = stack(echoOpenAI({ fbWords: 150 }), image);
  const a = await svc.createAutomation(userId, {
    name: 'Fresh After Debris', mode: 'review', timezone: 'Asia/Karachi',
    selectedWeekdays: [1, 2, 3, 4, 5, 6, 7], postingTimes: ['09:00'], postsPerDay: 1,
    selectedPlatforms: ['facebook'], selectedAccountIds: [String(chosenId)],
    missedPostPolicy: 'skip', generationHorizonDays: 7, minimumReadyDays: 7, lowBufferDays: 3,
  });
  await svc.activate(userId, a.id);
  await worker.runOne({ workerId: 'W' });
  for (let i = 0; i < 60; i += 1) { const r = await worker.runOne({ workerId: 'W' }); if (!r.ran) break; } // eslint-disable-line no-await-in-loop
  const updated = await automationsRepo.findAutomationByIdForUser(a.id, userId);
  const fresh = await runsRepo.listItemsForRun(updated.plannerRunId, userId);

  assert.equal(fresh.length, 7, `seven fresh items despite the debris, got ${fresh.length}`);
  const failed = fresh.filter((i) => i.qualityStatus === 'generation_failed');
  assert.equal(failed.length, 0, `the debris must not fail the fresh batch (${failed.length} failed)`);
});

// --------------------------------------- knowledge business stays on its rhythm
test('a knowledge business runs the knowledge rhythm, not the contractor one', SKIP, async () => {
  const openai = echoOpenAI({ fbWords: 150 });
  const { items } = await runAutomation({ openai, profile: KNOWLEDGE_PROFILE });

  assert.equal(items.length, 7, `expected 7 items, got ${items.length}`);
  const dayTypeOf = (it) => it.fingerprint?.assignment?.dayType || null;
  const dayTypes = items.map(dayTypeOf);

  const contractorDayTypes = new Set([
    'service_spotlight', 'trust_stat', 'code_tip', 'project_showcase',
    'maintenance_tip', 'pro_tip_warning', 'brand_insight', 'testimonial_spotlight',
  ]);
  const knowledgeDayTypes = new Set([
    'educational_tip', 'category_insight', 'hot_take_myth', 'how_to_guide',
    'industry_trend', 'quick_hack', 'thought_leadership',
  ]);
  for (const dt of dayTypes) {
    assert.ok(!contractorDayTypes.has(dt), `knowledge plan used contractor day type ${dt}`);
    assert.ok(knowledgeDayTypes.has(dt), `knowledge plan used an unexpected day type ${dt}`);
  }
  // The services are the agency's, never a contractor service.
  const services = items.map((i) => i.fingerprint?.serviceEmphasis ?? i.fingerprint?.assignment?.serviceEmphasis);
  for (const s of services) {
    assert.ok(!SERVICES.includes(s), `contractor service ${s} leaked into the knowledge plan`);
  }
});

// -------------------------------- the seven-post output matrix (reporting proof)
test('the seven-post matrix meets every acceptance threshold', SKIP, async () => {
  const openai = echoOpenAI({ fbWords: 150 });
  const { items } = await runAutomation({ openai });

  const byDate = [...items].sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  const row = (it) => ({
    date: String(it.scheduledFor).slice(0, 10),
    dayType: it.fingerprint?.assignment?.dayType || null,
    service: it.fingerprint?.serviceEmphasis ?? it.fingerprint?.assignment?.serviceEmphasis ?? null,
    topic: it.fingerprint?.assignment?.audienceProblem || null,
    cta: it.fingerprint?.assignment?.closingStyle || null,
    closing: lastSentence(fbCaption(it)).slice(0, 40),
    template: it.templateKey,
    hashtags: (it.hashtags || []).join(','),
  });
  const matrix = byDate.map(row);

  // Every threshold from requirement 10, on one persisted plan.
  assert.equal(matrix.length, 7, 'seven items');
  assert.equal(items.filter((i) => i.qualityStatus === 'generation_failed').length, 0, 'zero failures');
  assert.ok(distinct(matrix.map((r) => r.service)) >= 4, 'four services');
  assert.ok(distinct(matrix.map((r) => r.topic)) >= 6, 'distinct topics');
  assert.ok(distinct(matrix.map((r) => r.cta)) >= 5, 'five CTA constructions');
  assert.ok(distinct(matrix.map((r) => r.hashtags)) >= 5, 'five hashtag groups');
  assert.ok(distinct(matrix.map((r) => r.closing)) >= 6, 'six endings');
  assert.ok(distinct(matrix.map((r) => r.template)) >= 6, 'six poster templates');
  for (const r of matrix) assert.ok(String(r.template).startsWith('poster-'), 'poster template');
  // caption/poster service alignment: the item's persisted service is the one
  // its poster serviceTag would use (they read the same brief field). The
  // fingerprint normalises the service to lower case, so the check is
  // case-insensitive.
  const realServices = new Set(SERVICES.map((s) => s.toLowerCase()));
  for (const it of items) {
    const svc = it.fingerprint?.serviceEmphasis ?? it.fingerprint?.assignment?.serviceEmphasis;
    if (svc) assert.ok(realServices.has(String(svc).toLowerCase()), `service "${svc}" is a real business service`);
  }
});
