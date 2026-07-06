# Cyflow

A self-hosted **workflow automation platform** — a faithful, bundle-based clone of
**Make.com** (formerly Integromat). Build a **Scenario** as a left-to-right chain
of **Modules** that pass **bundles** of data between each other, with routers,
iterators, aggregators, filters, error handlers, a data store, mapped
expressions, and encrypted per-user connections.

> Design source of truth: `CLAUDE.md`, `ARCHITECTURE.md`, `MAKE-FEATURE-MAP.md`,
> and the phase specs. UI identity: `UI-DESIGN.md` (lime world, black text, heavy
> frosted glass).

## Monorepo layout

```
packages/
  shared/       framework-agnostic types + contracts (browser-safe)
  functions/    {{ }} expression / mapping engine + filters
  engine/       bundle-based execution engine + built-in apps + data store
  connectors/   Telegram, OpenAI, Gmail, Sheets, Slack (App-framework)
  connections/  encrypted credential vault (AES-256-GCM) + OAuth2 scaffold
  db/           Prisma schema, client, repositories
apps/
  api/          REST API (Express): scenarios, executions, run-once, connections
  worker/       BullMQ worker: loads a scenario, runs the engine, persists it
  web/          React + Vite product UI (dashboard + scenario builder)
```

`packages/*`, `apps/api`, and `apps/worker` are a **pnpm** workspace; `apps/web`
is a standalone **npm** app that imports the engine's TS source via Vite aliases.

## Prerequisites

- Node.js 18+ (developed on Node 24).
- pnpm (via corepack: `corepack pnpm ...`).
- Docker (for Postgres + Redis) — only needed to run the worker end-to-end.

## Install & check

```bash
corepack pnpm install
corepack pnpm --filter @cyflow/db generate   # generate the Prisma client
corepack pnpm -r typecheck
corepack pnpm -r test
```

## Run the UI (bubble canvas + "Run once")

```bash
cd apps/web
npm install
npm run dev      # http://localhost:5173  (or: npm run build && npm run preview)
```

The UI loads a sample scenario (**Webhook → Iterator → HTTP → Array Aggregator →
Telegram**) and runs the **real engine in the browser** for "Run once" — HTTP and
Telegram are mocked so the demo works offline. The replay animates each step from
real `Execution.steps`, the operations counter reflects fan-out, and selecting a
bubble inspects its input/output snapshots.

## Run the API (real persistence for the UI)

The API serves the product UI's data (`GET/POST/PUT/DELETE /scenarios`,
`POST /scenarios/:id/run-once`, `GET /executions`, `GET /connections`,
`GET /data-stores`, `GET /health`). Run-once executes through the **same engine +
connectors path as the worker** (`runScenarioJob`) and returns an execution
snapshot compatible with the UI replay.

```bash
# In-memory (no database) — perfect for local dev / demos:
corepack pnpm --filter @cyflow/api start      # http://localhost:3001

# With real persistence — point it at Postgres:
docker compose up -d
DATABASE_URL=postgresql://cyflow:cyflow@localhost:5432/cyflow \
  corepack pnpm --filter @cyflow/db migrate
DATABASE_URL=postgresql://cyflow:cyflow@localhost:5432/cyflow \
  corepack pnpm --filter @cyflow/api start
```

Then point the frontend at it (see below): set `VITE_CYFLOW_API_URL=http://localhost:3001`.
**With no `VITE_CYFLOW_API_URL`, the UI stays in local demo mode** (mock engine,
seed data) — the API is optional for the frontend to run.

## Run the worker end-to-end (Postgres + Redis)

```bash
docker compose up -d
cp .env.example .env            # then edit values
corepack pnpm --filter @cyflow/db migrate     # apply the schema
corepack pnpm --filter @cyflow/worker start   # consume the executions queue
```

## Environment

See `.env.example` (backend) and `apps/web/.env.example` (frontend):

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | api, worker | Postgres connection string (Prisma). When **unset**, the API uses an in-memory store (dev/demo only). |
| `REDIS_URL` | worker | Redis connection for the BullMQ execution queue + scheduler. |
| `CYFLOW_ENCRYPTION_KEY` | api, worker | Secret used to derive the AES-256-GCM key that encrypts stored connection credentials. Without it the API simply disables connections. **Use a strong random value in production.** |
| `ADMIN_TOKEN` (or `CYFLOW_ADMIN_TOKEN`) | api | Single-admin token. When set, every route except `/health` and `/hooks/:id` requires it. **Unset ⇒ open API.** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | api | Google OAuth client (for Gmail/Sheets/Drive/Calendar). Secret stays server-side. |
| `GOOGLE_REDIRECT_URI` | api | Must equal `{API}/oauth/google/callback` and be an Authorized redirect URI in the Google client. |
| `WEB_APP_URL` | api | Frontend base URL the OAuth callback redirects back to (e.g. `https://cyflow.example`). |
| `PORT` | api | API listen port (default `3001`). |
| `SCHEDULER_TICK_MS` | worker | How often the schedule runner polls (default `60000`). |
| `VITE_CYFLOW_API_URL` | web (build-time) | Base URL of the API. **Unset ⇒ local demo mode.** |

## Personal production mode (single admin)

Run Cyflow as your own private automation server: a Vercel frontend, an
admin-protected API, a worker (schedule runner + queue), Postgres, and Redis.

**1. Postgres + Redis.** Provision a Postgres database and a Redis instance
(any host — Neon/Supabase/RDS for Postgres, Upstash/managed Redis). Note their
connection URLs.

**2. Apply the schema (once):**

```bash
DATABASE_URL=postgres://…  corepack pnpm --filter @cyflow/db generate
DATABASE_URL=postgres://…  corepack pnpm --filter @cyflow/db migrate
```

**3. Deploy the API** (container/VM; Node 18+). Env:

```
DATABASE_URL=postgres://…
CYFLOW_ENCRYPTION_KEY=<32+ random chars>     # encrypts connection secrets
ADMIN_TOKEN=<long random secret>             # protects every route but /health + /hooks
PORT=3001
# Google OAuth (Gmail/Sheets/Drive/Calendar) — optional:
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…                        # stays server-side; never sent to the browser
GOOGLE_REDIRECT_URI=https://api.cyflow.example/oauth/google/callback
WEB_APP_URL=https://cyflow.example            # where the OAuth callback returns to
```

For Google: create an OAuth client (type "Web application") in Google Cloud,
add `GOOGLE_REDIRECT_URI` as an Authorized redirect URI, and enable the Gmail /
Sheets / Drive / Calendar APIs. Then in the app, open Connections → add a Gmail
(etc.) connection → "Connect with Gmail" opens the real Google consent; tokens
are stored encrypted and auto-refreshed before each run.

Start: `corepack pnpm --filter @cyflow/api start`. The public base URL of this
server (e.g. `https://api.cyflow.example`) is your **webhook base URL** — a
scenario's webhook is `POST {API}/hooks/{scenarioId}` (shown + copyable in the
builder on the webhook trigger).

**4. Deploy the worker** (container/VM; Node 18+) with access to the same
Postgres + Redis. Env:

```
DATABASE_URL=postgres://…                     # same DB as the API
REDIS_URL=redis://…
CYFLOW_ENCRYPTION_KEY=<same as the API>        # must match to decrypt secrets
```

Start: `corepack pnpm --filter @cyflow/worker start`. It consumes the executions
queue **and** runs enabled "every X minutes" schedules.

**5. Deploy the frontend to Vercel** (Root Directory `apps/web`). Set one env
var and redeploy:

```
VITE_CYFLOW_API_URL=https://api.cyflow.example
```

On first load the app shows **Connect to Cyflow** — paste your `ADMIN_TOKEN`
(stored only in your browser's localStorage; sent as a Bearer header). Then
create/save/run/schedule your real workflows.

> Security: connection secrets are encrypted at rest with `CYFLOW_ENCRYPTION_KEY`
> and only decrypted inside the API/worker at run time; the frontend and
> execution snapshots only ever see redacted summaries. Keep `ADMIN_TOKEN` and
> `CYFLOW_ENCRYPTION_KEY` secret and identical between API and worker (the key).

## Connectors & auth

Every integration is an **App** (`packages/connectors`, or built-ins in
`packages/engine`) exposing modules that conform to the App framework. Each app
declares an **auth schema**:

| App | Modules | Auth |
|---|---|---|
| Telegram | Send a message | `api_key` (bot token) |
| OpenAI | Create a chat completion | `bearer_token` (API key) |
| Slack (scaffold) | Send a message | `bearer_token` (bot token) |
| Gmail (scaffold) | Send an email | `oauth2` |
| Google Sheets (scaffold) | Append a row | `oauth2` |
| HTTP (built-in) | Make a request | optional connection (bearer / api key / basic) |

Users bring their own credentials (**BYO-API**). Credentials are **encrypted at
rest** (AES-256-GCM) and decrypted **only at run time** inside the worker,
delivered to a module via `ctx.connection`. They are **never** sent to the
frontend. OAuth2 has a scaffold in `packages/connections` (authorization-URL
builder, code exchange, refresh).

## Security

- Stored credentials are encrypted with AES-256-GCM; a wrong key or tampering
  fails on decrypt.
- Execution snapshots are **redacted** before persistence — known secret keys
  (`token`, `password`, `access_token`, `authorization`, …) become `[REDACTED]`.
- Secrets are never logged.

## Demo scenario notes

The `apps/web` sample scenario is safe to run offline: its HTTP and Telegram
modules are replaced with deterministic mocks in the browser, so **no real
network calls or credentials are involved**. To run real connectors, register a
connection and execute through the worker.

## Deployment

The frontend and backend deploy **separately**: `apps/web` is a static Vite site
(great fit for Vercel); `apps/api` is a stateless Node HTTP server (container/VM
or any Node host) that talks to Postgres; and `apps/worker` is a long-running Node
process that needs Postgres + Redis (Vercel is not suitable for the API or worker
— use a container/VM host).

### Frontend → Vercel (`apps/web`)

`apps/web` imports the engine packages' TypeScript source directly (Vite
aliases). Vercel checks out the **whole repo**, so those sibling packages are on
disk during the build — you only need to point Vercel at the sub-directory.

1. Import the GitHub repo into Vercel.
2. Set **Root Directory** to `apps/web`.
   - If Vercel offers *"Include files outside of the Root Directory in the Build
     Step"*, keep it **enabled** (the build reads `../../packages/*`).
3. Framework is auto-detected as **Vite**; `apps/web/vercel.json` pins it:
   - Install: `npm install`
   - Build: `npm run build`  (runs `tsc --noEmit && vite build`)
   - Output: `dist`
   - A SPA rewrite serves `index.html` for all routes.
4. **Environment variable (optional): `VITE_CYFLOW_API_URL`.**
   - **Unset** → the site runs in **local demo mode**: the real engine runs in the
     browser with mocked HTTP/Telegram and seed data, making **no backend calls**.
   - **Set** to your deployed API's base URL (e.g. `https://api.cyflow.example`) →
     the site loads/saves scenarios, lists executions, and runs "Run once" against
     the real API. It's a **build-time** variable (Vite inlines `VITE_`-prefixed
     vars), so set it in Vercel's *Environment Variables* and redeploy.

Locally you can reproduce the Vercel build with:

```bash
cd apps/web
npm install
VITE_CYFLOW_API_URL=https://api.cyflow.example npm run build   # or omit for demo mode
```

### API → container/VM (`apps/api`)

Stateless HTTP server; deploy anywhere that runs Node 18+ with access to Postgres
(Fly.io, Railway, Render, a VM, Kubernetes, …). CORS is open by default.

```bash
corepack pnpm install
corepack pnpm --filter @cyflow/db generate
corepack pnpm --filter @cyflow/db migrate      # apply the schema (once)
corepack pnpm --filter @cyflow/api start        # serves on $PORT (default 3001)
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (Prisma). Unset ⇒ ephemeral in-memory store (dev only). |
| `CYFLOW_ENCRYPTION_KEY` | Credential-vault key (optional; unset disables connections). |
| `PORT` | Listen port (default `3001`). |

Set the frontend's `VITE_CYFLOW_API_URL` to this server's public URL.

### Worker → container/VM (`apps/worker`)

Deploy the worker anywhere that runs Node 18+ with network access to Postgres +
Redis (Fly.io, Railway, Render, a VM, Kubernetes, …):

```bash
corepack pnpm install
corepack pnpm --filter @cyflow/db generate
corepack pnpm --filter @cyflow/db migrate     # apply the schema (once)
corepack pnpm --filter @cyflow/worker start
```

Required environment variables (see `.env.example`):

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | worker | Postgres connection (Prisma). |
| `REDIS_URL` | worker | Redis for the BullMQ execution queue. |
| `CYFLOW_ENCRYPTION_KEY` | worker | Derives the AES-256-GCM key for the credential vault. **Strong random value in production.** |

The **frontend never receives these** — credentials are decrypted only inside the
worker at run time.
