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
Wiring + free renderer + DB integration proof + a VISIBLE AI Studio page all COMPLETE.
The AI engine is wired into the daily automation slot path (additive, flag-gated),
renders posters browserlessly via @resvg/resvg-js (SVG -> PNG) so it runs on ANY
Hostinger, is proven through the REAL automation + MariaDB path, and now has a
dashboard page (/ai-studio) so the user can SEE and test it on demand — the user
reported "redeploy did nothing", which was correct: the feature had no UI and its
env switch was never set. Remaining: (1) bundle premium TTF fonts (polish, DejaVu
fallback renders now), (2) the user sets AI_STUDIO_MODE=on + AI_API_KEY on Hostinger,
(3) first careful live publish.

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
1. USER ACTION: redeploy (picks up the asset-versioning fix below), then on
   Hostinger set `AI_STUDIO_MODE=on` and `AI_API_KEY` (plus AI_BASE_URL /
   AI_MODEL) in the env panel, with `npm install` (the @resvg/resvg-js dep), and
   restart. Then open /ai-studio in the dashboard and press Generate — that is the
   visible proof the engine works live.

   CONTEXT: the user redeployed repeatedly and saw nothing new. Two real causes,
   both now resolved: (a) the Hostinger deployment was pinned to the branch
   `backup/cyflow-pre-ai-studio` — switched to `ai-poster-studio`; (b) the host's
   CDN strips `Cache-Control`/`ETag` from asset responses, so browsers heuristically
   cached the OLD module graph and kept running the previous release (no AI Studio
   in the sidebar; /ai-studio redirected away). Fixed by serving the shell's assets
   from a content-derived versioned path — see below.
2. (Polish) Bundle 2-3 premium open-source TTF fonts into an assets/fonts dir and
   point `POSTER_FONT_DIR` at it, so Linux typography matches local exactly.
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

## Asset versioning (deploys now actually take effect in a browser)
`src/utils/assetVersion.js` derives a 10-char stamp from the CONTENT of
public/assets at boot; `src/app.js` exports it as `ASSET_VERSION`, mounts
`/v/:assetVersion/assets` (immutable in prod), and renders app.html by replacing
`__ASSET_V__`, serving the shell itself `no-store`. Versioning only the entry point
is enough: ES imports are relative, so the WHOLE module graph inherits the prefix
(verified in a real browser: 7 modules fetched, 0 unversioned). The unversioned
/assets path still works for older shells/bookmarks. 7 focused tests in
tests/assetVersioning.test.js, including that the stamp changes with content and
that a missing assets dir degrades to "static" instead of crashing the boot.

## Last Updated
Four milestones this session, all proven: (1) AI-automation wiring (additive,
flag-gated; commit 41f9a41); (2) the FREE browserless Hostinger renderer
(@resvg/resvg-js SVG->PNG; commit a015e54), proven with real Claude -> an
agency-quality poster; (3) DB integration proof through the real automation path,
which caught + fixed a real bug (slot handler required OpenAI even in AI mode ->
now skipped when AI mode is on; commit 98ac497); (4) the VISIBLE AI Studio page
(/ai-studio + /api/ai-studio) in the dark studio aesthetic the user asked for,
reviewed in a real browser at desktop and mobile (clean console, hex-field clipping
found and fixed). Unit suite 1292/0, integration 47/0 (MariaDB), project:handoff OK.
Remaining: the user sets the Hostinger env switch, font polish, first live publish.
