// Load a valid test env before anything imports config/env.js.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  hashOAuthState,
  generateSecureToken,
  timingSafeEqual,
} from '../src/services/encryptionService.js';

test('encryption: round-trips plaintext', () => {
  const secret = 'hcti-api-key-123:with:colons and spaces 🎉';
  const enc = encryptSecret(secret);
  assert.match(enc, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.equal(decryptSecret(enc), secret);
});

test('encryption: same plaintext yields a different IV/ciphertext each time', () => {
  const secret = 'repeatable-plaintext';
  const a = encryptSecret(secret);
  const b = encryptSecret(secret);
  assert.notEqual(a, b, 'ciphertexts should differ');
  const ivA = a.split(':')[1];
  const ivB = b.split(':')[1];
  assert.notEqual(ivA, ivB, 'IVs should differ');
  // Both still decrypt to the same value.
  assert.equal(decryptSecret(a), secret);
  assert.equal(decryptSecret(b), secret);
});

test('encryption: rejects a tampered auth tag', () => {
  const enc = encryptSecret('important');
  const parts = enc.split(':');
  // Flip the auth tag to a different (valid-length) value.
  const tag = Buffer.from(parts[2], 'base64');
  tag[0] = tag[0] ^ 0xff;
  parts[2] = tag.toString('base64');
  const tampered = parts.join(':');
  assert.throws(() => decryptSecret(tampered));
});

test('encryption: rejects a tampered ciphertext body', () => {
  const enc = encryptSecret('important');
  const parts = enc.split(':');
  const body = Buffer.from(parts[3], 'base64');
  body[0] = body[0] ^ 0xff;
  parts[3] = body.toString('base64');
  assert.throws(() => decryptSecret(parts.join(':')));
});

test('encryption: rejects malformed payloads', () => {
  assert.throws(() => decryptSecret('not-a-ciphertext'));
  assert.throws(() => decryptSecret('v1:only:three'));
  assert.throws(() => decryptSecret('v2:aa:bb:cc')); // unsupported version
  assert.throws(() => decryptSecret(''));
  assert.throws(() => decryptSecret(null));
});

test('encryption: rejects ciphertext produced with a different key', () => {
  // Build a valid-format envelope using a DIFFERENT key; decryptSecret uses the
  // configured key and must fail the auth-tag check.
  const wrongKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', wrongKey, iv);
  const ct = Buffer.concat([cipher.update('secret', 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const foreign = `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
  assert.throws(() => decryptSecret(foreign));
});

test('encryption: hashOAuthState is deterministic 64-hex and collision-distinct', () => {
  const h1 = hashOAuthState('state-value-abc');
  const h2 = hashOAuthState('state-value-abc');
  const h3 = hashOAuthState('state-value-xyz');
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.throws(() => hashOAuthState(''));
});

test('encryption: maskSecret never reveals the middle', () => {
  assert.equal(maskSecret('abcdefghijkl'), '••••ijkl');
  assert.equal(maskSecret('short'), '••••');
  assert.equal(maskSecret(''), '');
});

test('encryption: generateSecureToken returns unique base64url tokens', () => {
  const t1 = generateSecureToken(32);
  const t2 = generateSecureToken(32);
  assert.match(t1, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(t1, t2);
});

test('encryption: timingSafeEqual compares correctly', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
});
