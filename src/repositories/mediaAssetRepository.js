/**
 * Media asset repository — prepared-statement access to `media_assets`.
 *
 * Assets are served publicly only via their opaque `public_token` (never the
 * database id). No base64 image data is stored — only a `source_url` that can
 * be safely proxied from the trusted image host. Ownership is enforced on all
 * user-scoped reads.
 */

import { getPool } from '../db/pool.js';
import { MEDIA_ASSET_STATUS } from '../config/constants.js';

function runner(connection) {
  return connection ?? getPool();
}

function sanitize(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    scheduledPostId: row.scheduled_post_id == null ? null : String(row.scheduled_post_id),
    publicToken: row.public_token,
    sourceProvider: row.source_provider,
    sourceUrl: row.source_url ?? null,
    sourceAssetId: row.source_asset_id ?? null,
    mimeType: row.mime_type ?? null,
    fileExtension: row.file_extension ?? null,
    status: row.status,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

const COLUMNS =
  'id, user_id, scheduled_post_id, public_token, source_provider, source_url, ' +
  'source_asset_id, mime_type, file_extension, status, expires_at, created_at, updated_at';

/**
 * Create a media asset row.
 * @param {{ userId, publicToken, sourceProvider?, sourceUrl?, sourceAssetId?,
 *           mimeType?, fileExtension?, status?, expiresAt?, scheduledPostId? }} input
 */
export async function createMediaAsset(input, connection) {
  const {
    userId,
    publicToken,
    sourceProvider = 'hcti',
    sourceUrl = null,
    sourceAssetId = null,
    mimeType = null,
    fileExtension = null,
    status = MEDIA_ASSET_STATUS.PENDING,
    expiresAt = null,
    scheduledPostId = null,
  } = input;
  const [result] = await runner(connection).execute(
    `INSERT INTO media_assets
       (user_id, scheduled_post_id, public_token, source_provider, source_url,
        source_asset_id, mime_type, file_extension, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, scheduledPostId, publicToken, sourceProvider, sourceUrl, sourceAssetId, mimeType, fileExtension, status, expiresAt],
  );
  return findMediaAssetByIdForUser(result.insertId, userId, connection);
}

export async function findMediaAssetByIdForUser(assetId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${COLUMNS} FROM media_assets WHERE id = ? AND user_id = ? LIMIT 1`,
    [assetId, userId],
  );
  return sanitize(rows[0] ?? null);
}

/** Public lookup: only READY, unexpired assets by opaque token. */
export async function findReadyMediaAssetByPublicToken(publicToken, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${COLUMNS} FROM media_assets
      WHERE public_token = ?
        AND status = 'ready'
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
      LIMIT 1`,
    [publicToken],
  );
  return sanitize(rows[0] ?? null);
}

export async function markMediaAssetReady(assetId, userId, { mimeType, fileExtension, sourceUrl }, connection) {
  await runner(connection).execute(
    `UPDATE media_assets
        SET status = 'ready',
            mime_type = COALESCE(?, mime_type),
            file_extension = COALESCE(?, file_extension),
            source_url = COALESCE(?, source_url)
      WHERE id = ? AND user_id = ?`,
    [mimeType ?? null, fileExtension ?? null, sourceUrl ?? null, assetId, userId],
  );
  return findMediaAssetByIdForUser(assetId, userId, connection);
}

export async function markMediaAssetFailed(assetId, userId, connection) {
  await runner(connection).execute(
    "UPDATE media_assets SET status = 'failed' WHERE id = ? AND user_id = ?",
    [assetId, userId],
  );
}

export async function associateAssetWithPost(assetId, userId, postId, connection) {
  await runner(connection).execute(
    'UPDATE media_assets SET scheduled_post_id = ? WHERE id = ? AND user_id = ?',
    [postId, assetId, userId],
  );
}

/** Delete an asset only when it is not tied to a post (unused). */
export async function deleteUnusedMediaAsset(assetId, userId, connection) {
  const [result] = await runner(connection).execute(
    'DELETE FROM media_assets WHERE id = ? AND user_id = ? AND scheduled_post_id IS NULL',
    [assetId, userId],
  );
  return (result.affectedRows ?? 0) > 0;
}

export default {
  createMediaAsset,
  findMediaAssetByIdForUser,
  findReadyMediaAssetByPublicToken,
  markMediaAssetReady,
  markMediaAssetFailed,
  associateAssetWithPost,
  deleteUnusedMediaAsset,
};
