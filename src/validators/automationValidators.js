/**
 * Structural validation for the automations API. The AUTHORITATIVE checks —
 * account ownership, platform/account agreement, buffer ordering, timezone
 * semantics, status transitions — live in automationService. These bound shape
 * and size so a malformed body is rejected before the service runs.
 */

import { body, param } from 'express-validator';

import {
  AUTOMATION_MODES, MISSED_POST_POLICIES, FAILURE_POLICIES, AUTOMATION_LIMITS, PLATFORM_VALUES,
} from '../config/constants.js';

const idPattern = /^\d{1,20}$/;

export const idParamValidator = [
  param('id').matches(idPattern).withMessage('Invalid automation id'),
];

const configBody = [
  body('name').optional({ nullable: true }).isString().isLength({ max: AUTOMATION_LIMITS.MAX_NAME_LENGTH }),
  body('mode').isIn(AUTOMATION_MODES).withMessage('Invalid mode'),
  body('timezone').isString().isLength({ min: 1, max: 64 }).withMessage('Invalid timezone'),
  body('selectedWeekdays').isArray({ min: 1, max: AUTOMATION_LIMITS.MAX_WEEKDAYS }).withMessage('Choose at least one weekday'),
  body('selectedWeekdays.*').isInt({ min: 1, max: 7 }).withMessage('Invalid weekday'),
  body('postingTimes').isArray({ min: 1, max: AUTOMATION_LIMITS.MAX_TIMES_PER_DAY }).withMessage('Add posting times'),
  body('postingTimes.*').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Times must be HH:MM'),
  body('postsPerDay').isInt({ min: AUTOMATION_LIMITS.MIN_POSTS_PER_DAY, max: AUTOMATION_LIMITS.MAX_POSTS_PER_DAY }).withMessage('Invalid posts per day'),
  body('rhythmKey').optional({ nullable: true }).isString().isLength({ max: 48 }),
  body('selectedPlatforms').isArray({ min: 1, max: 3 }).withMessage('Choose at least one platform'),
  body('selectedPlatforms.*').isIn(PLATFORM_VALUES).withMessage('Unsupported platform'),
  body('selectedAccountIds').isArray({ min: 1, max: AUTOMATION_LIMITS.MAX_SELECTED_ACCOUNTS }).withMessage('Choose at least one account'),
  body('selectedAccountIds.*').matches(idPattern).withMessage('Invalid account id'),
  body('startDate').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Invalid start date'),
  body('endDate').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Invalid end date'),
  body('generationHorizonDays').optional({ nullable: true }).isInt({ min: AUTOMATION_LIMITS.MIN_HORIZON_DAYS, max: AUTOMATION_LIMITS.MAX_HORIZON_DAYS }).withMessage('Invalid horizon'),
  body('minimumReadyDays').optional({ nullable: true }).isInt({ min: 1, max: AUTOMATION_LIMITS.MAX_HORIZON_DAYS }).withMessage('Invalid minimum ready days'),
  body('lowBufferDays').optional({ nullable: true }).isInt({ min: 1, max: AUTOMATION_LIMITS.MAX_HORIZON_DAYS }).withMessage('Invalid low-buffer threshold'),
  body('missedPostPolicy').isIn(MISSED_POST_POLICIES).withMessage('Invalid missed-post policy'),
  body('failurePolicy').optional({ nullable: true }).isIn(FAILURE_POLICIES).withMessage('Invalid failure policy'),
];

export const createAutomationValidator = [...configBody];
export const updateAutomationValidator = [...idParamValidator, ...configBody];

export const stopAutomationValidator = [
  ...idParamValidator,
  // An explicit confirmation, because stopping cancels all future preparation.
  body('confirm').equals('STOP').withMessage('Type STOP to confirm'),
];

export default {
  idParamValidator, createAutomationValidator, updateAutomationValidator, stopAutomationValidator,
};
