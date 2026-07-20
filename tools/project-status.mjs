#!/usr/bin/env node
/**
 * `npm run project:status` — a safe, offline snapshot of where the project is.
 *
 * Prints branch, HEAD, clean/dirty state, the latest commit subject, the memory
 * file locations, the important SAFE feature flags (names + defaults, never
 * values), the test commands, and a one-line summary of each known issue from
 * docs/KNOWN_ISSUES.md. It NEVER prints an environment-variable value, a
 * credential, or any secret, and it makes no network call.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '(unavailable)';
  }
}

function read(rel) {
  const p = path.join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

const branch = git('rev-parse --abbrev-ref HEAD');
const head = git('rev-parse --short HEAD');
const subject = git('log -1 --pretty=%s');
const dirty = git('status --porcelain');

const MEMORY_FILES = [
  'PROJECT_MEMORY.md',
  'docs/AI_HANDOFF.md',
  'docs/KNOWN_ISSUES.md',
  'docs/DECISIONS.md',
  'docs/OPERATIONS_RUNBOOK.md',
  'docs/ACCEPTANCE_CHECKLIST.md',
];

// Safe flags: NAMES and documented defaults only — never a value from env.
const SAFE_FLAGS = [
  ['ENABLE_LIVE_PROVIDER_PUBLISHING', 'false (required initial state — no live provider calls)'],
  ['HOSTINGER_SINGLE_PROCESS_JOBS', 'false (true only on managed single-process hosts)'],
];

function knownIssues() {
  const md = read('docs/KNOWN_ISSUES.md');
  if (!md) return ['(docs/KNOWN_ISSUES.md missing)'];
  const out = [];
  const lines = md.split(/\r?\n/);
  let title = null;
  for (const line of lines) {
    const t = /^##\s+(CY-\d+.*)$/.exec(line);
    if (t) { title = t[1].trim(); continue; }
    const s = /^-\s+\*\*Status:\*\*\s*(.+)$/.exec(line);
    if (s && title) { out.push(`${title} — ${s[1].trim()}`); title = null; }
  }
  return out.length ? out : ['(no issues parsed)'];
}

console.log('Cyflow Social — project status');
console.log('==============================');
console.log(`Branch:        ${branch}`);
console.log(`HEAD:          ${head}  ${subject}`);
console.log(`Working tree:  ${dirty ? 'DIRTY' : 'clean'}`);
console.log('');
console.log('Memory files:');
for (const f of MEMORY_FILES) console.log(`  ${existsSync(path.join(ROOT, f)) ? '✓' : '✗ MISSING'}  ${f}`);
console.log('');
console.log('Safe feature flags (names + defaults only; values live in env):');
for (const [name, note] of SAFE_FLAGS) console.log(`  ${name} = ${note}`);
console.log('  Live publishing defaults to FALSE.');
console.log('');
console.log('Test commands:');
console.log('  npm test                 # unit');
console.log('  npm run test:integration # disposable MariaDB (CYFLOW_TEST_DB_*)');
console.log('  npm run migrate:check    # migration parity');
console.log('  npm run project:handoff  # memory-file validation');
console.log('');
console.log('Known issues:');
for (const line of knownIssues()) console.log(`  - ${line}`);
