// DEDICATED "2 of 7" reproduction on the REAL automation pipeline against MariaDB.
//
// The staging report: a Mon-Sun, one-a-day automation showed only TWO prepared
// posts where seven were expected. This test settles the exact cause by driving
// the real path end to end — automation request -> persistence -> activation ->
// refill (durable job) -> bounded Hostinger-style worker drains -> slot
// generation -> images -> the Weekly Board read model + the card diagnostics —
// and asserting the precise job / slot / item matrix at each step.
//
// It proves OUTCOME A: the refill creates SEVEN slots and SEVEN generate jobs; a
// bounded single-process drain (only two slot jobs run per tick) completes just
// two, leaving five PENDING; the card banner therefore reads "preparing" (worker
// still draining), NOT "shortfall". Draining the rest yields seven ready posts,
// zero failures, seven images. So "2 of 7" was worker lag, not a generation cap.
//
// Config (as reported): Mon-Sun, 1/day at 09:00, generate-ahead 7, Asia/Karachi,
// one selected Facebook Page, review mode, single-process bounded drain.
import { hasDatabase, resetDatabase, SKIP } from './helpers/db.js';
import '../helpers/setupEnv.js';

import test, { before, beforeEach, after } from 'node:test';   // eslint-disable-line import/first
import assert from 'node:assert/strict';                        // eslint-disable-line import/first

import { getPool, closePool } from '../../src/db/pool.js';                                // eslint-disable-line import/first
import * as users from '../../src/repositories/userRepository.js';                       // eslint-disable-line import/first
import * as social from '../../src/repositories/socialAccountRepository.js';             // eslint-disable-line import/first
import * as businessProfiles from '../../src/repositories/businessProfileRepository.js'; // eslint-disable-line import/first
import * as automationsRepo from '../../src/repositories/automationRepository.js';       // eslint-disable-line import/first
import * as runsRepo from '../../src/repositories/plannerRunRepository.js';              // eslint-disable-line import/first
import * as jobsRepo from '../../src/repositories/backgroundJobRepository.js';           // eslint-disable-line import/first
import { createPlannerService } from '../../src/services/plannerService.js';             // eslint-disable-line import/first
import { createAutomationService } from '../../src/services/automationService.js';       // eslint-disable-line import/first
import { createDurableJobService } from '../../src/services/durableJobService.js';       // eslint-disable-line import/first
import { JOB_TYPES } from '../../src/config/constants.js';                               // eslint-disable-line import/first

let pool;

const PAGES = [
  'NYC Waterproofing', 'Sidewalks Repair NYC', 'Pioneer Construction NYC',
  'NYC Concrete Contractor', 'Roofing Contractor NYC', 'Brick Pointing NYC', 'Brownstone Repair NYC',
];
const CONTRACTOR_PROFILE = {
  businessName: 'NYC Waterproofing', businessCategory: 'Waterproofing contractor',
  businessDescription: 'Basement and foundation waterproofing across NYC.',
  services: ['Basement Waterproofing', 'Foundation Waterproofing', 'French Drain Installation',
    'Sump Pump Installation', 'Basement Leak Inspection'],
  defaultCallToAction: 'Book a free inspection', primaryLocation: 'New York, NY',
  phone: '(917) 415-1383', website: 'nyc-waterproofing.com', brandColors: ['#0A3D62', '#F1C40F'],
};

before(() => { if (hasDatabase) pool = getPool(); });
after(async () => { if (hasDatabase) await closePool().catch(() => {}); });
beforeEach(async () => { if (hasDatabase) await resetDatabase(pool); });

// A fake OpenAI that returns a valid, on-length post whose editorial body is
// genuinely DISTINCT per slot (it embeds the assigned day type, opening, closing
// and a per-call unique token), so seven different assignments yield seven
// different fingerprints — exactly what a real model does. This keeps the test
// about the worker/job matrix, not about content variety (Section 6 covers that).
function echoOpenAI() {
  let n = 0;
  const tok = (str) => String(str || '').toLowerCase().replace(/[^a-z]+/g, '').slice(0, 8) || 'x';
  const words = (k, ...lead) => {
    const seed = lead.filter(Boolean).flatMap((t) => String(t).split(/\s+/)).filter(Boolean);
    if (!seed.length) seed.push('work');
    const w = []; let i = 0;
    while (w.length < k) { w.push(seed[i % seed.length]); i += 1; }
    return w.join(' ');
  };
  return {
    isAvailable: async () => true,
    isReadyForUser: async () => true,
    async generatePlannerPost(input) {
      n += 1;
      const s = input.serviceEmphasis || 'the service';
      const day = tok(input.dayType || input.assignment?.dayType);
      const open = tok(input.openingStyle || input.openingGuidance);
      const close = tok(input.closingStyle || input.closingGuidance);
      const problem = tok(input.audienceProblem);
      const uniq = `u${n}`;
      const cap = `${words(50, 'Opening', open, s, day, problem, uniq)}.\n\n`
        + `${words(50, 'Middle', s, day, problem, uniq)}.\n\n`
        + `${words(50, 'Closing', close, s, day, uniq)}.`;
      return {
        caption: cap, hashtags: [`#${String(s).replace(/\s+/g, '')}`, `#${day}`, '#nyc'],
        headline: `${s}: ${problem} ${n}`, subheadline: `About ${s} on a ${day} slot`,
        imageAltText: `Photo of ${s}`, summary: `internal ${n}`, badge: 'Tip', poster: {}, _style: { rejections: [] },
      };
    },
  };
}

// A stand-in HCTI that always renders, so a generated slot gets a real image.
function renderingImageService() {
  let r = 0;
  return {
    isReadyForUser: async () => true,
    async generateSocialImage() { r += 1; return { sourceUrl: 'https://example.test/i.png', imageId: `img-${r}` }; },
  };
}

function stack() {
  const openai = echoOpenAI();
  const images = renderingImageService();
  const planner = createPlannerService({ openaiContentService: openai, socialImageService: images });
  const svc = createAutomationService({
    automations: automationsRepo, jobs: jobsRepo, runsRepo, socialAccounts: social, planner,
    openai, images, logging: { async record() {} },
    config: { worker: { maxAttempts: 3, refillIntervalHours: 6 } },
  });
  const worker = createDurableJobService({ jobs: jobsRepo, handlers: svc.handlers, options: { heartbeatMs: 0, leaseMs: 60000 } });
  return { svc, worker };
}

async function seedWorkspace() {
  const u = await users.createUser({ name: 'Operator', email: 'op@example.test', passwordHash: 'x'.repeat(60), timezone: 'Asia/Karachi' });
  const userId = String(u.id);
  await businessProfiles.createOrUpdateProfile(userId, CONTRACTOR_PROFILE);
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

// --- direct read models (real SQL, so the counts are the database's, not a fake) ---
async function jobMatrix() {
  const [rows] = await pool.execute(
    `SELECT job_type, status, COUNT(*) n FROM background_jobs GROUP BY job_type, status`,
  );
  const m = {};
  for (const r of rows) { m[r.job_type] = m[r.job_type] || {}; m[r.job_type][r.status] = Number(r.n); }
  return m;
}
async function slotMatrix(automationId) {
  const [rows] = await pool.execute(
    `SELECT status, COUNT(*) n FROM automation_schedule_slots WHERE automation_id = ? GROUP BY status`, [automationId],
  );
  const m = {}; for (const r of rows) m[r.status] = Number(r.n); return m;
}
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

test('the "2 of 7" is a bounded-worker artifact: seven jobs created, two drained, five pending, banner says preparing', SKIP, async () => {
  const { userId, chosenId } = await seedWorkspace();
  const { svc, worker } = stack();

  // 1. The automation request, persisted and activated (the real service path).
  const a = await svc.createAutomation(userId, {
    name: 'NYC Waterproofing 2-of-7 repro', mode: 'review', timezone: 'Asia/Karachi',
    selectedWeekdays: [1, 2, 3, 4, 5, 6, 7], postingTimes: ['09:00'], postsPerDay: 1,
    selectedPlatforms: ['facebook'], selectedAccountIds: [String(chosenId)],
    missedPostPolicy: 'skip', generationHorizonDays: 7, minimumReadyDays: 7, lowBufferDays: 3,
  });
  await svc.activate(userId, a.id);

  // Persisted config carries the seven weekdays and the one selected account.
  const persisted = await automationsRepo.findAutomationByIdForUser(a.id, userId);
  assert.deepEqual(persisted.selectedWeekdays, [1, 2, 3, 4, 5, 6, 7], 'seven weekdays persisted');
  assert.deepEqual(persisted.selectedAccountIds.map(String), [String(chosenId)], 'exactly one selected Facebook Page');

  // 2. Refill runs as ONE durable job and enqueues the slot jobs (the real flow).
  const refill = await worker.runOne({ workerId: 'W' });
  assert.equal(refill.jobType, JOB_TYPES.AUTOMATION_REFILL, 'first job is the refill');
  assert.equal(refill.outcome, 'completed', 'the refill completes');

  const afterRefillJobs = await jobMatrix();
  const afterRefillSlots = await slotMatrix(a.id);
  const slotJobsCreated = sum(afterRefillJobs[JOB_TYPES.GENERATE_SLOT]);
  console.log('AFTER REFILL — jobs:', JSON.stringify(afterRefillJobs), 'slots:', JSON.stringify(afterRefillSlots));

  // THE CENTRAL FACT: seven slots and seven generate jobs exist. Not two.
  assert.equal(sum(afterRefillSlots), 7, `refill created seven slots, got ${sum(afterRefillSlots)}`);
  assert.equal(slotJobsCreated, 7, `refill enqueued seven GENERATE_SLOT jobs, got ${slotJobsCreated}`);

  // 3. Bounded Hostinger-style drain: only TWO slot jobs run this tick.
  let completed = 0;
  const drained = [];
  while (completed < 2) {
    // eslint-disable-next-line no-await-in-loop
    const r = await worker.runOne({ workerId: 'W', jobTypes: [JOB_TYPES.GENERATE_SLOT] });
    if (!r.ran) break;
    drained.push(r.outcome);
    if (r.outcome === 'completed') completed += 1;
  }
  assert.equal(completed, 2, 'the bounded drain completed exactly two slot jobs');

  // 4. The exact mid-flight matrix.
  const midJobs = await jobMatrix();
  const midSlots = await slotMatrix(a.id);
  const run = (await automationsRepo.findAutomationByIdForUser(a.id, userId)).plannerRunId;
  const midItems = await runsRepo.listItemsForRun(run, userId);
  const genDone = midJobs[JOB_TYPES.GENERATE_SLOT]?.completed ?? 0;
  const genPending = (midJobs[JOB_TYPES.GENERATE_SLOT]?.pending ?? 0) + (midJobs[JOB_TYPES.GENERATE_SLOT]?.available ?? 0);
  console.log('MID DRAIN — jobs:', JSON.stringify(midJobs), 'slots:', JSON.stringify(midSlots), 'items:', midItems.length);

  assert.equal(midSlots.ready ?? 0, 2, 'two slots are ready');
  assert.equal(midSlots.planned ?? 0, 5, 'five slots are still planned (pending)');
  assert.equal(genDone, 2, 'two generate jobs completed');
  assert.equal(midItems.length, 2, 'exactly two planner items exist so far');
  assert.equal(midItems.filter((i) => i.qualityStatus === 'generation_failed').length, 0, 'no generation failures');
  assert.equal(midItems.filter((i) => i.mediaAssetId != null).length, 2, 'both prepared items have a real image');

  // 5. The card banner distinguishes worker-draining from a real shortfall.
  const cardMid = await svc.getAutomation(userId, a.id);
  console.log('MID DRAIN — diagnostics:', JSON.stringify(cardMid.diagnostics));
  assert.equal(cardMid.diagnostics.expected, 7, 'expected is seven');
  assert.equal(cardMid.diagnostics.ready, 2, 'ready is two');
  assert.equal(cardMid.diagnostics.pending, 5, 'pending is five (the worker is still draining)');
  assert.equal(cardMid.diagnostics.failed, 0, 'no failures');
  assert.equal(cardMid.diagnostics.reason, 'preparing', 'banner reason is "preparing" (worker lag), NOT "shortfall"');

  // 6. Draining the rest reaches seven ready posts, zero failures, seven images.
  for (let i = 0; i < 60; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await worker.runOne({ workerId: 'W' });
    if (!r.ran) break;
  }
  const finalSlots = await slotMatrix(a.id);
  const finalItems = await runsRepo.listItemsForRun(run, userId);
  console.log('FINAL — slots:', JSON.stringify(finalSlots), 'items:', finalItems.length);
  assert.equal(finalSlots.ready ?? 0, 7, 'all seven slots are ready after full drain');
  assert.equal(finalItems.length, 7, 'seven planner items after full drain');
  assert.equal(finalItems.filter((i) => i.qualityStatus === 'generation_failed').length, 0, 'zero generation failures');
  assert.equal(finalItems.filter((i) => i.mediaAssetId != null).length, 7, 'seven images ready');

  // 7. The Weekly Board read model shows the seven posts.
  const plan = await createPlannerService({
    openaiContentService: { isReadyForUser: async () => true },
    socialImageService: { isReadyForUser: async () => true },
  }).getPlan(userId, run);
  assert.equal((plan.items || []).length, 7, 'the Weekly Board API returns seven items');

  // 8. And the card now reports "ok" (nothing left to prepare).
  const cardFinal = await svc.getAutomation(userId, a.id);
  console.log('FINAL — diagnostics:', JSON.stringify(cardFinal.diagnostics));
  assert.equal(cardFinal.diagnostics.reason, 'ok', 'banner clears to "ok" once the buffer is full');
  assert.equal(cardFinal.diagnostics.ready, 7, 'seven ready');
  assert.equal(cardFinal.diagnostics.pending, 0, 'nothing pending');
});
