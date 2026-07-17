import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(dir, '..', 'database', 'migrations', '014_automation_buffer_and_durable_jobs.sql'), 'utf8');
const schema = readFileSync(path.join(dir, '..', 'database', 'schema.sql'), 'utf8');

test('migration 014 is additive: no destructive DDL', () => {
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
  assert.doesNotMatch(sql, /TRUNCATE/i);
  assert.doesNotMatch(sql, /MODIFY\s+COLUMN/i);
  assert.doesNotMatch(sql, /CHANGE\s+COLUMN/i);
});

test('migration 014 creates the four D1 tables', () => {
  for (const t of ['content_automations', 'automation_schedule_slots', 'background_jobs', 'worker_leases']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS \`${t}\``), `creates ${t}`);
  }
});

test('migration 014 only ADDs columns to existing tables', () => {
  // The two ALTERs are additive ADD COLUMN + ADD KEY/CONSTRAINT only.
  const alters = sql.match(/ALTER TABLE[\s\S]*?;/g) || [];
  assert.equal(alters.length, 2);
  for (const a of alters) {
    assert.match(a, /ADD COLUMN/);
    assert.doesNotMatch(a, /DROP|MODIFY|CHANGE/);
  }
});

test('FK columns are BIGINT UNSIGNED to match parent keys', () => {
  // Every user/automation/run/item foreign key column is BIGINT UNSIGNED.
  assert.match(sql, /`user_id`\s+BIGINT UNSIGNED/);
  assert.match(sql, /`automation_id`\s+BIGINT UNSIGNED/);
  assert.match(sql, /`content_automation_id`\s+BIGINT UNSIGNED/);
});

test('idempotency uniqueness is enforced on jobs and slots', () => {
  assert.match(sql, /UNIQUE KEY `uq_jobs_idempotency` \(`idempotency_key`\)/);
  assert.match(sql, /UNIQUE KEY `uq_slot_automation_datetime`/);
});

test('schema.sql reflects the D1 tables and the two additive columns', () => {
  for (const t of ['content_automations', 'automation_schedule_slots', 'background_jobs', 'worker_leases']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS \`${t}\``), `schema has ${t}`);
  }
  // planner_runs + activity_logs gained the automation back-references.
  assert.match(schema, /`content_automation_id`\s+BIGINT UNSIGNED NULL/);
});
