/**
 * Where uploaded image bytes actually live.
 *
 * ONE abstraction, so no controller, route or planner/post service ever touches
 * the filesystem directly. Today there is a local-filesystem adapter; the shape
 * (store / open / remove / exists) is the same one an S3 adapter would satisfy,
 * so a future object-storage driver drops in here without any caller changing.
 *
 * SAFETY, by construction rather than by hope:
 *   - a storage key is SERVER-GENERATED (crypto random hex). A caller cannot
 *     supply one, so an original filename never becomes a path;
 *   - a key is validated against a strict [0-9a-f] pattern before it is ever
 *     joined to a path, and the resolved absolute path is asserted to sit inside
 *     the storage root. Two independent guards, because path traversal is the
 *     one bug here that turns a photo uploader into an arbitrary-file tool;
 *   - files live UNDER a configured root that must be OUTSIDE the public app
 *     source (MEDIA_STORAGE_PATH), so nothing is ever web-served directly. Bytes
 *     only leave through the controlled, ownership-checked media route.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** A storage key is 32 hex chars. Nothing else is ever accepted as one. */
const KEY_PATTERN = /^[0-9a-f]{32}$/;

export function generateStorageKey() {
  return crypto.randomBytes(16).toString('hex');
}

export class MediaStorageError extends Error {
  constructor(message, { code = 'MEDIA_STORAGE_ERROR' } = {}) {
    super(message);
    this.name = 'MediaStorageError';
    this.code = code;
  }
}

/**
 * @param {{ driver?: string, root: string }} opts
 *        `root` is the absolute private directory bytes live under. It is NOT
 *        created lazily on read — a missing root is an operator error, surfaced
 *        honestly rather than papered over.
 */
export function createMediaStorage({ driver = 'local', root } = {}) {
  if (driver !== 'local') {
    // The only driver implemented. An unconfigured cloud driver must fail loudly
    // rather than silently drop uploads into a directory that redeploys wipe.
    throw new MediaStorageError(`Unsupported media storage driver: ${driver}`, { code: 'UNSUPPORTED_DRIVER' });
  }
  if (!root || typeof root !== 'string') {
    throw new MediaStorageError('Media storage root is not configured', { code: 'NO_ROOT' });
  }
  const absRoot = path.resolve(root);

  /**
   * Resolve a key to its absolute path, refusing anything that is not a clean
   * key or that would escape the root. Both checks, on every access.
   */
  function pathFor(storageKey) {
    if (!KEY_PATTERN.test(storageKey)) {
      throw new MediaStorageError('Invalid storage key', { code: 'BAD_KEY' });
    }
    // Shard by the first two chars so one directory never holds every file.
    const resolved = path.resolve(absRoot, storageKey.slice(0, 2), storageKey);
    // The resolved path MUST stay inside the root. A key that somehow slipped a
    // separator past the pattern still cannot escape here.
    if (resolved !== absRoot && !resolved.startsWith(absRoot + path.sep)) {
      throw new MediaStorageError('Resolved path escapes the storage root', { code: 'TRAVERSAL' });
    }
    return resolved;
  }

  return {
    driver,
    root: absRoot,

    /** Persist validated bytes under a server-generated key. Returns the key. */
    async storeValidatedImage(buffer, { storageKey = generateStorageKey() } = {}) {
      const dest = pathFor(storageKey);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      // wx: fail if it already exists, so a replayed request cannot silently
      // overwrite a file. A key collision is astronomically unlikely, and if it
      // happened we want to know, not to clobber.
      await fs.writeFile(dest, buffer, { flag: 'wx' });
      return storageKey;
    },

    /** Read the bytes back. Throws MediaStorageError with code NOT_FOUND if gone. */
    async readImage(storageKey) {
      try {
        return await fs.readFile(pathFor(storageKey));
      } catch (err) {
        if (err.code === 'ENOENT') throw new MediaStorageError('Stored image is missing', { code: 'NOT_FOUND' });
        throw err;
      }
    },

    /** True when the bytes are present. */
    async imageExists(storageKey) {
      try {
        await fs.access(pathFor(storageKey));
        return true;
      } catch {
        return false;
      }
    },

    /** Remove the bytes. Missing is treated as already-removed, not an error. */
    async removeStoredImage(storageKey) {
      try {
        await fs.unlink(pathFor(storageKey));
        return true;
      } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
      }
    },
  };
}

export default { createMediaStorage, generateStorageKey, MediaStorageError };
