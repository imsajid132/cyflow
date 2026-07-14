// Load a valid test env before importing anything that loads config/env.js.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthService } from '../src/services/authService.js';
import {
  createFakeUserRepository,
  createFakeIntegrationRepository,
  fakeWithTransaction,
} from './helpers/fakes.js';

const STRONG = 'Sup3r-Secret-Pass';

function build(seed = []) {
  const users = createFakeUserRepository(seed);
  const integrations = createFakeIntegrationRepository();
  const logs = [];
  const logging = { record: async (eventType, opts) => logs.push({ eventType, opts }) };
  const svc = createAuthService({ users, integrations, logging, withTransaction: fakeWithTransaction });
  return { svc, users, integrations, logs };
}

// --- primitives ------------------------------------------------------------

test('authService: hashPassword/verifyPassword round-trip', async () => {
  const { svc } = build();
  const hash = await svc.hashPassword(STRONG);
  assert.notEqual(hash, STRONG);
  assert.equal(await svc.verifyPassword(STRONG, hash), true);
  assert.equal(await svc.verifyPassword('wrong', hash), false);
});

test('authService: validateTimezone accepts IANA zones and rejects junk', () => {
  const { svc } = build();
  for (const tz of ['Asia/Karachi', 'Europe/London', 'America/New_York', 'UTC']) {
    assert.equal(svc.validateTimezone(tz), true, tz);
  }
  for (const tz of ['Not/AZone', 'Mars/Phobos', '', 'xyz']) {
    assert.equal(svc.validateTimezone(tz), false, tz);
  }
});

test('authService: password policy rejects weak passwords', () => {
  const { svc } = build();
  const bad = [
    'Ab1short', // < 12
    'alllowercase1', // no uppercase
    'ALLUPPERCASE1', // no lowercase
    'NoNumbersHere', // no number
    '            ', // whitespace only
  ];
  for (const pw of bad) {
    assert.throws(() => svc.assertPasswordPolicy(pw), /Password/, `should reject: ${pw}`);
  }
  // A valid one does not throw.
  assert.doesNotThrow(() => svc.assertPasswordPolicy(STRONG));
});

// --- registration ----------------------------------------------------------

test('authService: registerUser succeeds and returns a sanitized user', async () => {
  const { svc, users, integrations } = build();
  const user = await svc.registerUser({
    name: '  Ada  ',
    email: 'Ada@Example.com',
    password: STRONG,
    timezone: 'America/New_York',
  });
  assert.equal(user.name, 'Ada'); // trimmed
  assert.equal(user.email, 'ada@example.com'); // normalized
  assert.equal(user.role, 'user');
  assert.equal(user.status, 'active');
  assert.equal(user.password_hash, undefined); // sanitized
  assert.equal('passwordHash' in user, false);

  // Password stored as a bcrypt hash, never plaintext.
  const row = users._rows.find((r) => r.email === 'ada@example.com');
  assert.ok(row.password_hash && row.password_hash !== STRONG);
  assert.match(row.password_hash, /^\$2[aby]\$/);

  // Integration row created.
  assert.equal(integrations._map.has(String(row.id)), true);
});

test('authService: duplicate email is a conflict', async () => {
  const { svc } = build();
  const creds = { name: 'A', email: 'dup@example.com', password: STRONG, timezone: 'UTC' };
  await svc.registerUser(creds);
  await assert.rejects(() => svc.registerUser(creds), /already exists/i);
});

test('authService: registration rejects invalid email and timezone', async () => {
  const { svc } = build();
  await assert.rejects(
    () => svc.registerUser({ name: 'A', email: 'not-an-email', password: STRONG, timezone: 'UTC' }),
    /email/i,
  );
  await assert.rejects(
    () => svc.registerUser({ name: 'A', email: 'a@b.com', password: STRONG, timezone: 'Bad/Zone' }),
    /timezone/i,
  );
});

// --- login -----------------------------------------------------------------

test('authService: login succeeds and updates last_login_at', async () => {
  const { svc, users } = build();
  await svc.registerUser({ name: 'A', email: 'a@b.com', password: STRONG, timezone: 'UTC' });
  const user = await svc.authenticateUser({ email: 'A@B.com', password: STRONG });
  assert.equal(user.email, 'a@b.com');
  assert.equal(user.password_hash, undefined);
  const row = users._rows.find((r) => r.email === 'a@b.com');
  assert.ok(row.last_login_at);
});

test('authService: wrong password and unknown email give the same generic error', async () => {
  const { svc } = build();
  await svc.registerUser({ name: 'A', email: 'a@b.com', password: STRONG, timezone: 'UTC' });

  let wrongMsg;
  let unknownMsg;
  await svc.authenticateUser({ email: 'a@b.com', password: 'Wrong-Pass-123' }).catch((e) => {
    wrongMsg = e.message;
  });
  await svc.authenticateUser({ email: 'nobody@x.com', password: STRONG }).catch((e) => {
    unknownMsg = e.message;
  });
  assert.equal(wrongMsg, 'Invalid email or password.');
  assert.equal(unknownMsg, 'Invalid email or password.');
});

test('authService: disabled account is rejected (only after correct password)', async () => {
  const { svc, users } = build();
  await svc.registerUser({ name: 'A', email: 'a@b.com', password: STRONG, timezone: 'UTC' });
  users._rows.find((r) => r.email === 'a@b.com').status = 'disabled';
  await assert.rejects(
    () => svc.authenticateUser({ email: 'a@b.com', password: STRONG }),
    /disabled/i,
  );
});

// --- profile ---------------------------------------------------------------

test('authService: updateUserProfile updates name and timezone', async () => {
  const { svc } = build();
  const user = await svc.registerUser({ name: 'A', email: 'a@b.com', password: STRONG, timezone: 'UTC' });
  const updated = await svc.updateUserProfile(user.id, { name: 'New Name', timezone: 'Asia/Karachi' });
  assert.equal(updated.name, 'New Name');
  assert.equal(updated.timezone, 'Asia/Karachi');
  await assert.rejects(
    () => svc.updateUserProfile(user.id, { name: 'X', timezone: 'Bad/Zone' }),
    /timezone/i,
  );
});

// --- password change -------------------------------------------------------

test('authService: changePassword enforces current, strength, and difference', async () => {
  const { svc, users } = build();
  const user = await svc.registerUser({ name: 'A', email: 'a@b.com', password: STRONG, timezone: 'UTC' });
  const beforeHash = users._rows.find((r) => r.id === user.id).password_hash;

  // Wrong current.
  await assert.rejects(
    () => svc.changePassword(user.id, { currentPassword: 'nope', newPassword: 'Another-Pass-1' }),
    /current password/i,
  );
  // Weak new.
  await assert.rejects(
    () => svc.changePassword(user.id, { currentPassword: STRONG, newPassword: 'weak' }),
    /Password/,
  );
  // Same as current.
  await assert.rejects(
    () => svc.changePassword(user.id, { currentPassword: STRONG, newPassword: STRONG }),
    /different/i,
  );

  // Valid change.
  const NEW = 'Brand-New-Pass-9';
  const ok = await svc.changePassword(user.id, { currentPassword: STRONG, newPassword: NEW });
  assert.equal(ok, true);
  const afterHash = users._rows.find((r) => r.id === user.id).password_hash;
  assert.notEqual(beforeHash, afterHash);
  // Old password no longer verifies; new one does.
  assert.equal(await svc.verifyPassword(STRONG, afterHash), false);
  assert.equal(await svc.verifyPassword(NEW, afterHash), true);
});
