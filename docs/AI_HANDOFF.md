# AI Handoff — Cyflow Social

Written for another AI agent (Claude Code or ChatGPT) picking this up cold. Read
this, `PROJECT_MEMORY.md`, and `docs/KNOWN_ISSUES.md` first, then verify git
state. No secrets appear in this file.

## What the user is building
A native social-content engine ("Cyflow Social") that reproduces the rhythm of
the Make.com Daily Content Generator scenarios (Make is a reference, not a
runtime dependency) and produces reviewable weekly plans of Facebook / Instagram
/ Threads posts with branded 1080×1080 images. Human review before anything
publishes. Nothing publishes to a real provider yet.

## User's preferred workflow
- One branch: `cyflow-social-v1`. Push only there. Never deploy, merge, or open
  a PR unless explicitly told.
- Verify the REAL repo state and the REAL live evidence before trusting any
  prior "READY" report.
- Comprehensive, tested changes. Run the full unit suite, disposable-MariaDB
  integration tests, and authenticated browser smokes. Revert-verify important
  fixes (each fix must fail its focused test when reverted).
- Safety first: `ENABLE_LIVE_PROVIDER_PUBLISHING=false`, no live provider calls
  in tests (mock the network boundary only), no secrets in logs or docs, exact
  account targeting preserved.

## Current repository state
Branch `cyflow-social-v1`, HEAD `71921ce` + ONE final verification commit (this
session). Migration head `018_provider_error_visibility.sql`. Unit 1286/0,
disposable-MariaDB integration 46/0, all browser E2E green. The only production-
code change this session is the automations.js diagnostics banner (counts READY,
surfaces skipped); everything else is tests, the review harness, and docs.

## Last known deployed commit
UNKNOWN / unverified from this workspace. `deploy/RELEASE-CANDIDATE.md` is stale
(claims "not yet deployed" although live acceptance evidence exists). Confirm
from the Hostinger host before assuming.

## What has been completed
- The five NYC-Waterproofing staging defects (commit `ab83981`).
- Provider + background-job error visibility (this milestone):
  - `src/utils/providerErrors.js` — `ProviderError`, `normalizeProviderError`,
    `classifyHttpStatus` (incl. 402), safe per-provider messages, retryable
    classification, `toSafeJSON` (no secrets/cause/stack).
  - `src/utils/providerLog.js` — allow-listed structured stdout logging
    (`provider_operation_failed`, greppable, no secrets).
  - `src/config/constants.js` — `PROVIDER_ERROR_CATEGORY`,
    `RETRYABLE_PROVIDER_CATEGORIES`, `IMAGE_RENDER_STATUS`, `PROVIDER_NAMES`,
    new EVENT_TYPES.
  - `hctiService` throws normalized `ProviderError` (402 → credits_exhausted);
    `socialImageService` PRESERVES the category instead of collapsing.
  - Migration 018: queryable `planner_run_items.image_*` columns and
    `user_integrations.*_connection_label / *_last_* / *_last_error_category`.
  - `plannerService` renders with `renderItemImageWithStatus` (retry, normalize,
    persist safe status, log), `decorateItem` exposes a rich `image` object,
    Retry image re-renders WITHOUT touching the caption.
  - Board card + drawer render "Image failed / HCTI · <reason>" + Retry image.

## Phase A + B completed this milestone
- Phase A observability finished: integrations health backend + Test connection
  (with a billable-render WARNING before the HCTI test), editable connection
  label, automation refill diagnostics + a board banner ("Only N of M prepared"),
  and an authenticated browser E2E (`tools/error-visibility-smoke.mjs`, 14/14).
- Phase B EXACT MAKE PARITY hardening: the Make day-type `format` is now
  AUTHORITATIVE for the caption (plannerBriefService prefers `assignment.format`;
  the generic pillar/mix only fills — locked by tests). The workspace phone is
  rendered in planner poster footers. `tests/makeParityGolden.test.js` locks the
  measurable recipe (both weekday sequences, format<->concept<->layout, Friday
  gating, authoritative format aligned with the poster, 1080^2). A
  parity-under-HCTI-error integration test proves the recipe survives a provider
  error. Divergences (model version, Friday honesty, runtime platforms) are in
  PARITY-COMPARISON.md §5.

## What has been completed (final verification session)
- All 17 revert-verifications run: each production line reverted, its focused
  test proven RED, restored, proven GREEN (12 unit, 3 real-MariaDB, 2
  validator-teeth). Logged in docs/SESSION_CHECKPOINT.md.
- Every browser smoke re-run individually: 17/17 green (480 checks). Five had
  stale selectors/waits (statusChip refactor, "Platform · Account" meta, SPA
  render wait, --placeholder-media flag) — fixed in the tests/harness, not the
  product; each failure was reproduced on clean 71921ce first (CY-006).
- Dedicated 2-of-7 reproduction (CY-001) added and green: outcome A proven
  (7 slots + 7 jobs created; bounded drain completes 2; banner "preparing").
- All 10 provider-error browser E2E scenarios green (HCTI 401/402/403/429/
  timeout/render, media persistence, OpenAI 401/429/invalid-JSON).
- Automation-diagnostics banner acceptance green (preparing/failures/shortfall+
  skipped, no internal ids, survives refresh).
- Exact Make Parity acceptance re-run (golden + real): 152 assertions, 0 fail.
- Release gates: unit 1286/0, integration 46/0, migrate:check PASS, npm audit 0
  (all + --omit=dev), all scans clean, project:handoff OK.

## What remains unresolved (not blockers)
- CY-005 (process): the DEPLOYED commit is still unverified from the Hostinger
  host; the single next action is the redeploy + live acceptance below.
- Parity is rhythm/structure/format/poster/branding, NOT verbatim Make prompt
  persona text (a deliberate, documented divergence — PARITY-COMPARISON.md §5).

## Exact live reproduction (from the operator)
Automation "NYC Waterproofing Release Acceptance": Facebook only, one account
(NYC Waterproofing), Asia/Karachi, Mon–Sun, 1/day, generate-ahead 7, review
mode. Board showed only Jul 26–27 (2 posts), both Needs review, both "No image",
both correctly targeted, both with similarity warnings. Runtime Logs showed
Errors: 0, publish=disabled — i.e. the image/provider failure was invisible.

## Current evidence summary
Two posts, not seven. Both missing images with no reason surfaced. HCTI failure
mode unknown from logs (could be credentials/credits/quota/rate/timeout/render/
media). Do NOT assume credits are exhausted — surface the real category first.

## Important architecture
See `PROJECT_MEMORY.md` → Architecture. Key files below.

## Files most relevant to the current problem
- `src/utils/providerErrors.js`, `src/utils/providerLog.js`
- `src/services/hctiService.js`, `src/services/socialImageService.js`
- `src/services/plannerService.js` (`renderItemImageWithStatus`, `decorateItem`,
  the `regenerate` target:'image' path)
- `src/repositories/plannerRunRepository.js` (image_* columns)
- `database/migrations/018_provider_error_visibility.sql`, `database/schema.sql`
- `public/assets/js/components/plannerCard.js`, `public/assets/js/pages/plannerWeek.js`
- `src/services/automationService.js` + `src/services/plannerScheduleService.js`
  (refill slot accounting — the "2 of 7" math)
- `src/controllers/integrationController.js` + `src/services/hctiService.js`
  `testCredentials` (Test connection)

## Tests that must be run
- `npm test` (unit).
- `npm run test:integration` with a disposable MariaDB (`CYFLOW_TEST_DB_*`).
- Browser smokes: `node tools/review-server.mjs <port> [flags]` then
  `node tools/<name>-smoke.mjs`.
- `npm run migrate:check`, `npm audit`, `npm audit --omit=dev`.
- `npm run project:handoff` (validates these memory files exist + have headings).

## Safety constraints
`ENABLE_LIVE_PROVIDER_PUBLISHING=false`; zero real Facebook/Instagram/Threads
calls; no real OpenAI/HCTI calls in automated tests (mock the boundary); no
secrets in logs/docs; exact account targeting; do not deploy/merge/PR.

## Next recommended task
Redeploy branch `cyflow-social-v1` (new HEAD) to Hostinger ONCE, then do live
acceptance on the host: confirm the deployed commit hash, run the Mon-Sun 1/day
generate-ahead-7 Asia/Karachi single-Facebook-Page review automation under
`HOSTINGER_SINGLE_PROCESS_JOBS=true`, and watch the Weekly Board fill to 7
prepared posts (banner reads "preparing" until the bounded worker drains all
seven). Keep `ENABLE_LIVE_PROVIDER_PUBLISHING=false`. No merge, no PR.

## Expected final acceptance criteria
See `docs/ACCEPTANCE_CHECKLIST.md`. In short: 7 posts from a 7-day automation, 0
generation failures, 7 ready images OR a visible, specific reason per missing
image (never a silent "No image"), correct chronological order, exact account
targeting, one queue target per selected account, provider errors visible and
surviving a refresh, and zero real provider publishing.
