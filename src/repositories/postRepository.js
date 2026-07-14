/**
 * Post repository — prepared-statement access to `scheduled_posts` and
 * `scheduled_post_targets`.
 *
 * Every read/update/delete is scoped by `user_id` (ownership). Encrypted social
 * tokens are never touched here (targets reference accounts by id only). JSON
 * columns are parsed safely; BIGINT ids are surfaced as strings. Published
 * history is never destructively removed.
 */

import { getPool } from '../db/pool.js';
import { POST_STATUS, TARGET_STATUS } from '../config/constants.js';

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

/** Map a raw post row to the sanitized API shape (no internal HTML/CSS). */
export function sanitizePost(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: row.title ?? null,
    brief: row.prompt ?? null,
    status: row.status,
    scheduledAtUtc: row.scheduled_at_utc ?? null,
    originalTimezone: row.original_timezone ?? null,
    generationParams: safeParseJson(row.generation_params_json, {}),
    platformCaptions: safeParseJson(row.generated_platform_captions_json, {}),
    baseCaption: row.generated_base_caption ?? null,
    imageHeadline: row.generated_image_headline ?? null,
    imageSubheadline: row.generated_image_subheadline ?? null,
    imageAltText: row.generated_image_alt_text ?? null,
    template: row.template_name ?? null,
    aspectRatio: row.aspect_ratio ?? null,
    backgroundStyle: row.background_style ?? null,
    mediaAssetId: row.media_asset_id == null ? null : String(row.media_asset_id),
    openaiModel: row.openai_model ?? null,
    contentGeneratedAt: row.content_generated_at ?? null,
    imageGeneratedAt: row.image_generated_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

const POST_COLUMNS =
  'id, user_id, title, prompt, status, scheduled_at_utc, original_timezone, ' +
  'generation_params_json, generated_platform_captions_json, generated_base_caption, ' +
  'generated_image_headline, generated_image_subheadline, generated_image_alt_text, ' +
  'template_name, aspect_ratio, background_style, media_asset_id, openai_model, ' +
  'content_generated_at, image_generated_at, created_at, updated_at';

export async function createDraftPost(input, connection) {
  const {
    userId,
    title = null,
    prompt = null,
    generationParams = null,
    templateName = null,
    aspectRatio = null,
    backgroundStyle = null,
  } = input;
  const [result] = await runner(connection).execute(
    `INSERT INTO scheduled_posts
       (user_id, title, prompt, generation_params_json, template_name, aspect_ratio, background_style, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      userId,
      title,
      prompt,
      generationParams == null ? null : JSON.stringify(generationParams),
      templateName,
      aspectRatio,
      backgroundStyle,
    ],
  );
  return findPostByIdForUser(result.insertId, userId, connection);
}

export async function findPostByIdForUser(postId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${POST_COLUMNS} FROM scheduled_posts WHERE id = ? AND user_id = ? LIMIT 1`,
    [postId, userId],
  );
  return sanitizePost(rows[0] ?? null);
}

export async function listPostsForUser(userId, { limit = 25, offset = 0, status = null } = {}, connection) {
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  let sql = `SELECT ${POST_COLUMNS} FROM scheduled_posts WHERE user_id = ?`;
  const params = [userId];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`;
  const [rows] = await runner(connection).execute(sql, params);
  return rows.map(sanitizePost);
}

const UPDATABLE_COLUMNS = {
  title: 'title',
  prompt: 'prompt',
  templateName: 'template_name',
  aspectRatio: 'aspect_ratio',
  backgroundStyle: 'background_style',
};

export async function updateDraftPost(postId, userId, fields, connection) {
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    if (fields[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(fields[key]);
    }
  }
  if (fields.generationParams !== undefined) {
    sets.push('generation_params_json = ?');
    params.push(fields.generationParams == null ? null : JSON.stringify(fields.generationParams));
  }
  if (sets.length === 0) return findPostByIdForUser(postId, userId, connection);
  params.push(postId, userId);
  await runner(connection).execute(
    `UPDATE scheduled_posts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    params,
  );
  return findPostByIdForUser(postId, userId, connection);
}

export async function updateGeneratedContent(postId, userId, content, connection) {
  const {
    platformCaptions = null,
    baseCaption = null,
    headline = null,
    subheadline = null,
    altText = null,
    openaiModel = null,
    openaiResponseId = null,
    openaiUsage = null,
    contentGeneratedAt = null,
  } = content;
  await runner(connection).execute(
    `UPDATE scheduled_posts
        SET generated_platform_captions_json = ?,
            generated_base_caption = ?,
            generated_image_headline = ?,
            generated_image_subheadline = ?,
            generated_image_alt_text = ?,
            openai_model = ?,
            openai_response_id = ?,
            openai_usage_json = ?,
            content_generated_at = ?
      WHERE id = ? AND user_id = ?`,
    [
      platformCaptions == null ? null : JSON.stringify(platformCaptions),
      baseCaption,
      headline,
      subheadline,
      altText,
      openaiModel,
      openaiResponseId,
      openaiUsage == null ? null : JSON.stringify(openaiUsage),
      contentGeneratedAt,
      postId,
      userId,
    ],
  );
  return findPostByIdForUser(postId, userId, connection);
}

export async function attachMediaAsset(postId, userId, info, connection) {
  const {
    mediaAssetId,
    template = null,
    aspectRatio = null,
    backgroundStyle = null,
    imageGeneratedAt = null,
  } = info;
  await runner(connection).execute(
    `UPDATE scheduled_posts
        SET media_asset_id = ?,
            template_name = COALESCE(?, template_name),
            aspect_ratio = COALESCE(?, aspect_ratio),
            background_style = COALESCE(?, background_style),
            image_generated_at = ?
      WHERE id = ? AND user_id = ?`,
    [mediaAssetId, template, aspectRatio, backgroundStyle, imageGeneratedAt, postId, userId],
  );
  return findPostByIdForUser(postId, userId, connection);
}

/** Assert the post belongs to the user; throws-safe boolean. */
async function ownsPost(postId, userId, conn) {
  const [rows] = await conn.execute(
    'SELECT id FROM scheduled_posts WHERE id = ? AND user_id = ? LIMIT 1',
    [postId, userId],
  );
  return rows.length > 0;
}

/**
 * Replace the (non-published) targets of a post. Caller must have validated
 * that each socialAccountId is an active account owned by the user.
 * @param {Array<{ socialAccountId, captionOverride? }>} targets
 */
export async function replacePostTargets(postId, userId, targets, connection) {
  const conn = runner(connection);
  if (!(await ownsPost(postId, userId, conn))) return [];

  // Never remove published targets (audit history).
  await conn.execute(
    "DELETE FROM scheduled_post_targets WHERE scheduled_post_id = ? AND status <> 'published'",
    [postId],
  );
  for (const t of targets) {
    // eslint-disable-next-line no-await-in-loop
    await conn.execute(
      `INSERT INTO scheduled_post_targets
         (scheduled_post_id, social_account_id, caption_override, status)
       VALUES (?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE caption_override = VALUES(caption_override), status = 'pending'`,
      [postId, t.socialAccountId, t.captionOverride ?? null],
    );
  }
  return listPostTargets(postId, userId, connection);
}

/** List a post's targets joined with (token-free) account info. */
export async function listPostTargets(postId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT t.id, t.social_account_id, t.caption_override, t.status, t.attempt_count,
            sa.provider, sa.account_type, sa.display_name, sa.username, sa.status AS account_status
       FROM scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id
       JOIN social_accounts sa ON sa.id = t.social_account_id
      WHERE t.scheduled_post_id = ? AND p.user_id = ?
      ORDER BY t.id ASC`,
    [postId, userId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    socialAccountId: String(r.social_account_id),
    provider: r.provider,
    accountType: r.account_type,
    displayName: r.display_name ?? null,
    username: r.username ?? null,
    accountStatus: r.account_status,
    captionOverride: r.caption_override ?? null,
    status: r.status,
    attemptCount: Number(r.attempt_count ?? 0),
  }));
}

export async function schedulePost(postId, userId, { scheduledAtUtc, originalTimezone }, connection) {
  const conn = runner(connection);
  await conn.execute(
    `UPDATE scheduled_posts
        SET status = ?, scheduled_at_utc = ?, original_timezone = ?
      WHERE id = ? AND user_id = ?`,
    [POST_STATUS.QUEUED, scheduledAtUtc, originalTimezone, postId, userId],
  );
  // Ensure every non-published target is pending.
  await conn.execute(
    `UPDATE scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id
        SET t.status = ?
      WHERE t.scheduled_post_id = ? AND p.user_id = ? AND t.status <> 'published'`,
    [TARGET_STATUS.PENDING, postId, userId],
  );
  return findPostByIdForUser(postId, userId, connection);
}

export async function cancelScheduledPost(postId, userId, connection) {
  const conn = runner(connection);
  await conn.execute(
    `UPDATE scheduled_posts
        SET status = ?, cancelled_at = UTC_TIMESTAMP()
      WHERE id = ? AND user_id = ?`,
    [POST_STATUS.CANCELLED, postId, userId],
  );
  await conn.execute(
    `UPDATE scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id
        SET t.status = ?
      WHERE t.scheduled_post_id = ? AND p.user_id = ? AND t.status <> 'published'`,
    [TARGET_STATUS.CANCELLED, postId, userId],
  );
  return findPostByIdForUser(postId, userId, connection);
}

/** True if any target of the post has been published (blocks destructive delete). */
export async function hasPublishedTargets(postId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT 1 FROM scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id
      WHERE t.scheduled_post_id = ? AND p.user_id = ? AND t.status = 'published'
      LIMIT 1`,
    [postId, userId],
  );
  return rows.length > 0;
}

/** Delete a draft/queued post only when no published history exists. */
export async function deleteDraftPost(postId, userId, connection) {
  const conn = runner(connection);
  if (await hasPublishedTargets(postId, userId, conn)) return { deleted: false, reason: 'has_history' };
  const [result] = await conn.execute(
    'DELETE FROM scheduled_posts WHERE id = ? AND user_id = ?',
    [postId, userId],
  );
  return { deleted: (result.affectedRows ?? 0) > 0 };
}

export default {
  sanitizePost,
  createDraftPost,
  findPostByIdForUser,
  listPostsForUser,
  updateDraftPost,
  updateGeneratedContent,
  attachMediaAsset,
  replacePostTargets,
  listPostTargets,
  schedulePost,
  cancelScheduledPost,
  hasPublishedTargets,
  deleteDraftPost,
};
