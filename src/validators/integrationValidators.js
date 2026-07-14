/**
 * express-validator chains for HCTI integration endpoints.
 *
 * The API key is validated for presence/length but its value is NEVER included
 * in validation output. The User ID is trimmed; the API key is only length-
 * bounded (no blind internal trimming that could corrupt a meaningful key).
 */

import { body } from 'express-validator';
import { HCTI_LIMITS } from '../config/constants.js';

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

export default { saveHctiValidator, deleteHctiValidator };
