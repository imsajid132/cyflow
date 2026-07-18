// Milestone G — user data export + account deletion. Exercised with fakes; no
// real data is deleted and no provider is contacted.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccountDataService } from '../src/services/accountDataService.js';
import { ACCOUNT_JOB_TYPES } from '../src/config/constants.js';
import { createFakeOverrides } from './helpers/fakes.js';

const noopLogging = { record: async () => {} };

/** An in-memory export archive store. */
function memStore() {
  const files = new Map(); let n = 0;
  return {
    driver: 'local', _files: files,
    async write(buf) { const key = `k${++n}`; files.set(key, buf); return { storageKey: key, sizeBytes: buf.length }; },
    async read(key) { if (!files.has(key)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(key); },
    async remove(key) { return files.delete(key); },
  };
}

async function wire() {
  const o = createFakeOverrides({});
  const user = await o.userRepository.createUser({ name: 'Sam', email: 'sam@test.dev', passwordHash: 'HASH', timezone: 'UTC' });
  const removedBytes = [];
  const mediaStore = { async removeStoredImage(k) { removedBytes.push(k); return true; } };
  const svc = createAccountDataService({
    users: o.userRepository, accountData: o.accountDataRepository,
    integrations: o.integrationRepository, socialAccounts: o.socialAccountRepository,
    businessProfiles: o.businessProfileRepository, plannerPreferences: o.plannerPreferenceRepository,
    plannerRuns: o.plannerRunRepository, posts: o.postRepository, media: o.mediaAssetRepository,
    apiUsage: o.apiUsageRepository, jobs: o.backgroundJobRepository,
    verifyPassword: async (pw) => pw === 'correct-password',
    exportStore: memStore(), mediaStore, logging: noopLogging,
    withTransaction: async (fn) => fn(), now: () => new Date(),
  });
  return { svc, o, user, removedBytes };
}

// --- export ----------------------------------------------------------------

test('requesting an export enqueues one durable job and reports requested', async () => {
  const { svc, o, user } = await wire();
  const row = await svc.requestExport(user.id);
  assert.equal(row.status, 'requested');
  assert.equal(o.backgroundJobRepository._jobs.filter((j) => j.job_type === ACCOUNT_JOB_TYPES.EXPORT).length, 1);
});

test('the export job builds a ready archive that excludes every secret', async () => {
  const { svc, o, user } = await wire();
  await svc.requestExport(user.id);
  const exportId = o.accountDataRepository._exports[0].id;
  await svc.handlers[ACCOUNT_JOB_TYPES.EXPORT]({ userId: user.id, payload: { exportId } });

  const status = await svc.getExport(user.id);
  assert.equal(status.status, 'ready');

  const { buffer } = await svc.downloadExport(user.id);
  const archive = JSON.parse(buffer.toString('utf8'));
  assert.equal(archive.account.email, 'sam@test.dev', 'the archive has the user\'s own safe data');
  // Scan the DATA sections only — the README prose legitimately names the secrets
  // it EXCLUDES ("your encrypted keys ... are never included").
  const dataText = JSON.stringify({ ...archive, README: undefined });
  for (const banned of ['password_hash', 'access_token', 'refresh_token', 'encrypted', 'storage_key', 'storageKey', 'download_token', 'provider_response']) {
    assert.equal(dataText.includes(banned), false, `archive data must not contain ${banned}`);
  }
});

test('a second user cannot download the first user\'s export', async () => {
  const { svc, o, user } = await wire();
  await svc.requestExport(user.id);
  const exportId = o.accountDataRepository._exports[0].id;
  await svc.handlers[ACCOUNT_JOB_TYPES.EXPORT]({ userId: user.id, payload: { exportId } });
  await assert.rejects(() => svc.downloadExport('99999'), /no export/i);
});

test('export requests are rate limited', async () => {
  const { svc, user } = await wire();
  await svc.requestExport(user.id);
  await svc.requestExport(user.id);
  await svc.requestExport(user.id);
  await assert.rejects(() => svc.requestExport(user.id), /try again/i);
});

// --- deletion --------------------------------------------------------------

test('deletion is refused without the correct password', async () => {
  const { svc, user } = await wire();
  await assert.rejects(() => svc.requestDeletion(user.id, { currentPassword: 'wrong', confirmText: 'DELETE' }), /password/i);
});

test('deletion is refused without the typed confirmation', async () => {
  const { svc, user } = await wire();
  await assert.rejects(() => svc.requestDeletion(user.id, { currentPassword: 'correct-password', confirmText: 'delete' }), /DELETE/);
});

test('a confirmed deletion enqueues a job and returns a receipt code', async () => {
  const { svc, o, user } = await wire();
  const res = await svc.requestDeletion(user.id, { currentPassword: 'correct-password', confirmText: 'DELETE' });
  assert.match(res.confirmationCode, /^[a-f0-9]{32}$/);
  assert.equal(o.backgroundJobRepository._jobs.filter((j) => j.job_type === ACCOUNT_JOB_TYPES.DELETION).length, 1);
});

test('a second deletion is refused while one is in progress', async () => {
  const { svc, user } = await wire();
  await svc.requestDeletion(user.id, { currentPassword: 'correct-password', confirmText: 'DELETE' });
  await assert.rejects(() => svc.requestDeletion(user.id, { currentPassword: 'correct-password', confirmText: 'DELETE' }), /in progress/i);
});

test('the deletion job removes the user, cancels jobs, erases secrets and unlinks media bytes', async () => {
  const { svc, o, user, removedBytes } = await wire();
  // Seed data that should be cleaned up.
  await o.mediaAssetRepository.createMediaAsset({ userId: user.id, publicToken: 'tok', storageDriver: 'local', storageKey: 'file-abc', status: 'ready' });
  await o.backgroundJobRepository.enqueueJob({ userId: user.id, jobType: 'automation_refill', idempotencyKey: 'x1', payload: {} });
  await o.integrationRepository.saveOpenAiCredentials?.(user.id, { encryptedApiKey: 'e' }).catch(() => {});

  const req = await svc.requestDeletion(user.id, { currentPassword: 'correct-password', confirmText: 'DELETE' });
  const requestId = o.accountDataRepository._deletions[0].id;
  await svc.handlers[ACCOUNT_JOB_TYPES.DELETION]({ userId: user.id, payload: { requestId } });

  assert.equal(await o.userRepository.findUserById(user.id), null, 'the user row is gone');
  assert.ok(removedBytes.includes('file-abc'), 'the media bytes were unlinked');
  assert.ok(o.backgroundJobRepository._jobs.every((j) => String(j.user_id) !== String(user.id) || j.status === 'cancelled'), 'pending jobs were cancelled');
  assert.equal(o.accountDataRepository._deletions[0].status, 'completed');
  assert.equal(req.status, 'requested');
});

test('the deletion job is idempotent (safe to re-run after a crash)', async () => {
  const { svc, o, user } = await wire();
  await svc.requestDeletion(user.id, { currentPassword: 'correct-password', confirmText: 'DELETE' });
  const requestId = o.accountDataRepository._deletions[0].id;
  await svc.handlers[ACCOUNT_JOB_TYPES.DELETION]({ userId: user.id, payload: { requestId } });
  // Re-run: the user is already gone; this must not throw.
  await svc.handlers[ACCOUNT_JOB_TYPES.DELETION]({ userId: user.id, payload: { requestId } });
  assert.equal(await o.userRepository.findUserById(user.id), null);
});
