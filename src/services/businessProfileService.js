/**
 * Business profile orchestration.
 *
 * Validates and normalizes business/brand data, runs (explicit, user-triggered)
 * website analysis, and tracks which fields the user edited by hand so later
 * automatic suggestions never silently overwrite them. Ownership always comes
 * from the authenticated session. Returns sanitized data only — never raw page
 * HTML or fetch internals.
 */

import { config as defaultConfig } from '../config/env.js';
import {
  ONBOARDING_STATUS,
  BUSINESS_LIMITS,
  WEBSITE_ANALYSIS,
  CONTENT_TONES,
  EVENT_TYPES,
} from '../config/constants.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { toMysqlUtc } from '../utils/time.js';
import { normalizeWebsiteUrl } from '../utils/urlSafety.js';
import { isEmail } from '../utils/validation.js';

import * as defaultRepo from '../repositories/businessProfileRepository.js';
import { websiteAnalysisService as defaultAnalyzer } from './websiteAnalysisService.js';
import { loggingService as defaultLogging } from './loggingService.js';

/** Fields a user may set/edit (whitelist — prevents mass assignment). */
export const EDITABLE_FIELDS = Object.freeze([
  'businessName',
  'websiteUrl',
  'businessCategory',
  'businessDescription',
  'phone',
  'email',
  'address',
  'city',
  'region',
  'postalCode',
  'country',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'headingFont',
  'bodyFont',
  'logoUrl',
  'faviconUrl',
  'defaultLanguage',
  'defaultTone',
  'defaultCallToAction',
  'services',
  'locations',
  'socialLinks',
]);

const TEXT_LIMITS = {
  businessName: BUSINESS_LIMITS.NAME_MAX,
  businessCategory: BUSINESS_LIMITS.CATEGORY_MAX,
  businessDescription: BUSINESS_LIMITS.DESCRIPTION_MAX,
  phone: BUSINESS_LIMITS.PHONE_MAX,
  email: BUSINESS_LIMITS.EMAIL_MAX,
  address: BUSINESS_LIMITS.ADDRESS_MAX,
  city: BUSINESS_LIMITS.CITY_MAX,
  region: BUSINESS_LIMITS.REGION_MAX,
  postalCode: BUSINESS_LIMITS.POSTAL_MAX,
  country: BUSINESS_LIMITS.COUNTRY_MAX,
  defaultLanguage: BUSINESS_LIMITS.LANGUAGE_MAX,
  defaultCallToAction: BUSINESS_LIMITS.CTA_MAX,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FONT_RE = /^[A-Za-z0-9 _-]{1,80}$/;

function trimTo(value, max) {
  const s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return s.length > max ? s.slice(0, max) : s;
}

function fieldError(field, message) {
  return new ValidationError(message, [{ field, message }]);
}

/** Validate + normalize a whitelisted patch. Unknown fields are rejected. */
export function validateProfilePatch(input, { isProd = false } = {}) {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid business details');

  const unknown = Object.keys(input).filter((k) => !EDITABLE_FIELDS.includes(k));
  if (unknown.length > 0) {
    throw new ValidationError('Unknown fields are not accepted', unknown.map((f) => ({ field: f, message: 'Unknown field' })));
  }

  const out = {};

  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    if (input[field] === undefined) continue;
    if (input[field] === null) {
      out[field] = null;
      continue;
    }
    if (typeof input[field] !== 'string') throw fieldError(field, 'Must be text');
    out[field] = trimTo(input[field], max);
  }

  if (out.email) {
    if (!isEmail(out.email)) throw fieldError('email', 'A valid email address is required');
  }

  for (const field of ['websiteUrl', 'logoUrl', 'faviconUrl']) {
    if (input[field] === undefined) continue;
    if (input[field] === null || input[field] === '') {
      out[field] = null;
      continue;
    }
    try {
      // Normalizes + rejects credentials/blocked hosts; also enforces the
      // production https policy for anything we may later fetch.
      const { url } = normalizeWebsiteUrl(input[field], { isProd });
      out[field] = url.toString().slice(0, BUSINESS_LIMITS.URL_MAX);
    } catch {
      throw fieldError(field, 'A valid URL is required');
    }
  }

  for (const field of ['primaryColor', 'secondaryColor', 'accentColor']) {
    if (input[field] === undefined) continue;
    if (input[field] === null || input[field] === '') {
      out[field] = null;
      continue;
    }
    const value = String(input[field]).trim();
    if (!HEX_RE.test(value)) throw fieldError(field, 'Use a hex colour such as #1A2B3C');
    out[field] = value.toLowerCase();
  }

  for (const field of ['headingFont', 'bodyFont']) {
    if (input[field] === undefined) continue;
    if (input[field] === null || input[field] === '') {
      out[field] = null;
      continue;
    }
    const value = trimTo(input[field], BUSINESS_LIMITS.FONT_MAX);
    if (!FONT_RE.test(value)) throw fieldError(field, 'Use a plain font name');
    out[field] = value;
  }

  if (input.defaultTone !== undefined) {
    if (input.defaultTone === null || input.defaultTone === '') out.defaultTone = null;
    else if (!CONTENT_TONES.includes(input.defaultTone)) throw fieldError('defaultTone', 'Invalid tone');
    else out.defaultTone = input.defaultTone;
  }

  if (input.services !== undefined) {
    if (!Array.isArray(input.services)) throw fieldError('services', 'Services must be a list');
    const seen = new Set();
    const services = [];
    for (const raw of input.services) {
      if (typeof raw !== 'string') throw fieldError('services', 'Each service must be text');
      const s = trimTo(raw, BUSINESS_LIMITS.SERVICE_MAX);
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      services.push(s);
    }
    if (services.length > WEBSITE_ANALYSIS.MAX_SERVICES) {
      throw fieldError('services', `At most ${WEBSITE_ANALYSIS.MAX_SERVICES} services`);
    }
    out.services = services;
  }

  if (input.locations !== undefined) {
    if (!Array.isArray(input.locations)) throw fieldError('locations', 'Locations must be a list');
    const locations = input.locations
      .filter((l) => typeof l === 'string')
      .map((l) => trimTo(l, BUSINESS_LIMITS.LOCATION_MAX))
      .filter(Boolean)
      .slice(0, WEBSITE_ANALYSIS.MAX_LOCATIONS);
    out.locations = locations;
  }

  if (input.socialLinks !== undefined) {
    if (!Array.isArray(input.socialLinks)) throw fieldError('socialLinks', 'Social links must be a list');
    const links = [];
    for (const item of input.socialLinks.slice(0, WEBSITE_ANALYSIS.MAX_SOCIAL_LINKS)) {
      if (!item || typeof item !== 'object') continue;
      const platform = trimTo(item.platform, 40);
      let url = '';
      try {
        url = new URL(String(item.url)).toString().slice(0, BUSINESS_LIMITS.URL_MAX);
      } catch {
        throw fieldError('socialLinks', 'Each social link needs a valid URL');
      }
      if (platform) links.push({ platform, url });
    }
    out.socialLinks = links;
  }

  return out;
}

export function createBusinessProfileService({
  config = defaultConfig,
  profiles = defaultRepo,
  analyzer = defaultAnalyzer,
  logging = defaultLogging,
} = {}) {
  async function getBusinessProfile(userId) {
    return profiles.findByUserId(userId);
  }

  /** Onboarding state; users with no profile row are never locked out. */
  async function getOnboardingState(userId) {
    const profile = await profiles.findByUserId(userId);
    const status = profile?.onboardingStatus || ONBOARDING_STATUS.NOT_STARTED;
    const completed = status === ONBOARDING_STATUS.COMPLETED;
    return {
      status,
      hasProfile: Boolean(profile),
      // Existing users simply have not onboarded yet — they keep full access
      // and are prompted (not forced) to complete business setup.
      needsOnboarding: !completed,
      canUseApp: true,
      completedAt: profile?.onboardingCompletedAt || null,
      businessName: profile?.businessName || null,
    };
  }

  /** Explicit, user-triggered website analysis. Nothing is saved here. */
  async function analyzeBusinessWebsite(userId, websiteUrl, { req } = {}) {
    // Mark progress so a refresh does not re-crawl implicitly.
    await profiles.updateOnboardingStatus(userId, ONBOARDING_STATUS.ANALYZING);

    let result;
    try {
      result = await analyzer.analyzeWebsite({ userId, websiteUrl });
    } catch (err) {
      await profiles.updateOnboardingStatus(userId, ONBOARDING_STATUS.BUSINESS_SOURCE);
      await logging.record(EVENT_TYPES.BUSINESS_WEBSITE_ANALYSIS_FAILED, {
        req,
        userId,
        level: 'warn',
        message: 'Website analysis failed',
        // Host only — never the page content or the internal error.
        context: { reason: err?.code || 'analysis_failed' },
      });
      throw err;
    }

    await profiles.updateOnboardingStatus(userId, ONBOARDING_STATUS.BRAND_REVIEW);
    await logging.record(EVENT_TYPES.BUSINESS_WEBSITE_ANALYZED, {
      req,
      userId,
      message: 'Website analyzed',
      context: { pages: result.pagesAnalyzed.length, logoFound: Boolean(result.suggestions.logoUrl) },
    });
    // Suggestions only — the user reviews/edits before anything is saved.
    return result;
  }

  /** Save a user-reviewed patch; every provided field is marked manual. */
  async function updateBusinessProfile(userId, data, { req, sourceType } = {}) {
    const patch = validateProfilePatch(data, { isProd: config.isProd });
    const existing = await profiles.findByUserId(userId, { includeDiagnostics: true });

    const manual = new Set(existing?.manualFields || []);
    for (const key of Object.keys(patch)) manual.add(key);

    const saved = await profiles.createOrUpdateProfile(userId, {
      ...patch,
      manualFields: [...manual],
      ...(sourceType ? { sourceType } : {}),
    });
    await logging.record(EVENT_TYPES.BUSINESS_PROFILE_UPDATED, {
      req,
      userId,
      message: 'Business profile updated',
      context: { fields: Object.keys(patch).length },
    });
    return saved;
  }

  function saveManualBusinessProfile(userId, data, ctx = {}) {
    return updateBusinessProfile(userId, data, { ...ctx, sourceType: 'manual' });
  }

  /**
   * Save reviewed extracted data. Fields the user previously edited by hand are
   * PRESERVED — automatic suggestions never silently overwrite them.
   */
  async function saveExtractedBusinessProfile(userId, data, { req, extractedMetadata } = {}) {
    const patch = validateProfilePatch(data, { isProd: config.isProd });
    const existing = await profiles.findByUserId(userId, { includeDiagnostics: true });
    const manual = new Set(existing?.manualFields || []);

    const applied = {};
    const skipped = [];
    for (const [key, value] of Object.entries(patch)) {
      if (manual.has(key)) {
        skipped.push(key); // user's own edit wins
        continue;
      }
      applied[key] = value;
    }

    const saved = await profiles.createOrUpdateProfile(userId, {
      ...applied,
      sourceType: existing && existing.sourceType === 'manual' ? 'mixed' : 'website',
      ...(extractedMetadata ? { extractedMetadata } : {}),
    });
    await logging.record(EVENT_TYPES.BUSINESS_PROFILE_UPDATED, {
      req,
      userId,
      message: 'Extracted business profile saved',
      context: { applied: Object.keys(applied).length, preserved: skipped.length },
    });
    return { profile: saved, preservedFields: skipped };
  }

  async function completeOnboarding(userId, { req } = {}) {
    const profile = await profiles.markOnboardingComplete(userId, toMysqlUtc());
    if (!profile) throw new NotFoundError('Business profile not found');
    await logging.record(EVENT_TYPES.BUSINESS_ONBOARDING_COMPLETED, {
      req,
      userId,
      message: 'Onboarding completed',
    });
    return profile;
  }

  async function deleteBusinessProfile(userId, { req } = {}) {
    const deleted = await profiles.deleteBusinessProfile(userId);
    await logging.record(EVENT_TYPES.BUSINESS_PROFILE_DELETED, {
      req,
      userId,
      message: 'Business profile deleted',
    });
    return { deleted };
  }

  return {
    getBusinessProfile,
    getOnboardingState,
    analyzeBusinessWebsite,
    updateBusinessProfile,
    saveManualBusinessProfile,
    saveExtractedBusinessProfile,
    completeOnboarding,
    deleteBusinessProfile,
  };
}

export const businessProfileService = createBusinessProfileService();
export default businessProfileService;
