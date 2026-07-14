/**
 * express-validator chains for auth endpoints.
 *
 * These do fast, structural validation (presence, type, bounds, email shape).
 * The full password policy and timezone validation live in authService (single
 * source of truth) and also produce safe 400 ValidationErrors. Validation
 * responses never echo submitted values (see validateRequest.js).
 */

import { body } from 'express-validator';
import { PASSWORD_POLICY } from '../config/constants.js';

const email = () =>
  body('email')
    .exists({ checkNull: true })
    .withMessage('Email is required')
    .bail()
    .isString()
    .withMessage('Email must be a string')
    .bail()
    .trim()
    .isEmail()
    .withMessage('A valid email address is required')
    .isLength({ max: 254 })
    .withMessage('Email is too long');

const name = () =>
  body('name')
    .exists({ checkNull: true })
    .withMessage('Name is required')
    .bail()
    .isString()
    .withMessage('Name must be a string')
    .bail()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be between 1 and 255 characters');

const timezone = () =>
  body('timezone')
    .exists({ checkNull: true })
    .withMessage('Timezone is required')
    .bail()
    .isString()
    .withMessage('Timezone must be a string')
    .bail()
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('Timezone is required');

// Presence + generous bound only; the strict policy is enforced in authService.
const rawPassword = (field) =>
  body(field)
    .exists({ checkNull: true })
    .withMessage(`${field} is required`)
    .bail()
    .isString()
    .withMessage(`${field} must be a string`)
    .bail()
    .isLength({ min: 1, max: PASSWORD_POLICY.MAX_LENGTH + 1 })
    .withMessage(`${field} is required`);

export const registerValidator = [name(), email(), rawPassword('password'), timezone()];

export const loginValidator = [
  email(),
  body('password').exists({ checkNull: true }).withMessage('Password is required').bail().isString(),
];

export const profileValidator = [name(), timezone()];

export const passwordChangeValidator = [
  rawPassword('currentPassword'),
  rawPassword('newPassword'),
];

export default {
  registerValidator,
  loginValidator,
  profileValidator,
  passwordChangeValidator,
};
