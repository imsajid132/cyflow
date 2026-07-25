/**
 * A content-derived version stamp for the front-end assets.
 *
 * WHY THIS EXISTS. This app has no build step and no content-hashed filenames,
 * so `app.js` serves every module with `Cache-Control: no-cache` — "keep it, but
 * revalidate before use". That is correct, and it works when the response
 * reaches the browser intact. On the production host it does not: the CDN in
 * front of the app strips `Cache-Control` and `ETag` and re-emits its own
 * headers. A browser that receives a response with neither falls back to
 * HEURISTIC caching — it invents a lifetime from `Last-Modified` and does not
 * ask again — so a freshly deployed release can keep running the previous
 * release's JavaScript for hours. That is exactly the "I redeployed and nothing
 * changed" failure, and no amount of server-side correctness fixes it, because
 * the browser never asks.
 *
 * The one thing no cache can defeat is a DIFFERENT URL. The shell therefore
 * loads its module graph from `/v/<version>/assets/...`. Because ES module
 * imports resolve relatively, versioning the entry point versions the entire
 * graph: `/v/abc123/assets/js/main.js` imports `/v/abc123/assets/js/router.js`
 * on its own. A release with different bytes gets a different prefix, so the CDN
 * and the browser both miss and fetch it; a release with identical bytes keeps
 * the same prefix and stays cached.
 *
 * The stamp is derived from the CONTENT of public/assets (path, size, mtime), so
 * it changes when a deployment changes an asset and stays stable across a plain
 * restart. Computed once at boot over a small directory.
 */

import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every file under `dir`, depth-first, as absolute paths. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // an unreadable/missing directory simply contributes nothing
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * A short, stable stamp for the current asset content.
 *
 * Falls back to a constant when the directory cannot be read, so a packaging
 * mistake degrades to "no versioning" rather than crashing the server at boot.
 *
 * @param {string} assetsDir absolute path to the served assets directory
 * @returns {string} 10 hex characters, URL-safe
 */
export function computeAssetVersion(assetsDir) {
  const hash = createHash('sha1');
  let counted = 0;
  for (const file of walk(assetsDir)) {
    try {
      const st = statSync(file);
      hash.update(`${file}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
      counted += 1;
    } catch {
      /* a file that vanished mid-walk simply does not contribute */
    }
  }
  if (counted === 0) return 'static';
  return hash.digest('hex').slice(0, 10);
}

export default computeAssetVersion;
