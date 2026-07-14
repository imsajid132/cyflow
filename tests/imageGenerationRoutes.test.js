import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeApp, registerUser } from './helpers/apiHarness.js';
import { createFakeSocialImageService } from './helpers/fakes.js';
import { SocialImageError } from '../src/services/socialImageService.js';

async function setup(extra = {}) {
  const { app, overrides } = makeApp(extra);
  const { agent, csrf } = await registerUser(app);
  const userId = overrides.userRepository._rows[0].id;
  const account = await overrides.socialAccountRepository.upsertSocialAccount({
    userId, provider: 'threads', accountType: 'threads_profile', providerAccountId: 'th1',
    displayName: 'T', username: 'me', encryptedAccessToken: 'v1:token', scopes: [], providerMetadata: {}, status: 'active',
  });
  return { app, overrides, agent, csrf, account };
}

async function draftWithContent(agent, csrf, account) {
  const create = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ brief: 'x', template: 'bold', aspectRatio: 'portrait' });
  const postId = create.body.data.post.id;
  await agent.put(`/api/posts/${postId}/targets`).set('X-CSRF-Token', csrf).send({ targets: [{ socialAccountId: account.id }] });
  await agent.post(`/api/posts/${postId}/generate-content`).set('X-CSRF-Token', csrf).send({});
  return postId;
}

test('generate-image attaches a media asset with an opaque public token', async () => {
  const { agent, csrf, account } = await setup();
  const postId = await draftWithContent(agent, csrf, account);
  const res = await agent.post(`/api/posts/${postId}/generate-image`).set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 200);
  const post = res.body.data.post;
  assert.ok(post.mediaAssetId);
  assert.ok(post.media.publicToken && post.media.publicToken.length >= 16);
  // No credentials/source ciphertext leaked.
  const blob = JSON.stringify(res.body);
  assert.equal(blob.includes('HCTI'), false);
  assert.equal(blob.includes('v1:'), false);
});

test('generate-image before content generation is rejected (needs a headline)', async () => {
  const { agent, csrf, account } = await setup();
  const create = await agent.post('/api/posts').set('X-CSRF-Token', csrf).send({ brief: 'x' });
  const postId = create.body.data.post.id;
  await agent.put(`/api/posts/${postId}/targets`).set('X-CSRF-Token', csrf).send({ targets: [{ socialAccountId: account.id }] });
  const res = await agent.post(`/api/posts/${postId}/generate-image`).set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 400);
});

test('generate-image surfaces a safe error when HCTI is unverified', async () => {
  const failing = {
    async generateSocialImage() {
      throw new SocialImageError('hcti_not_verified');
    },
  };
  const { agent, csrf, account } = await setup({ socialImageService: failing });
  const postId = await draftWithContent(agent, csrf, account);
  const res = await agent.post(`/api/posts/${postId}/generate-image`).set('X-CSRF-Token', csrf).send({});
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /verified/i);
});

test('generate-image requires CSRF', async () => {
  const { agent, csrf, account } = await setup();
  const postId = await draftWithContent(agent, csrf, account);
  const res = await agent.post(`/api/posts/${postId}/generate-image`).send({});
  assert.equal(res.status, 403);
});
