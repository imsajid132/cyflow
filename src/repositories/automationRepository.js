/**
 * content_automations + automation_schedule_slots.
 *
 * An automation is the ongoing configuration + rolling state. A slot is one
 * intended future post; it is created (planned) BEFORE its planner_run_item
 * exists, and its UNIQUE(automation_id, local_date, local_time, sequence) key is
 * the "no duplicate date/time" guarantee. Every read/write is user-scoped in SQL
 * exactly as the WHERE clauses show, so ownership is enforced here, not in the UI.
 */

import { getPool } from '../db/pool.js';
import { withTransaction } from '../db/transactions.js';
import { toMysqlUtc } from '../utils/time.js';

function runner(connection) {
  return connection ?? getPool();
}

const jsonCol = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

export function sanitizeAutomation(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    businessProfileId: row.business_profile_id == null ? null : String(row.business_profile_id),
    plannerRunId: row.planner_run_id == null ? null : String(row.planner_run_id),
    name: row.name ?? null,
    status: row.status,
    mode: row.mode,
    timezone: row.timezone,
    selectedWeekdays: jsonCol(row.selected_weekdays_json) ?? [],
    postingTimes: jsonCol(row.posting_times_json) ?? [],
    postsPerDay: Number(row.posts_per_day ?? 1),
    rhythmKey: row.rhythm_key ?? null,
    selectedPlatforms: jsonCol(row.selected_platforms_json) ?? [],
    selectedAccountIds: (jsonCol(row.selected_account_ids_json) ?? []).map(String),
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    generationHorizonDays: Number(row.generation_horizon_days ?? 14),
    minimumReadyDays: Number(row.minimum_ready_days ?? 7),
    lowBufferDays: Number(row.low_buffer_days ?? 3),
    missedPostPolicy: row.missed_post_policy,
    failurePolicy: row.failure_policy,
    configSnapshot: jsonCol(row.config_snapshot_json),
    generatedThroughDate: row.generated_through_date ?? null,
    attentionReason: row.attention_reason ?? null,
    lastRefillAt: row.last_refill_at ?? null,
    nextRefillAt: row.next_refill_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    stoppedAt: row.stopped_at ?? null,
  };
}

export function sanitizeSlot(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    automationId: String(row.automation_id),
    plannerRunItemId: row.planner_run_item_id == null ? null : String(row.planner_run_item_id),
    localDate: row.local_date ?? null,
    localTime: row.local_time,
    sequence: Number(row.sequence ?? 0),
    scheduledForUtc: row.scheduled_for_utc ?? null,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    lastErrorCategory: row.last_error_category ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

const A_COLS = 'id, user_id, business_profile_id, planner_run_id, name, status, mode, timezone, '
  + 'selected_weekdays_json, posting_times_json, posts_per_day, rhythm_key, selected_platforms_json, '
  + 'selected_account_ids_json, start_date, end_date, generation_horizon_days, minimum_ready_days, '
  + 'low_buffer_days, missed_post_policy, failure_policy, config_snapshot_json, generated_through_date, '
  + 'attention_reason, last_refill_at, next_refill_at, created_at, updated_at, stopped_at';

/*
 * JSON columns are written as plain bound strings, NOT wrapped in
 * `CAST(? AS JSON)`.
 *
 * This is what broke automation creation on the deployed host. `CAST(x AS JSON)`
 * is MySQL-only syntax: MariaDB's CAST accepts BINARY, CHAR, DATE, DATETIME,
 * DECIMAL, DOUBLE, FLOAT, INTEGER, SIGNED, TIME and UNSIGNED, and nothing else,
 * so on MariaDB the statement is rejected before it runs and the request becomes
 * a 500. MariaDB still ACCEPTS `JSON` in DDL — it is an alias for LONGTEXT — so
 * the migrations applied cleanly and the schema looked correct, which is what
 * made this hard to see.
 *
 * The cast was never doing anything: every other JSON column in this codebase
 * (35 of them, across business profiles, planner runs, revisions, jobs and
 * activity logs) is written as a plain parameter and always has been. MySQL
 * implicitly converts a valid JSON string on assignment to a JSON column, and
 * MariaDB stores the text. Removing the cast makes this path identical to every
 * path that already works, on both engines.
 *
 * No migration is required: the column types are unchanged and compatible.
 */
export async function createAutomation(input, connection) {
  const [res] = await runner(connection).execute(
    `INSERT INTO content_automations
       (user_id, business_profile_id, name, status, mode, timezone, selected_weekdays_json,
        posting_times_json, posts_per_day, rhythm_key, selected_platforms_json, selected_account_ids_json,
        start_date, end_date, generation_horizon_days, minimum_ready_days, low_buffer_days,
        missed_post_policy, failure_policy, config_snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId, input.businessProfileId ?? null, input.name ?? null,
      input.status ?? 'draft', input.mode ?? 'review', input.timezone,
      JSON.stringify(input.selectedWeekdays ?? []), JSON.stringify(input.postingTimes ?? []),
      input.postsPerDay ?? 1, input.rhythmKey ?? null,
      JSON.stringify(input.selectedPlatforms ?? []), JSON.stringify((input.selectedAccountIds ?? []).map(String)),
      input.startDate ?? null, input.endDate ?? null,
      input.generationHorizonDays ?? 14, input.minimumReadyDays ?? 7, input.lowBufferDays ?? 3,
      input.missedPostPolicy ?? 'skip', input.failurePolicy ?? 'pause',
      input.configSnapshot == null ? null : JSON.stringify(input.configSnapshot),
    ],
  );
  return findAutomationByIdForUser(res.insertId, input.userId, connection);
}

export async function findAutomationByIdForUser(id, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${A_COLS} FROM content_automations WHERE id = ? AND user_id = ? LIMIT 1`, [id, userId],
  );
  return sanitizeAutomation(rows[0]);
}

export async function listAutomationsForUser(userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${A_COLS} FROM content_automations WHERE user_id = ? ORDER BY created_at DESC, id DESC`, [userId],
  );
  return rows.map(sanitizeAutomation);
}

/** Column whitelist for updates — never mass-assign. */
const UPDATABLE = new Map([
  ['name', 'name'], ['status', 'status'], ['mode', 'mode'], ['timezone', 'timezone'],
  ['postsPerDay', 'posts_per_day'], ['rhythmKey', 'rhythm_key'],
  ['startDate', 'start_date'], ['endDate', 'end_date'],
  ['generationHorizonDays', 'generation_horizon_days'], ['minimumReadyDays', 'minimum_ready_days'],
  ['lowBufferDays', 'low_buffer_days'], ['missedPostPolicy', 'missed_post_policy'],
  ['failurePolicy', 'failure_policy'], ['generatedThroughDate', 'generated_through_date'],
  ['attentionReason', 'attention_reason'], ['lastRefillAt', 'last_refill_at'],
  ['nextRefillAt', 'next_refill_at'], ['stoppedAt', 'stopped_at'], ['plannerRunId', 'planner_run_id'],
]);
const JSON_UPDATABLE = new Map([
  ['selectedWeekdays', 'selected_weekdays_json'], ['postingTimes', 'posting_times_json'],
  ['selectedPlatforms', 'selected_platforms_json'], ['selectedAccountIds', 'selected_account_ids_json'],
  ['configSnapshot', 'config_snapshot_json'],
]);

export async function updateAutomation(id, userId, fields, connection) {
  const sets = [];
  const params = [];
  for (const [key, col] of UPDATABLE) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`\`${col}\` = ?`);
      params.push(fields[key] instanceof Date ? toMysqlUtc(fields[key]) : fields[key] ?? null);
    }
  }
  for (const [key, col] of JSON_UPDATABLE) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      // Plain parameter, not CAST(? AS JSON) — see createAutomation above.
      sets.push(`\`${col}\` = ?`);
      params.push(fields[key] == null ? null : JSON.stringify(fields[key]));
    }
  }
  if (!sets.length) return findAutomationByIdForUser(id, userId, connection);
  params.push(id, userId);
  await runner(connection).execute(
    `UPDATE content_automations SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params,
  );
  return findAutomationByIdForUser(id, userId, connection);
}

/** Active automations whose next refill is due. Used by the scheduler tick. */
export async function listDueForRefill({ now = new Date(), limit = 50 } = {}, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${A_COLS} FROM content_automations
      WHERE status = 'active' AND (next_refill_at IS NULL OR next_refill_at <= ?)
      ORDER BY next_refill_at IS NULL DESC, next_refill_at ASC
      LIMIT ?`,
    [toMysqlUtc(now), limit],
  );
  return rows.map(sanitizeAutomation);
}

// --- schedule slots ---------------------------------------------------------

const S_COLS = 'id, user_id, automation_id, planner_run_item_id, local_date, local_time, sequence, '
  + 'scheduled_for_utc, status, idempotency_key, last_error_category, last_error_message, created_at, updated_at';

/**
 * Idempotently create a slot. Returns { slot, created }. The UNIQUE key on
 * (automation_id, local_date, local_time, sequence) makes a duplicate a no-op.
 */
export async function createSlotIfAbsent(input, connection) {
  const conn = runner(connection);
  const [res] = await conn.execute(
    `INSERT INTO automation_schedule_slots
       (user_id, automation_id, local_date, local_time, sequence, scheduled_for_utc, status, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, 'planned', ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [input.userId, input.automationId, input.localDate, input.localTime, input.sequence ?? 0,
      toMysqlUtc(input.scheduledForUtc instanceof Date ? input.scheduledForUtc : new Date(String(input.scheduledForUtc).replace(' ', 'T') + 'Z')),
      input.idempotencyKey],
  );
  const created = res.affectedRows === 1;
  const [rows] = await conn.execute(`SELECT ${S_COLS} FROM automation_schedule_slots WHERE id = ? LIMIT 1`, [res.insertId]);
  return { slot: sanitizeSlot(rows[0]), created };
}

export async function findSlotByIdForUser(id, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${S_COLS} FROM automation_schedule_slots WHERE id = ? AND user_id = ? LIMIT 1`, [id, userId],
  );
  return sanitizeSlot(rows[0]);
}

export async function listSlotsForAutomation(automationId, userId, { statuses = null, fromLocalDate = null } = {}, connection) {
  const params = [automationId, userId];
  let where = 'automation_id = ? AND user_id = ?';
  if (Array.isArray(statuses) && statuses.length) {
    where += ` AND status IN (${statuses.map(() => '?').join(',')})`;
    params.push(...statuses);
  }
  if (fromLocalDate) { where += ' AND local_date >= ?'; params.push(fromLocalDate); }
  const [rows] = await runner(connection).execute(
    `SELECT ${S_COLS} FROM automation_schedule_slots WHERE ${where} ORDER BY scheduled_for_utc ASC, sequence ASC`, params,
  );
  return rows.map(sanitizeSlot);
}

/** Atomically claim a slot for generation (planned -> generating). */
export async function claimSlotForGeneration(slotId, userId, connection) {
  const [res] = await runner(connection).execute(
    `UPDATE automation_schedule_slots SET status = 'generating'
      WHERE id = ? AND user_id = ? AND status = 'planned'`, [slotId, userId],
  );
  return res.affectedRows > 0;
}

export async function markSlotReady(slotId, userId, plannerRunItemId, connection) {
  await runner(connection).execute(
    `UPDATE automation_schedule_slots SET status = 'ready', planner_run_item_id = ?, last_error_category = NULL, last_error_message = NULL
      WHERE id = ? AND user_id = ?`, [plannerRunItemId, slotId, userId],
  );
}

export async function markSlotStatus(slotId, userId, status, { category = null, message = null } = {}, connection) {
  await runner(connection).execute(
    `UPDATE automation_schedule_slots SET status = ?, last_error_category = ?, last_error_message = ?
      WHERE id = ? AND user_id = ?`, [status, category, message, slotId, userId],
  );
}

/** Reset a generating slot back to planned (e.g. a transient generation miss). */
export async function resetSlotToPlanned(slotId, userId, { message = null } = {}, connection) {
  await runner(connection).execute(
    `UPDATE automation_schedule_slots SET status = 'planned', last_error_category = 'transient', last_error_message = ?
      WHERE id = ? AND user_id = ? AND status = 'generating'`, [message, slotId, userId],
  );
}

export async function cancelFutureSlots(automationId, userId, fromLocalDate, connection) {
  const [res] = await runner(connection).execute(
    `UPDATE automation_schedule_slots SET status = 'cancelled'
      WHERE automation_id = ? AND user_id = ? AND local_date >= ? AND status IN ('planned','generating')`,
    [automationId, userId, fromLocalDate],
  );
  return res.affectedRows;
}

/**
 * Buffer accounting: distinct future local dates that already have a READY slot,
 * plus the furthest prepared date. "Ready days" is what the min/low thresholds
 * compare against.
 */
export async function bufferStats(automationId, userId, { fromLocalDate }, connection) {
  const conn = runner(connection);
  const [ready] = await conn.execute(
    `SELECT COUNT(DISTINCT local_date) AS ready_days, MAX(local_date) AS through
       FROM automation_schedule_slots
      WHERE automation_id = ? AND user_id = ? AND status = 'ready' AND local_date >= ?`,
    [automationId, userId, fromLocalDate],
  );
  const [counts] = await conn.execute(
    `SELECT status, COUNT(*) AS n FROM automation_schedule_slots
      WHERE automation_id = ? AND user_id = ? GROUP BY status`,
    [automationId, userId],
  );
  const byStatus = {};
  for (const r of counts) byStatus[r.status] = Number(r.n);
  return {
    readyDays: Number(ready[0]?.ready_days ?? 0),
    through: ready[0]?.through ?? null,
    byStatus,
  };
}

export default {
  sanitizeAutomation,
  sanitizeSlot,
  createAutomation,
  findAutomationByIdForUser,
  listAutomationsForUser,
  updateAutomation,
  listDueForRefill,
  createSlotIfAbsent,
  findSlotByIdForUser,
  listSlotsForAutomation,
  claimSlotForGeneration,
  markSlotReady,
  markSlotStatus,
  resetSlotToPlanned,
  cancelFutureSlots,
  bufferStats,
};
