/**
 * Media storage reconciliation — READ ONLY, dry run by design.
 *
 * Reports two kinds of drift between the media_assets table and the bytes on
 * disk under MEDIA_STORAGE_PATH:
 *
 *   ORPHANED BYTES  a file exists on disk with no matching local media_assets
 *                   row. These are the leftovers a failed-mid-delete or a manual
 *                   file copy can create. Safe to reclaim.
 *   MISSING BYTES   a local media_assets row points at a storage key whose file
 *                   is gone. The token route already serves an honest
 *                   "unavailable" for these; this just surfaces them.
 *
 * It NEVER deletes anything. It has no --apply flag: reclaiming disk is an
 * operator decision made with the report in hand, not something a script should
 * do unattended in this phase. Run it, read it, act deliberately.
 *
 *   node tools/media-orphans.mjs
 *
 * Requires the same env the app uses (DB_*, MEDIA_STORAGE_PATH). It reads the
 * database and the filesystem; it writes to neither.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { config } from '../src/config/env.js';
import { getPool, closePool } from '../src/db/pool.js';

const KEY_PATTERN = /^[0-9a-f]{32}$/;

async function keysOnDisk(root) {
  const found = new Set();
  let shards;
  try {
    shards = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return found; // nothing stored yet
    throw err;
  }
  for (const shard of shards) {
    if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) continue;
    const files = await fs.readdir(path.join(root, shard.name)).catch(() => []);
    for (const name of files) if (KEY_PATTERN.test(name)) found.add(name);
  }
  return found;
}

async function keysInDb() {
  // Read-only. Local-driver rows only; HCTI rows keep no storage key.
  const [rows] = await getPool().execute(
    "SELECT storage_key FROM media_assets WHERE storage_driver = 'local' AND storage_key IS NOT NULL",
  );
  return new Set(rows.map((r) => r.storage_key));
}

async function main() {
  const root = path.resolve(config.media.storagePath);
  console.log(`Media storage root : ${root}`);
  console.log(`Storage driver     : ${config.media.storageDriver}`);
  console.log('Mode               : DRY RUN (reports only; deletes nothing)\n');

  const [disk, db] = await Promise.all([keysOnDisk(root), keysInDb()]);

  const orphanedBytes = [...disk].filter((k) => !db.has(k));
  const missingBytes = [...db].filter((k) => !disk.has(k));

  console.log(`Files on disk          : ${disk.size}`);
  console.log(`Local rows in database : ${db.size}`);
  console.log(`Orphaned byte files    : ${orphanedBytes.length}`);
  console.log(`Rows with missing bytes: ${missingBytes.length}\n`);

  if (orphanedBytes.length) {
    console.log('Orphaned files (on disk, no row) — safe to reclaim:');
    for (const k of orphanedBytes) console.log(`  ${path.join(root, k.slice(0, 2), k)}`);
    console.log('');
  }
  if (missingBytes.length) {
    console.log('Storage keys referenced by a row but missing on disk:');
    for (const k of missingBytes) console.log(`  ${k}`);
    console.log('');
  }
  if (!orphanedBytes.length && !missingBytes.length) {
    console.log('Storage and database are consistent. Nothing to reconcile.');
  }
}

main()
  .catch((err) => { console.error('Reconciliation failed:', err.message); process.exitCode = 1; })
  .finally(() => closePool().catch(() => {}));
