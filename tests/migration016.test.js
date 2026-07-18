import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dir, '..', 'database', 'migrations');
const sql = readFileSync(path.join(migrationsDir, '016_manual_publish_workspace.sql'), 'utf8');
const schema = readFileSync(path.join(dir, '..', 'database', 'schema.sql'), 'utf8');

test('migration 016 is additive: no destructive or narrowing DDL', () => {
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|DATABASE|INDEX)/i);
  assert.doesNotMatch(sql, /TRUNCATE/i);
  // Widening is done via ADD only; we never MODIFY/CHANGE an existing column here.
  assert.doesNotMatch(sql, /MODIFY\s+COLUMN/i);
  assert.doesNotMatch(sql, /CHANGE\s+COLUMN/i);
  assert.doesNotMatch(sql, /RENAME/i);
});

test('migration 016 creates no table (it only extends scheduled_posts)', () => {
  assert.doesNotMatch(sql, /CREATE TABLE/i);
});

test('migration 016 is a single additive ALTER on scheduled_posts', () => {
  assert.equal((sql.match(/ALTER TABLE/g) || []).length, 1, 'exactly one ALTER');
  assert.match(sql, /ALTER TABLE `scheduled_posts`/);
  // Five additive columns + one additive index, nothing destructive.
  assert.equal((sql.match(/ADD COLUMN/g) || []).length, 5, 'adds five columns');
  assert.match(sql, /ADD KEY `idx_sp_user_origin_status`/);
  assert.doesNotMatch(sql, /DROP|MODIFY|CHANGE/);
});

test('the new columns have safe, backward-compatible shapes', () => {
  // post_origin is NULLable (legacy rows are derived, never mislabelled).
  assert.match(sql, /`post_origin`[\s\S]*?ENUM\([^)]*'manual_draft'[^)]*'automation_generated'[^)]*\)[\s\S]*?NULL DEFAULT NULL/);
  // Only the three supported provenance families exist alongside the manual ones.
  assert.doesNotMatch(sql, /linkedin|tiktok|pinterest|twitter|youtube/i);
  // draft_version defaults to 1 so existing rows are valid and comparable.
  assert.match(sql, /`draft_version`\s+INT UNSIGNED\s+NOT NULL DEFAULT 1/);
  assert.match(sql, /`scheduled_local_date`\s+DATE\s+NULL DEFAULT NULL/);
  assert.match(sql, /`scheduled_local_time`\s+TIME\s+NULL DEFAULT NULL/);
  assert.match(sql, /`last_manual_edit_at`\s+DATETIME\s+NULL DEFAULT NULL/);
});

test('migration 016 does not touch post_revisions (manual history uses activity_logs)', () => {
  // Assert against DDL only; the header prose legitimately explains WHY the
  // planner-scoped post_revisions table is left alone.
  const ddl = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  assert.doesNotMatch(ddl, /post_revisions/i);
  assert.doesNotMatch(ddl, /planner_run_item_id/i);
});

test('schema.sql reflects the E columns and the workspace index', () => {
  const posts = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS `scheduled_posts`'));
  const body = posts.slice(0, posts.indexOf('ENGINE='));
  assert.match(body, /`post_origin`\s+ENUM/);
  assert.match(body, /`draft_version`\s+INT UNSIGNED\s+NOT NULL DEFAULT 1/);
  assert.match(body, /`scheduled_local_date`\s+DATE/);
  assert.match(body, /`scheduled_local_time`\s+TIME/);
  assert.match(body, /`last_manual_edit_at`\s+DATETIME/);
  assert.match(body, /idx_sp_user_origin_status/);
});

test('migrations run in an unbroken 010..016 sequence', () => {
  const nums = readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .map((f) => Number(f.slice(0, 3)))
    .sort((a, b) => a - b);
  assert.equal(nums[nums.length - 1], 16, 'the latest migration is 016');
  for (let n = 10; n <= 16; n += 1) {
    assert.ok(nums.includes(n), `migration ${String(n).padStart(3, '0')} exists`);
  }
});
