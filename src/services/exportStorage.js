/**
 * Private export-archive storage (local filesystem). Mirrors mediaStorage: a
 * server-generated random key, sharded by its first two chars, under a private
 * base path OUTSIDE the web root. Path-traversal guarded; a missing file on
 * remove is treated as already-gone, not an error. Export archives are JSON.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** A safe, opaque storage key: 32 hex chars. Never derived from user input. */
export function newExportKey() {
  return crypto.randomBytes(16).toString('hex');
}

export function createExportStorage({ basePath } = {}) {
  const root = path.resolve(basePath || path.join(process.cwd(), '.data', 'exports'));

  function pathFor(key) {
    if (!/^[a-f0-9]{32}$/.test(String(key || ''))) throw new Error('Invalid export key');
    const shard = key.slice(0, 2);
    const full = path.resolve(root, shard, `${key}.json`);
    // Defence in depth: the resolved path must stay under the root.
    if (!full.startsWith(root + path.sep)) throw new Error('Path traversal blocked');
    return full;
  }

  return {
    driver: 'local',
    /** Write the archive; returns { storageKey, sizeBytes }. */
    async write(buffer) {
      const key = newExportKey();
      const full = pathFor(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, buffer, { mode: 0o600 });
      return { storageKey: key, sizeBytes: buffer.length };
    },
    async read(key) {
      return fs.readFile(pathFor(key));
    },
    async remove(key) {
      try { await fs.unlink(pathFor(key)); return true; }
      catch (err) { if (err.code === 'ENOENT') return false; throw err; }
    },
  };
}

export default { createExportStorage, newExportKey };
