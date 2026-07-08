/**
 * Build the React frontend for the single-domain Hostinger deploy.
 *
 * Output goes to the committed `web-dist/` folder. The API serves it from "/"
 * (see apps/api/src/app.ts + hostinger.entry.mjs). It is built with
 * VITE_CYFLOW_API_URL="/" so the UI calls the API on the SAME origin — no
 * separate API domain is needed.
 *
 * Why we commit the build: Hostinger blocks executing the esbuild binary that
 * Vite uses, so we must NOT run Vite on Hostinger. Instead a developer runs this
 * locally and commits `web-dist/`; the Hostinger build only copies it.
 *
 * Run it (locally) after any UI change:  npm run build:web   (then commit web-dist/)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps", "web");
const OUT = join(ROOT, "web-dist");

function run(cmd, env) {
  console.log(`\n$ ${cmd}   (cwd: apps/web)`);
  execSync(cmd, { cwd: WEB, stdio: "inherit", env: { ...process.env, ...env } });
}

if (!existsSync(join(WEB, "node_modules"))) {
  run("npm install");
}

// Vite build only (skip the app's tsc --noEmit here — this is a deploy artifact
// build; type-correctness is covered by `pnpm -r typecheck`). Same-origin API.
run(`npx vite build --outDir ${JSON.stringify(OUT)} --emptyOutDir`, {
  VITE_CYFLOW_API_URL: "/",
});

console.log("\n[build-web] built frontend -> web-dist/ (same-origin API). Commit web-dist/.");
