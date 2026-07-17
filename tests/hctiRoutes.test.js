// Load a valid test env before importing the app.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { decryptSecret } from '../src/services/encryptionService.js';
import {
  createFakeOverrides,
  createFakeHctiService,
} from './helpers/fakes.js';
import { registerUser, getCsrf, defaultCreds } from './helpers/apiHarness.js';

const HCTI = { hctiUserId: 'my-hcti-user', hctiApiKey: 'my-hcti-secret-key' };

function buildApp(extra = {}) {
  const overrides = createFakeOverrides(extra);
  return { app: createApp(overrides), overrides };
}

test('GET /hcti: unconfigured status', async () => {
  const { app } = buildApp();
  const { agent } = await registerUser(app);
  const res = await agent.get('/api/integrations/hcti');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, {
    configured: false,
    verified: false,
    verifiedAt: null,
    maskedUserId: null,
  });
});

test('PUT /hcti: encrypts before save, never echoes values, clears verified', async () => {
  const { app, overrides } = buildApp();
  const { agent, csrf } = await registerUser(app);

  const res = await agent.put('/api/integrations/hcti').set('X-CSRF-Token', csrf).send(HCTI);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.configured, true);
  assert.equal(res.body.data.verified, false);

  // Response never echoes the plaintext values or ciphertext.
  const blob = JSON.stringify(res.body);
  assert.equal(blob.includes(HCTI.hctiUserId), false);
  assert.equal(blob.includes(HCTI.hctiApiKey), false);
  assert.equal(blob.includes('v1:'), false);
  assert.match(res.body.data.maskedUserId, /^••••/);

  // Stored values are encrypted (v1 envelope) — plaintext is NOT stored.
  const userRow = overrides.userRepository._rows[0];
  const stored = overrides.integrationRepository._map.get(userRow.id);
  assert.match(stored.encryptedUserId, /^v1:/);
  assert.match(stored.encryptedApiKey, /^v1:/);
  assert.notEqual(stored.encryptedApiKey, HCTI.hctiApiKey);
  assert.equal(decryptSecret(stored.encryptedApiKey), HCTI.hctiApiKey);
  assert.equal(stored.verifiedAt, null);
});

test('GET /hcti after save: configured, masked, no ciphertext', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/hcti').set('X-CSRF-Token', csrf).send(HCTI);

  const res = await agent.get('/api/integrations/hcti');
  assert.equal(res.body.data.configured, true);
  assert.equal(res.body.data.verified, false);
  assert.match(res.body.data.maskedUserId, /^••••/);
  const blob = JSON.stringify(res.body);
  assert.equal(blob.includes('v1:'), false);
  assert.equal(blob.includes(HCTI.hctiApiKey), false);
});

test('POST /hcti/test: decrypts and passes dynamic creds to the service, marks verified', async () => {
  const fakeHcti = createFakeHctiService({ success: true, imageId: 'img_ok', message: 'ok' });
  const { app } = buildApp({ hctiService: fakeHcti });
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/hcti').set('X-CSRF-Token', csrf).send(HCTI);

  const res = await agent.post('/api/integrations/hcti/test').set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.data.success, true);
  assert.equal(res.body.data.verified, true);
  // The test response carries verifiedAt so the card can show "Last verified"
  // without a reload — parity with the OpenAI card (C4).
  assert.ok(res.body.data.verifiedAt, 'a successful HCTI test returns verifiedAt');

  // The service received the DECRYPTED, dynamic credentials.
  assert.equal(fakeHcti._calls.length, 1);
  assert.deepEqual(fakeHcti._calls[0], {
    hctiUserId: HCTI.hctiUserId,
    hctiApiKey: HCTI.hctiApiKey,
  });

  // Status now reports verified.
  const status = await agent.get('/api/integrations/hcti');
  assert.equal(status.body.data.verified, true);
});

test('POST /hcti/test: failure leaves unverified with a safe message', async () => {
  const fakeHcti = createFakeHctiService({
    success: false,
    classification: 'invalid_credentials',
    message: 'The HCTI credentials were rejected.',
  });
  const { app } = buildApp({ hctiService: fakeHcti });
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/hcti').set('X-CSRF-Token', csrf).send(HCTI);

  const res = await agent.post('/api/integrations/hcti/test').set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.data.success, false);
  assert.equal(res.body.data.verified, false);
  assert.equal(res.body.data.message.includes(HCTI.hctiApiKey), false);

  const status = await agent.get('/api/integrations/hcti');
  assert.equal(status.body.data.verified, false);
  assert.equal(status.body.data.configured, true);
});

test('DELETE /hcti: requires exact confirmation and clears encrypted values', async () => {
  const { app, overrides } = buildApp();
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/hcti').set('X-CSRF-Token', csrf).send(HCTI);

  // Wrong confirmation -> 400.
  const bad = await agent
    .delete('/api/integrations/hcti')
    .set('X-CSRF-Token', csrf)
    .send({ confirm: 'delete' });
  assert.equal(bad.status, 400);

  // Correct confirmation -> cleared.
  const ok = await agent
    .delete('/api/integrations/hcti')
    .set('X-CSRF-Token', csrf)
    .send({ confirm: 'DELETE' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.configured, false);

  const userRow = overrides.userRepository._rows[0];
  const stored = overrides.integrationRepository._map.get(userRow.id);
  assert.equal(stored.encryptedUserId, null);
  assert.equal(stored.encryptedApiKey, null);
  assert.equal(stored.verifiedAt, null);
});

test('HCTI: another user cannot see or access the first user credentials', async () => {
  const { app } = buildApp();
  const a = await registerUser(app, defaultCreds({ email: 'a@example.com' }));
  await a.agent.put('/api/integrations/hcti').set('X-CSRF-Token', a.csrf).send(HCTI);

  const b = await registerUser(app, defaultCreds({ email: 'b@example.com', name: 'Bob' }));
  const res = await b.agent.get('/api/integrations/hcti');
  assert.equal(res.body.data.configured, false);
  assert.equal(res.body.data.maskedUserId, null);
});

test('HCTI: API key never appears in the activity log entries', async () => {
  const { app, overrides } = buildApp();
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/hcti').set('X-CSRF-Token', csrf).send(HCTI);
  await agent.post('/api/integrations/hcti/test').set('X-CSRF-Token', csrf).send({});

  const blob = JSON.stringify(overrides.logRepository._entries);
  assert.equal(blob.includes(HCTI.hctiApiKey), false);
  assert.equal(blob.includes(HCTI.hctiUserId), false);
});

test('HCTI: routes require authentication', async () => {
  const { app } = buildApp();
  const res = await (await import('supertest')).default(app).get('/api/integrations/hcti');
  assert.equal(res.status, 401);
});
