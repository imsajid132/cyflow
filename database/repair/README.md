# Repair scripts

Not migrations. The numbered files in `database/migrations/` are the schema's
history: each runs exactly once, in order, and never changes after it is
committed. The files here are for putting a database that has drifted from that
history back onto it — run by hand, in a hosting panel, against a database whose
actual state nobody is certain of.

So they are written the other way round from a migration:

- **safe to run twice**, and three times: `IF NOT EXISTS` on every step;
- **safe to run partly applied** — an already-correct database is left alone;
- **nothing dropped, nothing rewritten, no existing row touched**;
- **verified with statements a hosting user can actually run.**

That last one is not a detail. `information_schema` is not readable by a shared
hosting database user, so a check written against it fails with "Access denied"
on exactly the machine it exists to check — and that error reads as "the
migration failed" when the columns are already in place. Use `SHOW COLUMNS`.

## When one of these is needed

A deployment where the code is a version ahead of the database. The symptom is
not subtle: every job that reads the new column fails with `Unknown column ... in
'SELECT'`, and `/health` reports them. Check what the database actually has
before assuming which side is wrong:

```sql
SHOW COLUMNS FROM `planner_run_items` LIKE 'image%';
```

## The scripts

| File | Puts back |
| --- | --- |
| `018_provider_error_visibility_safe_rerun.sql` | Migration 018 — the nine `image_*` columns on `planner_run_items` and the six health columns on `user_integrations`. |

A repair script is a copy of a migration, so the two must not drift. If you
change a migration that has a repair script here, change the script with it.
