import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAutomationService } from '../src/services/automationService.js';
import { createDurableJobService } from '../src/services/durableJobService.js';
import { createPlannerService } from '../src/services/plannerService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';
import {
  createFakeSocialAccountRepository, createFakePostRepository, createFakeMediaAssetRepository,
  createFakeApiUsageRepository, createFakeBusinessProfileRepository, createFakePlannerPreferenceRepository,
  createFakePlannerRunRepository, createFakePlannerRevisionRepository, createFakePlannerOpenAI,
  createFakeSocialImageService, createFakeAutomationRepository, createFakeBackgroundJobRepository,
  fakeWithTransaction,
} from './helpers/fakes.js';

const noop = { record: async () => {} };
const USER = '5';
const NOW = new Date('2026-07-20T06:00:00Z');

function stack() {
  const social = createFakeSocialAccountRepository();
  const runs = createFakePlannerRunRepository();
  const media = createFakeMediaAssetRepository();
  const openai = createFakePlannerOpenAI({ validate: true, isAvailableForUser: () => true });
  const planner = createPlannerService({
    preferences: createFakePlannerPreferenceRepository(), runs,
    revisions: createFakePlannerRevisionRepository(), businessProfiles: createFakeBusinessProfileRepository(),
    socialAccounts: social, posts: createFakePostRepository({ socialAccounts: social }), mediaRepository: media,
    apiUsage: createFakeApiUsageRepository(), openaiContentService: openai,
    socialImageService: { ...createFakeSocialImageService(), isReadyForUser: async () => false },
    mediaAssetService: createMediaAssetService({ mediaRepository: media }), uniqueness: contentUniquenessService,
    logging: noop, withTransaction: fakeWithTransaction, now: () => NOW,
  });
  const automations = createFakeAutomationRepository();
  const jobs = createFakeBackgroundJobRepository();
  const svc = createAutomationService({
    automations, jobs, runsRepo: runs, socialAccounts: social, planner, openai,
    images: { isReadyForUser: async () => false }, logging: noop,
    config: { worker: { maxAttempts: 3, refillIntervalHours: 6 } }, now: () => NOW,
  });
  const worker = (nowFn = () => NOW) => createDurableJobService({ jobs, handlers: svc.handlers, now: nowFn, options: { heartbeatMs: 0, leaseMs: 60000 } });
  return { svc, worker, automations, jobs, runs, social };
}

async function seed(social) {
  await social.upsertSocialAccount({ userId: USER, provider: 'instagram', accountType: 'instagram_professional', providerAccountId: 'ig1', displayName: 'IG', username: 'ig', encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active' });
  await social.upsertSocialAccount({ userId: USER, provider: 'threads', accountType: 'threads_profile', providerAccountId: 'th1', displayName: 'TH', username: 'th', encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active' });
  const all = await social.listAccountsForUser(USER);
  return { ig: all.find((a) => a.accountType === 'instagram_professional').id, th: all.find((a) => a.accountType === 'threads_profile').id };
}

const config = (ids) => ({
  name: 'A', mode: 'review', timezone: 'Asia/Karachi', selectedWeekdays: [1, 2, 3, 4, 5],
  postingTimes: ['09:00'], postsPerDay: 1, selectedPlatforms: ['instagram', 'threads'],
  selectedAccountIds: [ids.ig, ids.th], missedPostPolicy: 'skip', generationHorizonDays: 10,
  minimumReadyDays: 5, lowBufferDays: 2,
});

test('two workers draining the same queue prepare exactly one item per slot', async () => {
  const s = stack();
  const ids = await seed(s.social);
  const a = await s.svc.createAutomation(USER, config(ids));
  await s.svc.activate(USER, a.id);

  const A = s.worker();
  const B = s.worker();
  await A.runOne({ workerId: 'A' }); // the refill job enqueues slot jobs
  for (let i = 0; i < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const [ra, rb] = await Promise.all([A.runOne({ workerId: 'A' }), B.runOne({ workerId: 'B' })]);
    if (!ra.ran && !rb.ran) break;
  }

  const updated = await s.automations.findAutomationByIdForUser(a.id, USER);
  const items = await s.runs.listItemsForRun(updated.plannerRunId, USER);
  const readySlots = s.automations._slots.filter((sl) => sl.status === 'ready');
  assert.ok(items.length >= 5, `prepared the buffer (${items.length})`);
  assert.equal(items.length, readySlots.length, 'one item per ready slot — no double execution');
  const itemIds = readySlots.map((sl) => sl.plannerRunItemId);
  assert.equal(new Set(itemIds).size, itemIds.length, 'no slot shares an item with another');
});

test('a worker crash mid-generation is recovered and produces no duplicate item', async () => {
  const s = stack();
  const ids = await seed(s.social);
  const a = await s.svc.createAutomation(USER, config(ids));
  await s.svc.activate(USER, a.id);
  await s.worker().runOne({ workerId: 'W' }); // refill -> enqueue slot jobs

  // 'dead' claims one slot job, runs the handler, but the job is never completed.
  const claimed = await s.jobs.claimNextJob({ workerId: 'dead', leaseMs: 60000, now: NOW });
  assert.equal(claimed.jobType, 'generate_automation_slot');
  await s.svc.runSlotJob(claimed).catch(() => {});
  const updated = await s.automations.findAutomationByIdForUser(a.id, USER);

  // Lease expires; recovery reclaims; a fresh worker drains everything.
  const later = new Date(NOW.getTime() + 120000);
  const rec = s.worker(() => later);
  await rec.recoverStale({ limit: 50 });
  for (let i = 0; i < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await rec.runOne({ workerId: 'fresh' });
    if (!r.ran) break;
  }

  const finalItems = (await s.runs.listItemsForRun(updated.plannerRunId, USER)).length;
  const readySlots = s.automations._slots.filter((sl) => sl.status === 'ready');
  assert.equal(finalItems, readySlots.length, 'one item per ready slot after recovery — no duplicate');
  // The recovered job reused its original idempotency key (slot key == job key).
  const slotJobs = s.jobs._jobs.filter((j) => j.job_type === 'generate_automation_slot');
  const keys = slotJobs.map((j) => j.idempotency_key);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate slot job was created during recovery');
});
