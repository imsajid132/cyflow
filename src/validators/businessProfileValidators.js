/**
 * express-validator chains for business profile endpoints.
 *
 * Structural checks only — the authoritative whitelist, normalization, and
 * unknown-field rejection live in businessProfileService.validateProfilePatch
 * (single source of truth). Values are never echoed in validation output.
 */

import { body } from 'express-validator';
import { BUSINESS_LIMITS } from '../config/constants.js';

export const analyzeWebsiteValidator = [
  body('websiteUrl')
    .exists({ checkNull: true })
    .withMessage('A website URL is required')
    .bail()
    .isString()
    .withMessage('The website URL must be text')
    .bail()
    .isLength({ min: 3, max: BUSINESS_LIMITS.URL_MAX })
    .withMessage('A valid website URL is required'),
];

export const updateProfileValidator = [
  body().custom((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid business details');
    }
    return true;
  }),
];

export default { analyzeWebsiteValidator, updateProfileValidator };
