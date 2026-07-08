/**
 * Hostinger production compile step — turns the API's TypeScript (and the
 * workspace packages it depends on) into plain CommonJS JavaScript under
 * `dist-hostinger/`, so the app runs on Hostinger with plain `node` and does
 * NOT need tsx/esbuild at runtime (which Hostinger blocks: `esbuild EACCES`).
 *
 * How it works (no esbuild, no bundler):
 *  - The whole codebase is authored with `isolatedModules: true`, so every file
 *    can be transpiled on its own. We use the TypeScript compiler's
 *    `transpileModule` (pure JS) — a syntactic transpile that strips types and
 *    lowers ESM `import`/`export` to CommonJS. It never fails on type errors
 *    (correctness is covered separately by `pnpm -r typecheck`).
 *  - CommonJS output means extensionless relative imports (`require("./app")`)
 *    resolve at runtime with no need to rewrite import paths.
 *  - Internal packages (`@cyflow/*`, `engine`, `functions`) are made resolvable
 *    by writing tiny CommonJS re-export shims into
 *    `dist-hostinger/node_modules/<name>/`. External deps (express, prisma,
 *    zod, …) resolve from the repo-root `node_modules` as usual.
 *
 * Local pnpm dev is untouched: this only produces the `dist-hostinger/` folder.
 */

import ts from "typescript";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist-hostinger");

// Source directories that make up the API runtime graph. apps/web is excluded
// (standalone Vite app); worker's standalone entry + env loader are skipped
// below because they use `import.meta` (ESM-only) and the API never imports them.
const SRC_DIRS = [
  "apps/api/src",
  "apps/worker/src",
  "packages/shared/src",
  "packages/db/src",
  "packages/engine/src",
  "packages/functions/src",
  "packages/connectors/src",
  "packages/connections/src",
];

// name -> compiled entrypoint (relative to dist-hostinger). Matches each
// package's `main`/exports "." (all point at src/index.ts -> src/index.js).
const INTERNAL = {
  "@cyflow/shared": "packages/shared/src/index.js",
  "@cyflow/db": "packages/db/src/index.js",
  "@cyflow/connections": "packages/connections/src/index.js",
  "@cyflow/connectors": "packages/connectors/src/index.js",
  "@cyflow/worker": "apps/worker/src/index.js",
  engine: "packages/engine/src/index.js",
  functions: "packages/functions/src/index.js",
};

const TRANSPILE_OPTS = {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    importHelpers: false,
    inlineSourceMap: true,
    inlineSources: true,
  },
};

/** Recursively list *.ts files under a directory. */
function listTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "test" || entry === "__tests__") continue;
      out.push(...listTs(full));
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// 1) Clean output.
rmSync(OUT, { recursive: true, force: true });
ensureDir(OUT);

// 2) Transpile every source file to CommonJS under dist-hostinger/.
let count = 0;
let skipped = 0;
for (const dir of SRC_DIRS) {
  for (const file of listTs(join(ROOT, dir))) {
    const src = readFileSync(file, "utf8");
    // ESM-only files (import.meta) are never in the API graph — skip them so
    // they don't produce invalid CommonJS.
    if (/\bimport\.meta\b/.test(src)) {
      skipped++;
      continue;
    }
    const rel = relative(ROOT, file).replace(/\.ts$/, ".js");
    const outPath = join(OUT, rel);
    ensureDir(dirname(outPath));
    const { outputText } = ts.transpileModule(src, {
      ...TRANSPILE_OPTS,
      fileName: file,
    });
    writeFileSync(outPath, outputText);
    count++;
  }
}

// 3) Mark the output tree as CommonJS (independent of the repo's package.json).
writeFileSync(
  join(OUT, "package.json"),
  JSON.stringify({ name: "cyflow-hostinger-dist", private: true, type: "commonjs" }, null, 2)
);

// 4) Write CommonJS re-export shims so bare internal imports resolve to the
//    compiled code (external deps still resolve from repo-root node_modules).
for (const [name, entry] of Object.entries(INTERNAL)) {
  const shimDir = join(OUT, "node_modules", name);
  ensureDir(shimDir);
  const target = join(OUT, entry);
  let rel = relative(shimDir, target).split("\\").join("/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  writeFileSync(
    join(shimDir, "package.json"),
    JSON.stringify({ name, version: "0.0.0", private: true, main: "index.cjs" }, null, 2)
  );
  writeFileSync(join(shimDir, "index.cjs"), `module.exports = require(${JSON.stringify(rel)});\n`);
}

console.log(
  `[hostinger-build] transpiled ${count} files (skipped ${skipped} import.meta), ` +
    `wrote ${Object.keys(INTERNAL).length} package shims -> ${relative(ROOT, OUT)}/`
);
