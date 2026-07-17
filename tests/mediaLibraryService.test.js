import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMediaLibraryService } from '../src/services/mediaLibraryService.js';
import { createMediaStorage } from '../src/services/mediaStorage.js';
import { NotFoundError, ConflictError, ValidationError } from '../src/utils/errors.js';
import { createFakeMediaAssetRepository } from './helpers/fakes.js';
import { pngBytes, jpegBytes, gifBytes } from './helpers/imageBytes.js';

const USER = '10';
const OTHER = '20';

async function build() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cyflow-lib-test-'));
  const mediaRepository = createFakeMediaAssetRepository();
  const storage = createMediaStorage({ driver: 'local', root });
  const events = [];
  const logging = { record: async (type, payload) => { events.push({ type, payload }); } };
  const service = createMediaLibraryService({ mediaRepository, storage, logging });
  return { service, mediaRepository, storage, root, events, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

const upload = (service, userId, buffer, originalName = 'photo.png', declaredMime = 'image/png') =>
  service.uploadImage(userId, { buffer, originalName, declaredMime });

test('uploadImage stores bytes and returns a public shape without the storage key', async () => {
  const { service, storage, cleanup } = await build();
  const asset = await upload(service, USER, pngBytes(100, 80));
  assert.equal(asset.source, 'upload');
  assert.equal(asset.width, 100);
  assert.equal(asset.height, 80);
  assert.equal(asset.mimeType, 'image/png');
  assert.match(asset.url, /^\/media\//);
  // The public object must not leak the storage key or a filesystem path.
  const json = JSON.stringify(asset);
  assert.doesNotMatch(json, /storageKey|storage_key/);
  assert.doesNotMatch(json, /[/\\]cyflow-lib-test-/);
  assert.equal(storage.root, path.resolve(storage.root));
  await cleanup();
});

test('a rejected upload never touches storage and raises a ValidationError', async () => {
  const { service, root, cleanup } = await build();
  await assert.rejects(() => upload(service, USER, gifBytes(), 'a.gif', 'image/gif'), (e) => e instanceof ValidationError);
  // Nothing was written under the root.
  const shards = await fs.readdir(root).catch(() => []);
  assert.equal(shards.length, 0);
  await cleanup();
});

test('content dedup is user-scoped: same bytes from the same user reuse one asset', async () => {
  const { service, mediaRepository, cleanup } = await build();
  const bytes = pngBytes(64, 64);
  const first = await upload(service, USER, bytes);
  const second = await upload(service, USER, bytes);
  assert.equal(first.id, second.id); // same asset, not a duplicate
  assert.equal(mediaRepository._rows.length, 1);
  await cleanup();
});

test('dedup never reveals that ANOTHER user uploaded the same bytes', async () => {
  const { service, mediaRepository, cleanup } = await build();
  const bytes = pngBytes(64, 64);
  const mine = await upload(service, USER, bytes);
  const theirs = await upload(service, OTHER, bytes);
  assert.notEqual(mine.id, theirs.id); // each user gets their own asset
  assert.equal(mediaRepository._rows.length, 2);
  await cleanup();
});

test('getMedia on another user’s asset is NotFound, identical to a missing one', async () => {
  const { service, cleanup } = await build();
  const mine = await upload(service, USER, pngBytes(48, 48));
  await assert.rejects(() => service.getMedia(OTHER, mine.id), (e) => e instanceof NotFoundError);
  await assert.rejects(() => service.getMedia(USER, '999999'), (e) => e instanceof NotFoundError);
  await cleanup();
});

test('a cross-user delete makes no changes: the asset and its bytes remain', async () => {
  const { service, mediaRepository, storage, cleanup } = await build();
  const mine = await upload(service, USER, pngBytes(48, 48));
  const before = mediaRepository._rows.length;
  await assert.rejects(() => service.deleteMedia(OTHER, mine.id), (e) => e instanceof NotFoundError);
  assert.equal(mediaRepository._rows.length, before); // unchanged
  // Bytes still readable by the owner.
  const bytes = await service.readByPublicToken(mine.publicToken);
  assert.ok(bytes && bytes.buffer.length > 0);
  await cleanup();
});

test('attach is idempotent and reference-counted', async () => {
  const { service, cleanup } = await build();
  const a = await upload(service, USER, pngBytes(48, 48));
  const r1 = await service.attach(USER, a.id, 'planner_run_item', '5');
  const r2 = await service.attach(USER, a.id, 'planner_run_item', '5');
  assert.equal(r1.created, true);
  assert.equal(r2.created, false); // duplicate attach is one row
  await cleanup();
});

test('attach rejects an unsupported reference type', async () => {
  const { service, cleanup } = await build();
  const a = await upload(service, USER, pngBytes(48, 48));
  await assert.rejects(() => service.attach(USER, a.id, 'user_avatar', '1'), (e) => e instanceof ValidationError);
  await cleanup();
});

test('an in-use asset cannot be deleted; the error says where, without a DB id', async () => {
  const { service, cleanup } = await build();
  const a = await upload(service, USER, pngBytes(48, 48));
  await service.attach(USER, a.id, 'scheduled_post', '7');
  await assert.rejects(
    () => service.deleteMedia(USER, a.id),
    (e) => e instanceof ConflictError
      && /used by 1 post/i.test(e.message)
      && !e.message.includes('7'), // never leaks the private reference id
  );
  await cleanup();
});

test('after detaching, the asset deletes cleanly and its bytes are removed', async () => {
  const { service, storage, mediaRepository, cleanup } = await build();
  const a = await upload(service, USER, pngBytes(48, 48));
  await service.attach(USER, a.id, 'scheduled_post', '7');
  await service.detach(USER, a.id, 'scheduled_post', '7');
  const key = (await mediaRepository.findStorageKeyForAsset(a.id, USER)).storageKey;
  assert.ok(await storage.imageExists(key));
  const res = await service.deleteMedia(USER, a.id);
  assert.equal(res.deleted, true);
  assert.equal(await storage.imageExists(key), false); // bytes gone
  await assert.rejects(() => service.getMedia(USER, a.id), (e) => e instanceof NotFoundError);
  await cleanup();
});

test('updateAltText is owner-scoped and bounded to 500 chars', async () => {
  const { service, cleanup } = await build();
  const a = await upload(service, USER, pngBytes(48, 48));
  const updated = await service.updateAltText(USER, a.id, 'x'.repeat(600));
  assert.equal(updated.altText.length, 500);
  await assert.rejects(() => service.updateAltText(OTHER, a.id, 'nope'), (e) => e instanceof NotFoundError);
  await cleanup();
});

test('readByPublicToken returns local bytes with no HCTI dependency', async () => {
  const { service, cleanup } = await build();
  const a = await upload(service, USER, jpegBytes(60, 40), 'photo.jpg', 'image/jpeg');
  const out = await service.readByPublicToken(a.publicToken);
  assert.equal(out.driver, 'local');
  assert.equal(out.contentType, 'image/jpeg');
  assert.ok(out.buffer.length > 0);
  await cleanup();
});

test('readByPublicToken on an unknown token is null (honest unavailable)', async () => {
  const { service, cleanup } = await build();
  assert.equal(await service.readByPublicToken('nope_nope_nope'), null);
  await cleanup();
});
