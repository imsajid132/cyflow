import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { makeApp, registerUser, getCsrf, defaultCreds } from './helpers/apiHarness.js';

async function setup() {
  const { app, overrides } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const me = await agent.get('/api/auth/me');
  const userId = String(me.body.data.user.id);
  const social = overrides.socialAccountRepository;
  const seed = async (provider, accountType, providerAccountId) => social.upsertSocialAccount({
    userId, provider, accountType, providerAccountId, displayName: accountType, username: accountType,
    encryptedAccessToken: 'v1:x', scopes: [], providerMetadata: {}, status: 'active',
  });
  await seed('meta', 'facebook_page', 'fb1');
  await seed('instagram', 'instagram_professional', 'ig1');
  await seed('threads', 'threads_profile', 'th1');
  const accts = await social.listAccountsForUser(userId);
  const id = (t) => accts.find((a) => a.accountType === t).id;
  return { app, agent, csrf, overrides, userId, ids: { fb: id('facebook_page'), ig: id('instagram_professional'), th: id('threads_profile') } };
}

const cfg = (ids, over = {}) => ({
  name: 'Weekly', mode: 'review', timezone: 'Asia/Karachi', selectedWeekdays: [1, 3, 5],
  postingTimes: ['09:00'], postsPerDay: 1, selectedPlatforms: ['instagram', 'threads'],
  selectedAccountIds: [ids.ig, ids.th], missedPostPolicy: 'skip',
  generationHorizonDays: 14, minimumReadyDays: 7, lowBufferDays: 3, ...over,
});

test('creating an automation requires authentication', async () => {
  const { app } = await setup();
  const res = await request(app).post('/api/automations').send(cfg({ ig: '1', th: '2' }));
  assert.equal(res.status, 401);
});

test('creating an automation requires a CSRF token', async () => {
  const { agent, ids } = await setup();
  const res = await agent.post('/api/automations').send(cfg(ids)); // no token
  assert.equal(res.status, 403);
});

test('a valid Instagram+Threads automation is created as a draft', async () => {
  const { agent, csrf, ids } = await setup();
  const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(cfg(ids));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.automation.status, 'draft');
  assert.deepEqual(res.body.data.automation.selectedPlatforms.sort(), ['instagram', 'threads']);
});

test('a Facebook account cannot be attached to an Instagram+Threads automation', async () => {
  const { agent, csrf, ids } = await setup();
  const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf)
    .send(cfg(ids, { selectedAccountIds: [ids.ig, ids.th, ids.fb] }));
  assert.equal(res.status, 400);
});

test('an automation with no platforms is rejected', async () => {
  const { agent, csrf, ids } = await setup();
  const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf)
    .send(cfg(ids, { selectedPlatforms: [], selectedAccountIds: [] }));
  assert.equal(res.status, 400);
});

test('stop requires the STOP confirmation token', async () => {
  const { agent, csrf, ids } = await setup();
  const created = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(cfg(ids));
  const id = created.body.data.automation.id;
  const noConfirm = await agent.post(`/api/automations/${id}/stop`).set('X-CSRF-Token', csrf).send({});
  assert.equal(noConfirm.status, 400);
  const ok = await agent.post(`/api/automations/${id}/stop`).set('X-CSRF-Token', csrf).send({ confirm: 'STOP' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.automation.status, 'stopped');
});

test('one user cannot read or control another user’s automation', async () => {
  const { app, agent, csrf, ids } = await setup();
  const created = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(cfg(ids));
  const id = created.body.data.automation.id;

  // A second user in the same app.
  const b = request.agent(app);
  const t1 = await getCsrf(b);
  await b.post('/api/auth/register').set('X-CSRF-Token', t1).send(defaultCreds({ email: 'intruder@example.com' }));
  const bCsrf = await getCsrf(b);

  assert.equal((await b.get(`/api/automations/${id}`)).status, 404);
  assert.equal((await b.post(`/api/automations/${id}/activate`).set('X-CSRF-Token', bCsrf).send({})).status, 404);
  assert.equal((await b.post(`/api/automations/${id}/stop`).set('X-CSRF-Token', bCsrf).send({ confirm: 'STOP' })).status, 404);
});

test('list returns the user’s own automations only', async () => {
  const { agent, csrf, ids } = await setup();
  await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(cfg(ids));
  const res = await agent.get('/api/automations');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.automations.length, 1);
});
