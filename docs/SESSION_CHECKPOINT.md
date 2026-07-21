# Current Session Checkpoint

> Crash-safe working checkpoint. Rewritten continuously — see CLAUDE.md →
> "Mandatory memory and crash-safe checkpoint rule". No secrets, ever.

## Current Objective
READY was withdrawn (an "honest residual" section is disqualifying). Complete
EVERY remaining mandatory gate before any READY: all 17 revert-verifications
(revert the PRODUCTION fix, prove the focused test goes red, restore, prove
green — never revert only a test), every smoke suite individually, a dedicated
disposable-MariaDB 2-of-7 reproduction proving the exact job matrix, all 10
provider-error browser E2E scenarios, the automation-diagnostics UI acceptance,
the full contractor + knowledge parity acceptance, and all release gates. Then
one new commit after 71921ce with all memory + checkpoint committed, clean tree.

## Current Phase
Release-gate completion (post-71921ce). Section 1 (17 revert-verifications) DONE.
Next: Section 2 smokes, Section 3 2-of-7 reproduction, Section 4 provider-error
E2E, Sections 5-7 acceptance + gates, Section 8 commit. No new feature work.

## Current Branch
cyflow-social-v1

## Current HEAD
71921ce (feat: complete provider observability + Exact Make Parity hardening, crash-safe memory) — committed + pushed to origin

## Working Tree State
Dirty, ready for ONE final commit after 71921ce. Changed: docs/SESSION_CHECKPOINT
.md, PROJECT_MEMORY.md, docs/AI_HANDOFF.md, docs/KNOWN_ISSUES.md, docs/ACCEPTANCE
_CHECKLIST.md, public/assets/js/pages/automations.js (the only product code),
tools/review-server.mjs, tools/{platform,public,repair,retry}-smoke.mjs,
tests/plannerRetry.test.js; NEW: tests/automationDiagnostics.test.js,
tests/integration/reproduction2of7.integration.test.js,
tools/provider-error-e2e-smoke.mjs, tools/automation-diagnostics-smoke.mjs.

## Revert-verification log (17 items) — ALL COMPLETE (R=red-on-revert, G=green-on-restore)
Method: revert ONLY the production line, run the focused test, prove it fails
(R), `git checkout` restore, prove it passes (G). Never reverted a test. Dirty
files (checkpoint + 2 new tests) were cp-backed up, never git-checkout'd.

UNIT group (fake-free focused tests):
  #1  HCTI 402 -> credits_exhausted            R/G  hctiService.js:47            tests/hctiService.test.js
  #2  Safe popup message (HCTI credits line)   R/G  providerErrors.js:142        tests/providerErrors.test.js
  #4  Retry image caption isolation            R/G  plannerService.js:2955 (inject caption clobber) tests/plannerRetry.test.js
  #5  Automation diagnostics reason=preparing  R/G  automationService.js:566     tests/automationDiagnostics.test.js
  #8  Contractor weekday sequence (Mon)        R/G  makeContentStrategy.js:256   tests/makeParityGolden.test.js
  #9  Knowledge weekday sequence (Mon)         R/G  makeContentStrategy.js:270   tests/makeParityGolden.test.js
  #10 Make recipe: concept follows the day     R/G  makeContentStrategy.js:75    tests/makeDerivedEngine.test.js
  #11 Fixed contact-footer excluded (dominant) R/G  contentUniquenessService.js:155 tests/contentUniquenessService.test.js
  #12 Hashtag ceiling in the prompt            R/G  openaiContentService.js:667  tests/makeEngineWiring.test.js
  #13 Concept -> poster layout family          R/G  makeContentStrategy.js:389   tests/makeParityGolden.test.js
  #14 Authoritative Make format in caption     R/G  plannerBriefService.js:583   tests/makeParityGolden.test.js
  #15 Niche comes from workspace business      R/G  makeContentStrategy.js:316   tests/makeDerivedEngine.test.js
  #6  Canonical memory-file validation (teeth) R/G  tools/project-handoff.mjs (corrupt PROJECT_MEMORY heading) tests/projectHandoff.test.js
  #7  Crash-safe checkpoint validation (teeth) R/G  tools/project-handoff.mjs (corrupt SESSION_CHECKPOINT heading) tests/projectHandoff.test.js

DB group (real MariaDB integration, disposable :13306):
  #3  Image-failure persists SPECIFIC reason   R/G  plannerService.js:1707       tests/integration/automationParity.integration.test.js
  #16 Exact selected-account targeting         R/G  plannerService.js:1887       tests/integration/queueTargets.integration.test.js
  #17 Queue idempotency (approved->queued flip)R/G  plannerRunRepository.js:401  tests/integration/queueTargets.integration.test.js

Note on #17: the repo WHERE-clause concurrency guard is defense-in-depth the
single-connection integration harness cannot isolate; the OBSERVABLE production
mechanism is the atomic status flip to 'queued', which the sequential
"queueing twice" test proves is load-bearing (removing the flip -> a second post
is written). Working tree restored: only docs/SESSION_CHECKPOINT.md,
tests/plannerRetry.test.js (M) and tests/automationDiagnostics.test.js (??).

## Last Completed Step (history)
Phase A observability UI done (diagnostics banner, editable label, billable
warning, checkpoint infra). Phase B parity hardening done: (1) the Make day-type
format is now AUTHORITATIVE for the caption (plannerBriefService prefers
assignment.format; the generic pillar/mix only fills — the mix-steers test was
rewritten to assert the recipe wins); (2) the workspace phone is threaded back
into planner poster footers (was phone:null); (3) new tests/makeParityGolden.js
locks the measurable golden recipe (both weekday sequences, format<->concept<->
layout, Friday gating, authoritative format aligned with poster, 1080^2 canvas).
Unit suite 1280 pass.

## Files Changed (uncommitted, for the one final commit)
- docs/SESSION_CHECKPOINT.md (M) — this crash-safe checkpoint.
- tests/plannerRetry.test.js (M) — added #4 "Retry image changes ONLY the image".
- tests/automationDiagnostics.test.js (??) — the #5 diagnostics focused tests.
- tools/retry-smoke.mjs, tools/repair-smoke.mjs (M) — status selector .badge ->
  .status (the status label moved to statusChip in an intentional refactor; the
  smokes still queried the old pillar `.badge`).
- tools/platform-smoke.mjs (M) — card-meta assertion now matches the intentional
  "Platform · Account" format (was a stale exact "Platform, Platform" string);
  still proves only Instagram Professional + Threads and never Facebook.
- tools/public-smoke.mjs (M) — SPA route render wait 900->1500ms (the pages
  render correctly; 900ms was an intermittent harness timeout on /security,
  /about). Proven via a 1800ms DOM probe: header/footer/h1 all present.
- tools/review-server.mjs (M) + tools/provider-error-e2e-smoke.mjs (NEW) — the
  10-scenario provider-error harness: the review server seeds any category via
  REVIEW_ERR_* env, deriving the safe message + retryable from the SAME
  production model (userMessageFor/isRetryableCategory), and the smoke asserts
  the UI against that model. Default (no env) preserves the HCTI-credits case, so
  error-visibility-smoke still passes 14/14.
- tests/integration/reproduction2of7.integration.test.js (NEW) — Section 3.
NOTE: All 71921ce PRODUCT files (src/**) are unchanged; these are test/harness/
checkpoint edits only.

## Section 6 — Exact Make Parity acceptance (ALL PASS, golden + real MariaDB)
Structural / parameter / rhythm / schema / design-token parity — NOT word-for-
word AI equality (the echo fake proves the ASSIGNMENT, not model text).
- CONTRACTOR (automationParity "seven-post matrix meets every acceptance
  threshold"): 7 items, 0 generation failures, >=4 services, >=6 distinct topics,
  >=5 CTA constructions, >=5 hashtag groups, >=6 endings, >=6 poster templates
  (all poster-*), each service is a real business service (caption/poster
  aligned). "every post gets a rendered image, even when a render fails once" =>
  images ready. "EXACT PARITY holds under an HCTI error: recipe preserved,
  failure surfaced, caption intact" => no generic-pillar override on failure.
- KNOWLEDGE (automationParity "runs the knowledge rhythm, not the contractor
  one" + makeEngineFlow "agency gets knowledge day types, never contractor"):
  7 items, only knowledge day types, agency services only, zero contractor
  service/day-type leak (=> no property-damage framing, no phone-first CTA).
- ALL 7 SANITIZED SCENARIOS represented: design-references/make-scenario/
  PARITY-COMPARISON.md maps 6 of 7 to local_service + 1 (Peralytics) to
  knowledge_business; golden fixtures test both niches exactly.
- Green: makeParityGolden 7, makeDerivedEngine 23, makeEngineWiring 12,
  makeEngineFlow 6, automationParity 11, cyfrowWeekCreative 14,
  brandFidelityAndLayout 21, appBrandSeparation 11, socialImageTemplates 27,
  plannerBriefService 20 = 152 parity assertions, 0 fail. Canvas 1080x1080;
  saved brand colours preserved (never Cyflow green).

## Section 5 — automation diagnostics UI banner (ALL PASS, authenticated)
tools/automation-diagnostics-smoke.mjs (NEW) + a review-only
/__review/seed-automation-diagnostics endpoint seed three automations forcing
each reason; the /automations banner is asserted in a real browser:
  - preparing:  "Only 2 of 7 expected posts are prepared." + "2 ready, 5 still
    preparing. The worker is catching up."
  - failures:   "Only 5 of 7 ..." + "5 ready, 2 failed ... Retry." (err tone)
  - shortfall:  "Only 2 of 7 ..." + "Fewer slots than the horizon expected ..."
    + "2 skipped (past or duplicate dates)."
No internal id (run/slot/automation) leaks; survives a refresh. 11/11.
PRODUCT edit (public/assets/js/pages/automations.js): the banner headline now
counts READY (content that EXISTS), not ready+pending — so a fully-enqueued but
undrained buffer reads "2 of 7" (accurate) instead of "7 of 7" (the old,
misleading "prepared" count); and the detail now surfaces the skipped count.
Regression-checked: automationDiagnostics unit 5/5, automation-smoke 19/19.

## Section 4 — 10 provider-error browser E2E (ALL PASS, authenticated)
Each scenario booted its own seeded review server; each asserted inline error,
provider name, safe category label, retryable flag (model-derived), recommended
action (in the safe message), persistence across refresh, no secret/DB-id/raw
body, correct card state, and (image) no bare "No image" + Retry-image caption
byte-identical + service/headline/hashtags unchanged + Exact-Make day type not
flipped to generic:
  HCTI 401 auth (24), HCTI 402 credits (24), HCTI 403 permission (24),
  HCTI 429 rate (24), HCTI timeout (23, retryable=true), HCTI render_failed (23),
  media_persistence_failed (23), OpenAI 401 auth (11), OpenAI 429 rate (11),
  OpenAI invalid-JSON/response_invalid (11). 10/10 scenarios, 0 failures.
error-visibility-smoke still 14/14 after the review-server parametrization.

## Tests Run and Results
Section 1: 17/17 revert-verifications RED-on-revert / GREEN-on-restore (see log).
Section 2: ALL 17 browser smoke suites GREEN, run individually, server booted per
suite with the documented flags, Chrome per-suite (temp profile) so the user's
real browser is untouched. Totals (checks passed / failed):
  account 11/0, app-overlay-keyboard 81/0, app-redesign 25/0 (--placeholder-media),
  automation 19/0, checklist 27/0, create 18/0, editor-ux 12/0,
  error-visibility 14/0, media 24/0, milestone-c 44/0, openai-integration 35/0,
  platform-editor 24/0, platform 28/0, public 38/0, publish 18/0, repair 44/0,
  retry 18/0. SUM = 480 checks, 0 failures.
Five smokes failed on first pass; each proven NON-PRODUCT (stale `.badge`
selector vs the intentional statusChip; stale "Platform, Platform" string vs the
intentional "Platform · Account"; a 900ms harness wait; and a missing documented
--placeholder-media boot flag) and fixed in the test/runner, not the product.
Prior gates still valid: unit 1280+/0, integration 45/0 (disposable MariaDB),
migrate:check PASS, npm audit 0 (all+dev), blueprint/provider/secret scans clean.

## Current Failure or Blocker
None. Disposable MariaDB up (restart clears leftover GET_LOCK lease debris from
killed test processes — a known env artifact, not a product bug).

## Section 7 — release gates (ALL PASS)
- Unit 1286/0 (1280 + 6 new Section-1 focused tests).
- Integration (disposable MariaDB) 46/0.
- Browser E2E: 17 smokes 480 checks/0; provider-error 10/10; automation-
  diagnostics 11/0; error-visibility 14/0.
- project:handoff OK; migrate:check PASS; migrate:status informational.
- npm audit (all) 0 vulnerabilities; npm audit --omit=dev 0.
- Scans: secret CLEAN; raw-blueprint = only the sanitized peralytics reference
  (URLs just aiseocompany.com + public hcti.io base; connections redacted to
  __IMTCONN__; no webhooks/keys); provider-call = provider unit tests inject
  fetchImpl (no real network); logging = no caption/token/key in any log call;
  unsupported-provider = websiteParser hosts are link-PARSING for business
  context, not publishing targets.
- Safety: ENABLE_LIVE_PROVIDER_PUBLISHING default false; publishingService gates
  every provider call behind liveEnabled() and returns live_publishing_disabled
  when off; tests use fake adapters => zero real FB/IG/Threads calls; no real
  OpenAI/HCTI calls in tests.
- project:status stale item: CY-006 (retry-smoke stale badge selector) was FIXED
  this session (Section 2) -> to be marked resolved in KNOWN_ISSUES before commit.

## Section 3 — 2-of-7 reproduction result (OUTCOME A, proven)
tests/integration/reproduction2of7.integration.test.js drives the real pipeline
(createAutomation -> activate -> refill job -> bounded worker drain -> slot
generation -> images -> Weekly Board read model + card diagnostics).
- Persisted: seven weekdays [1..7], exactly one selected Facebook Page.
- Refill log: expected 7, candidate 7, skippedPast 1, created 7, alreadyPresent 0.
- AFTER REFILL: 7 generate_automation_slot jobs (pending) + 7 slots (planned).
- BOUNDED drain (2 slot jobs): jobs {completed 2, pending 5}; slots {ready 2,
  planned 5}; 2 planner items, both with a real image; diagnostics
  {expected 7, ready 2, pending 5, failed 0, reason "preparing"}.
- FULL drain: slots {ready 7}; 7 items; 0 generation_failed; 7 images; Weekly
  Board API returns 7; diagnostics {ready 7, pending 0, failed 0, reason "ok"}.
CONCLUSION: "2 of 7" was WORKER LAG under a bounded single-process drain, NOT a
generation cap. Seven jobs are created; the banner says "preparing", not
"shortfall". Integration suite now 46 pass / 0 fail (was 45 + this repro).

## Exact Next Step
Section 1 DONE (17/17 revert-verified R->G). Now:
1) Section 2: run every browser smoke suite individually (kill Chrome between);
   record exact pass totals.
2) Section 3: build tests/integration/reproduction2of7 with a bounded
   Hostinger-style worker drain; assert exact expected/created/claimed/pending/
   completed/failed matrix + persisted 7 weekdays; prove outcome A or B.
3) Section 4: build the 10-scenario provider-error browser E2E.
4) Section 5: automation-diagnostics UI banner acceptance.
5) Section 6: contractor + knowledge parity acceptance (golden + real).
6) Section 7: all release gates.
7) Section 8: one new commit (memory + checkpoint) after 71921ce; verify
   local==origin + clean tree; then Section 9 READY.

## Commands or Tests to Run Next
- node --test tests/*.test.js
- (with disposable MariaDB) npm run test:integration
- node tools/review-server.mjs <port> [flags] + node tools/<name>-smoke.mjs
- npm run project:handoff ; npm run migrate:check ; npm audit

## Safety Flags
ENABLE_LIVE_PROVIDER_PUBLISHING=false (required). Zero real provider publishing
calls. No real OpenAI/HCTI calls in automated tests. Do not deploy/merge/PR;
push only origin cyflow-social-v1.

## Last Updated
ALL nine sections complete and green. Memory files updated (PROJECT_MEMORY,
AI_HANDOFF, KNOWN_ISSUES incl. CY-001 resolved + CY-006 resolved, ACCEPTANCE
_CHECKLIST all boxes, this checkpoint). project:handoff OK. Next: ONE commit
after 71921ce, push to origin cyflow-social-v1, verify local==origin + clean
tree, then return READY. No deploy/merge/PR.
