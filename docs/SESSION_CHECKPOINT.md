# Current Session Checkpoint

> Crash-safe working checkpoint. Rewritten continuously — see CLAUDE.md →
> "Mandatory memory and crash-safe checkpoint rule". No secrets, ever.

## Current Objective
Build the AI poster studio INTO Cyflow (branch `ai-poster-studio`): Claude designs
the poster AND writes the captions (via the friend's AgentRouter key), a FREE
renderer rasterizes the poster, and it runs on the user's own Hostinger reusing
Cyflow's existing connected accounts + daily automation + publishing. Free forever
to the user. No OpenAI, no HCTI in this engine. The tested OpenAI+HCTI "Make
parity" engine must remain UNTOUCHED (additive, flag-gated).

## Current Phase
Wiring + free renderer + DB integration proof all COMPLETE. The AI engine is wired
into the daily automation slot path (additive, flag-gated), renders posters
browserlessly via @resvg/resvg-js (SVG -> PNG) so it runs on ANY Hostinger, and is
now proven through the REAL automation + MariaDB path (refill -> worker -> slot job ->
mediaLibraryService store -> createItem). That integration test caught + fixed a real
bug: the slot handler required OpenAI even in AI mode, which would have failed every
slot on a workspace that (intentionally) has no OpenAI key. Remaining: (1) bundle
premium TTF fonts (polish, DejaVu fallback renders now), (2) first careful live publish.

## Current Branch
ai-poster-studio (feature branch; base e103789 on cyflow-social-v1)

## Current HEAD
03f0592 (auto-retry the AI client) — the new wiring below is STAGED/uncommitted,
about to become the next commit.

## Working Tree State
Dirty — the AI-automation wiring, ready to commit:
- NEW  src/services/aiStudio/aiStudioEngine.js — orchestrates one AI post: copy +
  captions (one Claude text call) + poster design (a second text call) + free
  render. `isAiStudioEnabled()`, `styleIdForPosition()`, `generateAiCopy()`,
  `generateAiPost()`. Vision is NOT used (AgentRouter panics on images); captions
  are grounded in the copy we generate.
- M    src/services/plannerService.js — additive `generateAiStudioItem()` + a
  flag-gated branch inside `generateAutomationSlotItem` (returns before the Make
  engine). New injected deps: `mediaLibraryService`, `aiStudio`.
- M    src/container.js — `mediaLibraryService` moved above the planner and
  injected into it (the AI engine stores its PNG through that raw-bytes path).
- M    src/config/constants.js — `PROVIDER_NAMES.AI_STUDIO = 'ai_studio'`.
- M    src/utils/providerErrors.js — friendly label for the ai_studio provider.
- NEW  tests/aiStudioAutomation.test.js — 3 unit tests (below).

## Last Completed Step
Wrote + verified the additive AI-automation wiring. `generateAutomationSlotItem`,
when `AI_STUDIO_MODE=on` and a key is set, builds the slot with Claude (poster +
captions) and stores the poster via `mediaLibraryService.uploadImage` (raw-bytes /
upload path — NOT the HCTI `createReadyImageAsset` path), producing a valid,
reviewable planner item with a normalized, safe image state. Copy failure → null
(worker retries), logged safely. Image/render failure → item still created with a
specific retryable image-failed state (never a silent null, never a crash). AI
posts are always NEEDS_REVIEW (never auto-approved).

## Files Changed (uncommitted, for the next commit)
See "Working Tree State" — 4 modified, 2 new. All src/** changes are ADDITIVE; the
OpenAI+HCTI engine path is unchanged and is bypassed (returns early) only when AI
mode is explicitly on.

## Tests Run and Results
- NEW tests/aiStudioAutomation.test.js — 3/3 PASS:
  1. AI slot → valid reviewable item, poster uploaded once, mediaAssetId set,
     image READY, both platform captions present, OpenAI never called.
  2. render/design failure → item still created, image FAILED+retryable, provider
     ai_studio, caption intact, nothing uploaded.
  3. copy failure → returns {item:null} (worker retries), OpenAI never called.
- FULL unit suite: `node --test tests/*.test.js` = 1289/0 (was 1286; +3 new). No
  regressions from the constants/container/planner changes.
- Container boot smoke (test env): buildContainer() OK; planner + mediaLibraryService
  wired. `node --check` clean on all changed files.
- NOT run this session: integration suite (needs disposable MariaDB); browser
  smokes. The wiring is unit-proven with the engine + media injected as fakes.

## Current Failure or Blocker
None. The Hostinger renderer question is SOLVED: `POSTER_RENDER_MODE` unset/`svg`
(the default) → Claude emits a self-contained SVG poster, `@resvg/resvg-js`
rasterizes it to PNG with NO browser (works on shared hosting, free forever). The
HTML+Chrome path (`local`/`remote`) remains opt-in for a VPS. One honest polish
item: fonts. The renderer loads system fonts + `POSTER_DEFAULT_FONT` (default
'DejaVu Sans', present on Hostinger Linux), so text always renders; to get the
EXACT premium families (Poppins/Playfair) identically on every host, drop TTFs into
`POSTER_FONT_DIR`. Not a blocker — posters render premium now via the fallback.

## Exact Next Step
1. (Polish) Bundle 2-3 premium open-source TTF fonts into an assets/fonts dir and
   point `POSTER_FONT_DIR` at it, so Linux typography matches local exactly.
2. Set AI_STUDIO_MODE=on and run one real `generateAutomationSlotItem` through the
   DB automation path (disposable MariaDB) to confirm the item + media asset + Weekly
   Board render, not just the engine in isolation.
3. Then the first careful live publish reusing the user's existing Cyflow accounts
   + Meta approval (Cyflow has never published live — go slow, one post).

## Commands or Tests to Run Next
- node --test tests/aiStudioAutomation.test.js
- node --test tests/*.test.js            (full unit suite; expect 1289/0)
- AI_STUDIO_MODE=on with AI_* env set, then exercise an automation slot locally
- npm run project:handoff ; npm run migrate:check

## Safety Flags
- AI_STUDIO_MODE default OFF — the whole AI branch is dormant unless explicitly on
  AND a key is present; the Make engine is the default and is untouched.
- ENABLE_LIVE_PROVIDER_PUBLISHING=false (required) — nothing publishes yet.
- The AgentRouter key lives ONLY in the gitignored `.env`; on Hostinger it goes in
  the host env-vars panel. NEVER commit or push the key. No secrets in any log or
  memory file (the ai_studio provider logs carry only category/status/time).
- Backup of pre-feature Cyflow: branch `backup/cyflow-pre-ai-studio` + tag
  `backup-cyflow-2026-07-23` (pushed). Do not merge/deploy without the user's say.

## Last Updated
Three milestones this session, all proven: (1) AI-automation wiring (additive,
flag-gated; commit 41f9a41); (2) the FREE browserless Hostinger renderer
(@resvg/resvg-js SVG->PNG; commit a015e54), proven with real Claude -> an
agency-quality poster; (3) DB integration proof through the real automation path,
which caught + fixed a real bug (slot handler required OpenAI even in AI mode ->
now skipped when AI mode is on; automationService.js). Unit suite 1292/0,
integration 47/0 (both on MariaDB), project:handoff OK, npm audit 0. Remaining:
bundle premium fonts (polish) + first careful live publish. Committing the fix +
integration test next.
