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
  // OAuth + social account lifecycle
  OAUTH_STARTED: 'oauth.started',
  OAUTH_AUTHORIZATION_DENIED: 'oauth.authorization_denied',
  OAUTH_STATE_REJECTED: 'oauth.state_rejected',
  OAUTH_COMPLETED: 'oauth.completed',
  OAUTH_FAILED: 'oauth.failed',
  SOCIAL_ACCOUNT_CONNECTED: 'social_account.connected',
  SOCIAL_ACCOUNT_UPDATED: 'social_account.updated',
  SOCIAL_ACCOUNT_VERIFIED: 'social_account.verified',
  SOCIAL_ACCOUNT_VERIFICATION_FAILED: 'social_account.verification_failed',
  SOCIAL_ACCOUNT_TOKEN_REFRESHED: 'social_account.token_refreshed',
  SOCIAL_ACCOUNT_DISCONNECTED: 'social_account.disconnected',
  THREADS_UNINSTALLED: 'threads.uninstalled',
  THREADS_DATA_DELETION_REQUESTED: 'threads.data_deletion_requested',
  // Phase 4: content/image generation, drafts, scheduling
  POST_DRAFT_CREATED: 'post.draft_created',
  POST_DRAFT_UPDATED: 'post.draft_updated',
  POST_CONTENT_GENERATED: 'post.content_generated',
  POST_CONTENT_GENERATION_FAILED: 'post.content_generation_failed',
  POST_IMAGE_GENERATED: 'post.image_generated',
  POST_IMAGE_GENERATION_FAILED: 'post.image_generation_failed',
  POST_TARGETS_UPDATED: 'post.targets_updated',
  POST_SCHEDULED: 'post.scheduled',
  POST_CANCELLED: 'post.cancelled',
  POST_DELETED: 'post.deleted',
  MEDIA_ASSET_CREATED: 'media.asset_created',
  MEDIA_ASSET_FAILED: 'media.asset_failed',
  // Phase 4.5: business onboarding + website brand extraction
  BUSINESS_PROFILE_UPDATED: 'business.profile_updated',
  BUSINESS_PROFILE_DELETED: 'business.profile_deleted',
  BUSINESS_WEBSITE_ANALYZED: 'business.website_analyzed',
  BUSINESS_WEBSITE_ANALYSIS_FAILED: 'business.website_analysis_failed',
  BUSINESS_ONBOARDING_COMPLETED: 'business.onboarding_completed',
});

// Least-privilege OAuth scopes requested per provider. Do NOT add unrelated
// permissions (email, business_management, messaging, insights, etc.).
export const OAUTH_SCOPES = Object.freeze({
  meta: Object.freeze(['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']),
  instagram: Object.freeze(['instagram_business_basic', 'instagram_business_content_publish']),
  threads: Object.freeze(['threads_basic', 'threads_content_publish']),
});

// Facebook Page "tasks" that indicate the user can publish content on a Page.
export const META_PUBLISHABLE_TASKS = Object.freeze(['CREATE_CONTENT', 'MANAGE']);

// Minimum entropy (bytes) for a raw OAuth state value.
export const OAUTH_STATE_BYTES = 32;

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

// --- Phase 4: content generation, image templates, scheduling --------------

// Platform keys used for generated content (derived from account types).
export const PLATFORMS = Object.freeze({
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  THREADS: 'threads',
});
export const PLATFORM_VALUES = Object.freeze(Object.values(PLATFORMS));

// Map a connected account_type to its content platform key.
export const ACCOUNT_TYPE_TO_PLATFORM = Object.freeze({
  facebook_page: PLATFORMS.FACEBOOK,
  instagram_professional: PLATFORMS.INSTAGRAM,
  threads_profile: PLATFORMS.THREADS,
});

// Server-owned image templates (trusted HTML/CSS only). These branded layouts
// are what the UI offers; each has a module under src/templates/layouts/.
export const IMAGE_TEMPLATES = Object.freeze([
  'editorial-premium', // Clean Editorial Premium
  'bold-service-promo', // Bold Service Promo
  'local-authority', // Local Business Authority
  'modern-split', // Modern Split Layout
  'minimal-luxury', // Minimal Luxury Card
  'geometric-conversion', // Geometric Conversion Post
  'photo-overlay', // Photo Overlay Ready (background-image slot, no invented photo)
]);

/**
 * Older template names, still accepted so drafts saved before Phase 4.6 keep
 * rendering. Each maps onto its closest current layout.
 */
export const LEGACY_IMAGE_TEMPLATE_ALIASES = Object.freeze({
  // Phase 4.5b names.
  editorial: 'editorial-premium',
  'bold-service': 'bold-service-promo',
  'professional-local': 'local-authority',
  // Phase 4 names.
  minimal: 'minimal-luxury',
  bold: 'bold-service-promo',
  professional: 'local-authority',
});

/** Everything the API accepts (new + legacy aliases). */
export const IMAGE_TEMPLATE_VALUES = Object.freeze([
  ...IMAGE_TEMPLATES,
  ...Object.keys(LEGACY_IMAGE_TEMPLATE_ALIASES),
]);

// Supported aspect ratios (pixels).
export const ASPECT_RATIOS = Object.freeze({
  square: Object.freeze({ width: 1080, height: 1080 }),
  portrait: Object.freeze({ width: 1080, height: 1350 }),
  landscape: Object.freeze({ width: 1200, height: 630 }),
});
export const ASPECT_RATIO_VALUES = Object.freeze(Object.keys(ASPECT_RATIOS));

// Safe background-style presets (never arbitrary CSS from the client).
export const BACKGROUND_STYLES = Object.freeze([
  'light',
  'dark',
  'gradient-blue',
  'gradient-warm',
  'neutral',
]);

// Safe preset tones + hashtag preferences for content generation.
export const CONTENT_TONES = Object.freeze([
  'neutral',
  'friendly',
  'professional',
  'playful',
  'bold',
  'informative',
]);
export const HASHTAG_PREFERENCES = Object.freeze(['none', 'minimal', 'moderate', 'rich']);

// api_usage operation identifiers.
export const USAGE_OPERATIONS = Object.freeze({
  OPENAI_GENERATE_CONTENT: 'generate_content',
  HCTI_GENERATE_IMAGE: 'generate_image',
});

// Input length limits for generation fields (defence-in-depth bounds).
export const GENERATION_LIMITS = Object.freeze({
  TITLE_MAX: 200,
  BRIEF_MAX: 5000,
  BRAND_MAX: 120,
  CTA_MAX: 200,
  LANGUAGE_MAX: 40,
  INSTRUCTIONS_MAX: 1000,
  CAPTION_OVERRIDE_MAX: 4000,
  HEADLINE_MAX: 80,
  SUBHEADLINE_MAX: 140,
  ALT_TEXT_MAX: 420,
});

// Visual text bounds enforced on generated image text (keep it template-safe).
export const IMAGE_TEXT_LIMITS = Object.freeze({
  HEADLINE_MAX: 80,
  SUBHEADLINE_MAX: 140,
});

// --- Phase 4.5: business onboarding + website brand extraction -------------

/** Onboarding state machine. */
export const ONBOARDING_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  BUSINESS_SOURCE: 'business_source',
  ANALYZING: 'analyzing',
  BRAND_REVIEW: 'brand_review',
  CONNECTIONS: 'connections',
  COMPLETED: 'completed',
});
export const ONBOARDING_STATUS_VALUES = Object.freeze(Object.values(ONBOARDING_STATUS));

/** How a business profile was populated. */
export const BUSINESS_SOURCE_TYPES = Object.freeze(['website', 'manual', 'mixed']);

/** Hard bounds for the website analyzer (no env vars — fixed policy). */
export const WEBSITE_ANALYSIS = Object.freeze({
  MAX_PAGES: 4, // homepage + about + services + contact
  MAX_REDIRECTS: 3,
  TIMEOUT_MS: 10_000,
  MAX_PAGE_BYTES: 2 * 1024 * 1024,
  MAX_LOGO_BYTES: 2 * 1024 * 1024,
  MAX_SERVICES: 12,
  MAX_LOCATIONS: 10,
  MAX_SOCIAL_LINKS: 10,
  MAX_COLORS: 6,
});

/** Field length bounds for business profile data. */
export const BUSINESS_LIMITS = Object.freeze({
  NAME_MAX: 160,
  CATEGORY_MAX: 80,
  DESCRIPTION_MAX: 1000,
  PHONE_MAX: 40,
  EMAIL_MAX: 254,
  ADDRESS_MAX: 255,
  CITY_MAX: 120,
  REGION_MAX: 120,
  POSTAL_MAX: 32,
  COUNTRY_MAX: 80,
  FONT_MAX: 80,
  SERVICE_MAX: 80,
  LOCATION_MAX: 120,
  URL_MAX: 2000,
  CTA_MAX: 200,
  LANGUAGE_MAX: 40,
});

/** Image MIME types accepted for a fetched logo. */
export const LOGO_MIME_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);
