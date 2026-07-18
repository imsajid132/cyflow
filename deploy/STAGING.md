# Staging deployment runbook

The canonical order. Every step has a purpose, a command, an expected result and
a stop condition. Nothing here has been executed: no staging environment exists
yet (see the Milestone H report).

**Placeholders** are written `<like-this>`. Never put a real secret, domain,
username or database name in a file you commit.

## Choose your hosting shape first

**Managed single-process hosts (Hostinger managed Node, and similar).**
They run exactly one process from `npm start`. No cron. No SSH-launched worker
that survives. On such a host the durable queue never advances: posts stay
queued, automations never refill, exports never build and deletions never
complete, while the app looks completely healthy.

Set:

```
HOSTINGER_SINGLE_PROCESS_JOBS=true
ENABLE_LIVE_PROVIDER_PUBLISHING=false
```

The web process then runs a scheduler tick and a bounded worker drain every 60
seconds, driving the same services the standalone entry points drive. Skip steps
17 and 18 below — there is no second process and no cron to configure.

Expected in the runtime log after a redeploy:

```
[jobs] Hostinger single-process mode enabled
[jobs] scheduler tick completed (refills=0, publish=disabled, recovered=0)
[jobs] worker drain completed (0 job(s))
```

`publish=disabled` is the correct and expected state: it is
`ENABLE_LIVE_PROVIDER_PUBLISHING=false` doing its job. Nothing is sent to
Facebook, Instagram or Threads.

A redeploy briefly runs the old and new instances together. That is safe: jobs
are claimed under database leases and publishing is keyed by an idempotency key,
so the second instance cannot claim a held job or re-send a post already in
flight. The in-process guards stop an instance overlapping itself; the database
stops instances overlapping each other.

**VPS and hosts that support separate processes.** Leave the flag `false` and
follow the three-process model below — a dedicated worker is better isolated,
and a slow job cannot compete with request handling.

## Before you start

Three processes, not one (unless you set the single-process flag above):

| Process | Command | Model |
| --- | --- | --- |
| Web | `npm start` | persistent |
| Worker | `npm run worker` | persistent, **separate** |
| Scheduler | `npm run scheduler:once` | host cron |

If the worker is not running, the app looks healthy and silently stops
publishing, exporting and deleting. That is the single most common way to
"successfully" deploy this application and have it not work.

---

### 1. Select a confirmed non-production host
**Why** every later step is destructive somewhere if this is wrong.
**Stop if** you cannot prove it is not production from the hostname, the
dashboard and the absence of customer data. "It looks like staging" is not proof.

### 2. Select a confirmed non-production MySQL database
**Stop if** the database name or host contains `prod`, `production`, `live` or
`main` and you have not explicitly confirmed otherwise. `npm run staging:preflight`
blocks on this.

### 3. Record the release candidate
```sh
git rev-parse HEAD          # record this; it is your rollback target
```

### 4. Back up the staging database
```sh
mysqldump --defaults-file="<private-cnf>" --single-transaction --routines --triggers --events \
  "<db-name>" | gzip > "<backup-dir>/staging-<stamp>.sql.gz"

test -s "<backup-dir>/staging-<stamp>.sql.gz" || { echo "EMPTY";  exit 1; }
gzip -t   "<backup-dir>/staging-<stamp>.sql.gz" || { echo "CORRUPT"; exit 1; }
zcat      "<backup-dir>/staging-<stamp>.sql.gz" | tail -5 | grep -q "Dump completed" \
  || { echo "TRUNCATED"; exit 1; }
```
**Stop if** any check fails. `mysqldump | gzip` reports gzip's exit status, so a
dump that died halfway still looks successful. A truncated backup found during a
restore is worse than none, because it was trusted.

### 5. Back up existing staging media
```sh
tar -czf "<backup-dir>/staging-media-<stamp>.tar.gz" -C "<media-path>" .
tar -tzf "<backup-dir>/staging-media-<stamp>.tar.gz" >/dev/null || echo "CORRUPT"
```
Only if staging media already exists. Media bytes are not reconstructible from
the database: `media_assets` stores a key, not the image.

### 6. Configure private environment variables
Copy `.env.example`, fill it in, store it as `0600` owned by the service user, or
use the host's secret manager. **Never commit it.**

`PUBLIC_BASE_URL` must be the exact staging HTTPS origin. OAuth callback URIs
must point at staging — reusing production callbacks sends your users to
production on sign-in.

### 7. Keep live publishing OFF
```
ENABLE_LIVE_PROVIDER_PUBLISHING=false
```
**Do not change this during initial bring-up.** Preflight blocks if it is true.

### 8. Create persistent storage
```sh
npm run staging:init-storage              # check only
npm run staging:init-storage -- --create  # create, then probe
```
Both paths must be **outside** the deployment directory and **different from each
other**: export cleanup sweeps its own root and would delete users' images.
**Stop if** either path is under `public/` or in a temp directory.

### 9. Preflight
```sh
npm run staging:preflight
npm run staging:preflight -- --probe   # also write/read/delete in each storage dir
```
**Expected** `RESULT: PASS`. **Stop if** anything is `BLOCKED`. It prints
variable names and verdicts, never values.

### 10–12. Migration status, check, and review
```sh
npm run migrate:status    # repository inventory
npm run migrate:check     # naming, order, destructive DDL, schema parity — CI-safe
```
This project has **no applied-migration tracking table**, so `migrate:status`
will not guess what a database has applied. Establish it by inspection:
```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema = DATABASE() ORDER BY table_name;
```
Match against the inventory: `publish_attempts` present means 015 is applied.

### 13. Apply pending migrations, explicitly and in order
```sh
for f in database/migrations/0*.sql; do
  echo "== $f"
  mysql --defaults-file="<private-cnf>" "<db-name>" < "$f" || { echo "FAILED: $f"; break; }
done
```
Apply **only pending** migrations. Stop on the first failure — do not continue
past a broken migration hoping the next one fixes it.

### 14. Verify the schema
```sh
mysqldump --defaults-file="<private-cnf>" --no-data --skip-comments "<db-name>" > /tmp/staging-schema.sql
diff <(grep -vE '^\s*(--|/\*)' database/schema.sql) <(grep -vE '^\s*(--|/\*)' /tmp/staging-schema.sql)
```

### 15. Install production dependencies
```sh
npm ci --omit=dev
```

### 16–17. Start web and worker
```sh
pm2 start deploy/pm2/ecosystem.config.cjs      # example; review it first
pm2 status
```
Or use the systemd examples under `deploy/systemd/`.
**Stop if** the worker is not running. See the note at the top.

### 18. Configure the scheduler — one mode only
```cron
*/5 * * * * cd <app-dir> && /usr/bin/env npm run scheduler:once >> <log-path> 2>&1
```
**Never** run host cron and a persistent scheduler together. Both will enqueue
the same due job, and for publishing that means two real posts.

### 19. Health
```sh
npm run staging:health -- https://<staging-host>
```
Reports HTTP, database, worker heartbeat, scheduler last run, live-publishing
flag and job counts separately. A live web process with a dead worker is not
healthy.

### 20–25. Functional smoke with disposable users
Register a disposable staging user (never a customer account). Then: business and
brand profile; media upload and controlled-route access; Save Draft; Schedule
Later; **Publish Now with the flag off — confirm zero provider calls**; a data
export; and account deletion using a **second** disposable user created for that
purpose.

**Never** run the deletion rehearsal against the staging operator account.

### 26. Review logs
Confirm no password, cookie, token, encryption key, provider response body or
filesystem path appears in the logs for any of the above.

### 27. Confirm the rollback point
Release commit recorded (step 3), verified backup exists (step 4), and you have
read the four limits in `staging-rollback-rehearsal.md`.

### 28–30. Record, keep production blocked, providers later
Record the result. Production stays blocked pending explicit approval. Live
provider tests come later, **one provider at a time**, each time-boxed, with the
flag returned to `false` afterwards.
