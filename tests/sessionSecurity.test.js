// Load a valid test env before importing the app.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import session from 'express-session';

import { createApp } from '../src/app.js';
import { createFakeOverrides, createFakeLogRepository } from './helpers/fakes.js';
import { createLoggingService } from '../src/services/loggingService.js';
import { defaultCreds, getCsrf, STRONG_PASSWORD } from './helpers/apiHarness.js';

const COOKIE_NAME = 'cyflow_social_session';

function sessionCookieValue(res) {
  const setCookie = res.headers['set-cookie'] || [];
  for (const c of setCookie) {
    if (c.startsWith(`${COOKIE_NAME}=`)) {
      return c.split(';')[0].split('=')[1];
    }
  }
  return null;
}

function allSessions(store) {
  return new Promise((resolve, reject) => {
    store.all((err, sessions) => (err ? reject(err) : resolve(sessions)));
  });
}

test('CSRF: missing token on a state-changing request is 403', async () => {
  const app = createApp(createFakeOverrides());
  const agent = request.agent(app);
  await getCsrf(agent); // establish a session
  const res = await agent.post('/api/auth/register').send(defaultCreds());
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'CSRF_ERROR');
});

test('CSRF: invalid token is 403', async () => {
  const app = createApp(createFakeOverrides());
  const agent = request.agent(app);
  await getCsrf(agent);
  const res = await agent
    .post('/api/auth/register')
    .set('X-CSRF-Token', 'not-the-real-token')
    .send(defaultCreds());
  assert.equal(res.status, 403);
});

test('session fixation: the session id changes after registration', async () => {
  const app = createApp(createFakeOverrides());
  const agent = request.agent(app);
  const pre = await agent.get('/api/csrf-token');
  const sidBefore = sessionCookieValue(pre);
  const token = pre.body.data.csrfToken;

  const reg = await agent.post('/api/auth/register').set('X-CSRF-Token', token).send(defaultCreds());
  assert.equal(reg.status, 201);
  const sidAfter = sessionCookieValue(reg);

  assert.ok(sidBefore);
  assert.ok(sidAfter);
  assert.notEqual(sidBefore, sidAfter);
});

test('session stores only user id + csrf token, never a user record', async () => {
  const store = new session.MemoryStore();
  const app = createApp(createFakeOverrides({ sessionStore: store }));
  const agent = request.agent(app);
  const t = await getCsrf(agent);
  await agent.post('/api/auth/register').set('X-CSRF-Token', t).send(defaultCreds());

  const sessions = await allSessions(store);
  const authed = Object.values(sessions).find((s) => s.userId);
  assert.ok(authed, 'expected an authenticated session');
  assert.equal(typeof authed.userId, 'string');
  // Only cookie/userId/csrfToken are allowed keys.
  const keys = Object.keys(authed).sort();
  for (const k of keys) {
    assert.ok(['cookie', 'userId', 'csrfToken'].includes(k), `unexpected session key: ${k}`);
  }
  // Explicitly no user PII / secrets.
  const blob = JSON.stringify(authed);
  assert.equal(blob.includes('ada@example.com'), false);
  assert.equal(blob.includes('password'), false);
  assert.equal(blob.includes(STRONG_PASSWORD), false);
});

test('passwords are never present in auth responses', async () => {
  const app = createApp(createFakeOverrides());
  const agent = request.agent(app);
  const t = await getCsrf(agent);
  const reg = await agent.post('/api/auth/register').set('X-CSRF-Token', t).send(defaultCreds());
  const me = await agent.get('/api/auth/me');
  for (const res of [reg, me]) {
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes(STRONG_PASSWORD), false);
    assert.equal(blob.includes('password_hash'), false);
    assert.equal(/\$2[aby]\$/.test(blob), false); // no bcrypt hash leaked
  }
});

test('logging service redacts sensitive context before persisting', async () => {
  const logRepo = createFakeLogRepository();
  const logging = createLoggingService({ logRepository: logRepo });
  await logging.record('user.login_failed', {
    userId: '1',
    context: {
      email: 'ada@example.com',
      password: 'should-be-redacted',
      apiKey: 'secret-key',
      authorization: 'Bearer xyz',
    },
  });
  assert.equal(logRepo._entries.length, 1);
  const ctx = logRepo._entries[0].context;
  assert.equal(ctx.email, 'ada@example.com'); // not sensitive
  assert.equal(ctx.password, '[REDACTED]');
  assert.equal(ctx.apiKey, '[REDACTED]');
  assert.equal(ctx.authorization, '[REDACTED]');
});

test('login rate limiter (isolated) returns 429 after the limit', async () => {
  // Build a dedicated limiter to verify behavior without relying on the mounted
  // (test-mode passthrough) limiters or affecting other tests.
  const express = (await import('express')).default;
  const { createRateLimiter } = await import('../src/middleware/rateLimits.js');
  const app = express();
  app.use((req, res, next) => {
    req.id = 'test';
    next();
  });
  app.post('/x', createRateLimiter({ windowMs: 60_000, max: 3 }), (req, res) =>
    res.json({ ok: true }),
  );

  const agent = request.agent(app);
  for (let i = 0; i < 3; i++) {
    const ok = await agent.post('/x');
    assert.equal(ok.status, 200);
  }
  const limited = await agent.post('/x');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
});
