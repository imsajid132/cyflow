/**
 * `npm run scheduler:once` entrypoint.
 *
 * Phase 1 provides configuration + DB validation only. The actual publishing
 * pipeline (claiming due posts, generating content/images, publishing to
 * providers, retries) is implemented in a later phase. This stub validates the
 * environment and database connection, then exits cleanly without doing work.
 */

import { config } from '../config/env.js';
import { checkHealth, closePool } from '../db/pool.js';

async function main() {
  console.log(`[scheduler] one-shot run in "${config.env}" mode`);

  const db = await checkHealth();
  if (!db.ok) {
    console.log(`[scheduler] database unavailable (${db.error}); nothing to do`);
    await closePool();
    process.exit(1);
    return;
  }

  console.log('[scheduler] database OK');
  console.log(
    '[scheduler] publishing pipeline is not implemented in Phase 1 — no posts processed',
  );

  await closePool();
  process.exit(0);
}

main().catch(async (err) => {
  console.log(`[scheduler] fatal error: ${err?.message || 'unknown'}`);
  await closePool().catch(() => {});
  process.exit(1);
});
