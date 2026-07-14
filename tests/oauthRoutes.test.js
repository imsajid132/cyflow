import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { decryptSecret } from '../src/services/encryptionService.js';
import { createFakeOverrides } from './helpers/fakes.js';
import { registerUser } from './helpers/apiHarness.js';

function buildApp(extra = {}) {
  const overrides = createFakeOverrides(extra);
  return { app: createApp(overrides), overrides };
}

function stateFromAuthUrl(url) {
  return new URL(url).searchParams.get('state');
}

async function startAndCallback(agent, csrf, provider, extraQuery = '') {
  const start = await agent.post(`/api/oauth/${provider}/start`).set('X-CSRF-Token', csrf).send({});
  const state = stateFromAuthUrl(start.body.data.authorizationUrl);
  const cb = await agent
    .get(`/api/oauth/${provider}/callback?code=AUTHCODE123&state=${encodeURIComponent(state)}${extraQuery}`)
    .redirects(0);
  return { start, state, cb };
}

test('GET /api/oauth/providers returns availability only', async () => {
  const { app } = buildApp();
  const { agent } = await registerUser(app);
  const res = await agent.get('/api/oauth/providers');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.providers, { meta: true, instagram: true, threads: true });
  // No secrets/client ids leaked.
  assert.equal(JSON.stringify(res.body).includes('app-id'), false);
});

test('start requires CSRF and rejects unknown provider', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);

  const noCsrf = await agent.post('/api/oauth/meta/start').send({});
  assert.equal(noCsrf.status, 403);

  const unknown = await agent.post('/api/oauth/tiktok/start').set('X-CSRF-Token', csrf).send({});
  assert.equal(unknown.status, 404);

  const ok = await agent.post('/api/oauth/meta/start').set('X-CSRF-Token', csrf).send({});
  assert.equal(ok.status, 200);
  assert.match(ok.body.data.authorizationUrl, /^https:\/\/provider\.example\/meta\/authorize/);
});

test('Facebook callback connects multiple Pages; tokens encrypted, none leaked', async () => {
  const { app, overrides } = buildApp();
  const { agent, csrf } = await registerUser(app);

  const { cb } = await startAndCallback(agent, csrf, 'meta');
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.location, '/dashboard?oauth=success&provider=meta');
  // Redirect carries no code/state/token.
  assert.equal(cb.headers.location.includes('AUTHCODE123'), false);
  assert.equal(cb.headers.location.includes('state='), false);

  const list = await agent.get('/api/social-accounts');
  assert.equal(list.body.data.accounts.length, 2);
  assert.equal(JSON.stringify(list.body).includes('PLAINTEXT-token'), false);

  // Stored tokens are encrypted (v1 envelope) and decrypt back to plaintext.
  const rows = overrides.socialAccountRepository._rows;
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.match(r.access_token_encrypted, /^v1:/);
    assert.match(decryptSecret(r.access_token_encrypted), /^PLAINTEXT-token-meta/);
  }
});

test('Instagram and Threads callbacks connect one account each', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);

  const ig = await startAndCallback(agent, csrf, 'instagram');
  assert.equal(ig.cb.headers.location, '/dashboard?oauth=success&provider=instagram');

  const th = await startAndCallback(agent, csrf, 'threads');
  assert.equal(th.cb.headers.location, '/dashboard?oauth=success&provider=threads');

  const list = await agent.get('/api/social-accounts');
  const providers = list.body.data.accounts.map((a) => a.provider).sort();
  assert.deepEqual(providers, ['instagram', 'threads']);
});

test('callback denial redirects with permission_denied and no tokens', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);
  const { cb } = await startAndCallback(agent, csrf, 'meta', '&error=access_denied&error_description=User+denied');
  assert.equal(cb.status, 302);
  assert.match(cb.headers.location, /oauth=error/);
  assert.match(cb.headers.location, /code=permission_denied/);

  const list = await agent.get('/api/social-accounts');
  assert.equal(list.body.data.accounts.length, 0);
});

test('callback replay is rejected (state consumed once)', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);
  const { state } = await startAndCallback(agent, csrf, 'meta');

  // Replay the SAME state again.
  const replay = await agent
    .get(`/api/oauth/meta/callback?code=AUTHCODE123&state=${encodeURIComponent(state)}`)
    .redirects(0);
  assert.equal(replay.status, 302);
  assert.match(replay.headers.location, /oauth=error/);
  assert.match(replay.headers.location, /code=invalid_state/);
});

test('OAuth routes require authentication', async () => {
  const { app } = buildApp();
  assert.equal((await request(app).get('/api/oauth/providers')).status, 401);
  assert.equal((await request(app).get('/api/oauth/meta/callback?code=x&state=y')).status, 401);
});
