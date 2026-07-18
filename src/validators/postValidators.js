/**
 * express-validator chains for post/draft/scheduling endpoints.
 *
 * Strict maximum lengths and preset membership; sensitive/privileged fields
 * (role, userId, status, attempt counts, provider ids) are never accepted.
 * Ownership always comes from the session, never the body. Values are never
 * echoed in validation output.
 */

import { body, param, query } from 'express-validator';
import {
  GENERATION_LIMITS,
  IMAGE_TEMPLATE_VALUES,
  ASPECT_RATIO_VALUES,
  BACKGROUND_STYLES,
  CONTENT_TONES,
  HASHTAG_PREFERENCES,
  PLATFORM_VALUES,
} from '../config/constants.js';

// E: a hand-edited per-platform copy payload — { platform: { postCopy, hashtags[] } }
// for SELECTED, supported platforms only. Deep content rules live in the service;
// this bounds shape + size and rejects unsupported platforms up front.
const HARD_COPY_MAX = 100000;
const platformCaptionsValidator = body('platformCaptions')
  .optional({ nullable: true })
  .isObject().withMessage('Invalid platform copy')
  .bail()
  .custom((value) => {
    const keys = Object.keys(value);
    if (keys.length > 5) throw new Error('Too many platforms');
    for (const k of keys) {
      if (!PLATFORM_VALUES.includes(k)) throw new Error('Unsupported platform');
      const entry = value[k];
      if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid platform entry');
      if (entry.postCopy != null && typeof entry.postCopy !== 'string') throw new Error('Invalid post copy');
      if (typeof entry.postCopy === 'string' && entry.postCopy.length > HARD_COPY_MAX) throw new Error('Post copy is too long');
      if (entry.hashtags != null && !Array.isArray(entry.hashtags)) throw new Error('Invalid hashtags');
      if (Array.isArray(entry.hashtags) && entry.hashtags.length > 60) throw new Error('Too many hashtags');
    }
    return true;
  });

const expectedVersionValidator = body('expectedVersion')
  .optional({ nullable: true }).isInt({ min: 1, max: 2000000000 }).withMessage('Invalid version');

const optionalString = (field, max) =>
  body(field).optional({ nullable: true }).isString().withMessage(`${field} must be a string`).bail().isLength({ max }).withMessage(`${field} is too long`);

const postFields = [
  optionalString('title', GENERATION_LIMITS.TITLE_MAX),
  optionalString('brief', GENERATION_LIMITS.BRIEF_MAX),
  optionalString('brandName', GENERATION_LIMITS.BRAND_MAX),
  optionalString('callToAction', GENERATION_LIMITS.CTA_MAX),
  optionalString('language', GENERATION_LIMITS.LANGUAGE_MAX),
  optionalString('additionalInstructions', GENERATION_LIMITS.INSTRUCTIONS_MAX),
  body('tone').optional({ nullable: true }).isIn(CONTENT_TONES).withMessage('Invalid tone'),
  body('hashtagPreference').optional({ nullable: true }).isIn(HASHTAG_PREFERENCES).withMessage('Invalid hashtag preference'),
  body('template').optional({ nullable: true }).isIn(IMAGE_TEMPLATE_VALUES).withMessage('Invalid template'),
  body('aspectRatio').optional({ nullable: true }).isIn(ASPECT_RATIO_VALUES).withMessage('Invalid aspect ratio'),
  body('backgroundStyle').optional({ nullable: true }).isIn(BACKGROUND_STYLES).withMessage('Invalid background style'),
  // Brand overlay toggles — which business-profile details appear on the image.
  body('includeLogo').optional({ nullable: true }).isBoolean().withMessage('Invalid includeLogo'),
  body('includeWebsite').optional({ nullable: true }).isBoolean().withMessage('Invalid includeWebsite'),
  body('includePhone').optional({ nullable: true }).isBoolean().withMessage('Invalid includePhone'),
];

export const createPostValidator = [...postFields];
export const updatePostValidator = [...postFields];

export const idParamValidator = [
  param('id').matches(/^\d{1,20}$/).withMessage('Invalid post id'),
];

export const selectMediaValidator = [
  ...idParamValidator,
  // Null clears the attached image; otherwise an owned media id.
  body('mediaAssetId').optional({ nullable: true }).matches(/^\d{1,20}$/).withMessage('Invalid media id'),
];

export const listPostsValidator = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  query('offset').optional().isInt({ min: 0, max: 100000 }).withMessage('Invalid offset'),
  query('status').optional().isString().isLength({ max: 20 }),
];

export const setTargetsValidator = [
  body('targets').isArray({ min: 0, max: 20 }).withMessage('targets must be an array'),
  body('targets.*.socialAccountId').matches(/^\d{1,20}$/).withMessage('Invalid account id'),
  body('targets.*.captionOverride')
    .optional({ nullable: true })
    .isString()
    .withMessage('caption must be a string')
    .bail()
    .isLength({ max: GENERATION_LIMITS.CAPTION_OVERRIDE_MAX })
    .withMessage('caption is too long'),
];

export const scheduleValidator = [
  body('scheduledDate').isString().matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Invalid date'),
  body('scheduledTime').isString().matches(/^\d{2}:\d{2}$/).withMessage('Invalid time'),
  body('timezone').isString().isLength({ min: 1, max: 64 }).withMessage('Invalid timezone'),
  expectedVersionValidator,
];

// E: Save Draft — brief/params (all optional) + optional hand-edited copy + version.
export const saveDraftValidator = [
  ...postFields,
  platformCaptionsValidator,
  expectedVersionValidator,
];

// E: Publish Now — only an optional expected version (readiness is server-side).
export const publishNowValidator = [
  expectedVersionValidator,
];

export default {
  createPostValidator,
  updatePostValidator,
  idParamValidator,
  listPostsValidator,
  setTargetsValidator,
  scheduleValidator,
  saveDraftValidator,
  publishNowValidator,
};
