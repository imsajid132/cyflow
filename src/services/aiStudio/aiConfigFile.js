/**
 * A file-based fallback for the AI studio's settings.
 *
 * WHY THIS EXISTS. On the production host the control panel cannot be made to
 * store the studio's two settings. Adding them one at a time, adding them under
 * different names, and importing a complete .env all end the same way: the panel
 * shows them, the save reports success, and the saved set comes back without
 * them. Deleting entries to make room did not help either. Hours went into that
 * and the feature stayed unconfigurable, with a correct app on the other side of
 * a control panel that would not carry two strings.
 *
 * So the app stops depending on it. It also reads a small file:
 *
 *     AI_API_KEY=...
 *     AI_STUDIO_MODE=on
 *
 * Environment variables always WIN — this is a fallback, not an override, so a
 * host where the panel works keeps behaving exactly as documented, and every
 * test continues to configure the studio through the environment.
 *
 * Where it looks, first hit wins:
 *   1. CYFLOW_AI_ENV_FILE                     an explicit path, if ever needed
 *   2. <parent of MEDIA_STORAGE_PATH>/ai.env  the host's persistent private dir
 *   3. <app root>/ai.env                      a plain local file
 *
 * (2) matters: that directory already holds media and exports, so it is outside
 * the deployed tree and survives a redeploy, and it is not web-served.
 *
 * The file is read once and cached: the process restarts on every deployment,
 * which is exactly when the file could have changed. A missing or unreadable
 * file is not an error — it simply contributes nothing.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Minimal KEY=VALUE parsing. No expansion, no execution — just pairs. */
function parse(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    // Tolerate a quoted value, which is what a text editor tends to produce.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

/** The candidate locations, in order of preference. */
export function candidatePaths() {
  const paths = [];
  const explicit = process.env.CYFLOW_AI_ENV_FILE;
  if (explicit) paths.push(explicit);

  const media = process.env.MEDIA_STORAGE_PATH;
  if (media) paths.push(path.join(path.dirname(media), 'ai.env'));

  paths.push(path.resolve(process.cwd(), 'ai.env'));
  return paths;
}

let cache = null;

/**
 * The settings found on disk, or an empty object.
 * @param {{ refresh?: boolean }} [opts] `refresh` re-reads (used by tests)
 */
export function readAiConfigFile({ refresh = false } = {}) {
  if (cache && !refresh) return cache.values;
  for (const candidate of candidatePaths()) {
    try {
      if (!existsSync(candidate)) continue;
      const values = parse(readFileSync(candidate, 'utf8'));
      if (Object.keys(values).length) {
        cache = { path: candidate, values };
        return values;
      }
    } catch {
      /* unreadable candidate: try the next one */
    }
  }
  cache = { path: null, values: {} };
  return cache.values;
}

/** Whether the settings came from a file — reported by /health, never the value. */
export function aiConfigFileUsed() {
  readAiConfigFile();
  return Boolean(cache?.path);
}

export default readAiConfigFile;
