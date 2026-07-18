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
    // Upload metadata (C3). NULL on an HCTI-proxied asset.
    storageDriver: row.storage_driver ?? null,
    // storage_key is deliberately NOT surfaced here — nothing outside the media
    // service and storage adapter ever needs it, and it must never reach an API
    // response. A dedicated internal reader below fetches it when serving bytes.
    originalFilename: row.original_filename ?? null,
    fileSizeBytes: row.file_size_bytes == null ? null : Number(row.file_size_bytes),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    altText: row.alt_text ?? null,
    checksumSha256: row.checksum_sha256 ?? null,
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
  'id, user_id, scheduled_post_id, public_token, source_provider, storage_driver, '
  + 'original_filename, file_size_bytes, width, height, alt_text, checksum_sha256, '
  + 'source_url, source_asset_id, mime_type, file_extension, status, expires_at, created_at, updated_at';

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
    // Upload metadata (C3). All optional so the existing HCTI callers are
    // unchanged — they simply pass none of these and store NULLs.
    storageDriver = null,
    storageKey = null,
    originalFilename = null,
    fileSizeBytes = null,
    width = null,
    height = null,
    altText = null,
    checksumSha256 = null,
  } = input;
  const [result] = await runner(connection).execute(
    `INSERT INTO media_assets
       (user_id, scheduled_post_id, public_token, source_provider, source_url,
        source_asset_id, mime_type, file_extension, status, expires_at,
        storage_driver, storage_key, original_filename, file_size_bytes,
        width, height, alt_text, checksum_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, scheduledPostId, publicToken, sourceProvider, sourceUrl,
      sourceAssetId, mimeType, fileExtension, status, expiresAt,
      storageDriver, storageKey, originalFilename, fileSizeBytes,
      width, height, altText, checksumSha256,
    ],
  );
  return findMediaAssetByIdForUser(result.insertId, userId, connection);
}

/**
 * List a user's media, newest first. Owner-scoped by construction.
 */
export async function listMediaAssetsForUser(userId, { limit = 200 } = {}, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${COLUMNS} FROM media_assets
      WHERE user_id = ? AND status IN ('ready', 'pending')
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [userId, limit],
  );
  return rows.map(sanitize);
}

/**
 * The storage key for a user's asset — INTERNAL ONLY.
 *
 * Never surfaced through sanitize() or any API. The media content route uses it
 * to read bytes AFTER verifying ownership (or token), and nowhere else.
 */
export async function findStorageKeyForAsset(assetId, userId, connection) {
  const [rows] = await runner(connection).execute(
    'SELECT storage_driver, storage_key, mime_type FROM media_assets WHERE id = ? AND user_id = ? LIMIT 1',
    [assetId, userId],
  );
  const row = rows[0];
  return row ? { storageDriver: row.storage_driver, storageKey: row.storage_key, mimeType: row.mime_type } : null;
}

/** The storage key behind a public token, for the token content route. */
export async function findStorageByPublicToken(publicToken, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT storage_driver, storage_key, mime_type, source_url FROM media_assets
      WHERE public_token = ? AND status = 'ready'
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
      LIMIT 1`,
    [publicToken],
  );
  const row = rows[0];
  return row
    ? { storageDriver: row.storage_driver, storageKey: row.storage_key, mimeType: row.mime_type, sourceUrl: row.source_url }
    : null;
}

/** A user-scoped content dedup lookup: their asset with these exact bytes. */
export async function findMediaAssetByChecksumForUser(checksum, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${COLUMNS} FROM media_assets
      WHERE user_id = ? AND checksum_sha256 = ? AND status = 'ready'
      ORDER BY created_at ASC LIMIT 1`,
    [userId, checksum],
  );
  return sanitize(rows[0] ?? null);
}

/** Update alt text, owner-scoped. Returns the updated asset or null. */
export async function updateMediaAltText(assetId, userId, altText, connection) {
  const [result] = await runner(connection).execute(
    'UPDATE media_assets SET alt_text = ? WHERE id = ? AND user_id = ?',
    [altText, assetId, userId],
  );
  if ((result.affectedRows ?? 0) === 0) return null;
  return findMediaAssetByIdForUser(assetId, userId, connection);
}

/** Hard-delete an asset row by owner. Callers must have checked references. */
export async function deleteMediaAssetRow(assetId, userId, connection) {
  const [result] = await runner(connection).execute(
    'DELETE FROM media_assets WHERE id = ? AND user_id = ?',
    [assetId, userId],
  );
  return (result.affectedRows ?? 0) > 0;
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

/** Supported reference types — the schema ENUM, mirrored so callers validate. */
export const MEDIA_REFERENCE_TYPES = Object.freeze(['planner_run_item', 'scheduled_post']);

/**
 * Attach an asset to an entity. Idempotent: the UNIQUE key makes a duplicate
 * attach a no-op rather than a second row. Returns { created }.
 */
export async function attachMediaReference({ userId, mediaAssetId, referenceType, referenceId }, connection) {
  const [result] = await runner(connection).execute(
    `INSERT INTO media_asset_references (user_id, media_asset_id, reference_type, reference_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [userId, mediaAssetId, referenceType, referenceId],
  );
  // affectedRows: 1 = inserted, 0 = already existed (no-op via id=id).
  return { created: (result.affectedRows ?? 0) === 1 };
}

/** Detach one asset from one entity, owner-scoped. */
export async function detachMediaReference({ userId, mediaAssetId, referenceType, referenceId }, connection) {
  const [result] = await runner(connection).execute(
    `DELETE FROM media_asset_references
      WHERE user_id = ? AND media_asset_id = ? AND reference_type = ? AND reference_id = ?`,
    [userId, mediaAssetId, referenceType, referenceId],
  );
  return (result.affectedRows ?? 0) > 0;
}

/** Remove every reference an entity holds (called when the entity is deleted). */
export async function detachAllReferencesForEntity({ userId, referenceType, referenceId }, connection) {
  await runner(connection).execute(
    'DELETE FROM media_asset_references WHERE user_id = ? AND reference_type = ? AND reference_id = ?',
    [userId, referenceType, referenceId],
  );
}

/** How many active references an asset has — the delete-protection count. */
export async function countReferencesForAsset(mediaAssetId, userId, connection) {
  const [rows] = await runner(connection).execute(
    'SELECT COUNT(*) AS n FROM media_asset_references WHERE media_asset_id = ? AND user_id = ?',
    [mediaAssetId, userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** The reference rows for an asset, for a "used by" explanation (no private ids leaked upward). */
export async function listReferencesForAsset(mediaAssetId, userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT reference_type, reference_id, created_at
       FROM media_asset_references WHERE media_asset_id = ? AND user_id = ?
      ORDER BY created_at ASC`,
    [mediaAssetId, userId],
  );
  return rows.map((r) => ({ referenceType: r.reference_type, referenceId: String(r.reference_id), createdAt: r.created_at }));
}

/**
 * G: every local on-disk storage key a user owns, for byte removal during
 * account deletion. Captured BEFORE rows are deleted. HCTI-proxied assets have
 * no storage_key and are omitted (nothing on disk). User-scoped, so it never
 * returns another user's files (dedup is per-user; files are physically distinct).
 */
export async function listStorageKeysForUser(userId, connection) {
  const [rows] = await runner(connection).execute(
    "SELECT id, storage_key, mime_type FROM media_assets WHERE user_id = ? AND storage_driver = 'local' AND storage_key IS NOT NULL",
    [userId],
  );
  return rows.map((r) => ({ id: String(r.id), storageKey: r.storage_key, mimeType: r.mime_type ?? null }));
}

export default {
  createMediaAsset,
  findMediaAssetByIdForUser,
  listStorageKeysForUser,
  findReadyMediaAssetByPublicToken,
  markMediaAssetReady,
  markMediaAssetFailed,
  associateAssetWithPost,
  deleteUnusedMediaAsset,
  listMediaAssetsForUser,
  findStorageKeyForAsset,
  findStorageByPublicToken,
  findMediaAssetByChecksumForUser,
  updateMediaAltText,
  deleteMediaAssetRow,
  attachMediaReference,
  detachMediaReference,
  detachAllReferencesForEntity,
  countReferencesForAsset,
  listReferencesForAsset,
  MEDIA_REFERENCE_TYPES,
};
