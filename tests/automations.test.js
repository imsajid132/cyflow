import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAutomationService } from '../src/services/automationService.js';
import { createDurableJobService } from '../src/services/durableJobService.js';
import { createPlannerService } from '../src/services/plannerService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';
import { ValidationError, NotFoundError, ConflictError } from '../src/utils/errors.js';
import {
  createFakeSocialAccountRepository, createFakePostRepository, createFakeMediaAssetRepository,
  createFakeApiUsageRepository, createFakeBusinessProfileRepository, createFakePlannerPreferenceRepository,
  createFakePlannerRunRepository, createFakePlannerRevisionRepository, createFakePlannerOpenAI,
  createFakeSocialImageService, createFakeAutomationRepository, createFakeBackgroundJobRepository,
  fakeWithTransaction,
} from './helpers/fakes.js';

const noop = { record: async () => {} };
const USER = '5';
const OTHER = '9';
const NOW = new Date('2026-07-20T06:00:00Z'); // a Monday

async function build({ openaiAvailable = true } = {}) {
  const social = createFakeSocialAccountRepository();
  const runs = createFakePlannerRunRepository();
  const media = createFakeMediaAssetRepository();
  const business = createFakeBusinessProfileRepository();
  const openai = createFakePlannerOpenAI({ validate: true, isAvailableForUser: () => openaiAvailable });
  const images = { ...createFakeSocialImageService(), isReadyForUser: async () => false };
  const planner = createPlannerService({
    preferences: createFakePlannerPreferenceRepository(),
    runs,
    revisions: createFakePlannerRevisionRepository(),
    businessProfiles: business,
    socialAccounts: social,
    posts: createFakePostRepository({ socialAccounts: social }),
    mediaRepository: media,
    apiUsage: createFakeApiUsageRepository(),
    openaiContentService: openai,
    socialImageService: images,
    mediaAssetService: createMediaAssetService({ mediaRepository: media }),
    uniqueness: contentUniquenessService,
    logging: noop,
    withTransaction: fakeWithTransaction,
    now: () => NOW,
  });
  const automations = createFakeAutomationRepository();
  const jobs = createFakeBackgroundJobRepository();
  const svc = createAutomationService({
    automations, jobs, runsRepo: runs, socialAccounts: social, planner, openai, images,
    logging: noop, config: { worker: { maxAttempts: 3, refillIntervalHours: 6 } }, now: () => NOW,
  });
  const jobSvc = createDurableJobService({ jobs, handlers: svc.handlers, now: () => NOW, options: { heartbeatMs: 0 } });
  return { svc, jobSvc, automations, jobs, runs, social, openai, business };
}

async function seedAccounts(social, userId = USER) {
  await social.upsertSocialAccount({ userId, provider: 'meta', accountType: 'facebook_page', providerAccountId: 'fb1', displayName: 'FB', username: 'fb', encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active' });
  await social.upsertSocialAccount({ userId, provider: 'instagram', accountType: 'instagram_professional', providerAccountId: 'ig1', displayName: 'IG', username: 'ig', encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active' });
  await social.upsertSocialAccount({ userId, provider: 'threads', accountType: 'threads_profile', providerAccountId: 'th1', displayName: 'TH', username: 'th', encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active' });
  const all = await social.listAccountsForUser(userId);
  return {
    fb: all.find((a) => a.accountType === 'facebook_page').id,
    ig: all.find((a) => a.accountType === 'instagram_professional').id,
    th: all.find((a) => a.accountType === 'threads_profile').id,
  };
}

const cfg = (ids, over = {}) => ({
  name: 'Weekly', mode: 'review', timezone: 'Asia/Karachi',
  selectedWeekdays: [1, 2, 3, 4, 5], postingTimes: ['09:00'], postsPerDay: 1,
  selectedPlatforms: ['instagram', 'threads'], selectedAccountIds: [ids.ig, ids.th],
  missedPostPolicy: 'skip', generationHorizonDays: 14, minimumReadyDays: 7, lowBufferDays: 3,
  ...over,
});

test('creating an automation with a Facebook account it did not select is rejected', async () => {
  const { svc, social } = await build();
  const ids = await seedAccounts(social);
  await assert.rejects(
    () => svc.createAutomation(USER, cfg(ids, { selectedAccountIds: [ids.ig, ids.th, ids.fb] })),
    (e) => e instanceof ValidationError,
  );
});

test('every selected platform must have a selected account', async () => {
  const { svc, social } = await build();
  const ids = await seedAccounts(social);
  await assert.rejects(
    () => svc.createAutomation(USER, cfg(ids, { selectedPlatforms: ['instagram', 'threads'], selectedAccountIds: [ids.ig] })),
    (e) => e instanceof ValidationError,
  );
});

test('an indefinite automation activates, refills, and prepares content for the selected platforms only', async () => {
  const { svc, jobSvc, automations, runs, social } = await build();
  const ids = await seedAccounts(social);
  const a = await svc.createAutomation(USER, cfg(ids));
  assert.equal(a.status, 'draft');
  assert.equal(a.endDate, null, 'no end date = runs indefinitely');

  await svc.activate(USER, a.id);
  // Drain the queue: the refill job enqueues slot jobs, which generate items.
  await jobSvc.drain({ workerId: 'W', max: 200 });

  const updated = await automations.findAutomationByIdForUser(a.id, USER);
  assert.ok(updated.plannerRunId, 'a backing run was created');
  const plan = await runs.listItemsForRun(updated.plannerRunId, USER);
  assert.ok(plan.length >= 5, `prepared multiple items (${plan.length})`);
  for (const item of plan) {
    assert.deepEqual([...item.platformTargets].sort(), ['instagram', 'threads']);
    assert.ok(!item.platformTargets.includes('facebook'), 'no Facebook target');
  }
});

test('repeated refills create no duplicate slots, jobs, or items (idempotent)', async () => {
  const { svc, jobSvc, automations, runs, social, jobs } = await build();
  const ids = await seedAccounts(social);
  const a = await svc.createAutomation(USER, cfg(ids));
  await svc.activate(USER, a.id);
  await jobSvc.drain({ workerId: 'W', max: 200 });
  const updated = await automations.findAutomationByIdForUser(a.id, USER);
  const firstItems = (await runs.listItemsForRun(updated.plannerRunId, USER)).length;
  const firstSlots = automations._slots.length;

  // A second refill in the same minute + another drain must add nothing.
  await svc.refillNow(USER, a.id);
  await jobSvc.drain({ workerId: 'W', max: 200 });
  assert.equal(automations._slots.length, firstSlots, 'no duplicate slots');
  assert.equal((await runs.listItemsForRun(updated.plannerRunId, USER)).length, firstItems, 'no duplicate items');
});

test('paused automation generates nothing and consumes zero provider usage', async () => {
  const { svc, jobSvc, social, openai } = await build();
  const ids = await seedAccounts(social);
  const a = await svc.createAutomation(USER, cfg(ids));
  await svc.activate(USER, a.id);
  await svc.pause(USER, a.id);
  const before = openai._calls?.length ?? 0;
  await jobSvc.drain({ workerId: 'W', max: 200 }); // any leftover slot jobs are no-ops now
  assert.equal(openai._calls?.length ?? 0, before, 'no OpenAI calls while paused');
  const paused = await svc.getAutomation(USER, a.id);
  assert.equal(paused.status, 'paused');
});

test('missing OpenAI credentials is a permanent failure that sets attention_needed', async () => {
  const { svc, jobSvc, automations, social } = await build({ openaiAvailable: false });
  const ids = await seedAccounts(social);
  const a = await svc.createAutomation(USER, cfg(ids));
  await svc.activate(USER, a.id);
  await jobSvc.drain({ workerId: 'W', max: 200 });
  const after = await automations.findAutomationByIdForUser(a.id, USER);
  assert.equal(after.status, 'attention_needed');
  assert.match(after.attentionReason, /OpenAI/i);
  // The failed slot jobs are 'failed' (permanent), not endlessly retried.
  const failedJobs = automations._slots.filter((s) => s.status === 'failed');
  assert.ok(failedJobs.length >= 1);
});

test('stop cancels future preparation and pending jobs, preserving history', async () => {
  const { svc, jobSvc, automations, runs, social } = await build();
  const ids = await seedAccounts(social);
  const a = await svc.createAutomation(USER, cfg(ids));
  await svc.activate(USER, a.id);
  await jobSvc.drain({ workerId: 'W', max: 200 });
  const updated = await automations.findAutomationByIdForUser(a.id, USER);
  const itemsBefore = (await runs.listItemsForRun(updated.plannerRunId, USER)).length;

  const stopped = await svc.stop(USER, a.id);
  assert.equal(stopped.status, 'stopped');
  // Prepared history remains.
  assert.equal((await runs.listItemsForRun(updated.plannerRunId, USER)).length, itemsBefore);
  // A stopped automation cannot be resumed.
  await assert.rejects(() => svc.resume(USER, a.id), (e) => e instanceof ConflictError);
});

test('lifecycle transitions are validated (cannot pause a draft)', async () => {
  const { svc, social } = await build();
  const ids = await seedAccounts(social);
  const a = await svc.createAutomation(USER, cfg(ids));
  await assert.rejects(() => svc.pause(USER, a.id), (e) => e instanceof ConflictError);
});

test('ownership: one user cannot read, edit, or control another user’s automation', async () => {
  const { svc, social } = await build();
  const ids = await seedAccounts(social);
  const a = await svc.createAutomation(USER, cfg(ids));
  for (const op of [
    () => svc.getAutomation(OTHER, a.id),
    () => svc.updateFutureSettings(OTHER, a.id, cfg(ids)),
    () => svc.activate(OTHER, a.id),
    () => svc.pause(OTHER, a.id),
    () => svc.stop(OTHER, a.id),
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(op, (e) => e instanceof NotFoundError);
  }
});

test('editing future settings does not rewrite already-prepared items', async () => {
  const { svc, jobSvc, automations, runs, social } = await build();
  const ids = await seedAccounts(social);
  const a = await svc.createAutomation(USER, cfg(ids));
  await svc.activate(USER, a.id);
  await jobSvc.drain({ workerId: 'W', max: 200 });
  const updated = await automations.findAutomationByIdForUser(a.id, USER);
  const before = await runs.listItemsForRun(updated.plannerRunId, USER);
  const captionsBefore = before.map((i) => i.caption);

  // Change platforms for FUTURE content.
  await svc.updateFutureSettings(USER, a.id, cfg(ids, { selectedPlatforms: ['instagram'], selectedAccountIds: [ids.ig] }));
  const after = await runs.listItemsForRun(updated.plannerRunId, USER);
  assert.deepEqual(after.map((i) => i.caption), captionsBefore, 'existing items untouched');
  for (const item of before) {
    assert.ok(item.platformTargets.includes('threads'), 'already-prepared items keep their Threads target');
  }
});
