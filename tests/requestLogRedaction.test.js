import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import morgan from 'morgan';

import { redactUrl } from '../src/utils/redaction.js';

test('redactUrl: redacts sensitive OAuth query params, preserves pathname', () => {
  const out = redactUrl('/api/oauth/meta/callback?code=SECRETCODE&state=STATEVAL&foo=bar');
  assert.match(out, /^\/api\/oauth\/meta\/callback\?/);
  assert.equal(out.includes('SECRETCODE'), false);
  assert.equal(out.includes('STATEVAL'), false);
  assert.match(out, /code=REDACTED/);
  assert.match(out, /state=REDACTED/);
  assert.match(out, /foo=bar/); // non-sensitive preserved
});

test('redactUrl: redacts tokens, client_secret, error_description', () => {
  const out = redactUrl(
    '/x?access_token=AT&refresh_token=RT&client_secret=CS&error_description=nope&keep=1',
  );
  assert.equal(out.includes('AT'), false);
  assert.equal(out.includes('RT'), false);
  assert.equal(out.includes('CS'), false);
  assert.equal(out.includes('nope'), false);
  assert.match(out, /keep=1/);
});

test('redactUrl: leaves query-less URLs unchanged', () => {
  assert.equal(redactUrl('/api/social-accounts'), '/api/social-accounts');
  assert.equal(redactUrl(''), '');
});

test('the HTTP logger writes a redacted line for OAuth callbacks', async () => {
  const lines = [];
  const app = express();
  app.use((req, res, next) => {
    req.id = 'test';
    next();
  });
  morgan.token('safeurl', (req) => redactUrl(req.originalUrl));
  app.use(morgan(':method :safeurl :status', { stream: { write: (line) => lines.push(line) } }));
  app.get('/api/oauth/meta/callback', (req, res) => res.json({ ok: true }));

  await request(app).get('/api/oauth/meta/callback?code=SUPERSECRETCODE&state=RAWSTATEVALUE');
  // morgan logs on response 'finish' — allow the event loop to flush it.
  await new Promise((r) => setTimeout(r, 30));

  const logged = lines.join('');
  assert.ok(logged.length > 0, 'expected a log line');
  assert.equal(logged.includes('SUPERSECRETCODE'), false);
  assert.equal(logged.includes('RAWSTATEVALUE'), false);
  assert.match(logged, /\/api\/oauth\/meta\/callback/);
  assert.match(logged, /code=REDACTED/);
  assert.match(logged, /200/);
});
