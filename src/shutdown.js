/**
 * Reusable, side-effect-free shutdown helpers.
 *
 * These do NOT call `process.exit` — that stays in `server.js`, so this module
 * can be exercised directly by lifecycle tests. Each step is awaited and safe to
 * call when the underlying resource does not exist.
 */

import { closePool } from './db/pool.js';

/** Close an HTTP server and wait for in-flight connections to drain. */
export async function closeHttpServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Close a session store if it exposes a `close()` method. `express-mysql-session`
 * owns its own connection pool and an expiry-check timer; closing it releases
 * both. The default MemoryStore has no `close()` and is skipped.
 */
export async function closeSessionStore(store) {
  if (store && typeof store.close === 'function') {
    await store.close();
  }
}

/**
 * Gracefully release all runtime resources in the correct order:
 * HTTP server → session store → database pool.
 * @param {{ server?: import('http').Server, app?: import('express').Express }} resources
 */
export async function gracefulClose({ server, app } = {}) {
  await closeHttpServer(server);
  if (app && typeof app.get === 'function') {
    await closeSessionStore(app.get('sessionStore'));
  }
  await closePool();
}

export default { closeHttpServer, closeSessionStore, gracefulClose };
