import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Load environment for the worker. The worker shares the API's secrets (same
 * DATABASE_URL / REDIS_URL / CYFLOW_ENCRYPTION_KEY), so — to avoid duplicating
 * them — it reads, in priority order (first value wins): the worker's own .env,
 * then the shared apps/api/.env, then a repo-root .env. Imported first in
 * main.ts so it runs before anything reads process.env.
 */
const here = dirname(fileURLToPath(import.meta.url)); // apps/worker/src
for (const path of [
  resolve(here, "../.env"), // apps/worker/.env (optional)
  resolve(here, "../../api/.env"), // shared apps/api/.env
  resolve(here, "../../../.env"), // repo-root .env (optional)
]) {
  config({ path });
}
