/**
 * Migration check — static verification of the migration set. CI-safe.
 *
 * Reads files only. It never connects to a database, so it is safe to run
 * anywhere, including in a pipeline with no credentials.
 *
 * Usage:  node tools/migration-check.mjs
 * Exit:   0 = all checks pass, 1 = at least one problem
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * SQL with comments removed.
 *
 * Every extraction below must run on this, not on the raw file. A migration
 * comment explaining "`ADD COLUMN IF NOT EXISTS` so it is idempotent" is prose,
 * not a column definition — scanning the raw text reported a column literally
 * named `IF` and failed the whole check.
 */
function stripSql(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Statements that cannot be undone by re-running a migration and that a reviewer
 * must consciously approve. This project's 010-017 set contains none.
 */
const DESTRUCTIVE = [
  /\bDROP\s+TABLE\b/i, /\bDROP\s+DATABASE\b/i, /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i, /\bDROP\s+COLUMN\b/i, /\bDROP\s+INDEX\b/i,
  /\bDROP\s+FOREIGN\s+KEY\b/i,
];

/** Inspect the migration directory and the committed schema. */
export function checkMigrations({ root = ROOT } = {}) {
  const problems = [];
  const notes = [];
  const dir = path.join(root, 'database', 'migrations');

  if (!fs.existsSync(dir)) {
    return { problems: ['database/migrations does not exist'], notes, files: [] };
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) problems.push('no migration files found');

  // --- naming and ordering ------------------------------------------------
  const numbers = [];
  for (const f of files) {
    const m = f.match(/^(\d{3})_[a-z0-9_]+\.sql$/);
    if (!m) {
      problems.push(`malformed migration filename: ${f} (expected NNN_lower_snake_case.sql)`);
      continue;
    }
    numbers.push({ n: Number(m[1]), file: f });
  }

  const seen = new Map();
  for (const { n, file } of numbers) {
    if (seen.has(n)) problems.push(`duplicate migration number ${String(n).padStart(3, '0')}: ${seen.get(n)} and ${file}`);
    else seen.set(n, file);
  }

  const sorted = [...seen.keys()].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      // A gap is not automatically wrong — a migration may have been withdrawn
      // before release — but it must be a deliberate, noticed decision.
      notes.push(`gap between migration ${sorted[i - 1]} and ${sorted[i]}`);
    }
  }

  // --- contents -----------------------------------------------------------
  for (const { file } of numbers) {
    const full = path.join(dir, file);
    const sql = fs.readFileSync(full, 'utf8');
    const meaningful = sql.split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('--')).join('\n').trim();

    if (!meaningful) { problems.push(`empty migration: ${file}`); continue; }

    // Comments stripped: a migration that *explains* why it avoids DROP must
    // not trip the scanner on its own prose.
    const code = stripSql(sql);
    for (const re of DESTRUCTIVE) {
      if (re.test(code)) {
        problems.push(`destructive statement in ${file}: ${re.source} — requires explicit manual review`);
      }
    }
  }

  // --- schema parity ------------------------------------------------------
  const schemaPath = path.join(root, 'database', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    problems.push('database/schema.sql is missing');
  } else {
    const schema = stripSql(fs.readFileSync(schemaPath, 'utf8'));
    const schemaTables = new Set(
      [...schema.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?(\w+)`?/gi)].map((m) => m[1].toLowerCase()),
    );

    const migTables = new Set();
    const migColumns = new Set();
    for (const { file } of numbers) {
      const sql = stripSql(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?(\w+)`?/gi)) {
        migTables.add(m[1].toLowerCase());
      }
      for (const m of sql.matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+`?(\w+)`?/gi)) {
        migColumns.add(m[1]);
      }
    }

    for (const t of migTables) {
      if (!schemaTables.has(t)) {
        problems.push(`table \`${t}\` is created by a migration but absent from schema.sql`);
      }
    }
    for (const c of migColumns) {
      if (!new RegExp('`' + c + '`', 'i').test(schema)) {
        problems.push(`column \`${c}\` is added by a migration but absent from schema.sql`);
      }
    }
    notes.push(`schema.sql declares ${schemaTables.size} tables; migrations create ${migTables.size} and add ${migColumns.size} columns`);
  }

  return { problems, notes, files };
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const { problems, notes, files } = checkMigrations();
  console.log(`migration check — ${files.length} file(s)`);
  for (const f of files) console.log(`  ${f}`);
  if (notes.length) {
    console.log('\nnotes:');
    for (const n of notes) console.log(`  - ${n}`);
  }
  if (problems.length) {
    console.log('\nPROBLEMS:');
    for (const p of problems) console.log(`  ! ${p}`);
    console.log('\nRESULT: FAILED');
    process.exit(1);
  }
  console.log('\nRESULT: PASS — naming, ordering, contents and schema parity all check out.');
}
