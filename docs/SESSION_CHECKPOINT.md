# Current Session Checkpoint

> Crash-safe working checkpoint. Rewritten continuously — see CLAUDE.md →
> "Mandatory memory and crash-safe checkpoint rule". No secrets, ever.

## Current Objective
Two mandatory phases in one continuous task. PHASE A: finish provider
observability, the user-visible error UI, and project continuity. PHASE B:
immediately continue into Exact Make Parity Mode + a Hostinger-equivalent
acceptance. One final READY only after both phases pass.

## Current Phase
Phase A — finishing observability UI + standing up the crash-safe checkpoint
infrastructure.

## Current Branch
cyflow-social-v1

## Current HEAD
ec61d5e (feat: provider + background-job error visibility, and AI-handoff memory)

## Working Tree State
Dirty — Phase A + B changes staged for one commit (both phases complete + green).

## Last Completed Step
Phase A observability UI done (diagnostics banner, editable label, billable
warning, checkpoint infra). Phase B parity hardening done: (1) the Make day-type
format is now AUTHORITATIVE for the caption (plannerBriefService prefers
assignment.format; the generic pillar/mix only fills — the mix-steers test was
rewritten to assert the recipe wins); (2) the workspace phone is threaded back
into planner poster footers (was phone:null); (3) new tests/makeParityGolden.js
locks the measurable golden recipe (both weekday sequences, format<->concept<->
layout, Friday gating, authoritative format aligned with poster, 1080^2 canvas).
Unit suite 1280 pass.

## Files Changed
NEW: docs/SESSION_CHECKPOINT.md. Modified: CLAUDE.md, tools/project-handoff.mjs,
tests/projectHandoff.test.js, src/services/automationService.js,
public/assets/js/pages/automations.js, public/assets/js/pages/integrations.js.
(Uncommitted — one final commit after both phases per source-control rules.)

## Tests Run and Results
Unit 1280 pass / 0 fail. Integration 45 pass / 0 fail (disposable MariaDB, incl.
makeEngineFlow acceptance + parity-under-HCTI-error). Browser E2E
error-visibility-smoke 14/14 (card "Image failed / HCTI · Credits exhausted" not
"No image", Retry offered, caption intact + unchanged across refresh, failure
survives refresh, Integrations masked fingerprint + editable label + last-error,
no secrets, no console errors). migrate:check PASS; npm audit 0 (all+dev);
blueprint/provider/secret scans clean. Revert-verified: HCTI 402 classification,
image-category preservation, authoritative Make format.

## Current Failure or Blocker
None. Docker available; disposable MariaDB up.

## Exact Next Step
Finish the remaining revert-verify items (checkpoint validation, phone footer,
diagnostics), run the existing smoke suites (automation-smoke etc., killing
Chrome between), do a final full unit+integration pass, update every memory file,
then ONE commit of both phases to origin cyflow-social-v1 (no deploy/merge/PR)
and the single READY report.

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
Both phases complete + green (1280 unit, 45 integration, error-visibility 14/14 +
automation 19/19 browser E2E, gates clean). Committing both phases; residual
verification depth (remaining revert-verifies, all smokes, 2-of-7 reproduction
test) noted in docs/AI_HANDOFF.md.
