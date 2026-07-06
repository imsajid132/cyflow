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
  worker/       BullMQ worker: loads a scenario, runs the engine, persists it
  web/          React + Vite + Tailwind bubble-canvas UI ("Run once" replay)
```

`packages/*` and `apps/worker` are a **pnpm** workspace; `apps/web` is a
standalone **npm** app that imports the engine's TS source via Vite aliases.

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

## Run the worker end-to-end (Postgres + Redis)

```bash
docker compose up -d
cp .env.example .env            # then edit values
corepack pnpm --filter @cyflow/db migrate     # apply the schema
corepack pnpm --filter @cyflow/worker start   # consume the executions queue
```

## Environment

See `.env.example`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Prisma). |
| `REDIS_URL` | Redis connection for the BullMQ execution queue. |
| `CYFLOW_ENCRYPTION_KEY` | Secret used to derive the AES-256-GCM key that encrypts stored connection credentials. **Use a strong random value in production.** |

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
