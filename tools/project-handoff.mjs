#!/usr/bin/env node
/**
 * `npm run project:handoff` — validate that the AI-handoff memory files exist
 * and carry the sections a fresh session needs. Offline; no network, no DB.
 *
 * Fails when:
 *   - PROJECT_MEMORY.md or docs/AI_HANDOFF.md is missing;
 *   - a required file is missing a required heading;
 *   - a known issue has no Status;
 *   - live-publishing safety is undocumented;
 *   - the current "Next Exact Action" is empty.
 *
 * Exact dates and commit hashes are NOT required (they change over time), so the
 * repo test that imports `validateHandoff` stays stable.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FILES = [
  'PROJECT_MEMORY.md',
  'docs/AI_HANDOFF.md',
  'docs/KNOWN_ISSUES.md',
  'docs/DECISIONS.md',
  'docs/OPERATIONS_RUNBOOK.md',
  'docs/ACCEPTANCE_CHECKLIST.md',
  'docs/SESSION_CHECKPOINT.md',
];

// A representative subset of headings that must be present (not the full list,
// to stay robust to reordering/wording of the rest).
const REQUIRED_HEADINGS = {
  'PROJECT_MEMORY.md': [
    'Project Identity', 'Current Branch', 'Current Known HEAD',
    'Current Known Hostinger Deployment', 'Current Safety Flags',
    'Current Live Problems', 'Provider Status', 'Next Exact Action', 'Do Not Repeat',
  ],
  'docs/AI_HANDOFF.md': [
    'What the user is building', 'Current repository state',
    'Last known deployed commit', 'What has been completed',
    'What remains unresolved', 'Safety constraints', 'Next recommended task',
    'Expected final acceptance criteria',
  ],
  'docs/ACCEPTANCE_CHECKLIST.md': ['Safety', 'Gates'],
  'docs/SESSION_CHECKPOINT.md': [
    'Current Objective', 'Current Phase', 'Current Branch', 'Current HEAD',
    'Last Completed Step', 'Exact Next Step', 'Safety Flags', 'Last Updated',
  ],
};

// Checkpoint sections that must be NON-EMPTY (a stale/blank checkpoint is a
// crash-safety failure, not a formality).
const NONEMPTY_CHECKPOINT_SECTIONS = ['Current Objective', 'Current Phase', 'Exact Next Step'];

function read(rel) {
  const p = path.join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** Text under a `## Heading` (heading may carry a trailing parenthetical). */
function sectionBody(md, heading) {
  const re = new RegExp(`^#{1,3}\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b.*$`, 'm');
  const m = re.exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const next = /\n#{1,3}\s+\S/.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

export function validateHandoff() {
  const problems = [];

  for (const f of REQUIRED_FILES) {
    if (!read(f)) problems.push(`missing required file: ${f}`);
  }
  // These two are hard requirements for any handoff.
  if (!read('PROJECT_MEMORY.md')) problems.push('PROJECT_MEMORY.md is required and missing');
  if (!read('docs/AI_HANDOFF.md')) problems.push('docs/AI_HANDOFF.md is required and missing');

  for (const [file, headings] of Object.entries(REQUIRED_HEADINGS)) {
    const md = read(file);
    if (!md) continue; // already reported as missing
    for (const h of headings) {
      if (sectionBody(md, h) == null) problems.push(`${file}: missing heading "${h}"`);
    }
  }

  // Next Exact Action must not be empty.
  const memory = read('PROJECT_MEMORY.md');
  if (memory) {
    const next = sectionBody(memory, 'Next Exact Action');
    if (!next || next.length < 8) problems.push('PROJECT_MEMORY.md: "Next Exact Action" is empty');
  }

  // The crash-safe checkpoint must have live, non-empty core fields.
  const checkpoint = read('docs/SESSION_CHECKPOINT.md');
  if (checkpoint) {
    for (const h of NONEMPTY_CHECKPOINT_SECTIONS) {
      const body = sectionBody(checkpoint, h);
      if (!body || body.length < 8) problems.push(`docs/SESSION_CHECKPOINT.md: "${h}" is empty`);
    }
  }

  const combined = REQUIRED_FILES.map(read).filter(Boolean).join('\n');

  // Live-publishing safety must be documented somewhere in the memory files.
  if (!/ENABLE_LIVE_PROVIDER_PUBLISHING/.test(combined) || !/false/i.test(combined)) {
    problems.push('live-publishing safety (ENABLE_LIVE_PROVIDER_PUBLISHING=false) is undocumented');
  }

  // A final READY must not be claimed while a release-blocking (high-severity,
  // open/in_progress) issue remains.
  if (/READY FOR ONE HOSTINGER REDEPLOY/i.test(combined)) {
    const issuesMd = read('docs/KNOWN_ISSUES.md') || '';
    const blocking = [...issuesMd.matchAll(/##\s+(CY-\d+[^\n]*)[\s\S]*?\*\*Status:\*\*\s*([^\n]+)[\s\S]*?\*\*Severity:\*\*\s*([^\n]+)/g)]
      .filter((m) => /open|in_progress/i.test(m[2]) && /high/i.test(m[3]));
    for (const m of blocking) {
      problems.push(`READY claimed but "${m[1].trim()}" is still ${m[2].trim()} (high severity)`);
    }
  }

  // Every known issue must carry a Status.
  const issues = read('docs/KNOWN_ISSUES.md');
  if (issues) {
    const titles = [...issues.matchAll(/^##\s+(CY-\d+.*)$/gm)].map((m) => m[1].trim());
    for (const title of titles) {
      const body = sectionBody(issues, title.replace(/\s+—.*$/, '')) ?? sectionBody(issues, title);
      // Fall back to a loose check: the block after the title mentions Status.
      const idx = issues.indexOf(title);
      const after = issues.slice(idx, idx + 400);
      if (!/\*\*Status:\*\*/.test(after) && !(body && /\*\*Status:\*\*/.test(body))) {
        problems.push(`known issue "${title}" has no Status`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  const { ok, problems } = validateHandoff();
  if (ok) {
    console.log('project:handoff — OK. All required memory files present and headed.');
    process.exit(0);
  }
  console.error('project:handoff — FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
