import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dir, '..', 'database', 'migrations');
const sql = readFileSync(path.join(migrationsDir, '015_provider_publishing_and_reconciliation.sql'), 'utf8');
const schema = readFileSync(path.join(dir, '..', 'database', 'schema.sql'), 'utf8');

test('migration 015 is additive: no destructive DDL', () => {
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|DATABASE|INDEX)/i);
  assert.doesNotMatch(sql, /TRUNCATE/i);
  assert.doesNotMatch(sql, /MODIFY\s+COLUMN/i);
  assert.doesNotMatch(sql, /CHANGE\s+COLUMN/i);
  assert.doesNotMatch(sql, /RENAME/i);
});

test('migration 015 creates exactly the publish_attempts table', () => {
  const creates = sql.match(/CREATE TABLE IF NOT EXISTS `[a-z_]+`/g) || [];
  assert.deepEqual(creates, ['CREATE TABLE IF NOT EXISTS `publish_attempts`']);
  const engines = sql.match(/ENGINE=InnoDB/g) || [];
  assert.equal(engines.length, 1, 'exactly one table, one ENGINE clause');
});

test('migration 015 only ADDs to scheduled_post_targets (one additive ALTER)', () => {
  // Exactly one ALTER, and it targets scheduled_post_targets. (Split by position,
  // not by `;` — an inline COMMENT string legitimately contains a semicolon.)
  assert.equal((sql.match(/ALTER TABLE/g) || []).length, 1, 'exactly one ALTER');
  const alter = sql.slice(sql.indexOf('ALTER TABLE'), sql.indexOf('CREATE TABLE'));
  assert.match(alter, /ALTER TABLE `scheduled_post_targets`/);
  // Three additive columns + one additive index, nothing destructive.
  const adds = alter.match(/ADD COLUMN/g) || [];
  assert.equal(adds.length, 3, 'adds three columns');
  assert.match(alter, /ADD KEY `idx_spt_publish_due`/);
  assert.doesNotMatch(alter, /DROP|MODIFY|CHANGE/);
});

test('the three new target columns have safe, backward-compatible shapes', () => {
  // publish_status is an ENUM with a default so existing rows are valid.
  assert.match(sql, /`publish_status`\s+ENUM\([^)]*'scheduled'[^)]*\)\s+NOT NULL DEFAULT 'scheduled'/);
  // last_publish_attempt_id is a NULLable soft pointer (no FK to a ledger row).
  assert.match(sql, /`last_publish_attempt_id`\s+BIGINT UNSIGNED NULL DEFAULT NULL/);
  assert.match(sql, /`attention_reason`\s+VARCHAR\(255\)\s+NULL DEFAULT NULL/);
  // No foreign key is added for the soft pointer.
  assert.doesNotMatch(sql, /CONSTRAINT[^;]*last_publish_attempt_id/i);
});

test('publish_attempts enforces idempotency and the three supported providers', () => {
  assert.match(sql, /UNIQUE KEY `uq_publish_attempts_idempotency` \(`idempotency_key`\)/);
  // Only the supported provider surfaces — never LinkedIn/TikTok/X/etc.
  assert.match(sql, /`provider`\s+ENUM\('meta','instagram','threads'\)/);
  assert.doesNotMatch(sql, /linkedin|tiktok|pinterest|twitter|youtube/i);
  // Normalized attempt lifecycle.
  for (const s of ['started', 'submitted', 'published', 'reconciling', 'retryable_failure', 'permanent_failure', 'unknown_result', 'blocked']) {
    assert.match(sql, new RegExp(`'${s}'`), `status enum has ${s}`);
  }
});

test('publish_attempts foreign keys match parent keys and clean up on delete', () => {
  assert.match(sql, /FOREIGN KEY \(`user_id`\) REFERENCES `users` \(`id`\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \(`scheduled_post_id`\) REFERENCES `scheduled_posts` \(`id`\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \(`scheduled_post_target_id`\) REFERENCES `scheduled_post_targets` \(`id`\) ON DELETE CASCADE/);
  // The account may be disconnected without erasing publish history.
  assert.match(sql, /FOREIGN KEY \(`social_account_id`\) REFERENCES `social_accounts` \(`id`\) ON DELETE SET NULL/);
});

test('the ledger stores no raw tokens, secrets or provider payloads', () => {
  // Assert against the DDL only, with `--` comment lines stripped (the header
  // prose legitimately names a pre-existing provider_response_json column).
  const ddl = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  // Only safe identifiers + a bounded safe_error_message. No access token, no
  // response blob — the whole point of a "safe fields only" audit table.
  assert.doesNotMatch(ddl, /access_token|refresh_token|`token`|secret|password/i);
  assert.doesNotMatch(ddl, /response_json|payload_json|raw_response|`payload`/i);
  assert.match(ddl, /`safe_error_message`\s+VARCHAR/);
});

test('schema.sql reflects the D2 target columns and the ledger table', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `publish_attempts`/);
  assert.match(schema, /`publish_status`\s+ENUM/);
  assert.match(schema, /`last_publish_attempt_id`\s+BIGINT UNSIGNED/);
  assert.match(schema, /idx_spt_publish_due/);
});

test('migrations run in an unbroken 010..015 sequence', () => {
  const nums = readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .map((f) => Number(f.slice(0, 3)))
    .sort((a, b) => a - b);
  // Every migration from the first through 015 is present with no gaps.
  const last = nums[nums.length - 1];
  assert.equal(last, 15, 'the latest migration is 015');
  for (let n = 10; n <= 15; n += 1) {
    assert.ok(nums.includes(n), `migration ${String(n).padStart(3, '0')} exists`);
  }
});
