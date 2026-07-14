/**
 * Application-wide constant values shared across the codebase.
 *
 * These are business/domain constants, NOT configuration. Anything that varies
 * per environment lives in env.js instead.
 */

export const APP_NAME = 'Cyflow Social';

// User roles.
export const USER_ROLES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
});
export const USER_ROLE_VALUES = Object.freeze(Object.values(USER_ROLES));

// User account status.
export const USER_STATUS = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
});
export const USER_STATUS_VALUES = Object.freeze(Object.values(USER_STATUS));

// Supported social providers (v1 only).
export const PROVIDERS = Object.freeze({
  META: 'meta',
  INSTAGRAM: 'instagram',
  THREADS: 'threads',
});
export const PROVIDER_VALUES = Object.freeze(Object.values(PROVIDERS));

// Social account types.
export const ACCOUNT_TYPES = Object.freeze({
  FACEBOOK_PAGE: 'facebook_page',
  INSTAGRAM_PROFESSIONAL: 'instagram_professional',
  THREADS_PROFILE: 'threads_profile',
});
export const ACCOUNT_TYPE_VALUES = Object.freeze(Object.values(ACCOUNT_TYPES));

// Valid provider + account_type combinations (the only ones v1 supports).
export const SUPPORTED_PROVIDER_ACCOUNTS = Object.freeze([
  { provider: PROVIDERS.META, accountType: ACCOUNT_TYPES.FACEBOOK_PAGE },
  { provider: PROVIDERS.INSTAGRAM, accountType: ACCOUNT_TYPES.INSTAGRAM_PROFESSIONAL },
  { provider: PROVIDERS.THREADS, accountType: ACCOUNT_TYPES.THREADS_PROFILE },
]);

// Social account status.
export const SOCIAL_ACCOUNT_STATUS = Object.freeze({
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  ERROR: 'error',
});
export const SOCIAL_ACCOUNT_STATUS_VALUES = Object.freeze(
  Object.values(SOCIAL_ACCOUNT_STATUS),
);

// Scheduled post lifecycle status.
export const POST_STATUS = Object.freeze({
  DRAFT: 'draft',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  PUBLISHED: 'published',
  PARTIAL: 'partial',
  RETRYING: 'retrying',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});
export const POST_STATUS_VALUES = Object.freeze(Object.values(POST_STATUS));

// Per-target (per social account) publishing status.
export const TARGET_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  RETRYING: 'retrying',
  PUBLISHED: 'published',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
});
export const TARGET_STATUS_VALUES = Object.freeze(Object.values(TARGET_STATUS));

// Media asset status.
export const MEDIA_ASSET_STATUS = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  EXPIRED: 'expired',
  FAILED: 'failed',
});
export const MEDIA_ASSET_STATUS_VALUES = Object.freeze(
  Object.values(MEDIA_ASSET_STATUS),
);

// Activity log levels.
export const LOG_LEVELS = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
});
export const LOG_LEVEL_VALUES = Object.freeze(Object.values(LOG_LEVELS));

// api_usage service identifiers.
export const USAGE_SERVICES = Object.freeze({
  OPENAI: 'openai',
  HCTI: 'hcti',
  META: 'meta',
  INSTAGRAM: 'instagram',
  THREADS: 'threads',
});

// The current encryption scheme version tag persisted alongside secrets.
export const ENCRYPTION_VERSION = 1;

// Encryption primitives (AES-256-GCM).
export const ENCRYPTION = Object.freeze({
  ALGORITHM: 'aes-256-gcm',
  KEY_BYTES: 32,
  IV_BYTES: 12,
  AUTH_TAG_BYTES: 16,
  PREFIX: 'v1',
});

// Standard API error codes surfaced to clients.
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  CSRF_ERROR: 'CSRF_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

// Session keys.
export const SESSION_KEYS = Object.freeze({
  USER_ID: 'userId',
  CSRF_TOKEN: 'csrfToken',
});

// Activity/security event types (persisted to activity_logs).
export const EVENT_TYPES = Object.freeze({
  USER_REGISTERED: 'user.registered',
  USER_LOGIN_SUCCEEDED: 'user.login_succeeded',
  USER_LOGIN_FAILED: 'user.login_failed',
  USER_LOGGED_OUT: 'user.logged_out',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  HCTI_CREDENTIALS_SAVED: 'hcti.credentials_saved',
  HCTI_CREDENTIALS_VERIFIED: 'hcti.credentials_verified',
  HCTI_CREDENTIALS_VERIFICATION_FAILED: 'hcti.credentials_verification_failed',
  HCTI_CREDENTIALS_DELETED: 'hcti.credentials_deleted',
});

// Password policy.
export const PASSWORD_POLICY = Object.freeze({
  MIN_LENGTH: 12,
  MAX_LENGTH: 128,
});

// HCTI field bounds (defensive limits for user-supplied credentials).
export const HCTI_LIMITS = Object.freeze({
  USER_ID_MAX: 255,
  API_KEY_MAX: 255,
});
