import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPublishingService } from '../src/services/publishingService.js';
import { createDurableJobService } from '../src/services/durableJobService.js';
import { ADAPTER_RESULT, PUBLISH_ERROR_CATEGORY, PUBLISH_JOB_TYPES } from '../src/config/constants.js';
import { createFakeBackgroundJobRepository } from './helpers/fakes.js';

const NOW = new Date('2026-07-20T09:00:00Z');
const USER = '5';

/** In-memory publishRepo mirroring the real one's method surface. */
function fakePublishRepo() {
  const targets = new Map();
  const attempts = [];
  let postStatus = 'queued';
  let nextAttemptId = 1;
  const T = (t) => (t ? { ...t } : null);
  return {
    _targets: targets, _attempts: attempts, get postStatus() { return postStatus; },
    seed(t) { targets.set(t.targetId, { attemptCount: 0, publishStatus: 'scheduled', status: 'pending', accountStatus: 'active', postStatus: 'queued', scheduledAtUtc: '2026-07-20 08:00:00', userId: USER, ...t }); },
    async findTargetForPublish(id, userId) { const t = targets.get(String(id)); return t && t.userId === String(userId) ? T(t) : null; },
    async listDuePublishTargets() {
      return [...targets.values()].filter((t) => ['scheduled', 'retry_scheduled'].includes(t.publishStatus)).map(T);
    },
    async claimTargetForPublish() { return true; },
    async createAttemptIfAbsent(input) {
      const dup = attempts.find((a) => a.idempotencyKey === input.idempotencyKey);
      if (dup) return { attempt: { ...dup }, created: false };
      const row = { id: String(nextAttemptId++), status: 'started', providerPostId: null, providerContainerId: null, ...input };
      attempts.push(row);
      return { attempt: { ...row }, created: true };
    },
    async updateAttempt(id, userId, fields) { const a = attempts.find((x) => x.id === String(id)); if (a) Object.assign(a, fields); return a ? { ...a } : null; },
    async findAttemptById(id, userId) { const a = attempts.find((x) => x.id === String(id)); return a && a.userId === String(userId) ? { ...a } : null; },
    async findAttemptByIdempotencyKey(k) { const a = attempts.find((x) => x.idempotencyKey === k); return a ? { ...a } : null; },
    async listAttemptsForTarget(targetId, userId) { return attempts.filter((a) => String(a.targetId) === String(targetId)).map((a) => ({ ...a })); },
    async listAttemptsToReconcile() { return attempts.filter((a) => ['submitted', 'reconciling', 'unknown_result'].includes(a.status)).map((a) => ({ ...a })); },
    async updateTargetPublishState(id, userId, fields) { const t = targets.get(String(id)); if (t) Object.assign(t, mapFields(fields)); },
    async retryTargetForPublish(id, userId) { const t = targets.get(String(id)); if (t && ['failed', 'attention_needed'].includes(t.publishStatus)) { t.publishStatus = 'retry_scheduled'; t.attentionReason = null; t.attemptCount += 1; return true; } return false; },
    async rollupPostStatus() {
      const all = [...targets.values()];
      const pub = all.filter((t) => t.publishStatus === 'published').length;
      if (pub === all.length) postStatus = 'published';
      else if (pub > 0) postStatus = 'partial';
      else if (all.every((t) => ['failed', 'cancelled'].includes(t.publishStatus))) postStatus = 'failed';
      else postStatus = 'processing';
      return postStatus;
    },
  };
}
function mapFields(f) {
  const out = {};
  if (f.publishStatus !== undefined) out.publishStatus = f.publishStatus;
  if (f.attentionReason !== undefined) out.attentionReason = f.attentionReason;
  if (f.remotePostId !== undefined) out.remotePostId = f.remotePostId;
  if (f.status !== undefined) out.status = f.status;
  if (f.lastPublishAttemptId !== undefined) out.lastPublishAttemptId = f.lastPublishAttemptId;
  return out;
}

/** Fake adapters with scriptable per-platform publish/reconcile results. */
function fakeAdapters(script = {}) {
  const calls = { publish: [], reconcile: [] };
  const make = (platform) => ({
    platform,
    getCapabilities: () => ({ platform }),
    async preflight({ mediaUrl }) {
      // A scripted preflight (e.g. a missing publish permission the provider
      // surfaces) takes precedence over the default media-required check.
      const scripted = script[platform]?.preflight;
      if (scripted) return scripted;
      if (platform === 'instagram' && !mediaUrl) return { ok: false, category: PUBLISH_ERROR_CATEGORY.MEDIA_REQUIRED };
      return { ok: true };
    },
    async publish(ctx) {
      calls.publish.push({ platform, caption: ctx.caption, providerAccountId: ctx.providerAccountId, mediaUrl: ctx.mediaUrl });
      const r = script[platform]?.publish;
      if (typeof r === 'function') return r(ctx, calls.publish.filter((c) => c.platform === platform).length);
      return r || { status: ADAPTER_RESULT.PUBLISHED, providerPostId: `${platform}_post_${calls.publish.length}` };
    },
    async reconcile(ctx) {
      calls.reconcile.push({ platform });
      const r = script[platform]?.reconcile;
      if (typeof r === 'function') return r(ctx, calls.reconcile.filter((c) => c.platform === platform).length);
      return r || { status: ADAPTER_RESULT.PUBLISHED, providerPostId: `${platform}_rec` };
    },
  });
  return { calls, adapters: { facebook: make('facebook'), instagram: make('instagram'), threads: make('threads') } };
}

function build({ liveEnabled = true, script = {}, decrypt, mediaFound = true, tokenPresent = true } = {}) {
  const publishRepo = fakePublishRepo();
  const jobs = createFakeBackgroundJobRepository();
  const { calls, adapters } = fakeAdapters(script);
  const socialAccounts = { async findAccountWithEncryptedTokens() { return { access_token_encrypted: tokenPresent ? 'v1:enc' : null }; } };
  const mediaRepository = { async findMediaAssetByIdForUser() { return mediaFound ? { publicToken: 'tok123' } : null; } };
  const svc = createPublishingService({
    publishRepo, socialAccounts, mediaRepository, jobs, adapters,
    decryptSecret: decrypt || (() => 'access-token'), logging: { record: async () => {} },
    config: { publishing: { liveEnabled, reconcileDelaySeconds: 30, maxReconcileAttempts: 3, requestTimeoutMs: 5000 }, publicBaseUrl: 'https://app.test' },
    now: () => NOW,
  });
  const worker = (nowFn = () => NOW) => createDurableJobService({ jobs, handlers: svc.handlers, now: nowFn, options: { heartbeatMs: 0 } });
  return { svc, jobs, publishRepo, calls, worker };
}

const seedIgTh = (repo, { igMedia = 'm1' } = {}) => {
  repo.seed({ targetId: '10', scheduledPostId: '1', socialAccountId: '100', provider: 'instagram', accountType: 'instagram_professional', platform: 'instagram', providerAccountId: 'IG1', caption: 'IG copy', mediaAssetId: igMedia });
  repo.seed({ targetId: '11', scheduledPostId: '1', socialAccountId: '101', provider: 'threads', accountType: 'threads_profile', platform: 'threads', providerAccountId: 'TH1', caption: 'Threads copy', mediaAssetId: null });
};

test('due targets publish with the right per-platform copy; post becomes published', async () => {
  const { svc, publishRepo, calls, worker } = build();
  seedIgTh(publishRepo);
  const { enqueued } = await svc.enqueueDuePublishTargets({});
  assert.equal(enqueued, 2);
  await worker().drain({ workerId: 'W', max: 50 });

  assert.equal(publishRepo._targets.get('10').publishStatus, 'published');
  assert.equal(publishRepo._targets.get('11').publishStatus, 'published');
  const igCall = calls.publish.find((c) => c.platform === 'instagram');
  const thCall = calls.publish.find((c) => c.platform === 'threads');
  assert.equal(igCall.caption, 'IG copy', 'Instagram got Instagram copy');
  assert.equal(thCall.caption, 'Threads copy', 'Threads got Threads copy, not Instagram copy');
  assert.equal(publishRepo.postStatus, 'published');
});

test('a duplicated publish job makes exactly one provider call per target', async () => {
  const { svc, calls, worker, publishRepo } = build();
  seedIgTh(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await svc.enqueueDuePublishTargets({}); // duplicate tick
  await worker().drain({ workerId: 'W', max: 50 });
  assert.equal(calls.publish.filter((c) => c.platform === 'instagram').length, 1);
  assert.equal(calls.publish.filter((c) => c.platform === 'threads').length, 1);
});

test('a known provider post id prevents resubmission', async () => {
  const { svc, jobs, calls, worker, publishRepo } = build();
  publishRepo.seed({ targetId: '10', scheduledPostId: '1', socialAccountId: '100', provider: 'threads', accountType: 'threads_profile', platform: 'threads', providerAccountId: 'TH1', caption: 'c' });
  // Pre-seed a completed attempt with a provider post id for the first key.
  publishRepo._attempts.push({ id: '99', userId: USER, targetId: '10', idempotencyKey: 'publish:1:target:10:a0', providerPostId: 'already_posted', status: 'published' });
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  assert.equal(calls.publish.length, 0, 'no provider call — the target was already published');
  assert.equal(publishRepo._targets.get('10').publishStatus, 'published');
});

test('partial success: Instagram publishes, Threads permanently fails; post is partial', async () => {
  const { svc, publishRepo, worker } = build({
    script: { threads: { publish: { status: ADAPTER_RESULT.PERMANENT_FAILURE, errorCategory: PUBLISH_ERROR_CATEGORY.PERMISSION_REQUIRED, safeMessage: 'Reconnect' } } },
  });
  seedIgTh(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  assert.equal(publishRepo._targets.get('10').publishStatus, 'published', 'Instagram stays published');
  assert.equal(publishRepo._targets.get('11').publishStatus, 'failed', 'Threads is failed');
  assert.equal(publishRepo.postStatus, 'partial', 'the post reports partial, not a blanket success');
});

test('an uncertain result reconciles instead of blindly re-publishing', async () => {
  let igPublishCount = 0;
  const { svc, jobs, publishRepo, calls, worker } = build({
    script: {
      instagram: {
        publish: () => { igPublishCount += 1; return { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: 'cont1' }; },
        reconcile: { status: ADAPTER_RESULT.PUBLISHED, providerPostId: 'ig_reconciled' },
      },
      threads: { publish: { status: ADAPTER_RESULT.PUBLISHED, providerPostId: 'th1' } },
    },
  });
  seedIgTh(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  // IG submitted -> a reconcile job was enqueued; the container had status.
  assert.equal(publishRepo._targets.get('10').publishStatus, 'reconciling');
  // Drain again (the reconcile job is due at NOW+30s; advance time).
  const later = new Date(NOW.getTime() + 60000);
  await worker(() => later).drain({ workerId: 'W', max: 50 });
  assert.equal(publishRepo._targets.get('10').publishStatus, 'published', 'reconciled to published');
  assert.equal(igPublishCount, 1, 'the publish call happened exactly once — no blind retry');
  assert.ok(calls.reconcile.some((c) => c.platform === 'instagram'), 'a reconcile call happened');
});

test('with live publishing disabled, a publish job makes zero provider calls', async () => {
  const { svc, publishRepo, calls, worker } = build({ liveEnabled: false });
  seedIgTh(publishRepo);
  const res = await svc.enqueueDuePublishTargets({});
  assert.equal(res.skipped, 'live_publishing_disabled');
  assert.equal(res.enqueued, 0, 'nothing enqueued while disabled');
  // Even a directly-run publish job holds without calling a provider.
  await svc.runPublishTargetJob({ userId: USER, payload: { targetId: '10', postId: '1' }, attemptCount: 1, maxAttempts: 5, id: '1' });
  assert.equal(calls.publish.length, 0, 'zero provider calls with the flag off');
  assert.equal(publishRepo._targets.get('10').publishStatus, 'attention_needed');
});

test('preflight blocks an inactive account before any provider call', async () => {
  const { svc, publishRepo, calls, worker } = build();
  seedIgTh(publishRepo);
  publishRepo._targets.get('10').accountStatus = 'expired';
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  assert.equal(calls.publish.filter((c) => c.platform === 'instagram').length, 0, 'no IG call for the expired account');
  assert.equal(publishRepo._targets.get('10').publishStatus, 'failed');
  assert.match(publishRepo._targets.get('10').attentionReason, /Reconnect/i);
});

test('two workers publishing the same target produce exactly one provider call', async () => {
  const { svc, publishRepo, calls, worker } = build();
  publishRepo.seed({ targetId: '10', scheduledPostId: '1', socialAccountId: '100', provider: 'threads', accountType: 'threads_profile', platform: 'threads', providerAccountId: 'TH1', caption: 'c' });
  await svc.enqueueDuePublishTargets({});
  const A = worker(); const B = worker();
  await Promise.all([A.runOne({ workerId: 'A' }), B.runOne({ workerId: 'B' })]);
  assert.equal(calls.publish.length, 1, 'the target published exactly once across two workers');
});

test('ownership: another user cannot resolve or act on the target', async () => {
  const { svc, publishRepo } = build();
  seedIgTh(publishRepo);
  assert.equal(await publishRepo.findTargetForPublish('10', '999'), null);
  assert.deepEqual(await svc.retryTarget('999', '10'), { ok: false });
});

// --- D2 spec section 21: preflight matrix, modes, reconciliation branches -----

const seedThreads = (repo, id = '11') => repo.seed({ targetId: id, scheduledPostId: '1', socialAccountId: '101', provider: 'threads', accountType: 'threads_profile', platform: 'threads', providerAccountId: 'TH1', caption: 'c' });

test('each target publishes to its own exact provider account, with its own media', async () => {
  const { svc, publishRepo, calls, worker } = build();
  seedIgTh(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  const ig = calls.publish.find((c) => c.platform === 'instagram');
  const th = calls.publish.find((c) => c.platform === 'threads');
  assert.equal(ig.providerAccountId, 'IG1', 'Instagram published to the exact IG account');
  assert.equal(th.providerAccountId, 'TH1', 'Threads published to its own account, not IG1');
  assert.match(ig.mediaUrl, /\/media\/tok123$/, 'Instagram received its resolved media URL');
});

test('a token that will not decrypt blocks the publish before any provider call', async () => {
  const { svc, publishRepo, calls, worker } = build({ decrypt: () => { throw new Error('bad envelope'); } });
  seedThreads(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  assert.equal(calls.publish.length, 0, 'no provider call when the token cannot be decrypted');
  assert.equal(publishRepo._targets.get('11').publishStatus, 'failed');
});

test('a missing access token blocks the publish before any provider call', async () => {
  const { svc, publishRepo, calls, worker } = build({ tokenPresent: false });
  seedThreads(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  assert.equal(calls.publish.length, 0, 'no provider call without a stored token');
  assert.equal(publishRepo._targets.get('11').publishStatus, 'failed');
});

test('a missing publish permission is surfaced without a blind publish attempt', async () => {
  const { svc, publishRepo, calls, worker } = build({
    script: { threads: { preflight: { ok: false, category: PUBLISH_ERROR_CATEGORY.PERMISSION_REQUIRED, reason: 'Grant the publish permission.' } } },
  });
  seedThreads(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  assert.equal(calls.publish.length, 0, 'preflight blocked the call');
  assert.notEqual(publishRepo._targets.get('11').publishStatus, 'published');
});

test('Instagram media that cannot be resolved blocks IG but never Threads', async () => {
  const { svc, publishRepo, calls, worker } = build({ mediaFound: false });
  seedIgTh(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  assert.equal(calls.publish.filter((c) => c.platform === 'instagram').length, 0, 'no IG publish without media');
  assert.equal(publishRepo._targets.get('10').publishStatus, 'failed', 'IG is blocked');
  assert.equal(publishRepo._targets.get('11').publishStatus, 'published', 'Threads (no media required) is unaffected');
});

test('unapproved targets (draft / awaiting approval) are never enqueued to publish', async () => {
  const { svc, publishRepo } = build();
  seedThreads(publishRepo, '20');
  publishRepo._targets.get('20').publishStatus = 'draft';
  seedThreads(publishRepo, '21');
  publishRepo._targets.get('21').publishStatus = 'waiting_approval';
  const { enqueued } = await svc.enqueueDuePublishTargets({});
  assert.equal(enqueued, 0, 'only approved, scheduled targets are ever published');
});

test('a provider timeout is treated as submitted and reconciled, not re-published', async () => {
  let igPublishCount = 0;
  const { svc, publishRepo, worker } = build({
    script: {
      instagram: { publish: () => { igPublishCount += 1; return { status: ADAPTER_RESULT.UNKNOWN_RESULT, providerContainerId: 'c1' }; }, reconcile: { status: ADAPTER_RESULT.PUBLISHED, providerPostId: 'ig_rec' } },
      threads: { publish: { status: ADAPTER_RESULT.PUBLISHED, providerPostId: 't1' } },
    },
  });
  seedIgTh(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  assert.equal(publishRepo._targets.get('10').publishStatus, 'reconciling', 'an uncertain timeout reconciles, it does not fail');
  const later = new Date(NOW.getTime() + 60000);
  await worker(() => later).drain({ workerId: 'W', max: 50 });
  assert.equal(publishRepo._targets.get('10').publishStatus, 'published');
  assert.equal(igPublishCount, 1, 'the timeout never caused a second publish');
});

test('reconciliation that finds a permanent failure fails the target (no false success)', async () => {
  const { svc, publishRepo, worker } = build({
    script: {
      instagram: { publish: { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: 'c1' }, reconcile: { status: ADAPTER_RESULT.PERMANENT_FAILURE, errorCategory: PUBLISH_ERROR_CATEGORY.VALIDATION_FAILED, safeMessage: 'The media was rejected.' } },
      threads: { publish: { status: ADAPTER_RESULT.PUBLISHED, providerPostId: 't1' } },
    },
  });
  seedIgTh(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  const later = new Date(NOW.getTime() + 60000);
  await worker(() => later).drain({ workerId: 'W', max: 50 });
  assert.equal(publishRepo._targets.get('10').publishStatus, 'failed', 'reconciliation surfaced the real failure');
  assert.equal(publishRepo._targets.get('11').publishStatus, 'published');
  assert.equal(publishRepo.postStatus, 'partial');
});

test('an in-progress reconciliation reschedules; a later check publishes, never duplicating', async () => {
  const { svc, publishRepo, calls, worker } = build({
    script: {
      instagram: {
        publish: { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: 'c1' },
        reconcile: (ctx, n) => (n === 1 ? { status: ADAPTER_RESULT.UNKNOWN_RESULT } : { status: ADAPTER_RESULT.PUBLISHED, providerPostId: 'ig_rec' }),
      },
      threads: { publish: { status: ADAPTER_RESULT.PUBLISHED, providerPostId: 't1' } },
    },
  });
  seedIgTh(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  const attempt = publishRepo._attempts.find((a) => String(a.targetId) === '10');
  // First reconcile: still in progress -> transient reschedule, still reconciling.
  await assert.rejects(svc.handlers[PUBLISH_JOB_TYPES.RECONCILE_ATTEMPT]({ userId: USER, payload: { attemptId: attempt.id, targetId: '10' }, attemptCount: 1, maxAttempts: 3, id: 'r1' }));
  assert.equal(publishRepo._targets.get('10').publishStatus, 'reconciling');
  // Second reconcile: now published.
  await svc.handlers[PUBLISH_JOB_TYPES.RECONCILE_ATTEMPT]({ userId: USER, payload: { attemptId: attempt.id, targetId: '10' }, attemptCount: 2, maxAttempts: 3, id: 'r2' });
  assert.equal(publishRepo._targets.get('10').publishStatus, 'published');
  assert.equal(calls.publish.filter((c) => c.platform === 'instagram').length, 1, 'reconciliation never re-published');
});

test('reconciliation gives up after the cap and flags the target for attention', async () => {
  const { svc, publishRepo, worker } = build({
    script: {
      instagram: { publish: { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: 'c1' }, reconcile: { status: ADAPTER_RESULT.UNKNOWN_RESULT } },
      threads: { publish: { status: ADAPTER_RESULT.PUBLISHED, providerPostId: 't1' } },
    },
  });
  seedIgTh(publishRepo);
  await svc.enqueueDuePublishTargets({});
  await worker().drain({ workerId: 'W', max: 50 });
  const attempt = publishRepo._attempts.find((a) => String(a.targetId) === '10');
  // At the reconcile cap and still unknown: stop, do not loop forever.
  await svc.handlers[PUBLISH_JOB_TYPES.RECONCILE_ATTEMPT]({ userId: USER, payload: { attemptId: attempt.id, targetId: '10' }, attemptCount: 3, maxAttempts: 3, id: 'r1' });
  assert.equal(publishRepo._targets.get('10').publishStatus, 'attention_needed', 'an undeterminable result needs a human, not an infinite retry');
});
