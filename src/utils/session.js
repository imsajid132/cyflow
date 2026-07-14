/**
 * Promise wrappers around the callback-based express-session API.
 *
 * These make session fixation prevention (regenerate) and clean logout
 * (destroy) awaitable, and let controllers handle save errors explicitly.
 */

/**
 * Regenerate the session (new session id) to prevent fixation, preserving
 * nothing from the old session. Resolves once the new session is ready.
 * @param {import('express').Request} req
 */
export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Persist the current session to the store.
 * @param {import('express').Request} req
 */
export function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Destroy the server-side session entirely (logout).
 * @param {import('express').Request} req
 */
export function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

export default { regenerateSession, saveSession, destroySession };
