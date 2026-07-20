# Architecture & Product Decisions — Cyflow Social

Durable decisions and their rationale. Newest first is not required; group by
theme. No secrets.

## Make.com is a reference, not a runtime dependency
The Make "Daily Content Generator" scenarios define the proven rhythm, the seven
poster compositions, and the day-type → template mapping. Cyflow reimplements
that NATIVELY. There is no live Make call, webhook, data store, or blueprint at
runtime. Raw blueprints are never committed; only extracted, redacted references
under `design-references/make-scenario/`.

## Exact account targeting is mandatory
One selected account produces exactly one queue target. The queue is driven by
the STORED selection (`resolveRunTargetAccounts`), never by "every active account
whose type matches the platform". An account the user did not select has no path
into the result. A disconnected selected account BLOCKS the queue rather than
falling back to others. Enforced by `tests/queueTargetFanOut.test.js`.

## Live publishing remains disabled
`ENABLE_LIVE_PROVIDER_PUBLISHING=false` is the required initial state. Publishing
adapters exist and are flag-gated; they have never been live-verified
(`fake_provider_verified`). No real Facebook/Instagram/Threads call is made while
the flag is false, and automated tests never hit a real provider.

## No invented facts
Generated copy never invents statistics, prices, guarantees or results. A stat/
proof card with no approved numeric fact renders the proof/evidence version, not
a fabricated number. No em dashes or en dashes in generated copy.

## Fake reviews are prohibited; the Friday testimonial needs a real stored review
The testimonial slot is built from the workspace's OWN stored review (quote +
author), never a model-invented one. With no real review, the slot falls back to
a maintenance/other composition rather than fabricating a testimonial.

## The fixed Make contact footer is allowed; boilerplate is excluded from editorial similarity
The Make contractor scenarios end every post with the same phone/email/website
footer — that is intentional brand boilerplate. The duplicate detector strips
this footer (and de-weights the fixed CTA/hashtags) for the EDITORIAL similarity
comparison, so seven different-service posts are not flagged as one repeat. The
FULL caption still participates in exact-duplicate detection, so a byte-identical
repeat is still caught.

## One normalized provider-error model
Every external provider (OpenAI, HCTI, Facebook, Instagram, Threads) and the
background systems fold their failures into ONE safe vocabulary
(`PROVIDER_ERROR_CATEGORY`) via `normalizeProviderError`. The specific category
(credits_exhausted, authentication_failed, rate_limited, network_timeout,
media_persistence_failed, …) is PRESERVED — a failure is never collapsed into a
generic code or a silent null. HCTI 402 specifically means out-of-credits, so it
maps to `credits_exhausted`, not the generic `payment_required`.

## Image state is a first-class, queryable, safe column
A planner item's image lifecycle (`not_requested|queued|rendering|retrying|
ready|failed`) and its normalized failure live in real `planner_run_items`
columns (migration 018), not buried in a JSON blob. The board reads them to show
the reason; retry re-renders WITHOUT touching the approved caption.

## Only external network boundaries are mocked in integration tests
Integration tests run the REAL refill/worker/planner/image/media/board against a
disposable MariaDB. Only OpenAI, HCTI, and the publish providers are mocked, at
the network boundary. No real provider call, ever.

## Migrations are additive and manually applied
`database/migrations/NNN_*.sql`, additive only (no DROP/MODIFY/RENAME), applied
in order by an operator (no runner, no `schema_migrations` table).
`database/schema.sql` is the full snapshot and must stay in parity
(`npm run migrate:check`). Every migration ships with a `tests/migrationNNN.test.js`.

## Secrets never touch logs, memory files, or safe columns
Credentials are AES-256-GCM envelopes in `user_integrations`. A masked last-4 is
derived on READ (there is no stored fingerprint column). Structured logs and the
image/health columns carry only categories, safe messages, status codes and
timestamps. The redactor strips secret-ish keys at any depth.
