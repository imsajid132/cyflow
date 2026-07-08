/**
 * Hostinger (Phusion Passenger) startup file for the Cyflow API.
 *
 * Hostinger runs this file with plain `node`. It boots the API from the
 * PRECOMPILED JavaScript produced by `npm run build` (see
 * scripts/hostinger-build.mjs). There is intentionally **no tsx / esbuild at
 * runtime** — Hostinger blocks executing the esbuild native binary
 * (`@esbuild/linux-x64/bin/esbuild EACCES`), so the API must be plain JS.
 *
 * Passenger provides the listening port via PORT, which the API already reads.
 *
 * Local dev is unaffected: developers still use `pnpm --filter @cyflow/api start`
 * (tsx), which never touches this file or dist-hostinger/.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const compiled = join(here, "dist-hostinger", "apps", "api", "src", "main.js");

if (!existsSync(compiled)) {
  console.error(
    "[hostinger] compiled API not found at " +
      compiled +
      "\n[hostinger] run `npm run build` before starting."
  );
  process.exit(1);
}

// Loading the compiled main runs its bootstrap (app.listen). It's CommonJS;
// importing it from this ESM file is fine under Node.
import(pathToFileURL(compiled).href).catch((err) => {
  console.error("[hostinger] failed to boot Cyflow API:", err);
  process.exit(1);
});
