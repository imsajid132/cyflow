/**
 * Planner preference repository — prepared-statement access to
 * `planner_preferences`.
 *
 * Exactly one row per user (UNIQUE user_id). Ownership always comes from the
 * authenticated session — a user id is never taken from a request body. JSON
 * columns are parsed safely; BIGINT ids are surfaced as strings.
 *
 * A user with no row is not an error: `findByUserId` returns null and the
 * service layer supplies documented defaults, so the planner works before a
 * user has ever opened its settings.
 */

import { getPool } from '../db/pool.js';

function runner(connection) {
  return connection ?? getPool();
}

function safeParseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const COLUMNS =
  'id, user_id, cadence, weekdays_json, times_json, platforms_json, goals_json, ' +
  'content_mix_json, content_rhythm_preset, content_rhythm_json, tone, cta_mode, ' +
  'approval_mode, default_plan_length, posts_per_day, timezone, autopilot_enabled, ' +
  'next_plan_generation_at, created_at, updated_at';

/** Map a raw row to the sanitized API shape. */
export function sanitizePreferences(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    cadence: row.cadence,
    weekdays: safeParseJson(row.weekdays_json, []),
    times: safeParseJson(row.times_json, []),
    platforms: safeParseJson(row.platforms_json, []),
    goals: safeParseJson(row.goals_json, []),
    contentMix: safeParseJson(row.content_mix_json, {}),
    contentRhythmPreset: row.content_rhythm_preset ?? 'balanced',
    contentRhythm: safeParseJson(row.content_rhythm_json, null),
    tone: row.tone,
    ctaMode: row.cta_mode,
    approvalMode: row.approval_mode,
    defaultPlanLength: Number(row.default_plan_length),
    postsPerDay: Number(row.posts_per_day ?? 1),
    timezone: row.timezone ?? null,
    autopilotEnabled: Boolean(row.autopilot_enabled),
    nextPlanGenerationAt: row.next_plan_generation_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/** Whitelisted column map — prevents mass assignment. */
const FIELD_COLUMNS = {
  cadence: 'cadence',
  contentRhythmPreset: 'content_rhythm_preset',
  tone: 'tone',
  ctaMode: 'cta_mode',
  approvalMode: 'approval_mode',
  defaultPlanLength: 'default_plan_length',
  postsPerDay: 'posts_per_day',
  timezone: 'timezone',
  autopilotEnabled: 'autopilot_enabled',
  nextPlanGenerationAt: 'next_plan_generation_at',
};

const JSON_FIELD_COLUMNS = {
  weekdays: 'weekdays_json',
  times: 'times_json',
  platforms: 'platforms_json',
  goals: 'goals_json',
  contentMix: 'content_mix_json',
  contentRhythm: 'content_rhythm_json',
};

export async function findByUserId(userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${COLUMNS} FROM planner_preferences WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return sanitizePreferences(rows[0] ?? null);
}

/**
 * Insert or update a user's preferences. Only whitelisted fields are written;
 * anything else in `data` is ignored.
 */
export async function upsertPreferences(userId, data, connection) {
  const columns = ['user_id'];
  const placeholders = ['?'];
  const values = [userId];
  const updates = [];

  for (const [field, column] of Object.entries(FIELD_COLUMNS)) {
    if (data[field] === undefined) continue;
    columns.push(`\`${column}\``);
    placeholders.push('?');
    values.push(field === 'autopilotEnabled' ? (data[field] ? 1 : 0) : data[field]);
    updates.push(`\`${column}\` = VALUES(\`${column}\`)`);
  }
  for (const [field, column] of Object.entries(JSON_FIELD_COLUMNS)) {
    if (data[field] === undefined) continue;
    columns.push(`\`${column}\``);
    placeholders.push('?');
    values.push(JSON.stringify(data[field] ?? null));
    updates.push(`\`${column}\` = VALUES(\`${column}\`)`);
  }

  if (updates.length === 0) {
    // Nothing to change: make sure a row exists, then return it.
    await runner(connection).execute(
      'INSERT IGNORE INTO planner_preferences (user_id) VALUES (?)',
      [userId],
    );
    return findByUserId(userId, connection);
  }

  await runner(connection).execute(
    `INSERT INTO planner_preferences (${columns.join(', ')}) VALUES (${placeholders.join(', ')})
     ON DUPLICATE KEY UPDATE ${updates.join(', ')}`,
    values,
  );
  return findByUserId(userId, connection);
}

/**
 * Autopilot candidates: enabled rows whose next run is due.
 * Nothing calls this yet — it exists so the scheduler can be wired up without
 * another migration. No publishing is implied.
 */
export async function listDueAutopilot(nowUtc, { limit = 50 } = {}, connection) {
  const [rows] = await runner(connection).query(
    `SELECT ${COLUMNS} FROM planner_preferences
      WHERE autopilot_enabled = 1
        AND next_plan_generation_at IS NOT NULL
        AND next_plan_generation_at <= ?
      ORDER BY next_plan_generation_at ASC
      LIMIT ?`,
    [nowUtc, Number(limit)],
  );
  return rows.map(sanitizePreferences);
}

export async function deletePreferences(userId, connection) {
  const [result] = await runner(connection).execute(
    'DELETE FROM planner_preferences WHERE user_id = ?',
    [userId],
  );
  return { deleted: result.affectedRows > 0 };
}

export default {
  findByUserId,
  upsertPreferences,
  listDueAutopilot,
  deletePreferences,
  sanitizePreferences,
};
