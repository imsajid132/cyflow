# PHASE-1-SPEC.md — Bundle-Based Core Engine (no UI)

> Read `CLAUDE.md`, `ARCHITECTURE.md` (esp. §2), and `MAKE-FEATURE-MAP.md` first.
> Build **only** what's below — but build it on the **bundle** abstraction so
> Make's iterator/aggregator/router slot in later without a rewrite.

## Goal

Prove Make's heart works: a **pure, bundle-based execution engine** that takes a
scenario blueprint + trigger bundles and processes them module-by-module,
counting operations, producing a bundle-level execution record. Three built-in
modules only. Test-driven — no web server required this phase (a small manual
runner is fine).

If the bundle plumbing is right here, iterator/aggregator/router (Phases 5/8) are
additive. If it's wrong, they force a rewrite. Spend the care here.

## In scope

1. `packages/engine` + `packages/shared` set up (TypeScript strict, Vitest).
2. Types from `ARCHITECTURE.md` §4 implemented (`Bundle`, `ModuleResult`,
   `OperationRunner`, `ExecutionContext`).
3. A **registry** with three built-in modules, each an `OperationRunner`
   returning `Bundle[]`:
   - `webhook.custom_webhook` (trigger) — its "output" is the trigger bundles,
     passed straight through (handled specially, see below).
   - `http.make_request` (action) — perform an HTTP call, return
     `[{ statusCode, headers, data }]`. Use global `fetch`/`undici`.
   - `core.sleep` (action) — wait `params.seconds`, return `[{}]`.
4. A **bundle-based walker** (`runScenario`):
   - Starts from trigger bundles.
   - For each module, runs its operation **once per input bundle**, collecting
     all output bundles, incrementing `operations` per run.
   - Passes the collected output bundles to the next module.
   - Records a bundle-level `ModuleResult` per module.
5. Error handling (Phase 1 = stop-on-error): if any bundle run throws, mark that
   module `error`, set execution `FAILED`, stop, keep prior results.
6. A tiny CLI runner `packages/engine/src/run.ts` that loads a sample blueprint +
   sample trigger bundle and prints the execution record + total operations.

## Out of scope (do NOT build this phase)

- Mapping / `{{}}` functions — params used literally. (Leave a
  `resolveParams()` stub returning params unchanged, so Phase 4 slots in.)
- Iterator / Aggregator / Router / Filters — but the walker's `Bundle[]` shape
  MUST already support "one module run per bundle" so they're additive.
- Persistence, Prisma, Postgres, BullMQ, Redis, NestJS, OAuth, vault, frontend.

## Deliverables / file layout

```
packages/
├── shared/
│   ├── src/index.ts          # re-exports shared types
│   └── package.json
└── engine/
    ├── src/
    │   ├── types.ts          # Bundle, ModuleResult, OperationRunner, ExecutionContext
    │   ├── registry.ts       # register + look up modules by (app, operation)
    │   ├── modules/
    │   │   ├── webhook.ts     # custom_webhook (trigger passthrough)
    │   │   ├── http.ts        # make_request
    │   │   └── core.ts        # sleep
    │   ├── engine.ts         # runScenario() — the bundle walker
    │   └── run.ts            # CLI sanity runner
    ├── test/
    │   ├── engine.test.ts
    │   └── modules.test.ts
    ├── package.json
    └── tsconfig.json
```

## Key contract to implement

```ts
// engine.ts
export interface Blueprint { modules: ModuleNode[]; }

export interface ModuleNode {
  id: string;
  app: string;
  operation: string;
  kind: 'trigger' | 'action' | 'search';   // Phase 1 subset
  params: Record<string, unknown>;
  next: string | null;
}

export interface ExecutionRecord {
  status: 'SUCCESS' | 'FAILED';
  operations: number;                        // total across the run
  steps: Record<string, ModuleResult>;
  error?: string;
}

/**
 * Runs a scenario on the bundle model.
 * - First module MUST be kind 'trigger'; `triggerBundles` are its output.
 * - Then follows `next`, running each module ONCE PER INPUT BUNDLE, collecting
 *   all outputs to feed the next module.
 * - Increments operations per module run. Stops FAILED on first error.
 */
export async function runScenario(
  blueprint: Blueprint,
  triggerBundles: Bundle[],
  registry: Registry,
): Promise<ExecutionRecord>;
```

## Behaviour details

- **Trigger module:** don't invoke like an action. Its `bundles` = the incoming
  `triggerBundles`. Record it as `success`, `operations = triggerBundles.length`,
  then feed those bundles to `next`.
- **Per-bundle runs:** for an action module receiving K input bundles, call its
  `run` K times (once per bundle), concatenate the returned arrays. `operations`
  += K. Record `bundles` = all outputs, `operations` = K for that module.
- **Timing:** record `ms` per module (around all its bundle runs).
- **Registry miss:** `registry.get(app, operation)` throws a clear error →
  becomes that module's error → FAILED.
- **http.make_request params:** `{ method, url, headers?, body?, query? }`.
  Non-2xx is NOT an error (return the statusCode); only network/parse failures
  throw. Returns a single-element `Bundle[]`.
- **core.sleep:** clamp `seconds` to a sane max (e.g. 300) to avoid test hangs.

## Acceptance criteria (must all pass)

1. `runScenario` runs the 3-module sample (webhook → http → sleep) and returns
   `SUCCESS` with three step results in order, `operations` counted correctly.
2. **Fan-out works:** given a stub search module that returns 3 bundles, the
   downstream module runs 3 times and `operations` reflects it. (Add a test-only
   stub module to prove the multiplexing — this guards the whole bundle model.)
3. Trigger bundles are available as module `1`'s output.
4. If `http.make_request` targets an unreachable host, execution is `FAILED`, the
   http step is `error`, the sleep step is absent, the webhook step is `success`.
5. Unknown `app`/`operation` → `FAILED` with a clear message.
6. `core.sleep` actually waits ~`seconds` (assert elapsed within tolerance).
7. Engine has **zero** imports from NestJS / Prisma / BullMQ.
8. `pnpm --filter engine test` green, covering the walker + multiplexing.

## Suggested tests

- `modules.test.ts`: each built-in in isolation (mock fetch for http).
- `engine.test.ts`: happy path; **fan-out (3 bundles → 3 downstream runs)**;
  operations counting; error-stops-walk; unknown-op; sleep timing;
  trigger-bundles-available.

## When done

1. Commit.
2. Write a 5-line summary: the registry shape, how bundle multiplexing works, and
   the exact seam where Phase 2's app framework replaces the hardcoded registry.
3. **Stop.** Do not start Phase 2 until told.

---

### Sample blueprint for the CLI runner (`run.ts`)

```json
{
  "modules": [
    { "id": "1", "app": "webhook", "operation": "custom_webhook", "kind": "trigger", "params": {}, "next": "2" },
    { "id": "2", "app": "http", "operation": "make_request", "kind": "action",
      "params": { "method": "GET", "url": "https://httpbin.org/get" }, "next": "3" },
    { "id": "3", "app": "core", "operation": "sleep", "kind": "action",
      "params": { "seconds": 1 }, "next": null }
  ]
}
```

Sample trigger bundles: `[ { "body": { "email": "test@cyfrow.com" } } ]`
