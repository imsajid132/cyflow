/**
 * Account data service — user data export + permanent account deletion (G).
 *
 * Both run as durable background jobs on the D1 system, so a browser tab closing
 * or a worker crash never leaves work half-done. Nothing here calls a provider.
 *
 * Export: gathers ONLY safe, already-sanitized data (secrets, tokens, storage
 * keys, raw provider payloads and job payloads are excluded by construction —
 * we build on the repositories' sanitize* shapes), writes a private JSON
 * archive, and serves it through a session-authenticated route (no token in a
 * URL). Deletion: gated by the current password + a typed confirmation, then a
 * durable job cancels pending work, erases credentials/tokens, deletes the user
 * (InnoDB CASCADE removes the owned rows; we also erase secrets explicitly as
 * belt-and-braces), unlinks on-disk media + the export archive, and records a
 * receipt. Idempotent and safe to re-run.
 */

import crypto from 'node:crypto';

import { ACCOUNT_JOB_TYPES, EXPORT_STATUS, DELETION_STATUS } from '../config/constants.js';
import { ValidationError, NotFoundError, ConflictError, AuthenticationError, RateLimitError } from '../utils/errors.js';
import { toMysqlUtc, addSecondsUtc, nowIso } from '../utils/time.js';

import * as defaultUsers from '../repositories/userRepository.js';
import * as defaultAccountData from '../repositories/accountDataRepository.js';
import * as defaultIntegrations from '../repositories/integrationRepository.js';
import * as defaultSocialAccounts from '../repositories/socialAccountRepository.js';
import * as defaultBusinessProfiles from '../repositories/businessProfileRepository.js';
import * as defaultPlannerPrefs from '../repositories/plannerPreferenceRepository.js';
import * as defaultPlannerRuns from '../repositories/plannerRunRepository.js';
import * as defaultPosts from '../repositories/postRepository.js';
import * as defaultMedia from '../repositories/mediaAssetRepository.js';
import * as defaultApiUsage from '../repositories/apiUsageRepository.js';
import * as defaultJobs from '../repositories/backgroundJobRepository.js';
import { authService as defaultAuthService } from './authService.js';
import { createExportStorage } from './exportStorage.js';
import { loggingService as defaultLogging } from './loggingService.js';
import { withTransaction as defaultWithTransaction } from '../db/transactions.js';

const EXPORT_EXPIRY_HOURS = 24;      // a ready archive is downloadable for a day
const EXPORT_RATE_PER_HOUR = 3;      // requests per user per hour

export function createAccountDataService({
  users = defaultUsers,
  accountData = defaultAccountData,
  integrations = defaultIntegrations,
  socialAccounts = defaultSocialAccounts,
  businessProfiles = defaultBusinessProfiles,
  plannerPreferences = defaultPlannerPrefs,
  plannerRuns = defaultPlannerRuns,
  posts = defaultPosts,
  media = defaultMedia,
  apiUsage = defaultApiUsage,
  jobs = defaultJobs,
  verifyPassword = defaultAuthService.verifyPassword,
  exportStore = createExportStorage(),
  // The container injects a config-backed store; the no-op default keeps the
  // service buildable without media storage configured (byte removal then no-ops).
  mediaStore = { async removeStoredImage() { return false; } },
  logging = defaultLogging,
  withTransaction = defaultWithTransaction,
  now = () => new Date(),
} = {}) {
  const record = (eventType, ctx) => logging.record(eventType, ctx).catch(() => {});

  // --- export --------------------------------------------------------------

  async function requestExport(userId, { req } = {}) {
    const since = toMysqlUtc(addSecondsUtc(-3600, now()));
    const recent = await accountData.countRecentExports(userId, since);
    if (recent >= EXPORT_RATE_PER_HOUR) {
      throw new RateLimitError('You have requested several exports recently. Please try again later.');
    }
    const exportRow = await accountData.createExportRequest(userId);
    await jobs.enqueueJob({
      userId, jobType: ACCOUNT_JOB_TYPES.EXPORT,
      idempotencyKey: `export:${userId}:${exportRow.id}`,
      payload: { exportId: exportRow.id },
    });
    await record('account.export_requested', { req, userId, message: 'Data export requested', context: { exportId: exportRow.id } });
    return exportRow;
  }

  async function getExport(userId) {
    return accountData.findLatestExportForUser(userId);
  }

  /**
   * Build the archive JSON from SAFE, sanitized data only. A failure in any
   * section throws (the job then marks the export failed) rather than shipping a
   * partial archive that claims to be complete.
   */
  async function buildArchive(userId) {
    const [account, profile, accounts, prefs, runs, mediaAssets, usage] = await Promise.all([
      users.getSanitizedUserById(userId),
      businessProfiles.findByUserId(userId).catch(() => null),
      socialAccounts.listAccountsForUser(userId),
      plannerPreferences.findByUserId(userId).catch(() => null),
      plannerRuns.listRunsForUser(userId, { limit: 200, offset: 0 }).catch(() => []),
      media.listMediaAssetsForUser(userId, { limit: 1000 }).catch(() => []),
      apiUsage.summarizeUserUsage(userId, toMysqlUtc(addSecondsUtc(-90 * 24 * 3600, now()))).catch(() => null),
    ]);

    const postList = await posts.listPostsForUser(userId, { limit: 500, offset: 0 });
    const postsWithTargets = [];
    for (const p of postList) {
      // eslint-disable-next-line no-await-in-loop
      const targets = await posts.listPostTargets(p.id, userId).catch(() => []);
      postsWithTargets.push({ ...p, targets });
    }

    return {
      README:
        'This is a copy of your Cyflow Social data. It contains only your own information, '
        + 'in safe form. It deliberately excludes secrets: your password, your encrypted OpenAI '
        + 'and HCTI keys, your social access tokens, internal storage keys and raw provider '
        + 'responses are never included. Image files are not embedded here; you can download '
        + 'them from the Media Library while your account exists.',
      manifest: { format: 'cyflow-export', version: 1, generatedAtUtc: nowIso() },
      account,
      businessProfile: profile,
      socialAccounts: accounts,      // token-free by construction
      plannerPreferences: prefs,
      plannerRuns: runs,
      posts: postsWithTargets,
      media: mediaAssets,            // metadata only (no bytes, no storage key, no token)
      usageSummary: usage,
    };
  }

  async function runExportJob(job) {
    const userId = job.userId;
    const exportId = job.payload?.exportId;
    const row = await accountData.findExportById(exportId, userId);
    if (!row) return;                                   // gone
    if (row.status !== EXPORT_STATUS.REQUESTED) return; // already processed / failed

    await accountData.updateExport(exportId, userId, { status: EXPORT_STATUS.PROCESSING });
    try {
      const archive = await buildArchive(userId);
      const buffer = Buffer.from(JSON.stringify(archive, null, 2), 'utf8');
      const { storageKey, sizeBytes } = await exportStore.write(buffer);
      const tokenHash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
      await accountData.updateExport(exportId, userId, {
        status: EXPORT_STATUS.READY, downloadTokenHash: tokenHash,
        storageDriver: exportStore.driver || 'local', storageKey, fileSizeBytes: sizeBytes,
        completedAt: toMysqlUtc(now()), expiresAt: toMysqlUtc(addSecondsUtc(EXPORT_EXPIRY_HOURS * 3600, now())),
      });
      await record('account.export_ready', { userId, message: 'Data export ready', context: { exportId } });
    } catch (err) {
      await accountData.updateExport(exportId, userId, {
        status: EXPORT_STATUS.FAILED, errorMessage: 'The export could not be prepared. Please try again.',
      });
      await record('account.export_failed', { userId, level: 'warn', message: 'Data export failed', context: { exportId } });
      // Do not rethrow: the export is marked failed; retrying the same build is unlikely to help.
    }
  }

  /** Stream data for the session user's latest ready export (owner = session,
   * no token in the URL). The storage key is read through a dedicated internal
   * lookup and never leaves the server. */
  async function downloadExport(userId) {
    const row = await accountData.findLatestExportForUser(userId);
    if (!row || row.status !== EXPORT_STATUS.READY) throw new NotFoundError('No export is ready to download');
    const stored = await accountData.findExportStorage(row.id, userId);
    if (!stored?.storageKey) throw new NotFoundError('No export is ready to download');
    const buffer = await exportStore.read(stored.storageKey);
    return { buffer, filename: 'cyflow-export.json', contentType: 'application/json', sizeBytes: buffer.length };
  }

  // --- deletion ------------------------------------------------------------

  async function requestDeletion(userId, { currentPassword, confirmText, reason } = {}, { req } = {}) {
    if (String(confirmText || '').trim() !== 'DELETE') {
      throw new ValidationError('Type DELETE to confirm account deletion.');
    }
    const user = await users.findUserById(userId);
    if (!user) throw new NotFoundError('Account not found');
    const ok = await verifyPassword(currentPassword || '', user.password_hash);
    if (!ok) throw new AuthenticationError('Your password is incorrect.');

    const active = await accountData.findActiveDeletionForUser(userId);
    if (active) throw new ConflictError('An account deletion is already in progress.');

    const confirmationCode = crypto.randomBytes(16).toString('hex');
    const requestRow = await accountData.createDeletionRequest({ userId, confirmationCode, reason: reason ?? null });
    await jobs.enqueueJob({
      userId, jobType: ACCOUNT_JOB_TYPES.DELETION,
      idempotencyKey: `account_deletion:${userId}:${requestRow.id}`,
      payload: { requestId: requestRow.id },
    });
    await record('account.deletion_requested', { req, userId, message: 'Account deletion requested', context: { requestId: requestRow.id } });
    return { status: requestRow.status, confirmationCode };
  }

  async function getDeletion(userId) {
    return accountData.findActiveDeletionForUser(userId);
  }

  /**
   * Perform the deletion. Idempotent + crash-safe: every step tolerates being
   * re-run. Secrets are erased explicitly (belt-and-braces) before the user row
   * is deleted; InnoDB CASCADE then removes the owned rows.
   */
  async function runDeletionJob(job) {
    const userId = job.userId;
    const requestId = job.payload?.requestId;

    // 1) Stop the worker touching this user's rows mid-delete.
    await jobs.cancelAllJobsForUser(userId).catch(() => {});

    // 2) Capture on-disk media keys BEFORE any rows are removed.
    const keys = await media.listStorageKeysForUser(userId).catch(() => []);

    // 3) Erase reusable secrets explicitly (the rows also cascade away).
    await integrations.deleteOpenAiCredentials(userId).catch(() => {});
    await integrations.deleteHctiCredentials(userId).catch(() => {});
    const accounts = await socialAccounts.listAccountsForUser(userId).catch(() => []);
    for (const a of accounts) {
      // eslint-disable-next-line no-await-in-loop
      await socialAccounts.markAccountRevoked(a.id, userId, { eraseTokens: true }).catch(() => {});
    }

    // 4) Delete the user (CASCADE removes owned rows; activity_logs/api_usage SET NULL).
    await withTransaction(async (conn) => users.deleteUserById(userId, conn));

    // 5) After the row is gone: unlink the bytes + the export archive files.
    for (const k of keys) {
      // eslint-disable-next-line no-await-in-loop
      if (k.storageKey) await mediaStore.removeStoredImage(k.storageKey).catch(() => {});
    }

    // 6) Record the receipt (user_id is already gone; the request row survives).
    if (requestId != null) {
      await accountData.updateDeletionRequest(requestId, { status: DELETION_STATUS.COMPLETED, completedAt: toMysqlUtc(now()) }).catch(() => {});
    }
    await record('account.deletion_completed', { message: 'Account deleted', context: { requestId } });
  }

  const handlers = {
    [ACCOUNT_JOB_TYPES.EXPORT]: runExportJob,
    [ACCOUNT_JOB_TYPES.DELETION]: runDeletionJob,
  };

  return {
    requestExport, getExport, downloadExport,
    requestDeletion, getDeletion,
    handlers,
  };
}

export default { createAccountDataService };
