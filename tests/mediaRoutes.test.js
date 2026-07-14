import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { createFakeOverrides, createFakeMediaAssetRepository } from './helpers/fakes.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TOKEN = 'tok_abcdef0123456789ABCD';

function imgResponse({ status = 200, contentType = 'image/png', bytes = PNG_BYTES, contentLength } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (h) => {
        const k = h.toLowerCase();
        if (k === 'content-type') return contentType;
        if (k === 'content-length') return contentLength != null ? String(contentLength) : String(bytes.length);
        return null;
      },
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function build({ sourceUrl = 'https://hcti.io/v1/image/x.png', expiresAt = null, status = 'ready', fetchResponse = imgResponse(), token = TOKEN } = {}) {
  const mediaRepo = createFakeMediaAssetRepository();
  await mediaRepo.createMediaAsset({
    userId: '5',
    publicToken: token,
    sourceProvider: 'hcti',
    sourceUrl,
    mimeType: 'image/png',
    fileExtension: 'png',
    status,
    expiresAt,
  });
  const fetchCalls = [];
  const fetchImpl = async (url, opts) => {
    fetchCalls.push({ url, opts });
    if (fetchResponse instanceof Error) throw fetchResponse;
    return fetchResponse;
  };
  const mediaAssetService = createMediaAssetService({ mediaRepository: mediaRepo, fetchImpl });
  const app = createApp(createFakeOverrides({ mediaAssetService, mediaAssetRepository: mediaRepo }));
  return { app, fetchCalls };
}

test('serves a ready asset with safe headers', async () => {
  const { app } = await build();
  const res = await request(app).get(`/media/${TOKEN}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /image\/png/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.headers['cache-control'], /max-age/);
});

test('rejects an invalid token format (placeholder 404)', async () => {
  const { app } = await build();
  const res = await request(app).get('/media/bad!token');
  assert.equal(res.status, 404);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('unknown token returns 404', async () => {
  const { app } = await build();
  const res = await request(app).get('/media/tok_doesnotexist0123456789');
  assert.equal(res.status, 404);
});

test('expired asset is not served', async () => {
  const { app } = await build({ expiresAt: '2000-01-01 00:00:00' });
  const res = await request(app).get(`/media/${TOKEN}`);
  assert.equal(res.status, 404);
});

test('SSRF: untrusted upstream host is refused and never fetched', async () => {
  const { app, fetchCalls } = await build({ sourceUrl: 'https://evil.example.com/x.png' });
  const res = await request(app).get(`/media/${TOKEN}`);
  assert.equal(res.status, 404);
  assert.equal(fetchCalls.length, 0); // never fetched
});

test('non-image upstream content-type is rejected', async () => {
  const { app } = await build({ fetchResponse: imgResponse({ contentType: 'text/html' }) });
  const res = await request(app).get(`/media/${TOKEN}`);
  assert.equal(res.status, 415);
});

test('oversized upstream content is rejected', async () => {
  const { app } = await build({ fetchResponse: imgResponse({ contentLength: 999999999 }) });
  const res = await request(app).get(`/media/${TOKEN}`);
  assert.equal(res.status, 413);
});
