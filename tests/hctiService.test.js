// Load a valid test env before importing anything that loads config/env.js.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { createHctiService } from '../src/services/hctiService.js';

const CREDS = { hctiUserId: 'user-abc', hctiApiKey: 'key-xyz-123' };

/** Build a fake fetch that records calls and returns a canned response. */
function fakeFetch({ status = 200, body = { url: 'https://hcti.io/img/x.png', id: 'img_1' }, throwErr = null } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (throwErr) throw throwErr;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  fn.calls = calls;
  return fn;
}

test('hcti: testCredentials succeeds and passes dynamic Basic auth', async () => {
  const fetchImpl = fakeFetch();
  const svc = createHctiService({ fetchImpl });
  const result = await svc.testCredentials(CREDS);

  assert.equal(result.success, true);
  assert.equal(result.imageId, 'img_1');

  // Basic auth constructed internally from the dynamic credentials.
  const auth = fetchImpl.calls[0].opts.headers.Authorization;
  assert.match(auth, /^Basic /);
  const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString('utf8');
  assert.equal(decoded, `${CREDS.hctiUserId}:${CREDS.hctiApiKey}`);
});

test('hcti: 401 classified as invalid_credentials (safe message)', async () => {
  const svc = createHctiService({ fetchImpl: fakeFetch({ status: 401 }) });
  const result = await svc.testCredentials(CREDS);
  assert.equal(result.success, false);
  assert.equal(result.classification, 'invalid_credentials');
  assert.equal(result.message.includes(CREDS.hctiApiKey), false);
});

test('hcti: 429 classified as rate_limited', async () => {
  const svc = createHctiService({ fetchImpl: fakeFetch({ status: 429 }) });
  const result = await svc.testCredentials(CREDS);
  assert.equal(result.success, false);
  assert.equal(result.classification, 'rate_limited');
});

test('hcti: 5xx classified as service_error', async () => {
  const svc = createHctiService({ fetchImpl: fakeFetch({ status: 503 }) });
  const result = await svc.testCredentials(CREDS);
  assert.equal(result.success, false);
  assert.equal(result.classification, 'service_error');
});

test('hcti: timeout/abort classified safely', async () => {
  const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const svc = createHctiService({ fetchImpl: fakeFetch({ throwErr: abortErr }) });
  const result = await svc.testCredentials(CREDS);
  assert.equal(result.success, false);
  assert.equal(result.classification, 'service_error');
});

test('hcti: generateImage throws classified, credential-free errors', async () => {
  const svc = createHctiService({ fetchImpl: fakeFetch({ status: 401 }) });
  await assert.rejects(
    () => svc.generateImage({ ...CREDS, html: '<div>hi</div>' }),
    (err) => {
      // Message must not contain the credentials.
      assert.equal(err.message.includes(CREDS.hctiUserId), false);
      assert.equal(err.message.includes(CREDS.hctiApiKey), false);
      return true;
    },
  );
});

test('hcti: generateImage returns imageId + url on success', async () => {
  const svc = createHctiService({ fetchImpl: fakeFetch() });
  const out = await svc.generateImage({ ...CREDS, html: '<div>hi</div>' });
  assert.equal(out.imageId, 'img_1');
  assert.equal(out.url, 'https://hcti.io/img/x.png');
});

test('hcti: incomplete provider response is a service error', async () => {
  const svc = createHctiService({ fetchImpl: fakeFetch({ body: { id: 'x' } }) }); // no url
  const result = await svc.testCredentials(CREDS);
  assert.equal(result.success, false);
  assert.equal(result.classification, 'service_error');
});
