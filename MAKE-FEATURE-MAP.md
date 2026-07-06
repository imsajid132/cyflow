# MAKE-FEATURE-MAP.md — Cyflow

The checklist that keeps Cyflow a **faithful Make.com clone** and not a generic
automation tool. Every feature below maps to a phase. When implementing a phase,
match Make's *behaviour and vocabulary*, not just the rough idea.

Legend: ⭐ = defines Make's identity (get these right or it won't feel like Make).

---

## Core execution

| Feature | What Make does | Phase | Notes |
|---|---|---|---|
| ⭐ Bundle-based execution | A module emits bundles; next module runs once per bundle | 1 | Engine built on `Bundle[]`. See ARCHITECTURE §2. |
| ⭐ Operations counting | 1 module × 1 bundle = 1 operation (billing unit) | 1 | Count from day one; display later. |
| Cycles | Each trigger bundle starts a cycle through the chain | 1 | |
| Scenario blueprint | The chain stored as structured data | 1 | JSON blueprint. |
| Scheduling | "Every 15 min", "at time", or instant (webhook) | 3 | BullMQ repeatable jobs. |
| Sequential processing | Modules run left-to-right in order | 1 | |
| Max operations / timeout guards | Scenario limits | 3 | Safety caps. |

## Data flow & mapping

| Feature | What Make does | Phase | Notes |
|---|---|---|---|
| ⭐ Mapping `{{...}}` | Reference earlier modules' output | 4 | `{{1.body.email}}` |
| ⭐ Functions | `formatDate`, `map`, `get`, `if`, string/date/math/array | 4 | Whitelisted table, NOT eval. |
| Data types | text, number, date, boolean, array, collection | 4 | Type-aware mapping. |
| Mapping picker UI | Click a field to insert its token | 6 | Signature Make UX. |

## Flow control ⭐ (needs the bundle model)

| Feature | What Make does | Phase | Notes |
|---|---|---|---|
| ⭐ Iterator | Splits one bundle's array into many bundles | 5 | Downstream runs per element. |
| ⭐ Array Aggregator | Collapses many bundles into one array bundle | 5 | The "sink" that ends the fan-out. |
| Text Aggregator | Joins many bundles into one string | 5 | |
| Numeric Aggregator | Sum/avg/etc. across bundles | 5 | |
| ⭐ Router | Splits flow into multiple routes | 8 | Upgrades `next` → routes. |
| ⭐ Filters | Condition on a link; only pass matching bundles | 5 | Between two modules. |
| Fallback route | Router's default path | 8 | |

## Connectors & auth

| Feature | What Make does | Phase | Notes |
|---|---|---|---|
| ⭐ App framework | Standard shape for every integration | 2 | See ARCHITECTURE §5. |
| ⭐ Connections (BYO API) | Each user connects their own accounts | 7 | Platform pays nothing for user API usage. |
| API-key auth | Paste a token | 7 | No platform setup. |
| OAuth2 auth | "Connect" → authorise → tokens stored | 7 | One dev app per provider. |
| Encrypted vault | Secrets encrypted at rest | 7 | AES-256-GCM. |
| Webhook triggers | Instant, per-scenario URL | 3 | `POST /hooks/:id` |
| Polling triggers | "Watch new X" with a cursor | 3 | Dedupe on cursor. |
| Actions / Searches | Do a thing / return many bundles | 2 | Search returns `Bundle[]`. |

## Error handling ⭐

| Feature | What Make does | Phase | Notes |
|---|---|---|---|
| Error handler routes | Attach a handler to a module | 8 | |
| Resume | Substitute output, continue | 8 | |
| Rollback | Undo & stop | 8 | |
| Commit | Stop & commit done work | 8 | |
| Break | Store incomplete run, retry later | 8 | |
| Ignore | Skip the failed bundle | 8 | |
| Auto-retry / backoff | Retry failed executions | 3 | BullMQ attempts. |

## Builder UI ⭐

| Feature | What Make does | Phase | Notes |
|---|---|---|---|
| ⭐ Bubble canvas | Left-to-right circular module bubbles, curved links | 6 | Customise React Flow. |
| App icons in bubbles | Each module shows its app icon | 6 | |
| Right-panel config | Form per module | 6 | Schema-driven from Zod. |
| ⭐ "Run once" replay | Click a bubble → inspect its bundles one-by-one | 6 | Make's key debugging feel. |
| Scenario list / folders | Manage scenarios | 6 | |
| Execution history | Past runs + status + ops used | 6 | |

## Extras (later)

| Feature | What Make does | Phase | Notes |
|---|---|---|---|
| Data stores | Built-in mini-database | 8 | Key-value / structured tables. |
| Data structures | Reusable schemas | 9 | |
| Webhooks (custom) | Advanced webhook parsing | 3 | |
| Templates | Pre-built scenarios | 9 | |
| Teams / roles | Multi-user orgs | 9 | After single-user is solid. |
| Scenario versioning | Blueprint history | 9 | |

---

## Priority order (what actually makes it "feel like Make")

If you build only these first, it already reads as Make:

1. **Bundle-based engine + operations** (Phase 1)
2. **App framework** (Phase 2)
3. **Mapping + functions** (Phase 4)
4. **Iterator + Aggregator + Filters** (Phase 5)
5. **Bubble canvas + "run once" replay** (Phase 6)
6. **Connections / BYO auth** (Phase 7)

Routers, error-handler routes, and data stores (Phase 8) complete the picture.
Everything else is breadth, not identity.

## Explicit n8n-vs-Make traps to avoid

- Do **not** build a free-form node graph as the primary model — Make is a
  chain with routers. (Router branches, not arbitrary edges.)
- Do **not** use the "one item = one execution path" n8n item model. Make's
  bundle multiplexing (iterator/aggregator) is different — honour it.
- Do **not** skip operations counting — it's core to Make's mental model.
- Match Make's **words** in the UI and code: Scenario, Module, Bundle,
  Operation, Connection, Router, Iterator, Aggregator.
