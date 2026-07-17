/**
 * Post orchestration service — drafts, content/image generation, targets,
 * scheduling, cancellation, deletion.
 *
 * Scheduling in Phase 4 saves a validated post + its targets for a FUTURE
 * publishing phase — nothing is published and no provider publish endpoint is
 * ever called. Ownership is enforced everywhere; tokens/keys are never touched
 * or returned; generation is metered and daily-limited.
 */

import { config as defaultConfig } from '../config/env.js';
import {
  POST_STATUS,
  SOCIAL_ACCOUNT_STATUS,
  ACCOUNT_TYPE_TO_PLATFORM,
  ACCOUNT_TYPES,
  USAGE_OPERATIONS,
  EVENT_TYPES,
} from '../config/constants.js';
import {
  DEFAULT_TEMPLATE as DEFAULT_IMAGE_TEMPLATE,
  listTemplates,
} from '../templates/socialImageTemplates.js';
import { ValidationError, NotFoundError, ConflictError, RateLimitError } from '../utils/errors.js';
import { toMysqlUtc, addSecondsUtc, zonedWallTimeToUtc, isValidTimezone } from '../utils/time.js';

import * as defaultPostRepo from '../repositories/postRepository.js';
import * as defaultSocialAccounts from '../repositories/socialAccountRepository.js';
import * as defaultMediaRepo from '../repositories/mediaAssetRepository.js';
import * as defaultApiUsage from '../repositories/apiUsageRepository.js';
import * as defaultIntegrationRepo from '../repositories/integrationRepository.js';
import * as defaultBusinessProfiles from '../repositories/businessProfileRepository.js';
import { openaiContentService as defaultOpenAI } from './openaiContentService.js';
import { normalizePlatformCopy } from './platformCopy.js';
import { socialImageService as defaultImage } from './socialImageService.js';
import { mediaAssetService as defaultMedia } from './mediaAssetService.js';
import { loggingService as defaultLogging } from './loggingService.js';
import { withTransaction as defaultWithTransaction } from '../db/transactions.js';

export function createPostService({
  config = defaultConfig,
  posts = defaultPostRepo,
  socialAccounts = defaultSocialAccounts,
  mediaRepository = defaultMediaRepo,
  apiUsage = defaultApiUsage,
  integrationRepository = defaultIntegrationRepo,
  businessProfiles = defaultBusinessProfiles,
  openaiContentService = defaultOpenAI,
  socialImageService = defaultImage,
  mediaAssetService = defaultMedia,
  logging = defaultLogging,
  withTransaction = defaultWithTransaction,
} = {}) {
  const DAILY_OPS = [
    USAGE_OPERATIONS.OPENAI_GENERATE_CONTENT,
    USAGE_OPERATIONS.HCTI_GENERATE_IMAGE,
  ];

  async function assertUnderDailyLimit(userId) {
    const since = addSecondsUtc(-24 * 3600);
    const used = await apiUsage.countUserOperationsSince(userId, since, { operations: DAILY_OPS });
    if (used >= config.limits.maxDailyGenerationsPerUser) {
      throw new RateLimitError('Daily generation limit reached. Please try again tomorrow.');
    }
    return used;
  }

  /** The business profile is optional branding — a missing one is not an error. */
  async function loadBusinessProfile(userId) {
    if (!businessProfiles || typeof businessProfiles.findByUserId !== 'function') return null;
    return (await businessProfiles.findByUserId(userId)) ?? null;
  }

  async function requireOwnedPost(userId, postId) {
    const post = await posts.findPostByIdForUser(postId, userId);
    if (!post) throw new NotFoundError('Post not found');
    return post;
  }

  /** Enrich a post with its targets + media preview. */
  async function enrich(userId, post) {
    const targets = await posts.listPostTargets(post.id, userId);
    let media = null;
    if (post.mediaAssetId) {
      const asset = await mediaRepository.findMediaAssetByIdForUser(post.mediaAssetId, userId);
      if (asset) {
        media = { publicToken: asset.publicToken, status: asset.status };
      }
    }
    /*
     * The resolved per-platform copy, so Create Post can render the same shared
     * platform editor the Weekly Board uses — one tab per SELECTED platform,
     * with real measurements and validation.
     *
     * A scheduled post's selected platforms come from its target accounts (not a
     * planner snapshot), so they are derived from the targets' account types.
     * Only platforms with an active account appear, deduped, which is exactly
     * "an unselected platform is never shown" for this surface.
     */
    const platformTargets = [...new Set(
      (targets || []).map((t) => ACCOUNT_TYPE_TO_PLATFORM[t.accountType]).filter(Boolean),
    )];
    const platformCopy = platformTargets.length
      ? normalizePlatformCopy({
        platformTargets,
        platformCaptions: post.platformCaptions ?? null,
        caption: post.baseCaption ?? null,
        hashtags: [],
        editedFields: [],
      })
      : {};
    return { ...post, targets, media, platformTargets, platformCopy };
  }

  // --- drafts --------------------------------------------------------------

  async function createDraft(userId, fields, { req } = {}) {
    const post = await posts.createDraftPost({
      userId,
      title: fields.title ?? null,
      prompt: fields.brief ?? null,
      generationParams: buildGenerationParams(fields),
      templateName: fields.template ?? null,
      aspectRatio: fields.aspectRatio ?? null,
      backgroundStyle: fields.backgroundStyle ?? null,
    });
    await logging.record(EVENT_TYPES.POST_DRAFT_CREATED, {
      req, userId, message: 'Draft created', context: { postId: post.id },
    });
    return enrich(userId, post);
  }

  async function updateDraft(userId, postId, fields, { req } = {}) {
    await requireOwnedPost(userId, postId);
    const updated = await posts.updateDraftPost(postId, userId, {
      title: fields.title,
      prompt: fields.brief,
      generationParams: fields.brief !== undefined || hasGenParams(fields) ? buildGenerationParams(fields) : undefined,
      templateName: fields.template,
      aspectRatio: fields.aspectRatio,
      backgroundStyle: fields.backgroundStyle,
    });
    await logging.record(EVENT_TYPES.POST_DRAFT_UPDATED, {
      req, userId, message: 'Draft updated', context: { postId } });
    return enrich(userId, updated);
  }

  // --- targets -------------------------------------------------------------

  async function setTargets(userId, postId, requestedTargets, { req } = {}) {
    await requireOwnedPost(userId, postId);
    const list = Array.isArray(requestedTargets) ? requestedTargets : [];

    // Validate ownership + active status; dedupe by account id.
    const seen = new Set();
    const valid = [];
    for (const t of list) {
      const accountId = String(t.socialAccountId);
      if (seen.has(accountId)) throw new ConflictError('Duplicate target account');
      seen.add(accountId);
      // eslint-disable-next-line no-await-in-loop
      const account = await socialAccounts.findAccountByIdForUser(accountId, userId);
      if (!account) throw new ValidationError('One or more selected accounts are invalid');
      if (account.status !== SOCIAL_ACCOUNT_STATUS.ACTIVE) {
        throw new ValidationError('One or more selected accounts are not active');
      }
      valid.push({ socialAccountId: accountId, captionOverride: t.captionOverride ?? null });
    }

    const targets = await posts.replacePostTargets(postId, userId, valid);
    await logging.record(EVENT_TYPES.POST_TARGETS_UPDATED, {
      req, userId, message: 'Targets updated', context: { postId, targets: targets.length } });
    return enrich(userId, await requireOwnedPost(userId, postId));
  }

  function platformsForTargets(targets) {
    const set = new Set();
    for (const t of targets) {
      const platform = ACCOUNT_TYPE_TO_PLATFORM[t.accountType];
      if (platform) set.add(platform);
    }
    return [...set];
  }

  // --- content generation --------------------------------------------------

  async function generateContent(userId, postId, { req } = {}) {
    const post = await requireOwnedPost(userId, postId);
    if (!(await openaiContentService.isAvailable(userId))) {
      throw new ConflictError('Add and verify your OpenAI API key in Integrations before using AI generation.');
    }
    const targets = await posts.listPostTargets(postId, userId);
    const platforms = platformsForTargets(targets);
    if (platforms.length === 0) {
      throw new ValidationError('Select at least one connected account before generating content');
    }
    if (!post.brief || String(post.brief).trim() === '') {
      throw new ValidationError('Add a content brief before generating content');
    }

    await assertUnderDailyLimit(userId);

    const params = post.generationParams || {};
    let result;
    try {
      result = await openaiContentService.generateSocialContent(
        {
          brief: post.brief,
          brandName: params.brandName,
          targetPlatforms: platforms,
          tone: params.tone,
          callToAction: params.callToAction,
          language: params.language,
          hashtagPreference: params.hashtagPreference,
          additionalInstructions: params.additionalInstructions,
        },
        { userId, postId },
      );
    } catch (err) {
      await logging.record(EVENT_TYPES.POST_CONTENT_GENERATION_FAILED, {
        req, userId, level: 'warn', message: 'Content generation failed',
        context: { postId, classification: err.classification ?? 'error' },
      });
      throw err;
    }

    const platformCaptions = {};
    for (const platform of platforms) {
      platformCaptions[platform] = result[platform];
    }
    const saved = await posts.updateGeneratedContent(postId, userId, {
      platformCaptions,
      baseCaption: platformCaptions[platforms[0]]?.caption ?? null,
      headline: result.visual.headline,
      subheadline: result.visual.subheadline,
      altText: result.visual.imageAltText,
      openaiModel: result._meta?.model ?? null,
      openaiResponseId: result._meta?.responseId ?? null,
      openaiUsage: result._meta?.usage ?? null,
      contentGeneratedAt: toMysqlUtc(),
    });

    await logging.record(EVENT_TYPES.POST_CONTENT_GENERATED, {
      req, userId, message: 'Content generated',
      context: {
        postId,
        platforms,
        usageUnits: (result._meta?.usage?.inputUnits ?? 0) + (result._meta?.usage?.outputUnits ?? 0),
      },
    });
    return enrich(userId, saved);
  }

  // --- image generation ----------------------------------------------------

  async function generateImage(userId, postId, { req } = {}) {
    const post = await requireOwnedPost(userId, postId);
    const headline = post.imageHeadline;
    if (!headline || String(headline).trim() === '') {
      throw new ValidationError('Generate content first so there is a headline for the image');
    }
    await assertUnderDailyLimit(userId);

    // The business profile supplies branding. It is optional: without one the
    // image still renders using the preset palette and the draft's brand name.
    const profile = await loadBusinessProfile(userId);
    const params = post.generationParams || {};
    const brand = brandingFor(profile, params);

    let rendered;
    try {
      rendered = await socialImageService.generateSocialImage(
        {
          userId,
          headline,
          subheadline: post.imageSubheadline,
          brandName: params.brandName || profile?.businessName || null,
          template: post.template || DEFAULT_IMAGE_TEMPLATE,
          aspectRatio: post.aspectRatio || 'square',
          backgroundStyle: post.backgroundStyle || 'light',
          ...brand,
        },
        { postId },
      );
    } catch (err) {
      await logging.record(EVENT_TYPES.POST_IMAGE_GENERATION_FAILED, {
        req, userId, level: 'warn', message: 'Image generation failed',
        context: { postId, classification: err.classification ?? 'error' },
      });
      throw err;
    }

    const asset = await mediaAssetService.createReadyImageAsset({
      userId,
      sourceUrl: rendered.sourceUrl,
      sourceAssetId: rendered.imageId,
      postId,
    });
    await logging.record(EVENT_TYPES.MEDIA_ASSET_CREATED, {
      req, userId, message: 'Media asset created', context: { postId } });

    const saved = await posts.attachMediaAsset(postId, userId, {
      mediaAssetId: asset.id,
      template: rendered.template,
      aspectRatio: rendered.aspectRatio,
      backgroundStyle: rendered.backgroundStyle,
      imageGeneratedAt: toMysqlUtc(),
    });
    await logging.record(EVENT_TYPES.POST_IMAGE_GENERATED, {
      req, userId, message: 'Image generated',
      context: { postId, template: rendered.template, aspectRatio: rendered.aspectRatio } });
    return enrich(userId, saved);
  }

  // --- scheduling ----------------------------------------------------------

  async function schedulePost(userId, postId, { scheduledDate, scheduledTime, timezone }, { req } = {}) {
    const post = await requireOwnedPost(userId, postId);

    if (!isValidTimezone(timezone)) {
      throw new ValidationError('A valid IANA timezone is required');
    }
    const wall = parseWallTime(scheduledDate, scheduledTime);
    if (!wall) throw new ValidationError('A valid future date and time is required');

    const utcInstant = zonedWallTimeToUtc(wall, timezone);
    if (!(utcInstant instanceof Date) || Number.isNaN(utcInstant.getTime())) {
      throw new ValidationError('A valid future date and time is required');
    }
    if (utcInstant.getTime() <= Date.now()) {
      throw new ValidationError('The scheduled time must be in the future');
    }

    const targets = await posts.listPostTargets(postId, userId);
    const activeTargets = targets.filter((t) => t.accountStatus === SOCIAL_ACCOUNT_STATUS.ACTIVE);
    if (activeTargets.length === 0) {
      throw new ValidationError('Select at least one active connected account');
    }

    // Every target must have caption content (override or generated platform caption).
    for (const t of activeTargets) {
      const platform = ACCOUNT_TYPE_TO_PLATFORM[t.accountType];
      const generated = post.platformCaptions?.[platform]?.caption;
      const caption = t.captionOverride || generated;
      if (!caption || String(caption).trim() === '') {
        throw new ValidationError('Every selected account needs caption content before scheduling');
      }
    }

    // Instagram requires an image for the future publishing phase.
    const needsImage = activeTargets.some((t) => t.accountType === ACCOUNT_TYPES.INSTAGRAM_PROFESSIONAL);
    if (needsImage && !post.mediaAssetId) {
      throw new ValidationError('Instagram scheduling requires a generated image');
    }

    const scheduled = await withTransaction(async (conn) => {
      return posts.schedulePost(
        postId,
        userId,
        { scheduledAtUtc: toMysqlUtc(utcInstant), originalTimezone: timezone },
        conn,
      );
    });

    await logging.record(EVENT_TYPES.POST_SCHEDULED, {
      req, userId, message: 'Post scheduled',
      context: { postId, targets: activeTargets.length, scheduledAtUtc: toMysqlUtc(utcInstant) } });

    const enriched = await enrich(userId, scheduled);
    return {
      ...enriched,
      // Honest message — nothing is published in this phase.
      notice: 'Your post is queued. Automatic publishing to providers will be enabled in a later phase.',
    };
  }

  async function cancelPost(userId, postId, { req } = {}) {
    const post = await requireOwnedPost(userId, postId);
    const cancellable = [POST_STATUS.DRAFT, POST_STATUS.QUEUED, POST_STATUS.RETRYING, POST_STATUS.PROCESSING];
    if (!cancellable.includes(post.status)) {
      throw new ConflictError('This post can no longer be cancelled');
    }
    const cancelled = await withTransaction(async (conn) => posts.cancelScheduledPost(postId, userId, conn));
    await logging.record(EVENT_TYPES.POST_CANCELLED, {
      req, userId, message: 'Post cancelled', context: { postId } });
    return enrich(userId, cancelled);
  }

  async function deleteDraft(userId, postId, { req } = {}) {
    await requireOwnedPost(userId, postId);
    const result = await posts.deleteDraftPost(postId, userId);
    if (!result.deleted) {
      throw new ConflictError('This post has publishing history and cannot be deleted');
    }
    await logging.record(EVENT_TYPES.POST_DELETED, {
      req, userId, message: 'Post deleted', context: { postId } });
    return { deleted: true };
  }

  // --- reads ---------------------------------------------------------------

  async function getPost(userId, postId) {
    const post = await requireOwnedPost(userId, postId);
    return enrich(userId, post);
  }

  async function listPosts(userId, opts = {}) {
    const list = await posts.listPostsForUser(userId, opts);
    // Enrich list items with a light media preview + target count.
    const out = [];
    for (const post of list) {
      // eslint-disable-next-line no-await-in-loop
      out.push(await enrich(userId, post));
    }
    return out;
  }

  async function getCapabilities(userId) {
    const hcti = await integrationRepository.getHctiCredentialRecord(userId);
    const since = addSecondsUtc(-24 * 3600);
    const used = await apiUsage.countUserOperationsSince(userId, since, { operations: DAILY_OPS });
    return {
      // Reports whether THIS user can generate, so the UI can disable an
      // action rather than let them discover it by failing.
      openai: { available: await openaiContentService.isAvailable(userId) },
      hcti: {
        configured: Boolean(hcti && hcti.configured),
        verified: Boolean(hcti && hcti.verifiedAt),
      },
      generations: { usedToday: used, dailyLimit: config.limits.maxDailyGenerationsPerUser },
      // The picker is built from this, so the UI can never drift from the
      // layouts the renderer actually has.
      templates: listTemplates(),
    };
  }

  return {
    createDraft,
    updateDraft,
    setTargets,
    generateContent,
    generateImage,
    schedulePost,
    cancelPost,
    deleteDraft,
    getPost,
    listPosts,
    getCapabilities,
  };
}

// --- helpers ---------------------------------------------------------------

function hasGenParams(fields) {
  return [
    'brandName', 'tone', 'callToAction', 'language', 'hashtagPreference',
    'additionalInstructions', 'includeLogo', 'includeWebsite', 'includePhone',
  ].some((k) => fields[k] !== undefined);
}

function buildGenerationParams(fields) {
  return {
    brandName: fields.brandName ?? null,
    tone: fields.tone ?? null,
    callToAction: fields.callToAction ?? null,
    language: fields.language ?? null,
    hashtagPreference: fields.hashtagPreference ?? null,
    additionalInstructions: fields.additionalInstructions ?? null,
    // Which business details the user wants overlaid on the image.
    includeLogo: toBool(fields.includeLogo, true),
    includeWebsite: toBool(fields.includeWebsite, true),
    includePhone: toBool(fields.includePhone, false),
  };
}

function toBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === true;
}

/**
 * Map the stored business profile onto image-template inputs, honouring the
 * draft's overlay toggles. Every value is re-validated by the template builder.
 */
function brandingFor(profile, params = {}) {
  if (!profile) return {};
  return {
    logoUrl: toBool(params.includeLogo, true) ? profile.logoUrl || null : null,
    primaryColor: profile.primaryColor || null,
    secondaryColor: profile.secondaryColor || null,
    accentColor: profile.accentColor || null,
    headingFont: profile.headingFont || null,
    bodyFont: profile.bodyFont || null,
    cta: params.callToAction || profile.defaultCallToAction || null,
    website: toBool(params.includeWebsite, true) ? displayWebsite(profile.websiteUrl) : null,
    phone: toBool(params.includePhone, false) ? profile.phone || null : null,
    // Optional design modules. The eyebrow falls back to the category when the
    // business has no brand name; the tag names the first real service.
    businessCategory: profile.businessCategory || null,
    serviceTag: Array.isArray(profile.services) && profile.services.length
      ? String(profile.services[0])
      : null,
  };
}

/** Show a website as a bare host — never the full URL with query/path noise. */
function displayWebsite(websiteUrl) {
  if (!websiteUrl) return null;
  try {
    return new URL(websiteUrl).host.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

function parseWallTime(dateStr, timeStr) {
  if (typeof dateStr !== 'string' || typeof timeStr !== 'string') return null;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr.trim());
  if (!dm || !tm) return null;
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

export const postService = createPostService();
export default postService;
