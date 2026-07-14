import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { decryptSecret } from '../src/services/encryptionService.js';
import {
  createFakeOverrides,
  createFakeSocialAccountRepository,
  createFakeProviderRegistry,
  createFakeProvider,
} from './helpers/fakes.js';
import { registerUser, defaultCreds } from './helpers/apiHarness.js';

function buildApp(extra = {}) {
  const overrides = createFakeOverrides(extra);
  return { app: createApp(overrides), overrides };
}

async function connectMeta(agent, csrf) {
  const start = await agent.post('/api/oauth/meta/start').set('X-CSRF-Token', csrf).send({});
  const state = new URL(start.body.data.authorizationUrl).searchParams.get('state');
  await agent.get(`/api/oauth/meta/callback?code=CODE&state=${encodeURIComponent(state)}`).redirects(0);
  const list = await agent.get('/api/social-accounts');
  return list.body.data.accounts;
}

test('GET /api/social-accounts is sanitized (no tokens/ciphertext)', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);
  const accounts = await connectMeta(agent, csrf);
  assert.equal(accounts.length, 2);
  const blob = JSON.stringify(accounts);
  assert.equal(blob.includes('PLAINTEXT-token'), false);
  assert.equal(blob.includes('v1:'), false);
  assert.equal(blob.includes('access_token'), false);
  // Shape check.
  assert.deepEqual(
    Object.keys(accounts[0]).sort(),
    ['accountType', 'createdAt', 'displayName', 'id', 'lastVerifiedAt', 'provider', 'providerAccountId', 'status', 'tokenExpiresAt', 'username'],
  );
});

test('verify account updates last_verified_at and requires CSRF', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);
  const accounts = await connectMeta(agent, csrf);
  const id = accounts[0].id;

  const noCsrf = await agent.post(`/api/social-accounts/${id}/verify`).send({});
  assert.equal(noCsrf.status, 403);

  const res = await agent.post(`/api/social-accounts/${id}/verify`).set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.data.verified, true);
  assert.equal(res.body.data.account.displayName, 'Verified Name');
  assert.ok(res.body.data.account.lastVerifiedAt);
});

test('verify refreshes an Instagram token near expiry, then re-encrypts', async () => {
  const registry = createFakeProviderRegistry({
    meta: createFakeProvider('meta'),
    instagram: createFakeProvider('instagram', {
      refresh: async () => ({ accessToken: 'REFRESHED-IG', expiresIn: 5184000 }),
    }),
    threads: createFakeProvider('threads'),
  });
  const { app, overrides } = buildApp({ providerRegistry: registry });
  const { agent, csrf } = await registerUser(app);

  // Connect Instagram.
  const start = await agent.post('/api/oauth/instagram/start').set('X-CSRF-Token', csrf).send({});
  const state = new URL(start.body.data.authorizationUrl).searchParams.get('state');
  await agent.get(`/api/oauth/instagram/callback?code=C&state=${encodeURIComponent(state)}`).redirects(0);

  // Force the stored token to be within the refresh leeway.
  const row = overrides.socialAccountRepository._rows[0];
  row.token_expires_at = new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' ');

  const list = await agent.get('/api/social-accounts');
  const id = list.body.data.accounts[0].id;
  const res = await agent.post(`/api/social-accounts/${id}/verify`).set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.data.verified, true);
  // Token was refreshed + re-encrypted.
  assert.equal(decryptSecret(overrides.socialAccountRepository._rows[0].access_token_encrypted), 'REFRESHED-IG');
});

test('disconnect requires confirmation and enforces ownership', async () => {
  const { app, overrides } = buildApp();
  const { agent, csrf } = await registerUser(app, defaultCreds({ email: 'owner@example.com' }));
  const accounts = await connectMeta(agent, csrf);
  const id = accounts[0].id;

  // Wrong confirmation -> 400.
  const bad = await agent.delete(`/api/social-accounts/${id}`).set('X-CSRF-Token', csrf).send({ confirm: 'disconnect' });
  assert.equal(bad.status, 400);

  // Another user cannot disconnect this account.
  const other = await registerUser(app, defaultCreds({ email: 'intruder@example.com', name: 'Eve' }));
  const cross = await other.agent
    .delete(`/api/social-accounts/${id}`)
    .set('X-CSRF-Token', other.csrf)
    .send({ confirm: 'DISCONNECT' });
  assert.equal(cross.status, 404);

  // Owner disconnects -> deleted locally (no history), other account untouched.
  const ok = await agent.delete(`/api/social-accounts/${id}`).set('X-CSRF-Token', csrf).send({ confirm: 'DISCONNECT' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.preserved, false);
  const remaining = overrides.socialAccountRepository._rows;
  assert.equal(remaining.length, 1); // the other page remains
});

test('disconnect preserves audit history: revokes + erases tokens instead of deleting', async () => {
  const { app, overrides } = buildApp({
    socialAccountRepository: createFakeSocialAccountRepository({ publishedHistory: true }),
  });
  const { agent, csrf } = await registerUser(app);
  const accounts = await connectMeta(agent, csrf);
  const id = accounts[0].id;

  const res = await agent.delete(`/api/social-accounts/${id}`).set('X-CSRF-Token', csrf).send({ confirm: 'DISCONNECT' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.preserved, true);

  const row = overrides.socialAccountRepository._rows.find((r) => String(r.id) === String(id));
  assert.ok(row, 'row is preserved for history');
  assert.equal(row.status, 'revoked');
  assert.equal(row.access_token_encrypted, null); // tokens erased
});

test('social-account routes reject disabled users and anonymous access', async () => {
  const { app, overrides } = buildApp();
  const { agent } = await registerUser(app);
  overrides.userRepository._rows[0].status = 'disabled';
  assert.equal((await agent.get('/api/social-accounts')).status, 401);
  assert.equal((await request(app).get('/api/social-accounts')).status, 401);
});
