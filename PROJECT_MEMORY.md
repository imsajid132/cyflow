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
