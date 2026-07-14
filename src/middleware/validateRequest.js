/**
 * Request-validation middleware for express-validator.
 *
 * Usage:
 *   router.post('/x', validate([ body('email').isEmail(), ... ]), handler)
 *
 * Runs the provided validation chains, then collects results. On failure it
 * throws a `ValidationError` (handled centrally) with a safe, structured list
 * of field errors — no raw values echoed back.
 */

import { validationResult } from 'express-validator';
import { ValidationError } from '../utils/errors.js';

/**
 * @param {import('express-validator').ValidationChain[]} [chains=[]]
 * @returns {import('express').RequestHandler}
 */
export function validate(chains = []) {
  return async function runValidation(req, res, next) {
    try {
      await Promise.all(chains.map((chain) => chain.run(req)));
      const result = validationResult(req);
      if (result.isEmpty()) return next();

      // Map to a safe shape: field + message only (never the submitted value).
      const details = result.array({ onlyFirstError: true }).map((e) => ({
        field: e.path ?? e.param ?? 'unknown',
        message: e.msg,
      }));
      return next(new ValidationError('Validation failed', details));
    } catch (err) {
      return next(err);
    }
  };
}

export default validate;
