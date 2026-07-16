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
  PLANNER_RUN_ARCHIVED: 'planner.run_archived',
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
  // Phase 4.7.1 — the planner design families. Content-first compositions with
  // no decorative geometry; these are what the planner selects from.
  'editorial-insight', // Editorial Insight (brand field, large headline)
  'light-editorial', // Light Editorial (light canvas, brand rail)
  'checklist-guide', // Checklist Guide (3-5 real rows)
  'comparison-cards', // Comparison Cards (two columns)
  'stat-highlight', // Stat Highlight (a verified figure only)
  'service-authority', // Service Authority (service panel + insight)
  'local-insight', // Local Insight (place label + card)
  // Phase 4.8 — two structurally distinct additions.
  'numbered-steps', // Numbered Steps (an ordered process, not ticks)
  'faq-editorial', // FAQ Editorial (a question and its answer)
  // Earlier layouts. Still offered in the manual picker and still rendering
  // drafts saved before this phase.
  'editorial-premium',
  'bold-service-promo',
  'local-authority',
  'modern-split',
  'minimal-luxury',
  'geometric-conversion',
  'checklist-tips',
  'stat-proof',
  'split-comparison',
  'photo-overlay',
]);

/** The design families the planner picks from. */
export const PLANNER_DESIGN_FAMILIES = Object.freeze([
  'editorial-insight',
  'light-editorial',
  'checklist-guide',
  'comparison-cards',
  'stat-highlight',
  'service-authority',
  'local-insight',
  'numbered-steps',
  'faq-editorial',
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
 * Strategic content formats. A format is what the post DOES, and it determines
 * both how the copy is written and which layout can carry it.
 */
export const PLANNER_FORMATS = Object.freeze([
  'educational_insight',
  'quick_tip',
  'common_mistake',
  'myth_fact',
  'checklist',
  'comparison',
  'process',
  'service_benefit',
  'local_relevance',
  'faq_answer',
  'authority',
  'soft_promo',
]);

/** Human labels, used for the card badge and the review board. */
export const PLANNER_FORMAT_LABELS = Object.freeze({
  educational_insight: 'Insight',
  quick_tip: 'Quick tip',
  common_mistake: 'Common mistake',
  myth_fact: 'Myth vs fact',
  checklist: 'Checklist',
  comparison: 'Comparison',
  process: 'Process',
  service_benefit: 'Service benefit',
  local_relevance: 'Local',
  faq_answer: 'FAQ',
  authority: 'Authority',
  soft_promo: 'Service',
});

/**
 * Format → layout. The layout follows the SHAPE of the message: a checklist is
 * a list, a comparison needs two columns, a verified result leads with a
 * number. Templates are chosen by content, never rotated for novelty.
 *
 * Each format lists the layouts that can genuinely carry it. Where a format has
 * two, the planner alternates between them so the same structure does not run
 * back to back — but it never reaches for a layout that misfits the content.
 */
export const FORMAT_TEMPLATES = Object.freeze({
  checklist: ['checklist-guide'],
  // A process is genuinely a numbered sequence, so it leads with the numbered
  // layout and falls back to the checklist rows only if that is unavailable.
  process: ['numbered-steps', 'checklist-guide'],
  comparison: ['comparison-cards'],
  myth_fact: ['comparison-cards', 'editorial-insight'],
  educational_insight: ['editorial-insight', 'light-editorial'],
  quick_tip: ['light-editorial', 'checklist-guide'],
  common_mistake: ['editorial-insight', 'light-editorial'],
  faq_answer: ['faq-editorial', 'light-editorial'],
  authority: ['editorial-insight', 'stat-highlight'],
  service_benefit: ['service-authority'],
  soft_promo: ['service-authority', 'light-editorial'],
  local_relevance: ['local-insight'],
});

/**
 * Which formats may carry a stat layout. `stat-highlight` is only reachable via
 * `authority`, and only when the business actually supplied a figure — the
 * generator returns an empty stat otherwise and the layout falls back.
 */
export const STAT_CAPABLE_FORMATS = Object.freeze(['authority']);

// --- Phase 4.8: weekly content rhythm --------------------------------------

/**
 * Content PILLARS: the strategic purpose a post serves on a given weekday.
 *
 * A pillar is coarser than a format. A pillar answers "why is this post here
 * this day"; a format answers "how is it written". One pillar admits several
 * formats, which is what lets a week of "Educational Insight" Mondays still read
 * differently week to week.
 *
 * The order here is the Balanced Weekly Rhythm's Monday..Sunday assignment.
 */
export const CONTENT_PILLARS = Object.freeze([
  'educational_insight',
  'service_promotion',
  'trust_authority',
  'problem_solution',
  'actionable_tips',
  'engagement_local',
  'soft_promo_recap',
]);

export const CONTENT_PILLAR_LABELS = Object.freeze({
  educational_insight: 'Educational Insight',
  service_promotion: 'Service Promotion',
  trust_authority: 'Trust and Authority',
  problem_solution: 'Problem and Solution',
  actionable_tips: 'Actionable Tips',
  engagement_local: 'Engagement and Local Relevance',
  soft_promo_recap: 'Soft Promotion and Recap',
});

/** One sentence of purpose per pillar, handed to the brief builder as guidance. */
export const CONTENT_PILLAR_PURPOSE = Object.freeze({
  educational_insight: 'Teach one useful thing about the business, service, or the problem the audience has.',
  service_promotion: 'Promote one real service by explaining the problem it solves, not by boasting.',
  trust_authority: 'Build credibility through standards and process. Never invent reviews, years, or results.',
  problem_solution: 'Name a common problem, mistake, or choice, and what to do about it.',
  actionable_tips: 'Give practical, doable steps the reader can use today.',
  engagement_local: 'Be conversational, audience-focused, or locally relevant. No invented local figures.',
  soft_promo_recap: 'A low-pressure recap, planning thought, or gentle next step. Understated.',
});

/**
 * The writing FORMATS each pillar admits, in preference order.
 *
 * The first is the pillar's most natural format; the rest give a multi-post day
 * and week-to-week variation somewhere honest to go. Every entry is a real
 * member of PLANNER_FORMATS.
 */
export const PILLAR_FORMATS = Object.freeze({
  educational_insight: ['educational_insight', 'faq_answer', 'common_mistake'],
  service_promotion: ['service_benefit', 'soft_promo', 'process'],
  trust_authority: ['authority', 'faq_answer', 'process'],
  problem_solution: ['common_mistake', 'comparison', 'myth_fact'],
  actionable_tips: ['checklist', 'quick_tip', 'process'],
  engagement_local: ['local_relevance', 'quick_tip', 'educational_insight'],
  soft_promo_recap: ['soft_promo', 'service_benefit', 'authority'],
});

/**
 * The VISUAL FAMILIES each pillar admits, in preference order.
 *
 * A visual family is a named creative direction (see VISUAL_FAMILIES). Several
 * families share one structural layout, which is deliberate: the references
 * collapse into a handful of structures, and a family is a role over a layout,
 * not a new layout per name.
 */
export const PILLAR_VISUAL_FAMILIES = Object.freeze({
  educational_insight: ['editorial_insight', 'light_editorial', 'faq_editorial'],
  service_promotion: ['service_authority', 'soft_conversion', 'process_steps'],
  trust_authority: ['trust_editorial', 'faq_editorial', 'process_steps'],
  problem_solution: ['problem_solution', 'comparison_cards', 'myth_fact'],
  actionable_tips: ['checklist_guide', 'numbered_steps', 'light_editorial'],
  engagement_local: ['local_authority', 'conversational_insight', 'light_editorial'],
  // `light_editorial` is the brief's "Minimal Editorial" for a Sunday: a quiet
  // recap does not need a conversion panel. It also keeps this pillar coherent
  // with FORMAT_TEMPLATES, where soft_promo may legitimately land on
  // light-editorial as its alternate layout.
  soft_promo_recap: ['soft_conversion', 'weekly_recap', 'brand_statement', 'light_editorial'],
});

/**
 * The named creative families and the structural layout each resolves to.
 *
 * Seventeen families, nine structural layouts. This is the reference-prescribed
 * shape, not 17 near-identical cards: a family carries a role (badge wording,
 * emphasis, which content block) over a layout that genuinely fits it. Two
 * families sharing a layout (trust_editorial and editorial_insight) differ in
 * their badge and their copy, never by inventing decoration.
 *
 * `requiresStat` families only render when the business supplied a real figure;
 * otherwise the planner picks another family for that slot.
 */
export const VISUAL_FAMILIES = Object.freeze({
  editorial_insight: { label: 'Editorial Insight', layout: 'editorial-insight' },
  light_editorial: { label: 'Light Editorial', layout: 'light-editorial' },
  service_authority: { label: 'Service Authority', layout: 'service-authority' },
  trust_editorial: { label: 'Trust Editorial', layout: 'editorial-insight' },
  process_steps: { label: 'Process Steps', layout: 'numbered-steps' },
  problem_solution: { label: 'Problem and Solution', layout: 'comparison-cards' },
  comparison_cards: { label: 'Comparison Cards', layout: 'comparison-cards' },
  myth_fact: { label: 'Myth versus Fact', layout: 'comparison-cards' },
  checklist_guide: { label: 'Checklist Guide', layout: 'checklist-guide' },
  numbered_steps: { label: 'Numbered Steps', layout: 'numbered-steps' },
  faq_editorial: { label: 'FAQ Editorial', layout: 'faq-editorial' },
  local_authority: { label: 'Local Authority', layout: 'local-insight' },
  conversational_insight: { label: 'Conversational Insight', layout: 'light-editorial' },
  soft_conversion: { label: 'Soft Conversion', layout: 'service-authority' },
  brand_statement: { label: 'Brand Statement', layout: 'editorial-insight' },
  weekly_recap: { label: 'Weekly Recap', layout: 'checklist-guide' },
  verified_stat: { label: 'Verified Stat Highlight', layout: 'stat-highlight', requiresStat: true },
});
export const VISUAL_FAMILY_KEYS = Object.freeze(Object.keys(VISUAL_FAMILIES));

/** The CTA strength a weekday's posts should carry. */
export const RHYTHM_CTA_MODES = Object.freeze([
  'no_cta',
  'soft_cta',
  'conversational_cta',
  'direct_cta',
  'automatic',
]);

/**
 * The built-in weekly rhythm presets.
 *
 * A preset names a pillar per ISO weekday (Monday = 1 … Sunday = 7). "custom" is
 * a marker: it means "use the saved per-weekday rhythm JSON", and carries the
 * Balanced assignment as its starting point so a fresh custom week is sensible
 * rather than empty.
 */
export const RHYTHM_PRESETS = Object.freeze([
  'balanced',
  'education_led',
  'trust_building',
  'growth_promotion',
  'local_business',
  'custom',
]);

export const RHYTHM_PRESET_LABELS = Object.freeze({
  balanced: 'Balanced Weekly Rhythm',
  education_led: 'Education-Led Week',
  trust_building: 'Trust-Building Week',
  growth_promotion: 'Growth and Promotion Week',
  local_business: 'Local Business Week',
  custom: 'Custom Weekly Rhythm',
});

/**
 * Each preset's pillar per ISO weekday. Keyed 1..7 (Mon..Sun).
 *
 * Balanced is the reference rhythm from the brief. The themed presets lean the
 * week toward one purpose while keeping genuine variety, because seven identical
 * posts is the failure every rhythm here exists to prevent.
 */
export const RHYTHM_PRESET_PILLARS = Object.freeze({
  balanced: Object.freeze({
    1: 'educational_insight',
    2: 'service_promotion',
    3: 'trust_authority',
    4: 'problem_solution',
    5: 'actionable_tips',
    6: 'engagement_local',
    7: 'soft_promo_recap',
  }),
  education_led: Object.freeze({
    1: 'educational_insight',
    2: 'actionable_tips',
    3: 'problem_solution',
    4: 'educational_insight',
    5: 'actionable_tips',
    6: 'engagement_local',
    7: 'trust_authority',
  }),
  trust_building: Object.freeze({
    1: 'trust_authority',
    2: 'problem_solution',
    3: 'trust_authority',
    4: 'educational_insight',
    5: 'actionable_tips',
    6: 'engagement_local',
    7: 'soft_promo_recap',
  }),
  growth_promotion: Object.freeze({
    1: 'educational_insight',
    2: 'service_promotion',
    3: 'problem_solution',
    4: 'service_promotion',
    5: 'actionable_tips',
    6: 'engagement_local',
    7: 'soft_promo_recap',
  }),
  local_business: Object.freeze({
    1: 'engagement_local',
    2: 'service_promotion',
    3: 'trust_authority',
    4: 'problem_solution',
    5: 'actionable_tips',
    6: 'engagement_local',
    7: 'soft_promo_recap',
  }),
  // custom starts from Balanced; the saved rhythm JSON overrides per weekday.
  custom: Object.freeze({
    1: 'educational_insight',
    2: 'service_promotion',
    3: 'trust_authority',
    4: 'problem_solution',
    5: 'actionable_tips',
    6: 'engagement_local',
    7: 'soft_promo_recap',
  }),
});

/**
 * Complementary pillars, for a second or third post on the same day.
 *
 * The primary post of a day uses the weekday's pillar; the rest step through
 * this list so a two-post Tuesday is "service promotion, then something that
 * supports it" rather than two service adverts.
 */
export const COMPLEMENTARY_PILLARS = Object.freeze({
  educational_insight: ['actionable_tips', 'trust_authority', 'problem_solution'],
  service_promotion: ['educational_insight', 'trust_authority', 'soft_promo_recap'],
  trust_authority: ['problem_solution', 'educational_insight', 'service_promotion'],
  problem_solution: ['actionable_tips', 'educational_insight', 'trust_authority'],
  actionable_tips: ['educational_insight', 'engagement_local', 'problem_solution'],
  engagement_local: ['educational_insight', 'actionable_tips', 'service_promotion'],
  soft_promo_recap: ['educational_insight', 'trust_authority', 'engagement_local'],
});

/** Bounds on the structured extras the content-type templates render. */
export const PLANNER_VISUAL_LIMITS = Object.freeze({
  BULLET_MAX: 64,
  BULLETS_MIN: 3,
  BULLETS_MAX: 5,
  STAT_VALUE_MAX: 12,
  STAT_LABEL_MAX: 70,
  COMPARE_TITLE_MAX: 24,
  COMPARE_ITEM_MAX: 40,
  COMPARE_ITEMS_MAX: 3,
  BADGE_MAX: 22,
  LOCATION_MAX: 28,
});

/**
 * Headline shape for planner visuals: specific, natural, and short enough to
 * set on two lines. Enforced after generation, because a model asked for
 * "4 to 9 words" will still occasionally return fourteen.
 */
export const HEADLINE_RULES = Object.freeze({
  MIN_WORDS: 3,
  MAX_WORDS: 9,
  MAX_CHARS: 62,
});

/**
 * Post copy shape, per platform.
 *
 * This is the rule that separates a POST from a caption. A caption is one line
 * under a picture; a post is something a person reads. The earlier generator
 * asked only for "2-3 short paragraphs" in prose and enforced nothing, so it
 * produced one-sentence adverts that passed every check.
 *
 * Facebook and Instagram carry the full argument. Threads is deliberately
 * shorter and is written FOR Threads — a trimmed Instagram post is the failure
 * these bounds exist to catch, so its band does not overlap theirs.
 *
 * Enforced after generation by contentStyleGuard, because a model asked for
 * "100 to 180 words" will still return forty.
 */
export const POST_COPY_RULES = Object.freeze({
  // Phase 4.8 widened these bands. Facebook and Instagram carry more context
  // than the 4.7.2 100-180 allowed, and giving them room to breathe is what
  // stops the copy reading as clipped. Threads stays deliberately short and its
  // band still does not overlap the long-form floor, so a trimmed Instagram
  // post cannot pass as a Threads post on length alone.
  facebook: Object.freeze({
    MIN_WORDS: 130, MAX_WORDS: 220, MIN_PARAGRAPHS: 2, MAX_PARAGRAPHS: 4,
  }),
  instagram: Object.freeze({
    MIN_WORDS: 120, MAX_WORDS: 200, MIN_PARAGRAPHS: 2, MAX_PARAGRAPHS: 4,
  }),
  threads: Object.freeze({
    MIN_WORDS: 45, MAX_WORDS: 100, MIN_PARAGRAPHS: 1, MAX_PARAGRAPHS: 3,
  }),
});

/**
 * A paragraph longer than this is a wall of text regardless of the total word
 * count: four short paragraphs and one 160-word block both satisfy the word
 * band, and only one of them is readable.
 */
export const PARAGRAPH_MAX_WORDS = 75;

/**
 * How similar two platforms' copy may be before it counts as a copy-paste.
 *
 * Trigram Jaccard over the caption. The same post rewritten for another
 * platform shares its facts and its vocabulary, so this is deliberately
 * permissive: it catches "identical, or trimmed", not "same subject".
 */
export const PLATFORM_COPY_MAX_SIMILARITY = 0.72;

/**
 * How similar two platforms' OPENING paragraphs may be.
 *
 * Tighter than the whole-post bound, and checked separately, because a
 * whole-post average hides a shared opening: two posts can reuse their first
 * sentence verbatim, diverge afterwards, and still score as merely "similar".
 * The opening is the part a reader sees in the feed, so a shared one is the most
 * visible way two platforms look like one copy-paste.
 */
export const PLATFORM_OPENING_MAX_SIMILARITY = 0.6;

/**
 * Dash characters that must never appear in generated copy.
 *
 * Em and en dashes are the single most reliable tell of machine-written
 * marketing text. The model is instructed not to use them AND the output is
 * repaired, because instructions alone do not hold.
 */
export const BANNED_DASHES = Object.freeze(['—', '–', '‒', '―']);

/**
 * Generic AI marketing filler. These are checked case-insensitively against
 * generated copy; a hit forces a regeneration rather than being silently
 * rewritten, because the phrase usually indicates the whole sentence is empty.
 */
export const BANNED_PHRASES = Object.freeze([
  'in today’s digital world',
  "in today's digital world",
  'in todays digital world',
  'in today’s fast-paced',
  "in today's fast-paced",
  'unlock your potential',
  'unlock the power',
  'take your business to the next level',
  'to the next level',
  'elevate your brand',
  'elevate your business',
  'game changer',
  'game-changer',
  'supercharge your growth',
  'supercharge your',
  'transform your online presence',
  'transform your business',
  'ready to grow',
  'look no further',
  'whether you are',
  'whether you’re',
  "whether you're",
  'it is more important than ever',
  'more important than ever',
  'in the digital age',
  'digital landscape',
  'ever-evolving',
  'harness the power',
  'stand out from the crowd',
  'take the first step',
  'let’s dive in',
  "let's dive in",
  'dive into',
  'unleash',
  'revolutionize',
  'cutting-edge solutions',
  'seamlessly',
  'robust solution',
  'at the end of the day',
  // Phase 4.8 additions.
  'now more than ever',
  'your journey starts here',
  'revolutionize your business',
  'maximize your potential',
  'seamless solutions',
  'tailored solutions for your needs',
  'stand out from the competition',
  'the key to success',
  'in the ever-evolving world',
  'say goodbye to',
]);

/**
 * Unsupported-claim PHRASES: sentences that assert experience, results, counts,
 * or reputation the business never gave us. Distinct from generic filler: these
 * are not empty, they are UNVERIFIABLE, and a small business posting an invented
 * proof point is a real credibility and honesty problem.
 *
 * A hit forces a regeneration with a specific angle. Real proof does not go in
 * prose at all: it goes in a stat layout, from structured verified data.
 */
export const UNSUPPORTED_CLAIM_PHRASES = Object.freeze([
  'i have seen clients',
  'we have seen clients',
  'we have helped hundreds',
  'we have helped thousands',
  'we have helped countless',
  'our clients often achieve',
  'our clients regularly',
  'from our years of experience',
  'in our years of experience',
  'years of experience have taught',
  'customers regularly tell us',
  'clients regularly tell us',
  'we recently helped',
  'our proven system',
  'our proven process',
  'our proven method',
  'trusted by thousands',
  'trusted by hundreds',
  'trusted by businesses everywhere',
  'our award-winning team',
  'our award winning',
  'award-winning service',
  'thousands of satisfied customers',
  'hundreds of satisfied customers',
  'our track record speaks',
  'join thousands of',
  'rated number one',
  'the leading provider',
  'the number one choice',
]);

/**
 * Unsupported-claim NUMBER patterns: a figure attached to a claim context
 * (experience, client counts, results, ratings). Numbers alone are fine
 * ("resize to 800px", "check every spring"); a number claiming a RESULT or a
 * REPUTATION is what gets caught. Sources are strings so they compile once in
 * the guard.
 */
export const UNSUPPORTED_CLAIM_PATTERNS = Object.freeze([
  // "10 years of experience", "over 5 years in business"
  '\\b\\d+\\+?\\s*(?:years?|yrs?)\\s+(?:of\\s+)?(?:experience|in\\s+business|serving)',
  // "over 500 clients", "1,000+ customers", "hundreds of projects completed"
  '\\b(?:over|more\\s+than|upwards\\s+of|nearly)?\\s*\\d[\\d,]*\\+?\\s*(?:clients?|customers?|businesses|projects?|websites?|reviews?)\\b',
  // "50% increase", "grew traffic by 30%", "2x more leads"
  '\\b\\d+(?:\\.\\d+)?\\s*%\\s*(?:increase|growth|more|boost|improvement|higher|faster|reduction)',
  '\\b\\d+x\\s+(?:more|faster|better|the\\s+traffic|the\\s+leads|revenue)',
  // "rated 5 stars", "ranked #1", "5-star reviews"
  '\\b(?:rated|ranked)\\s+#?\\d',
  '\\b\\d+(?:\\.\\d+)?\\s*(?:star|stars)\\b',
]);

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
  // Phase 4.8: a HARD failure the retries could not fix. Distinct from
  // needs_review: it cannot be approved, only retried, edited or deleted.
  // Dressing a hard failure as "needs review" is the dishonesty this prevents.
  GENERATION_FAILED: 'generation_failed',
});
export const PLANNER_ITEM_STATUS_VALUES = Object.freeze(Object.values(PLANNER_ITEM_STATUS));

/** Item quality roll-up, stored separately from the human approval status. */
export const PLANNER_QUALITY_STATUS = Object.freeze({
  PASSED: 'passed',
  NEEDS_REVIEW: 'needs_review',
  GENERATION_FAILED: 'generation_failed',
});

/** Plan lengths offered in the wizard; any 1..PLANNER_LIMITS.MAX_PLAN_LENGTH is accepted. */
export const PLANNER_PLAN_LENGTHS = Object.freeze([3, 5, 7, 14]);

export const PLANNER_LIMITS = Object.freeze({
  MIN_PLAN_LENGTH: 1,
  MAX_PLAN_LENGTH: 14,
  // Hard ceiling on posts per run: plan length x posts per day. Bounds both the
  // OpenAI/HCTI spend and the duplication comparison work.
  MAX_ITEMS_PER_RUN: 28,
  MAX_TIMES_PER_DAY: 5,
  // Posts per ACTIVE day. Always explicit, never inferred from the time count.
  MAX_POSTS_PER_DAY: 5,
  DEFAULT_POSTS_PER_DAY: 1,
  MAX_REGENERATION_ATTEMPTS: 2,
  /*
   * How many different layouts a full plan should reach for.
   *
   * A week that renders four designs reads as a template with the words swapped.
   * This is a TARGET, not a floor: it is capped by how many layouts the user's
   * own content mix can actually reach, so a mix of nothing but checklists still
   * produces checklists. It only ever reorganises formats the user already
   * weighted above zero.
   */
  MIN_DISTINCT_LAYOUTS: 5,
  // How many recent items the uniqueness check compares a new post against.
  DUPLICATE_LOOKBACK_ITEMS: 60,
  DUPLICATE_LOOKBACK_DAYS: 60,
  NAME_MAX: 160,
  NOTES_MAX: 2000,
  SUMMARY_MAX: 500,
  BRIEF_MAX: 2000,
});

/**
 * At or above this a post is not "similar", it is the same post.
 *
 * Repetition below this stays a soft flag, because judging whether two posts on
 * one service are genuinely different is a call a human can make. At 0.9 there
 * is nothing to judge, so the item becomes a hard failure rather than review
 * work handed to somebody as though it were.
 */
export const HARD_DUPLICATE_SCORE = 0.9;

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
