// Milestone H2: the staging deployment package.
//
// These test operator tooling, which is code an operator runs against a real
// environment while holding real credentials. A preflight that passes a bad
// configuration is worse than no preflight, because it converts "I am not sure"
// into "the tool said it was fine".
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { preflight, format, isInside, decodedKeyLength, PASS, WARN, BLOCK } from '../tools/staging-preflight.mjs';
import { checkMigrations } from '../tools/migration-check.mjs';
import { migrationInventory, hasAppliedTracking } from '../tools/migration-status.mjs';
import { evaluate, checkHealth } from '../tools/staging-health.mjs';
import { inspectDir, inspectStorage } from '../tools/staging-init-storage.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

/** A configuration with nothing wrong with it. Individual tests break one thing. */
const persistentMedia = path.join(ROOT, '.data', 'test-media');
const persistentExports = path.join(ROOT, '.data', 'test-exports');
const GOOD = Object.freeze({
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://staging.example.test',
  DB_HOST: 'db.internal.example', DB_NAME: 'cyflow_staging',
  DB_USER: 'cyflow', DB_PASSWORD: 'x'.repeat(20),
  SESSION_SECRET: 'a'.repeat(48),
  ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
  MEDIA_STORAGE_PATH: persistentMedia,
  EXPORT_STORAGE_PATH: persistentExports,
  ENABLE_LIVE_PROVIDER_PUBLISHING: 'false',
});
const statusOf = (results, check) => results.find((r) => r.check === check)?.status;

// ---------------------------------------------------------------- preflight
test('a complete safe staging configuration passes preflight', () => {
  const { blocked } = preflight(GOOD);
  assert.equal(blocked, 0, 'a well-formed staging configuration must not be blocked');
});

test('preflight blocks a missing, non-https or localhost base URL', () => {
  assert.equal(statusOf(preflight({ ...GOOD, PUBLIC_BASE_URL: '' }).results, 'PUBLIC_BASE_URL'), BLOCK);
  // Secure session cookies are dropped over plain http, so users cannot stay
  // signed in and the failure looks like a login bug rather than a config one.
  assert.equal(statusOf(preflight({ ...GOOD, PUBLIC_BASE_URL: 'http://staging.example.test' }).results, 'PUBLIC_BASE_URL'), BLOCK);
  assert.equal(statusOf(preflight({ ...GOOD, PUBLIC_BASE_URL: 'https://localhost:3000' }).results, 'PUBLIC_BASE_URL'), BLOCK);
});

test('preflight blocks a missing or placeholder session secret', () => {
  assert.equal(statusOf(preflight({ ...GOOD, SESSION_SECRET: '' }).results, 'SESSION_SECRET'), BLOCK);
  for (const placeholder of ['changeme', 'CHANGEME', 'secret', 'placeholder', 'test']) {
    assert.equal(statusOf(preflight({ ...GOOD, SESSION_SECRET: placeholder }).results, 'SESSION_SECRET'), BLOCK,
      `"${placeholder}" must be rejected as a template value`);
  }
  assert.equal(statusOf(preflight({ ...GOOD, SESSION_SECRET: 'short' }).results, 'SESSION_SECRET'), WARN);
});

test('preflight blocks an invalid encryption key', () => {
  assert.equal(statusOf(preflight({ ...GOOD, ENCRYPTION_KEY_BASE64: '' }).results, 'ENCRYPTION_KEY_BASE64'), BLOCK);
  assert.equal(statusOf(preflight({ ...GOOD, ENCRYPTION_KEY_BASE64: 'not base64!!' }).results, 'ENCRYPTION_KEY_BASE64'), BLOCK);
  // Wrong length is the dangerous case: it looks configured and fails at runtime.
  assert.equal(statusOf(preflight({ ...GOOD, ENCRYPTION_KEY_BASE64: Buffer.alloc(16, 1).toString('base64') }).results, 'ENCRYPTION_KEY_BASE64'), BLOCK);
  assert.equal(decodedKeyLength(Buffer.alloc(32, 1).toString('base64')), 32);
});

test('preflight blocks missing database configuration', () => {
  assert.equal(statusOf(preflight({ ...GOOD, DB_HOST: '' }).results, 'DB_HOST'), BLOCK);
  assert.equal(statusOf(preflight({ ...GOOD, DB_NAME: '' }).results, 'DB_NAME'), BLOCK);
  assert.equal(statusOf(preflight({ ...GOOD, DB_USER: '' }).results, 'DB_USER'), BLOCK);
});

test('preflight blocks a production-looking database target', () => {
  // A hint, not proof — but the operator must confirm rather than discover.
  for (const name of ['cyflow_production', 'cyflow_prod', 'cyflow_live']) {
    assert.equal(statusOf(preflight({ ...GOOD, DB_NAME: name }).results, 'target identity'), BLOCK,
      `"${name}" must require explicit confirmation`);
  }
  assert.equal(statusOf(preflight({ ...GOOD, DB_HOST: 'prod-db.example' }).results, 'target identity'), BLOCK);
  assert.equal(statusOf(preflight(GOOD).results, 'target identity'), PASS);
});

test('preflight blocks live publishing on a first staging bring-up', () => {
  for (const on of ['true', 'TRUE', '1']) {
    assert.equal(statusOf(preflight({ ...GOOD, ENABLE_LIVE_PROVIDER_PUBLISHING: on }).results,
      'ENABLE_LIVE_PROVIDER_PUBLISHING'), BLOCK, `"${on}" must block`);
  }
  assert.equal(statusOf(preflight(GOOD).results, 'ENABLE_LIVE_PROVIDER_PUBLISHING'), PASS);
});

test('preflight blocks storage paths that are public, temporary, missing or shared', () => {
  const results = (env) => preflight(env).results;
  assert.equal(statusOf(results({ ...GOOD, MEDIA_STORAGE_PATH: '' }), 'MEDIA_STORAGE_PATH'), BLOCK);
  assert.equal(statusOf(results({ ...GOOD, EXPORT_STORAGE_PATH: '' }), 'EXPORT_STORAGE_PATH'), BLOCK);

  // Anything under public/ is served as a static asset: every private upload and
  // every export archive would be downloadable with no session at all.
  assert.equal(statusOf(results({ ...GOOD, MEDIA_STORAGE_PATH: path.join(ROOT, 'public', 'uploads') }), 'MEDIA_STORAGE_PATH'), BLOCK);
  assert.equal(statusOf(results({ ...GOOD, EXPORT_STORAGE_PATH: path.join(ROOT, 'public', 'exports') }), 'EXPORT_STORAGE_PATH'), BLOCK);

  // A temp directory is wiped on redeploy — the exact silent data loss the
  // .env.example comment warns about.
  assert.equal(statusOf(results({ ...GOOD, MEDIA_STORAGE_PATH: path.join(os.tmpdir(), 'cyflow-media') }), 'MEDIA_STORAGE_PATH'), BLOCK);

  // Export cleanup sweeps its own root; pointed at media it deletes users' images.
  const same = { ...GOOD, EXPORT_STORAGE_PATH: GOOD.MEDIA_STORAGE_PATH };
  assert.equal(statusOf(preflight(same).results, 'path separation'), BLOCK);
});

test('preflight never emits a secret value', () => {
  const secrets = [GOOD.SESSION_SECRET, GOOD.ENCRYPTION_KEY_BASE64, GOOD.DB_PASSWORD];
  const rendered = format(preflight(GOOD));
  for (const secret of secrets) {
    assert.ok(!rendered.includes(secret), 'a secret value must never reach preflight output');
    // Nor a usable prefix: 8 characters of a session secret is a real head start.
    assert.ok(!rendered.includes(secret.slice(0, 8)), 'not even a prefix of a secret may be printed');
  }
  // Names are fine; values are not.
  assert.ok(rendered.includes('SESSION_SECRET'), 'the variable NAME should appear so the operator knows what to fix');
});

test('preflight is read-only: it does not create the directories it checks', () => {
  const ghost = path.join(ROOT, '.data', `preflight-should-not-create-${process.pid}`);
  assert.equal(fs.existsSync(ghost), false, 'precondition');
  preflight({ ...GOOD, MEDIA_STORAGE_PATH: ghost });
  assert.equal(fs.existsSync(ghost), false, 'preflight must not create anything without --probe');
});

test('isInside resolves traversal rather than comparing strings', () => {
  assert.equal(isInside('/a/b/c', '/a/b'), true);
  assert.equal(isInside('/a/b', '/a/b'), true);
  assert.equal(isInside('/a/bc', '/a/b'), false, 'a shared prefix is not containment');
  assert.equal(isInside('/a/b/../../c', '/a/b'), false);
  // The form that a naive startsWith check misses.
  assert.equal(isInside(path.join(ROOT, 'public', '..', 'public', 'x'), path.join(ROOT, 'public')), true);
});

// ---------------------------------------------------------------- migrations
test('the committed migration set passes the static check', () => {
  const { problems } = checkMigrations();
  assert.deepEqual(problems, [], `migration check must be clean:\n  ${problems.join('\n  ')}`);
});

test('the migration check detects duplicates, bad names and empty files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyflow-mig-'));
  const migs = path.join(dir, 'database', 'migrations');
  fs.mkdirSync(migs, { recursive: true });
  fs.writeFileSync(path.join(dir, 'database', 'schema.sql'), '-- empty\n');

  fs.writeFileSync(path.join(migs, '001_alpha.sql'), 'CREATE TABLE `a` (id INT);\n');
  fs.writeFileSync(path.join(migs, '001_beta.sql'), 'CREATE TABLE `b` (id INT);\n');
  fs.writeFileSync(path.join(migs, 'nonsense.sql'), 'CREATE TABLE `c` (id INT);\n');
  fs.writeFileSync(path.join(migs, '002_blank.sql'), '-- only a comment\n');

  const { problems } = checkMigrations({ root: dir });
  assert.ok(problems.some((p) => /duplicate migration number/.test(p)), 'duplicate number must be caught');
  assert.ok(problems.some((p) => /malformed migration filename/.test(p)), 'bad filename must be caught');
  assert.ok(problems.some((p) => /empty migration/.test(p)), 'empty migration must be caught');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the migration check flags destructive statements but ignores comments about them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyflow-mig2-'));
  const migs = path.join(dir, 'database', 'migrations');
  fs.mkdirSync(migs, { recursive: true });
  fs.writeFileSync(path.join(dir, 'database', 'schema.sql'), '-- empty\n');

  fs.writeFileSync(path.join(migs, '001_destructive.sql'), 'DROP TABLE `users`;\n');
  let { problems } = checkMigrations({ root: dir });
  assert.ok(problems.some((p) => /destructive statement/.test(p)), 'a real DROP TABLE must be flagged');

  // A migration explaining why it avoids DROP must not trip its own scanner.
  // The same class of self-match reported a column literally named `IF`.
  fs.writeFileSync(path.join(migs, '001_destructive.sql'),
    '-- Deliberately additive: no DROP TABLE and no DELETE FROM anywhere.\nALTER TABLE `users` ADD COLUMN `x` INT NULL;\n');
  ({ problems } = checkMigrations({ root: dir }));
  assert.ok(!problems.some((p) => /destructive statement/.test(p)), 'prose about DROP must not be flagged as DROP');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration status reports inventory and refuses to invent applied state', () => {
  const inv = migrationInventory();
  assert.ok(inv.length >= 8, 'the inventory must list the real migrations');
  assert.ok(inv.some((m) => m.file.startsWith('017_')), '017 must be listed');
  // The project genuinely has no tracking table. Claiming otherwise would let an
  // operator skip a migration that was never applied.
  assert.equal(hasAppliedTracking(), false,
    'this project has no applied-migration tracking; the tool must not pretend it does');
  const src = read('tools', 'migration-status.mjs');
  assert.doesNotMatch(src, /mysql2|createConnection|createPool/,
    'migration status must not connect to a database');
});

test('no migration adds a column literally named IF (comment-parsing regression)', () => {
  for (const m of migrationInventory()) {
    assert.ok(!m.columns.includes('IF'),
      `${m.file}: "IF" parsed as a column name means comments are not being stripped`);
  }
});

// ---------------------------------------------------------------- health
test('health treats a stale worker heartbeat as blocked', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const fresh = evaluate({ data: { database: true, worker: { lastHeartbeatAt: '2026-07-18T11:59:30Z' } } }, { nowMs: now });
  assert.equal(fresh.find((r) => r.component === 'worker').status, PASS);

  // A live web process with a dead worker means posts silently stop going out.
  const stale = evaluate({ data: { database: true, worker: { lastHeartbeatAt: '2026-07-18T11:00:00Z' } } }, { nowMs: now });
  assert.equal(stale.find((r) => r.component === 'worker').status, BLOCK);

  const never = evaluate({ data: { database: true, worker: { lastHeartbeatAt: null } } }, { nowMs: now });
  assert.equal(never.find((r) => r.component === 'worker').status, BLOCK);
});

test('health blocks an unreachable database and warns on enabled live publishing', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const down = evaluate({ data: { database: false } }, { nowMs: now });
  assert.equal(down.find((r) => r.component === 'database').status, BLOCK);

  const live = evaluate({ data: { database: true, publishing: { liveEnabled: true } } }, { nowMs: now });
  assert.equal(live.find((r) => r.component === 'live publishing').status, WARN,
    'an enabled flag must be visible, not silently normal');
});

test('health refuses a non-https remote origin and times out cleanly', async () => {
  const refused = await checkHealth('http://staging.example.test');
  assert.equal(refused.reachable, false);
  assert.match(refused.error, /https/);

  const timedOut = await checkHealth('https://staging.example.test', {
    timeoutMs: 5,
    fetchImpl: (_u, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  assert.equal(timedOut.reachable, false);
  assert.match(timedOut.error, /no response within/);
});

test('health never prints a response body', async () => {
  // An error page can carry a stack trace, a filesystem path, or a token echoed
  // back from a query string. Only derived verdicts may escape.
  const res = await checkHealth('https://staging.example.test', {
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'SECRET-TOKEN-abc123 at /var/www/app/src/db.js' }),
  });
  assert.ok(!JSON.stringify(res).includes('SECRET-TOKEN'), 'a response body must never reach the caller');
  assert.ok(!JSON.stringify(res).includes('/var/www'), 'a filesystem path must never reach the caller');
});

// ---------------------------------------------------------------- storage
test('storage init is check-only unless --create is given', () => {
  const ghost = path.join(ROOT, '.data', `storage-should-not-create-${process.pid}`);
  assert.equal(fs.existsSync(ghost), false, 'precondition');
  const r = inspectDir('media', ghost, { create: false });
  assert.equal(r.status, WARN);
  assert.equal(fs.existsSync(ghost), false, 'check-only must not create a directory');
});

test('storage init creates, probes and cleans up when asked', () => {
  const dir = path.join(ROOT, '.data', `storage-create-${process.pid}`);
  try {
    const r = inspectDir('media', dir, { create: true });
    assert.equal(r.status, PASS, r.detail);
    assert.equal(fs.existsSync(dir), true, 'the directory must exist after --create');
    const leftovers = fs.readdirSync(dir).filter((f) => f.startsWith('.cyflow-storage-probe'));
    assert.deepEqual(leftovers, [], 'the probe file must be removed again');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('storage init rejects public and shared paths', () => {
  assert.equal(inspectDir('media', path.join(ROOT, 'public', 'x'), {}).status, BLOCK);
  assert.equal(inspectDir('export', path.join(os.tmpdir(), 'cyflow-x'), {}).status, BLOCK);
  const shared = inspectStorage({ MEDIA_STORAGE_PATH: '/srv/data', EXPORT_STORAGE_PATH: '/srv/data' });
  assert.equal(shared.find((r) => r.key === 'path separation').status, BLOCK);
});

// ---------------------------------------------------------------- package
test('every documented operator script exists and points at a real file', () => {
  const pkg = JSON.parse(read('package.json'));
  const expected = {
    start: 'src/server.js',
    worker: 'src/workers/worker.js',
    'worker:once': 'src/workers/runWorkerOnce.js',
    'scheduler:once': 'src/scheduler/runOnce.js',
    'staging:preflight': 'tools/staging-preflight.mjs',
    'staging:health': 'tools/staging-health.mjs',
    'staging:init-storage': 'tools/staging-init-storage.mjs',
    'migrate:status': 'tools/migration-status.mjs',
    'migrate:check': 'tools/migration-check.mjs',
  };
  for (const [script, file] of Object.entries(expected)) {
    assert.ok(pkg.scripts[script], `package.json must define "${script}"`);
    assert.match(pkg.scripts[script], new RegExp(file.replace(/[/.]/g, '\\$&')),
      `"${script}" must invoke ${file}`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} must exist`);
  }
});

// ---------------------------------------------------------------- artifacts
test('no deployment artifact contains a secret, a real domain or a developer path', () => {
  const files = [
    ['deploy', 'pm2', 'ecosystem.config.cjs'],
    ['deploy', 'systemd', 'cyflow-web.service.example'],
    ['deploy', 'systemd', 'cyflow-worker.service.example'],
    ['deploy', 'systemd', 'cyflow-scheduler.service.example'],
    ['deploy', 'systemd', 'cyflow-scheduler.timer.example'],
  ];
  for (const parts of files) {
    const text = read(...parts);
    const name = parts.join('/');
    assert.doesNotMatch(text, /C:\\Users\\|\/home\/[a-z]+\/|\/Users\/[a-z]+\//i, `${name}: no developer path`);
    assert.doesNotMatch(text, /password\s*[:=]\s*\S+/i, `${name}: no password`);
    assert.doesNotMatch(text, /[A-Za-z0-9+/]{40,}={0,2}/, `${name}: no long opaque literal that could be a key`);
    // Live publishing must never be switched on by a config file.
    assert.doesNotMatch(text, /ENABLE_LIVE_PROVIDER_PUBLISHING\s*[:=]\s*['"]?(true|1)/i,
      `${name}: must not enable live publishing`);
  }
});

test('the PM2 example runs web and worker as separate processes and no scheduler', () => {
  const cfg = read('deploy', 'pm2', 'ecosystem.config.cjs');
  assert.match(cfg, /name:\s*'cyflow-web'/);
  assert.match(cfg, /name:\s*'cyflow-worker'/);
  // The worker must not be started as part of the web process, and the
  // scheduler must not run here as well as in cron: either mistake produces
  // duplicate provider posts.
  assert.doesNotMatch(cfg, /name:\s*'cyflow-scheduler'/,
    'the scheduler runs from cron; a second persistent scheduler would double-schedule');
  assert.match(cfg, /src\/workers\/worker\.js/, 'the worker must be its own process');
});
