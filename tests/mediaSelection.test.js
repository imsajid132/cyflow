import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { validationResult } from 'express-validator';

import { createPlannerService } from '../src/services/plannerService.js';
import { createPostService } from '../src/services/postService.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';
import { setItemMediaValidator } from '../src/validators/plannerValidators.js';
import { selectMediaValidator } from '../src/validators/postValidators.js';
import { NotFoundError } from '../src/utils/errors.js';
import {
  createFakeSocialAccountRepository,
  createFakePostRepository,
  createFakeMediaAssetRepository,
  createFakeApiUsageRepository,
  createFakeBusinessProfileRepository,
  createFakePlannerPreferenceRepository,
  createFakePlannerRunRepository,
  createFakePlannerOpenAI,
  createFakeSocialImageService,
  createFakeIntegrationRepository,
  createFakeOpenAIContentService,
  fakeWithTransaction,
} from './helpers/fakes.js';

const noopLogging = { record: async () => {} };
const USER = '5';
const OTHER = '9';

// --- validator regression: numeric ids accepted, non-numeric rejected --------
// This is the exact guard for the dropped-backslash bug (/^d{1,20}$/ matched the
// LETTER d, so every real media id was rejected as "Invalid media id").

async function runChain(chain, { params = {}, body = {} }) {
  const req = { params, body, query: {}, cookies: {} };
  for (const v of chain) await v.run(req);
  return validationResult(req);
}

test('planner setItemMediaValidator accepts a numeric media id', async () => {
  const result = await runChain(setItemMediaValidator, { params: { itemId: '7' }, body: { mediaAssetId: '42' } });
  assert.ok(result.isEmpty(), `expected no errors, got ${JSON.stringify(result.array())}`);
});

test('planner setItemMediaValidator accepts null (clear the image)', async () => {
  const result = await runChain(setItemMediaValidator, { params: { itemId: '7' }, body: { mediaAssetId: null } });
  assert.ok(result.isEmpty());
});

test('planner setItemMediaValidator rejects a non-numeric media id', async () => {
  const result = await runChain(setItemMediaValidator, { params: { itemId: '7' }, body: { mediaAssetId: 'not-a-number' } });
  assert.ok(!result.isEmpty());
  assert.ok(result.array().some((e) => e.path === 'mediaAssetId'));
});

test('planner setItemMediaValidator rejects the literal letter "d" (the old bug’s only match)', async () => {
  const result = await runChain(setItemMediaValidator, { params: { itemId: '7' }, body: { mediaAssetId: 'd' } });
  assert.ok(!result.isEmpty(), 'a broken /^d+$/ regex would have accepted "d"');
});

test('post selectMediaValidator accepts a numeric id and null, rejects garbage', async () => {
  assert.ok((await runChain(selectMediaValidator, { params: { id: '1' }, body: { mediaAssetId: '3' } })).isEmpty());
  assert.ok((await runChain(selectMediaValidator, { params: { id: '1' }, body: { mediaAssetId: null } })).isEmpty());
  assert.ok(!(await runChain(selectMediaValidator, { params: { id: '1' }, body: { mediaAssetId: 'xyz' } })).isEmpty());
});

// --- planner service: setItemMedia moves references, never touches OpenAI/HCTI -

function buildPlanner() {
  const socialAccounts = createFakeSocialAccountRepository();
  const posts = createFakePostRepository({ socialAccounts });
  const media = createFakeMediaAssetRepository();
  const runs = createFakePlannerRunRepository();
  const openai = createFakePlannerOpenAI();
  const images = createFakeSocialImageService();
  const svc = createPlannerService({
    preferences: createFakePlannerPreferenceRepository(),
    runs,
    businessProfiles: createFakeBusinessProfileRepository(),
    socialAccounts,
    posts,
    mediaRepository: media,
    apiUsage: createFakeApiUsageRepository(),
    openaiContentService: openai,
    socialImageService: images,
    mediaAssetService: createMediaAssetService({ mediaRepository: media }),
    uniqueness: contentUniquenessService,
    logging: noopLogging,
    withTransaction: fakeWithTransaction,
  });
  return { svc, runs, media, openai, images };
}

let tokenSeq = 0;
async function seedUploadedAsset(media, userId) {
  tokenSeq += 1;
  return media.createMediaAsset({
    userId,
    publicToken: `tok_${userId}_${tokenSeq}`,
    sourceProvider: 'upload',
    status: 'ready',
    storageDriver: 'local',
    storageKey: 'a'.repeat(32),
    mimeType: 'image/png',
    fileExtension: 'png',
    width: 100,
    height: 100,
    checksumSha256: `sum-${userId}`,
  });
}

async function seedItem(runs, userId) {
  const run = await runs.createRun({ userId, status: 'ready' });
  const item = await runs.createItem({ plannerRunId: run.id, userId, caption: 'Hello', platformTargets: ['instagram'] });
  return item;
}

test('setItemMedia attaches an uploaded asset and exposes it, no generation calls', async () => {
  const { svc, runs, media, openai, images } = buildPlanner();
  let generated = false;
  openai.generateContent = async () => { generated = true; return {}; };
  images.renderForUser = async () => { generated = true; return {}; };

  const item = await seedItem(runs, USER);
  const asset = await seedUploadedAsset(media, USER);

  const updated = await svc.setItemMedia(USER, item.id, asset.id);
  assert.equal(updated.media?.publicToken, asset.publicToken);
  assert.equal(media._refs.filter((r) => r.reference_type === 'planner_run_item' && r.media_asset_id === asset.id).length, 1);
  assert.equal(generated, false); // uploaded media needs no OpenAI or HCTI
});

test('setItemMedia with null clears the image and detaches the reference', async () => {
  const { svc, runs, media } = buildPlanner();
  const item = await seedItem(runs, USER);
  const asset = await seedUploadedAsset(media, USER);
  await svc.setItemMedia(USER, item.id, asset.id);
  assert.equal(media._refs.length, 1);

  const cleared = await svc.setItemMedia(USER, item.id, null);
  assert.equal(cleared.media, null);
  assert.equal(media._refs.length, 0); // reference removed
});

test('setItemMedia refuses another user’s asset (NotFound, no attach)', async () => {
  const { svc, runs, media } = buildPlanner();
  const item = await seedItem(runs, USER);
  const theirs = await seedUploadedAsset(media, OTHER);
  await assert.rejects(() => svc.setItemMedia(USER, item.id, theirs.id), (e) => e instanceof NotFoundError);
  assert.equal(media._refs.length, 0);
});

// --- post service: selectMedia -------------------------------------------------

function buildPosts() {
  const socialAccounts = createFakeSocialAccountRepository();
  const posts = createFakePostRepository({ socialAccounts });
  const media = createFakeMediaAssetRepository();
  const svc = createPostService({
    posts,
    socialAccounts,
    mediaRepository: media,
    apiUsage: createFakeApiUsageRepository(),
    integrationRepository: createFakeIntegrationRepository(),
    businessProfiles: createFakeBusinessProfileRepository(),
    openaiContentService: createFakeOpenAIContentService(),
    socialImageService: createFakeSocialImageService(),
    mediaAssetService: createMediaAssetService({ mediaRepository: media }),
    logging: noopLogging,
    withTransaction: fakeWithTransaction,
  });
  return { svc, posts, media };
}

test('post selectMedia attaches an uploaded asset to a draft', async () => {
  const { svc, media } = buildPosts();
  const draft = await svc.createDraft(USER, { brief: 'A cosy coffee shop autumn promo for regulars.' });
  const asset = await seedUploadedAsset(media, USER);
  const updated = await svc.selectMedia(USER, draft.id, asset.id);
  assert.equal(updated.media?.publicToken, asset.publicToken);
  assert.equal(media._refs.filter((r) => r.reference_type === 'scheduled_post').length, 1);
});

test('post selectMedia with null clears the attached image', async () => {
  const { svc, media } = buildPosts();
  const draft = await svc.createDraft(USER, { brief: 'A cosy coffee shop autumn promo for regulars.' });
  const asset = await seedUploadedAsset(media, USER);
  await svc.selectMedia(USER, draft.id, asset.id);
  const cleared = await svc.selectMedia(USER, draft.id, null);
  assert.equal(cleared.media, null);
  assert.equal(media._refs.length, 0);
});

test('post selectMedia refuses another user’s asset (NotFound)', async () => {
  const { svc, media } = buildPosts();
  const draft = await svc.createDraft(USER, { brief: 'A cosy coffee shop autumn promo for regulars.' });
  const theirs = await seedUploadedAsset(media, OTHER);
  await assert.rejects(() => svc.selectMedia(USER, draft.id, theirs.id), (e) => e instanceof NotFoundError);
});
