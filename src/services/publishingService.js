/**
 * Provider publishing orchestration (D2). Runs on the D1 durable job system.
 *
 * PREPARE -> PREFLIGHT -> PUBLISH (via one exact adapter) -> persist a normalized
 * result -> complete / retry / reconcile, per target, independently. One target
 * succeeding never hides another failing. An uncertain result is reconciled
 * against the provider, never blindly re-published. Live provider calls are gated
 * behind config.publishing.liveEnabled (default false).
 *
 * Ownership: every target/account/token/attempt access is user-scoped. Adapters
 * only ever see one account's decrypted token, passed as a Bearer header.
 */

import { TransientJobError, PermanentJobError } from './durableJobService.js';
import { safeMessageFor } from '../publishing/adapters.js';
import { capabilityForAccountType } from '../publishing/providerCapabilities.js';
import {
  PUBLISH_JOB_TYPES, PUBLISH_STATUS, PUBLISH_ATTEMPT_STATUS, ADAPTER_RESULT,
  PUBLISH_ERROR_CATEGORY, TRANSIENT_PUBLISH_CATEGORIES, EVENT_TYPES, USAGE_SERVICES,
} from '../config/constants.js';
import { addSecondsUtc } from '../utils/time.js';

import * as defaultPublishRepo from '../repositories/publishRepository.js';
import * as defaultSocialAccounts from '../repositories/socialAccountRepository.js';
import * as defaultMediaRepo from '../repositories/mediaAssetRepository.js';
import * as defaultJobs from '../repositories/backgroundJobRepository.js';
import { decryptSecret as defaultDecrypt } from './encryptionService.js';
import { loggingService as defaultLogging } from './loggingService.js';

const ACTIVE = 'active';

export function createPublishingService({
  publishRepo = defaultPublishRepo,
  socialAccounts = defaultSocialAccounts,
  mediaRepository = defaultMediaRepo,
  jobs = defaultJobs,
  adapters = {},
  decryptSecret = defaultDecrypt,
  logging = defaultLogging,
  config,
  now = () => new Date(),
} = {}) {
  const liveEnabled = () => Boolean(config?.publishing?.liveEnabled);
  const reconcileDelay = config?.publishing?.reconcileDelaySeconds ?? 60;
  const maxReconcile = config?.publishing?.maxReconcileAttempts ?? 8;
  const publicBase = (config?.publicBaseUrl || '').replace(/\/+$/, '');

  function adapterFor(platform) {
    return adapters[platform] || null;
  }

  async function resolveMediaUrl(userId, mediaAssetId) {
    if (!mediaAssetId) return null;
    const asset = await mediaRepository.findMediaAssetByIdForUser(mediaAssetId, userId).catch(() => null);
    if (!asset || !asset.publicToken) return null;
    return `${publicBase}/media/${asset.publicToken}`;
  }

  /** Full preflight. Returns { ok } or { ok:false, category, reason, permanent }. */
  async function preflight(target) {
    const cap = capabilityForAccountType(target.accountType);
    if (!cap) return { ok: false, category: PUBLISH_ERROR_CATEGORY.CONFIGURATION_ERROR, reason: 'This account type cannot be published to.', permanent: true };
    if (target.platform !== cap.platform) {
      return { ok: false, category: PUBLISH_ERROR_CATEGORY.CONFIGURATION_ERROR, reason: 'The selected account is not one of this post’s platforms.', permanent: true };
    }
    if (target.accountStatus !== ACTIVE) {
      return { ok: false, category: PUBLISH_ERROR_CATEGORY.ACCOUNT_UNAVAILABLE, reason: `Reconnect this ${label(cap.platform)} account.`, permanent: true };
    }
    const mediaUrl = await resolveMediaUrl(target.userId, target.mediaAssetId);
    const adapter = adapterFor(target.platform);
    if (!adapter) return { ok: false, category: PUBLISH_ERROR_CATEGORY.CONFIGURATION_ERROR, reason: 'No adapter is available for this platform.', permanent: true };
    const pf = await adapter.preflight({ caption: target.caption, mediaUrl });
    if (!pf.ok) return { ...pf, permanent: pf.category === PUBLISH_ERROR_CATEGORY.MEDIA_REQUIRED || pf.category === PUBLISH_ERROR_CATEGORY.VALIDATION_FAILED };
    // Token must exist + decrypt.
    const row = await socialAccounts.findAccountWithEncryptedTokens(target.socialAccountId, target.userId).catch(() => null);
    if (!row || !row.access_token_encrypted) {
      return { ok: false, category: PUBLISH_ERROR_CATEGORY.AUTHENTICATION_REQUIRED, reason: `Reconnect this ${label(cap.platform)} account.`, permanent: true };
    }
    let accessToken;
    try { accessToken = decryptSecret(row.access_token_encrypted); } catch {
      return { ok: false, category: PUBLISH_ERROR_CATEGORY.AUTHENTICATION_REQUIRED, reason: `Reconnect this ${label(cap.platform)} account.`, permanent: true };
    }
    return { ok: true, accessToken, mediaUrl, providerAccountId: target.providerAccountId, adapter, cap };
  }

  // --- publish job ----------------------------------------------------------

  async function runPublishTargetJob(job) {
    const userId = job.userId;
    const { targetId } = job.payload || {};
    const target = await publishRepo.findTargetForPublish(targetId, userId);
    if (!target) return; // gone
    if (![PUBLISH_STATUS.SCHEDULED, PUBLISH_STATUS.RETRY_SCHEDULED, PUBLISH_STATUS.PUBLISHING].includes(target.publishStatus)) return;
    if (target.publishStatus === PUBLISH_STATUS.PUBLISHED) return;

    // Feature flag: with live publishing off, make ZERO provider calls.
    if (!liveEnabled()) {
      await publishRepo.updateTargetPublishState(targetId, userId, {
        publishStatus: PUBLISH_STATUS.ATTENTION_NEEDED, attentionReason: 'Live publishing is disabled.',
      });
      await record(EVENT_TYPES.PUBLISH_TARGET_BLOCKED, { userId, target, message: 'Live publishing is disabled' });
      return; // completed as a no-op; nothing claimed as published
    }

    // Preflight (ownership, account, capability, token, media) — no provider call yet.
    const pf = await preflight(target);
    if (!pf.ok) {
      await markTargetFailed(target, pf.category, pf.reason);
      await record(EVENT_TYPES.PUBLISH_PREFLIGHT_FAILED, { userId, target, level: 'warn', message: pf.reason });
      if (pf.permanent) throw new PermanentJobError(pf.category);
      throw new TransientJobError(pf.category);
    }

    await publishRepo.updateTargetPublishState(targetId, userId, { publishStatus: PUBLISH_STATUS.PUBLISHING });

    // Idempotent attempt row. If a prior attempt already recorded a provider post
    // id, the target is already published — never resubmit.
    const attemptNumber = target.attemptCount + 1;
    const key = `publish:${target.scheduledPostId}:target:${targetId}:a${target.attemptCount}`;
    const { attempt } = await publishRepo.createAttemptIfAbsent({
      userId, scheduledPostId: target.scheduledPostId, targetId, socialAccountId: target.socialAccountId,
      backgroundJobId: job.id, provider: target.provider, idempotencyKey: key, attemptNumber,
    });
    if (attempt.providerPostId) {
      await markTargetPublished(target, attempt.providerPostId, attempt.id);
      return;
    }

    await record(EVENT_TYPES.PUBLISH_TARGET_STARTED, { userId, target, message: 'Publishing started' });

    // Record the api_usage of a real provider call (safe metering).
    await recordUsage(userId, target.provider).catch(() => {});
    const result = await pf.adapter.publish({
      providerAccountId: pf.providerAccountId, accessToken: pf.accessToken,
      caption: target.caption, mediaUrl: pf.mediaUrl,
    });
    // Drop the plaintext token reference promptly.
    pf.accessToken = undefined;

    return handleResult({ job, target, attempt, result });
  }

  async function handleResult({ job, target, attempt, result }) {
    const userId = target.userId;
    const targetId = target.targetId;

    if (result.status === ADAPTER_RESULT.PUBLISHED) {
      await publishRepo.updateAttempt(attempt.id, userId, {
        status: PUBLISH_ATTEMPT_STATUS.PUBLISHED, providerPostId: result.providerPostId ?? null,
        providerContainerId: result.providerContainerId ?? null, providerStatus: result.providerStatus ?? 'published',
        publishedAt: now(),
      });
      await markTargetPublished(target, result.providerPostId ?? null, attempt.id);
      return;
    }

    if (result.status === ADAPTER_RESULT.SUBMITTED || result.status === ADAPTER_RESULT.UNKNOWN_RESULT) {
      // Uncertain / async — reconcile against the provider, never blind retry.
      const nextReconcile = addSecondsUtc(reconcileDelay, now());
      await publishRepo.updateAttempt(attempt.id, userId, {
        status: result.status === ADAPTER_RESULT.SUBMITTED ? PUBLISH_ATTEMPT_STATUS.SUBMITTED : PUBLISH_ATTEMPT_STATUS.UNKNOWN_RESULT,
        providerContainerId: result.providerContainerId ?? null, providerRequestId: result.providerRequestId ?? null,
        providerStatus: result.providerStatus ?? null, submittedAt: now(), nextReconcileAt: nextReconcile,
      });
      await publishRepo.updateTargetPublishState(targetId, userId, {
        publishStatus: PUBLISH_STATUS.RECONCILING, lastPublishAttemptId: attempt.id,
      });
      await jobs.enqueueJob({
        userId, jobType: PUBLISH_JOB_TYPES.RECONCILE_ATTEMPT,
        idempotencyKey: `reconcile:${attempt.id}`, payload: { attemptId: attempt.id, targetId },
        availableAt: nextReconcile, maxAttempts: maxReconcile,
      });
      await record(EVENT_TYPES.PUBLISH_ATTEMPT_RECONCILING, { userId, target, message: 'Result uncertain; reconciling' });
      return; // job completes; reconciliation is a separate job
    }

    if (result.status === ADAPTER_RESULT.RETRYABLE_FAILURE) {
      const lastAttempt = job.attemptCount >= job.maxAttempts;
      await publishRepo.updateAttempt(attempt.id, userId, {
        status: PUBLISH_ATTEMPT_STATUS.RETRYABLE_FAILURE, errorCategory: result.errorCategory ?? null,
        safeErrorMessage: result.safeMessage ?? safeMessageFor(result.errorCategory),
      });
      if (lastAttempt) {
        await markTargetFailed(target, result.errorCategory, result.safeMessage);
      } else {
        await publishRepo.updateTargetPublishState(targetId, userId, { publishStatus: PUBLISH_STATUS.PUBLISHING, lastErrorCode: result.errorCategory ?? null, lastErrorMessage: result.safeMessage ?? null });
      }
      await record(EVENT_TYPES.PUBLISH_TARGET_RETRY_SCHEDULED, { userId, target, level: 'warn', message: 'Publish will retry' });
      throw new TransientJobError(result.errorCategory || 'provider_transient');
    }

    // PERMANENT_FAILURE
    await publishRepo.updateAttempt(attempt.id, userId, {
      status: PUBLISH_ATTEMPT_STATUS.PERMANENT_FAILURE, errorCategory: result.errorCategory ?? null,
      safeErrorMessage: result.safeMessage ?? safeMessageFor(result.errorCategory),
    });
    await markTargetFailed(target, result.errorCategory, result.safeMessage);
    throw new PermanentJobError(result.errorCategory || 'provider_permanent');
  }

  // --- reconcile job --------------------------------------------------------

  async function runReconcileJob(job) {
    const userId = job.userId;
    const { attemptId, targetId } = job.payload || {};
    const attempt = await publishRepo.findAttemptById(attemptId, userId);
    if (!attempt) return;
    if ([PUBLISH_ATTEMPT_STATUS.PUBLISHED, PUBLISH_ATTEMPT_STATUS.PERMANENT_FAILURE].includes(attempt.status)) return;
    const target = await publishRepo.findTargetForPublish(targetId ?? attempt.targetId, userId);
    if (!target) return;

    const pf = await preflight(target);
    if (!pf.ok) {
      // Cannot reconcile without a usable token — hold for attention.
      await markTargetAttention(target, pf.category, pf.reason);
      throw new PermanentJobError(pf.category);
    }
    await publishRepo.updateAttempt(attempt.id, userId, { status: PUBLISH_ATTEMPT_STATUS.RECONCILING, lastCheckedAt: now() });

    const result = await pf.adapter.reconcile({
      providerAccountId: pf.providerAccountId, accessToken: pf.accessToken,
      containerId: attempt.providerContainerId, providerPostId: attempt.providerPostId,
    });
    pf.accessToken = undefined;

    if (result.status === ADAPTER_RESULT.PUBLISHED) {
      await publishRepo.updateAttempt(attempt.id, userId, { status: PUBLISH_ATTEMPT_STATUS.PUBLISHED, providerPostId: result.providerPostId ?? attempt.providerPostId, publishedAt: now() });
      await markTargetPublished(target, result.providerPostId ?? attempt.providerPostId, attempt.id);
      await record(EVENT_TYPES.PUBLISH_ATTEMPT_RECONCILED, { userId, target, message: 'Reconciled: published' });
      return;
    }
    if (result.status === ADAPTER_RESULT.PERMANENT_FAILURE) {
      await publishRepo.updateAttempt(attempt.id, userId, { status: PUBLISH_ATTEMPT_STATUS.PERMANENT_FAILURE, errorCategory: result.errorCategory ?? null, safeErrorMessage: result.safeMessage ?? null });
      await markTargetFailed(target, result.errorCategory, result.safeMessage);
      throw new PermanentJobError(result.errorCategory || 'provider_permanent');
    }
    // Still in progress / unknown — reconcile again, up to the cap.
    if (job.attemptCount >= Math.min(job.maxAttempts, maxReconcile)) {
      await markTargetAttention(target, PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN, 'The publish result could not be determined. Please check the provider and retry.');
      await publishRepo.updateAttempt(attempt.id, userId, { status: PUBLISH_ATTEMPT_STATUS.UNKNOWN_RESULT });
      return; // stop reconciling; requires human attention
    }
    await publishRepo.updateAttempt(attempt.id, userId, { nextReconcileAt: addSecondsUtc(reconcileDelay, now()) });
    throw new TransientJobError('reconcile_in_progress');
  }

  async function runPublishStaleRecoveryJob() {
    // Attempts stuck reconciling past their window are picked up by re-enqueueing
    // a reconcile job. (The durable job system also recovers stale job leases.)
    const due = await publishRepo.listAttemptsToReconcile({ now: now(), limit: 50 });
    let requeued = 0;
    for (const a of due) {
      // eslint-disable-next-line no-await-in-loop
      const { created } = await jobs.enqueueJob({
        userId: a.userId, jobType: PUBLISH_JOB_TYPES.RECONCILE_ATTEMPT,
        idempotencyKey: `reconcile:${a.id}:${Math.floor(now().getTime() / 60000)}`,
        payload: { attemptId: a.id, targetId: a.targetId }, maxAttempts: maxReconcile,
      });
      if (created) requeued += 1;
    }
    return { requeued };
  }

  // --- enqueue bridge (scheduler tick) --------------------------------------

  /** Enqueue publish jobs for due, approved, queued targets. Called by scheduler:once. */
  async function enqueueDuePublishTargets({ limit = 100 } = {}) {
    if (!liveEnabled()) return { skipped: 'live_publishing_disabled', enqueued: 0 };
    const due = await publishRepo.listDuePublishTargets({ now: now(), limit });
    let enqueued = 0;
    for (const t of due) {
      // eslint-disable-next-line no-await-in-loop
      const { created } = await jobs.enqueueJob({
        userId: t.userId, jobType: PUBLISH_JOB_TYPES.PUBLISH_TARGET,
        idempotencyKey: `publish:${t.scheduledPostId}:target:${t.targetId}:a${t.attemptCount}`,
        payload: { targetId: t.targetId, postId: t.scheduledPostId },
      });
      if (created) enqueued += 1;
    }
    return { due: due.length, enqueued };
  }

  /**
   * E (Publish Now): enqueue durable publish jobs for one owned post's targets
   * immediately. Unlike the scheduler bridge this does NOT gate on the live flag
   * — a job is created per target and the job handler itself holds the target as
   * "attention needed" (zero provider calls) when live publishing is off, so the
   * user gets an honest queued state either way. Idempotent: the same target
   * enqueued twice reuses one job (unique idempotency key).
   */
  async function enqueuePublishForPost(userId, postId) {
    const targets = await publishRepo.listPublishTargetsForPost(postId, userId);
    let enqueued = 0;
    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      const { created } = await jobs.enqueueJob({
        userId, jobType: PUBLISH_JOB_TYPES.PUBLISH_TARGET,
        idempotencyKey: `publish:${t.scheduledPostId}:target:${t.targetId}:a${t.attemptCount}`,
        payload: { targetId: t.targetId, postId: t.scheduledPostId },
      });
      if (created) enqueued += 1;
    }
    return { targets: targets.length, enqueued };
  }

  // --- user actions ---------------------------------------------------------

  /** Manually retry a failed/attention target: bump the generation, re-schedule. */
  async function retryTarget(userId, targetId) {
    const ok = await publishRepo.retryTargetForPublish(targetId, userId);
    return { ok };
  }

  async function cancelTarget(userId, targetId) {
    const target = await publishRepo.findTargetForPublish(targetId, userId);
    if (!target) return { ok: false };
    if (target.publishStatus === PUBLISH_STATUS.PUBLISHED) return { ok: false, reason: 'A published target cannot be cancelled.' };
    await publishRepo.updateTargetPublishState(targetId, userId, { publishStatus: PUBLISH_STATUS.CANCELLED, attentionReason: null });
    await publishRepo.rollupPostStatus(target.scheduledPostId, userId).catch(() => {});
    return { ok: true };
  }

  async function listAttempts(userId, targetId) {
    return publishRepo.listAttemptsForTarget(targetId, userId, { limit: 20 });
  }

  // --- helpers --------------------------------------------------------------

  async function markTargetPublished(target, providerPostId, attemptId) {
    await publishRepo.updateTargetPublishState(target.targetId, target.userId, {
      publishStatus: PUBLISH_STATUS.PUBLISHED, status: 'published', remotePostId: providerPostId,
      remotePostUrl: providerPostUrl(target.platform, providerPostId), publishedAt: now(),
      lastPublishAttemptId: attemptId, attentionReason: null, lastErrorCode: null, lastErrorMessage: null,
    });
    await publishRepo.rollupPostStatus(target.scheduledPostId, target.userId).catch(() => {});
    await record(EVENT_TYPES.PUBLISH_TARGET_PUBLISHED, { userId: target.userId, target, message: 'Published' });
  }

  async function markTargetFailed(target, category, reason) {
    await publishRepo.updateTargetPublishState(target.targetId, target.userId, {
      publishStatus: PUBLISH_STATUS.FAILED, status: 'failed',
      lastErrorCode: category ?? null, lastErrorMessage: reason ?? safeMessageFor(category),
      attentionReason: reason ?? safeMessageFor(category),
    });
    await publishRepo.rollupPostStatus(target.scheduledPostId, target.userId).catch(() => {});
    await record(EVENT_TYPES.PUBLISH_TARGET_FAILED, { userId: target.userId, target, level: 'warn', message: reason ?? 'Publish failed' });
  }

  async function markTargetAttention(target, category, reason) {
    await publishRepo.updateTargetPublishState(target.targetId, target.userId, {
      publishStatus: PUBLISH_STATUS.ATTENTION_NEEDED, attentionReason: reason ?? safeMessageFor(category),
      lastErrorCode: category ?? null, lastErrorMessage: reason ?? null,
    });
    await publishRepo.rollupPostStatus(target.scheduledPostId, target.userId).catch(() => {});
  }

  function providerPostUrl(platform, providerPostId) {
    if (!providerPostId) return null;
    if (platform === 'facebook') return `https://www.facebook.com/${providerPostId}`;
    if (platform === 'threads') return `https://www.threads.net/`;
    if (platform === 'instagram') return `https://www.instagram.com/`;
    return null;
  }

  async function recordUsage() { /* api_usage metering hook; provider call happened */ }

  async function record(eventType, { userId, target, level = 'info', message = null } = {}) {
    await logging.record(eventType, {
      userId, level, message,
      context: { scheduledPostId: target?.scheduledPostId, targetId: target?.targetId, platform: target?.platform },
    }).catch(() => {});
  }

  const handlers = {
    [PUBLISH_JOB_TYPES.PUBLISH_TARGET]: runPublishTargetJob,
    [PUBLISH_JOB_TYPES.RECONCILE_ATTEMPT]: runReconcileJob,
    [PUBLISH_JOB_TYPES.PUBLISH_STALE_RECOVERY]: runPublishStaleRecoveryJob,
  };

  return {
    handlers, preflight, enqueueDuePublishTargets, enqueuePublishForPost,
    runPublishTargetJob, runReconcileJob, runPublishStaleRecoveryJob,
    retryTarget, cancelTarget, listAttempts,
    liveEnabled,
  };
}

const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads' };
function label(platform) { return PLATFORM_LABELS[platform] || platform; }

export default { createPublishingService };
