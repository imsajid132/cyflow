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

## CY-007 — Production database was a version behind the code (week stuck at 0/7)
- **Status:** resolved (schema applied 2026-07-28; awaiting the owner's first
  successful week on the live host as final confirmation)
- **Severity:** critical — every AI Studio week failed, silently from outside
- **Cause:** migration 018 had never been applied to the Hostinger database. The
  code reads the nine `image_*` columns on every planner-item read, so all seven
  post jobs per week failed with `Unknown column 'image_status' in 'SELECT'` and
  retried to exhaustion. 77 failed jobs accumulated. The code was correct and the
  database was a version behind — the class of failure the deployment checklist
  exists to prevent.
- **How it was diagnosed from outside:** `/health` → `aiStudio.jobs.failed` and
  `aiStudio.lastFailure` (added the same day, precisely because "a week stuck at
  0/7" said nothing). Without those two fields this was invisible behind a login.
- **Fix:** `database/repair/018_provider_error_visibility_safe_rerun.sql` — the
  same change with `IF NOT EXISTS` on every step, safe on a database in any
  state.
- **Second trap, worth remembering:** the repair script originally verified
  itself with `information_schema` queries, which a shared-hosting database user
  is not granted. It failed with `#1044 Access denied` AFTER the `ALTER`s, so the
  error read as "the migration failed" when it had not yet run at all. Verify
  with `SHOW COLUMNS`, which needs no special privilege.
- **Prevention:** `/health` now reports job counts and the last failure category
  for the studio; check it after every deploy that ships a migration.

## CY-008 — Three integration tests expired when the calendar passed their dates
- **Status:** resolved
- **Severity:** medium — they failed for a reason unrelated to the code, and the
  failure impersonated a duplicate-prevention bug
- **Cause:** `tests/integration/releaseJourney.integration.test.js` seeded review
  items at two fixed instants in July 2026. Queueing correctly refuses a slot
  whose time has passed, so from 2026-07-27 onward nothing was queued and three
  assertions read as "the queue produced no post".
- **Fix:** the seed is now relative to now (7 and 14 days out). The two tests
  that assert calendar dates pass their own fixed instants, because a named date
  is the point of those.
- **Rule this leaves behind:** a test that expires is worse than no test —
  someone eventually "fixes" it by weakening the guard it was written to protect.

## CY-009 — A poster with no photograph said nothing about why
- **Status:** resolved
- **Severity:** medium — invisible, and the exact thing the owner was judging
- **Cause:** `fetchPosterPhoto` returned a bare `null` for every refusal, so a
  poster built without a picture looked identical to one that was never meant to
  have one. When the owner asked why their photographs were not appearing, there
  was no answer anywhere: not on the card, not in the row, not in a log. This is
  the same class as turning a provider failure into a silent `null`, which the
  permanent rules forbid.
- **Fix:** every refusal now carries a reason (`no_picture`, `unreachable`,
  `blocked`, `too_large`, `unsupported_format`), it is stored on the item, and
  the card says it in words the owner can act on.
- **What a reason actually tells you:** `unsupported_format` is the common one
  and a genuine dead end — resvg draws neither WebP nor AVIF (verified: both
  render as nothing), so only JPEG and PNG can go on a poster.

## CY-010 — A ticked logo could be stretched across a poster background
- **Status:** resolved
- **Severity:** medium
- **Cause:** the analyze step classifies each picture (`photo` / `logo` /
  `icon`), and the poster builder only uses photographs — but the studio's
  `startWeek` controller dropped `kind` when it copied the images onto the run.
  With no kind, the builder treats a picture as a photograph, so a logo the user
  had ticked in the image library was eligible to become a full-bleed poster
  background.
- **Fix:** `kind` travels with the picture, defaulting to `photo` only when the
  reader genuinely did not say.

## CY-011 — Connecting an account failed three different ways, and the app said nothing
- **Status:** partly resolved (the app now warns; the underlying causes are Meta's)
- **Severity:** high for a product other people are meant to use — every one of
  these ends with the user stranded outside this application
- **What the owner hit,** on a brand-new account, with all three set up in Meta
  Developers:
  1. **Facebook: "App not active."** The app is in Development mode on Meta, and
     in that mode only people with a ROLE on the app (admin / developer /
     tester) may grant permissions. The new account had none, so Meta refused on
     its own page. Nothing reached this application.
  2. **Threads: the app opens and nothing happens.** On a phone,
     `threads.net/oauth/authorize` is intercepted by the installed Threads app,
     which does not handle OAuth and simply shows the feed.
  3. **Instagram: the Allow screen appeared** — that configuration is working.
- **Nothing here is a defect in this codebase.** The scopes, the authorize URLs
  and the callback are correct; verified against
  `src/config/constants.js` OAUTH_SCOPES and `src/providers/threadsProvider.js`.
- **Fix applied:** each provider card now says what to know BEFORE the button,
  shown only until that provider has its first connected account. A warning that
  never goes away is one people stop reading.
- **The real fixes, which are Meta's:**
  - Today, without App Review: add each user under App roles → Roles → Tester,
    and have them accept the invite. This works and is how to onboard a handful
    of people.
  - For strangers: App Review + Live mode. Weeks, and Meta's decision.
