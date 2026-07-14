// Load a valid test env before importing the app (which loads config/env.js).
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';

const app = createApp();

test.after(async () => {
  await closePool();
});

test('GET /health returns a safe status envelope', async () => {
  const res = await request(app).get('/health');
  // 200 when a DB happens to be reachable, 503 otherwise — both are valid.
  assert.ok(res.status === 200 || res.status === 503, `unexpected status ${res.status}`);
  assert.equal(res.body.success, true);

  const d = res.body.data;
  assert.equal(typeof d.application, 'string');
  assert.ok(['ok', 'degraded'].includes(d.status));
  assert.equal(typeof d.version, 'string');
  assert.equal(typeof d.timestampUtc, 'string');
  assert.equal(typeof d.database.connected, 'boolean');
  assert.equal(typeof d.scheduler.enabled, 'boolean');
  assert.equal(typeof res.body.requestId, 'string');
});

test('GET /health does not leak secrets, db name, or env details', async () => {
  const res = await request(app).get('/health');
  const raw = JSON.stringify(res.body);
  // None of these test secrets/identifiers should appear anywhere in the body.
  assert.ok(!raw.includes('test-session-secret-value'));
  assert.ok(!raw.includes('test_password_value'));
  assert.ok(!raw.includes(process.env.ENCRYPTION_KEY_BASE64));
  assert.ok(!raw.includes('cyflow_social_test')); // DB name must not be exposed
  assert.ok(!raw.includes('DB_HOST'));
});

test('GET /health reflects database connectivity (unavailable in tests)', async () => {
  const res = await request(app).get('/health');
  // No MySQL is running for the test suite, so connectivity is false and the
  // endpoint reports degraded with a 503.
  assert.equal(res.body.data.database.connected, false);
  assert.equal(res.status, 503);
  assert.equal(res.body.data.status, 'degraded');
});

test('GET /api/csrf-token returns a token', async () => {
  const res = await request(app).get('/api/csrf-token');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(typeof res.body.data.csrfToken, 'string');
  assert.ok(res.body.data.csrfToken.length >= 16);
});

test('unknown API route returns a JSON 404 envelope', async () => {
  const res = await request(app).get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.equal(typeof res.body.requestId, 'string');
});

test('unknown page route returns the HTML 404 page', async () => {
  const res = await request(app).get('/definitely-not-a-page');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /Page not found/i);
});

test('GET / serves the landing page', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /Cyflow/i);
});
