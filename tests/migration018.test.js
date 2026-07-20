import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dir, '..', 'database', 'migrations');
const sql = readFileSync(path.join(migrationsDir, '018_provider_error_visibility.sql'), 'utf8');
const schema = readFileSync(path.join(dir, '..', 'database', 'schema.sql'), 'utf8');

const IMAGE_COLS = [
  'image_status', 'image_provider', 'image_error_category', 'image_error_code',
  'image_error_message', 'image_http_status', 'image_retryable',
  'image_attempt_count', 'image_last_attempt_at',
];
const HEALTH_COLS = [
  'hcti_connection_label', 'hcti_last_success_at', 'hcti_last_failure_at',
  'hcti_last_error_category', 'hcti_last_checked_at',
  'openai_connection_label', 'openai_last_success_at', 'openai_last_failure_at',
  'openai_last_error_category', 'openai_last_checked_at',
];

test('migration 018 is additive: no destructive DDL', () => {
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|DATABASE|INDEX)/i);
  assert.doesNotMatch(sql, /TRUNCATE/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
  assert.doesNotMatch(sql, /MODIFY\s+COLUMN/i);
  assert.doesNotMatch(sql, /CHANGE\s+COLUMN/i);
  assert.doesNotMatch(sql, /RENAME/i);
});

test('migration 018 creates no tables — only ALTERs the two existing ones', () => {
  assert.equal((sql.match(/CREATE TABLE/g) || []).length, 0, 'no new tables');
  const alters = sql.match(/ALTER TABLE `([a-z_]+)`/g) || [];
  assert.deepEqual(alters.sort(), ['ALTER TABLE `planner_run_items`', 'ALTER TABLE `user_integrations`'].sort());
});

test('image lifecycle columns are added with a safe default', () => {
  for (const col of IMAGE_COLS) {
    assert.match(sql, new RegExp(`ADD COLUMN \`${col}\``), `migration adds ${col}`);
    assert.match(schema, new RegExp(`\`${col}\``), `schema declares ${col}`);
  }
  // image_status defaults to not_requested so existing rows are valid without a backfill.
  assert.match(sql, /`image_status`\s+VARCHAR\(32\)\s+NOT NULL DEFAULT 'not_requested'/);
  assert.match(schema, /`image_status`\s+VARCHAR\(32\)\s+NOT NULL DEFAULT 'not_requested'/);
  // A queryable index for "failed images in this run".
  assert.match(sql, /CREATE INDEX `idx_pri_image_status` ON `planner_run_items`/);
  assert.match(schema, /KEY `idx_pri_image_status`/);
});

test('provider-health columns are added for both HCTI and OpenAI', () => {
  for (const col of HEALTH_COLS) {
    assert.match(sql, new RegExp(`ADD COLUMN \`${col}\``), `migration adds ${col}`);
    assert.match(schema, new RegExp(`\`${col}\``), `schema declares ${col}`);
  }
});

test('no credential material is stored by migration 018', () => {
  // Check the actual COLUMN definitions, not the prose comments (which explain
  // that the masked last-4 is still derived from the EXISTING encrypted envelope
  // and that a label is NOT a credential).
  const addedColumns = [...sql.matchAll(/ADD COLUMN `([a-z_]+)`/g)].map((m) => m[1]);
  for (const col of addedColumns) {
    assert.doesNotMatch(col, /encrypted|api_?key|secret|token|password/i, `${col} must not be a credential column`);
  }
  // Error columns hold a category/message/status — never a provider body.
  assert.match(sql, /`image_error_category`\s+VARCHAR\(48\)/);
  assert.match(sql, /`image_error_message`\s+VARCHAR\(1024\)\s+NULL DEFAULT NULL/);
});

test('migration 018 runs after 017', () => {
  assert.match(sql, /after 017/i);
});
