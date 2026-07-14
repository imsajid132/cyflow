// Real bcrypt runtime test. Never logs the password or the produced hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';

const ROUNDS = 12;

test('bcrypt: hashes and verifies the correct password', async () => {
  const password = 'Sample-Password-123!';
  const hash = await bcrypt.hash(password, ROUNDS);
  // A bcrypt hash is a 60-char string; assert shape without printing it.
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 60);
  assert.match(hash, /^\$2[aby]\$/);

  const ok = await bcrypt.compare(password, hash);
  assert.equal(ok, true);
});

test('bcrypt: rejects an incorrect password', async () => {
  const password = 'Correct-Horse-Battery';
  const hash = await bcrypt.hash(password, ROUNDS);
  const bad = await bcrypt.compare('not-the-password', hash);
  assert.equal(bad, false);
});

test('bcrypt: embeds the configured cost factor', async () => {
  const hash = await bcrypt.hash('cost-check', ROUNDS);
  // Format: $2b$<cost>$<salt+digest>
  const cost = hash.split('$')[2];
  assert.equal(cost, String(ROUNDS));
});

test('bcrypt: same password yields different salted hashes', async () => {
  const password = 'salt-uniqueness';
  const h1 = await bcrypt.hash(password, ROUNDS);
  const h2 = await bcrypt.hash(password, ROUNDS);
  assert.notEqual(h1, h2);
  // Both still verify.
  assert.equal(await bcrypt.compare(password, h1), true);
  assert.equal(await bcrypt.compare(password, h2), true);
});
