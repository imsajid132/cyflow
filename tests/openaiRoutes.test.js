/**
 * Milestone C1 — the OpenAI credential API, over real HTTP.
 *
 * The unit tests in openaiCredentials.test.js prove the resolver. These prove
 * the thing a browser actually talks to: that the key goes in encrypted, comes
 * back masked, never comes back whole, and belongs to exactly one user.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { decryptSecret } from '../src/services/encryptionService.js';
import { createFakeOverrides } from './helpers/fakes.js';
import { registerUser, defaultCreds } from './helpers/apiHarness.js';

const KEY = 'sk-test-0000000000000000000000000000000000000000000WXYZ';
const OTHER_KEY = 'sk-test-1111111111111111111111111111111111111111111ABCD';

/** A verifier that answers however the test needs, and counts its calls. */
function fakeVerifier({ success = true, classification = null, message = 'ok' } = {}) {
  const calls = [];
  return {
    _calls: calls,
    async verify({ userId }) {
      calls.push({ userId });
      return { success, classification, message };
    },
  };
}

function buildApp(extra = {}) {
  const overrides = createFakeOverrides(extra);
  return { app: createApp(overrides), overrides };
}

// --- status -------------------------------------------------------------------

test('GET /openai: unconfigured status is honest and empty', async () => {
  const { app } = buildApp();
  const { agent } = await registerUser(app);
  const res = await agent.get('/api/integrations/openai');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, {
    configured: false, verified: false, verifiedAt: null, maskedKey: null, model: null,
  });
});

test('GET /openai requires a session', async () => {
  const { app } = buildApp();
  const res = await (await import('supertest')).default(app).get('/api/integrations/openai');
  assert.equal(res.status, 401);
});

// --- save ---------------------------------------------------------------------

test('PUT /openai: encrypts before storing and never echoes the key', async () => {
  const { app, overrides } = buildApp();
  const { agent, csrf } = await registerUser(app);

  const res = await agent.put('/api/integrations/openai')
    .set('X-CSRF-Token', csrf)
    .send({ apiKey: KEY, model: 'gpt-4o-mini' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.configured, true);
  // Saving proves the key was typed, not that it works.
  assert.equal(res.body.data.verified, false);
  assert.equal(res.body.data.verifiedAt, null);
  assert.equal(res.body.data.model, 'gpt-4o-mini');

  // The response carries a mask and nothing else.
  assert.equal(res.body.data.maskedKey, '••••WXYZ');
  const body = JSON.stringify(res.body);
  assert.ok(!body.includes(KEY), 'the raw key came back in the response');
  assert.ok(!body.includes('v1:'), 'the envelope came back in the response');

  // At rest: an envelope, not the key.
  const record = await overrides.integrationRepository.getOpenAiCredentialRecord('1');
  assert.ok(!record.encryptedApiKey.includes(KEY), 'the key is stored in plaintext');
  assert.match(record.encryptedApiKey, /^v1:/);
  assert.equal(decryptSecret(record.encryptedApiKey), KEY, 'it must round-trip');
});

test('PUT /openai: a replacement gets a fresh envelope and resets verification', async () => {
  const { app, overrides } = buildApp({ openAiVerifier: fakeVerifier({ success: true }) });
  const { agent, csrf } = await registerUser(app);
  const put = (apiKey) => agent.put('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ apiKey });

  await put(KEY);
  await agent.post('/api/integrations/openai/test').set('X-CSRF-Token', csrf);
  assert.equal((await agent.get('/api/integrations/openai')).body.data.verified, true);

  const first = (await overrides.integrationRepository.getOpenAiCredentialRecord('1')).encryptedApiKey;
  await put(OTHER_KEY);
  const second = (await overrides.integrationRepository.getOpenAiCredentialRecord('1')).encryptedApiKey;

  assert.notEqual(first, second);
  assert.notEqual(first.split(':')[1], second.split(':')[1], 'the IV must be fresh');
  // The new key is unproven: it must NOT inherit the old key's verification.
  const status = (await agent.get('/api/integrations/openai')).body.data;
  assert.equal(status.verified, false, 'a replaced key inherited the old verification');
  assert.equal(status.verifiedAt, null);
});

test('PUT /openai: the key is required, bounded, and never echoed in the error', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);

  const missing = await agent.put('/api/integrations/openai').set('X-CSRF-Token', csrf).send({});
  assert.equal(missing.status, 400);

  const huge = 'sk-'.padEnd(500, 'x');
  const tooLong = await agent.put('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ apiKey: huge });
  assert.equal(tooLong.status, 400);
  // A validation message that quoted the value would put the secret in an error
  // body, and error bodies get logged.
  assert.ok(!JSON.stringify(tooLong.body).includes(huge), 'the key leaked into a validation error');
});

test('PUT /openai: an unsupported model is refused', async () => {
  const { app } = buildApp();
  const { agent, csrf } = await registerUser(app);
  const res = await agent.put('/api/integrations/openai')
    .set('X-CSRF-Token', csrf)
    .send({ apiKey: KEY, model: 'gpt-imaginary' });
  assert.equal(res.status, 400);
});

test('PUT /openai requires CSRF', async () => {
  const { app } = buildApp();
  const { agent } = await registerUser(app);
  const res = await agent.put('/api/integrations/openai').send({ apiKey: KEY });
  assert.equal(res.status, 403);
});

// --- test connection ----------------------------------------------------------

test('POST /openai/test: verification is recorded only on real success', async () => {
  const verifier = fakeVerifier({ success: true, message: 'Your OpenAI API key works.' });
  const { app } = buildApp({ openAiVerifier: verifier });
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ apiKey: KEY });

  const res = await agent.post('/api/integrations/openai/test').set('X-CSRF-Token', csrf);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.success, true);
  assert.equal(res.body.data.verified, true);
  assert.ok(res.body.data.verifiedAt, 'a successful test must stamp the time');
  assert.equal(verifier._calls.length, 1);
  assert.equal(verifier._calls[0].userId, '1', 'it must verify THIS user');

  assert.equal((await agent.get('/api/integrations/openai')).body.data.verified, true);
});

test('POST /openai/test: a failure does not claim success, and keeps the key', async () => {
  const { app } = buildApp({
    openAiVerifier: fakeVerifier({ success: false, classification: 'auth', message: 'That key was rejected by OpenAI.' }),
  });
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ apiKey: KEY });

  const res = await agent.post('/api/integrations/openai/test').set('X-CSRF-Token', csrf);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.success, false);
  assert.equal(res.body.data.verified, false);
  assert.equal(res.body.data.verifiedAt, null);

  // Configured but unverified: the user keeps their key and can fix it.
  const status = (await agent.get('/api/integrations/openai')).body.data;
  assert.equal(status.configured, true);
  assert.equal(status.verified, false);
});

test('POST /openai/test: a failure never invents billing information', async () => {
  const { app } = buildApp({
    openAiVerifier: fakeVerifier({ success: false, classification: 'quota', message: 'This key has no available quota. Check your OpenAI API billing.' }),
  });
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ apiKey: KEY });
  const res = await agent.post('/api/integrations/openai/test').set('X-CSRF-Token', csrf);

  const body = JSON.stringify(res.body).toLowerCase();
  for (const claim of ['balance', 'credits remaining', 'remaining credit', '$']) {
    assert.ok(!body.includes(claim), `the response invented billing information: ${claim}`);
  }
});

test('POST /openai/test with no key configured is a clear conflict, not a crash', async () => {
  const verifier = fakeVerifier();
  const { app } = buildApp({ openAiVerifier: verifier });
  const { agent, csrf } = await registerUser(app);
  const res = await agent.post('/api/integrations/openai/test').set('X-CSRF-Token', csrf);
  assert.equal(res.status, 409);
  assert.equal(verifier._calls.length, 0, 'it called the provider with no key');
});

// --- remove -------------------------------------------------------------------

test('DELETE /openai: clears the credential and requires confirmation', async () => {
  const { app, overrides } = buildApp({ openAiVerifier: fakeVerifier({ success: true }) });
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ apiKey: KEY, model: 'gpt-4o' });
  await agent.post('/api/integrations/openai/test').set('X-CSRF-Token', csrf);

  const unconfirmed = await agent.delete('/api/integrations/openai').set('X-CSRF-Token', csrf).send({});
  assert.equal(unconfirmed.status, 400, 'removal must be confirmed');

  const res = await agent.delete('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ confirm: 'DELETE' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, {
    configured: false, verified: false, verifiedAt: null, maskedKey: null, model: null,
  });

  const record = await overrides.integrationRepository.getOpenAiCredentialRecord('1');
  assert.equal(record.encryptedApiKey, null, 'the envelope survived removal');
  assert.equal(record.verifiedAt, null);
  assert.equal(record.model, null);
});

test('removing the OpenAI key leaves the HCTI credentials untouched', async () => {
  // One row, two credentials. Removing one must not disturb the other.
  const { app, overrides } = buildApp();
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/hcti').set('X-CSRF-Token', csrf)
    .send({ hctiUserId: 'hcti-user', hctiApiKey: 'hcti-secret' });
  await agent.put('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ apiKey: KEY });

  await agent.delete('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ confirm: 'DELETE' });

  const hcti = await overrides.integrationRepository.getHctiCredentialRecord('1');
  assert.equal(hcti.configured, true, 'removing the OpenAI key destroyed the HCTI credentials');
  assert.equal((await agent.get('/api/integrations/hcti')).body.data.configured, true);
});

// --- isolation ----------------------------------------------------------------

test('one user cannot read, test or remove another user\'s credential', async () => {
  const verifier = fakeVerifier({ success: true });
  const { app } = buildApp({ openAiVerifier: verifier });

  const alice = await registerUser(app);
  await alice.agent.put('/api/integrations/openai').set('X-CSRF-Token', alice.csrf).send({ apiKey: KEY });

  const bob = await registerUser(app, defaultCreds({ email: 'bob@example.com', name: 'Bob' }));

  // Bob's status is Bob's: not configured, no sight of Alice's mask.
  const status = (await bob.agent.get('/api/integrations/openai')).body.data;
  assert.equal(status.configured, false);
  assert.equal(status.maskedKey, null);

  // Bob cannot test a credential he does not have — Alice's must not be reached.
  const test = await bob.agent.post('/api/integrations/openai/test').set('X-CSRF-Token', bob.csrf);
  assert.equal(test.status, 409);
  assert.equal(verifier._calls.length, 0);

  // Bob deleting his (absent) key must not touch Alice's.
  await bob.agent.delete('/api/integrations/openai').set('X-CSRF-Token', bob.csrf).send({ confirm: 'DELETE' });
  assert.equal((await alice.agent.get('/api/integrations/openai')).body.data.configured, true);
});

test('identity comes from the session, never from the body', async () => {
  const { app } = buildApp();
  const alice = await registerUser(app);
  await alice.agent.put('/api/integrations/openai').set('X-CSRF-Token', alice.csrf).send({ apiKey: KEY });

  const bob = await registerUser(app, defaultCreds({ email: 'bob2@example.com', name: 'Bob' }));
  // Bob claims to be user 1. The controller reads req.user.id and ignores it.
  const res = await bob.agent.put('/api/integrations/openai')
    .set('X-CSRF-Token', bob.csrf)
    .send({ apiKey: OTHER_KEY, userId: '1', user_id: '1' });
  assert.equal(res.status, 200);

  // Alice's key is still Alice's.
  assert.equal((await alice.agent.get('/api/integrations/openai')).body.data.maskedKey, '••••WXYZ');
  assert.equal((await bob.agent.get('/api/integrations/openai')).body.data.maskedKey, '••••ABCD');
});

// --- the key never reaches a log ---------------------------------------------

test('the activity log records that a key was saved, never the key', async () => {
  const { app, overrides } = buildApp({ openAiVerifier: fakeVerifier({ success: true }) });
  const { agent, csrf } = await registerUser(app);
  await agent.put('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ apiKey: KEY });
  await agent.post('/api/integrations/openai/test').set('X-CSRF-Token', csrf);
  await agent.delete('/api/integrations/openai').set('X-CSRF-Token', csrf).send({ confirm: 'DELETE' });

  const logged = JSON.stringify(overrides.logRepository._entries);
  assert.ok(!logged.includes(KEY), 'the key reached the activity log');
  assert.ok(!logged.includes('v1:'), 'the envelope reached the activity log');
  // It still records what happened.
  assert.match(logged, /openai\.credentials_saved/);
  assert.match(logged, /openai\.credentials_deleted/);
});
