import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { createMediaLibraryService } from '../src/services/mediaLibraryService.js';
import { createMediaStorage } from '../src/services/mediaStorage.js';
import { createMediaUploadMiddleware } from '../src/middleware/mediaUpload.js';
import { createFakeOverrides, createFakeMediaAssetRepository } from './helpers/fakes.js';
import { getCsrf } from './helpers/apiHarness.js';
import { pngBytes, gifBytes, jpegBytes } from './helpers/imageBytes.js';

const roots = [];
async function buildApp(extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cyflow-routes-test-'));
  roots.push(root);
  const mediaRepository = createFakeMediaAssetRepository();
  const storage = createMediaStorage({ driver: 'local', root });
  const mediaLibraryService = createMediaLibraryService({ mediaRepository, storage });
  const app = createApp(createFakeOverrides({ mediaAssetRepository: mediaRepository, mediaLibraryService, ...extra }));
  return { app, mediaRepository, storage, root };
}

test.after(async () => { for (const r of roots) await fs.rm(r, { recursive: true, force: true }); });

async function signIn(app, email) {
  const agent = request.agent(app);
  const t1 = await getCsrf(agent);
  await agent.post('/api/auth/register').set('X-CSRF-Token', t1).send({
    name: 'User', email, password: 'Sup3r-Secret-Pass', timezone: 'UTC',
  });
  const csrf = await getCsrf(agent);
  return { agent, csrf };
}

const attachPng = (req, buf = pngBytes(120, 90)) =>
  req.attach('image', buf, { filename: 'photo.png', contentType: 'image/png' });

test('upload requires authentication', async () => {
  const { app } = await buildApp();
  const res = await attachPng(request(app).post('/api/media'));
  assert.equal(res.status, 401);
});

test('upload requires a CSRF token', async () => {
  const { app } = await buildApp();
  const { agent } = await signIn(app, 'nocsrf@example.com');
  const res = await attachPng(agent.post('/api/media')); // no X-CSRF-Token
  assert.equal(res.status, 403);
});

test('a valid PNG uploads (201) and the response leaks no storage key or path', async () => {
  const { app, root } = await buildApp();
  const { agent, csrf } = await signIn(app, 'ok@example.com');
  const res = await attachPng(agent.post('/api/media').set('X-CSRF-Token', csrf));
  assert.equal(res.status, 201);
  const media = res.body.data.media;
  assert.equal(media.source, 'upload');
  assert.equal(media.width, 120);
  assert.equal(media.height, 90);
  assert.match(media.url, /^\/media\//);
  const body = JSON.stringify(res.body);
  assert.doesNotMatch(body, /storageKey|storage_key/);
  assert.doesNotMatch(body, new RegExp(path.basename(root)));
});

test('a GIF upload is refused with a named, user-safe reason', async () => {
  const { app } = await buildApp();
  const { agent, csrf } = await signIn(app, 'gif@example.com');
  const res = await agent.post('/api/media').set('X-CSRF-Token', csrf)
    .attach('image', gifBytes(), { filename: 'a.gif', contentType: 'image/gif' });
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /GIF/i);
});

test('a file on an unexpected field is rejected, not parsed', async () => {
  const { app } = await buildApp();
  const { agent, csrf } = await signIn(app, 'field@example.com');
  const res = await agent.post('/api/media').set('X-CSRF-Token', csrf)
    .attach('avatar', pngBytes(40, 40), { filename: 'x.png', contentType: 'image/png' });
  assert.equal(res.status, 400);
});

test('two files are rejected: one image at a time', async () => {
  const { app } = await buildApp();
  const { agent, csrf } = await signIn(app, 'two@example.com');
  const res = await agent.post('/api/media').set('X-CSRF-Token', csrf)
    .attach('image', pngBytes(40, 40), { filename: 'a.png', contentType: 'image/png' })
    .attach('image', pngBytes(50, 50), { filename: 'b.png', contentType: 'image/png' });
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /one image/i);
});

test('the multer byte ceiling refuses an oversized body at parse time', async () => {
  // A tiny ceiling proves the parse-time gate fires before the validator.
  const parseSingleImage = createMediaUploadMiddleware({ config: { media: { maxUploadBytes: 64 } } });
  const { app } = await buildApp({ parseSingleImage });
  const { agent, csrf } = await signIn(app, 'big@example.com');
  const res = await attachPng(agent.post('/api/media').set('X-CSRF-Token', csrf), pngBytes(200, 200));
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /too large/i);
});

test('list returns the user’s own uploads', async () => {
  const { app } = await buildApp();
  const { agent, csrf } = await signIn(app, 'list@example.com');
  await attachPng(agent.post('/api/media').set('X-CSRF-Token', csrf));
  const res = await agent.get('/api/media');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.media.length, 1);
});

test('one user cannot read or delete another user’s asset (404, no side effect)', async () => {
  const { app, mediaRepository } = await buildApp();
  const a = await signIn(app, 'owner@example.com');
  const b = await signIn(app, 'intruder@example.com');
  const up = await attachPng(a.agent.post('/api/media').set('X-CSRF-Token', a.csrf));
  const id = up.body.data.media.id;

  const get = await b.agent.get(`/api/media/${id}`);
  assert.equal(get.status, 404);
  const before = mediaRepository._rows.length;
  const del = await b.agent.delete(`/api/media/${id}`).set('X-CSRF-Token', b.csrf);
  assert.equal(del.status, 404);
  assert.equal(mediaRepository._rows.length, before); // nothing deleted
});

test('alt text can be updated on an owned asset', async () => {
  const { app } = await buildApp();
  const { agent, csrf } = await signIn(app, 'alt@example.com');
  const up = await attachPng(agent.post('/api/media').set('X-CSRF-Token', csrf));
  const id = up.body.data.media.id;
  const res = await agent.patch(`/api/media/${id}`).set('X-CSRF-Token', csrf).send({ altText: 'A red bicycle' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.media.altText, 'A red bicycle');
});

test('an in-use asset cannot be deleted (409), but deletes after detach (200)', async () => {
  const { app } = await buildApp();
  const { agent, csrf } = await signIn(app, 'inuse@example.com');
  const up = await attachPng(agent.post('/api/media').set('X-CSRF-Token', csrf));
  const id = up.body.data.media.id;
  await agent.post(`/api/media/${id}/attach`).set('X-CSRF-Token', csrf)
    .send({ referenceType: 'scheduled_post', referenceId: '3' });

  const blocked = await agent.delete(`/api/media/${id}`).set('X-CSRF-Token', csrf);
  assert.equal(blocked.status, 409);
  assert.match(JSON.stringify(blocked.body), /used by 1 post/i);

  await agent.post(`/api/media/${id}/detach`).set('X-CSRF-Token', csrf)
    .send({ referenceType: 'scheduled_post', referenceId: '3' });
  const ok = await agent.delete(`/api/media/${id}`).set('X-CSRF-Token', csrf);
  assert.equal(ok.status, 200);
});

test('the token content route serves uploaded bytes with safe headers, no HCTI', async () => {
  const { app } = await buildApp();
  const { agent, csrf } = await signIn(app, 'serve@example.com');
  const up = await attachPng(agent.post('/api/media').set('X-CSRF-Token', csrf), pngBytes(64, 48));
  const token = up.body.data.media.publicToken;
  const res = await agent.get(`/media/${token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /image\/png/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(Number(res.headers['content-length']) > 0);
});
