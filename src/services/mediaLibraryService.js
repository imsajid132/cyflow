/**
 * The media library: upload, list, reuse, alt text, references, delete.
 *
 * Coordinates three things that must never drift apart — validation, stored
 * bytes, and the database row — and owns the ordering that keeps them
 * consistent when one of them fails:
 *
 *   validate  →  store bytes  →  write row
 *
 * If the row write fails AFTER bytes are stored, the bytes are removed, so a
 * failed upload leaves nothing behind. If storage fails, no row is ever written.
 * Rejected buffers are never persisted and never retained.
 *
 * Ownership is enforced HERE, at the service, not in the UI: every read, edit,
 * attach and delete is scoped to the acting user, and a cross-user request gets
 * the same not-found answer as a genuinely missing asset — it never reveals that
 * the asset exists for someone else.
 *
 * This service never calls OpenAI or HCTI. An upload, a listing, an alt edit, a
 * detach and a delete are all local operations.
 */

import { config as defaultConfig } from '../config/env.js';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js';
import { generateSecureToken as defaultGenerateToken } from './encryptionService.js';
import { validateImageUpload, ImageValidationError } from './imageValidation.js';
import { createMediaStorage } from './mediaStorage.js';
import * as defaultMediaRepo from '../repositories/mediaAssetRepository.js';

/** Safe public shape of an asset — no storage key, no internal ids beyond the id. */
function toPublic(asset) {
  if (!asset) return null;
  return {
    id: asset.id,
    publicToken: asset.publicToken,
    source: asset.sourceProvider === 'upload' ? 'upload' : 'hcti',
    // "HCTI" is a vendor name the business owner never needs in the library.
    // They chose the rendering account once on /integrations; here the only
    // thing that matters is whether they supplied the image or Cyflow made it.
    sourceLabel: asset.sourceProvider === 'upload' ? 'Uploaded' : 'Generated',
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    fileSizeBytes: asset.fileSizeBytes,
    altText: asset.altText,
    originalFilename: asset.originalFilename,
    createdAt: asset.createdAt,
    // A stable URL the browser can render: the token content route.
    url: `/media/${asset.publicToken}`,
  };
}

/** Sanitize a client filename to DISPLAY text only. Never used as a path. */
function safeDisplayFilename(name) {
  if (typeof name !== 'string') return null;
  const base = name.replace(/[\\/]/g, ' ').replace(/[^\w.\- ]/g, '').trim().slice(0, 120);
  return base || null;
}

export function createMediaLibraryService({
  config = defaultConfig,
  mediaRepository = defaultMediaRepo,
  storage = null,
  generateSecureToken = defaultGenerateToken,
  logging = { record: async () => {} },
} = {}) {
  const store = storage ?? createMediaStorage({
    driver: config.media.storageDriver,
    root: config.media.storagePath,
  });

  /** Owner-scoped fetch that throws NotFound (never "exists for someone else"). */
  async function requireOwnedAsset(userId, assetId) {
    const asset = await mediaRepository.findMediaAssetByIdForUser(assetId, userId);
    if (!asset) throw new NotFoundError('Media not found');
    return asset;
  }

  /**
   * Store a validated upload.
   *
   * @param {string|number} userId
   * @param {{ buffer: Buffer, originalName?: string, declaredMime?: string }} file
   * @returns {Promise<object>} the public asset shape
   */
  async function uploadImage(userId, file, { req } = {}) {
    if (!file || !file.buffer) throw new ValidationError('No image was received');

    // 1. Validate from the BYTES. Throws ImageValidationError -> 400 with reason.
    let meta;
    try {
      meta = validateImageUpload(file.buffer, {
        maxBytes: config.media.maxUploadBytes,
        declaredMime: file.declaredMime ?? null,
      });
    } catch (err) {
      if (err instanceof ImageValidationError) throw new ValidationError(err.reason);
      throw err;
    }

    /*
     * 2. Content dedup, USER-SCOPED. If this user already has an asset with the
     * exact same bytes, return it instead of storing a second copy. It never
     * looks at another user's assets, so it can never reveal that someone else
     * uploaded the same file, and it makes a replayed upload return the same
     * asset rather than a duplicate.
     */
    const existing = await mediaRepository.findMediaAssetByChecksumForUser(meta.checksum, userId);
    if (existing) return toPublic(existing);

    // 3. Store the bytes under a server-generated key.
    const storageKey = await store.storeValidatedImage(file.buffer);

    // 4. Write the row. If it fails, remove the bytes we just stored so nothing
    //    is orphaned.
    let asset;
    try {
      asset = await mediaRepository.createMediaAsset({
        userId,
        publicToken: generateSecureToken(24),
        sourceProvider: 'upload',
        status: 'ready',
        storageDriver: store.driver,
        storageKey,
        originalFilename: safeDisplayFilename(file.originalName),
        fileSizeBytes: meta.byteSize,
        width: meta.width,
        height: meta.height,
        mimeType: meta.mimeType,
        fileExtension: meta.fileExtension,
        checksumSha256: meta.checksum,
      });
    } catch (err) {
      await store.removeStoredImage(storageKey).catch(() => {});
      throw err;
    }

    await logging.record('media.uploaded', {
      req, userId, message: 'Image uploaded',
      // Safe fields only: never bytes, path, key, token or EXIF.
      context: { assetId: asset.id, mimeType: meta.mimeType, width: meta.width, height: meta.height, bytes: meta.byteSize },
    }).catch(() => {});

    return toPublic(asset);
  }

  /** List the user's media, newest first. */
  async function listMedia(userId) {
    const assets = await mediaRepository.listMediaAssetsForUser(userId, { limit: 200 });
    return assets.map(toPublic);
  }

  /** Safe metadata for one owned asset. */
  async function getMedia(userId, assetId) {
    return toPublic(await requireOwnedAsset(userId, assetId));
  }

  /** Update alt text on an owned asset. */
  async function updateAltText(userId, assetId, altText, { req } = {}) {
    await requireOwnedAsset(userId, assetId); // ownership; NotFound otherwise
    const text = typeof altText === 'string' ? altText.slice(0, 500) : '';
    const updated = await mediaRepository.updateMediaAltText(assetId, userId, text);
    await logging.record('media.alt_updated', { req, userId, message: 'Alt text updated', context: { assetId } }).catch(() => {});
    return toPublic(updated);
  }

  /**
   * Attach an asset to an entity. Idempotent — a duplicate attach is one row.
   */
  async function attach(userId, assetId, referenceType, referenceId, { req } = {}) {
    if (!mediaRepository.MEDIA_REFERENCE_TYPES.includes(referenceType)) {
      throw new ValidationError('Unsupported reference type');
    }
    await requireOwnedAsset(userId, assetId); // ownership on the asset
    const { created } = await mediaRepository.attachMediaReference({
      userId, mediaAssetId: assetId, referenceType, referenceId,
    });
    if (created) {
      await logging.record('media.attached', { req, userId, message: 'Media attached', context: { assetId, referenceType, referenceId } }).catch(() => {});
    }
    return { attached: true, created };
  }

  /** Detach an asset from an entity. */
  async function detach(userId, assetId, referenceType, referenceId, { req } = {}) {
    await requireOwnedAsset(userId, assetId);
    const removed = await mediaRepository.detachMediaReference({
      userId, mediaAssetId: assetId, referenceType, referenceId,
    });
    if (removed) {
      await logging.record('media.detached', { req, userId, message: 'Media detached', context: { assetId, referenceType, referenceId } }).catch(() => {});
    }
    return { detached: removed };
  }

  /**
   * Delete an asset — only when it is the user's and has NO active references.
   *
   * A referenced asset throws a ConflictError that says WHERE it is used, in
   * user terms (how many posts), never a private database id. The bytes are
   * removed after the row so a missing file cannot block a delete; a byte
   * removal that fails is logged as recoverable rather than failing the whole
   * operation, because the row is already gone and the file is now an orphan the
   * cleanup command handles.
   */
  async function deleteMedia(userId, assetId, { req } = {}) {
    await requireOwnedAsset(userId, assetId); // ownership; NotFound otherwise
    const refCount = await mediaRepository.countReferencesForAsset(assetId, userId);
    if (refCount > 0) {
      throw new ConflictError(
        `This image is used by ${refCount} ${refCount === 1 ? 'post' : 'posts'}. `
        + 'Remove it from them before deleting it.',
      );
    }

    // Capture the storage key BEFORE the row goes — sanitize() never surfaces
    // it, and once the row is deleted it cannot be read.
    const storageInfo = await mediaRepository.findStorageKeyForAsset(assetId, userId).catch(() => null);

    const deleted = await mediaRepository.deleteMediaAssetRow(assetId, userId);
    if (!deleted) throw new NotFoundError('Media not found');

    // Remove the bytes. The row is already gone, so a failed unlink must NOT
    // fail the delete — it leaves an orphaned file the cleanup command reclaims,
    // which is recorded as recoverable rather than surfaced as an error.
    if (storageInfo?.storageDriver === 'local' && storageInfo.storageKey) {
      try {
        await store.removeStoredImage(storageInfo.storageKey);
      } catch {
        await logging.record('media.orphaned_bytes', {
          req, userId, level: 'warn', message: 'Media row deleted but bytes remain',
          context: { assetId },
        }).catch(() => {});
      }
    }

    await logging.record('media.deleted', { req, userId, message: 'Media deleted', context: { assetId } }).catch(() => {});
    return { deleted: true };
  }

  /**
   * Read bytes for the token content route.
   *
   * Local assets are read from storage; HCTI assets keep their existing proxy
   * behaviour (handled by the caller). Returns null when the token is unknown,
   * not ready, or its bytes are missing — the caller sends a placeholder.
   */
  async function readByPublicToken(publicToken) {
    const info = await mediaRepository.findStorageByPublicToken(publicToken).catch(() => null);
    if (!info) return null;
    if (info.storageDriver === 'local' && info.storageKey) {
      try {
        const buffer = await store.readImage(info.storageKey);
        return { buffer, contentType: info.mimeType || 'application/octet-stream', driver: 'local' };
      } catch {
        return null; // missing bytes -> honest unavailable
      }
    }
    // Not a local asset: signal the caller to use its HCTI proxy path.
    return { driver: 'hcti', sourceUrl: info.sourceUrl, contentType: info.mimeType };
  }

  return {
    uploadImage, listMedia, getMedia, updateAltText,
    attach, detach, deleteMedia, readByPublicToken,
    _store: store, // for tests
  };
}

export default { createMediaLibraryService };
