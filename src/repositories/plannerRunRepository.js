/**
 * Planner run repository — prepared-statement access to `planner_runs` and
 * `planner_run_items`.
 *
 * Every read and write is scoped by user_id in the WHERE clause, so one user can
 * never see or mutate another's plan even if an id is guessed. Ownership always
 * comes from the authenticated session.
 *
 * JSON columns are parsed safely; BIGINT ids are surfaced as strings.
 */

import { getPool } from '../db/pool.js';
import { PLANNER_RUN_STATUS, PLANNER_ITEM_STATUS } from '../config/constants.js';

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

const RUN_COLUMNS =
  'id, user_id, business_profile_id, content_automation_id, name, status, start_date, end_date, timezone, ' +
  'plan_length, posts_per_day, settings_json, resolved_rhythm_json, quality_status, ' +
  'quality_failures_json, generation_notes, archived_at, created_at, updated_at';

const ITEM_COLUMNS =
  'id, planner_run_id, user_id, post_id, position, scheduled_for, original_timezone, ' +
  'content_type, content_pillar, content_format, audience_problem, topic_angle, cta_strategy, ' +
  'visual_family, quality_status, quality_failures_json, goal, platform_targets_json, ' +
  'template_key, aspect_ratio, background_style, ' +
  'generated_headline, generated_subheadline, generated_summary, generated_caption, ' +
  'generated_hashtags_json, platform_captions_json, generated_alt_text, brief, media_asset_id, ' +
  'approval_status, duplication_score, duplication_notes, regeneration_count, ' +
  'content_fingerprint_json, edited_fields_json, created_at, updated_at';

export function sanitizeRun(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    businessProfileId: row.business_profile_id == null ? null : String(row.business_profile_id),
    contentAutomationId: row.content_automation_id == null ? null : String(row.content_automation_id),
    name: row.name ?? null,
    status: row.status,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    timezone: row.timezone ?? null,
    planLength: Number(row.plan_length),
    postsPerDay: Number(row.posts_per_day ?? 1),
    settings: safeParseJson(row.settings_json, {}),
    resolvedRhythm: safeParseJson(row.resolved_rhythm_json, null),
    qualityStatus: row.quality_status ?? null,
    qualityFailures: safeParseJson(row.quality_failures_json, null),
    generationNotes: row.generation_notes ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function sanitizeItem(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    plannerRunId: String(row.planner_run_id),
    userId: String(row.user_id),
    postId: row.post_id == null ? null : String(row.post_id),
    position: Number(row.position),
    scheduledFor: row.scheduled_for ?? null,
    originalTimezone: row.original_timezone ?? null,
    contentType: row.content_type,
    contentPillar: row.content_pillar ?? null,
    contentFormat: row.content_format ?? null,
    audienceProblem: row.audience_problem ?? null,
    topicAngle: row.topic_angle ?? null,
    ctaStrategy: row.cta_strategy ?? null,
    visualFamily: row.visual_family ?? null,
    qualityStatus: row.quality_status ?? null,
    qualityFailures: safeParseJson(row.quality_failures_json, null),
    goal: row.goal ?? null,
    platformTargets: safeParseJson(row.platform_targets_json, []),
    templateKey: row.template_key ?? null,
    aspectRatio: row.aspect_ratio ?? null,
    backgroundStyle: row.background_style ?? null,
    headline: row.generated_headline ?? null,
    subheadline: row.generated_subheadline ?? null,
    summary: row.generated_summary ?? null,
    caption: row.generated_caption ?? null,
    hashtags: safeParseJson(row.generated_hashtags_json, []),
    /*
     * Per-platform copy. NULL on items written before this column existed, and
     * on any item whose plan targets a single platform — both fall back to
     * `caption`, so a reader never has to know which era an item came from.
     */
    platformCaptions: safeParseJson(row.platform_captions_json, null),
    altText: row.generated_alt_text ?? null,
    brief: row.brief ?? null,
    mediaAssetId: row.media_asset_id == null ? null : String(row.media_asset_id),
    approvalStatus: row.approval_status,
    duplicationScore: Number(row.duplication_score),
    duplicationNotes: row.duplication_notes ?? null,
    regenerationCount: Number(row.regeneration_count),
    fingerprint: safeParseJson(row.content_fingerprint_json, null),
    editedFields: safeParseJson(row.edited_fields_json, []),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

// --- runs -------------------------------------------------------------------

export async function createRun(input, connection) {
  const [result] = await runner(connection).execute(
    `INSERT INTO planner_runs
       (user_id, business_profile_id, content_automation_id, name, status, start_date, end_date, timezone,
        plan_length, posts_per_day, settings_json, resolved_rhythm_json, quality_status,
        quality_failures_json, generation_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.businessProfileId ?? null,
      input.contentAutomationId ?? null,
      input.name ?? null,
      input.status ?? PLANNER_RUN_STATUS.GENERATING,
      input.startDate ?? null,
      input.endDate ?? null,
      input.timezone ?? null,
      input.planLength ?? 7,
      input.postsPerDay ?? 1,
      JSON.stringify(input.settings ?? {}),
      input.resolvedRhythm == null ? null : JSON.stringify(input.resolvedRhythm),
      input.qualityStatus ?? null,
      input.qualityFailures == null ? null : JSON.stringify(input.qualityFailures),
      input.generationNotes ?? null,
    ],
  );
  return findRunByIdForUser(String(result.insertId), input.userId, connection);
}

export async function findRunByIdForUser(runId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${RUN_COLUMNS} FROM planner_runs WHERE id = ? AND user_id = ? LIMIT 1`,
    [runId, userId],
  );
  return sanitizeRun(rows[0] ?? null);
}

export async function listRunsForUser(userId, { limit = 20, offset = 0 } = {}, connection) {
  const [rows] = await runner(connection).query(
    `SELECT ${RUN_COLUMNS} FROM planner_runs
      WHERE user_id = ? AND content_automation_id IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [userId, Number(limit), Number(offset)],
  );
  return rows.map(sanitizeRun);
}

export async function updateRun(runId, userId, fields, connection) {
  const map = {
    name: 'name',
    status: 'status',
    generationNotes: 'generation_notes',
    startDate: 'start_date',
    endDate: 'end_date',
    archivedAt: 'archived_at',
    qualityStatus: 'quality_status',
  };
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(map)) {
    if (fields[field] === undefined) continue;
    sets.push(`\`${column}\` = ?`);
    values.push(fields[field]);
  }
  if (fields.settings !== undefined) {
    sets.push('`settings_json` = ?');
    values.push(JSON.stringify(fields.settings));
  }
  if (fields.qualityFailures !== undefined) {
    sets.push('`quality_failures_json` = ?');
    values.push(fields.qualityFailures == null ? null : JSON.stringify(fields.qualityFailures));
  }
  if (sets.length === 0) return findRunByIdForUser(runId, userId, connection);
  values.push(runId, userId);
  await runner(connection).execute(
    `UPDATE planner_runs SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    values,
  );
  return findRunByIdForUser(runId, userId, connection);
}

export async function deleteRun(runId, userId, connection) {
  // Items cascade; any queued posts they produced survive (post FK is SET NULL).
  const [result] = await runner(connection).execute(
    'DELETE FROM planner_runs WHERE id = ? AND user_id = ?',
    [runId, userId],
  );
  return { deleted: result.affectedRows > 0 };
}

// --- items ------------------------------------------------------------------

export async function createItem(input, connection) {
  const [result] = await runner(connection).execute(
    `INSERT INTO planner_run_items
       (planner_run_id, user_id, position, scheduled_for, original_timezone, content_type,
        content_pillar, content_format, audience_problem, topic_angle, cta_strategy,
        visual_family, quality_status, quality_failures_json,
        goal, platform_targets_json, template_key, aspect_ratio, background_style,
        generated_headline, generated_subheadline, generated_summary, generated_caption,
        generated_hashtags_json, platform_captions_json, generated_alt_text, brief,
        media_asset_id, approval_status, duplication_score, duplication_notes,
        regeneration_count, content_fingerprint_json, edited_fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.plannerRunId,
      input.userId,
      input.position ?? 0,
      input.scheduledFor ?? null,
      input.originalTimezone ?? null,
      input.contentType ?? 'educational',
      input.contentPillar ?? null,
      input.contentFormat ?? null,
      input.audienceProblem ?? null,
      input.topicAngle ?? null,
      input.ctaStrategy ?? null,
      input.visualFamily ?? null,
      input.qualityStatus ?? null,
      input.qualityFailures == null ? null : JSON.stringify(input.qualityFailures),
      input.goal ?? null,
      JSON.stringify(input.platformTargets ?? []),
      input.templateKey ?? null,
      input.aspectRatio ?? null,
      input.backgroundStyle ?? null,
      input.headline ?? null,
      input.subheadline ?? null,
      input.summary ?? null,
      input.caption ?? null,
      JSON.stringify(input.hashtags ?? []),
      input.platformCaptions == null ? null : JSON.stringify(input.platformCaptions),
      input.altText ?? null,
      input.brief ?? null,
      input.mediaAssetId ?? null,
      input.approvalStatus ?? PLANNER_ITEM_STATUS.NEEDS_REVIEW,
      input.duplicationScore ?? 0,
      input.duplicationNotes ?? null,
      input.regenerationCount ?? 0,
      input.fingerprint == null ? null : JSON.stringify(input.fingerprint),
      JSON.stringify(input.editedFields ?? []),
    ],
  );
  return findItemByIdForUser(String(result.insertId), input.userId, connection);
}

export async function findItemByIdForUser(itemId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${ITEM_COLUMNS} FROM planner_run_items WHERE id = ? AND user_id = ? LIMIT 1`,
    [itemId, userId],
  );
  return sanitizeItem(rows[0] ?? null);
}

export async function listItemsForRun(runId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${ITEM_COLUMNS} FROM planner_run_items
      WHERE planner_run_id = ? AND user_id = ?
      ORDER BY position ASC, id ASC`,
    [runId, userId],
  );
  return rows.map(sanitizeItem);
}

/** Whitelisted item update map — prevents mass assignment. */
const ITEM_FIELD_COLUMNS = {
  scheduledFor: 'scheduled_for',
  originalTimezone: 'original_timezone',
  contentType: 'content_type',
  goal: 'goal',
  templateKey: 'template_key',
  aspectRatio: 'aspect_ratio',
  backgroundStyle: 'background_style',
  headline: 'generated_headline',
  subheadline: 'generated_subheadline',
  summary: 'generated_summary',
  caption: 'generated_caption',
  altText: 'generated_alt_text',
  brief: 'brief',
  mediaAssetId: 'media_asset_id',
  approvalStatus: 'approval_status',
  duplicationScore: 'duplication_score',
  duplicationNotes: 'duplication_notes',
  regenerationCount: 'regeneration_count',
  postId: 'post_id',
  position: 'position',
  qualityStatus: 'quality_status',
  visualFamily: 'visual_family',
};

const ITEM_JSON_COLUMNS = {
  platformTargets: 'platform_targets_json',
  hashtags: 'generated_hashtags_json',
  platformCaptions: 'platform_captions_json',
  fingerprint: 'content_fingerprint_json',
  editedFields: 'edited_fields_json',
  qualityFailures: 'quality_failures_json',
};

export async function updateItem(itemId, userId, fields, connection) {
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(ITEM_FIELD_COLUMNS)) {
    if (fields[field] === undefined) continue;
    sets.push(`\`${column}\` = ?`);
    values.push(fields[field]);
  }
  for (const [field, column] of Object.entries(ITEM_JSON_COLUMNS)) {
    if (fields[field] === undefined) continue;
    sets.push(`\`${column}\` = ?`);
    values.push(fields[field] == null ? null : JSON.stringify(fields[field]));
  }
  if (sets.length === 0) return findItemByIdForUser(itemId, userId, connection);
  values.push(itemId, userId);
  await runner(connection).execute(
    `UPDATE planner_run_items SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    values,
  );
  return findItemByIdForUser(itemId, userId, connection);
}

export async function deleteItem(itemId, userId, connection) {
  const [result] = await runner(connection).execute(
    'DELETE FROM planner_run_items WHERE id = ? AND user_id = ?',
    [itemId, userId],
  );
  return { deleted: result.affectedRows > 0 };
}

/**
 * Recent items for the duplication lookback.
 *
 * Only the small derived signals are selected — the caption text is never
 * loaded for comparison, because the fingerprint is all the engine needs.
 */
export async function listRecentFingerprintsForUser(
  userId,
  { limit = 60, sinceUtc = null, excludeRunId = null, excludeItemId = null } = {},
  connection,
) {
  const params = [userId];
  let sql =
    `SELECT id, planner_run_id, content_type, content_pillar, goal, template_key,
            content_fingerprint_json, created_at
       FROM planner_run_items
      WHERE user_id = ?
        AND content_fingerprint_json IS NOT NULL`;
  if (sinceUtc) {
    sql += ' AND created_at >= ?';
    params.push(sinceUtc);
  }
  if (excludeRunId) {
    sql += ' AND planner_run_id <> ?';
    params.push(excludeRunId);
  }
  /*
   * Exclude ONE item, by id.
   *
   * A regeneration must not be compared against the row it is about to replace.
   * Its own stored fingerprint shares the item's pillar, service, format,
   * template and hashtags — because it IS the item — so the soft axes match
   * perfectly and the new copy is condemned as a duplicate of itself, however
   * different the words are.
   *
   * Only this row is excluded. Siblings in the same run, other runs, and the
   * user's history all still count, so duplicate protection is narrowed by one
   * row rather than disabled.
   */
  if (excludeItemId) {
    sql += ' AND id <> ?';
    params.push(excludeItemId);
  }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(Number(limit));

  const [rows] = await runner(connection).query(sql, params);
  return rows.map((row) => ({
    id: String(row.id),
    plannerRunId: String(row.planner_run_id),
    ...safeParseJson(row.content_fingerprint_json, {}),
  }));
}

/** Status counts for a run, used by the board summary and run status roll-up. */
export async function countItemsByStatus(runId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT approval_status, COUNT(*) AS total
       FROM planner_run_items
      WHERE planner_run_id = ? AND user_id = ?
      GROUP BY approval_status`,
    [runId, userId],
  );
  const counts = {};
  for (const status of Object.values(PLANNER_ITEM_STATUS)) counts[status] = 0;
  for (const row of rows) counts[row.approval_status] = Number(row.total);
  return counts;
}

export default {
  createRun,
  findRunByIdForUser,
  listRunsForUser,
  updateRun,
  deleteRun,
  createItem,
  findItemByIdForUser,
  listItemsForRun,
  updateItem,
  deleteItem,
  listRecentFingerprintsForUser,
  countItemsByStatus,
  sanitizeRun,
  sanitizeItem,
};
