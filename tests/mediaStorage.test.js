import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createMediaStorage, generateStorageKey, MediaStorageError,
} from '../src/services/mediaStorage.js';

async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cyflow-store-test-'));
}

test('generates a 32-char lowercase-hex storage key', () => {
  const key = generateStorageKey();
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.notEqual(generateStorageKey(), key); // random
});

test('stores and reads back the exact bytes', async () => {
  const root = await tmpRoot();
  const store = createMediaStorage({ driver: 'local', root });
  const bytes = Buffer.from([1, 2, 3, 4, 5, 250, 251, 252]);
  const key = await store.storeValidatedImage(bytes);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.ok(await store.imageExists(key));
  assert.deepEqual(await store.readImage(key), bytes);
  await fs.rm(root, { recursive: true, force: true });
});

test('shards files by the first two key chars, under the root', async () => {
  const root = await tmpRoot();
  const store = createMediaStorage({ driver: 'local', root });
  const key = await store.storeValidatedImage(Buffer.from('hello'));
  const expected = path.resolve(root, key.slice(0, 2), key);
  const stat = await fs.stat(expected);
  assert.ok(stat.isFile(), 'bytes live at the sharded path inside the root');
  await fs.rm(root, { recursive: true, force: true });
});

test('refuses to overwrite an existing key (wx)', async () => {
  const root = await tmpRoot();
  const store = createMediaStorage({ driver: 'local', root });
  const key = generateStorageKey();
  await store.storeValidatedImage(Buffer.from('one'), { storageKey: key });
  await assert.rejects(
    () => store.storeValidatedImage(Buffer.from('two'), { storageKey: key }),
    /EEXIST|exist/i,
  );
  assert.deepEqual(await store.readImage(key), Buffer.from('one')); // unchanged
  await fs.rm(root, { recursive: true, force: true });
});

test('removeStoredImage deletes bytes; a second remove is a no-op, not an error', async () => {
  const root = await tmpRoot();
  const store = createMediaStorage({ driver: 'local', root });
  const key = await store.storeValidatedImage(Buffer.from('bytes'));
  assert.equal(await store.removeStoredImage(key), true);
  assert.equal(await store.imageExists(key), false);
  assert.equal(await store.removeStoredImage(key), false);
  await fs.rm(root, { recursive: true, force: true });
});

test('reading a missing key throws NOT_FOUND, not a raw fs error', async () => {
  const root = await tmpRoot();
  const store = createMediaStorage({ driver: 'local', root });
  await assert.rejects(
    () => store.readImage(generateStorageKey()),
    (e) => e instanceof MediaStorageError && e.code === 'NOT_FOUND',
  );
  await fs.rm(root, { recursive: true, force: true });
});

for (const bad of [
  '../etc/passwd',
  '..\\..\\windows',
  'abc/../../../etc',
  'ABCDEF0123456789abcdef0123456789', // uppercase not allowed by the pattern
  'short',
  '/absolute/path',
  'zz34567890123456789012345678901g', // non-hex char
  '',
]) {
  test(`rejects a non-key path fragment: ${JSON.stringify(bad)}`, async () => {
    const root = await tmpRoot();
    const store = createMediaStorage({ driver: 'local', root });
    await assert.rejects(() => store.readImage(bad), (e) => e instanceof MediaStorageError);
    await assert.rejects(() => store.storeValidatedImage(Buffer.from('x'), { storageKey: bad }), (e) => e instanceof MediaStorageError);
    await fs.rm(root, { recursive: true, force: true });
  });
}

test('an unsupported driver fails loudly rather than silently dropping bytes', () => {
  assert.throws(
    () => createMediaStorage({ driver: 's3', root: '/tmp/x' }),
    (e) => e instanceof MediaStorageError && e.code === 'UNSUPPORTED_DRIVER',
  );
});

test('a missing root is an operator error, surfaced not papered over', () => {
  assert.throws(
    () => createMediaStorage({ driver: 'local', root: '' }),
    (e) => e instanceof MediaStorageError && e.code === 'NO_ROOT',
  );
});

test('a stored file never escapes the configured root', async () => {
  const root = await tmpRoot();
  const store = createMediaStorage({ driver: 'local', root });
  const key = await store.storeValidatedImage(Buffer.from('inside'));
  const resolved = path.resolve(root, key.slice(0, 2), key);
  assert.ok(resolved.startsWith(path.resolve(root) + path.sep));
  await fs.rm(root, { recursive: true, force: true });
});
