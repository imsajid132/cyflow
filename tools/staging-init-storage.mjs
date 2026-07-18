/**
 * Staging storage init — validate (and optionally create) the private
 * media and export directories.
 *
 * Check-only by default. Creation requires an explicit --create, because a
 * command that silently creates directories will happily create the *wrong*
 * directory when a variable is unset, and the operator will not notice until
 * a redeploy takes the files away.
 *
 * It never deletes existing content, never recurses, and never chmods a tree.
 *
 * Usage:
 *   node tools/staging-init-storage.mjs            # check only
 *   node tools/staging-init-storage.mjs --create   # create if missing, then probe
 *
 * Exit: 0 = usable, 1 = blocked.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { isInside } from './staging-preflight.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PASS = 'PASS';
export const WARN = 'WARNING';
export const BLOCK = 'BLOCKED';

/**
 * Validate one directory.
 * @returns {{status:string, detail:string}}
 */
export function inspectDir(label, dir, { root = ROOT, create = false, probe = true } = {}) {
  if (!dir) {
    return { status: BLOCK, detail: `${label} path is not configured` };
  }
  if (isInside(dir, path.join(root, 'public'))) {
    return { status: BLOCK, detail: `${label} path is inside the public asset directory and would be world-readable` };
  }
  if (isInside(dir, os.tmpdir())) {
    return { status: BLOCK, detail: `${label} path is inside the system temp directory and will not survive a redeploy` };
  }

  if (!fs.existsSync(dir)) {
    if (!create) {
      return { status: WARN, detail: `${label} path does not exist (re-run with --create)` };
    }
    try {
      // 0o700: the app user only. Media and export archives are private user
      // content; a group- or world-readable directory on a shared host exposes
      // every customer's images and every export to any other account on it.
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      return { status: BLOCK, detail: `${label} path could not be created (${err.code || 'error'})` };
    }
  }

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    return { status: BLOCK, detail: `${label} path exists but is not a directory` };
  }

  if (!probe) return { status: PASS, detail: `${label} path exists` };

  // Write, read back, remove. Anything less does not prove the app can use it:
  // an existing directory can still be read-only to the service account.
  const file = path.join(dir, `.cyflow-storage-probe-${process.pid}`);
  try {
    fs.writeFileSync(file, 'probe', { mode: 0o600 });
    const back = fs.readFileSync(file, 'utf8');
    fs.unlinkSync(file);
    if (back !== 'probe') return { status: BLOCK, detail: `${label} path read back wrong content` };
  } catch (err) {
    try { fs.unlinkSync(file); } catch { /* probe may not exist */ }
    return { status: BLOCK, detail: `${label} path is not writable (${err.code || 'error'})` };
  }

  // POSIX permission bits are meaningless on Windows, where Node reports a
  // synthesised mode. Warning about them there is noise that trains an operator
  // to ignore the warning that matters on the Linux host they deploy to.
  if (process.platform !== 'win32') {
    const mode = (stat.mode & 0o777).toString(8);
    if (stat.mode & 0o077) {
      return { status: WARN, detail: `${label} path is usable but permissive (mode ${mode}); prefer 700` };
    }
    return { status: PASS, detail: `${label} path is usable (mode ${mode}, probe written, read and removed)` };
  }
  return { status: PASS, detail: `${label} path is usable (probe written, read and removed; check permissions on the Linux host)` };
}

/** Inspect both configured directories. */
export function inspectStorage(env = process.env, opts = {}) {
  const media = String(env.MEDIA_STORAGE_PATH || '').trim();
  const exportsDir = String(env.EXPORT_STORAGE_PATH || '').trim();
  const results = [
    { key: 'MEDIA_STORAGE_PATH', ...inspectDir('media', media, opts) },
    { key: 'EXPORT_STORAGE_PATH', ...inspectDir('export', exportsDir, opts) },
  ];

  if (media && exportsDir && path.resolve(media) === path.resolve(exportsDir)) {
    results.push({
      key: 'path separation',
      status: BLOCK,
      detail: 'media and export paths are identical; export cleanup sweeps its own root and would delete users\' images',
    });
  } else if (media && exportsDir) {
    results.push({ key: 'path separation', status: PASS, detail: 'media and export paths are distinct' });
  }
  return results;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const create = process.argv.includes('--create');
  const results = inspectStorage(process.env, { create });
  for (const r of results) {
    console.log(`  ${r.status.padEnd(8)} ${r.key.padEnd(22)} ${r.detail}`);
  }
  const blocked = results.filter((r) => r.status === BLOCK).length;
  console.log(`\n${results.length} checks, ${blocked} blocked`);
  if (!create) console.log('check-only. Re-run with --create to create missing directories.');
  console.log(blocked ? 'RESULT: BLOCKED' : 'RESULT: PASS');
  process.exit(blocked ? 1 : 0);
}
