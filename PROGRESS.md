# Cyflow Social — milestone progress

An honest, append-only log of the production build, most recent first. Each
milestone is one complete, tested, committed increment. No post has been sent to a
live social provider yet: D2's real publishing adapters exist but are gated OFF by
default (`ENABLE_LIVE_PROVIDER_PUBLISHING=false`) and have only ever run against
fake providers.

## Milestone D2 — Meta publishing adapters, retries and reconciliation

**Branch:** `cyflow-social-v1` · **Migration:** `015_provider_publishing_and_reconciliation.sql`
(apply after 010 → 011 → 012 → 013 → 014)

- Real publishing adapters for the three supported providers ONLY — Facebook Pages
  (`/feed` or `/photos`), Instagram Professional (`/media` → `/media_publish`
  container flow, image required), and Threads (`/threads` → `/threads_publish`).
  No LinkedIn, TikTok, X, Pinterest, YouTube, or personal profiles. One capability
  registry drives generation, approval, queue readiness, publishing and failure
  copy so the UI can never drift from what the adapters actually support.
- Live provider calls are gated behind `ENABLE_LIVE_PROVIDER_PUBLISHING` (default
  **false**). While off, the scheduler enqueues no publish jobs and a publish job
  is a no-op that marks the target "attention needed — live publishing disabled";
  ZERO provider calls. The Queue and `/health` report this honestly. **Nothing has
  been verified against a real account** — real publishing also needs Meta app
  review for the publishing permissions.
- Each selected account is an independent target with its own publish state
  (draft → scheduled → publishing → submitted → reconciling → published, or
  retry_scheduled / failed / cancelled / attention_needed). Preflight checks
  ownership, an active account, the capability (Instagram needs media), and a
  present, decryptable token BEFORE any provider call. The access token is sent
  only as an `Authorization: Bearer` header, never in a URL, and dropped from
  memory right after the call.
- Idempotent and reconcilable: a `publish_attempts` ledger (safe fields only — no
  token, no raw payload) with a unique idempotency key means a duplicated tick,
  double click, or two workers produce exactly one provider call; a known
  `provider_post_id` blocks resubmission. An uncertain result (async container or a
  network timeout) moves the target to `reconciling` and schedules a reconcile
  job — never a blind republish. Reconciliation resolves to published (no
  duplicate), fails on a real permanent failure, or gives up after the cap and
  asks for human attention.
- Honest partial success: if Instagram publishes and Threads fails, Instagram is
  `published`, Threads is `failed`, and the post rolls up to `partial`. One target
  succeeding never hides another failing. The Queue shows per-target status with
  retry/cancel and a safe attempt history (no token or raw provider body).
- New env (all optional, defaults): `ENABLE_LIVE_PROVIDER_PUBLISHING` (false),
  `PUBLISH_RECONCILE_DELAY_SECONDS` (60), `PUBLISH_MAX_RECONCILE_ATTEMPTS` (8),
  `PUBLISH_REQUEST_TIMEOUT_MS` (30000). Migration 015 is additive (new
  `publish_attempts` table + three nullable `scheduled_post_targets` columns + one
  index); 010–014 unchanged.
- 1005 tests pass; `npm audit` 0 (all + prod). D2 publish browser smoke 18/18
  (fake providers) plus all seven prior smokes green. Idempotency, ownership and
  reconciliation guards were revert-verified (broken → test fails → restored).

## Milestone D1 — always-on automation, rolling buffer and durable jobs

**Branch:** `cyflow-social-v1` · **Migration:** `014_automation_buffer_and_durable_jobs.sql`
(apply after 010 → 011 → 012 → 013)

- A content automation prepares a rolling buffer of future posts automatically:
  configure platforms, exact accounts, timezone, weekdays, local times and a
  rhythm once (indefinite or with an end date), and background workers keep the
  buffer topped up while the browser is closed. It PREPARES AND QUEUES ONLY — no
  real Facebook/Instagram/Threads publishing (that is D2).
- A DATABASE-BACKED durable job system: atomic claim (`SELECT ... FOR UPDATE` +
  guarded update), per-job leases with heartbeat, deterministic idempotency keys
  (a duplicate tick / click / worker restart creates no duplicate slot, post, or
  provider call), exponential backoff + jitter, transient-vs-permanent failure
  classification, and stale-lock recovery. `worker_leases` for singleton
  coordination.
- Rolling buffer defaults: generate 14 days ahead, keep 7 ready, warn below 3.
  Slot times are computed DST-safely (Asia/Karachi and America/New_York verified,
  spring-forward and fall-back). Selected platforms/accounts are authoritative —
  a Facebook account can never join an Instagram+Threads automation. Editing
  future settings never rewrites already-prepared items (immutable snapshot).
- Lifecycle: draft → active → paused/attention_needed → stopped, with validated
  transitions. Pause/stop cancel pending jobs and consume zero provider usage;
  stop keeps prepared history. A permanent failure (missing OpenAI key) sets
  attention_needed and stops retrying; a recovered slot self-heals to active.
- Reuses the planner for slot generation and the Weekly Board for review; the
  automation owns a hidden backing planner_run. New `/automations` page + create
  wizard (exact confirmation, never auto-selects all accounts) + real Dashboard
  roll-up (no fabricated reach/engagement). Worker commands `scheduler:once` /
  `worker` / `worker:once` with graceful shutdown; `/health` reports the job
  queue without asserting the worker is alive.
- New env (all optional, defaults): `WORKER_CONCURRENCY`, `WORKER_LEASE_SECONDS`,
  `WORKER_HEARTBEAT_SECONDS`, `WORKER_POLL_SECONDS`, `WORKER_MAX_ATTEMPTS`,
  `WORKER_BASE_RETRY_SECONDS`, `WORKER_MAX_RETRY_SECONDS`,
  `AUTOMATION_REFILL_INTERVAL_HOURS`. Only new dependency: none.

## Milestone C3 — secure media uploads and asset library

**Branch:** `cyflow-social-v1` · **Migration:** `013_secure_media_library.sql`
(apply after 010 → 011 → 012)

- Businesses upload their own JPEG/PNG/WebP images and reuse them across posts, a
  Media library at `/media`, and a shared picker on Create Post and the Weekly
  Board drawer. Uploaded media works with no OpenAI or HCTI.
- Uploads are verified from the bytes (magic number, real dimensions, pixel cap,
  byte ceiling, SHA-256). GIF/SVG/BMP/TIFF/PDF/archive/animated-PNG/animated-WebP
  /polyglot/corrupt files are refused with specific reasons. Dependency-free —
  verification, not processing.
- One storage abstraction with a local-filesystem adapter (S3-shaped for later).
  Bytes live under `MEDIA_STORAGE_PATH` outside the app source, under a
  server-generated random key, with two independent path-traversal guards. Bytes
  leave only through the ownership-checked token route (`nosniff`, `inline`).
- Ownership enforced at the service: cross-user requests are *not found* and make
  zero changes. User-scoped dedup never reveals another user's uploads. An in-use
  asset cannot be deleted silently; the error says how many posts use it without
  exposing a private id. References are a bounded polymorphic table
  (`media_asset_references`: `planner_run_item`, `scheduled_post`).
- New env: `MEDIA_STORAGE_DRIVER`, `MEDIA_STORAGE_PATH`, `MAX_MEDIA_UPLOAD_BYTES`.
  See the README's "Media storage configuration" for operations, including the
  read-only orphan reconciliation command `node tools/media-orphans.mjs`.
- Only new dependency: `multer` (memory storage, single image field, size limit),
  used purely to parse the multipart body; every real check runs on the bytes.

## Milestone C2 — platform-specific post editors and revision history

**Migration:** `012_platform_post_revisions.sql`

- Canonical per-platform copy (`platform_captions_json`) with a shared editor
  across Create Post and the Weekly Board; manual per-platform edits are
  preserved through regeneration, with a revision history and restore.

## Milestone C1 — per-user OpenAI credentials

**Migration:** `011_customer_openai_credentials.sql`

- Each user supplies and manages their own encrypted OpenAI credentials; the
  global key fallback was removed so generation always runs against the acting
  user's own key.
