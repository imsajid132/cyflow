/**
 * Request-ID middleware.
 *
 * Assigns each request a UUID (honoring an inbound `X-Request-Id` if it looks
 * safe) and echoes it back in the `X-Request-Id` response header. The id is
 * available as `req.id` and included in every API response envelope + logs.
 */

import crypto from 'node:crypto';

// Accept an inbound id only if it is a short, safe token (avoid header injection
// / log-forging via arbitrary client input).
const SAFE_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

export function requestId(req, res, next) {
  const inbound = req.get('x-request-id');
  const id = inbound && SAFE_ID_RE.test(inbound) ? inbound : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export default requestId;
