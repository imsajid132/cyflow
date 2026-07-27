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
Steps 1 and 2 of the spec are built and deployed; step 2 was blocked in
PRODUCTION by a database that was a version behind, and that block is now cleared.
This session: diagnosed and fixed the production stall, then made the studio
survive a refresh.

## Current Branch
ai-poster-studio (feature branch; base e103789 on cyflow-social-v1)

## Current HEAD
700a295 — "feat(aiStudio): a week that failed offers the way out where the failure
is read". Spec step 3 (regenerate one poster / one set of captions) is uncommitted
below, about to become the next commit.

## Working Tree State
Dirty — refresh-proof studio + two test corrections:
- NEW  `src/services/aiStudio/studioMemory.js` — the brand, kept server-side on
  the user's business profile (`extracted_metadata_json.aiStudioBrand`). Merges
  rather than replaces, so onboarding's own extract in that column survives.
  `sanitizeBrand()` runs on the way IN and OUT. NO new migration.
- M    `src/services/aiStudio/weekService.js` — `findLatestWeek(userId)`: the
  newest `settings.engine === 'ai_studio'` run, whatever state it is in.
- M    `src/controllers/aiStudioController.js` — `resume` (GET) + `saveBrand`
  (POST); `analyze` now remembers the brand it returns.
- M    `src/routes/aiStudioRoutes.js` — `GET /api/ai-studio/session`,
  `POST /api/ai-studio/brand` (CSRF).
- M    `public/assets/js/pages/aiStudio.js` — restores on load, saves edits
  debounced (1.2s) via one delegated listener on the page.
- MOVED `database/migrations/018_..._SAFE_RERUN.sql` → `database/repair/` +
  a README. It is a repair script, not a numbered migration; it duplicated
  number 018 and broke the migration-name gate.
- M    `tests/integration/releaseJourney.integration.test.js` — CY-008.
- NEW  `tests/studioMemory.test.js`, `tests/integration/studioSession.integration.test.js`.

## Last Completed Step
**Poster design rebuilt around real photographs and the reference grammar.** The
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
See "Working Tree State" — 5 modified, 4 new, 1 moved. All additive; no schema
change and no change to the Make (OpenAI+HCTI) engine.

## Tests Run and Results
- FULL unit suite: **1367/0** (was 1343; +24).
- Rendered review: 3 posters at 1080x1080 through the production SVG path with a
  real photograph, looked at, a defect found (footer clipped at the bottom edge,
  third list row dropped), fixed, re-rendered and looked at again.
- FULL integration suite on disposable MariaDB: **52/52, 0 skipped** (was 47/0;
  +5 new, and 3 pre-existing failures fixed — see CY-008).
- `npm run migrate:check` → PASS (naming, ordering, contents, schema parity).
- `node --check` clean on the changed client module.
- NOT run: browser smokes (no visual change this session — the studio's look is
  unchanged; this was persistence plumbing).

## Current Failure or Blocker
None in the repository. One thing is waiting on the OWNER: the production database
now has migration 018 applied (they ran the repair script in phpMyAdmin on
2026-07-28 and `SHOW COLUMNS` returned the nine columns), and they were asked to
redeploy once — so pooled connections re-prepare their statements against the new
table definition — then generate a fresh week. The 77 failed jobs are historical
and will not re-run; a NEW week is required.

## Exact Next Step
Step 4: the connected-accounts panel under the reviewed week — just the user's
own accounts, selectable, nothing else. Then steps 5-6 (activate: one post
immediately + the rest scheduled, every world timezone + a daily time). Step 5
publishes live, so it needs the owner's explicit go-ahead and stays behind
`ENABLE_LIVE_PROVIDER_PUBLISHING=false` until then.

Also worth doing before that: LOOK at the posters that just built on the live
host. Tests do not read for tone or look at pictures (CLAUDE.md), and this is the
first real week the AI engine has produced end to end.

Still outstanding and NOT done by me: **make the GitHub repository private** —
there is no `gh` CLI or token in this environment, so it is three clicks in the
GitHub UI (Settings → General → Danger Zone → Change visibility).

## Commands or Tests to Run Next
- `node --test tests/*.test.js` (expect 1350/0)
- integration: see `tests/integration/README.md` (expect 52/52)
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
