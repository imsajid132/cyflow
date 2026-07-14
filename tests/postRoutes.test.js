import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { makeApp, registerUser, getCsrf, defaultCreds } from './helpers/apiHarness.js';

async function setup() {
  const { app, overrides } = makeApp();
  const { agent, csrf } = await registerUser(app);
  return { app, overrides, agent, csrf };
}

test('create + list + get a draft (owned)', async () => {
  const { agent, csrf } = await setup();
  const create = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ title: 'Hello', brief: 'x' });
  assert.equal(create.status, 201);
  const id = create.body.data.post.id;
  assert.equal(create.body.data.post.status, 'draft');

  const list = await agent.get('/api/posts');
  assert.equal(list.status, 200);
  assert.equal(list.body.data.posts.length, 1);

  const get = await agent.get(`/api/posts/${id}`);
  assert.equal(get.status, 200);
  assert.equal(get.body.data.post.title, 'Hello');
});

test('create requires CSRF', async () => {
  const { agent } = await setup();
  const res = await agent.post('/api/posts').send({ brief: 'x' });
  assert.equal(res.status, 403);
});

test('update a draft; unknown/privileged fields are ignored', async () => {
  const { agent, csrf } = await setup();
  const create = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ brief: 'x' });
  const id = create.body.data.post.id;
  const res = await agent
    .patch(`/api/posts/${id}`)
    .set('X-CSRF-Token', csrf)
    .send({ title: 'Renamed', status: 'published', userId: '999', role: 'admin' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.post.title, 'Renamed');
  assert.equal(res.body.data.post.status, 'draft'); // status not mass-assignable
  assert.equal(res.body.data.post.userId !== '999', true);
});

test('another user cannot view/update/delete a post', async () => {
  const { app, agent, csrf } = await setup();
  const create = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ brief: 'x' });
  const id = create.body.data.post.id;

  const b = await registerUser(app, defaultCreds({ email: 'b@example.com', name: 'Bob' }));
  assert.equal((await b.agent.get(`/api/posts/${id}`)).status, 404);
  assert.equal((await b.agent.patch(`/api/posts/${id}`).set('X-CSRF-Token', b.csrf).send({ title: 'x' })).status, 404);
  assert.equal((await b.agent.delete(`/api/posts/${id}`).set('X-CSRF-Token', b.csrf).send({})).status, 404);
});

test('delete a draft; blocked when published history exists', async () => {
  const { overrides, agent, csrf } = await setup();
  const create = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ brief: 'x' });
  const id = create.body.data.post.id;

  // Simulate a published target (history) directly in the fake repo.
  overrides.postRepository._targets.push({ id: '1', scheduled_post_id: id, social_account_id: '1', status: 'published', caption_override: null, attempt_count: 1 });
  const blocked = await agent.delete(`/api/posts/${id}`).set('X-CSRF-Token', csrf).send({});
  assert.equal(blocked.status, 409);

  // A clean draft deletes fine.
  const create2 = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ brief: 'y' });
  const id2 = create2.body.data.post.id;
  const del = await agent.delete(`/api/posts/${id2}`).set('X-CSRF-Token', csrf).send({});
  assert.equal(del.status, 200);
});

test('post routes require authentication', async () => {
  const { app } = await setup();
  assert.equal((await request(app).get('/api/posts')).status, 401);
});

test('responses never contain tokens/keys/ciphertext', async () => {
  const { agent, csrf } = await setup();
  const create = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ brief: 'x' });
  const blob = JSON.stringify(create.body);
  assert.equal(blob.includes('v1:'), false);
  assert.equal(/sk-[A-Za-z0-9]/.test(blob), false);
  assert.equal(blob.includes('access_token'), false);
});
