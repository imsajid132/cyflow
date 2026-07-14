import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

import { parseSignedRequest } from '../src/utils/signedRequest.js';

const SECRET = 'threads-app-secret-value';

function encode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function sign(encodedPayload, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}
function makeSignedRequest(payload, secret = SECRET) {
  const encodedPayload = encode({ algorithm: 'HMAC-SHA256', issued_at: 1730000000, ...payload });
  return `${sign(encodedPayload, secret)}.${encodedPayload}`;
}

test('signed_request: parses a valid request and returns the payload', () => {
  const sr = makeSignedRequest({ user_id: '123456' });
  const payload = parseSignedRequest(sr, SECRET);
  assert.equal(payload.user_id, '123456');
  assert.equal(payload.algorithm, 'HMAC-SHA256');
});

test('signed_request: rejects a tampered signature', () => {
  const sr = makeSignedRequest({ user_id: '1' });
  const [, payload] = sr.split('.');
  const forged = `${sign('different-payload')}.${payload}`;
  assert.throws(() => parseSignedRequest(forged, SECRET), /signed_request/i);
});

test('signed_request: rejects a tampered payload', () => {
  const sr = makeSignedRequest({ user_id: '1' });
  const [sig] = sr.split('.');
  const other = encode({ algorithm: 'HMAC-SHA256', user_id: '999' });
  assert.throws(() => parseSignedRequest(`${sig}.${other}`, SECRET), /signed_request/i);
});

test('signed_request: rejects the wrong secret', () => {
  const sr = makeSignedRequest({ user_id: '1' });
  assert.throws(() => parseSignedRequest(sr, 'not-the-secret'), /signature/i);
});

test('signed_request: rejects malformed input and empty secret', () => {
  assert.throws(() => parseSignedRequest('no-dot-here', SECRET), /Malformed/);
  assert.throws(() => parseSignedRequest('a.b.c', SECRET), /Malformed/);
  assert.throws(() => parseSignedRequest('', SECRET), /Missing/);
  assert.throws(() => parseSignedRequest(makeSignedRequest({ user_id: '1' }), ''), /verified/);
});

test('signed_request: rejects an unsupported algorithm', () => {
  const encodedPayload = encode({ algorithm: 'PLAINTEXT', user_id: '1' });
  const sr = `${sign(encodedPayload)}.${encodedPayload}`;
  assert.throws(() => parseSignedRequest(sr, SECRET), /algorithm/i);
});

export { makeSignedRequest };
