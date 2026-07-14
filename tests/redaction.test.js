import test from 'node:test';
import assert from 'node:assert/strict';

import { redact, REDACTED } from '../src/utils/redaction.js';

test('redaction: redacts top-level passwords', () => {
  const out = redact({ email: 'a@b.com', password: 'hunter2' });
  assert.equal(out.email, 'a@b.com');
  assert.equal(out.password, REDACTED);
});

test('redaction: redacts nested access/refresh tokens', () => {
  const out = redact({
    user: {
      profile: { name: 'Ada' },
      auth: { access_token: 'AT', refresh_token: 'RT', accessToken: 'AT2' },
    },
  });
  assert.equal(out.user.profile.name, 'Ada');
  assert.equal(out.user.auth.access_token, REDACTED);
  assert.equal(out.user.auth.refresh_token, REDACTED);
  assert.equal(out.user.auth.accessToken, REDACTED);
});

test('redaction: redacts authorization headers and cookies', () => {
  const out = redact({
    headers: {
      authorization: 'Bearer abc',
      Cookie: 'sid=xyz',
      'content-type': 'application/json',
    },
  });
  assert.equal(out.headers.authorization, REDACTED);
  assert.equal(out.headers.Cookie, REDACTED);
  assert.equal(out.headers['content-type'], 'application/json');
});

test('redaction: redacts HCTI credential fields', () => {
  const out = redact({
    hcti_user_id: 'u-123',
    hcti_api_key: 'k-456',
    hctiApiKey: 'k-789',
  });
  assert.equal(out.hcti_user_id, REDACTED);
  assert.equal(out.hcti_api_key, REDACTED);
  assert.equal(out.hctiApiKey, REDACTED);
});

test('redaction: redacts client/app secrets and OAuth codes', () => {
  const out = redact({
    clientSecret: 'cs',
    appSecret: 'as',
    code_verifier: 'cv',
    session: 'sess-cookie',
  });
  assert.equal(out.clientSecret, REDACTED);
  assert.equal(out.appSecret, REDACTED);
  assert.equal(out.code_verifier, REDACTED);
  assert.equal(out.session, REDACTED);
});

test('redaction: redacts sensitive values inside arrays', () => {
  const out = redact({ items: [{ token: 't1' }, { token: 't2' }, { ok: 1 }] });
  assert.equal(out.items[0].token, REDACTED);
  assert.equal(out.items[1].token, REDACTED);
  assert.equal(out.items[2].ok, 1);
});

test('redaction: handles cycles without throwing', () => {
  const obj = { a: 1 };
  obj.self = obj;
  const out = redact(obj);
  assert.equal(out.a, 1);
  assert.equal(out.self, '[Circular]');
});

test('redaction: leaves primitives untouched', () => {
  assert.equal(redact('plain'), 'plain');
  assert.equal(redact(42), 42);
  assert.equal(redact(null), null);
});
