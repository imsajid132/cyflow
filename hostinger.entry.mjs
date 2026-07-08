/**
 * Hostinger (Phusion Passenger) startup file for the Cyflow API.
 *
 * Hostinger's "Node.js Web App" runs this file directly with `node`, so it must
 * be plain JavaScript. The API itself is TypeScript run with no build step, so
 * we register tsx as a runtime loader and then import the SAME entrypoint used
 * locally (apps/api/src/main.ts) — nothing about the app changes.
 *
 * Passenger provides the listening port via PORT, which main.ts already reads.
 *
 * Local dev is unaffected: developers keep using `pnpm --filter @cyflow/api start`.
 */

import { register } from "tsx/esm/api";

// Install the tsx ESM loader so `import(... .ts)` works under plain node.
register();

import("./apps/api/src/main.ts").catch((err) => {
  console.error("[hostinger] failed to boot Cyflow API:", err);
  process.exit(1);
});
