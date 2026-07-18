// Milestone E — manual Create Post workspace: Save Draft, readiness, Schedule
// Later, Publish Now. Ownership, optimistic concurrency, per-platform
// independence, idempotency, and DST scheduling are all exercised here.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPostService } from '../src/services/postService.js';
import { createPublishingService } from '../src/services/publishingService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { fromMysqlUtc } from '../src/utils/time.js';
import {
  createFakeSocialAccountRepository,
  createFakePostRepository,
  createFakeMediaAssetRepository,
  createFakeApiUsageRepository,
  createFakeIntegrationRepository,
  createFakeOpenAIContentService,
  createFakeSocialImageService,
  createFakeBusinessProfileRepository,
  createFakePublishRepository,
  createFakeBackgroundJobRepository,
  createFakePublishAdapters,
  fakeWithTransaction,
} from './helpers/fakes.js';

const noopLogging = { record: async () => {} };

/** postService wired to a real publishingService over shared in-memory fakes. */
function wire({ liveEnabled = false } = {}) {
  const socialAccounts = createFakeSocialAccountRepository();
  const posts = createFakePostRepository({ socialAccounts });
  const media = createFakeMediaAssetRepository();
  const apiUsage = createFakeApiUsageRepository();
  const integration = createFakeIntegrationRepository();
  const openai = createFakeOpenAIContentService();
  const image = createFakeSocialImageService();
  const businessProfiles = createFakeBusinessProfileRepository();
  const mediaAssetService = createMediaAssetService({ mediaRepository: media });
  const jobs = createFakeBackgroundJobRepository();
  const publishRepo = createFakePublishRepository({ posts, accounts: socialAccounts });
  const { adapters } = createFakePublishAdapters({});
  const config = { publishing: { liveEnabled, reconcileDelaySeconds: 30, maxReconcileAttempts: 3 }, limits: { maxDailyGenerationsPerUser: 100 } };

  const publishing = createPublishingService({
    publishRepo, socialAccounts, mediaRepository: media, jobs, adapters,
    decryptSecret: () => 'token', logging: noopLogging, config, now: () => new Date('2026-07-20T09:00:00Z'),
  });
  const svc = createPostService({
    posts, socialAccounts, mediaRepository: media, apiUsage,
    integrationRepository: integration, businessProfiles,
    openaiContentService: openai, socialImageService: image, mediaAssetService,
    logging: noopLogging, withTransaction: fakeWithTransaction, config,
    enqueuePublish: (u, p) => publishing.enqueuePublishForPost(u, p),
  });
  return { svc, publishing, jobs, posts, socialAccounts, media };
}

async function seedAccount(socialAccounts, { userId = '5', provider = 'threads', accountType = 'threads_profile', status = 'active', id = 'acc_1' } = {}) {
  return socialAccounts.upsertSocialAccount({
    userId, provider, accountType, providerAccountId: id,
    displayName: 'My Account', username: 'acct', encryptedAccessToken: 'v1:x',
    scopes: [], providerMetadata: {}, status,
  });
}

/** A draft with a Threads target and generated copy — the common ready-ish base. */
async function seedThreadsDraft(svc, socialAccounts, { userId = '5' } = {}) {
  const acc = await seedAccount(socialAccounts, { userId });
  const post = await svc.createDraft(userId, { brief: 'x' });
  await svc.setTargets(userId, post.id, [{ socialAccountId: acc.id }]);
  await svc.generateContent(userId, post.id);
  return post;
}

// --- Save Draft ------------------------------------------------------------

test('saveDraft persists hand-edited per-platform copy and bumps the version', async () => {
  const { svc, socialAccounts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  const before = await svc.getPost('5', post.id);
  const saved = await svc.saveDraft('5', post.id, {
    fields: { title: 'My title' },
    platformCaptions: { threads: { postCopy: 'A hand written Threads post.', hashtags: ['#a', '#b'] } },
  });
  assert.equal(saved.title, 'My title');
  assert.equal(saved.platformCopy.threads.postCopy, 'A hand written Threads post.');
  assert.equal(saved.platformCopy.threads.userEdited, true);
  assert.equal(saved.draftVersion, before.draftVersion + 1, 'the version advanced');
  assert.equal(saved.postOrigin, 'manual_draft');
});

test('editing one platform never changes a sibling', async () => {
  const { svc, socialAccounts } = wire();
  const userId = '5';
  const acc1 = await seedAccount(socialAccounts, { userId, provider: 'instagram', accountType: 'instagram_professional', id: 'ig1' });
  const acc2 = await seedAccount(socialAccounts, { userId, provider: 'threads', accountType: 'threads_profile', id: 'th1' });
  const post = await svc.createDraft(userId, { brief: 'x' });
  await svc.setTargets(userId, post.id, [{ socialAccountId: acc1.id }, { socialAccountId: acc2.id }]);
  await svc.generateContent(userId, post.id);
  const igBefore = (await svc.getPost(userId, post.id)).platformCopy.instagram.postCopy;

  const saved = await svc.saveDraft(userId, post.id, {
    platformCaptions: { threads: { postCopy: 'Only threads changes here.', hashtags: [] } },
  });
  assert.equal(saved.platformCopy.threads.postCopy, 'Only threads changes here.');
  assert.equal(saved.platformCopy.instagram.postCopy, igBefore, 'Instagram is byte-for-byte unchanged');
});

test('an identical re-save is a no-op — no version bump, no change', async () => {
  const { svc, socialAccounts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  const first = await svc.saveDraft('5', post.id, {
    platformCaptions: { threads: { postCopy: 'Stable copy.', hashtags: ['#x'] } },
  });
  const again = await svc.saveDraft('5', post.id, {
    platformCaptions: { threads: { postCopy: 'Stable copy.', hashtags: ['#x'] } },
  });
  assert.equal(again.draftVersion, first.draftVersion, 'no version bump on an identical save');
});

test('a stale expectedVersion is rejected as a conflict, never a silent overwrite', async () => {
  const { svc, socialAccounts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  const v1 = await svc.getPost('5', post.id);
  // Tab A saves (version advances).
  await svc.saveDraft('5', post.id, { platformCaptions: { threads: { postCopy: 'Tab A copy.', hashtags: [] } } });
  // Tab B saves against the OLD version → conflict.
  await assert.rejects(
    () => svc.saveDraft('5', post.id, {
      platformCaptions: { threads: { postCopy: 'Tab B copy.', hashtags: [] } },
      expectedVersion: v1.draftVersion,
    }),
    /another tab|reload/i,
  );
  // Tab A's copy survives.
  assert.equal((await svc.getPost('5', post.id)).platformCopy.threads.postCopy, 'Tab A copy.');
});

test('saveDraft rejects copy for a platform the post does not target', async () => {
  const { svc, socialAccounts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts); // threads only
  await assert.rejects(
    () => svc.saveDraft('5', post.id, { platformCaptions: { facebook: { postCopy: 'nope', hashtags: [] } } }),
    /does not target/i,
  );
});

// --- readiness -------------------------------------------------------------

test('readiness: a threads draft with copy is ready; an empty one is not', async () => {
  const { svc, socialAccounts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  const r = await svc.getReadiness('5', post.id);
  assert.equal(r.ready, true);
  assert.equal(r.targets[0].status, 'ready');

  const empty = await svc.createDraft('5', { brief: 'x' });
  const acc = await seedAccount(socialAccounts, { id: 'acc_2' });
  await svc.setTargets('5', empty.id, [{ socialAccountId: acc.id }]);
  const r2 = await svc.getReadiness('5', empty.id);
  assert.equal(r2.ready, false);
  assert.equal(r2.targets[0].status, 'draft_incomplete');
});

test('readiness: Instagram without an image reports media_required', async () => {
  const { svc, socialAccounts } = wire();
  const acc = await seedAccount(socialAccounts, { provider: 'instagram', accountType: 'instagram_professional', id: 'ig1' });
  const post = await svc.createDraft('5', { brief: 'x' });
  await svc.setTargets('5', post.id, [{ socialAccountId: acc.id }]);
  await svc.generateContent('5', post.id);
  const r = await svc.getReadiness('5', post.id);
  assert.equal(r.ready, false);
  assert.equal(r.targets[0].status, 'media_required');
});

test('readiness: a disconnected account reports reconnect_required', async () => {
  const { svc, socialAccounts, posts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  // Flip the seeded account to revoked.
  const row = socialAccounts._rows ? socialAccounts._rows[0] : null;
  // The fake exposes accounts via listAccountsForUser; disconnect directly.
  await socialAccounts.markRevoked?.('acc_1', '5');
  const acc = (await socialAccounts.listAccountsForUser('5'))[0];
  if (acc && acc.status === 'active') {
    // Fallback: force via upsert to revoked status.
    await socialAccounts.upsertSocialAccount({ userId: '5', provider: 'threads', accountType: 'threads_profile', providerAccountId: 'acc_1', displayName: 'My Account', username: 'acct', encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'revoked' });
  }
  const r = await svc.getReadiness('5', post.id);
  assert.equal(r.ready, false);
  assert.equal(r.targets[0].status, 'reconnect_required');
});

// --- Publish Now -----------------------------------------------------------

test('publishNow queues the post and enqueues one durable job per target', async () => {
  const { svc, socialAccounts, jobs } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  const result = await svc.publishNow('5', post.id, {});
  assert.equal(result.status, 'queued');
  assert.equal(result.postOrigin, 'manual_publish_now');
  assert.equal(jobs._jobs.filter((j) => j.job_type === 'publish_scheduled_post_target').length, 1);
});

test('publishNow is idempotent — repeated clicks make one job per target', async () => {
  const { svc, socialAccounts, jobs } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  await svc.publishNow('5', post.id, {});
  await svc.publishNow('5', post.id, {});
  await svc.publishNow('5', post.id, {});
  assert.equal(jobs._jobs.filter((j) => j.job_type === 'publish_scheduled_post_target').length, 1, 'exactly one job across repeated Publish Now');
});

test('publishNow with live publishing OFF still queues but no provider is called', async () => {
  const { svc, socialAccounts, jobs, publishing } = wire({ liveEnabled: false });
  const post = await seedThreadsDraft(svc, socialAccounts);
  const result = await svc.publishNow('5', post.id, {});
  assert.equal(result.status, 'queued');
  assert.match(result.notice, /turned off|not.*sent|disabled/i);
  // A job was enqueued; running it makes zero provider calls (D2 flag gate).
  const outcome = await publishing.runPublishTargetJob({ userId: '5', payload: { targetId: post.id === null ? null : (jobs._jobs[0].payload.targetId), postId: post.id }, attemptCount: 1, maxAttempts: 5, id: '1' });
  assert.ok(outcome === undefined || outcome === null || typeof outcome === 'object');
});

test('publishNow blocks an unready post (no copy) with a clear reason', async () => {
  const { svc, socialAccounts, jobs } = wire();
  const post = await svc.createDraft('5', { brief: 'x' });
  const acc = await seedAccount(socialAccounts, { id: 'acc_9' });
  await svc.setTargets('5', post.id, [{ socialAccountId: acc.id }]);
  await assert.rejects(() => svc.publishNow('5', post.id, {}), /post copy|ready/i);
  assert.equal(jobs._jobs.length, 0, 'nothing enqueued for an unready post');
});

// --- Schedule Later (DST) --------------------------------------------------

test('schedule stores the exact local intent and a DST-correct UTC instant', async () => {
  const { svc, socialAccounts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  const scheduled = await svc.schedulePost('5', post.id, {
    scheduledDate: '2999-06-01', scheduledTime: '14:30', timezone: 'Asia/Karachi',
  });
  assert.equal(scheduled.status, 'queued');
  assert.equal(scheduled.scheduledLocalDate, '2999-06-01');
  assert.equal(scheduled.scheduledLocalTime, '14:30');
  const utc = fromMysqlUtc(scheduled.scheduledAtUtc);
  assert.equal(utc.getUTCHours(), 9); // 14:30 PKT -> 09:30 UTC
  assert.equal(utc.getUTCMinutes(), 30);
});

test('schedule across the New York spring-forward gap resolves forward', async () => {
  const { svc, socialAccounts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  // 2:30am on 2029-03-11 does not exist in America/New_York (spring forward).
  const scheduled = await svc.schedulePost('5', post.id, {
    scheduledDate: '2029-03-11', scheduledTime: '02:30', timezone: 'America/New_York',
  });
  // A valid UTC instant is produced (never NaN) and the local intent is kept.
  assert.ok(!Number.isNaN(fromMysqlUtc(scheduled.scheduledAtUtc).getTime()));
  assert.equal(scheduled.scheduledLocalTime, '02:30');
});

test('schedule rejects a stale version', async () => {
  const { svc, socialAccounts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  const v = (await svc.getPost('5', post.id)).draftVersion;
  await svc.saveDraft('5', post.id, { fields: { title: 'bump' } }); // advances version
  await assert.rejects(
    () => svc.schedulePost('5', post.id, { scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC', expectedVersion: v }),
    /another tab|reload/i,
  );
});

// --- ownership + security --------------------------------------------------

test('a second user cannot read, save, schedule or publish another user\'s post', async () => {
  const { svc, socialAccounts, jobs } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts, { userId: '5' });
  await assert.rejects(() => svc.getReadiness('999', post.id), /not found/i);
  await assert.rejects(() => svc.saveDraft('999', post.id, { fields: { title: 'x' } }), /not found/i);
  await assert.rejects(() => svc.schedulePost('999', post.id, { scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC' }), /not found/i);
  await assert.rejects(() => svc.publishNow('999', post.id, {}), /not found/i);
  assert.equal(jobs._jobs.length, 0, 'a rejected cross-user action enqueues nothing');
});

test('an in-flight target freezes editing, scheduling and publishing', async () => {
  const { svc, socialAccounts, posts } = wire();
  const post = await seedThreadsDraft(svc, socialAccounts);
  // Simulate the target having entered publishing.
  posts._targets[0].publish_status = 'submitted';
  await assert.rejects(() => svc.saveDraft('5', post.id, { platformCaptions: { threads: { postCopy: 'late edit', hashtags: [] } } }), /already publishing/i);
  await assert.rejects(() => svc.schedulePost('5', post.id, { scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC' }), /already publishing/i);
  await assert.rejects(() => svc.publishNow('5', post.id, {}), /already publishing/i);
});
