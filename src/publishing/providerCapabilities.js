/**
 * The ONE provider capability registry (D2).
 *
 * Every provider rule Cyflow needs to publish — account type, post types, media
 * requirements, caption limits, scopes, reconciliation support — lives here and
 * nowhere else. Generation readiness, approval readiness, queue readiness, the
 * publish jobs, the Queue/Calendar UI and failure explanations all read from it,
 * so a rule is never duplicated (and never drifts) across controllers and pages.
 *
 * Supported providers are strictly Facebook Pages, Instagram Professional and
 * Threads. There is no entry for any other network, and there never will be one
 * added casually — a new key here is a deliberate product decision.
 */

import { PLATFORMS, ACCOUNT_TYPES, OAUTH_SCOPES, PUBLISH_ERROR_CATEGORY } from '../config/constants.js';

const IMAGE_MIME = Object.freeze(['image/jpeg', 'image/png']);

/**
 * @typedef {Object} ProviderCapability
 * @property {string} platform
 * @property {string} accountType        the ONLY account type this can publish to
 * @property {string[]} postTypes        'text' and/or 'image'
 * @property {boolean} mediaRequired      true when a post cannot be text-only
 * @property {string[]} mediaMimeTypes
 * @property {object} mediaLimits
 * @property {number} captionMax          hard provider caption cap
 * @property {string[]} requiredMetadata  account fields that must be present
 * @property {string[]} requiredScopes    OAuth scopes the token must carry
 * @property {boolean} tokenRequired
 * @property {boolean} reconciliationSupported
 * @property {boolean} adapterAvailable
 */

export const PROVIDER_CAPABILITIES = Object.freeze({
  [PLATFORMS.FACEBOOK]: Object.freeze({
    platform: PLATFORMS.FACEBOOK,
    provider: 'meta',
    accountType: ACCOUNT_TYPES.FACEBOOK_PAGE,
    postTypes: Object.freeze(['text', 'image']),
    mediaRequired: false, // a Page can post text-only
    mediaMimeTypes: IMAGE_MIME,
    mediaLimits: Object.freeze({ maxBytes: 8 * 1024 * 1024 }),
    captionMax: 63206,
    requiredMetadata: Object.freeze(['providerAccountId']),
    requiredScopes: OAUTH_SCOPES.meta,
    tokenRequired: true,
    // The Page publish is synchronous — it returns the post id directly, so no
    // container/reconcile step is needed.
    reconciliationSupported: false,
    adapterAvailable: true,
  }),
  [PLATFORMS.INSTAGRAM]: Object.freeze({
    platform: PLATFORMS.INSTAGRAM,
    provider: 'instagram',
    accountType: ACCOUNT_TYPES.INSTAGRAM_PROFESSIONAL,
    postTypes: Object.freeze(['image']),
    mediaRequired: true, // Instagram has no text-only post
    mediaMimeTypes: IMAGE_MIME,
    mediaLimits: Object.freeze({ maxBytes: 8 * 1024 * 1024 }),
    captionMax: 2200,
    requiredMetadata: Object.freeze(['providerAccountId']),
    requiredScopes: OAUTH_SCOPES.instagram,
    tokenRequired: true,
    // Container-based publishing: create -> (poll) -> publish. An uncertain
    // result is reconciled against the container, never blindly retried.
    reconciliationSupported: true,
    adapterAvailable: true,
  }),
  [PLATFORMS.THREADS]: Object.freeze({
    platform: PLATFORMS.THREADS,
    provider: 'threads',
    accountType: ACCOUNT_TYPES.THREADS_PROFILE,
    postTypes: Object.freeze(['text', 'image']),
    mediaRequired: false, // Threads supports text-only
    mediaMimeTypes: IMAGE_MIME,
    mediaLimits: Object.freeze({ maxBytes: 8 * 1024 * 1024 }),
    captionMax: 500,
    requiredMetadata: Object.freeze(['providerAccountId']),
    requiredScopes: OAUTH_SCOPES.threads,
    tokenRequired: true,
    // Threads also uses a create -> publish container flow.
    reconciliationSupported: true,
    adapterAvailable: true,
  }),
});

/** Platform values that have a real adapter. */
export const PUBLISHABLE_PLATFORMS = Object.freeze(
  Object.values(PROVIDER_CAPABILITIES).filter((c) => c.adapterAvailable).map((c) => c.platform),
);

/** Get the capability for a platform, or null. */
export function capabilityFor(platform) {
  return PROVIDER_CAPABILITIES[platform] || null;
}

/** Map an account type to its platform capability (or null for unsupported). */
export function capabilityForAccountType(accountType) {
  return Object.values(PROVIDER_CAPABILITIES).find((c) => c.accountType === accountType) || null;
}

/**
 * Whether a target is publishable given its account type + whether media is
 * present. Returns { ok } or { ok:false, category, reason } using the normalized
 * safe categories — the single source of truth for readiness everywhere.
 */
export function checkPublishReadiness({ accountType, hasMedia, caption }) {
  const cap = capabilityForAccountType(accountType);
  if (!cap) {
    return { ok: false, category: PUBLISH_ERROR_CATEGORY.CONFIGURATION_ERROR, reason: 'This account type cannot be published to.' };
  }
  if (cap.mediaRequired && !hasMedia) {
    const label = cap.platform === PLATFORMS.INSTAGRAM ? 'Instagram Professional' : cap.platform;
    return { ok: false, category: PUBLISH_ERROR_CATEGORY.MEDIA_REQUIRED, reason: `${label} requires an image.` };
  }
  if (typeof caption === 'string' && caption.length > cap.captionMax) {
    return { ok: false, category: PUBLISH_ERROR_CATEGORY.VALIDATION_FAILED, reason: `The ${cap.platform} caption is too long.` };
  }
  return { ok: true };
}

export default { PROVIDER_CAPABILITIES, PUBLISHABLE_PLATFORMS, capabilityFor, capabilityForAccountType, checkPublishReadiness };
