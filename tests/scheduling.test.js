import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeApp, registerUser } from './helpers/apiHarness.js';
import { fromMysqlUtc } from '../src/utils/time.js';

async function setup() {
  const { app, overrides } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const userId = overrides.userRepository._rows[0].id;
  const threads = await overrides.socialAccountRepository.upsertSocialAccount({
    userId, provider: 'threads', accountType: 'threads_profile', providerAccountId: 'th1',
    displayName: 'T', username: 'me', encryptedAccessToken: 'v1:token', scopes: [], providerMetadata: {}, status: 'active',
  });
  return { app, overrides, agent, csrf, userId, threads };
}

async function readyPost(agent, csrf, accountId) {
  const create = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ brief: 'x' });
  const id = create.body.data.post.id;
  await agent.put(`/api/posts/${id}/targets`).set('X-CSRF-Token', csrf).send({ targets: [{ socialAccountId: accountId }] });
  await agent.post(`/api/posts/${id}/generate-content`).set('X-CSRF-Token', csrf).send({});
  return id;
}

test('schedule converts Asia/Karachi to UTC, queues, and stays unpublished', async () => {
  const { agent, csrf, threads, overrides } = await setup();
  const id = await readyPost(agent, csrf, threads.id);

  const res = await agent
    .post(`/api/posts/${id}/schedule`)
    .set('X-CSRF-Token', csrf)
    .send({ scheduledDate: '2999-06-01', scheduledTime: '14:30', timezone: 'Asia/Karachi' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.post.status, 'queued');
  assert.equal(res.body.data.post.originalTimezone, 'Asia/Karachi');
  assert.match(res.body.data.notice, /scheduled|queued/i);

  const utc = fromMysqlUtc(res.body.data.post.scheduledAtUtc);
  assert.equal(utc.getUTCHours(), 9); // 14:30 PKT -> 09:30 UTC
  assert.equal(utc.getUTCMinutes(), 30);

  // Nothing published; targets pending.
  assert.equal(res.body.data.post.targets.every((t) => t.status === 'pending'), true);
  const postRow = overrides.postRepository._posts.find((p) => p.id === id);
  assert.equal(postRow.status, 'queued'); // not 'published'
});

test('schedule requires targets, future time, and a valid timezone', async () => {
  const { agent, csrf, threads } = await setup();

  // No targets.
  const noTargets = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ brief: 'x' });
  const emptyId = noTargets.body.data.post.id;
  const r1 = await agent
    .post(`/api/posts/${emptyId}/schedule`)
    .set('X-CSRF-Token', csrf)
    .send({ scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC' });
  assert.equal(r1.status, 400);

  const id = await readyPost(agent, csrf, threads.id);
  // Past time.
  const r2 = await agent
    .post(`/api/posts/${id}/schedule`)
    .set('X-CSRF-Token', csrf)
    .send({ scheduledDate: '2000-01-01', scheduledTime: '10:00', timezone: 'UTC' });
  assert.equal(r2.status, 400);

  // Invalid timezone.
  const r3 = await agent
    .post(`/api/posts/${id}/schedule`)
    .set('X-CSRF-Token', csrf)
    .send({ scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'Not/AZone' });
  assert.equal(r3.status, 400);
});

test('Instagram target requires a generated image before scheduling', async () => {
  const { agent, csrf, overrides, userId } = await setup();
  const ig = await overrides.socialAccountRepository.upsertSocialAccount({
    userId, provider: 'instagram', accountType: 'instagram_professional', providerAccountId: 'ig1',
    displayName: 'IG', username: 'ig', encryptedAccessToken: 'v1:token', scopes: [], providerMetadata: {}, status: 'active',
  });
  const id = await readyPost(agent, csrf, ig.id);
  const res = await agent
    .post(`/api/posts/${id}/schedule`)
    .set('X-CSRF-Token', csrf)
    .send({ scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC' });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /Instagram/i);
});

test('cancel a queued post', async () => {
  const { agent, csrf, threads } = await setup();
  const id = await readyPost(agent, csrf, threads.id);
  await agent
    .post(`/api/posts/${id}/schedule`)
    .set('X-CSRF-Token', csrf)
    .send({ scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC' });
  const res = await agent.post(`/api/posts/${id}/cancel`).set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.data.post.status, 'cancelled');
  assert.equal(res.body.data.post.targets.every((t) => t.status === 'cancelled'), true);
});

test('schedule requires CSRF', async () => {
  const { agent, csrf, threads } = await setup();
  const id = await readyPost(agent, csrf, threads.id);
  const res = await agent
    .post(`/api/posts/${id}/schedule`)
    .send({ scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC' });
  assert.equal(res.status, 403);
});
