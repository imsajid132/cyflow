// POST /api/automations — the staging 500.
//
// Root cause: `CAST(? AS JSON)` in the automation INSERT. That syntax is
// MySQL-only; MariaDB's CAST accepts BINARY, CHAR, DATE, DATETIME, DECIMAL,
// DOUBLE, FLOAT, INTEGER, SIGNED, TIME and UNSIGNED and nothing else, so the
// statement was rejected before it ran and the request became a 500.
//
// It survived every gate because the repository layer is faked in tests, so
// this SQL had never executed against any real database. The behavioural tests
// below would all have passed on the broken code. The guard that actually
// protects this is `no repository SQL uses MySQL-only syntax` at the bottom:
// it reads the statements themselves.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import request from 'supertest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { makeApp, registerUser } from './helpers/apiHarness.js';
import { databaseDiagnostics, safeInternalMessage } from '../src/middleware/errorHandler.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

async function setup() {
  const { app, overrides } = makeApp();
  const { agent, csrf } = await registerUser(app);
  const me = await agent.get('/api/auth/me');
  const userId = String(me.body.data.user.id);
  await overrides.socialAccountRepository.upsertSocialAccount({
    userId, provider: 'meta', accountType: 'facebook_page', providerAccountId: 'fb-page-1',
    displayName: 'Cyfrow Solutions', username: 'cyfrow',
    encryptedAccessToken: 'v1:super-secret-page-token', scopes: [], providerMetadata: {}, status: 'active',
  });
  const accounts = await overrides.socialAccountRepository.listAccountsForUser(userId);
  return { app, agent, csrf, overrides, userId, fbId: accounts[0].id };
}

/**
 * The exact payload from the staging report.
 *
 * Sunday is 7 in this application (the picker runs Mon=1 .. Sun=7), and the
 * mode value is `review` — "Review before publishing" is the label shown beside
 * it in the wizard, not what goes on the wire.
 */
const stagingPayload = (fbId, over = {}) => ({
  name: 'Staging Automation Test',
  mode: 'review',
  timezone: 'Asia/Karachi',
  selectedWeekdays: [7],
  postingTimes: ['02:21'],
  postsPerDay: 1,
  rhythmKey: 'balanced',
  selectedPlatforms: ['facebook'],
  selectedAccountIds: [fbId],
  missedPostPolicy: 'skip',
  endDate: null,
  generationHorizonDays: 3,
  minimumReadyDays: 2,
  lowBufferDays: 1,
  ...over,
});

test('the exact staging payload creates one automation', async () => {
  const { agent, csrf, fbId } = await setup();
  const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(stagingPayload(fbId));

  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body?.error || {})}`);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data?.automation?.id, 'the created automation must be returned');

  const list = await agent.get('/api/automations');
  assert.equal(list.body.data.automations.length, 1, 'exactly one automation must exist');
});

test('Sunday and 02:21 are persisted exactly as sent', async () => {
  const { agent, csrf, fbId } = await setup();
  const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(stagingPayload(fbId));
  const created = res.body.data.automation;

  assert.deepEqual(created.selectedWeekdays, [7], 'Sunday is weekday 7 and must round-trip');
  assert.deepEqual(created.postingTimes, ['02:21'], 'the posting time must survive unchanged');
  assert.equal(created.timezone, 'Asia/Karachi');
  assert.equal(created.postsPerDay, 1);
  assert.equal(created.rhythmKey, 'balanced');
  assert.equal(created.mode, 'review');
  assert.equal(created.missedPostPolicy, 'skip');
  assert.equal(created.endDate, null);

  // And after a reload, not just in the create response.
  const fetched = await agent.get(`/api/automations/${created.id}`);
  assert.deepEqual(fetched.body.data.automation.selectedWeekdays, [7]);
  assert.deepEqual(fetched.body.data.automation.postingTimes, ['02:21']);
});

test('the selected Facebook Page is attached exactly once', async () => {
  const { agent, csrf, fbId } = await setup();
  const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(stagingPayload(fbId));
  const created = res.body.data.automation;

  assert.deepEqual(created.selectedPlatforms, ['facebook']);
  assert.deepEqual(created.selectedAccountIds, [String(fbId)], 'the one selected account, once');
  assert.equal(created.selectedAccountIds.length, 1, 'no duplicate account target');
});

test('a duplicated account id in the request is stored once, not twice', async () => {
  const { agent, csrf, fbId } = await setup();
  const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf)
    .send(stagingPayload(fbId, { selectedAccountIds: [fbId, fbId] }));
  if (res.status === 201) {
    assert.deepEqual(res.body.data.automation.selectedAccountIds, [String(fbId)],
      'a repeated selection must not create two targets for one page');
  } else {
    assert.equal(res.status, 400, 'otherwise it must be rejected, never 500');
  }
});

test('horizon 3, minimum ready 2 and warning 1 are accepted together', async () => {
  const { agent, csrf, fbId } = await setup();
  const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(stagingPayload(fbId));
  const created = res.body.data.automation;

  // 3 is the documented MIN_HORIZON_DAYS, so this is the tightest valid triple:
  // lowBuffer(1) <= minimumReady(2) <= horizon(3).
  assert.equal(created.generationHorizonDays, 3);
  assert.equal(created.minimumReadyDays, 2);
  assert.equal(created.lowBufferDays, 1);
});

test('invalid HH:MM still returns 400, not 500', async () => {
  const { agent, csrf, fbId } = await setup();
  for (const bad of ['2:21', '25:00', '02:61', 'morning', '']) {
    const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf)
      .send(stagingPayload(fbId, { postingTimes: [bad] }));
    assert.equal(res.status, 400, `"${bad}" must be a validation error, got ${res.status}`);
  }
});

test('invalid horizon still returns 400, not 500', async () => {
  const { agent, csrf, fbId } = await setup();
  for (const bad of [0, 2, 31, 999, -1, 'many']) {
    const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf)
      .send(stagingPayload(fbId, { generationHorizonDays: bad }));
    assert.equal(res.status, 400, `horizon ${bad} must be a validation error, got ${res.status}`);
  }
});

test('a repository failure leaves nothing behind and is not dressed as success', async () => {
  const { app, agent, csrf, fbId, overrides } = await setup();
  const repo = overrides.automationRepository;
  const original = repo.createAutomation.bind(repo);
  // Exactly the shape of the staging failure: the driver rejects the statement.
  repo.createAutomation = async () => {
    throw Object.assign(new Error('You have an error in your SQL syntax'), {
      code: 'ER_PARSE_ERROR', errno: 1064, sqlState: '42000',
      sqlMessage: "check the manual near 'CAST(? AS JSON)'",
      sql: "INSERT INTO content_automations ... 'v1:super-secret-page-token'",
    });
  };
  try {
    const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(stagingPayload(fbId));
    assert.equal(res.status, 500, 'a real failure must surface as a failure');
    assert.equal(res.body.success, false, 'it must never be reported as success');

    const list = await agent.get('/api/automations');
    assert.equal(list.body.data.automations.length, 0, 'no half-created automation may remain');
  } finally {
    repo.createAutomation = original;
  }
  assert.ok(app);
});

test('a failed create returns an actionable message, not "an unexpected error occurred"', async () => {
  const { agent, csrf, fbId, overrides } = await setup();
  const repo = overrides.automationRepository;
  const original = repo.createAutomation.bind(repo);
  repo.createAutomation = async () => {
    throw Object.assign(new Error('boom'), { code: 'ER_PARSE_ERROR', errno: 1064, sqlState: '42000' });
  };
  try {
    const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(stagingPayload(fbId));
    const message = res.body.error.message;
    assert.notEqual(message, 'An unexpected error occurred', 'the generic message helps nobody');
    assert.match(message, /nothing was saved/i, 'the user must be told their data was not stored');
    assert.ok(res.body.requestId, 'the request id must be returned so it can be reported');
  } finally {
    repo.createAutomation = original;
  }
});

test('no secret, token or SQL reaches the client on failure', async () => {
  const { agent, csrf, fbId, overrides } = await setup();
  const repo = overrides.automationRepository;
  const original = repo.createAutomation.bind(repo);
  repo.createAutomation = async () => {
    throw Object.assign(new Error('SQL syntax error'), {
      code: 'ER_PARSE_ERROR', errno: 1064, sqlState: '42000',
      // Both of these carry the statement and its bound values in real life.
      sqlMessage: "near 'CAST(? AS JSON)' at line 1",
      sql: "INSERT INTO content_automations VALUES ('v1:super-secret-page-token')",
    });
  };
  try {
    const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(stagingPayload(fbId));
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes('super-secret-page-token'), 'an account token must never reach the client');
    assert.ok(!body.includes('INSERT INTO'), 'the statement must never reach the client');
    assert.ok(!body.includes('CAST('), 'the failing SQL fragment must never reach the client');
    assert.ok(!body.includes('content_automations'), 'a table name must never reach the client');
  } finally {
    repo.createAutomation = original;
  }
});

test('database diagnostics name the failure class and nothing else', () => {
  const err = Object.assign(new Error('You have an error in your SQL syntax'), {
    code: 'ER_PARSE_ERROR', errno: 1064, sqlState: '42000',
    sqlMessage: "near 'CAST(? AS JSON)'",
    sql: "INSERT INTO content_automations ... 'v1:secret-token'",
  });
  const d = databaseDiagnostics(err);

  // This is what was missing: the staging log said only errorName "Error".
  assert.equal(d.dbCode, 'ER_PARSE_ERROR');
  assert.equal(d.dbErrno, 1064);
  assert.equal(d.sqlState, '42000');

  const serialised = JSON.stringify(d);
  assert.ok(!serialised.includes('secret-token'), 'sql must not be carried into the log payload');
  assert.ok(!serialised.includes('INSERT INTO'), 'the statement must not be carried into the log payload');
  assert.ok(!serialised.includes('CAST('), 'sqlMessage must not be carried into the log payload');
  assert.deepEqual(Object.keys(d).sort(), ['dbCode', 'dbErrno', 'sqlState']);

  // A non-database error must not be mislabelled as one.
  assert.equal(databaseDiagnostics(new Error('ordinary failure')), undefined);
  assert.equal(databaseDiagnostics(null), undefined);
});

test('a schema fault does not tell the user to try again', () => {
  // Retrying a MariaDB/MySQL incompatibility will fail identically for ever.
  const schemaFault = safeInternalMessage({ dbCode: 'ER_PARSE_ERROR' });
  assert.match(schemaFault, /not compatible/i);
  assert.doesNotMatch(schemaFault, /try again in a moment/i);

  // A dropped connection, by contrast, is worth retrying.
  const connectionFault = safeInternalMessage({ dbCode: 'ECONNREFUSED' });
  assert.match(connectionFault, /try again/i);

  for (const m of [schemaFault, connectionFault, safeInternalMessage(undefined)]) {
    assert.ok(!/table|column|SELECT|INSERT|mysql|mariadb/i.test(m),
      `a client message must not name internals: "${m}"`);
  }
});

test('creating an automation makes zero provider calls with live publishing off', async () => {
  const { agent, csrf, fbId, overrides } = await setup();
  let providerCalls = 0;
  for (const key of Object.keys(overrides)) {
    const value = overrides[key];
    if (value && typeof value.publish === 'function') {
      const original = value.publish.bind(value);
      value.publish = async (...args) => { providerCalls += 1; return original(...args); };
    }
  }
  const res = await agent.post('/api/automations').set('X-CSRF-Token', csrf).send(stagingPayload(fbId));
  assert.equal(res.status, 201);
  assert.equal(providerCalls, 0, 'creating an automation must never contact a provider');
  assert.equal(process.env.ENABLE_LIVE_PROVIDER_PUBLISHING === 'true', false,
    'live publishing must remain off in this suite');
});

// ---------------------------------------------------------------------------
// The guard that would actually have caught this.
// ---------------------------------------------------------------------------

test('no repository SQL uses MySQL-only syntax', () => {
  // Every repository is faked in the unit suite, so no behavioural test executes
  // this SQL. Reading the statements is the only check available here, and the
  // absence of it is why a syntax error shipped.
  const dir = path.join(ROOT, 'src', 'repositories');
  const offenders = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(path.join(dir, file), 'utf8');
    // Strip comments: the fix is explained in prose that names the syntax.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // MariaDB's CAST has no JSON target type, so this is a parse error there.
    if (/CAST\s*\([^)]*AS\s+JSON\s*\)/i.test(code)) offenders.push(`${file}: CAST(... AS JSON)`);
    // Also MySQL-only, and equally invisible to a faked test.
    if (/\bJSON_TABLE\s*\(/i.test(code)) offenders.push(`${file}: JSON_TABLE()`);
    if (/\bON\s+DUPLICATE\s+KEY\s+UPDATE[\s\S]{0,80}\bVALUES\s*\(\s*\)/i.test(code)) {
      offenders.push(`${file}: empty VALUES()`);
    }
  }
  assert.deepEqual(offenders, [],
    `MySQL-only SQL cannot run on MariaDB, which some managed hosts provide:\n  ${offenders.join('\n  ')}`);
});

test('JSON columns are written as plain bound parameters', () => {
  // The convention every working path already follows: stringify in JS, bind as
  // a normal parameter, let the column type do the rest. It works on MySQL and
  // on MariaDB.
  const repo = read('src', 'repositories', 'automationRepository.js');
  const insert = repo.slice(repo.indexOf('INSERT INTO content_automations'));
  const statement = insert.slice(0, insert.indexOf('`,'));
  const columns = statement.slice(statement.indexOf('(') + 1, statement.indexOf(')')).split(',').length;
  const placeholders = (statement.slice(statement.indexOf('VALUES')).match(/\?/g) || []).length;
  assert.equal(columns, placeholders,
    'every column must still have exactly one placeholder after removing the casts');
  assert.equal(columns, 20, 'the automation insert writes 20 columns');
});

test('no migration was added or modified for this fix', () => {
  const files = readdirSync(path.join(ROOT, 'database', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  assert.equal(files.some((f) => f.startsWith('019')), false, 'this code-only fix adds no migration (018 is a separate feature)');
  assert.ok(files.includes('018_provider_error_visibility.sql'), '018 is the current migration head');

  // The column types were never the problem, so nothing about them changed.
  const schema = read('database', 'schema.sql');
  for (const column of ['selected_weekdays_json', 'posting_times_json', 'selected_platforms_json',
    'selected_account_ids_json', 'config_snapshot_json']) {
    assert.match(schema, new RegExp('`' + column + '`\\s+JSON'),
      `${column} must still be declared JSON — the fix is in the statement, not the schema`);
  }
});
