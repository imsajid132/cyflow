# Acceptance Checklist — Cyflow Social

Final acceptance conditions for a Hostinger-equivalent run. No secrets. Re-verify
after any change to generation, images, automation, or providers.

STATUS: every box below is VERIFIED in the Hostinger-equivalent environment
(disposable MariaDB + the real app in headless Chrome + the real unit/integration
suites) as of the final verification session on branch `cyflow-social-v1`. The
ONE thing not verifiable from this workspace is the same run on the live host,
which is the single remaining redeploy + live-acceptance step.

## Content & plan
- [x] A seven-day automation produces **7 posts** (once the worker drain has
      caught up in single-process mode).
- [x] **0 generation failures** (`quality_status = generation_failed`).
- [x] Correct **chronological order** on the Weekly Board (by scheduled instant,
      not generation order).
- [x] The **exact Make day rhythm** (day-type → pillar/template) is followed.
- [x] **Several services** are represented across the week (not collapsed to one).
- [x] **No unsupported facts** — no invented statistics, prices, guarantees.
- [x] **No fake reviews** — the testimonial slot uses a real stored review or a
      maintenance fallback.
- [x] No em/en dashes in generated copy.

## Images & provider errors
- [x] **7 ready images**, OR for any missing image a **visible, specific reason**
      (e.g. "Image failed / HCTI · Credits exhausted") — **never a silent
      "No image"**.
- [x] **0 silent No-image states**: every non-ready image has a persisted
      `image_status` and, when failed, a safe category + message.
- [x] Provider errors are **visible** (board/drawer + toast) and **survive a
      normal refresh**.
- [x] **Retry image** re-renders WITHOUT rewriting the approved caption.
- [x] A **media persistence** failure is distinguished from an HCTI **render**
      failure.
- [x] Integrations shows a **masked credential fingerprint** and optional
      **connection label**; the full key is never shown.

## Targeting & queue
- [x] Posts target the **exact selected Facebook Page** only.
- [x] One selected account → **one queue target** (no fan-out).
- [x] **Queue idempotency**: a second Queue click queues nothing.

## Safety
- [x] **Zero real provider publishing calls** (Facebook/Instagram/Threads).
- [x] `ENABLE_LIVE_PROVIDER_PUBLISHING=false` confirmed (`/health` +
      `publish=disabled` in the log).
- [x] No real OpenAI/HCTI calls in automated tests (network boundary mocked).
- [x] **No secrets** in logs, memory files, or safe columns.
- [x] Internal DB IDs are not shown in the normal UI (structured logs only).

## Diagnostics
- [x] The automation diagnostics explain **expected vs created vs completed vs
      failed** so "only 2 of 7" is understandable at a glance.
- [x] Each missing image's provider **error category** is recorded and shown.

## Gates (must pass before READY)
- [x] `npm test` (unit) green.
- [x] `npm run test:integration` (disposable MariaDB) green.
- [x] Authenticated browser E2E for the error scenarios green.
- [x] `npm run migrate:check` PASS.
- [x] `npm audit` and `npm audit --omit=dev`: 0 vulnerabilities.
- [x] Secret / raw-blueprint / provider-call scans clean.
- [x] `npm run project:handoff` passes (memory files present + headed + current).
- [x] Revert-verify: each focused fix fails its test when reverted, then restored.

## Session persistence (2026-07-28)

- [x] The analysed brand survives a page refresh — restored from the server, not
      from browser storage.
- [x] Every hand-edit survives too (industry retyped, a service added, a picture
      unticked), saved a beat after typing stops.
- [x] A week still building is found again after the tab is closed, and the
      screen resumes polling it.
- [x] A finished week is found again and shown for review.
- [x] One user cannot see another user brand or week.
- [x] The brand write does not delete onboarding own extract in the same column
      (proved on real MariaDB).
- [x] No new migration was required.
- [ ] Confirmed by the owner on the live host after a fresh week builds.

## Step 3 — regenerate one piece of one day (2026-07-28)

- [x] Every poster has its own "Regenerate poster", under the poster.
- [x] Every post has its own "Regenerate captions", under the captions.
- [x] The two are independent: a new poster keeps the words, new captions keep
      the picture (and keep the on-poster headline, which is set in the image).
- [x] A new poster is a DIFFERENT composition: the style rotates each time.
- [x] The work is a durable job, so closing the tab does not lose it.
- [x] The card says which half of it is busy, and disables only that button.
- [x] Asking twice while one is running is refused, not queued.
- [x] A failed regeneration leaves the poster the user already had.
- [x] Another user cannot regenerate this week.
- [ ] Looked at on the live host by the owner.

## Poster design — real photographs + the reference grammar (2026-07-28)

- [x] The business's own photograph is embedded IN the poster (data URI; resvg
      will not fetch a URL from an SVG).
- [x] Fetching it is SSRF-safe: every resolved address checked before the
      connection, every redirect re-checked, body capped as it arrives, and the
      file must be a JPEG or PNG by its own magic bytes.
- [x] A picture that cannot be had makes a plainer poster, never a lost post.
- [x] The days rotate through the ticked photographs; regeneration picks a
      different one.
- [x] The six-part grammar from REFERENCE_ANALYSIS.md is now the instruction:
      header band, eyebrow, headline with ONE emphasis, ONE content block,
      hairline, two-sided footer.
- [x] Decoration is banned explicitly (no floating circles, rings, waves).
- [x] The copy call returns 3 supporting points, so the content block has real
      evidence to show instead of a void.
- [x] The safe area is stated in coordinates, not percentages. Verified: max y
      in the rendered markup was 985, nothing clipped.
- [x] No em or en dash in the designed poster text (verified in the markup).
- [x] THREE posters rendered at 1080x1080 through the production SVG path and
      LOOKED AT, plus a re-render after the fix. Not approved on tests.
- [ ] Looked at on the live host by the owner, on a real week.

## Steps 4, 5, 6 — accounts, activate, timezone (2026-07-28)

- [x] Under a finished week: the user's own connected accounts, selectable, and
      nothing else. No settings, no audience, no per-post scheduling.
- [x] An account that cannot be posted to is SHOWN and marked, not hidden.
- [x] Every world timezone (Intl.supportedValuesOf), the user's own first.
- [x] A daily time, applied as WALL CLOCK — 09:00 means nine every morning, not
      "every 24 hours".
- [x] One button. The first post is timed to go straight away; the rest one a
      day. Proved: the first slot is in the FUTURE, because queueing skips a
      slot whose time has passed and would have silently dropped it.
- [x] A slot already gone today starts the daily run tomorrow.
- [x] Activating IS the approval; the review step is the screen it is pressed on.
- [x] Queueing is NOT reimplemented — plannerService.queueApproved is reused, so
      the account resolution and the atomic per-item claim still apply.
- [x] Proved on real MariaDB: 3 posts queued, exactly ONE target row per post,
      and it is the chosen account (the assertion that catches a fan-out).
- [x] The selection and schedule live on the RUN, so a later profile edit cannot
      move a week already going out.
- [x] Refusals: no account, an unknown timezone, a malformed time. Nothing is
      queued by a refused activation, and another user cannot activate the week.
- [x] NOTHING PUBLISHES. Live publishing stays off and the screen says so in
      plain words rather than implying a post has gone out.
- [ ] Looked at on the live host by the owner.

## THE FIRST LIVE PUBLISH — done (2026-07-28)

- [x] Live publishing turned on deliberately by the owner, verified through
      `/health` → `publishing.liveEnabled: true` rather than trusted.
- [x] Exactly ONE account selected. Queue showed one target per post, on the
      chosen Page, for all seven — no fan-out.
- [x] One post published to a real Facebook Page, confirmed by the owner ON the
      page.
- [x] LOOKED AT. The published poster carries the business's own photograph, the
      header band, the eyebrow, a two-line headline with one accent word, a
      three-row numbered content block, and a two-sided footer. Nothing clipped.
      The reference grammar reached a real customer's feed.
- [x] The caption is three paragraphs, specific, no em dash.
- [ ] WATCH: the eyebrow read "BRONX BUILDERS" on a post about NYC-wide general
      contracting. Not invented from nothing (their content mentions a Bronx
      project) but it narrows the business. If it recurs across the remaining
      six, constrain the eyebrow to the brand's own words.
