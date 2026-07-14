import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { createFakeOverrides } from './helpers/fakes.js';
import { registerUser, getCsrf, defaultCreds } from './helpers/apiHarness.js';

function buildApp(extra = {}) {
  const overrides = createFakeOverrides(extra);
  return { app: createApp(overrides), overrides };
}

async function start(agent, csrf, provider = 'meta') {
  const res = await agent.post(`/api/oauth/${provider}/start`).set('X-CSRF-Token', csrf).send({});
  return new URL(res.body.data.authorizationUrl).searchParams.get('state');
}

test('callback without a session is rejected (401)', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/api/oauth/meta/callback?code=x&state=y').redirects(0);
  assert.equal(res.status, 401);
});

test('callback with missing state is rejected as invalid_state', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);
  await start(agent, csrf, 'meta');
  const res = await agent.get('/api/oauth/meta/callback?code=abc').redirects(0);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /code=invalid_state/);
});

test('callback with an unknown/forged state is rejected', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);
  await start(agent, csrf, 'meta');
  const res = await agent.get('/api/oauth/meta/callback?code=abc&state=forged-not-real').redirects(0);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /code=invalid_state/);
});

test('callback with a redirect-URI mismatch on the stored state is rejected', async () => {
  const { app, overrides } = buildApp();
  const { agent, csrf } = await registerUser(app);
  const state = await start(agent, csrf, 'meta');
  // Tamper the stored redirect URI so it no longer matches the provider config.
  overrides.oauthStateRepository._rows[0].redirect_uri = 'https://evil.example/callback';
  const res = await agent.get(`/api/oauth/meta/callback?code=abc&state=${encodeURIComponent(state)}`).redirects(0);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /code=invalid_state/);
});

test('cross-user state is rejected (state belongs to another user)', async () => {
  const { app } = buildApp();
  const a = await registerUser(app, defaultCreds({ email: 'a@example.com' }));
  const stateA = await start(a.agent, a.csrf, 'meta');

  const b = await registerUser(app, defaultCreds({ email: 'b@example.com', name: 'Bob' }));
  const res = await b.agent
    .get(`/api/oauth/meta/callback?code=abc&state=${encodeURIComponent(stateA)}`)
    .redirects(0);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /code=invalid_state/);
});

test('provider denial invalidates the state (cannot be replayed)', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);
  const state = await start(agent, csrf, 'meta');

  const denied = await agent
    .get(`/api/oauth/meta/callback?state=${encodeURIComponent(state)}&error=access_denied`)
    .redirects(0);
  assert.match(denied.headers.location, /code=permission_denied/);

  // The state is now consumed — a follow-up with the same state fails.
  const replay = await agent
    .get(`/api/oauth/meta/callback?code=abc&state=${encodeURIComponent(state)}`)
    .redirects(0);
  assert.match(replay.headers.location, /code=invalid_state/);
});

test('authorization code and raw state never appear in activity logs', async () => {
  const { app, overrides } = buildApp();
  const { agent, csrf } = await registerUser(app);
  const state = await start(agent, csrf, 'meta');
  await agent.get(`/api/oauth/meta/callback?code=SUPERSECRETCODE&state=${encodeURIComponent(state)}`).redirects(0);

  const blob = JSON.stringify(overrides.logRepository._entries);
  assert.equal(blob.includes('SUPERSECRETCODE'), false);
  assert.equal(blob.includes(state), false);
  assert.equal(blob.includes('PLAINTEXT-token'), false);
  // But useful, safe events were recorded.
  assert.ok(overrides.logRepository._entries.some((e) => e.eventType === 'oauth.completed'));
});
