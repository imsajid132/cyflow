/**
 * Centralized error handling.
 *
 * - `notFoundHandler` produces a JSON 404 for unmatched API routes.
 * - `errorHandler` converts any thrown/forwarded error into the safe API error
 *   envelope. Operational `AppError`s expose their message; everything else is
 *   reported as a generic 500 with no internal detail. Errors are logged with
 *   sensitive fields redacted.
 */

import { AppError } from '../utils/errors.js';
import { ERROR_CODES } from '../config/constants.js';
import { redact } from '../utils/redaction.js';
import { config } from '../config/env.js';

/** JSON 404 for unmatched API endpoints. */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: 'The requested resource was not found',
    },
    requestId: req.id ?? null,
  });
}

/* eslint-disable no-unused-vars */
/**
 * Express error-handling middleware (must keep 4 args).
 */
export function errorHandler(err, req, res, next) {
  /* eslint-enable no-unused-vars */
  const isAppError = err instanceof AppError;
  const statusCode = isAppError && err.statusCode ? err.statusCode : 500;

  // Decide what message is safe to return to the client.
  let code = ERROR_CODES.INTERNAL_ERROR;
  let message = 'An unexpected error occurred';
  if (isAppError) {
    code = err.code || code;
    message = err.expose ? err.message : message;
  }

  // Log server-side with redaction; keep stack only in non-production.
  const logPayload = {
    requestId: req.id ?? null,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
    // err.message can contain safe text; redact any structured context.
    errorName: err?.name,
    details: err?.details ? redact(err.details) : undefined,
  };
  if (statusCode >= 500) {
    // Unexpected/internal — log at error level.
    console.error('[error]', JSON.stringify(logPayload), config.isDev ? err?.stack : '');
  } else {
    console.warn('[warn]', JSON.stringify(logPayload));
  }

  if (res.headersSent) {
    return next(err);
  }

  const body = {
    success: false,
    error: { code, message },
    requestId: req.id ?? null,
  };
  // Include validation details only when the error explicitly exposes them.
  if (isAppError && err.expose && err.details && code === ERROR_CODES.VALIDATION_ERROR) {
    body.error.details = redact(err.details);
  }
  res.status(statusCode).json(body);
}

export default { errorHandler, notFoundHandler };
