# Known Issues — Cyflow Social

Each issue is tracked with the fields below. Statuses: `open`, `in_progress`,
`mitigated`, `resolved`. No secrets. Dates are illustrative of order, not exact.

---

## CY-001 — Seven-day automation produced only two posts
- **Status:** in_progress (diagnostics being added to confirm the cause)
- **Severity:** high
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
- **Confirmed cause:** NOT YET CONFIRMED. Requires the new diagnostics
  (expected vs created vs claimed vs completed vs failed) reproduced on
  disposable MariaDB.
- **Fix commit:** pending.
- **Verification evidence:** pending (reproduction + diagnostics).

## CY-002 — HCTI / image-render errors were invisible ("No image" with no reason)
- **Status:** mitigated (backend + board + integration done; browser E2E pending)
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
  disposable-MariaDB + browser E2E PENDING (Docker outage).

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

## CY-006 — retry browser smoke stale status-badge selector
- **Status:** open (pre-existing, unrelated)
- **Severity:** low
- **Cause:** `tools/retry-smoke.mjs` reads a `.badge` for "Generation failed";
  the board renders that status differently. Fails identically on clean HEAD.
- **Fix:** align the smoke selector (or the board) — tracked as a separate task.
