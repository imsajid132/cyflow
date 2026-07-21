# Known Issues — Cyflow Social

Each issue is tracked with the fields below. Statuses: `open`, `in_progress`,
`mitigated`, `resolved`. No secrets. Dates are illustrative of order, not exact.

---

## CY-001 — Seven-day automation produced only two posts
- **Status:** resolved (CONFIRMED worker-lag by a dedicated disposable-MariaDB reproduction; diagnostics + banner make the cause self-evident)
- **Severity:** medium
- **First observed:** Hostinger "NYC Waterproofing Release Acceptance"
- **Last reproduced:** same run (Weekly Board showed Jul 26–27 only)
- **Affected commit:** `ab83981` (as deployed; deployed commit unverified)
- **Reproduction:** Facebook-only automation, 1 account, Asia/Karachi, Mon–Sun,
  1/day, generate-ahead 7, review mode. Board shows 2 posts, not 7.
- **Expected:** 7 reviewable posts across 7 active days.
- **Actual:** 2 posts.
- **Suspected cause:** the bounded 60s worker drain in
  `HOSTINGER_SINGLE_PROCESS_JOBS` mode — refill enqueues ~7 slot jobs but only a
  few complete per tick, so at check time only 2 were `ready` (the rest pending).
  Alternative: a refill horizon/weekday accounting shortfall
  (`automationService.runRefillJob` applies the horizon in CALENDAR days).
- **Confirmed cause:** WORKER LAG under the bounded single-process drain — NOT a
  generation cap. `tests/integration/reproduction2of7.integration.test.js` drives
  the real pipeline on disposable MariaDB and proves: the refill creates SEVEN
  slots + SEVEN generate jobs (expected 7, created 7, skippedPast 1); a bounded
  drain completes only 2, leaving 5 pending; the card diagnostics read
  {expected 7, ready 2, pending 5, failed 0, reason "preparing"}; a full drain
  reaches 7 ready / 7 items / 0 failed / 7 images / reason "ok".
- **Fix commit:** the observability milestone (refill diagnostics + the board
  banner "Only N of M expected posts are prepared" distinguishing worker-lag from
  a true shortfall) plus this session's banner correction (the headline counts
  READY, not ready+pending, and surfaces the skipped past/duplicate count).
- **Verification evidence:** `reproduction2of7.integration.test.js` (job/slot/
  item matrix), `automationService.buildDiagnostics`, and the browser banner
  acceptance `tools/automation-diagnostics-smoke.mjs` (preparing/failures/
  shortfall+skipped, no internal ids, survives refresh).

## CY-002 — HCTI / image-render errors were invisible ("No image" with no reason)
- **Status:** resolved (backend + board + integration + browser E2E all green)
- **Severity:** high
- **First observed:** same acceptance run (both cards "No image")
- **Last reproduced:** pre-fix
- **Affected commit:** `ab83981`
- **Reproduction:** an HCTI failure (any of credentials/credits/quota/rate/
  timeout/render/media) during planner image render.
- **Expected:** the board shows the specific, safe reason and offers Retry.
- **Actual (before):** a bare "No image"; Runtime Logs showed Errors: 0.
- **Suspected cause:** `socialImageService` collapsed every HCTI status into a
  generic `image_generation_failed`; `plannerService` read `err.code`
  (`EXTERNAL_SERVICE_ERROR`), not the classification; the client never read the
  status; no activity-log event, no queryable column.
- **Confirmed cause:** same (verified by reading the code + tests).
- **Fix commit:** pending (this milestone). Normalized ProviderError preserved
  end to end; migration 018 image_* columns; board/drawer render the reason;
  Retry image (caption-safe); safe structured logging.
- **Verification evidence:** unit tests green
  (`providerErrors`, `hctiService`, `socialImageService`, `migration018`);
  disposable-MariaDB integration green (`automationParity` image cases); and the
  10-scenario authenticated browser E2E `tools/provider-error-e2e-smoke.mjs`
  (HCTI 401/402/403/429/timeout/render, media persistence, OpenAI 401/429/
  invalid-JSON) — each proves the safe category, provider, retryable flag,
  recommended action, no secret/DB-id/raw-body, no bare "No image", Retry-image
  caption byte-identical, and Exact-Make parity not flipped to generic.

## CY-003 — Recent-content similarity warnings on every post
- **Status:** resolved (prior milestone `ab83981`) — monitor
- **Severity:** medium
- **Suspected/confirmed cause:** the shared Make contact footer + fixed CTA/
  hashtags were compared as content; failed/rejected staging debris poisoned
  history.
- **Fix commit:** `ab83981` (editorial fingerprint excluding boilerplate;
  history scoped by content status).
- **Verification evidence:** `contentUniquenessService.test.js`,
  `automationParity.integration.test.js`.
- **Note:** confirm no recurrence in the CY-001/CY-002 reproduction.

## CY-004 — Possible old staging-history contamination
- **Status:** mitigated (prior milestone) — verify in reproduction
- **Severity:** medium
- **Cause:** old failed/rejected items counted as history for similarity.
- **Fix:** `listRecentFingerprintsForUser` excludes `generation_failed` and
  `rejected`; a stopped automation's approved/queued post still counts.
- **Verification:** the reproduction should seed old debris and prove a fresh
  batch is clean.

## CY-005 — Local acceptance vs Hostinger acceptance mismatch
- **Status:** open (process)
- **Severity:** medium
- **Cause:** local runs used a full worker drain; Hostinger managed mode uses a
  bounded 60s drain and single process, so timing differs (relevant to CY-001).
  The deployed commit is also unverified.
- **Fix:** the reproduction must use the single-process/bounded-drain shape, and
  the deployed commit must be confirmed from the host.
- **Verification:** pending.

## CY-006 — retry/repair browser smokes used a stale status-badge selector
- **Status:** resolved
- **Severity:** low
- **Cause:** the status label moved from a `.badge` to `statusChip` (class
  `.status`) in an intentional refactor; `tools/retry-smoke.mjs` and
  `tools/repair-smoke.mjs` still queried the old `.badge` (which now holds the
  pillar chips), so "Generation failed" was never found. The product was correct.
- **Fix:** the two smokes now read `.status`; `tools/platform-smoke.mjs` matches
  the intentional "Platform · Account" meta; `tools/public-smoke.mjs` waits long
  enough for the SPA route render. All 17 smokes green (480 checks, 0 fail).
