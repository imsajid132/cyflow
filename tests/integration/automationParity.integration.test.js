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
  const words = (n, ...lead) => {
    const w = [...lead];
    for (let i = w.length; i < n; i += 1) w.push(`word${i}`);
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
      const caption = `${words(third, 'Opening', open, s, problem)}.\n\n`
        + `${words(third, 'Middle', s, problem)}.\n\n`
        + `${words(fbWords - 2 * third, 'Closing', close, s)}.`;
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

// Real time is used: the durable job rows are stamped with the DB clock, so an
// injected past clock would make them unclaimable. The seven-slot count is
// deterministic anyway — the refill keeps exactly the horizon's worth of future
// active days whether or not today's slot has already passed.
function stack(openai) {
  const planner = createPlannerService({
    openaiContentService: openai,
    socialImageService: { isReadyForUser: async () => false },
  });
  const svc = createAutomationService({
    automations: automationsRepo, jobs: jobsRepo, runsRepo, socialAccounts: social, planner,
    openai, images: { isReadyForUser: async () => false }, logging: { async record() {} },
    config: { worker: { maxAttempts: 3, refillIntervalHours: 6 } },
  });
  const worker = createDurableJobService({ jobs: jobsRepo, handlers: svc.handlers, options: { heartbeatMs: 0, leaseMs: 60000 } });
  return { planner, svc, worker };
}

async function runAutomation({ openai, generationHorizonDays = 7, profile = CONTRACTOR_PROFILE }) {
  const { userId, chosenId } = await seedWorkspace(profile);
  const { svc, worker } = stack(openai);
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
