# Cyflow Social Project Memory

> Canonical short memory. Compact enough to paste into a fresh ChatGPT or
> Claude Code session. No secrets. Update this before every READY response
> (see `CLAUDE.md` → Project Continuity and `docs/AI_HANDOFF.md`).

## Project Identity
Cyflow Social is a native social-media content engine that reproduces the proven
rhythm of the Make.com "Daily Content Generator" scenarios (Make is a design and
rhythm REFERENCE, not a runtime dependency). It generates a weekly plan of
Facebook / Instagram / Threads posts with branded 1080×1080 images, holds them
for human review, and (when enabled) can publish. Node.js ESM, Express, MariaDB,
a custom same-origin SPA under `public/`, durable background jobs.

## North Star — EXACT MAKE PARITY MODE
Cyflow replaces the user's expired Make.com subscription. Output must read as
though the original Make workflow produced it, using the ACTIVE workspace's own
business info, services, logo and colours. The Make weekday rhythm, caption
cadence, CTA/footer/hashtag rules, JSON/poster-field contract and card
composition are authoritative; only business/brand variables change. The generic
diversity planner / CTA / hashtag helpers may ONLY fill/validate — they must
never override the recipe. Two niche families: local_service (6 contractor
scenarios) and knowledge_business (1). Documented divergences (model version,
Friday honesty, runtime platforms) live in
`design-references/make-scenario/PARITY-COMPARISON.md` §5. Never regress this into
a generic content engine.

## Current Branch
`cyflow-social-v1`

## Current Known HEAD
The commit `git rev-parse HEAD` reports on this branch. The last released
candidate before the provider-error-visibility work was `ab83981`. Verify with
git; do not trust this file's hash after new commits.

## Current Known Hostinger Deployment
UNVERIFIED. There is no deployed-commit marker in the repo, and no live access
from this workspace. `deploy/RELEASE-CANDIDATE.md` historically said "not yet
deployed", but live acceptance evidence (a Weekly Board screenshot) shows the
app HAS run on Hostinger. Treat the deployed commit as unknown until confirmed
from the host. Never trust a prior READY report without checking live evidence.

## Architecture Summary
- `src/services/*` — planner, automation, durable jobs, providers, publishing.
- `src/repositories/*` — prepared-statement DB access, always scoped by user_id.
- Durable job queue (`background_jobs`) drives automation refill → slot
  generation → (optional) publishing, under DB leases.
- Images render via HCTI (`hctiService` → `socialImageService`), persisted as
  `media_assets` and referenced by `planner_run_items.media_asset_id`.
- Normalized provider errors: `src/utils/providerErrors.js`
  (`ProviderError` + `normalizeProviderError`), safe structured logging in
  `src/utils/providerLog.js`, canonical vocabulary in `src/config/constants.js`
  (`PROVIDER_ERROR_CATEGORY`, `IMAGE_RENDER_STATUS`).
- Hostinger managed single-process mode: `HOSTINGER_SINGLE_PROCESS_JOBS=true`
  runs a scheduler tick + a BOUNDED worker drain every 60s in the web process.

## Supported Platforms
Facebook Pages, Instagram Professional, Threads. (LinkedIn/others are not
runtime targets.)

## Current Safety Flags
- `ENABLE_LIVE_PROVIDER_PUBLISHING=false` — REQUIRED initial state. Nothing is
  sent to any provider while false.
- `HOSTINGER_SINGLE_PROCESS_JOBS` — true only on managed single-process hosts.

## Completed Milestones
- Native content engine + Make rhythm + 7 poster layouts.
- Per-platform copy, media library, durable automation + jobs, publishing
  adapters (flag-gated, never live-verified).
- Five NYC-Waterproofing staging defects fixed (similarity, generation failure,
  missing images, chronological board, history scope) — `ab83981`.
- Provider + background-job ERROR VISIBILITY (this milestone): normalized
  provider-error model + safe logging; HCTI 402→credits and per-category
  classification preserved end to end; queryable image-status columns
  (migration 018); board/drawer show "Image failed / HCTI · <reason>" with a
  caption-safe Retry image.

## Verified Fixes
- Image-render failures are no longer swallowed into a bare "No image": the
  specific category (credits_exhausted, authentication_failed, rate_limited,
  network_timeout, media_persistence_failed, …) is persisted, logged safely, and
  shown. Retry image re-renders WITHOUT touching the approved caption. Proven by
  unit tests (`providerErrors.test.js`, `hctiService.test.js`,
  `socialImageService.test.js`, `migration018.test.js`) — full unit suite green.

## Current Live Problems
- "2 of 7": RESOLVED + CONFIRMED. `tests/integration/reproduction2of7.integration
  .test.js` proves it was WORKER LAG under the bounded single-process drain (the
  refill creates 7 slots + 7 jobs; a bounded drain completes 2, leaving 5
  pending; the banner reads "preparing", not "shortfall"). Not a generation cap.
  See `docs/KNOWN_ISSUES.md` CY-001.
- Provider/job failures are now surfaced end to end: normalized ProviderError,
  safe structured logs, image_* columns, board banner, and the 10-scenario
  authenticated browser E2E all green.

## Known Regressions
None open. The retry/repair/platform/public browser smokes had STALE selectors/
waits against an intentional statusChip + "Platform · Account" refactor; fixed
this session (CY-006 resolved). All 17 smokes green.

## Current Acceptance Result
FULL-SPEC verification complete. Unit 1286/0 (incl. golden parity + new focused
tests). Disposable-MariaDB integration 46/0 (incl. the 2-of-7 reproduction).
Browser E2E: 17 smokes (480 checks/0), 10 provider-error scenarios, automation-
diagnostics banner 11/0, error-visibility 14/0. All 17 revert-verifications
proved RED-on-revert / GREEN-on-restore against the real production line.
migrate:check PASS; npm audit 0 (all + --omit=dev); secret/blueprint/provider-
call/logging/unsupported-provider scans clean. project:handoff OK. The only
production-code change this session is the automations.js banner correction
(counts READY, surfaces skipped). One final commit follows 71921ce.

## Provider Status
- OpenAI, HCTI: per-user, encrypted credentials (`user_integrations`). Health
  panel (label, masked last-4, last success/failure, last error category, last
  check) added via migration 018 columns.
- Facebook/Instagram/Threads: OAuth connect works; publishing is flag-gated and
  NEVER live-verified. `fake_provider_verified` only.

## Important Environment Variables
Names only (values live in the host env / `.env`, NEVER here):
`ENABLE_LIVE_PROVIDER_PUBLISHING` (false), `HOSTINGER_SINGLE_PROCESS_JOBS`,
`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`, `ENCRYPTION_KEY`,
`MEDIA_STORAGE_PATH`, `EXPORT_STORAGE_PATH`, `SESSION_SECRET`.
See `.env.example` for the full list.

## Database and Hosting Notes
- MariaDB. Migrations `database/migrations/NNN_*.sql`, applied MANUALLY in order
  (no runner, no `schema_migrations` table). `database/schema.sql` is the full
  snapshot and must stay in parity (`npm run migrate:check`). Head = `018`.
- Hostinger managed Node: single process, set `HOSTINGER_SINGLE_PROCESS_JOBS`.
- `MEDIA_STORAGE_PATH` / `EXPORT_STORAGE_PATH` must be private and OUTSIDE the
  deploy dir (defaults lose data on redeploy).

## Test Accounts and Account-Target Rules
- Review harness user: `review@cyflow.test` (browser smokes only, fakes, no DB).
- Exact account targeting is MANDATORY: one selected account → exactly one queue
  target; never fan out to every connected Page. Enforced by
  `resolveRunTargetAccounts` and `tests/queueTargetFanOut.test.js`.

## Next Exact Action
All mandatory release gates pass. The single remaining action is ONE Hostinger
redeploy of branch `cyflow-social-v1` at its new HEAD (the commit that follows
71921ce), then live acceptance on the host: confirm the deployed commit hash,
run a Mon-Sun 1/day generate-ahead-7 Asia/Karachi single-Facebook-Page review
automation under `HOSTINGER_SINGLE_PROCESS_JOBS=true`, and verify the Weekly
Board reaches 7 prepared posts (the banner reads "preparing" until the bounded
worker drains all seven), with `ENABLE_LIVE_PROVIDER_PUBLISHING=false`. No
merge, no PR — deploy this branch only.

## Do Not Repeat
- Do not collapse a specific provider error into a generic "image_generation_failed"
  or a bare "No image" — preserve the category (see `socialImageService`).
- Do not read `err.code` for an image failure; read the normalized `.category`.
- Do not invent statistics/reviews; do not use em/en dashes in generated copy.
- Do not enable live publishing; do not change Hostinger env; do not deploy from
  here.
- Do not write secrets into any Markdown or memory file.

## Last Updated
Phase A (observability) + Phase B (Exact Make Parity hardening) milestone.
Authoritative Make format, phone footer, golden fixtures, integrations health +
Test connection + billable warning, refill diagnostics + banner, browser E2E,
crash-safe checkpoint. Committed to origin cyflow-social-v1. Residual: full
17-item revert-verify, all smokes, 2-of-7 reproduction test (see AI_HANDOFF).

## 2026-07-28 — production unblocked, and the studio stopped forgetting

Two things.

**The week that never built.** Every AI Studio week sat at 0/7. The cause was not
in the code: the live database had never had migration 018 applied, so every read
of a planner item asked for nine columns that did not exist and all seven jobs per
week failed with `Unknown column 'image_status' in 'SELECT'`. It was diagnosed from
outside the login, using only `/health` — which reports studio job counts and the
last failure category precisely because "stuck at 0/7" says nothing. Fixed with
`database/repair/018_provider_error_visibility_safe_rerun.sql`. See CY-007, which
also records the second trap: a shared-hosting database user cannot read
`information_schema`, so a verification query written against it fails AFTER the
ALTERs and reads as "the migration failed".

**The studio stopped forgetting.** Reading a site takes the better part of a
minute and is then corrected field by field; a week takes five to eight minutes to
build. All of that lived in one browser tab. Now the brand is kept server-side on
the user's business profile (no new migration — an existing JSON column, merged
not replaced) and the week in progress is found by asking
(`weekService.findLatestWeek`) rather than by remembering a run id. Nothing is put
in browser storage: a website extract carries a real business's contact details.

Unit 1350/0, integration 52/52 — including three pre-existing failures that had
expired when the calendar passed their hard-coded dates (CY-008).

## 2026-07-28 (later) — the posters get real photographs

The owner looked at the first live week and named the gap exactly: their friend's
app puts the website's real images behind the design, ours had no picture at all,
and the design itself was weaker. Both were true.

**Photographs.** `src/services/aiStudio/posterPhoto.js` fetches a picture from
the site the reader already found and embeds it as a data URI, because resvg
will not fetch a URL from inside an SVG (verified: it draws embedded JPEG and
PNG). Fetching a user-supplied URL server-side is the shape of an SSRF, so every
resolved address is checked before the connection, every redirect is re-checked,
the body is capped as it arrives, and the file must be a JPEG or PNG by its own
magic bytes. A picture that fails any of that is simply absent.

**Design.** The SVG prompt was asking for the OPPOSITE of the project's own
reference analysis: it requested circles, rings, waves and dot grids, and the
analysis records that across ten professional references there is not one
floating shape. It also never asked for the six-part grammar. It does now, and
the copy call returns three supporting points so the content block has real
evidence rather than a void.

**Verified by looking**, per CLAUDE.md: three posters rendered at 1080x1080
through the production SVG path, inspected, a real defect found (footer clipped
at the bottom edge, third list row silently dropped), fixed with coordinates
instead of percentages, re-rendered and inspected again.

Unit 1367/0, integration 52/52.

## 2026-07-28 (end) — the whole path is built

Steps 4, 5 and 6 landed, which completes the product spec end to end: a website
in, a week of posts out, then it runs itself.

The accounts panel is the user's own connections and nothing else. Activate
turns the reviewed week into a real schedule: the first post timed to go
straight away, the rest at a chosen wall-clock time, one a day, in any of the
world's timezones.

Two decisions worth keeping:

**Queueing was not reimplemented.** `plannerService.queueApproved` already
resolves the run's chosen accounts and claims each item atomically, and it holds
no account list of its own on purpose — an earlier version built one and
attached seven Facebook Pages to a single post. Activation writes the selection
onto the RUN and hands over. The integration test asserts exactly one target row
per post, on the chosen account, which is the assertion that catches that
defect returning.

**The first post is scheduled two minutes out, not "now".** Queueing skips a
slot whose time has already passed, so asking for this instant would silently
drop the one post the user was promised would go immediately.

NOTHING PUBLISHES. `ENABLE_LIVE_PROVIDER_PUBLISHING=false` remains the required
state; activation produces a schedule that the publishing phase will act on once
that switch is deliberately turned on, and the screen says so in plain words
rather than implying a post has gone out.

Unit 1371/0, integration 53/53.

## 2026-07-28 (21:1x UTC) — THE FIRST LIVE PUBLISH HAPPENED

Cyflow published to a real account for the first time. One post, one Facebook
Page (Pioneer Construction NYC), from a week the AI Studio generated end to end.
The owner confirmed it on the page itself.

What the evidence showed at the time: `publishing.liveEnabled: true`, and the
web instance we can reach reported `ticks: 0` and `schedulerLeader: false` — it
never won the scheduler lease. The publish came from ANOTHER instance that holds
it. That is the lease working exactly as designed: it exists to stop two
instances publishing the same post twice, and it did.

**Do not read `ticks: 0` on /health as "the scheduler is not running".** On this
host there is more than one process and only the leader ticks. The follower
reporting zero is normal.

Six more posts remain queued, one a day at 02:10 Asia/Karachi (Jul 30 to Aug 4),
all to the same single Page. They go by themselves. To stop them: Queue ->
Cancel per post, or set ENABLE_LIVE_PROVIDER_PUBLISHING=false.

Still to judge: whether the published post actually LOOKS right. That is the
owner's call and it is the only remaining question.

**Published post, reviewed:** the poster carries the grammar end to end and the
caption reads well. One thing to watch, recorded in the acceptance checklist: the
eyebrow said "BRONX BUILDERS" on a post about NYC-wide general contracting. The
designer is allowed to write the eyebrow and it drew on their own content, but it
narrows the business. If it recurs across the remaining six posts, constrain the
eyebrow to words the brand actually uses.
