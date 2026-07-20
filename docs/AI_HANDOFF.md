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
Branch `cyflow-social-v1`. Working tree may be dirty mid-task. Migration head is
`018_provider_error_visibility.sql`. Full unit suite green at last run (1269).

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

## What remains unresolved (verification depth, not blockers)
- Not every one of the 17 revert-verify items has been run this session (HCTI 402,
  image-category, authoritative-format, checkpoint-validation are done); the rest
  are covered by unit/integration tests but not each individually reverted.
- Not all existing smoke suites re-run (automation + error-visibility done).
- A dedicated 2-of-7 reproduction test (CY-001) still to add.
- Full 12-variant popup E2E (401/429/timeout/media-vs-render as separate browser
  assertions) — the classification + messages are unit-tested and the render path
  is E2E'd for 402.
- PHASE B continues in future sessions if deeper parity (verbatim prompt wording)
  is wanted; current parity is rhythm/structure/format/poster/branding, not the
  Make prompt persona text (documented divergence).

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
Restore Docker, run the integration + browser E2E for provider errors, finish
the integrations health panel + Test connection and the automation diagnostics,
run all gates + revert-verify, update these files, then commit to
`origin cyflow-social-v1`.

## Expected final acceptance criteria
See `docs/ACCEPTANCE_CHECKLIST.md`. In short: 7 posts from a 7-day automation, 0
generation failures, 7 ready images OR a visible, specific reason per missing
image (never a silent "No image"), correct chronological order, exact account
targeting, one queue target per selected account, provider errors visible and
surviving a refresh, and zero real provider publishing.
