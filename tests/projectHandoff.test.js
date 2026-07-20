// The AI-handoff memory files must exist and stay current. A release is not
// complete when the code changes but the handoff memory goes stale (see
// CLAUDE.md → Project Continuity). This asserts the STRUCTURE (files + required
// headings + documented safety + a non-empty next action), not exact dates or
// commit hashes, which change over time.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateHandoff } from '../tools/project-handoff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = [
  'PROJECT_MEMORY.md',
  'docs/AI_HANDOFF.md',
  'docs/KNOWN_ISSUES.md',
  'docs/DECISIONS.md',
  'docs/OPERATIONS_RUNBOOK.md',
  'docs/ACCEPTANCE_CHECKLIST.md',
  'docs/SESSION_CHECKPOINT.md',
];

test('every required handoff memory file exists', () => {
  for (const f of REQUIRED) {
    assert.ok(existsSync(path.join(ROOT, f)), `${f} must exist`);
  }
});

test('the handoff validator passes on the current memory files', () => {
  const { ok, problems } = validateHandoff();
  assert.ok(ok, `handoff validation problems:\n  ${problems.join('\n  ')}`);
});

test('CLAUDE.md documents the project continuity + provider-error rules', () => {
  const md = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(md, /Project Continuity/);
  assert.match(md, /PROJECT_MEMORY\.md/);
  assert.match(md, /ENABLE_LIVE_PROVIDER_PUBLISHING/);
  assert.match(md, /normalized model|normalizeProviderError|PROVIDER_ERROR_CATEGORY/);
});
