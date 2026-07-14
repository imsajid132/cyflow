/**
 * `npm run scheduler:once` entrypoint.
 *
 * Phase 1 provides configuration validation only. The actual publishing
 * pipeline (claiming due posts, generating content/images, publishing to
 * providers, retries) is implemented in a later phase.
 *
 * This stub validates configuration (by importing the validated config),
 * reports database connectivity as informational, and exits cleanly WITHOUT
 * processing any posts. It never pretends to have done work. Because it does no
 * real work, an unreachable database is reported but is not treated as a
 * failure — the honest Phase 1 outcome is "nothing processed".
 */

import { config } from '../config/env.js';
import { checkHealth, closePool } from '../db/pool.js';

async function main() {
  console.log(`[scheduler] one-shot run in "${config.env}" mode`);

  const db = await checkHealth();
  console.log(
    db.ok
      ? '[scheduler] database: reachable'
      : `[scheduler] database: unreachable (${db.error}) — informational only`,
  );

  console.log(
    '[scheduler] Phase 1: publishing pipeline is NOT implemented — 0 posts processed',
  );

  await closePool();
  // Honest, safe exit: the stub did no work, so this is success, not failure.
  process.exit(0);
}

main().catch(async (err) => {
  console.log(`[scheduler] fatal error: ${err?.message || 'unknown'}`);
  await closePool().catch(() => {});
  process.exit(1);
});
