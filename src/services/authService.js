/**
 * Authentication service — registration, login, profile, and password change.
 *
 * Pure-ish business logic with injected dependencies (repositories, logging,
 * transaction runner) so it can be unit-tested without a database. Passwords
 * are hashed with bcrypt using the configured cost factor; plaintext passwords
 * and hashes are never logged or returned.
 */

import bcrypt from 'bcrypt';

import { config } from '../config/env.js';
import { PASSWORD_POLICY, EVENT_TYPES, USER_ROLES, USER_STATUS } from '../config/constants.js';
import {
  ValidationError,
  ConflictError,
  AuthenticationError,
  NotFoundError,
} from '../utils/errors.js';
import { normalizeEmail as normalizeEmailUtil, isEmail } from '../utils/validation.js';
import { isValidTimezone } from '../utils/time.js';

import * as defaultUserRepository from '../repositories/userRepository.js';
import * as defaultIntegrationRepository from '../repositories/integrationRepository.js';
import { loggingService as defaultLoggingService } from './loggingService.js';
import { withTransaction as defaultWithTransaction } from '../db/transactions.js';

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';

export function createAuthService({
  users = defaultUserRepository,
  integrations = defaultIntegrationRepository,
  logging = defaultLoggingService,
  withTransaction = defaultWithTransaction,
} = {}) {
  // --- primitives ----------------------------------------------------------

  function normalizeEmail(email) {
    return normalizeEmailUtil(email);
  }

  function validateTimezone(timezone) {
    return isValidTimezone(timezone);
  }

  async function hashPassword(password) {
    return bcrypt.hash(password, config.bcryptRounds);
  }

  async function verifyPassword(password, passwordHash) {
    if (typeof password !== 'string' || typeof passwordHash !== 'string' || !passwordHash) {
      return false;
    }
    return bcrypt.compare(password, passwordHash);
  }

  /** Throw ValidationError if the password fails policy. Never logs the value. */
  function assertPasswordPolicy(password) {
    const problems = [];
    if (typeof password !== 'string' || password.length === 0) {
      problems.push('Password is required');
    } else {
      if (password.length < PASSWORD_POLICY.MIN_LENGTH) {
        problems.push(`Password must be at least ${PASSWORD_POLICY.MIN_LENGTH} characters`);
      }
      if (password.length > PASSWORD_POLICY.MAX_LENGTH) {
        problems.push(`Password must be at most ${PASSWORD_POLICY.MAX_LENGTH} characters`);
      }
      if (password.trim().length === 0) {
        problems.push('Password cannot be only whitespace');
      }
      if (!/[A-Z]/.test(password)) problems.push('Password must contain an uppercase letter');
      if (!/[a-z]/.test(password)) problems.push('Password must contain a lowercase letter');
      if (!/[0-9]/.test(password)) problems.push('Password must contain a number');
    }
    if (problems.length > 0) {
      throw new ValidationError(
        'Password does not meet requirements',
        problems.map((message) => ({ field: 'password', message })),
      );
    }
  }

  function validateName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < 1 || trimmed.length > 255) {
      throw new ValidationError('Invalid name', [
        { field: 'name', message: 'Name must be between 1 and 255 characters' },
      ]);
    }
    return trimmed;
  }

  // --- registration --------------------------------------------------------

  async function registerUser({ name, email, password, timezone }, { req } = {}) {
    const cleanName = validateName(name);
    const cleanEmail = normalizeEmail(email);

    if (!isEmail(cleanEmail)) {
      throw new ValidationError('Invalid email', [
        { field: 'email', message: 'A valid email address is required' },
      ]);
    }
    if (!validateTimezone(timezone)) {
      throw new ValidationError('Invalid timezone', [
        { field: 'timezone', message: 'A valid IANA timezone is required' },
      ]);
    }
    assertPasswordPolicy(password);

    if (await users.emailExists(cleanEmail)) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await hashPassword(password);

    let sanitized;
    try {
      sanitized = await withTransaction(async (conn) => {
        const user = await users.createUser(
          {
            name: cleanName,
            email: cleanEmail,
            passwordHash,
            timezone,
            role: USER_ROLES.USER,
            status: USER_STATUS.ACTIVE,
          },
          conn,
        );
        // One integration row per user, created up front (no credentials yet).
        await integrations.ensureIntegrationRow(user.id, conn);
        return user;
      });
    } catch (err) {
      // Handle a duplicate-email race safely.
      if (err && err.code === 'ER_DUP_ENTRY') {
        throw new ConflictError('An account with this email already exists');
      }
      throw err;
    }

    await logging.record(EVENT_TYPES.USER_REGISTERED, {
      req,
      userId: sanitized.id,
      message: 'User registered',
    });
    return sanitized;
  }

  // --- login ---------------------------------------------------------------

  async function authenticateUser({ email, password }, { req } = {}) {
    const cleanEmail = normalizeEmail(email);
    const row = await users.findUserByEmail(cleanEmail);

    // Verify password first so we never reveal account existence or status to
    // someone who does not already know the correct password.
    const passwordOk = row ? await verifyPassword(password, row.password_hash) : false;

    if (!row || !passwordOk) {
      await logging.record(EVENT_TYPES.USER_LOGIN_FAILED, {
        req,
        userId: row ? String(row.id) : null,
        level: 'warn',
        message: 'Login failed: invalid credentials',
        // Email is user-supplied identifier, not a secret; password omitted.
        context: { email: cleanEmail },
      });
      throw new AuthenticationError(GENERIC_LOGIN_ERROR);
    }

    if (row.status === USER_STATUS.DISABLED) {
      await logging.record(EVENT_TYPES.USER_LOGIN_FAILED, {
        req,
        userId: String(row.id),
        level: 'warn',
        message: 'Login failed: account disabled',
      });
      throw new AuthenticationError('This account has been disabled.');
    }

    await users.updateLastLogin(row.id);
    await logging.record(EVENT_TYPES.USER_LOGIN_SUCCEEDED, {
      req,
      userId: String(row.id),
      message: 'Login succeeded',
    });

    return users.sanitizeUser({ ...row, last_login_at: new Date() });
  }

  // --- profile -------------------------------------------------------------

  async function updateUserProfile(userId, { name, timezone }, { req } = {}) {
    const cleanName = validateName(name);
    if (!validateTimezone(timezone)) {
      throw new ValidationError('Invalid timezone', [
        { field: 'timezone', message: 'A valid IANA timezone is required' },
      ]);
    }
    const sanitized = await users.updateProfile(userId, { name: cleanName, timezone });
    if (!sanitized) throw new NotFoundError('User not found');

    await logging.record(EVENT_TYPES.USER_PROFILE_UPDATED, {
      req,
      userId: String(userId),
      message: 'Profile updated',
    });
    return sanitized;
  }

  // --- password change -----------------------------------------------------

  async function changePassword(userId, { currentPassword, newPassword }, { req } = {}) {
    const row = await users.findUserById(userId);
    if (!row) throw new NotFoundError('User not found');

    const currentOk = await verifyPassword(currentPassword, row.password_hash);
    if (!currentOk) {
      throw new AuthenticationError('Current password is incorrect');
    }

    assertPasswordPolicy(newPassword);

    if (newPassword === currentPassword) {
      throw new ValidationError('New password must be different', [
        { field: 'newPassword', message: 'New password must differ from the current password' },
      ]);
    }

    const newHash = await hashPassword(newPassword);
    await withTransaction(async (conn) => {
      await users.updatePassword(userId, newHash, conn);
    });

    await logging.record(EVENT_TYPES.USER_PASSWORD_CHANGED, {
      req,
      userId: String(userId),
      message: 'Password changed',
    });
    return true;
  }

  return {
    normalizeEmail,
    validateTimezone,
    hashPassword,
    verifyPassword,
    assertPasswordPolicy,
    registerUser,
    authenticateUser,
    updateUserProfile,
    changePassword,
  };
}

export const authService = createAuthService();
export default authService;
