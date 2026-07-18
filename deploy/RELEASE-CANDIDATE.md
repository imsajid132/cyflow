# Release candidate

| | |
| --- | --- |
| Branch | `cyflow-social-v1` |
| Node | `>=20` (developed on 24.x) |
| Migrations | 010 → 017, applied in order |
| Migration 018 | does not exist |
| Live publishing | **`false`** — required initial state |
| Staging | **not yet deployed** |
| Production | **not approved** |

The commit is whatever `git rev-parse HEAD` reports on this branch; this file is
kept in the repository so the requirements travel with the code rather than
living in a report that a deploying operator may never read.

## Required processes

| Process | Command |
| --- | --- |
| Web | `npm start` |
| Worker | `npm run worker` |
| Scheduler | `npm run scheduler:once` via host cron, **or** a persistent scheduler — never both |

On a managed single-process host (Hostinger managed Node), set
`HOSTINGER_SINGLE_PROCESS_JOBS=true` instead: `npm start` is then the only
process, and it runs the scheduler and worker responsibilities on a 60-second
timer. Leave it `false` anywhere a separate worker can be supervised.

## Required persistent paths

Both outside the deployment directory, both private, and **different from each
other**:

- `MEDIA_STORAGE_PATH` — uploaded and generated images
- `EXPORT_STORAGE_PATH` — user data-export archives

Defaults are a temp directory and `<cwd>/.data/exports` respectively. Both are
correct for development and **lose data on redeploy** in a real environment.

## Operator commands

| Command | Purpose |
| --- | --- |
| `npm run staging:preflight` | read-only configuration verification |
| `npm run staging:init-storage` | validate storage paths (`-- --create` to create) |
| `npm run staging:health` | liveness and readiness of a deployed environment |
| `npm run migrate:status` | repository migration inventory |
| `npm run migrate:check` | static migration verification, CI-safe |

None of these deploys anything, applies a migration, or calls a provider.

## Verification status

- unit tests: full suite green
- `npm audit` and `--omit=dev`: 0 vulnerabilities
- nine browser suites green against **fake providers**
- Facebook, Instagram, Threads: `fake_provider_verified` — **none live-verified**

## Known limitations

- no staging environment has existed yet, so nothing here has run against a real
  host, a real database or a real TLS terminator
- migrations are verified structurally; they have not been executed against MySQL
- no screen-reader or touch accessibility pass
- the `.data/` default paths are development conveniences, not deployment targets
