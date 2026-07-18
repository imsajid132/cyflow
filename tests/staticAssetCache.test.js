// After a deployment the operator had to press Ctrl+F5 for "View upcoming" to
// open. Nothing was logged server-side because nothing was wrong server-side:
// every file under public/ was served with `maxAge: 1h` and no revalidation, so
// a browser could hold the app shell from the previous release while fetching
// freshly deployed modules (or the reverse) and end up running a module graph
// whose halves did not agree.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { readFileSync } from 'node:fs';

import { makeApp } from './helpers/apiHarness.js';

const { app } = makeApp();

test('the app shell always revalidates', async () => {
  const res = await request(app).get('/app.html');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-cache/,
    'a stale shell can reference modules that no longer exist');
  assert.ok(res.headers.etag, 'an ETag is what makes no-cache cheap: 304, no body');
});

test('every JavaScript module always revalidates', async () => {
  for (const path of [
    '/assets/js/router.js',
    '/assets/js/ui.js',
    '/assets/js/pages/plannerWeek.js',
    '/assets/js/components/plannerCard.js',
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).get(path);
    assert.equal(res.status, 200, `${path} must be served`);
    assert.match(res.headers['cache-control'], /no-cache/,
      `${path} must revalidate, or a deploy can mix two releases`);
  }
});

test('the stylesheet revalidates too', async () => {
  const res = await request(app).get('/assets/css/design-system.css');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-cache/);
});

test('an unchanged asset answers 304, so revalidation stays cheap', async () => {
  const first = await request(app).get('/assets/js/ui.js');
  const again = await request(app).get('/assets/js/ui.js').set('If-None-Match', first.headers.etag);
  assert.equal(again.status, 304, 'no-cache must still allow a conditional hit');
  assert.ok(!again.text, 'a 304 carries no body');
});

test('a changed asset is not served from a stale validator', async () => {
  const res = await request(app).get('/assets/js/ui.js').set('If-None-Match', '"not-the-current-etag"');
  assert.equal(res.status, 200, 'a mismatched validator must return the new file');
});

test('private API responses are not publicly cacheable', async () => {
  // A shared cache holding an authenticated response would serve one user's
  // data to another.
  const res = await request(app).get('/api/auth/me');
  const cacheControl = res.headers['cache-control'] || '';
  assert.ok(!/\bpublic\b/.test(cacheControl), 'user data must never be marked public');
});

test('the static config no longer blanket-caches the application', () => {
  // Guards the shape of the fix, not just today's headers.
  const source = new URL('../src/app.js', import.meta.url);
  const text = readFileSync(source, 'utf8');
  assert.doesNotMatch(text, /maxAge: config\.isProd \? '1h' : 0/,
    'the blanket one-hour cache is what mixed two releases together');
  assert.match(text, /setHeaders\(res, filePath\)/, 'per-file cache policy must be explicit');
  assert.match(text, /\.\(html\|js\|css\|json\)\$/i, 'the shell and module graph must be matched');
});
