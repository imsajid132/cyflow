import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { createThreadsCallbackService } from '../src/services/threadsCallbackService.js';
import { createLoggingService } from '../src/services/loggingService.js';
import {
  createFakeOverrides,
  createFakeSocialAccountRepository,
  createFakeDataDeletionRepository,
  createFakeLogRepository,
} from './helpers/fakes.js';

const SECRET = 'test-threads-app-secret';
const BASE = 'https://cyflow.cyfrow.net';

function makeSignedRequest(payload, secret = SECRET) {
  const encodedPayload = Buffer.from(
    JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: 1730000000, ...payload }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${sig}.${encodedPayload}`;
}

function seedThreadsAccount(socialAccounts, providerUserId, userId = '5') {
  return socialAccounts.upsertSocialAccount({
    userId,
    provider: 'threads',
    accountType: 'threads_profile',
    providerUserId,
    providerAccountId: providerUserId,
    displayName: 'Threads User',
    username: 'threader',
    encryptedAccessToken: 'v1:ENCRYPTED_ACCESS',
    encryptedRefreshToken: 'v1:ENCRYPTED_REFRESH',
    scopes: ['threads_basic'],
    providerMetadata: {},
    status: 'active',
  });
}

function build({ publishedHistory = false } = {}) {
  const socialAccounts = createFakeSocialAccountRepository({ publishedHistory });
  const dataDeletion = createFakeDataDeletionRepository();
  const logRepo = createFakeLogRepository();
  const logging = createLoggingService({ logRepository: logRepo });
  const service = createThreadsCallbackService({
    socialAccounts,
    dataDeletion,
    logging,
    appSecret: SECRET,
    publicBaseUrl: BASE,
  });
  const app = createApp(createFakeOverrides({ threadsCallbackService: service }));
  return { app, socialAccounts, dataDeletion, logRepo };
}

// --- uninstall -------------------------------------------------------------

test('uninstall: valid signed_request removes the Threads connection', async () => {
  const { app, socialAccounts, logRepo } = build();
  await seedThreadsAccount(socialAccounts, 'TH_USER_1');
  assert.equal(socialAccounts._rows.length, 1);

  const sr = makeSignedRequest({ user_id: 'TH_USER_1' });
  const res = await request(app).post('/api/oauth/threads/uninstall').type('form').send({ signed_request: sr });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(socialAccounts._rows.length, 0); // deleted

  // Logs contain no user_id, tokens, or the signed request.
  const blob = JSON.stringify(logRepo._entries);
  assert.equal(blob.includes('TH_USER_1'), false);
  assert.equal(blob.includes('ENCRYPTED_ACCESS'), false);
  assert.equal(blob.includes(sr), false);
  assert.ok(logRepo._entries.some((e) => e.eventType === 'threads.uninstalled'));
});

test('uninstall: preserves audit history by revoking + erasing tokens', async () => {
  const { app, socialAccounts } = build({ publishedHistory: true });
  await seedThreadsAccount(socialAccounts, 'TH_USER_2');

  const sr = makeSignedRequest({ user_id: 'TH_USER_2' });
  const res = await request(app).post('/api/oauth/threads/uninstall').type('form').send({ signed_request: sr });
  assert.equal(res.status, 200);

  const row = socialAccounts._rows[0];
  assert.ok(row, 'row preserved for history');
  assert.equal(row.status, 'revoked');
  assert.equal(row.access_token_encrypted, null);
  assert.equal(row.refresh_token_encrypted, null);
});

test('uninstall: invalid signature is rejected (400), no removal', async () => {
  const { app, socialAccounts } = build();
  await seedThreadsAccount(socialAccounts, 'TH_USER_3');
  const forged = makeSignedRequest({ user_id: 'TH_USER_3' }, 'wrong-secret');
  const res = await request(app).post('/api/oauth/threads/uninstall').type('form').send({ signed_request: forged });
  assert.equal(res.status, 400);
  assert.equal(socialAccounts._rows.length, 1); // untouched
});

test('uninstall: missing signed_request is a validation error (400)', async () => {
  const { app } = build();
  const res = await request(app).post('/api/oauth/threads/uninstall').type('form').send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('uninstall: unknown user still acknowledges with 200 (nothing to remove)', async () => {
  const { app } = build();
  const sr = makeSignedRequest({ user_id: 'NOBODY' });
  const res = await request(app).post('/api/oauth/threads/uninstall').type('form').send({ signed_request: sr });
  assert.equal(res.status, 200);
});

// --- data deletion ---------------------------------------------------------

test('data-deletion: returns Meta url + confirmation_code and removes the account', async () => {
  const { app, socialAccounts, dataDeletion } = build();
  await seedThreadsAccount(socialAccounts, 'TH_USER_4');

  const sr = makeSignedRequest({ user_id: 'TH_USER_4' });
  const res = await request(app).post('/api/oauth/threads/data-deletion').type('form').send({ signed_request: sr });
  assert.equal(res.status, 200);

  const code = res.body.confirmation_code;
  assert.ok(code && /^[A-Za-z0-9_-]+$/.test(code));
  assert.equal(res.body.url, `${BASE}/api/oauth/threads/data-deletion/status/${code}`);

  // Account removed and a deletion receipt was stored.
  assert.equal(socialAccounts._rows.length, 0);
  assert.equal(dataDeletion._rows.length, 1);
  assert.equal(dataDeletion._rows[0].status, 'completed');

  // Response contains no tokens/secret/user_id.
  const blob = JSON.stringify(res.body);
  assert.equal(blob.includes('ENCRYPTED_ACCESS'), false);
  assert.equal(blob.includes('TH_USER_4'), false);
  assert.equal(blob.includes(SECRET), false);
});

test('data-deletion: invalid signature rejected (400)', async () => {
  const { app } = build();
  const forged = makeSignedRequest({ user_id: 'x' }, 'nope');
  const res = await request(app).post('/api/oauth/threads/data-deletion').type('form').send({ signed_request: forged });
  assert.equal(res.status, 400);
});

// --- deletion status -------------------------------------------------------

test('deletion status: reports completion without personal data', async () => {
  const { app, socialAccounts } = build();
  await seedThreadsAccount(socialAccounts, 'TH_USER_5');
  const sr = makeSignedRequest({ user_id: 'TH_USER_5' });
  const del = await request(app).post('/api/oauth/threads/data-deletion').type('form').send({ signed_request: sr });
  const code = del.body.confirmation_code;

  const status = await request(app).get(`/api/oauth/threads/data-deletion/status/${code}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.confirmationCode, code);
  assert.equal(status.body.status, 'completed');
  assert.ok(typeof status.body.message === 'string');
  // No personal data / provider id / tokens.
  const blob = JSON.stringify(status.body);
  assert.equal(blob.includes('TH_USER_5'), false);
  assert.equal(blob.includes('ENCRYPTED_ACCESS'), false);
});

test('deletion status: unknown or malformed code returns 404', async () => {
  const { app } = build();
  assert.equal((await request(app).get('/api/oauth/threads/data-deletion/status/UNKNOWNCODE123')).status, 404);
  assert.equal((await request(app).get('/api/oauth/threads/data-deletion/status/bad!code')).status, 404);
});

test('callbacks are public (no session required)', async () => {
  const { app } = build();
  // A fresh agent with no auth cookie can still call the webhook.
  const sr = makeSignedRequest({ user_id: 'ANY' });
  const res = await request(app).post('/api/oauth/threads/uninstall').type('form').send({ signed_request: sr });
  assert.equal(res.status, 200);
});
