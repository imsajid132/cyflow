/**
 * Social image composition service.
 *
 * Loads the authenticated user's ENCRYPTED HCTI credentials, decrypts them only
 * in memory immediately before the render, builds a trusted server-owned
 * template (escaped user text, sanitized HTML as defence-in-depth), and renders
 * via the dynamic hctiService. Credentials are never returned or logged; raw
 * HCTI error bodies are never exposed. Calls are metered in api_usage.
 */

import sanitizeHtmlLib from 'sanitize-html';

import { config as defaultConfig } from '../config/env.js';
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_VALUES,
  IMAGE_TEMPLATES,
  LEGACY_IMAGE_TEMPLATE_ALIASES,
  BACKGROUND_STYLES,
  USAGE_SERVICES,
  USAGE_OPERATIONS,
  ERROR_CODES,
} from '../config/constants.js';
import { AppError } from '../utils/errors.js';
import { buildTemplate, normalizeTemplate, safeImageUrl } from '../templates/socialImageTemplates.js';

import * as defaultIntegrationRepo from '../repositories/integrationRepository.js';
import { hctiService as defaultHctiService } from './hctiService.js';
import * as defaultApiUsage from '../repositories/apiUsageRepository.js';
import { decryptSecret as defaultDecrypt } from './encryptionService.js';

export const IMAGE_ERROR_CODES = Object.freeze({
  HCTI_NOT_CONFIGURED: 'hcti_not_configured',
  HCTI_NOT_VERIFIED: 'hcti_not_verified',
  IMAGE_GENERATION_FAILED: 'image_generation_failed',
});

const SAFE_MESSAGES = {
  hcti_not_configured: 'Your HCTI credentials are not configured. Add them in HCTI Settings.',
  hcti_not_verified: 'Your HCTI credentials are not verified. Test them in HCTI Settings.',
  image_generation_failed: 'The image could not be generated. Please try again.',
};

export class SocialImageError extends AppError {
  constructor(classification, statusCode = 409) {
    super(SAFE_MESSAGES[classification] || SAFE_MESSAGES.image_generation_failed, {
      statusCode,
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
    });
    this.classification = classification;
  }
}

/**
 * Strict allow-list sanitization of our own generated HTML (defence in depth).
 *
 * The sectioning elements the layouts are built from (header/footer/aside/
 * section) are allowed: they are inert, they carry the layout's flex structure,
 * and discarding them would silently flatten the design. `img` is permitted so
 * a business logo can be composited, but only with src/alt and only over https.
 * Everything else — scripts, styles, iframes, forms, handlers — is discarded.
 */
export const SANITIZE_ALLOWED_TAGS = Object.freeze([
  'div', 'span', 'header', 'footer', 'aside', 'section',
  'h1', 'h2', 'p', 'br', 'strong', 'em', 'small', 'img',
  // Phase 4.7: the checklist and comparison layouts are genuinely lists.
  // Discarding these would keep the text but flatten the layout silently.
  'ul', 'ol', 'li',
]);

function sanitizeGeneratedHtml(html) {
  return sanitizeHtmlLib(html, {
    allowedTags: [...SANITIZE_ALLOWED_TAGS],
    allowedAttributes: { '*': ['class'], img: ['class', 'src', 'alt'] },
    // No styles/scripts/iframes/forms/objects/embeds/event handlers.
    allowedSchemes: ['https'],
    allowedSchemesByTag: { img: ['https'] },
    allowedSchemesAppliedToAttributes: ['src', 'href', 'cite'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  });
}

/** Exposed so tests can prove the layouts survive sanitization intact. */
export function sanitizeForTest(html) {
  return sanitizeGeneratedHtml(html);
}

/**
 * Map any accepted template name onto a real layout. Delegates to the template
 * module so the service and the renderer can never disagree about the default.
 */
export function resolveTemplate(name) {
  return normalizeTemplate(name);
}

export function createSocialImageService({
  config = defaultConfig,
  integrationRepository = defaultIntegrationRepo,
  hctiService = defaultHctiService,
  apiUsage = defaultApiUsage,
  decryptSecret = defaultDecrypt,
} = {}) {
  /**
   * @param {{ userId, headline, subheadline, brandName, template, aspectRatio,
   *           backgroundStyle, logoUrl?, primaryColor?, secondaryColor?,
   *           accentColor?, headingFont?, bodyFont?, cta?, website?, phone?,
   *           businessCategory?, serviceTag? }} input
   * @param {{ postId? }} [ctx]
   */
  async function generateSocialImage(input, ctx = {}) {
    const template = resolveTemplate(input.template);
    const aspectRatio = ASPECT_RATIO_VALUES.includes(input.aspectRatio) ? input.aspectRatio : 'square';
    const backgroundStyle = BACKGROUND_STYLES.includes(input.backgroundStyle)
      ? input.backgroundStyle
      : 'light';

    const record = await integrationRepository.getHctiCredentialRecord(input.userId);
    if (!record || !record.configured) {
      throw new SocialImageError(IMAGE_ERROR_CODES.HCTI_NOT_CONFIGURED);
    }
    if (!record.verifiedAt) {
      throw new SocialImageError(IMAGE_ERROR_CODES.HCTI_NOT_VERIFIED);
    }

    // Build trusted template, then sanitize the HTML as defence in depth.
    const built = buildTemplate({
      template,
      aspectRatio,
      backgroundStyle,
      brandName: input.brandName,
      headline: input.headline,
      subheadline: input.subheadline,
      // Brand inputs — each is re-validated inside the template builder.
      logoUrl: safeImageUrl(input.logoUrl),
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      accentColor: input.accentColor,
      headingFont: input.headingFont,
      bodyFont: input.bodyFont,
      cta: input.cta,
      website: input.website,
      phone: input.phone,
      // Optional design modules — omitted from the layout when absent.
      businessCategory: input.businessCategory,
      serviceTag: input.serviceTag,
    });
    const safeHtml = sanitizeGeneratedHtml(built.html);

    // Decrypt only immediately before the render; drop refs afterwards.
    let hctiUserId = decryptSecret(record.encryptedUserId);
    let hctiApiKey = decryptSecret(record.encryptedApiKey);

    let rendered;
    try {
      rendered = await hctiService.generateImage({
        hctiUserId,
        hctiApiKey,
        html: safeHtml,
        css: built.css,
        viewportWidth: built.width,
        viewportHeight: built.height,
      });
    } catch (err) {
      hctiUserId = undefined;
      hctiApiKey = undefined;
      await meter(input.userId, ctx.postId, template, aspectRatio, false).catch(() => {});
      // hctiService errors are already safe/credential-free; surface a generic one.
      throw new SocialImageError(IMAGE_ERROR_CODES.IMAGE_GENERATION_FAILED, 502);
    } finally {
      hctiUserId = undefined;
      hctiApiKey = undefined;
    }

    await meter(input.userId, ctx.postId, template, aspectRatio, true).catch(() => {});

    return {
      imageId: rendered.imageId,
      sourceUrl: rendered.url,
      width: built.width,
      height: built.height,
      template,
      templateLabel: built.templateLabel,
      aspectRatio,
      backgroundStyle,
    };
  }

  async function meter(userId, postId, template, aspectRatio, success) {
    await apiUsage.recordUsage({
      userId,
      scheduledPostId: postId ?? null,
      service: USAGE_SERVICES.HCTI,
      operation: USAGE_OPERATIONS.HCTI_GENERATE_IMAGE,
      inputUnits: 0,
      outputUnits: success ? 1 : 0,
      metadata: { template, aspectRatio, success },
    });
  }

  /** Expose dimensions for a ratio (used by callers/tests). */
  function dimensionsFor(aspectRatio) {
    return ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS.square;
  }

  /**
   * Can this user render an image right now?
   *
   * The planner asks before generating a batch: it would rather produce a plan
   * with captions and pending images than fail the whole run. Returns a boolean
   * rather than throwing, and never exposes credential state beyond ready/not.
   */
  async function isReadyForUser(userId) {
    try {
      const record = await integrationRepository.getHctiCredentialRecord(userId);
      return Boolean(record && record.configured && record.verifiedAt);
    } catch {
      return false;
    }
  }

  return { generateSocialImage, dimensionsFor, isReadyForUser };
}

export const socialImageService = createSocialImageService();
export default socialImageService;
