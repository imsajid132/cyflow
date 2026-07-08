# Deploying the Cyflow API on Hostinger (npm, no pnpm)

This guide deploys the **Cyflow API** (`apps/api`) to a **Hostinger Cloud
Professional → Node.js Web App**. Hostinger uses **npm** and **Phusion
Passenger**; it does **not** have `pnpm` or `corepack` available during the
build. The changes in this repo make the whole install/build/start path work
with **npm only** — local `pnpm` development is untouched.

> The frontend (`apps/web`) is a static Vite app and is **not** deployed here —
> deploy it to Vercel/Netlify/Hostinger static hosting and point
> `VITE_CYFLOW_API_URL` at the API URL from this deployment.

---

## Why the old build failed

The Hostinger build ran `npm run db:generate`, whose script used to call
`pnpm --filter @cyflow/db generate`. Hostinger has no `pnpm`, so it failed with
`sh: line 1: pnpm: command not found`.

Two problems had to be solved:

1. **Build used pnpm.** Hostinger only lets you pick a build command from a
   dropdown (`npm run build`, `npm run db:generate`, …), and those scripts used
   to call pnpm.
2. **Runtime used tsx/esbuild.** The first fix booted the app with `tsx` (which
   runs the TypeScript directly). Hostinger blocks executing the esbuild native
   binary that tsx relies on, so runtime crashed with
   `@esbuild/linux-x64/bin/esbuild EACCES`.

**What changed (nothing removed; local pnpm dev untouched):**

1. Root `package.json` declares npm **`workspaces`** (`packages/*`, `apps/api`,
   `apps/worker`), so `npm install` resolves the internal packages exactly like
   pnpm does. `pnpm` keeps using `pnpm-workspace.yaml` and ignores this field.
2. Root **`db:generate`** runs Prisma directly
   (`prisma generate --schema packages/db/prisma/schema.prisma`) — **no pnpm**.
   The old pnpm form is preserved as **`db:generate:pnpm`** for local use.
3. Root **`build`** = `db:generate` **+** `compile:api`. The compile step
   (`scripts/hostinger-build.mjs`) transpiles the API and the workspace packages
   it uses to plain **CommonJS** under **`dist-hostinger/`**, using the
   TypeScript compiler's `transpileModule` (pure JS — **no esbuild, no pnpm**).
4. **`hostinger.entry.mjs`** boots the **precompiled** `dist-hostinger/apps/api/src/main.js`
   with plain `node`. **No tsx / no esbuild at runtime.**

> The compile is a per-file syntactic transpile (the codebase is
> `isolatedModules`-clean), so it never fails on type errors — correctness is
> covered separately by `pnpm -r typecheck`. Internal packages resolve via small
> CommonJS re-export shims written into `dist-hostinger/node_modules/`; external
> deps (express, prisma, zod, …) resolve from the repo-root `node_modules`.
> `dist-hostinger/` is git-ignored — it is produced on each deploy by
> `npm run build`.

---

## Hostinger panel settings

In **hPanel → Websites → your site → Node.js**, use exactly:

| Setting | Value |
|---|---|
| **Framework preset** | None / Custom (a plain Node.js app — not Next/Nuxt/etc.) |
| **Node.js version** | **20.x** (or 22.x) |
| **Root / Application directory** | repository root (where this `package.json` lives), e.g. `public_html` or the folder you deployed to |
| **Package manager** | **npm** |
| **Install command** | `npm install` |
| **Build command** | `npm run build` |
| **Startup / Entry file** | `hostinger.entry.mjs` |
| **Application URL** | your domain / subdomain |

The build command **must be `npm run build`** (not `npm run db:generate` alone) —
`db:generate` only regenerates the Prisma client and skips the API compile, so
`dist-hostinger/` would be missing and startup would fail.

If Hostinger asks for a single **start command** instead of an entry file, use:

```
npm run hostinger:start
```

Both resolve to the same thing (`node hostinger.entry.mjs`).

### What each command does

- **`npm install`** — installs all workspaces and links the internal
  `@cyflow/*` / `engine` / `functions` packages via the npm `workspaces` field.
- **`npm run build`** → `db:generate` (`prisma generate`) **+** `compile:api`
  (`node scripts/hostinger-build.mjs`). Generates the Prisma client and
  transpiles the API to CommonJS in `dist-hostinger/`. **No pnpm, no esbuild.**
- **Startup** → `hostinger.entry.mjs` runs the precompiled
  `dist-hostinger/apps/api/src/main.js` with plain `node` — **no tsx/esbuild**.
  Passenger passes the port via `PORT`; the API already reads `process.env.PORT`.

### Database migrations

`prisma generate` does **not** touch the database. Run migrations against your
Postgres **once per schema change**. Either add it to the build command:

```
npm run build && npm run hostinger:migrate
```

or run it manually from the Hostinger SSH terminal in the app directory:

```
npm run hostinger:migrate
```

(`hostinger:migrate` = `prisma migrate deploy` — production-safe, no prompts.)

---

## Required environment variables

Set these in **hPanel → Node.js → Environment variables**. The API runs
**in-memory** (no persistence) if `DATABASE_URL` is missing, so set at least the
first three for a real deployment.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **Yes** (for persistence) | Postgres connection string (pooled). Without it the API runs in-memory and the connection vault is disabled. |
| `DIRECT_URL` | Recommended | Direct (non-pooled) Postgres URL for migrations. Falls back to `DATABASE_URL` if unset. |
| `CYFLOW_ENCRYPTION_KEY` | **Yes** if `DATABASE_URL` set | 32+ random chars. Encrypts stored connection credentials. Required to save connections. |
| `ADMIN_TOKEN` | **Strongly recommended** | Protects every route except `/health` and `/hooks`. Without it the API is **open to anyone**. |
| `PORT` | No (Passenger sets it) | Listening port. Defaults to `3001` only when running standalone. |
| `WEB_APP_URL` | If using OAuth | Frontend base URL for OAuth redirects (e.g. your Vercel URL). |
| `PUBLIC_API_URL` | Recommended | Public base of this API — used to build webhook URLs shown in the UI. |
| `REDIS_URL` | Only if running the worker | BullMQ queue/scheduler. The API works without it; scheduled runs need the separate worker + Redis. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Optional | Google OAuth connector (set all three or none). Redirect: `{api}/oauth/google/callback`. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_REDIRECT_URI` | Optional | Microsoft OAuth connector (set all three or none). Redirect: `{api}/oauth/microsoft/callback`. |

**No secrets live in git** — set every value in the Hostinger panel.

---

## Verifying the deployment

1. Open `https://<your-app>/health` → should return JSON with
   `persistence: "postgres"` once `DATABASE_URL` is set.
2. Check the Node.js app logs in hPanel for:
   `[api] Cyflow API listening on :<port>`.

---

## Local development is unchanged

Keep using pnpm locally:

```bash
corepack pnpm install
corepack pnpm --filter @cyflow/db generate
corepack pnpm --filter @cyflow/api start
```

The npm `workspaces` field and `hostinger:*` scripts are additive — pnpm ignores
the former (it reads `pnpm-workspace.yaml`) and you never call the latter.
