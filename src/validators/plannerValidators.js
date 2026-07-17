/**
 * express-validator chains for planner endpoints.
 *
 * These do fast structural validation (types, bounds, preset membership). The
 * full semantic rules live in plannerService.validatePreferencePatch, which is
 * the single source of truth and also produces safe 400 ValidationErrors.
 *
 * Ownership always comes from the session — a user id is never accepted from a
 * body or param. Validation responses never echo submitted values.
 */

import { body, param, query } from 'express-validator';
import {
  PLANNER_CADENCES,
  PLANNER_TONES,
  PLANNER_CTA_MODES,
  PLANNER_APPROVAL_MODES,
  PLANNER_GOALS,
  PLANNER_LIMITS,
  PLATFORM_VALUES,
  IMAGE_TEMPLATE_VALUES,
  ASPECT_RATIO_VALUES,
  BACKGROUND_STYLES,
  RHYTHM_PRESETS,
} from '../config/constants.js';

const idPattern = /^\d{1,20}$/;

export const preferencesValidator = [
  body('cadence').optional({ nullable: true }).isIn(PLANNER_CADENCES).withMessage('Invalid cadence'),
  body('weekdays').optional({ nullable: true }).isArray({ max: 7 }).withMessage('Invalid weekdays'),
  body('weekdays.*').optional().isInt({ min: 1, max: 7 }).withMessage('Invalid weekday'),
  body('times').optional({ nullable: true }).isArray({ max: PLANNER_LIMITS.MAX_TIMES_PER_DAY }).withMessage('Invalid times'),
  body('times.*').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Times must be HH:MM'),
  body('platforms').optional({ nullable: true }).isArray({ max: 3 }).withMessage('Invalid platforms'),
  body('platforms.*').optional().isIn(PLATFORM_VALUES).withMessage('Unsupported platform'),
  body('goals').optional({ nullable: true }).isArray({ max: 7 }).withMessage('Invalid goals'),
  body('goals.*').optional().isIn(PLANNER_GOALS).withMessage('Invalid goal'),
  body('contentMix').optional({ nullable: true }).isObject().withMessage('Invalid content mix'),
  // The weekly rhythm. The shape is checked here; the SEMANTICS (real pillars,
  // formats, families, weekday keys) are validated in the service, which owns
  // the vocabulary and returns field-level errors the form can attach.
  body('contentRhythmPreset').optional({ nullable: true }).isIn(RHYTHM_PRESETS).withMessage('Invalid weekly rhythm'),
  body('contentRhythm').optional({ nullable: true }).isObject().withMessage('Invalid weekly rhythm'),
  body('tone').optional({ nullable: true }).isIn(PLANNER_TONES).withMessage('Invalid tone'),
  body('ctaMode').optional({ nullable: true }).isIn(PLANNER_CTA_MODES).withMessage('Invalid CTA mode'),
  body('approvalMode').optional({ nullable: true }).isIn(PLANNER_APPROVAL_MODES).withMessage('Invalid approval mode'),
  body('defaultPlanLength')
    .optional({ nullable: true })
    .isInt({ min: PLANNER_LIMITS.MIN_PLAN_LENGTH, max: PLANNER_LIMITS.MAX_PLAN_LENGTH })
    .withMessage('Invalid plan length'),
  body('postsPerDay')
    .optional({ nullable: true })
    .isInt({ min: 1, max: PLANNER_LIMITS.MAX_POSTS_PER_DAY })
    .withMessage('Invalid posts per day'),
  body('timezone').optional({ nullable: true }).isString().isLength({ max: 64 }).withMessage('Invalid timezone'),
  body('autopilotEnabled').optional({ nullable: true }).isBoolean().withMessage('Invalid autopilot setting'),
];

export const generatePlanValidator = [
  body('name').optional({ nullable: true }).isString().isLength({ max: PLANNER_LIMITS.NAME_MAX }).withMessage('Name is too long'),
  body('startDate').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Invalid start date'),
  body('planLength')
    .optional({ nullable: true })
    .isInt({ min: PLANNER_LIMITS.MIN_PLAN_LENGTH, max: PLANNER_LIMITS.MAX_PLAN_LENGTH })
    .withMessage('Invalid plan length'),
  body('cadence').optional({ nullable: true }).isIn(PLANNER_CADENCES).withMessage('Invalid cadence'),
  body('weekdays').optional({ nullable: true }).isArray({ max: 7 }).withMessage('Invalid weekdays'),
  body('weekdays.*').optional().isInt({ min: 1, max: 7 }).withMessage('Invalid weekday'),
  body('times').optional({ nullable: true }).isArray({ max: PLANNER_LIMITS.MAX_TIMES_PER_DAY }).withMessage('Invalid times'),
  body('times.*').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Times must be HH:MM'),
  body('postsPerDay')
    .optional({ nullable: true })
    .isInt({ min: 1, max: PLANNER_LIMITS.MAX_POSTS_PER_DAY })
    .withMessage('Invalid posts per day'),
  body('platforms').optional({ nullable: true }).isArray({ max: 3 }).withMessage('Invalid platforms'),
  body('platforms.*').optional().isIn(PLATFORM_VALUES).withMessage('Unsupported platform'),
  body('timezone').optional({ nullable: true }).isString().isLength({ max: 64 }).withMessage('Invalid timezone'),
  body('approvalMode').optional({ nullable: true }).isIn(PLANNER_APPROVAL_MODES).withMessage('Invalid approval mode'),
  // A run may name its own rhythm. Without this the wizard's choice could not
  // reach the run and the saved default would silently win, which is exactly
  // the input-fidelity failure this phase exists to close.
  body('contentRhythmPreset').optional({ nullable: true }).isIn(RHYTHM_PRESETS).withMessage('Invalid weekly rhythm'),
  body('customRhythm').optional({ nullable: true }).isObject().withMessage('Invalid weekly rhythm'),
];

export const runIdParamValidator = [
  param('id').matches(idPattern).withMessage('Invalid plan id'),
];

export const deletePlanValidator = [
  ...runIdParamValidator,
  // Cancelling queued posts must be an explicit choice, never implied.
  body('cancelQueued').optional({ nullable: true }).isBoolean().withMessage('Invalid cancelQueued flag'),
];

export const itemIdParamValidator = [
  param('itemId').matches(idPattern).withMessage('Invalid post id'),
];

export const updateItemValidator = [
  ...itemIdParamValidator,
  body('caption').optional({ nullable: true }).isString().isLength({ max: 4000 }).withMessage('Caption is too long'),
  body('headline').optional({ nullable: true }).isString().isLength({ max: 80 }).withMessage('Headline is too long'),
  body('subheadline').optional({ nullable: true }).isString().isLength({ max: 140 }).withMessage('Subheadline is too long'),
  body('altText').optional({ nullable: true }).isString().isLength({ max: 420 }).withMessage('Alt text is too long'),
  body('hashtags').optional({ nullable: true }).isArray({ max: 30 }).withMessage('Too many hashtags'),
  body('hashtags.*').optional().isString().isLength({ max: 80 }).withMessage('Hashtag is too long'),
  body('templateKey').optional({ nullable: true }).isIn(IMAGE_TEMPLATE_VALUES).withMessage('Invalid template'),
  body('aspectRatio').optional({ nullable: true }).isIn(ASPECT_RATIO_VALUES).withMessage('Invalid aspect ratio'),
  body('backgroundStyle').optional({ nullable: true }).isIn(BACKGROUND_STYLES).withMessage('Invalid background style'),
  body('scheduledFor').optional({ nullable: true }).isString().isLength({ max: 40 }).withMessage('Invalid date and time'),
  body('platformTargets').optional({ nullable: true }).isArray({ min: 1, max: 3 }).withMessage('Choose at least one platform'),
  body('platformTargets.*').optional().isIn(PLATFORM_VALUES).withMessage('Unsupported platform'),
  // Per-platform copy edits: { facebook: { postCopy, hashtags }, ... }. The
  // object's KEYS are checked in the service against the item's immutable
  // platform snapshot (an unselected/Facebook key is rejected there, per-item,
  // which the validator cannot know). Here we bound the shape and sizes.
  body('platformCaptions').optional({ nullable: true }).isObject().withMessage('Invalid platform copy'),
  body('platformCaptions.*.postCopy').optional().isString().isLength({ max: 4000 }).withMessage('Post copy is too long'),
  body('platformCaptions.*.hashtags').optional().isArray({ max: 30 }).withMessage('Too many hashtags'),
  body('platformCaptions.*.hashtags.*').optional().isString().isLength({ max: 80 }).withMessage('Hashtag is too long'),
];

export const setItemMediaValidator = [
  ...itemIdParamValidator,
  // Null clears the image; otherwise an owned media id.
  body('mediaAssetId').optional({ nullable: true }).matches(idPattern).withMessage('Invalid media id'),
];

export const regenerateItemValidator = [
  ...itemIdParamValidator,
  body('target').isIn(['caption', 'image']).withMessage('Regenerate the caption or the image'),
  body('force').optional({ nullable: true }).isBoolean().withMessage('Invalid force flag'),
];

export const itemStatusValidator = [
  ...itemIdParamValidator,
  body('status').isIn(['approved', 'rejected', 'draft']).withMessage('Choose approve or reject'),
];

export const bulkStatusValidator = [
  ...runIdParamValidator,
  body('status').isIn(['approved', 'rejected']).withMessage('Choose approve or reject'),
  body('itemIds').optional({ nullable: true }).isArray({ max: PLANNER_LIMITS.MAX_ITEMS_PER_RUN }).withMessage('Invalid selection'),
  body('itemIds.*').optional().matches(idPattern).withMessage('Invalid post id'),
];

export const queueValidator = [
  ...runIdParamValidator,
  body('itemIds').optional({ nullable: true }).isArray({ max: PLANNER_LIMITS.MAX_ITEMS_PER_RUN }).withMessage('Invalid selection'),
  body('itemIds.*').optional().matches(idPattern).withMessage('Invalid post id'),
];

export const listPlansValidator = [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit'),
  query('offset').optional().isInt({ min: 0, max: 100000 }).withMessage('Invalid offset'),
];

export const timezoneQueryValidator = [
  query('search').optional().isString().isLength({ max: 64 }).withMessage('Invalid search'),
  query('forDate').optional().matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Invalid date'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Invalid limit'),
];

export default {
  preferencesValidator,
  generatePlanValidator,
  runIdParamValidator,
  itemIdParamValidator,
  updateItemValidator,
  regenerateItemValidator,
  itemStatusValidator,
  bulkStatusValidator,
  queueValidator,
  listPlansValidator,
};
