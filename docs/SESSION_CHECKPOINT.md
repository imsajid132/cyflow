# Current Session Checkpoint

> Crash-safe working checkpoint. Rewritten continuously — see CLAUDE.md →
> "Mandatory memory and crash-safe checkpoint rule". No secrets, ever.

## Current Objective
The product, as the owner finally defined it (docs/PRODUCT_SPEC.md): **a website
in → a week of posts out → then it runs itself.** One path, no options. Analyze a
site and show EVERYTHING found, all editable including the logo; one button
generates a whole week with no tone/topic/style pickers because Claude decides;
review with per-poster and per-caption regenerate; choose connected accounts;
activate — one post goes out immediately, the rest scheduled daily in the user's
timezone, for ever, without the app being open. Never a duplicate.

## Current Phase
**Every step of the product spec is built.** 1 analyze → 2 generate a week →
3 regenerate a poster or its captions → 4 choose accounts → 5 activate → 6 world
timezone + daily time. Production builds weeks successfully. What is left is the
owner's judgement on the output, and the first deliberate live publish.

## Current Branch
ai-poster-studio (feature branch; base e103789 on cyflow-social-v1)

## Current HEAD
7b5d782 — "feat(aiStudio): put the business's own photographs on the posters".
Steps 4, 5 and 6 (accounts panel + activate + timezone) are uncommitted below,
about to become the next commit.

## Working Tree State
Dirty — the accounts panel and activation:
- M `src/services/aiStudio/weekService.js` — `activateWeek(userId, runId,
  {accountIds, timezone, dailyTime})`: times the week, approves it, and hands it
  to the injected `queue`. First post +120s (a slot in the past is skipped by
  queueing); the rest at the chosen WALL-CLOCK time, one a day.
- M `src/container.js` — injects `plannerService.queueApproved` as that `queue`.
  Queueing is deliberately not reimplemented.
- M `src/controllers/aiStudioController.js` — `accounts` (the user's own
  connections, no tokens) and `activate` (reports `liveEnabled` honestly).
- M `src/routes/aiStudioRoutes.js` — `GET /accounts`, `POST /week/:runId/activate`.
- M `public/assets/js/pages/aiStudio.js` + `design-system.css` — the panel: tick
  accounts, pick a timezone from every zone the browser knows, pick a time, one
  button.
- M `tests/weekService.test.js` (+4), `tests/integration/studioSession...` (+1).

## Last Completed Step
**Spec steps 4, 5 and 6.** The accounts panel under a finished week (the user's
own connections, selectable, nothing else), and Activate: every world timezone,
a daily time applied as wall clock, the first post timed to go straight away and
the rest one a day. Queueing is `plannerService.queueApproved`, injected rather
than reimplemented, and an integration test on real MariaDB asserts exactly one
target row per post on the chosen account — the assertion that catches the
seven-Pages fan-out returning. NOTHING PUBLISHES; the screen says so.

Before that: **poster design rebuilt around real photographs and the reference
grammar.** The
owner looked at the first live week and said the posters were wrong: their
friend's app puts the website's real images behind the design, and ours had no
picture at all. Both halves of that are now fixed and were verified by RENDERING
AND LOOKING (three posters through the production SVG path, then a re-render
after the safe-area fix). See docs/ACCEPTANCE_CHECKLIST.md and the new section
at the end of design-references/social-posts/REFERENCE_ANALYSIS.md.

Two traps worth remembering:
- The local `.env` has `POSTER_RENDER_MODE=local`, so a naive local render
  exercises the HTML+Chrome path, NOT the SVG path production uses. Force
  `POSTER_RENDER_MODE=svg` when reviewing posters locally, or you review the
  wrong engine (I did, once: 1064x985 output with Google Fonts links was the
  giveaway).
- `isPrivateIp()` takes an IP, not a hostname: given "example.com" it returns
  true. A helper that passed a hostname to it was deleted rather than fixed —
  `fetchPosterPhoto` already does the check correctly via `assertPublicHost`.

Before that, spec step 3: per-poster and per-caption regeneration, as durable
jobs, with the card saying which half of it is busy.

**PRODUCTION IS BUILDING.** After the owner applied the repair script and
redeployed, a fresh week actually builds: `/health` went 1 -> 17 `completed` with
`failed` frozen at 77 (all historical). The `Unknown column` failure has not
recurred. This is the first end-to-end proof on the live host.

## Files Changed (uncommitted, for the next commit)
See "Working Tree State" — 7 modified. All additive; no schema change and no
change to the Make (OpenAI+HCTI) engine.

## Tests Run and Results
- FULL unit suite: **1371/0** (was 1343; +28).
- Rendered review: 3 posters at 1080x1080 through the production SVG path with a
  real photograph, looked at, a defect found (footer clipped at the bottom edge,
  third list row dropped), fixed, re-rendered and looked at again.
- FULL integration suite on disposable MariaDB: **53/53, 0 skipped** (was 47/0;
  +6 new, and 3 pre-existing failures fixed — see CY-008). The newest proves an
  activation through the REAL planner queue: one target row per post, on the
  chosen account, no fan-out.
- `npm run migrate:check` → PASS (naming, ordering, contents, schema parity).
- `node --check` clean on the changed client module.
- NOT run: browser smokes. The accounts panel has not been looked at in a real
  browser yet — it is the one piece of this session no human eye has checked.

## Current Failure or Blocker
None. Production applied migration 018 and now builds weeks end to end: /health
reached 21 completed with failed frozen at 77 (all historical), and the
`Unknown column` failure has not recurred.

## Exact Next Step
**Every step of the product spec is now built.** 1 analyze → 2 generate a week →
3 regenerate a poster or its captions → 4 choose accounts → 5 activate (one post
straight away, the rest one a day) → 6 every world timezone + a daily time.

What remains is not more building:
1. The owner looks at a real week on the live host, including the accounts panel
   and an activation, and says whether the posters are right.
2. THE FIRST LIVE PUBLISH. This is the only remaining thing that needs a
   deliberate decision: `ENABLE_LIVE_PROVIDER_PUBLISHING=false` is the current
   and required state, activation produces a real schedule that nothing acts on
   until that switch is turned on, and the screen says so. Turn it on once, for
   one account, with the owner watching. Do NOT do this unprompted.
3. Make the GitHub repository private. Owner action: there is no `gh` CLI or
   token in this environment, so it is Settings → General → Danger Zone →
   Change visibility.

## Commands or Tests to Run Next
- `node --test tests/*.test.js` (expect 1371/0)
- integration: see `tests/integration/README.md` (expect 53/53)
- `npm run migrate:check` ; `npm run project:handoff`
- live: `curl -s https://cyflow.cyfrow.net/health` → check `aiStudio.jobs`

## Safety Flags
- `ENABLE_LIVE_PROVIDER_PUBLISHING=false` — nothing publishes yet. The first live
  publish is deliberate, one account, with the owner watching.
- `AI_STUDIO_MODE` on via `private/ai.env` on the host (the env panel silently
  refuses to store it — see the deployment traps below).
- The AgentRouter key lives ONLY in the gitignored `.env` locally and in
  `private/ai.env` on the host. Never committed, never logged.
- The brand is kept SERVER-side, never in browser storage: a website extract
  carries a real business's contact details (see `public/assets/js/api.js`).
- Backup of pre-feature Cyflow: branch `backup/cyflow-pre-ai-studio` + tag
  `backup-cyflow-2026-07-23`.

## Deployment traps found on this host (each cost real time)
1. Hostinger was deploying `backup/cyflow-pre-ai-studio`, the pre-feature
   snapshot. Check hPanel → Deployments → Settings FIRST.
2. The CDN strips `Cache-Control`/`ETag`, so browsers heuristically cached the old
   module graph — even in incognito. Fixed by content-versioned asset paths
   (`/v/<hash>/assets/...`, `src/utils/assetVersion.js`).
3. The env panel cannot store `AI_API_KEY` / `AI_STUDIO_MODE` (shows 57, saves
   55). Fixed by reading `private/ai.env` beside the media directory, outside the
   deployed tree so a redeploy cannot wipe it.
4. The database can be a version behind the code with no visible symptom except
   failing jobs — CY-007. `/health` now reports studio job counts and the last
   failure category so this is diagnosable from outside, without signing in.

## Last Updated
2026-07-28. Two things this session. (1) Cleared the production block: the live
database was missing migration 018's nine `image_*` columns, which is why every
week sat at 0/7 — found from outside using only `/health`, fixed with a
re-runnable repair script, and the repair script's own verification had to be
rewritten because a shared-hosting user cannot read `information_schema`. (2) The
studio now survives a refresh: the corrected brand is kept server-side and the
week in progress is found by asking rather than by remembering a run id that only
ever lived in one browser tab. Unit 1350/0, integration 52/52 (including three
pre-existing failures fixed), migrate:check PASS.
