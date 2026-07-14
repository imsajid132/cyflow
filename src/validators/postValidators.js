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
  IMAGE_TEMPLATES,
  ASPECT_RATIO_VALUES,
  BACKGROUND_STYLES,
  CONTENT_TONES,
  HASHTAG_PREFERENCES,
} from '../config/constants.js';

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
  body('template').optional({ nullable: true }).isIn(IMAGE_TEMPLATES).withMessage('Invalid template'),
  body('aspectRatio').optional({ nullable: true }).isIn(ASPECT_RATIO_VALUES).withMessage('Invalid aspect ratio'),
  body('backgroundStyle').optional({ nullable: true }).isIn(BACKGROUND_STYLES).withMessage('Invalid background style'),
];

export const createPostValidator = [...postFields];
export const updatePostValidator = [...postFields];

export const idParamValidator = [
  param('id').matches(/^\d{1,20}$/).withMessage('Invalid post id'),
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
];

export default {
  createPostValidator,
  updatePostValidator,
  idParamValidator,
  listPostsValidator,
  setTargetsValidator,
  scheduleValidator,
};
