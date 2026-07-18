/**
 * Staging preflight — read-only verification before a staging deployment.
 *
 * Answers one question: "if I deploy this configuration right now, what breaks?"
 * It never writes to a database, never starts a process, never calls Meta,
 * OpenAI or HCTI, and never prints a secret value. It reports only whether
 * configuration EXISTS and is SHAPED correctly.
 *
 * Usage:
 *   node tools/staging-preflight.mjs            # check the current environment
 *   node tools/staging-preflight.mjs --probe    # additionally write+read+delete
 *                                               # a temporary file in each
 *                                               # configured storage directory
 *
 * Exit codes: 0 = pass (warnings allowed), 1 = at least one BLOCKED check.
 *
 * The checks are exported as a pure function so the test suite can drive them
 * with a synthetic environment instead of mutating the real one.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PASS = 'PASS';
export const WARN = 'WARNING';
export const BLOCK = 'BLOCKED';

/** Placeholder secrets that ship in templates and must never reach staging. */
const PLACEHOLDER_SECRETS = new Set([
  '', 'changeme', 'change-me', 'secret', 'password', 'placeholder',
  'your-secret-here', 'replace-me', 'test', 'dev', 'development',
  'cyflow', 'cyflow-secret', 'insecure', 'xxx', 'todo',
]);

/**
 * Database names/hosts that suggest a production target.
 *
 * Separators are normalised to spaces before matching. `\b` does not fire
 * between `_` and a letter — underscore is a word character — so `\bproduction\b`
 * silently failed to match `cyflow_production`, which is exactly how a real
 * database is named. The check that mattered most was the one that did nothing.
 */
const PRODUCTION_HINTS = [/\bprod\b/i, /\bproduction\b/i, /\blive\b/i, /\bmain\b/i];
const normaliseTarget = (value) => String(value || '').replace(/[_\-.]+/g, ' ');

/**
 * Is `child` inside `parent`? Used to keep private storage out of the publicly
 * served asset tree. Compares resolved paths, so `public/../public/media` is
 * caught as well as the obvious form.
 */
export function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** A base64 key that decodes to exactly 32 bytes (AES-256). */
export function decodedKeyLength(value) {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return -1;
  try {
    return Buffer.from(value, 'base64').length;
  } catch {
    return -1;
  }
}

/**
 * Run every preflight check against `env`.
 * @param {object} env             environment to inspect (never mutated)
 * @param {object} [opts]
 * @param {boolean} [opts.probe]   write+read+delete a temp file in each storage dir
 * @param {string}  [opts.root]    repository root, for entry-point checks
 * @returns {{results: Array<{area:string,check:string,status:string,detail:string}>, blocked:number, warned:number}}
 */
export function preflight(env = process.env, opts = {}) {
  const root = opts.root || ROOT;
  const results = [];
  const add = (area, check, status, detail = '') => results.push({ area, check, status, detail });

  // ---- repository ---------------------------------------------------------
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    add('repository', 'package.json', BLOCK, 'not found');
  } else {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const want = (pkg.engines && pkg.engines.node) || '';
    const major = Number(process.versions.node.split('.')[0]);
    const min = Number((want.match(/(\d+)/) || [])[1] || 0);
    add('repository', 'node version', major >= min ? PASS : BLOCK,
      `running ${process.versions.node}, package requires ${want || 'unspecified'}`);
    for (const script of ['start', 'worker', 'scheduler:once']) {
      add('repository', `script: ${script}`,
        pkg.scripts && pkg.scripts[script] ? PASS : BLOCK,
        pkg.scripts && pkg.scripts[script] ? pkg.scripts[script] : 'missing');
    }
  }

  for (const [label, rel] of [
    ['web entry point', 'src/server.js'],
    ['worker entry point', 'src/workers/worker.js'],
    ['scheduler entry point', 'src/scheduler/runOnce.js'],
    ['schema.sql', 'database/schema.sql'],
    ['config module', 'src/config/env.js'],
  ]) {
    add('repository', label, fs.existsSync(path.join(root, rel)) ? PASS : BLOCK, rel);
  }

  const migDir = path.join(root, 'database', 'migrations');
  const migrations = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
    : [];
  add('repository', 'migration files', migrations.length ? PASS : BLOCK,
    `${migrations.length} found`);

  // ---- application --------------------------------------------------------
  const baseUrl = (env.PUBLIC_BASE_URL || env.APP_BASE_URL || '').trim();
  if (!baseUrl) {
    add('application', 'PUBLIC_BASE_URL', BLOCK, 'not configured');
  } else {
    let parsed = null;
    try { parsed = new URL(baseUrl); } catch { /* reported below */ }
    if (!parsed) {
      add('application', 'PUBLIC_BASE_URL', BLOCK, 'not a valid URL');
    } else if (parsed.protocol !== 'https:') {
      // Secure session cookies are dropped over plain HTTP, so users silently
      // fail to stay logged in. Not a warning: staging is remote and public.
      add('application', 'PUBLIC_BASE_URL', BLOCK, 'must be https for a remote environment');
    } else if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(parsed.hostname)) {
      add('application', 'PUBLIC_BASE_URL', BLOCK, 'points at localhost, not a staging origin');
    } else {
      add('application', 'PUBLIC_BASE_URL', PASS, 'https, non-local origin');
    }
  }

  add('application', 'NODE_ENV', env.NODE_ENV ? PASS : WARN,
    env.NODE_ENV ? `set to ${env.NODE_ENV}` : 'unset; config will default to development');

  // ---- publishing safety --------------------------------------------------
  const live = String(env.ENABLE_LIVE_PROVIDER_PUBLISHING || '').toLowerCase();
  if (live === 'true' || live === '1') {
    // The single most consequential setting in the file. A first staging bring-up
    // with this on can put a test post on a real business page.
    add('publishing', 'ENABLE_LIVE_PROVIDER_PUBLISHING', BLOCK,
      'is true; a first staging deployment must start with live publishing OFF');
  } else {
    add('publishing', 'ENABLE_LIVE_PROVIDER_PUBLISHING', PASS, 'false (no provider calls)');
  }

  // ---- sessions and encryption -------------------------------------------
  const session = String(env.SESSION_SECRET || '');
  if (!session.trim()) {
    add('security', 'SESSION_SECRET', BLOCK, 'not configured');
  } else if (PLACEHOLDER_SECRETS.has(session.trim().toLowerCase())) {
    add('security', 'SESSION_SECRET', BLOCK, 'is a template placeholder');
  } else if (session.length < 32) {
    add('security', 'SESSION_SECRET', WARN, `configured but short (${session.length} chars; prefer 32+)`);
  } else {
    add('security', 'SESSION_SECRET', PASS, 'configured');
  }

  const keyLen = decodedKeyLength(String(env.ENCRYPTION_KEY_BASE64 || ''));
  if (!String(env.ENCRYPTION_KEY_BASE64 || '').trim()) {
    add('security', 'ENCRYPTION_KEY_BASE64', BLOCK, 'not configured');
  } else if (keyLen !== 32) {
    add('security', 'ENCRYPTION_KEY_BASE64', BLOCK,
      keyLen < 0 ? 'not valid base64' : `decodes to ${keyLen} bytes, expected 32`);
  } else {
    add('security', 'ENCRYPTION_KEY_BASE64', PASS, 'configured, decodes to 32 bytes');
  }

  // ---- database (identity only; never connects) ---------------------------
  const dbHost = String(env.DB_HOST || '').trim();
  const dbName = String(env.DB_NAME || '').trim();
  add('database', 'DB_HOST', dbHost ? PASS : BLOCK, dbHost ? 'configured' : 'not configured');
  add('database', 'DB_NAME', dbName ? PASS : BLOCK, dbName ? 'configured' : 'not configured');
  add('database', 'DB_USER', String(env.DB_USER || '').trim() ? PASS : BLOCK,
    String(env.DB_USER || '').trim() ? 'configured' : 'not configured');
  add('database', 'DB_PASSWORD', String(env.DB_PASSWORD || '').trim() ? PASS : WARN,
    String(env.DB_PASSWORD || '').trim() ? 'configured' : 'empty (acceptable only for a local socket)');

  // Names are not secrets, but they are not printed either: only the verdict is.
  const looksProd = PRODUCTION_HINTS.some(
    (re) => re.test(normaliseTarget(dbHost)) || re.test(normaliseTarget(dbName)),
  );
  add('database', 'target identity', looksProd ? BLOCK : PASS,
    looksProd
      ? 'host or database name contains a production-like word; confirm this is NOT production before continuing'
      : 'no production-like naming detected (this is a hint, not proof)');

  // ---- storage ------------------------------------------------------------
  const publicDir = path.join(root, 'public');
  const mediaPath = String(env.MEDIA_STORAGE_PATH || '').trim();
  const exportPath = String(env.EXPORT_STORAGE_PATH || '').trim();

  const checkDir = (label, dir, key) => {
    if (!dir) {
      add('storage', key, BLOCK, `${label} path not configured; the default is a temp directory that is wiped on redeploy`);
      return;
    }
    if (isInside(dir, publicDir)) {
      // Anything under public/ is served as a static asset, so every private
      // upload and every export archive would be downloadable without a session.
      add('storage', key, BLOCK, `${label} path is inside the public asset directory`);
      return;
    }
    const tmp = os.tmpdir();
    if (isInside(dir, tmp)) {
      add('storage', key, BLOCK, `${label} path is inside the system temp directory and will not survive a redeploy`);
      return;
    }
    if (!path.isAbsolute(dir)) {
      add('storage', key, WARN, `${label} path is relative; prefer an absolute path outside the deployment directory`);
      return;
    }
    if (!fs.existsSync(dir)) {
      add('storage', key, WARN, `${label} path does not exist yet (run staging:init-storage --create)`);
      return;
    }
    if (opts.probe) {
      const probe = path.join(dir, `.cyflow-preflight-${process.pid}`);
      try {
        fs.writeFileSync(probe, 'probe');
        fs.readFileSync(probe);
        fs.unlinkSync(probe);
        add('storage', key, PASS, `${label} path is writable (probe created, read and removed)`);
      } catch (err) {
        add('storage', key, BLOCK, `${label} path is not writable (${err.code || 'error'})`);
      }
      return;
    }
    add('storage', key, PASS, `${label} path exists (use --probe to test writability)`);
  };

  checkDir('media', mediaPath, 'MEDIA_STORAGE_PATH');
  checkDir('export', exportPath, 'EXPORT_STORAGE_PATH');

  if (mediaPath && exportPath && path.resolve(mediaPath) === path.resolve(exportPath)) {
    // Export cleanup deletes expired archives by scanning its directory. Pointed
    // at the media directory, that cleanup would delete users' images.
    add('storage', 'path separation', BLOCK,
      'media and export paths are identical; export cleanup would delete media');
  } else if (mediaPath && exportPath) {
    add('storage', 'path separation', PASS, 'media and export paths are distinct');
  }

  const blocked = results.filter((r) => r.status === BLOCK).length;
  const warned = results.filter((r) => r.status === WARN).length;
  return { results, blocked, warned };
}

/** Render results as an aligned table. Contains no secret values by construction. */
export function format({ results, blocked, warned }) {
  const lines = [];
  let area = '';
  for (const r of results) {
    if (r.area !== area) { area = r.area; lines.push(`\n[${area}]`); }
    lines.push(`  ${r.status.padEnd(8)} ${r.check.padEnd(34)} ${r.detail}`);
  }
  lines.push('');
  lines.push(`${results.length} checks, ${blocked} blocked, ${warned} warnings`);
  lines.push(blocked
    ? 'RESULT: BLOCKED — resolve every BLOCKED item before deploying.'
    : 'RESULT: PASS — no blocking issue found. Warnings are worth reading.');
  return lines.join('\n');
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const report = preflight(process.env, { probe: process.argv.includes('--probe') });
  console.log(format(report));
  process.exit(report.blocked ? 1 : 0);
}
