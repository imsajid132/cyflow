# ARCHITECTURE.md — Cyflow

Cyflow is a faithful clone of **Make.com**. This document defines the data model
and the core subsystems, with Make's execution semantics baked in. Read it
before writing engine or connector code. Pair it with `MAKE-FEATURE-MAP.md`.

---

## 1. Mental model (Make's, not n8n's)

A **Scenario** is a left-to-right chain of **Modules**. The first module is a
trigger. Data flows between modules as **bundles**.

```
(Webhook) --> (HTTP request) --> (Iterator) --> (Send Telegram) --> (Aggregator)
  1 bundle       1 bundle        N bundles       runs N times        1 bundle
```

The scenario runs in **cycles**. The trigger produces one or more bundles; each
trigger bundle starts a cycle that flows through the chain.

---

## 2. Bundle-based execution — THE core idea (read carefully)

This is what makes Cyflow *Make* and not n8n. Get it right in Phase 1.

**Rule:** every module operation takes ONE input bundle and returns an ARRAY of
output bundles (`Bundle[]`). The engine multiplexes:

- Normal action: returns `[oneBundle]` → the next module runs once.
- Search / "list rows" module: returns `[b1, b2, ... bN]` → **the next module
  runs N times**, once per bundle.
- **Iterator**: takes a bundle containing an array, returns one bundle per array
  element → downstream runs per element.
- **Aggregator**: the exception — it *consumes* many bundles and emits one. It's
  a "sink" that collects all bundles routed to it, then emits a single bundle.

**Operations counting (Make's billing unit):** every time a module processes one
bundle = 1 operation. The engine increments an `operations` counter on each
module run. We display this (parity with Make) and can later cap/charge on it.

**Implication for the engine walker:** you cannot write a naive "for each module,
run once" loop. You process **bundle by bundle**. A clean model:

```
processModule(module, inputBundles):
    outputBundles = []
    for each inputBundle in inputBundles:
        operations += 1
        result = module.run(inputBundle, ctx)   // returns Bundle[]
        record step result + operations
        outputBundles.push(...result)
    if module.next exists:
        processModule(next, outputBundles)
```

Aggregators break the per-bundle recursion: they buffer all inputs for the
route, then emit one bundle to continue. (Aggregators arrive in Phase 5 — but
the engine's bundle plumbing must exist from Phase 1 so they slot in.)

For **Phase 1** the three built-in modules each return exactly one bundle, so the
chain is effectively linear — but it MUST be built on `Bundle[]` so Phases 5/8
(iterator, aggregator, router) are not a rewrite.

---

## 3. Data model (Prisma)

`packages/db/prisma/schema.prisma`. Phases extend it.

```prisma
model User {
  id           String       @id @default(cuid())
  email        String       @unique
  passwordHash String
  createdAt    DateTime     @default(now())
  scenarios    Scenario[]
  connections  Connection[]
}

model Scenario {
  id          String        @id @default(cuid())
  userId      String
  user        User          @relation(fields: [userId], references: [id])
  name        String
  status      ScenarioStatus @default(DRAFT)  // DRAFT|ACTIVE|PAUSED
  // schedule config (Phase 3): { type: 'webhook' } | { type: 'interval', minutes }
  schedule    Json?
  // the chain itself as JSON — see "Scenario blueprint" below
  blueprint   Json
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  executions  Execution[]
}

model Connection {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  appKey        String                       // "telegram", "google"
  name          String                       // user label
  // encrypted at rest (Phase 7). Holds api keys / oauth tokens.
  encryptedData String
  createdAt     DateTime @default(now())
}

model Execution {
  id          String          @id @default(cuid())
  scenarioId  String
  scenario    Scenario        @relation(fields: [scenarioId], references: [id])
  status      ExecutionStatus @default(RUNNING) // RUNNING|SUCCESS|FAILED
  operations  Int             @default(0)       // total ops this run (Make parity)
  // per-module bundle-level detail, JSON. See "Execution record".
  steps       Json
  error       String?
  startedAt   DateTime        @default(now())
  finishedAt  DateTime?
}

enum ScenarioStatus  { DRAFT ACTIVE PAUSED }
enum ExecutionStatus { RUNNING SUCCESS FAILED }
```

### Scenario blueprint (the JSON in `Scenario.blueprint`)

```jsonc
{
  "modules": [
    {
      "id": "1",
      "app": "webhook",
      "operation": "custom_webhook",   // module type within the app
      "kind": "trigger",               // trigger | action | search | iterator | aggregator | router
      "params": {},
      "connectionId": null,            // which stored Connection to use (Phase 7)
      "filter": null,                  // condition on the link INTO next (Phase 5)
      "next": "2"
    },
    {
      "id": "2",
      "app": "http",
      "operation": "make_request",
      "kind": "action",
      "params": { "method": "GET", "url": "https://httpbin.org/get" },
      "next": "3"
    },
    {
      "id": "3",
      "app": "core",
      "operation": "sleep",
      "kind": "action",
      "params": { "seconds": 1 },
      "next": null
    }
  ]
}
```

> Phase 1 uses a linear `next` pointer. Router (Phase 8) upgrades `next` to
> support multiple routes; keep the walker isolated so this is additive.

### Execution record (the JSON in `Execution.steps`)

Bundle-aware — records each bundle a module processed:

```jsonc
{
  "1": { "status": "success", "operations": 1, "bundles": [ { "email": "a@b.com" } ], "ms": 3 },
  "2": { "status": "success", "operations": 1, "bundles": [ { "statusCode": 200, "data": {} } ], "ms": 210 },
  "3": { "status": "success", "operations": 1, "bundles": [ {} ], "ms": 1001 }
}
```

---

## 4. Execution engine (`packages/engine`)

The heart. Keep it **framework-agnostic** (no NestJS/Prisma/BullMQ imports) so it
runs in the worker and in tests.

### Key interfaces (`packages/engine/src/types.ts`)

```ts
export type Bundle = Record<string, unknown>;

export interface ExecutionContext {
  scenarioId: string;
  executionId: string;
  operations: number;                    // running total, engine increments
  // outputs already produced, keyed by module id (bundle-level)
  steps: Record<string, ModuleResult>;
  trigger: Bundle[];                     // trigger bundles that started the run
  // resolves a Connection's decrypted credentials (Phase 7; stub earlier)
  getConnection?: (connectionId: string) => Promise<Record<string, unknown> | null>;
}

export interface ModuleResult {
  status: 'success' | 'error';
  operations: number;
  bundles: Bundle[];
  error?: string;
  ms: number;
}

/**
 * Every module operation implements this.
 * Takes ONE input bundle, returns an ARRAY of output bundles.
 * - action: usually returns [oneBundle]
 * - search/iterator: returns [b1..bN]
 */
export type OperationRunner = (
  inputBundle: Bundle,
  params: Record<string, unknown>,
  ctx: ExecutionContext,
) => Promise<Bundle[]>;
```

The engine is a pure function of (blueprint, triggerBundles, registry) →
execution record. Trivially testable. No HTTP/DB coupling.

---

## 5. Connector / "App" framework — Phase 2

Every integration is an **App** with a standard shape. This is the biggest lever
for long-term velocity. Modelled on Make's app structure.

```ts
export interface App {
  key: string;                      // "telegram"
  name: string;                     // "Telegram"
  auth?: AuthSchema;                // what a Connection needs (Phase 7)
  modules: Record<string, ModuleDef>;
}

export interface ModuleDef {
  key: string;                      // "send_message"
  name: string;
  kind: 'trigger' | 'action' | 'search' | 'iterator' | 'aggregator';
  params: ZodSchema;                // validates params + drives the UI form
  triggerKind?: 'webhook' | 'polling' | 'schedule';
  run: OperationRunner;
}
```

A **registry** maps `appKey -> App`; the engine looks up
`registry.get('http').modules['make_request'].run`. Phase 1 registers the three
built-ins directly; Phase 2 generalises into this framework.

---

## 6. Connections & bring-your-own-API auth — Phase 7

The Make model: **each user connects their own accounts.** The platform never
pays for a user's third-party API usage.

Auth types the framework must support:
- **api_key** — user pastes a key/token (Telegram, OpenAI, SendGrid). No
  platform-side setup.
- **oauth2** — user clicks "Connect", authorises; we store access + refresh
  tokens and auto-refresh. Requires the platform to register **one developer app
  per provider** (Google, Slack, Facebook) to get client_id/secret — a one-time,
  free, per-provider step.
- **basic** — username/password.
- **custom** — multiple fields.

Secrets are **encrypted at rest** (AES-256-GCM, key from env), decrypted only
inside the worker at run time, never sent to the frontend.

---

## 7. Functions / expression engine — Phase 4

Make's mapping is rich — far beyond `{{1.field}}`. Build `packages/functions`:

- Parse `{{ ... }}` tokens in any string param (walk the whole params tree).
- Resolve mappings: `{{1.body.email}}` → module `1`'s bundle, dot-path in.
  Expose `{{now}}`, current bundle refs, etc.
- **Functions:** `{{formatDate(1.created; "YYYY-MM-DD")}}`, `{{upper(...)}}`,
  `{{map(2.array; "name")}}`, `{{get(...)}}`, `{{if(...)}}`, plus string, math,
  date, and array helpers. Implement as a whitelisted function table — do NOT
  `eval` arbitrary JS.
- Pure function: `resolve(params, inputBundle, ctx) -> resolvedParams`.

---

## 8. Triggers & scheduling — Phase 3

- **Webhook (instant):** `POST /hooks/:scenarioId`. Build the trigger bundle(s)
  from the request, enqueue an execution.
- **Interval (polling):** BullMQ repeatable jobs. A scheduler registers a
  repeatable job per active scheduled scenario ("every 15 min"). On fire, the
  worker runs it; polling triggers fetch new items since a stored cursor and
  dedupe.

---

## 9. Queue & workers — Phase 3

- BullMQ over Redis, one `executions` queue.
- Producer: API (webhook receiver / "Run once" button) enqueues
  `{ scenarioId, triggerBundles }`.
- Worker (`apps/worker`): loads the scenario, runs the engine, writes the
  `Execution` record, handles retries (BullMQ attempts + backoff) and
  concurrency. The engine call is the only business logic in the worker.

---

## 10. Frontend — Phase 6 (Make's look & feel)

- Make's canvas is **not** a free-form graph. It's a left-to-right chain of
  circular module **bubbles** joined by curved connectors, with routers creating
  branches. Customise React Flow: round nodes, app icon inside, curved edges.
- Right panel: a form generated from the module's Zod `params` schema, plus a
  **mapping picker** to click earlier modules' output fields into `{{...}}`.
- **"Run once"** replay: after a run, click a bubble to inspect its bundles
  one-by-one (Make's signature debugging UX) — sourced from `Execution.steps`.

---

## 11. Deliberately NOT early

- No 2000-app library — build the framework, add apps on demand.
- No multi-tenant orgs until single-user works end to end.
- No routers/iterators/aggregators until the linear bundle engine is solid.
- No billing — but DO count operations from Phase 1 (cheap, and it's core Make).

Ship the smallest thing that runs a real scenario on the bundle model, then widen.
