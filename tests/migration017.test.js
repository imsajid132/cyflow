import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dir, '..', 'database', 'migrations');
const sql = readFileSync(path.join(migrationsDir, '017_user_data_export_and_deletion.sql'), 'utf8');
const schema = readFileSync(path.join(dir, '..', 'database', 'schema.sql'), 'utf8');
const ddl = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

test('migration 017 is additive: no destructive DDL', () => {
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|DATABASE|INDEX)/i);
  assert.doesNotMatch(sql, /TRUNCATE|ALTER TABLE|MODIFY|CHANGE\s+COLUMN|RENAME/i);
});

test('migration 017 creates exactly the two G tables', () => {
  const creates = (sql.match(/CREATE TABLE IF NOT EXISTS `[a-z_]+`/g) || []);
  assert.deepEqual(creates, [
    'CREATE TABLE IF NOT EXISTS `user_data_exports`',
    'CREATE TABLE IF NOT EXISTS `account_deletion_requests`',
  ]);
  assert.equal((sql.match(/ENGINE=InnoDB/g) || []).length, 2);
});

test('the export ledger stores a token HASH, not the token, and points at private storage', () => {
  assert.match(ddl, /`download_token_hash`\s+CHAR\(64\)/);
  assert.match(ddl, /UNIQUE KEY `uq_user_data_exports_token` \(`download_token_hash`\)/);
  assert.match(ddl, /`storage_key`\s+VARCHAR\(255\)/);
  // No raw token / secret columns.
  assert.doesNotMatch(ddl, /`download_token`\s|access_token|password|secret/i);
  // The export is owned and cleaned up with the user.
  assert.match(ddl, /FOREIGN KEY \(`user_id`\) REFERENCES `users` \(`id`\) ON DELETE CASCADE/);
});

test('the deletion receipt is keyed by an opaque code and can outlive the user', () => {
  assert.match(ddl, /`confirmation_code`\s+VARCHAR\(64\)\s+NOT NULL/);
  assert.match(ddl, /UNIQUE KEY `uq_account_deletion_code` \(`confirmation_code`\)/);
  // user_id nullable, and NO cascade FK (the receipt survives account deletion).
  assert.match(ddl, /`user_id`\s+BIGINT UNSIGNED NULL DEFAULT NULL/);
  assert.doesNotMatch(ddl, /fk_account_deletion[\s\S]*REFERENCES `users`/);
});

test('schema.sql reflects both G tables', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `user_data_exports`/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `account_deletion_requests`/);
});

test('migrations run in an unbroken 010..017 sequence', () => {
  const nums = readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .map((f) => Number(f.slice(0, 3)))
    .sort((a, b) => a - b);
  assert.equal(nums[nums.length - 1], 17, 'the latest migration is 017');
  for (let n = 10; n <= 17; n += 1) assert.ok(nums.includes(n), `migration ${String(n).padStart(3, '0')} exists`);
});
