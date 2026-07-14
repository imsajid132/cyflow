import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPostService } from '../src/services/postService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { fromMysqlUtc } from '../src/utils/time.js';
import {
  createFakeSocialAccountRepository,
  createFakePostRepository,
  createFakeMediaAssetRepository,
  createFakeApiUsageRepository,
  createFakeIntegrationRepository,
  createFakeOpenAIContentService,
  createFakeSocialImageService,
  fakeWithTransaction,
} from './helpers/fakes.js';

const noopLogging = { record: async () => {} };

function build(extra = {}) {
  const socialAccounts = createFakeSocialAccountRepository();
  const posts = createFakePostRepository({ socialAccounts });
  const media = createFakeMediaAssetRepository();
  const apiUsage = extra.apiUsage ?? createFakeApiUsageRepository();
  const integration = createFakeIntegrationRepository();
  const openai = extra.openai ?? createFakeOpenAIContentService();
  const image = extra.image ?? createFakeSocialImageService();
  const mediaAssetService = createMediaAssetService({ mediaRepository: media });
  const svc = createPostService({
    posts,
    socialAccounts,
    mediaRepository: media,
    apiUsage,
    integrationRepository: integration,
    openaiContentService: openai,
    socialImageService: image,
    mediaAssetService,
    logging: noopLogging,
    withTransaction: fakeWithTransaction,
  });
  return { svc, socialAccounts, posts, media, apiUsage, openai, image };
}

async function seedAccount(socialAccounts, { userId = '5', provider = 'threads', accountType = 'threads_profile', status = 'active', id = 'acc_1' } = {}) {
  return socialAccounts.upsertSocialAccount({
    userId,
    provider,
    accountType,
    providerAccountId: id,
    displayName: 'My Account',
    username: 'acct',
    encryptedAccessToken: 'v1:x',
    scopes: [],
    providerMetadata: {},
    status,
  });
}

test('createDraft creates an owned draft', async () => {
  const { svc } = build();
  const post = await svc.createDraft('5', { title: 'T', brief: 'Sell shoes', brandName: 'Acme' });
  assert.equal(post.status, 'draft');
  assert.equal(post.title, 'T');
  assert.equal(post.userId, '5');
  assert.equal(post.generationParams.brandName, 'Acme');
});

test('setTargets validates ownership and active status; rejects duplicate/revoked', async () => {
  const { svc, socialAccounts } = build();
  const acc = await seedAccount(socialAccounts);
  const post = await svc.createDraft('5', { brief: 'x' });

  const withTargets = await svc.setTargets('5', post.id, [{ socialAccountId: acc.id }]);
  assert.equal(withTargets.targets.length, 1);

  // Duplicate.
  await assert.rejects(
    () => svc.setTargets('5', post.id, [{ socialAccountId: acc.id }, { socialAccountId: acc.id }]),
    /Duplicate/,
  );
  // Not owned.
  await assert.rejects(() => svc.setTargets('5', post.id, [{ socialAccountId: '999' }]), /invalid/i);
  // Revoked.
  const revoked = await seedAccount(socialAccounts, { id: 'acc_revoked', status: 'revoked' });
  await assert.rejects(() => svc.setTargets('5', post.id, [{ socialAccountId: revoked.id }]), /not active/i);
});

test('generateContent generates only for selected platforms and saves captions', async () => {
  const { svc, socialAccounts, openai } = build();
  const acc = await seedAccount(socialAccounts, { provider: 'threads', accountType: 'threads_profile' });
  const post = await svc.createDraft('5', { brief: 'Launch our app', brandName: 'Acme' });
  await svc.setTargets('5', post.id, [{ socialAccountId: acc.id }]);

  const result = await svc.generateContent('5', post.id);
  assert.deepEqual(openai._calls[0].input.targetPlatforms, ['threads']);
  assert.ok(result.platformCaptions.threads.caption);
  assert.equal(result.platformCaptions.facebook, undefined); // only requested platform
  assert.ok(result.imageHeadline);
});

test('generateContent enforces the daily generation limit', async () => {
  const apiUsage = createFakeApiUsageRepository({ forcedCount: 100 });
  const { svc, socialAccounts } = build({ apiUsage });
  const acc = await seedAccount(socialAccounts);
  const post = await svc.createDraft('5', { brief: 'x' });
  await svc.setTargets('5', post.id, [{ socialAccountId: acc.id }]);
  await assert.rejects(() => svc.generateContent('5', post.id), /limit/i);
});

test('generateImage requires a headline, then attaches a media asset', async () => {
  const { svc, socialAccounts } = build();
  const acc = await seedAccount(socialAccounts);
  const post = await svc.createDraft('5', { brief: 'x', template: 'bold', aspectRatio: 'portrait' });
  await svc.setTargets('5', post.id, [{ socialAccountId: acc.id }]);

  // No headline yet.
  await assert.rejects(() => svc.generateImage('5', post.id), /headline/i);

  await svc.generateContent('5', post.id);
  const withImage = await svc.generateImage('5', post.id);
  assert.ok(withImage.mediaAssetId);
  assert.ok(withImage.media.publicToken);
  assert.equal(withImage.media.status, 'ready');
});

test('schedulePost converts Asia/Karachi local time to correct UTC and queues', async () => {
  const { svc, socialAccounts } = build();
  const acc = await seedAccount(socialAccounts, { provider: 'threads', accountType: 'threads_profile' });
  const post = await svc.createDraft('5', { brief: 'x' });
  await svc.setTargets('5', post.id, [{ socialAccountId: acc.id }]);
  await svc.generateContent('5', post.id);

  const scheduled = await svc.schedulePost('5', post.id, {
    scheduledDate: '2999-06-01',
    scheduledTime: '14:30',
    timezone: 'Asia/Karachi', // UTC+5, no DST
  });
  assert.equal(scheduled.status, 'queued');
  assert.equal(scheduled.originalTimezone, 'Asia/Karachi');
  // 14:30 PKT == 09:30 UTC
  const utc = fromMysqlUtc(scheduled.scheduledAtUtc);
  assert.equal(utc.getUTCHours(), 9);
  assert.equal(utc.getUTCMinutes(), 30);
  assert.match(scheduled.notice, /queued/i);
  // Nothing published.
  assert.equal(scheduled.targets.every((t) => t.status === 'pending'), true);
});

test('schedulePost rejects past time, missing captions, and IG without image', async () => {
  const { svc, socialAccounts } = build();
  const threads = await seedAccount(socialAccounts, { provider: 'threads', accountType: 'threads_profile', id: 't1' });
  const post = await svc.createDraft('5', { brief: 'x' });
  await svc.setTargets('5', post.id, [{ socialAccountId: threads.id }]);

  // No captions generated yet.
  await assert.rejects(
    () => svc.schedulePost('5', post.id, { scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC' }),
    /caption/i,
  );

  await svc.generateContent('5', post.id);
  // Past time.
  await assert.rejects(
    () => svc.schedulePost('5', post.id, { scheduledDate: '2000-01-01', scheduledTime: '10:00', timezone: 'UTC' }),
    /future/i,
  );

  // Instagram requires an image.
  const ig = await seedAccount(socialAccounts, { provider: 'instagram', accountType: 'instagram_professional', id: 'ig1' });
  await svc.setTargets('5', post.id, [{ socialAccountId: ig.id }]);
  await svc.generateContent('5', post.id);
  await assert.rejects(
    () => svc.schedulePost('5', post.id, { scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC' }),
    /Instagram/i,
  );
});

test('cancel and delete; ownership isolation', async () => {
  const { svc, socialAccounts } = build();
  const acc = await seedAccount(socialAccounts);
  const post = await svc.createDraft('5', { brief: 'x' });
  await svc.setTargets('5', post.id, [{ socialAccountId: acc.id }]);
  await svc.generateContent('5', post.id);
  await svc.schedulePost('5', post.id, { scheduledDate: '2999-06-01', scheduledTime: '10:00', timezone: 'UTC' });

  // Another user cannot touch it.
  await assert.rejects(() => svc.getPost('999', post.id), /not found/i);
  await assert.rejects(() => svc.cancelPost('999', post.id), /not found/i);

  const cancelled = await svc.cancelPost('5', post.id);
  assert.equal(cancelled.status, 'cancelled');

  const draft = await svc.createDraft('5', { brief: 'y' });
  const del = await svc.deleteDraft('5', draft.id);
  assert.equal(del.deleted, true);
});
