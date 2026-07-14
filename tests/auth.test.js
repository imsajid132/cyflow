// Load a valid test env before importing the app.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { makeApp, getCsrf, registerUser, defaultCreds, STRONG_PASSWORD } from './helpers/apiHarness.js';

// --- registration ----------------------------------------------------------

test('POST /register: succeeds, establishes session, excludes password hash', async () => {
  const { app, overrides } = makeApp();
  const agent = request.agent(app);
  const t1 = await getCsrf(agent);
  const res = await agent.post('/api/auth/register').set('X-CSRF-Token', t1).send(defaultCreds());

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.user.email, 'ada@example.com');
  assert.equal(res.body.data.user.password_hash, undefined);
  assert.equal(JSON.stringify(res.body).includes(STRONG_PASSWORD), false);

  // Session established.
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, 'ada@example.com');

  // Password stored as a hash, not plaintext; integration row created.
  const row = overrides.userRepository._rows[0];
  assert.ok(row.password_hash && row.password_hash !== STRONG_PASSWORD);
  assert.equal(overrides.integrationRepository._map.has(row.id), true);

  // CSRF rotated after registration.
  const t2 = await getCsrf(agent);
  assert.notEqual(t1, t2);
});

test('POST /register: normalizes email', async () => {
  const { app } = makeApp();
  const agent = request.agent(app);
  const t = await getCsrf(agent);
  const res = await agent
    .post('/api/auth/register')
    .set('X-CSRF-Token', t)
    .send(defaultCreds({ email: 'MixedCase@Example.COM' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.email, 'mixedcase@example.com');
});

test('POST /register: duplicate email conflicts', async () => {
  const { app } = makeApp();
  await registerUser(app);
  const agent = request.agent(app);
  const t = await getCsrf(agent);
  const res = await agent.post('/api/auth/register').set('X-CSRF-Token', t).send(defaultCreds());
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CONFLICT');
});

test('POST /register: password policy and field validation', async () => {
  const { app } = makeApp();
  const cases = [
    [{ password: 'Ab1shortx' }, 'too short'],
    [{ password: 'alllowercase1x' }, 'no uppercase'],
    [{ password: 'ALLUPPERCASE1X' }, 'no lowercase'],
    [{ password: 'NoNumbersHereX' }, 'no number'],
    [{ email: 'not-an-email' }, 'bad email'],
    [{ timezone: 'Bad/Zone' }, 'bad timezone'],
  ];
  for (const [patch, label] of cases) {
    const agent = request.agent(app);
    const t = await getCsrf(agent);
    const res = await agent
      .post('/api/auth/register')
      .set('X-CSRF-Token', t)
      .send(defaultCreds({ email: `u${Math.abs(hash(label))}@example.com`, ...patch }));
    assert.equal(res.status, 400, `${label} should be 400`);
    assert.equal(JSON.stringify(res.body).includes(patch.password ?? '###'), false);
  }
});

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// --- login -----------------------------------------------------------------

test('POST /login: succeeds and updates last_login_at', async () => {
  const { app, overrides } = makeApp();
  await registerUser(app);

  const guest = request.agent(app);
  const t = await getCsrf(guest);
  const res = await guest
    .post('/api/auth/login')
    .set('X-CSRF-Token', t)
    .send({ email: 'ada@example.com', password: STRONG_PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.password_hash, undefined);
  assert.ok(overrides.userRepository._rows[0].last_login_at);

  const me = await guest.get('/api/auth/me');
  assert.equal(me.status, 200);
});

test('POST /login: wrong password and unknown email give same generic message', async () => {
  const { app } = makeApp();
  await registerUser(app);

  const a = request.agent(app);
  const ta = await getCsrf(a);
  const wrong = await a
    .post('/api/auth/login')
    .set('X-CSRF-Token', ta)
    .send({ email: 'ada@example.com', password: 'Wrong-Pass-123' });

  const b = request.agent(app);
  const tb = await getCsrf(b);
  const unknown = await b
    .post('/api/auth/login')
    .set('X-CSRF-Token', tb)
    .send({ email: 'nobody@example.com', password: STRONG_PASSWORD });

  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error.message, 'Invalid email or password.');
  assert.equal(unknown.body.error.message, 'Invalid email or password.');
});

test('POST /login: disabled account is rejected', async () => {
  const { app, overrides } = makeApp();
  await registerUser(app);
  overrides.userRepository._rows[0].status = 'disabled';

  const guest = request.agent(app);
  const t = await getCsrf(guest);
  const res = await guest
    .post('/api/auth/login')
    .set('X-CSRF-Token', t)
    .send({ email: 'ada@example.com', password: STRONG_PASSWORD });
  assert.equal(res.status, 401);
});

// --- logout ----------------------------------------------------------------

test('POST /logout: destroys session and requires CSRF', async () => {
  const { app } = makeApp();
  const { agent, csrf } = await registerUser(app);

  // Missing CSRF -> 403.
  const noCsrf = await agent.post('/api/auth/logout');
  assert.equal(noCsrf.status, 403);

  // With CSRF -> success, then /me is 401.
  const out = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf);
  assert.equal(out.status, 200);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 401);
});

// --- me --------------------------------------------------------------------

test('GET /me: 401 without a session', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/api/auth/me');
  assert.equal(res.status, 401);
});

test('GET /me: disabled user loses access', async () => {
  const { app, overrides } = makeApp();
  const { agent } = await registerUser(app);
  overrides.userRepository._rows[0].status = 'disabled';
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 401);
});

// --- profile ---------------------------------------------------------------

test('PATCH /profile: updates name/timezone and ignores privileged fields', async () => {
  const { app } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const res = await agent
    .patch('/api/auth/profile')
    .set('X-CSRF-Token', csrf)
    .send({
      name: 'Grace Hopper',
      timezone: 'Europe/London',
      role: 'admin', // must be ignored
      status: 'disabled', // must be ignored
      email: 'evil@example.com', // must be ignored
      password: 'Injected-Pass-1', // must be ignored
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.name, 'Grace Hopper');
  assert.equal(res.body.data.user.timezone, 'Europe/London');
  assert.equal(res.body.data.user.role, 'user');
  assert.equal(res.body.data.user.status, 'active');
  assert.equal(res.body.data.user.email, 'ada@example.com');
});

test('PATCH /profile: invalid timezone rejected', async () => {
  const { app } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const res = await agent
    .patch('/api/auth/profile')
    .set('X-CSRF-Token', csrf)
    .send({ name: 'X', timezone: 'Bad/Zone' });
  assert.equal(res.status, 400);
});

// --- change password -------------------------------------------------------

test('POST /change-password: full flow (rotate session + CSRF, old pw invalid)', async () => {
  const { app, overrides } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const NEW = 'Rotated-Pass-2026';
  const beforeHash = overrides.userRepository._rows[0].password_hash;

  // Wrong current -> 401.
  const wrong = await agent
    .post('/api/auth/change-password')
    .set('X-CSRF-Token', csrf)
    .send({ currentPassword: 'nope', newPassword: NEW });
  assert.equal(wrong.status, 401);

  // Valid change -> 200.
  const ok = await agent
    .post('/api/auth/change-password')
    .set('X-CSRF-Token', csrf)
    .send({ currentPassword: STRONG_PASSWORD, newPassword: NEW });
  assert.equal(ok.status, 200);
  assert.equal(JSON.stringify(ok.body).includes(NEW), false);

  const afterHash = overrides.userRepository._rows[0].password_hash;
  assert.notEqual(beforeHash, afterHash);

  // Session still valid (rotated, identity preserved).
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);

  // Old password no longer works; new one does (fresh guest login).
  const g1 = request.agent(app);
  const tg1 = await getCsrf(g1);
  const oldLogin = await g1
    .post('/api/auth/login')
    .set('X-CSRF-Token', tg1)
    .send({ email: 'ada@example.com', password: STRONG_PASSWORD });
  assert.equal(oldLogin.status, 401);

  const g2 = request.agent(app);
  const tg2 = await getCsrf(g2);
  const newLogin = await g2
    .post('/api/auth/login')
    .set('X-CSRF-Token', tg2)
    .send({ email: 'ada@example.com', password: NEW });
  assert.equal(newLogin.status, 200);
});
