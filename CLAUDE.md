# CLAUDE.md — Cyflow

> **Cyflow** — a self-hosted workflow automation platform, a faithful clone of
> **Make.com** (formerly Integromat). By Cyfrow.
> This file is your source of truth. Read it fully at the start of every session.

## What we're building

A Make.com clone. A user builds a **Scenario**: a chain of **Modules** connected
left-to-right that pass **bundles** of data between each other. A scenario starts
with a trigger and processes data in cycles, module by module.

**We are cloning Make specifically — not building a generic automation tool.**
The Make model differs from n8n in important ways (see `MAKE-FEATURE-MAP.md`).
The single most important difference is **bundle-based execution** — read
`ARCHITECTURE.md` §2 before writing any engine code.

Ambition is high, so we build **MVP-first, phase by phase**. Finish and test the
current phase before moving on.

## Golden rules

1. **Make, not n8n.** When a design choice comes up, match Make's behaviour and
   vocabulary (Scenario, Module, Bundle, Operation, Router, Iterator,
   Aggregator, Connection). See `MAKE-FEATURE-MAP.md`.
2. **Bundle-based from day one.** A module operation returns an ARRAY of
   bundles. The engine multiplexes: N output bundles → the next module runs N
   times. Never hardcode "one input → one output". This is Phase 1, not a
   retrofit.
3. **One phase at a time.** Current phase marked below. Don't build ahead.
4. **Tests before "done"** — especially the execution engine.
5. **The connector framework is sacred.** Once the "app" interface is defined
   (Phase 2), every connector conforms to it.
6. **Reference, don't copy.** Study Make's public docs for behaviour, and
   `activepieces/activepieces` / `n8n-io/n8n` source for engineering patterns.
   Write our own code.
7. **Small, reviewable commits.** Ask before large architectural pivots.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | front + back |
| Backend | NestJS | modular, DI, guards |
| Database | PostgreSQL + Prisma | |
| Queue / jobs | BullMQ + Redis | execution, retries, scheduling |
| Frontend | React + Vite | Make-style bubble canvas |
| Canvas | React Flow (customised) | left-to-right bubbles + curved links |
| Styling | Tailwind CSS | |
| Auth | custom (JWT) | encrypted credential vault |
| Validation | Zod | shared schemas |
| Monorepo | pnpm workspaces + Turborepo | |

## Monorepo layout

```
cyflow/
├── apps/
│   ├── api/            # NestJS backend (REST + webhook receiver + OAuth)
│   ├── worker/         # BullMQ workers: run scenarios, poll triggers
│   └── web/            # React frontend (the bubble builder UI)
├── packages/
│   ├── engine/         # bundle-based execution engine (framework-agnostic)
│   ├── connectors/     # all connectors ("apps"), one folder each
│   ├── functions/      # Make-style function/expression engine ({{...}})
│   ├── shared/         # shared types + Zod schemas
│   └── db/             # Prisma schema + client
├── reference/          # cloned Make docs notes, n8n & activepieces (read-only)
├── docker-compose.yml  # postgres + redis
├── ARCHITECTURE.md
├── MAKE-FEATURE-MAP.md # <-- the Make feature checklist mapped to phases
├── PHASE-1-SPEC.md
└── CLAUDE.md
```

## Core vocabulary (Make's terms — use these exactly)

- **Scenario** — the whole automation (Make's word for a workflow).
- **Module** — one step. A trigger or an action/search.
- **Bundle** — one packet of data flowing between modules. THE key unit.
- **Operation** — one module processing one bundle (Make's billing unit; we
  count it for parity + usage display).
- **Connector / App** — an integration (Telegram, Google). Exposes modules.
- **Connection** — a user's stored, encrypted credentials for an app
  (bring-your-own-API model — each user connects their own accounts).
- **Router** — splits the flow into multiple routes.
- **Iterator** — splits one bundle (with an array) into many bundles.
- **Aggregator** — collapses many bundles back into one.
- **Filter** — a condition on the link between two modules.
- **Execution** — one run of a scenario.

## Phase roadmap

- **Phase 0** — Scaffolding: monorepo, Prisma model, docker-compose.
- **Phase 1** — ⬅️ **CURRENT** — Bundle-based core engine, no UI. Linear chain,
  3 built-in modules (Webhook trigger, HTTP, Delay), operations counting.
  See `PHASE-1-SPEC.md`.
- **Phase 2** — Connector ("app") framework + first real app (Telegram).
- **Phase 3** — Persistence + BullMQ: save scenarios, log executions, retries,
  scheduling (every X min + instant webhooks).
- **Phase 4** — Functions/expression engine (`{{1.name}}`, `{{formatDate(...)}}`,
  `map()`, `get()`, string/date/math helpers).
- **Phase 5** — Iterator + Aggregators + Filters (needs the bundle model).
- **Phase 6** — Make-style bubble canvas UI + "run once" bundle replay.
- **Phase 7** — Connections + OAuth2 + encrypted vault (bring-your-own-API).
- **Phase 8** — Routers + error handlers (Resume/Rollback/Commit/Break/Ignore) +
  Data stores.
- **Phase 9** — More connectors, branding, polish.

> **Current phase: Phase 1.** Only build what `PHASE-1-SPEC.md` describes — but
> build it on the bundle abstraction.

## Commands (fill in as scaffolding lands)

```bash
pnpm install
docker compose up -d
pnpm --filter @cyflow/db prisma migrate dev
pnpm --filter engine test
pnpm dev
```

## Definition of done, per phase

Spec's acceptance criteria pass, tests green, committed, and a 5-line summary of
what changed + what the next phase needs. Then stop and wait.
