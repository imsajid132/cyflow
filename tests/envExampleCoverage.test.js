// Milestone H: `.env.example` must describe every variable the app reads.
//
// This is a deployment-safety test, not a tidiness test. An operator provisions
// an environment by copying `.env.example`. Sixteen variables had drifted out of
// it, including ENABLE_LIVE_PROVIDER_PUBLISHING — the flag that decides whether
// the app talks to Facebook, Instagram and Threads at all — and
// MEDIA_STORAGE_PATH, whose own source comment calls it a deployment blocker
// because the default is a temp directory that is wiped on every redeploy.
//
// Nothing warned about that drift, because nothing compared the two files.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_JS = readFileSync(path.join(ROOT, 'src', 'config', 'env.js'), 'utf8');
const EXAMPLE = readFileSync(path.join(ROOT, '.env.example'), 'utf8');

/** Variable names assigned in `.env.example`, commented lines ignored. */
function documented() {
  const out = new Set();
  for (const line of EXAMPLE.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Variable names read by the config layer.
 *
 * Only literal keys are collected. buildProvider() reads its keys through a
 * computed `${prefix}_APP_ID` template, so those are listed explicitly below
 * rather than guessed — an earlier pass at this analysis reported them as dead
 * configuration precisely because a literal grep could not see them.
 */
function read() {
  const out = new Set();
  const literal = /(?:requireString|optionalString|toNumber|toBoolean|requireBase64)\(\s*'([A-Z_][A-Z0-9_]*)'/g;
  for (const m of ENV_JS.matchAll(literal)) out.add(m[1]);
  for (const prefix of ['META', 'INSTAGRAM', 'THREADS']) {
    out.add(`${prefix}_APP_ID`);
    out.add(`${prefix}_APP_SECRET`);
    out.add(`${prefix}_REDIRECT_URI`);
  }
  return out;
}

test('.env.example documents every variable the config layer reads', () => {
  const missing = [...read()].filter((k) => !documented().has(k)).sort();
  assert.deepEqual(missing, [],
    `undocumented environment variables: an operator copying .env.example would never know these exist:\n  ${missing.join('\n  ')}`);
});

test('the provider credential keys really are read, via a computed prefix', () => {
  // Guards the explicit list above: if buildProvider stops using a template,
  // this test should be revisited rather than silently over-asserting.
  assert.match(ENV_JS, /function buildProvider\(prefix/,
    'buildProvider must still exist for the computed-key allowance to make sense');
  assert.match(ENV_JS, /optionalString\(`\$\{prefix\}_APP_ID`\)/,
    'provider app IDs must still be read through the computed prefix');
});

test('the live-publishing flag is documented and defaults to off', () => {
  // The single most dangerous variable in the file: it decides whether a queued
  // post becomes a real post on a real business page.
  assert.ok(documented().has('ENABLE_LIVE_PROVIDER_PUBLISHING'),
    'ENABLE_LIVE_PROVIDER_PUBLISHING must appear in .env.example');
  assert.match(EXAMPLE, /^ENABLE_LIVE_PROVIDER_PUBLISHING=false$/m,
    'the shipped template must start with live publishing OFF');
});

test('.env.example carries no real secret values', () => {
  // A template is copied and committed by people in a hurry. Every credential
  // slot must be empty; only non-sensitive tuning may carry a default.
  const SECRET_KEYS = [
    'DB_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY_BASE64', 'OPENAI_API_KEY',
    'META_APP_SECRET', 'INSTAGRAM_APP_SECRET', 'THREADS_APP_SECRET',
  ];
  for (const key of SECRET_KEYS) {
    const m = EXAMPLE.match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (!m) continue;
    assert.equal(m[1].trim(), '', `${key} must be blank in .env.example`);
  }
});

test('the persistent-storage requirement is stated where an operator will see it', () => {
  // The source comment in env.js already calls this a deployment blocker. The
  // warning has to live in the file people actually copy.
  assert.ok(documented().has('MEDIA_STORAGE_PATH'), 'MEDIA_STORAGE_PATH must be documented');
  const block = EXAMPLE.slice(Math.max(0, EXAMPLE.indexOf('MEDIA_STORAGE_PATH') - 700));
  assert.match(block, /WIPED ON REDEPLOY|persistent/i,
    'the template must warn that the default media path does not survive a redeploy');
});
