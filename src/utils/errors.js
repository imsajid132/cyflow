/**
 * Reusable application error classes.
 *
 * Every error carries an HTTP `statusCode` and a stable machine `code` used in
 * the API error envelope. `message` is expected to be safe to surface to
 * clients (never embed secrets). Unexpected/programming errors should become a
 * generic 500 in the error handler.
 */

import { ERROR_CODES } from '../config/constants.js';

export class AppError extends Error {
  /**
   * @param {string} message safe, client-facing message
   * @param {object} [options]
   * @param {number} [options.statusCode=500]
   * @param {string} [options.code]
   * @param {boolean} [options.expose=true] whether message is safe to return
   * @param {object} [options.details] optional structured details (validation)
   * @param {unknown} [options.cause] original error, for internal logging only
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? ERROR_CODES.INTERNAL_ERROR;
    this.expose = options.expose ?? true;
    if (options.details !== undefined) this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
    // Mark as an intentional, operational error (vs. a bug).
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details) {
    super(message, {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      details,
    });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { statusCode: 401, code: ERROR_CODES.AUTHENTICATION_ERROR });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, { statusCode: 403, code: ERROR_CODES.AUTHORIZATION_ERROR });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, { statusCode: 404, code: ERROR_CODES.NOT_FOUND });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, { statusCode: 409, code: ERROR_CODES.CONFLICT });
  }
}

export class ExternalServiceError extends AppError {
  constructor(message = 'An external service failed', options = {}) {
    super(message, {
      statusCode: options.statusCode ?? 502,
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      cause: options.cause,
    });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, { statusCode: 429, code: ERROR_CODES.RATE_LIMIT_EXCEEDED });
  }
}

export class ConfigurationError extends AppError {
  constructor(message = 'Server misconfiguration') {
    super(message, {
      statusCode: 500,
      code: ERROR_CODES.CONFIGURATION_ERROR,
      // Configuration problems are internal — do not leak specifics.
      expose: false,
    });
  }
}

export default {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ExternalServiceError,
  RateLimitError,
  ConfigurationError,
};
