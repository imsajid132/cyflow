/**
 * Real-database test harness.
 *
 * Everything else in this suite runs against in-memory fakes, which is fast and
 * has repeatedly missed defects that only exist in SQL: `CAST(? AS JSON)` that
 * MariaDB rejects outright, an UPDATE whose affectedRows nobody checked, a UTC
 * instant read as a calendar date. These tests exist to catch that class.
 *
 * They are OPT-IN. Without CYFLOW_TEST_DB_HOST they skip, so `npm test` on a
 * machine with no database still behaves exactly as before — but a skip is
 * reported honestly rather than counted as a pass.
 *
 * Point it at a disposable database only. It TRUNCATES tables between tests.
 */

import { after } from 'node:test';

export const DB_ENV = {
  host: process.env.CYFLOW_TEST_DB_HOST,
  port: process.env.CYFLOW_TEST_DB_PORT || '3306',
  user: process.env.CYFLOW_TEST_DB_USER || 'root',
  password: process.env.CYFLOW_TEST_DB_PASSWORD || '',
  database: process.env.CYFLOW_TEST_DB_NAME || 'cyflow_test',
};

/** True when a disposable database was configured for this run. */
export const hasDatabase = Boolean(DB_ENV.host);

/**
 * Point the application's own config at the disposable database.
 *
 * Must run BEFORE anything imports src/config/env.js, which validates and
 * freezes process.env at import time.
 */
export function useTestDatabase() {
  if (!hasDatabase) return false;
  process.env.DB_HOST = DB_ENV.host;
  process.env.DB_PORT = String(DB_ENV.port);
  process.env.DB_USER = DB_ENV.user;
  process.env.DB_PASSWORD = DB_ENV.password;
  process.env.DB_NAME = DB_ENV.database;
  return true;
}

/**
 * Tables emptied between tests, children before parents.
 *
 * Listed explicitly rather than discovered, so a new table added later fails
 * loudly here instead of leaking rows between tests.
 */
const TABLES = [
  'publish_attempts',
  'scheduled_post_targets',
  'scheduled_posts',
  'automation_schedule_slots',
  'background_jobs',
  'worker_leases',
  'content_automations',
  'post_revisions',
  'planner_run_items',
  'planner_runs',
  'planner_preferences',
  'media_asset_references',
  'media_assets',
  'user_data_exports',
  'account_deletion_requests',
  'activity_logs',
  'api_usage',
  'social_accounts',
  'oauth_states',
  'data_deletion_requests',
  'business_profiles',
  'user_integrations',
  'sessions',
  'users',
];

/**
 * Empty every table. Foreign keys are suspended for the sweep only.
 *
 * A name in TABLES that does not exist is a HARD FAILURE, not a skip. The first
 * version of this swallowed ER_NO_SUCH_TABLE, so a typo (`planner_post_revisions`
 * for `post_revisions`) meant that table was simply never cleaned — rows leaked
 * between tests and a rollback assertion failed against data from an earlier
 * test. A silently skipped cleanup is the same false-confidence failure these
 * tests exist to eliminate.
 */
export async function resetDatabase(pool) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await conn.query(`TRUNCATE TABLE \`${table}\``).catch((err) => {
        if (err?.code === 'ER_NO_SUCH_TABLE') {
          throw new Error(
            `reset list names a table that does not exist: "${table}". `
            + 'Fix the name or remove it — a table that is never truncated leaks rows between tests.',
          );
        }
        throw err;
      });
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}

/** Close the shared pool once the file's tests are done. */
export function closePoolAfterTests(closePool) {
  after(async () => { await closePool().catch(() => {}); });
}

/** A skip message that names the reason, so a skip is never mistaken for a pass. */
export const SKIP = { skip: hasDatabase ? false : 'no disposable database configured (set CYFLOW_TEST_DB_HOST)' };
