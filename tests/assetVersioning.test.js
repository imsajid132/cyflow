// Cache-busting asset versioning.
//
// This exists because of a real production failure: the host's CDN strips the
// `Cache-Control: no-cache` and `ETag` the app sets on its modules, and a
// browser given neither invents its own cache lifetime and stops revalidating —
// so a freshly deployed release kept running the PREVIOUS release's JavaScript
// (a new page was missing from the sidebar and its route redirected away). No
// server-side correctness fixes that, because the browser never asks again.
//
// The defence is a URL no cache has seen: the shell loads its entry point from
// /v/<version>/assets/..., and because ES imports are relative, the whole module
// graph inherits the prefix. These tests pin that behaviour.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp, ASSET_VERSION } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { computeAssetVersion } from '../src/utils/assetVersion.js';

const app = createApp();

test.after(async () => { await closePool(); });

test('the shell serves a versioned entry point and leaves no placeholder', async () => {
  const res = await request(app).get('/dashboard');
  assert.equal(res.status, 200);
  assert.ok(!res.text.includes('__ASSET_V__'), 'the placeholder must be substituted');
  assert.match(res.text, new RegExp(`/v/${ASSET_VERSION}/assets/js/main\\.js`), 'entry point is versioned');
  assert.match(res.text, new RegExp(`/v/${ASSET_VERSION}/assets/css/design-system\\.css`), 'stylesheet is versioned');
});

test('the shell itself is never cached, or it would pin an old version', async () => {
  const res = await request(app).get('/dashboard');
  assert.match(String(res.headers['cache-control']), /no-store/);
});

test('versioned asset URLs serve the current files', async () => {
  const js = await request(app).get(`/v/${ASSET_VERSION}/assets/js/router.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /javascript/);
  // The route table the browser actually receives — the exact thing that was
  // stale in production.
  assert.ok(js.text.includes("'/ai-studio'"), 'the served router carries the current routes');

  const css = await request(app).get(`/v/${ASSET_VERSION}/assets/css/design-system.css`);
  assert.equal(css.status, 200);
});

test('any version segment resolves, so an in-flight old shell keeps working', async () => {
  // A browser holding the previous shell for a few seconds after a deploy must
  // still be able to fetch what it asks for rather than hard-failing.
  const res = await request(app).get('/v/anyoldversion/assets/js/router.js');
  assert.equal(res.status, 200);
});

test('the unversioned path still serves assets (bookmarks, older shells)', async () => {
  const res = await request(app).get('/assets/js/router.js');
  assert.equal(res.status, 200);
  assert.match(String(res.headers['cache-control']), /no-cache/);
});

test('the version changes when an asset changes, and is stable when nothing does', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyflow-assets-'));
  try {
    mkdirSync(join(dir, 'js'), { recursive: true });
    const file = join(dir, 'js', 'a.js');
    writeFileSync(file, 'export const a = 1;');

    const first = computeAssetVersion(dir);
    assert.match(first, /^[0-9a-f]{10}$/, 'a short hex stamp');
    assert.equal(computeAssetVersion(dir), first, 'unchanged content keeps the version');

    // A different size guarantees a different stamp even if the clock is coarse.
    writeFileSync(file, 'export const a = 2; // changed, and longer than before');
    assert.notEqual(computeAssetVersion(dir), first, 'changed content changes the version');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable assets directory degrades instead of crashing the boot', () => {
  assert.equal(computeAssetVersion(join(tmpdir(), 'cyflow-does-not-exist-at-all')), 'static');
});
