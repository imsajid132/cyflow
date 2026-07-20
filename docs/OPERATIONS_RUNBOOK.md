# Operations Runbook — Cyflow Social

Operator procedures. Complements `deploy/STAGING.md` (full deploy order) and
`deploy/RELEASE-CANDIDATE.md`. No secrets. Read-only commands are marked (RO).

## Hostinger redeploy procedure (managed single-process)
1. Confirm env on the host: `ENABLE_LIVE_PROVIDER_PUBLISHING=false`,
   `HOSTINGER_SINGLE_PROCESS_JOBS=true`, DB vars, `ENCRYPTION_KEY`,
   `MEDIA_STORAGE_PATH` and `EXPORT_STORAGE_PATH` (private, outside deploy dir).
2. `npm run migrate:status` (RO) and `npm run migrate:check` (RO) to confirm the
   migration inventory. Apply any NEW migration manually, in order, with the
   mysql client (head is `018`). schema.sql is the full snapshot for a fresh DB.
3. Deploy the branch build. `npm start` is the only process.
4. Watch the runtime log for the expected lines (below).

## Runtime-log checks
Expected after a redeploy in single-process mode:
```
[jobs] Hostinger single-process mode enabled
[jobs] scheduler tick completed (refills=…, publish=disabled, recovered=…)
[jobs] worker drain completed (N job(s))
```
`publish=disabled` is CORRECT (the flag doing its job).
Search the logs for provider failures (new structured lines):
```
provider_operation_failed   hcti   credits_exhausted   authentication_failed
image_render_failed   job_failed   rate_limited   network_timeout
```
Each line is a single safe JSON object — no keys, tokens or post copy.

## Scheduler lease checks
`GET /health` reports `worker.pendingJobs / runningJobs / staleJobs` and
`background`. In single-process mode the web process holds the scheduler lease;
a persistent second scheduler must NEVER run alongside it. Stale jobs are
recovered automatically on the first tick.

## Normal refresh instructions
Provider errors and image-failure states are PERSISTED, so a normal page refresh
preserves them (the board re-reads the item's `image_*` columns). If an error
disappears on refresh, that is a bug — it must survive.

## Automation acceptance procedure
1. Create the automation (Facebook, one account, timezone, weekdays, times,
   posts/day, generate-ahead, review mode). Confirm the pre-submit summary.
2. Activate. In single-process mode, allow several 60s ticks for the bounded
   worker drain to prepare the full horizon (do NOT judge "2 of 7" before the
   drain has caught up — check the automation diagnostics counts).
3. Open the Weekly Board: verify count, chronological order, images (or a
   specific failure reason), exact account targeting, no invented facts.

## Queue acceptance procedure
Approve items, click Queue once. One selected account → exactly one target.
Queue is idempotent (a second click queues nothing). Nothing is published while
`ENABLE_LIVE_PROVIDER_PUBLISHING=false`.

## Provider-health checks
Integrations page shows per-provider status (Connected / Not configured / Error),
an optional connection label, a masked credential fingerprint (last 4 only),
last successful / last failed use, last error category, and last check. Use
"Test connection" for a manual, safe health probe (warns before any billable
test; never reveals the key).

## HCTI credit/authentication troubleshooting
- Board shows "Image failed / HCTI · Credits exhausted" → check the HCTI account
  balance / top up credits, then Retry image.
- "HCTI · Authentication failed" → the credentials were rejected; update them on
  Integrations and re-test.
- "HCTI · Rate limited" / "Timed out" → transient; Retry image shortly.
- "Media storage error" → the render succeeded but persistence failed; check
  `MEDIA_STORAGE_PATH` is writable, then Retry image.

## OpenAI authentication/quota troubleshooting
- "OpenAI rejected the API key" → update it on Integrations.
- "OpenAI quota was exceeded" / credits → check the OpenAI plan and billing.

## How to stop a broken automation
Pause (keeps prepared history, stops new generation) or Stop (keeps prepared
history, ends the automation). A stopped automation's approved/queued posts
still count as content history.

## How to preserve a failed plan as evidence
Do NOT delete it. A plan with published history is archived, never destroyed.
For a failed automation run, leave it in place and capture the board + the
automation diagnostics; the item `image_*` columns and `activity_logs` carry the
safe failure detail.

## How to clean test posts safely
Delete the specific test plan/automation via the UI (owner-scoped). Never run ad
hoc DELETE against the DB in a shared environment.

## How to confirm live publishing remains disabled
`GET /health` → `publishing.liveEnabled: false`. Runtime log shows
`publish=disabled`. `grep` the code/scans confirm provider publish calls are
gated by `config.publishing.liveEnabled`.
