// Phase 4.7: the planner HTTP surface — auth, CSRF, validation, ownership.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { makeApp, registerUser, getCsrf, defaultCreds } from './helpers/apiHarness.js';
import { createFakePlannerOpenAI, createFakeSocialImageService } from './helpers/fakes.js';
import { closePool } from '../src/db/pool.js';

test.after(async () => {
  await closePool();
});

function imagesReady(ready = true) {
  return { ...createFakeSocialImageService(), isReadyForUser: async () => ready };
}

/** An app whose planner can actually generate. */
function plannerApp() {
  return makeApp({
    openaiContentService: createFakePlannerOpenAI(),
    socialImageService: imagesReady(),
  });
}

/** Register, connect an account, and return an authenticated agent. */
async function signedInWithAccount(app, overrides, creds = defaultCreds()) {
  const { agent, csrf } = await registerUser(app, creds);
  const me = await agent.get('/api/auth/me');
  const userId = me.body.data.user.id;
  await overrides.socialAccountRepository.upsertSocialAccount({
    userId,
    provider: 'threads',
    accountType: 'threads_profile',
    providerAccountId: `threads_${userId}`,
    displayName: 'Acct',
    username: 'acct',
    encryptedAccessToken: 'v1:x',
    scopes: [],
    providerMetadata: {},
    status: 'active',
  });
  return { agent, csrf, userId };
}

// --- auth + CSRF ------------------------------------------------------------

test('every planner endpoint requires authentication', async () => {
  const { app } = plannerApp();
  const anon = request.agent(app);
  const csrf = await getCsrf(anon);

  const calls = [
    ['get', '/api/planner/preferences'],
    ['put', '/api/planner/preferences'],
    ['get', '/api/planner/plans'],
    ['post', '/api/planner/plans'],
    ['get', '/api/planner/plans/1'],
    ['delete', '/api/planner/plans/1'],
    ['post', '/api/planner/plans/1/queue'],
    ['post', '/api/planner/plans/1/bulk-status'],
    ['patch', '/api/planner/items/1'],
    ['post', '/api/planner/items/1/regenerate'],
    ['post', '/api/planner/items/1/status'],
    ['delete', '/api/planner/items/1'],
  ];
  for (const [method, path] of calls) {
    const res = await anon[method](path).set('X-CSRF-Token', csrf).send({});
    assert.equal(res.status, 401, `${method.toUpperCase()} ${path} should be 401`);
  }
});

test('state-changing planner endpoints require CSRF', async () => {
  const { app, overrides } = plannerApp();
  const { agent } = await signedInWithAccount(app, overrides);

  const calls = [
    ['put', '/api/planner/preferences'],
    ['post', '/api/planner/plans'],
    ['delete', '/api/planner/plans/1'],
    ['patch', '/api/planner/items/1'],
    ['post', '/api/planner/items/1/status'],
  ];
  for (const [method, path] of calls) {
    const res = await agent[method](path).send({});
    assert.equal(res.status, 403, `${method.toUpperCase()} ${path} should require CSRF`);
  }
});

// --- preferences ------------------------------------------------------------

test('preferences return defaults, then round-trip through the API', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);

  const first = await agent.get('/api/planner/preferences');
  assert.equal(first.status, 200);
  assert.equal(first.body.data.preferences.isDefault, true);

  const saved = await agent.put('/api/planner/preferences').set('X-CSRF-Token', csrf).send({
    cadence: 'weekdays',
    times: ['08:00', '18:00'],
    tone: 'confident',
    approvalMode: 'auto_queue',
    defaultPlanLength: 5,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.preferences.cadence, 'weekdays');
  assert.deepEqual(saved.body.data.preferences.times, ['08:00', '18:00']);

  const reloaded = await agent.get('/api/planner/preferences');
  assert.equal(reloaded.body.data.preferences.tone, 'confident');
  assert.equal(reloaded.body.data.preferences.isDefault, false);
});

test('invalid preferences are rejected with field errors and no echo', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);

  const res = await agent.put('/api/planner/preferences').set('X-CSRF-Token', csrf).send({
    cadence: 'hourly',
    tone: 'shouty',
    times: ['9am'],
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  const fields = res.body.error.details.map((d) => d.field);
  assert.ok(fields.includes('cadence'));
  // The submitted value is never echoed back.
  assert.equal(JSON.stringify(res.body).includes('hourly'), false);
  assert.equal(JSON.stringify(res.body).includes('shouty'), false);
});

test('an unsupported platform is rejected', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);
  for (const platform of ['tiktok', 'linkedin', 'twitter', 'youtube']) {
    const res = await agent.put('/api/planner/preferences').set('X-CSRF-Token', csrf).send({ platforms: [platform] });
    assert.equal(res.status, 400, `${platform} must be rejected`);
  }
});

// --- generation -------------------------------------------------------------

test('POST /api/planner/plans generates a reviewable plan', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);

  const res = await agent.post('/api/planner/plans').set('X-CSRF-Token', csrf).send({
    startDate: '2099-01-05', planLength: 3, cadence: 'every_day', times: ['09:00'], timezone: 'UTC',
  });
  assert.equal(res.status, 201);
  const plan = res.body.data;
  assert.equal(plan.items.length, 3);
  assert.equal(plan.run.status, 'review');
  assert.equal(plan.counts.needs_review, 3);
  for (const item of plan.items) {
    assert.ok(item.caption);
    assert.ok(item.templateKey);
    // The internal similarity fingerprint is never sent to the client.
    assert.equal(item.fingerprint, undefined);
  }
});

test('generation validates its input', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);
  const bad = [
    { planLength: 99 },
    { planLength: 0 },
    { cadence: 'sometimes' },
    { times: ['25:00'] },
    { platforms: ['tiktok'] },
    { startDate: 'tomorrow' },
    { approvalMode: 'whatever' },
  ];
  for (const body of bad) {
    const res = await agent.post('/api/planner/plans').set('X-CSRF-Token', csrf).send(body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} should be rejected`);
  }
});

test('generating without a connected account returns a helpful 400', async () => {
  const { app } = plannerApp();
  const { agent, csrf } = await registerUser(app);
  const res = await agent.post('/api/planner/plans').set('X-CSRF-Token', csrf).send({
    startDate: '2099-01-05', planLength: 3, times: ['09:00'], timezone: 'UTC',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /Connect at least one/);
});

// --- board actions ----------------------------------------------------------

test('the full board flow works over HTTP: edit, approve, queue', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);

  const gen = await agent.post('/api/planner/plans').set('X-CSRF-Token', csrf).send({
    startDate: '2099-01-05', planLength: 2, times: ['09:00'], timezone: 'UTC',
  });
  const plan = gen.body.data;
  const runId = plan.run.id;
  const itemId = plan.items[0].id;

  // Edit a caption.
  const edited = await agent.patch(`/api/planner/items/${itemId}`).set('X-CSRF-Token', csrf)
    .send({ caption: 'My own caption, thanks.' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.item.caption, 'My own caption, thanks.');
  assert.ok(edited.body.data.item.editedFields.includes('caption'));

  // Approve all.
  const bulk = await agent.post(`/api/planner/plans/${runId}/bulk-status`).set('X-CSRF-Token', csrf)
    .send({ status: 'approved', itemIds: [] });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.data.plan.counts.approved, 2);

  // Queue them.
  const queued = await agent.post(`/api/planner/plans/${runId}/queue`).set('X-CSRF-Token', csrf).send({ itemIds: [] });
  assert.equal(queued.status, 200);
  assert.equal(queued.body.data.queued.length, 2);
  assert.match(queued.body.data.notice, /later phase/i);

  // The posts really are in the normal queue.
  const posts = await agent.get('/api/posts?status=queued');
  assert.equal(posts.status, 200);
  assert.equal(posts.body.data.posts.length, 2);
  for (const post of posts.body.data.posts) assert.equal(post.status, 'queued');
});

test('regenerating an edited caption needs an explicit force', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);
  const gen = await agent.post('/api/planner/plans').set('X-CSRF-Token', csrf).send({
    startDate: '2099-01-05', planLength: 1, times: ['09:00'], timezone: 'UTC',
  });
  const itemId = gen.body.data.items[0].id;

  await agent.patch(`/api/planner/items/${itemId}`).set('X-CSRF-Token', csrf).send({ caption: 'Mine.' });

  const blocked = await agent.post(`/api/planner/items/${itemId}/regenerate`).set('X-CSRF-Token', csrf)
    .send({ target: 'caption' });
  assert.equal(blocked.status, 409);

  const forced = await agent.post(`/api/planner/items/${itemId}/regenerate`).set('X-CSRF-Token', csrf)
    .send({ target: 'caption', force: true });
  assert.equal(forced.status, 200);
  assert.notEqual(forced.body.data.item.caption, 'Mine.');
});

test('regenerate rejects an unknown target', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);
  const gen = await agent.post('/api/planner/plans').set('X-CSRF-Token', csrf).send({
    startDate: '2099-01-05', planLength: 1, times: ['09:00'], timezone: 'UTC',
  });
  const itemId = gen.body.data.items[0].id;
  const res = await agent.post(`/api/planner/items/${itemId}/regenerate`).set('X-CSRF-Token', csrf)
    .send({ target: 'everything' });
  assert.equal(res.status, 400);
});

test('plan history lists this user plans only', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);
  await agent.post('/api/planner/plans').set('X-CSRF-Token', csrf).send({
    startDate: '2099-01-05', planLength: 1, times: ['09:00'], timezone: 'UTC',
  });

  const mine = await agent.get('/api/planner/plans');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.plans.length, 1);

  // A second user sees nothing of the first user's work.
  const other = await signedInWithAccount(app, overrides, defaultCreds({ email: 'bob@example.com' }));
  const theirs = await other.agent.get('/api/planner/plans');
  assert.equal(theirs.body.data.plans.length, 0);

  const runId = mine.body.data.plans[0].id;
  assert.equal((await other.agent.get(`/api/planner/plans/${runId}`)).status, 404);
  assert.equal(
    (await other.agent.delete(`/api/planner/plans/${runId}`).set('X-CSRF-Token', other.csrf)).status,
    404,
  );
});

test('a bad id is rejected before it reaches the service', async () => {
  const { app, overrides } = plannerApp();
  const { agent, csrf } = await signedInWithAccount(app, overrides);
  for (const id of ['abc', '1;DROP TABLE', '../../etc']) {
    const res = await agent.get(`/api/planner/plans/${encodeURIComponent(id)}`);
    assert.equal(res.status, 400, `${id} should be rejected`);
  }
  const res = await agent.patch('/api/planner/items/abc').set('X-CSRF-Token', csrf).send({ caption: 'x' });
  assert.equal(res.status, 400);
});
