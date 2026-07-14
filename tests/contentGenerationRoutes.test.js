import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeApp, registerUser } from './helpers/apiHarness.js';
import { createFakeOpenAIContentService } from './helpers/fakes.js';

async function setup(extra = {}) {
  const { app, overrides } = makeApp(extra);
  const { agent, csrf } = await registerUser(app);
  const userId = overrides.userRepository._rows[0].id;
  const account = await overrides.socialAccountRepository.upsertSocialAccount({
    userId,
    provider: 'threads',
    accountType: 'threads_profile',
    providerAccountId: 'th1',
    displayName: 'My Threads',
    username: 'me',
    encryptedAccessToken: 'v1:token',
    scopes: [],
    providerMetadata: {},
    status: 'active',
  });
  return { app, overrides, agent, csrf, account };
}

async function draftWithTargets(agent, csrf, account, brief = 'Announce our new feature') {
  const create = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ title: 'T', brief, brandName: 'Acme' });
  const postId = create.body.data.post.id;
  await agent.put(`/api/posts/${postId}/targets`).set('X-CSRF-Token', csrf).send({ targets: [{ socialAccountId: account.id }] });
  return postId;
}

test('generate-content returns only the requested platform + never a key', async () => {
  const { agent, csrf, account } = await setup();
  const postId = await draftWithTargets(agent, csrf, account);
  const res = await agent.post(`/api/posts/${postId}/generate-content`).set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 200);
  const post = res.body.data.post;
  assert.ok(post.platformCaptions.threads.caption);
  assert.equal(post.platformCaptions.facebook, undefined);
  const blob = JSON.stringify(res.body);
  assert.equal(/sk-[A-Za-z0-9]/.test(blob), false);
  assert.equal(blob.includes('apiKey'), false);
});

test('generate-content requires CSRF', async () => {
  const { agent, csrf, account } = await setup();
  const postId = await draftWithTargets(agent, csrf, account);
  const res = await agent.post(`/api/posts/${postId}/generate-content`).send({});
  assert.equal(res.status, 403);
});

test('generate-content is unavailable when OpenAI is not configured', async () => {
  const { agent, csrf, account } = await setup({
    openaiContentService: createFakeOpenAIContentService({ available: false }),
  });
  const postId = await draftWithTargets(agent, csrf, account);
  const res = await agent.post(`/api/posts/${postId}/generate-content`).set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 409);
});

test('capabilities endpoint reports availability without secrets', async () => {
  const { agent } = await setup();
  const res = await agent.get('/api/posts/capabilities');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.data.openai.available, 'boolean');
  assert.equal(typeof res.body.data.hcti.configured, 'boolean');
  assert.equal(typeof res.body.data.hcti.verified, 'boolean');
  assert.equal(typeof res.body.data.generations.dailyLimit, 'number');
  const blob = JSON.stringify(res.body);
  assert.equal(blob.includes('apiKey'), false);
  assert.equal(/sk-/.test(blob), false);
});

test('submitting an openaiApiKey field is ignored (users never provide a key)', async () => {
  const { agent, csrf } = await setup();
  const res = await agent
    .post('/api/posts')
    .set('X-CSRF-Token', csrf)
    .send({ title: 'T', brief: 'x', openaiApiKey: 'sk-injected-should-be-ignored' });
  assert.equal(res.status, 201);
  const blob = JSON.stringify(res.body);
  assert.equal(blob.includes('sk-injected-should-be-ignored'), false);
});
