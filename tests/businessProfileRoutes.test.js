import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { makeApp, registerUser, defaultCreds } from './helpers/apiHarness.js';

async function setup(extra = {}) {
  const { app, overrides } = makeApp(extra);
  const { agent, csrf } = await registerUser(app);
  return { app, overrides, agent, csrf };
}

test('GET /api/business-profile: null before setup; onboarding-state guides the user', async () => {
  const { agent } = await setup();
  const profile = await agent.get('/api/business-profile');
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.profile, null);

  const state = await agent.get('/api/business-profile/onboarding-state');
  assert.equal(state.status, 200);
  assert.equal(state.body.data.status, 'not_started');
  assert.equal(state.body.data.needsOnboarding, true);
  // An existing user is never locked out of the app.
  assert.equal(state.body.data.canUseApp, true);
});

test('PUT /api/business-profile: saves whitelisted fields and requires CSRF', async () => {
  const { agent, csrf } = await setup();

  const noCsrf = await agent.put('/api/business-profile').send({ businessName: 'Acme' });
  assert.equal(noCsrf.status, 403);

  const res = await agent
    .put('/api/business-profile')
    .set('X-CSRF-Token', csrf)
    .send({ businessName: 'Acme Ltd', primaryColor: '#1A73E8', services: ['Roofing'], defaultTone: 'friendly' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.profile.businessName, 'Acme Ltd');
  assert.equal(res.body.data.profile.primaryColor, '#1a73e8');
  assert.deepEqual(res.body.data.profile.services, ['Roofing']);
});

test('PUT: unknown/privileged fields are rejected', async () => {
  const { agent, csrf } = await setup();
  for (const body of [
    { userId: '999' },
    { onboardingStatus: 'completed' },
    { sourceType: 'website' },
    { role: 'admin' },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await agent.put('/api/business-profile').set('X-CSRF-Token', csrf).send(body);
    assert.equal(res.status, 400, `should reject ${JSON.stringify(body)}`);
  }
});

test('PUT: invalid colors and URLs are rejected', async () => {
  const { agent, csrf } = await setup();
  const badColor = await agent.put('/api/business-profile').set('X-CSRF-Token', csrf).send({ primaryColor: 'red' });
  assert.equal(badColor.status, 400);
  const badUrl = await agent.put('/api/business-profile').set('X-CSRF-Token', csrf).send({ websiteUrl: 'http://localhost/' });
  assert.equal(badUrl.status, 400);
});

test('another user cannot read or update this profile', async () => {
  const { app, agent, csrf } = await setup();
  await agent.put('/api/business-profile').set('X-CSRF-Token', csrf).send({ businessName: 'Acme Ltd' });

  const b = await registerUser(app, defaultCreds({ email: 'b@example.com', name: 'Bob' }));
  const theirs = await b.agent.get('/api/business-profile');
  assert.equal(theirs.body.data.profile, null); // scoped to the session user

  await b.agent.put('/api/business-profile').set('X-CSRF-Token', b.csrf).send({ businessName: 'Bob Co' });
  const mine = await agent.get('/api/business-profile');
  assert.equal(mine.body.data.profile.businessName, 'Acme Ltd'); // untouched
});

test('complete-onboarding moves the state to completed', async () => {
  const { agent, csrf } = await setup();
  await agent.put('/api/business-profile').set('X-CSRF-Token', csrf).send({ businessName: 'Acme' });
  const done = await agent.post('/api/business-profile/complete-onboarding').set('X-CSRF-Token', csrf).send({});
  assert.equal(done.status, 200);
  assert.equal(done.body.data.profile.onboardingStatus, 'completed');

  const state = await agent.get('/api/business-profile/onboarding-state');
  assert.equal(state.body.data.needsOnboarding, false);
});

test('DELETE removes the profile and requires CSRF', async () => {
  const { agent, csrf } = await setup();
  await agent.put('/api/business-profile').set('X-CSRF-Token', csrf).send({ businessName: 'Acme' });
  assert.equal((await agent.delete('/api/business-profile').send({})).status, 403);
  const del = await agent.delete('/api/business-profile').set('X-CSRF-Token', csrf).send({});
  assert.equal(del.status, 200);
  assert.equal((await agent.get('/api/business-profile')).body.data.profile, null);
});

test('business profile routes require authentication', async () => {
  const { app } = await setup();
  assert.equal((await request(app).get('/api/business-profile')).status, 401);
  assert.equal((await request(app).get('/api/business-profile/onboarding-state')).status, 401);
  assert.equal((await request(app).post('/api/business-profile/analyze-website').send({ websiteUrl: 'x.com' })).status, 401);
});

test('responses contain no secrets or diagnostics', async () => {
  const { agent, csrf } = await setup();
  const res = await agent.put('/api/business-profile').set('X-CSRF-Token', csrf).send({ businessName: 'Acme' });
  const blob = JSON.stringify(res.body);
  assert.equal(blob.includes('manualFields'), false); // internal tracking not exposed
  assert.equal(blob.includes('extractedMetadata'), false);
  assert.equal(/sk-[A-Za-z0-9]/.test(blob), false);
  assert.equal(blob.includes('v1:'), false);
});
