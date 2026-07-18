/**
 * Migration status — what this repository contains, and how to find out what a
 * database has actually had applied.
 *
 * IMPORTANT, and the reason this command is shaped the way it is: **this project
 * has no applied-migration tracking.** There is no `schema_migrations` table and
 * no migration runner; migrations are applied deliberately by an operator with
 * the mysql client, in order, once.
 *
 * So this command does NOT invent a tracking table, and does NOT claim to know
 * what a remote database has applied. Inventing that state is worse than
 * admitting its absence: a status command that guesses gives an operator
 * confidence to skip a migration that was never actually run.
 *
 * It reports the repository inventory, and prints the exact read-only queries an
 * operator can run against a database to establish applied state by inspection.
 *
 * Usage:  node tools/migration-status.mjs
 * Exit:   0 always (informational; use migrate:check for a pass/fail gate)
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

/** Tables and columns each migration is expected to introduce. */
export function migrationInventory({ root = ROOT } = {}) {
  const dir = path.join(root, 'database', 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = stripSql(fs.readFileSync(path.join(dir, file), 'utf8'));
      const tables = [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?(\w+)`?/gi)].map((m) => m[1]);
      const columns = [...sql.matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+`?(\w+)`?/gi)].map((m) => m[1]);
      return { file, number: Number((file.match(/^(\d{3})/) || [])[1] ?? -1), tables, columns };
    });
}

/** Whether this project tracks applied migrations anywhere. */
export function hasAppliedTracking({ root = ROOT } = {}) {
  const schemaPath = path.join(root, 'database', 'schema.sql');
  if (!fs.existsSync(schemaPath)) return false;
  return /schema_migrations|migration_history/i.test(fs.readFileSync(schemaPath, 'utf8'));
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const inventory = migrationInventory();
  console.log(`migration status — repository inventory (${inventory.length} migrations)\n`);
  for (const m of inventory) {
    const bits = [];
    if (m.tables.length) bits.push(`creates ${m.tables.join(', ')}`);
    if (m.columns.length) bits.push(`adds ${m.columns.length} column(s)`);
    console.log(`  ${m.file}`);
    if (bits.length) console.log(`      ${bits.join('; ')}`);
  }

  console.log('\napplied state:');
  if (hasAppliedTracking()) {
    console.log('  This project tracks applied migrations in the database.');
    console.log('  Query that table directly to list applied vs pending.');
  } else {
    console.log('  BLOCKED — this project has no applied-migration tracking table,');
    console.log('  and no database connection is made by this command.');
    console.log('');
    console.log('  Applied state cannot be reported from the repository alone, and is');
    console.log('  deliberately not guessed. Establish it by inspection instead: each');
    console.log('  migration is identifiable by the tables it creates.');
    console.log('');
    console.log('  Read-only, run against the target database:');
    console.log('');
    console.log('    SELECT table_name FROM information_schema.tables');
    console.log('     WHERE table_schema = DATABASE() ORDER BY table_name;');
    console.log('');
    console.log('  Then match against the inventory above. For example, the presence of');
    console.log('  `publish_attempts` indicates 015 has been applied; its absence');
    console.log('  indicates 015 is pending.');
  }

  console.log('\nThis command never connects to a database and never applies a migration.');
  console.log('To apply, follow deploy/STAGING.md — deliberately, in order, after a verified backup.');
}
