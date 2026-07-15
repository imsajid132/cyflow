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
  // Phase 4.7: auto content planner
  PLANNER_PREFERENCES_UPDATED: 'planner.preferences_updated',
  PLANNER_RUN_STARTED: 'planner.run_started',
  PLANNER_RUN_COMPLETED: 'planner.run_completed',
  PLANNER_RUN_FAILED: 'planner.run_failed',
  PLANNER_RUN_DELETED: 'planner.run_deleted',
  PLANNER_ITEM_UPDATED: 'planner.item_updated',
  PLANNER_ITEM_REGENERATED: 'planner.item_regenerated',
  PLANNER_ITEM_APPROVED: 'planner.item_approved',
  PLANNER_ITEM_REJECTED: 'planner.item_rejected',
  PLANNER_ITEM_DELETED: 'planner.item_deleted',
  PLANNER_ITEMS_QUEUED: 'planner.items_queued',
  PLANNER_DUPLICATE_DETECTED: 'planner.duplicate_detected',
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
  // Phase 4.7 — content-type layouts the planner selects by post shape.
  'checklist-tips', // Checklist Tips (renders bullets)
  'stat-proof', // Stat Proof (renders one big figure)
  'split-comparison', // Split Comparison (renders two columns)
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

// --- Phase 4.7: auto content planner ---------------------------------------

/** How often the planner places posts across the plan window. */
export const PLANNER_CADENCES = Object.freeze([
  'every_day',
  'weekdays',
  'selected_weekdays',
  'custom',
]);

/** ISO-8601 weekday numbers (Monday = 1 … Sunday = 7). */
export const PLANNER_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
export const PLANNER_WEEKDAY_LABELS = Object.freeze({
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
  5: 'Friday', 6: 'Saturday', 7: 'Sunday',
});

/** What a post is trying to achieve. */
export const PLANNER_GOALS = Object.freeze([
  'awareness',
  'engagement',
  'lead_generation',
  'education',
  'service_promotion',
  'trust_building',
  'offers',
]);

/** The kind of post. Drives copy framing AND image template selection. */
export const PLANNER_CONTENT_TYPES = Object.freeze([
  'educational',
  'promotional',
  'authority',
  'tips',
  'cta',
  'proof',
  'local',
  'comparison',
]);

/**
 * Content type → image template. The layout follows the *shape* of the message:
 * a tips post is a checklist, a proof post leads with a number, a comparison
 * post needs two columns. Keeping this map here (rather than inside the
 * generator) makes the variation rule reviewable in one place.
 */
export const CONTENT_TYPE_TEMPLATES = Object.freeze({
  tips: 'checklist-tips',
  proof: 'stat-proof',
  comparison: 'split-comparison',
  authority: 'editorial-premium',
  educational: 'editorial-premium',
  cta: 'geometric-conversion',
  promotional: 'bold-service-promo',
  local: 'local-authority',
});

/**
 * Alternate templates per content type, used to break up visual repetition
 * across a plan. The planner rotates through these so two consecutive posts of
 * the same type never look identical.
 */
export const CONTENT_TYPE_TEMPLATE_ALTERNATES = Object.freeze({
  tips: ['checklist-tips', 'modern-split'],
  proof: ['stat-proof', 'minimal-luxury'],
  comparison: ['split-comparison', 'modern-split'],
  authority: ['editorial-premium', 'minimal-luxury'],
  educational: ['editorial-premium', 'modern-split'],
  cta: ['geometric-conversion', 'bold-service-promo'],
  promotional: ['bold-service-promo', 'geometric-conversion'],
  local: ['local-authority', 'editorial-premium'],
});

/** Bounds on the structured extras the content-type templates render. */
export const PLANNER_VISUAL_LIMITS = Object.freeze({
  BULLET_MAX: 64,
  BULLETS_MIN: 2,
  BULLETS_MAX: 4,
  STAT_VALUE_MAX: 12,
  STAT_LABEL_MAX: 70,
  COMPARE_TITLE_MAX: 24,
  COMPARE_ITEM_MAX: 40,
  COMPARE_ITEMS_MAX: 3,
});

/** Planner tone options (a superset of CONTENT_TONES plus 'mixed'). */
export const PLANNER_TONES = Object.freeze([
  'professional',
  'friendly',
  'confident',
  'educational',
  'promotional',
  'mixed',
]);

/** Map a planner tone onto the tone the caption generator understands. */
export const PLANNER_TONE_TO_CONTENT_TONE = Object.freeze({
  professional: 'professional',
  friendly: 'friendly',
  confident: 'bold',
  educational: 'informative',
  promotional: 'bold',
  // 'mixed' is resolved per-post by the planner, never sent through directly.
});

/** How often a CTA appears across the plan. */
export const PLANNER_CTA_MODES = Object.freeze(['always', 'some', 'light']);

/** Whether generated posts need a human before they can be queued. */
export const PLANNER_APPROVAL_MODES = Object.freeze(['require_approval', 'auto_queue']);

/** Lifecycle of a whole generated plan. */
export const PLANNER_RUN_STATUS = Object.freeze({
  GENERATING: 'generating',
  REVIEW: 'review',
  PARTIALLY_QUEUED: 'partially_queued',
  QUEUED: 'queued',
  ARCHIVED: 'archived',
  FAILED: 'failed',
});
export const PLANNER_RUN_STATUS_VALUES = Object.freeze(Object.values(PLANNER_RUN_STATUS));

/** Lifecycle of a single planned post. */
export const PLANNER_ITEM_STATUS = Object.freeze({
  DRAFT: 'draft',
  NEEDS_REVIEW: 'needs_review',
  APPROVED: 'approved',
  QUEUED: 'queued',
  REJECTED: 'rejected',
});
export const PLANNER_ITEM_STATUS_VALUES = Object.freeze(Object.values(PLANNER_ITEM_STATUS));

/** Plan lengths offered in the wizard; any 1..PLANNER_LIMITS.MAX_PLAN_LENGTH is accepted. */
export const PLANNER_PLAN_LENGTHS = Object.freeze([3, 5, 7, 14]);

export const PLANNER_LIMITS = Object.freeze({
  MIN_PLAN_LENGTH: 1,
  MAX_PLAN_LENGTH: 14,
  // Hard ceiling on posts per run: plan length x times per day. Bounds both the
  // OpenAI/HCTI spend and the duplication comparison work.
  MAX_ITEMS_PER_RUN: 28,
  MAX_TIMES_PER_DAY: 4,
  MAX_REGENERATION_ATTEMPTS: 2,
  // How many recent items the uniqueness check compares a new post against.
  DUPLICATE_LOOKBACK_ITEMS: 60,
  DUPLICATE_LOOKBACK_DAYS: 60,
  NAME_MAX: 160,
  NOTES_MAX: 2000,
  SUMMARY_MAX: 500,
  BRIEF_MAX: 2000,
});

/** Similarity thresholds used by contentUniquenessService (0..1). */
export const DUPLICATION_THRESHOLDS = Object.freeze({
  // At or above this, the post is regenerated automatically.
  REGENERATE: 0.62,
  // At or above this (but below REGENERATE), it is flagged for human review.
  WARN: 0.45,
  // An exact-match headline or caption is always a hard block.
  EXACT: 1,
});

/** api_usage operation identifiers for planner work. */
export const PLANNER_USAGE_OPERATIONS = Object.freeze({
  GENERATE_PLAN: 'generate_plan',
});
