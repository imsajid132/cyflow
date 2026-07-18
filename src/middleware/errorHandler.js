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

/**
 * Safe, non-secret diagnostics for a database driver error.
 *
 * A mysql2 error carries `code` ('ER_PARSE_ERROR'), `errno` (1064) and
 * `sqlState` ('42000'), none of which are secret — they name the class of
 * failure. It ALSO carries `sqlMessage` and `sql`, which contain the statement
 * and its bound values, so those are never touched here.
 *
 * This exists because a real outage was invisible without it: automation
 * creation failed on the deployed host with nothing logged but
 * `errorName: "Error"`, and the actual cause (MySQL-only `CAST(? AS JSON)`
 * syntax rejected by MariaDB) could not be seen from the logs at all.
 */
export function databaseDiagnostics(err) {
  if (!err || typeof err !== 'object') return undefined;
  const code = typeof err.code === 'string' ? err.code : null;
  // mysql2 error codes are ER_*/PROTOCOL_*/ECONN*; anything else is not one.
  const looksLikeDbError = code
    && (/^(ER_|PROTOCOL_|ECONN|EPIPE|ETIMEDOUT|POOL_)/.test(code) || err.sqlState != null);
  if (!looksLikeDbError) return undefined;
  return {
    dbCode: code,
    dbErrno: Number.isInteger(err.errno) ? err.errno : null,
    sqlState: typeof err.sqlState === 'string' ? err.sqlState : null,
  };
}

/**
 * A safe, actionable client message for an unexpected error.
 *
 * "An unexpected error occurred" tells a business owner nothing and tells an
 * operator nothing either. These say what kind of thing went wrong and what to
 * do, without naming a table, a column, a statement or a value.
 */
export function safeInternalMessage(diagnostics) {
  if (!diagnostics) return 'An unexpected error occurred';
  const code = diagnostics.dbCode || '';
  if (/^(ECONN|PROTOCOL_CONNECTION_LOST|ETIMEDOUT|POOL_)/.test(code)) {
    return 'We could not reach the database just now. Nothing was saved. Please try again in a moment.';
  }
  if (/^ER_(PARSE_ERROR|BAD_FIELD_ERROR|NO_SUCH_TABLE|UNKNOWN_COLUMN)/.test(code)) {
    // A schema/compatibility fault. The user cannot fix it and retrying will
    // not help, so say so plainly instead of inviting them to try again.
    return 'This feature is not compatible with the database on this server. Nothing was saved. Please report this to support with the request ID below.';
  }
  if (/^ER_DUP_ENTRY/.test(code)) {
    return 'That already exists. Nothing was changed.';
  }
  if (/^ER_(DATA_TOO_LONG|TRUNCATED|WARN_DATA_OUT_OF_RANGE)/.test(code)) {
    return 'One of the values sent was not something we could store. Nothing was saved. Please check the form and try again.';
  }
  return 'Something went wrong on our side and nothing was saved. Please try again, and report the request ID below if it keeps happening.';
}

/* eslint-disable no-unused-vars */
/**
 * Express error-handling middleware (must keep 4 args).
 */
export function errorHandler(err, req, res, next) {
  /* eslint-enable no-unused-vars */
  const isAppError = err instanceof AppError;
  const statusCode = isAppError && err.statusCode ? err.statusCode : 500;

  // Non-secret driver diagnostics, used for BOTH the log and the client wording.
  const diagnostics = isAppError ? undefined : databaseDiagnostics(err);

  // Decide what message is safe to return to the client.
  let code = ERROR_CODES.INTERNAL_ERROR;
  let message = safeInternalMessage(diagnostics);
  if (isAppError) {
    code = err.code || code;
    message = err.expose ? err.message : safeInternalMessage(undefined);
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
    // Names the failure class without the statement, the values or a stack.
    ...(diagnostics || {}),
    // Which operation was running. Set by the route/service via res.locals so a
    // 500 says WHAT failed, not just that something did.
    operation: res?.locals?.operation || undefined,
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
