/**
 * express-validator chains for the integration endpoints (HCTI and OpenAI).
 *
 * Every API key is validated for presence/length but its value is NEVER included
 * in validation output. The HCTI User ID is trimmed; the HCTI API key is only
 * length-bounded (no blind internal trimming that could corrupt a meaningful
 * key).
 */

import { body } from 'express-validator';
import { HCTI_LIMITS, OPENAI_LIMITS, OPENAI_MODELS } from '../config/constants.js';

// Printable, non-control characters for the HCTI User ID.
const PRINTABLE = /^[\x20-\x7E]+$/;

export const saveHctiValidator = [
  body('hctiUserId')
    .exists({ checkNull: true })
    .withMessage('HCTI User ID is required')
    .bail()
    .isString()
    .withMessage('HCTI User ID must be a string')
    .bail()
    .trim()
    .isLength({ min: 1, max: HCTI_LIMITS.USER_ID_MAX })
    .withMessage(`HCTI User ID must be 1-${HCTI_LIMITS.USER_ID_MAX} characters`)
    .bail()
    .matches(PRINTABLE)
    .withMessage('HCTI User ID contains invalid characters'),
  body('hctiApiKey')
    .exists({ checkNull: true })
    .withMessage('HCTI API Key is required')
    .bail()
    .isString()
    .withMessage('HCTI API Key must be a string')
    .bail()
    // Do NOT trim internal/meaningful characters; only bound the length.
    .isLength({ min: 1, max: HCTI_LIMITS.API_KEY_MAX })
    .withMessage(`HCTI API Key must be 1-${HCTI_LIMITS.API_KEY_MAX} characters`),
];

export const deleteHctiValidator = [
  body('confirm')
    .exists({ checkNull: true })
    .withMessage('Confirmation is required')
    .bail()
    .equals('DELETE')
    .withMessage('Type DELETE to confirm'),
];

/**
 * The customer's OpenAI API key.
 *
 * Presence and length only. The VALUE is never echoed in a validation message —
 * "sk-abc… is not a valid key" would put the secret in an error body, and error
 * bodies get logged.
 *
 * Deliberately no format regex. OpenAI has changed its key prefixes more than
 * once (sk-, sk-proj-, sk-svcacct-), and a pattern that is wrong tomorrow
 * rejects a key that works. The provider is the authority on whether a key is
 * valid, and Test connection asks it.
 */
export const saveOpenAiValidator = [
  body('apiKey')
    .exists({ checkNull: true })
    .withMessage('An OpenAI API key is required')
    .bail()
    .isString()
    .withMessage('The OpenAI API key must be a string')
    .bail()
    .trim()
    .isLength({ min: 1, max: OPENAI_LIMITS.API_KEY_MAX })
    .withMessage(`The OpenAI API key must be 1-${OPENAI_LIMITS.API_KEY_MAX} characters`)
    .bail()
    .matches(PRINTABLE)
    .withMessage('The OpenAI API key contains invalid characters'),
  // An allow-list, not free text: the key is the customer's, but the model has
  // to be one this application's prompts and strict schemas are written for.
  body('model')
    .optional({ nullable: true })
    .isIn(OPENAI_MODELS)
    .withMessage('Choose a supported model'),
];

export const deleteOpenAiValidator = [
  body('confirm')
    .exists({ checkNull: true })
    .withMessage('Confirmation is required')
    .bail()
    .equals('DELETE')
    .withMessage('Type DELETE to confirm'),
];

export default {
  saveHctiValidator,
  deleteHctiValidator,
  saveOpenAiValidator,
  deleteOpenAiValidator,
};
