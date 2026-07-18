# Cyflow Social — milestone progress

An honest, append-only log of the production build, most recent first. Each
milestone is one complete, tested, committed increment. No post has been sent to a
live social provider yet: the real publishing adapters exist but are gated OFF by
default (`ENABLE_LIVE_PROVIDER_PUBLISHING=false`) and have only ever run against
fake providers.

## Milestone F2 — premium authenticated app redesign

**Branch:** `cyflow-social-v1` · **No migration** (presentation only; 010–017 unchanged)

- Every authenticated route and the shared shell now read as one product. The work
  was done in the shared primitives first, so all fourteen routes inherit it: a
  semantic token layer over the brand palette, cards that separate by border rather
  than by shadow, and one declared height for every input and select.
- **One status control.** There were two: a badge-based chip in the planner and a
  dot-chip in the queue, so "Queued" looked like two different states depending on
  where you stood. Both now come from a single renderer with a single label map,
  and the raw enums that used to leak through it (`needs_review`,
  `generation_failed`, `partially_queued`, plain `review`) are gone from the UI.
- **Honest surfaces.** A media asset that cannot load degrades to a labelled
  placeholder instead of a black rectangle; the media library says "Generated"
  rather than naming the rendering vendor; the dashboard names capabilities
  ("AI writing help", "Branded image rendering") rather than the API behind them.
  Vendor names remain on `/integrations`, where the keys are actually entered.
- Fixed by rendering, not by reading: link-buttons were underlined app-wide; the
  queue drew a bordered row inside an identically bordered card; the queue's filter
  strip overflowed 112px at 390px; list actions crushed titles into three-line wraps
  on mobile; timestamps printed to the second in an ambiguous locale order; a form
  row lost its shared baseline because a stacked-rhythm rule also applied to grid
  columns; a `select` sat 2px taller than the `input` beside it.
- 1052 tests pass; `npm audit` 0 (all + prod). New app-redesign browser smoke 24/24.
  Existing smokes re-run green: milestone-c 44/44, public 38/38, media 20/20,
  create 18/18, publish 18/18, automation 19/19, account 11/11. Rendered and
  inspected at 1440x900, 1280x800, 1024x768, 390x844 and 360x800.

## Milestone G — data export, account deletion, release readiness

**Branch:** `cyflow-social-v1` · **Migration:** `017_user_data_export_and_deletion.sql`
(apply after 010 → … → 016)

- **Export your data**: request a copy from Settings; a durable background job builds
  a JSON archive of your own data and you download it from a session-gated route (no
  token in the URL). The archive contains only safe, sanitized data — your password,
  encrypted OpenAI/HCTI keys, social tokens, storage keys and raw provider responses
  are never included. Rate-limited, with a 24-hour expiry.
- **Delete your account**: gated by your current password plus a typed confirmation.
  A durable job cancels pending work, erases your credentials and tokens, deletes
  your account (the database removes your owned rows by cascade; audit logs are
  anonymized), and unlinks your media files. It is idempotent and crash-safe, and a
  deleted account can no longer sign in. Posts already published to a provider may
  remain on that platform — the UI says so honestly.
- Migration 017 is additive (`user_data_exports` with a hashed token + private
  storage key + expiry; `account_deletion_requests` with an opaque receipt code);
  010–016 unchanged.
- 1052 tests pass; `npm audit` 0 (all + prod). Account export/deletion browser smoke
  11/11; create, D2 and automation smokes still green. The deletion password gate was
  revert-verified. Release-readiness runbooks (export, deletion, staging, production,
  rollback, secret rotation, data inventory) are prepared as gitignored working docs.

## Milestone F — public website + premium design system

**Branch:** `cyflow-social-v1` · **No migration** (design + content only)

- A public marketing website: `/`, `/features`, `/how-it-works`, `/security`,
  `/about`, `/contact`, `/privacy`, `/terms` — a public layout with its own header
  and footer, one `marketing.js` module, and per-route titles + meta descriptions.
  `robots.txt` keeps every authenticated route and `/api/` out of the index.
- Honest content only: the three supported platforms, no testimonials, customer
  counts, ratings, guarantees or certifications (the Security page disclaims SOC 2
  / ISO / HIPAA / PCI). Publishing is described as depending on your connected Meta
  accounts and approved permissions. Contact does not fake a form; Privacy and
  Terms are marked drafts pending legal review, with no invented legal entity.
- The public site is built on a design-system extension that reuses the app's ink
  and brand tokens, so the two surfaces feel like one product. The authenticated
  app's per-page visual overhaul is deliberately deferred (it needs a rendered
  review of each screen); nothing in the app was regressed.
- The auth boundary holds: public routes need no login; app routes still redirect
  to `/login` when signed out.
- 1036 tests pass; `npm audit` 0 (all + prod). Public-site browser smoke 38/38
  (render, no overflow at 1440/390px, nav, auth boundary, zero console errors),
  screenshots reviewed. Create, D2 and Milestone-C smokes still green.

## Milestone E — manual Create Post workspace

**Branch:** `cyflow-social-v1` · **Migration:** `016_manual_publish_workspace.sql`
(apply after 010 → … → 015)

- `/create` is now a full manual workspace: pick exact platforms + accounts, write
  and edit copy independently per platform, choose media, then Save Draft, Schedule
  Later, or Publish Now. The browser never calls a provider; Publish Now enqueues
  durable D2 jobs and returns an honest queued state.
- Save Draft persists brief + hand-edited per-platform copy in one versioned write.
  Editing one platform never changes a sibling (copied byte-for-byte). An identical
  re-save is a no-op. Optimistic concurrency (`draft_version`): a stale save from a
  second tab is rejected with a conflict, never a silent overwrite.
- One readiness engine (`publishReadiness.js`) decides per-target readiness (active
  account, post copy, required image, hard caption limit, editable lifecycle) and is
  reused by Schedule, Publish Now and a `/readiness` endpoint. Word-band guidance is
  an advisory warning, not a hard block.
- Schedule Later stores the exact local date/time + a DST-correct UTC instant +
  origin. Publish Now queues immediately and enqueues one durable job per ready
  target, idempotently (repeated clicks make one job per target); jobs respect the
  live-publishing flag, holding as attention-needed when it is off.
- Migration 016 is additive (post_origin, draft_version, scheduled_local_date/time,
  last_manual_edit_at + index on scheduled_posts); 010–015 unchanged. Manual-post
  history is recorded in activity_logs (the revision table is planner-scoped).
- 1029 tests pass; `npm audit` 0 (all + prod). Create-workspace browser smoke 18/18
  (fake providers); D2 and Milestone-C smokes still green. Idempotency, stale-write,
  ownership and direct-provider-call prevention were revert-verified.

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
