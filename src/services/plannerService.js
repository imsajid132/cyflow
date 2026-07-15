/**
 * Planner orchestration service.
 *
 * Owns the whole plan lifecycle: preferences → schedule → briefs → captions →
 * duplication checks → reviewable plan → edits/regeneration → approval → queue.
 *
 * Two properties matter most here:
 *
 *  1. NOTHING IS PUBLISHED. Queueing an approved item creates the same kind of
 *     `scheduled_posts` row the manual Create Post flow creates, for a future
 *     publishing phase. No provider endpoint is called anywhere in this file.
 *
 *  2. USER EDITS WIN. Every field a human touches is recorded in
 *     `editedFields`, and regeneration refuses to overwrite those fields. A
 *     "regenerate image" must never silently discard a caption someone rewrote.
 *
 * Ownership is enforced on every read and write via the repository's user-scoped
 * queries; a user id is never taken from a request body.
 */

import { config as defaultConfig } from '../config/env.js';
import {
  PLANNER_RUN_STATUS,
  PLANNER_ITEM_STATUS,
  PLANNER_LIMITS,
  PLANNER_APPROVAL_MODES,
  PLANNER_CADENCES,
  PLANNER_TONES,
  PLANNER_CTA_MODES,
  PLANNER_GOALS,
  PLANNER_CONTENT_TYPES,
  PLATFORM_VALUES,
  ACCOUNT_TYPE_TO_PLATFORM,
  SOCIAL_ACCOUNT_STATUS,
  EVENT_TYPES,
  USAGE_OPERATIONS,
  IMAGE_TEMPLATE_VALUES,
} from '../config/constants.js';
import { ValidationError, NotFoundError, ConflictError, RateLimitError } from '../utils/errors.js';
import { toMysqlUtc, addSecondsUtc, isValidTimezone } from '../utils/time.js';
import { normalizeTemplate } from '../templates/socialImageTemplates.js';

import * as defaultPlannerPrefs from '../repositories/plannerPreferenceRepository.js';
import * as defaultPlannerRuns from '../repositories/plannerRunRepository.js';
import * as defaultBusinessProfiles from '../repositories/businessProfileRepository.js';
import * as defaultSocialAccounts from '../repositories/socialAccountRepository.js';
import * as defaultPostRepo from '../repositories/postRepository.js';
import * as defaultMediaRepo from '../repositories/mediaAssetRepository.js';
import * as defaultApiUsage from '../repositories/apiUsageRepository.js';
import { openaiContentService as defaultOpenAI } from './openaiContentService.js';
import { socialImageService as defaultImage } from './socialImageService.js';
import { mediaAssetService as defaultMedia } from './mediaAssetService.js';
import { contentUniquenessService as defaultUniqueness } from './contentUniquenessService.js';
import { loggingService as defaultLogging } from './loggingService.js';
import { buildSchedule, nextWeeklyRunAt } from './plannerScheduleService.js';
import { buildBriefSet, DEFAULT_CONTENT_MIX, DEFAULT_GOALS } from './plannerBriefService.js';
import { withTransaction as defaultWithTransaction } from '../db/transactions.js';

/** Documented defaults for a user who has never opened planner settings. */
export const DEFAULT_PREFERENCES = Object.freeze({
  cadence: 'every_day',
  weekdays: [1, 2, 3, 4, 5],
  times: ['09:00'],
  platforms: [],
  goals: [...DEFAULT_GOALS],
  contentMix: { ...DEFAULT_CONTENT_MIX },
  tone: 'professional',
  ctaMode: 'some',
  approvalMode: 'require_approval',
  defaultPlanLength: 7,
  timezone: null,
  autopilotEnabled: false,
  nextPlanGenerationAt: null,
});

/** Fields a human can edit. Editing any of them protects it from regeneration. */
export const EDITABLE_ITEM_FIELDS = Object.freeze([
  'caption', 'headline', 'subheadline', 'hashtags', 'altText',
  'templateKey', 'aspectRatio', 'backgroundStyle', 'scheduledFor', 'platformTargets',
]);

export function createPlannerService({
  config = defaultConfig,
  preferences: prefsRepo = defaultPlannerPrefs,
  runs: runsRepo = defaultPlannerRuns,
  businessProfiles = defaultBusinessProfiles,
  socialAccounts = defaultSocialAccounts,
  posts = defaultPostRepo,
  mediaRepository = defaultMediaRepo,
  apiUsage = defaultApiUsage,
  openaiContentService = defaultOpenAI,
  socialImageService = defaultImage,
  mediaAssetService = defaultMedia,
  uniqueness = defaultUniqueness,
  logging = defaultLogging,
  withTransaction = defaultWithTransaction,
  now = () => new Date(),
} = {}) {
  // --- preferences ---------------------------------------------------------

  async function getPreferences(userId) {
    const saved = await prefsRepo.findByUserId(userId);
    if (!saved) return { ...DEFAULT_PREFERENCES, userId: String(userId), isDefault: true };
    return { ...DEFAULT_PREFERENCES, ...stripNulls(saved), isDefault: false };
  }

  function stripNulls(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }
    return out;
  }

  async function savePreferences(userId, patch, { req } = {}) {
    const clean = validatePreferencePatch(patch);
    const saved = await prefsRepo.upsertPreferences(userId, clean);
    await logging.record(EVENT_TYPES.PLANNER_PREFERENCES_UPDATED, {
      req, userId, message: 'Planner preferences updated',
    });
    return { ...DEFAULT_PREFERENCES, ...stripNulls(saved), isDefault: false };
  }

  /** Whitelist + bound every preference field. Rejects anything unrecognised. */
  function validatePreferencePatch(patch = {}) {
    const errors = [];
    const out = {};

    if (patch.cadence !== undefined) {
      if (!PLANNER_CADENCES.includes(patch.cadence)) errors.push({ field: 'cadence', message: 'Choose a valid cadence' });
      else out.cadence = patch.cadence;
    }
    if (patch.weekdays !== undefined) {
      const days = Array.isArray(patch.weekdays) ? [...new Set(patch.weekdays.map(Number))] : null;
      if (!days || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
        errors.push({ field: 'weekdays', message: 'Weekdays must be numbers from 1 (Monday) to 7 (Sunday)' });
      } else out.weekdays = days.sort((a, b) => a - b);
    }
    if (patch.times !== undefined) {
      const times = Array.isArray(patch.times) ? patch.times : null;
      if (!times || times.some((t) => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
        errors.push({ field: 'times', message: 'Times must be in HH:MM 24-hour format' });
      } else if (times.length > PLANNER_LIMITS.MAX_TIMES_PER_DAY) {
        errors.push({ field: 'times', message: `Choose at most ${PLANNER_LIMITS.MAX_TIMES_PER_DAY} posting times` });
      } else out.times = [...new Set(times)].sort();
    }
    if (patch.platforms !== undefined) {
      const platforms = Array.isArray(patch.platforms) ? patch.platforms : null;
      if (!platforms || platforms.some((p) => !PLATFORM_VALUES.includes(p))) {
        errors.push({ field: 'platforms', message: 'Choose valid platforms' });
      } else out.platforms = [...new Set(platforms)];
    }
    if (patch.goals !== undefined) {
      const goals = Array.isArray(patch.goals) ? patch.goals : null;
      if (!goals || goals.some((g) => !PLANNER_GOALS.includes(g))) {
        errors.push({ field: 'goals', message: 'Choose valid content goals' });
      } else out.goals = [...new Set(goals)];
    }
    if (patch.contentMix !== undefined) {
      const mix = patch.contentMix;
      if (!mix || typeof mix !== 'object' || Array.isArray(mix)) {
        errors.push({ field: 'contentMix', message: 'Invalid content mix' });
      } else {
        const clean = {};
        let bad = false;
        for (const [key, value] of Object.entries(mix)) {
          if (!PLANNER_CONTENT_TYPES.includes(key)) { bad = true; break; }
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0 || n > 10) { bad = true; break; }
          clean[key] = n;
        }
        if (bad) errors.push({ field: 'contentMix', message: 'Invalid content mix' });
        else out.contentMix = clean;
      }
    }
    if (patch.tone !== undefined) {
      if (!PLANNER_TONES.includes(patch.tone)) errors.push({ field: 'tone', message: 'Choose a valid tone' });
      else out.tone = patch.tone;
    }
    if (patch.ctaMode !== undefined) {
      if (!PLANNER_CTA_MODES.includes(patch.ctaMode)) errors.push({ field: 'ctaMode', message: 'Choose a valid CTA mode' });
      else out.ctaMode = patch.ctaMode;
    }
    if (patch.approvalMode !== undefined) {
      if (!PLANNER_APPROVAL_MODES.includes(patch.approvalMode)) {
        errors.push({ field: 'approvalMode', message: 'Choose a valid approval mode' });
      } else out.approvalMode = patch.approvalMode;
    }
    if (patch.defaultPlanLength !== undefined) {
      const n = Number(patch.defaultPlanLength);
      if (!Number.isInteger(n) || n < PLANNER_LIMITS.MIN_PLAN_LENGTH || n > PLANNER_LIMITS.MAX_PLAN_LENGTH) {
        errors.push({ field: 'defaultPlanLength', message: `Plan length must be between ${PLANNER_LIMITS.MIN_PLAN_LENGTH} and ${PLANNER_LIMITS.MAX_PLAN_LENGTH} days` });
      } else out.defaultPlanLength = n;
    }
    if (patch.timezone !== undefined) {
      if (patch.timezone !== null && !isValidTimezone(patch.timezone)) {
        errors.push({ field: 'timezone', message: 'A valid IANA timezone is required' });
      } else out.timezone = patch.timezone;
    }
    if (patch.autopilotEnabled !== undefined) {
      out.autopilotEnabled = Boolean(patch.autopilotEnabled);
      /*
       * Autopilot only schedules a future GENERATION, never a publish. The date
       * is stored so a scheduler can pick it up later; nothing reads it today.
       */
      out.nextPlanGenerationAt = out.autopilotEnabled ? nextWeeklyRunAt(now()) : null;
    }

    if (errors.length) throw new ValidationError('Invalid planner preferences', errors);
    return out;
  }

  // --- plan generation -----------------------------------------------------

  async function assertUnderDailyLimit(userId, needed) {
    const since = addSecondsUtc(-24 * 3600, now());
    const used = await apiUsage.countUserOperationsSince(userId, since, {
      operations: [USAGE_OPERATIONS.OPENAI_GENERATE_CONTENT, USAGE_OPERATIONS.HCTI_GENERATE_IMAGE],
    });
    const limit = config.limits.maxDailyGenerationsPerUser;
    if (used + needed > limit) {
      throw new RateLimitError(
        `This plan needs ${needed} generations but only ${Math.max(0, limit - used)} remain in your daily limit.`,
      );
    }
  }

  /** Platforms the user can actually post to right now. */
  async function resolvePlatforms(userId, requested) {
    const accounts = await socialAccounts.listAccountsForUser(userId);
    const active = (accounts || []).filter((a) => a.status === SOCIAL_ACCOUNT_STATUS.ACTIVE);
    const available = [...new Set(active.map((a) => ACCOUNT_TYPE_TO_PLATFORM[a.accountType]).filter(Boolean))];
    if (!Array.isArray(requested) || requested.length === 0) return available;
    return requested.filter((p) => available.includes(p));
  }

  /**
   * Generate a plan.
   *
   * Images are generated only when HCTI is verified; without it the plan is
   * still produced with captions, and each card says the image is pending.
   * Failing the whole run because one integration is unconfigured would be a
   * worse outcome than a plan the user can still read and approve.
   */
  async function generatePlan(userId, options = {}, { req } = {}) {
    if (!openaiContentService.isAvailable()) {
      throw new ConflictError('Content generation is not available');
    }

    const prefs = await getPreferences(userId);
    const profile = await businessProfiles.findByUserId(userId);
    const timezone = options.timezone || prefs.timezone || 'UTC';

    const platforms = await resolvePlatforms(userId, options.platforms ?? prefs.platforms);
    if (platforms.length === 0) {
      throw new ValidationError(
        'Connect at least one Facebook Page, Instagram Professional account, or Threads profile before generating a plan',
      );
    }

    const schedule = buildSchedule({
      startDate: options.startDate,
      planLength: options.planLength ?? prefs.defaultPlanLength,
      cadence: options.cadence ?? prefs.cadence,
      weekdays: options.weekdays ?? prefs.weekdays,
      times: options.times ?? prefs.times,
      timezone,
      now: now(),
    });

    if (schedule.slots.length === 0) {
      throw new ValidationError(
        'That combination of days and times produces no upcoming slots. Try a later start date or different days.',
      );
    }

    // One OpenAI call per post; images are one HCTI call each when enabled.
    await assertUnderDailyLimit(userId, schedule.slots.length);

    const briefs = buildBriefSet({ slots: schedule.slots, preferences: prefs, profile, platforms });

    const run = await runsRepo.createRun({
      userId,
      businessProfileId: profile?.id ?? null,
      name: options.name || defaultRunName(schedule),
      status: PLANNER_RUN_STATUS.GENERATING,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      timezone: schedule.timezone,
      planLength: options.planLength ?? prefs.defaultPlanLength,
      settings: {
        cadence: schedule.cadence,
        times: schedule.times,
        weekdays: schedule.weekdays,
        platforms,
        goals: prefs.goals,
        contentMix: prefs.contentMix,
        tone: prefs.tone,
        ctaMode: prefs.ctaMode,
        approvalMode: options.approvalMode ?? prefs.approvalMode,
      },
    });

    await logging.record(EVENT_TYPES.PLANNER_RUN_STARTED, {
      req, userId, message: 'Plan generation started',
      context: { runId: run.id, slots: schedule.slots.length },
    });

    const autoQueue = (options.approvalMode ?? prefs.approvalMode) === 'auto_queue';
    const wantImages = await imageIntegrationVerified(userId);

    // The duplication lookback: what this user has planned recently.
    const recent = await runsRepo.listRecentFingerprintsForUser(userId, {
      limit: PLANNER_LIMITS.DUPLICATE_LOOKBACK_ITEMS,
      sinceUtc: addSecondsUtc(-PLANNER_LIMITS.DUPLICATE_LOOKBACK_DAYS * 24 * 3600, now()),
      excludeRunId: run.id,
    });

    const batch = [];
    const created = [];
    const notes = [];
    let flagged = 0;

    for (const brief of briefs) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await generateOneItem({
        userId, run, brief, profile, batch, recent, autoQueue, wantImages,
      });
      if (!outcome) continue;
      created.push(outcome.item);
      batch.push(outcome.fingerprint);
      if (outcome.flagged) flagged += 1;
    }

    if (created.length === 0) {
      await runsRepo.updateRun(run.id, userId, {
        status: PLANNER_RUN_STATUS.FAILED,
        generationNotes: 'No posts could be generated. Please try again.',
      });
      await logging.record(EVENT_TYPES.PLANNER_RUN_FAILED, {
        req, userId, level: 'warn', message: 'Plan generation produced no posts',
        context: { runId: run.id },
      });
      throw new ConflictError('The plan could not be generated. Please try again.');
    }

    if (flagged > 0) notes.push(`${flagged} post${flagged === 1 ? '' : 's'} flagged for similarity review.`);
    if (schedule.skippedPast > 0) notes.push(`${schedule.skippedPast} past time slot${schedule.skippedPast === 1 ? '' : 's'} skipped.`);
    if (!wantImages) notes.push('Images were not generated because HCTI is not verified.');

    const updated = await runsRepo.updateRun(run.id, userId, {
      status: autoQueue ? PLANNER_RUN_STATUS.QUEUED : PLANNER_RUN_STATUS.REVIEW,
      generationNotes: notes.join(' ').slice(0, PLANNER_LIMITS.NOTES_MAX) || null,
    });

    await logging.record(EVENT_TYPES.PLANNER_RUN_COMPLETED, {
      req, userId, message: 'Plan generated',
      context: { runId: run.id, items: created.length, flagged },
    });

    return getPlan(userId, run.id);
  }

  function defaultRunName(schedule) {
    return `Plan ${schedule.startDate} to ${schedule.endDate}`.slice(0, PLANNER_LIMITS.NAME_MAX);
  }

  /**
   * Whether images can be rendered for this user. The image service owns the
   * credential knowledge; the planner just asks.
   */
  async function imageIntegrationVerified(userId) {
    if (typeof socialImageService.isReadyForUser !== 'function') return false;
    return socialImageService.isReadyForUser(userId);
  }

  /**
   * Generate one item: copy → duplication check → (regenerate) → image → save.
   */
  async function generateOneItem({ userId, run, brief, profile, batch, recent, autoQueue, wantImages }) {
    const primaryPlatform = brief.platforms[0];
    const avoidPhrases = batch.map((fp) => fp.headlineNormalized).filter(Boolean);

    const attempts = [];
    let evaluation = null;
    let content = null;

    for (let attempt = 0; attempt <= PLANNER_LIMITS.MAX_REGENERATION_ATTEMPTS; attempt += 1) {
      let candidate;
      try {
        // eslint-disable-next-line no-await-in-loop
        candidate = await openaiContentService.generatePlannerPost(
          {
            platform: primaryPlatform,
            contentType: brief.contentType,
            goal: brief.goal,
            tone: brief.tone,
            brief: brief.brief,
            brandName: profile?.businessName ?? null,
            language: profile?.defaultLanguage ?? null,
            callToAction: brief.callToAction,
            hashtagPreference: 'moderate',
            avoidPhrases,
          },
          { userId },
        );
      } catch {
        // One post failing must not lose the plan; try again, then give up on
        // this slot only.
        // eslint-disable-next-line no-continue
        continue;
      }

      attempts.push(candidate);
      evaluation = uniqueness.evaluate(
        {
          caption: candidate.caption,
          headline: candidate.headline,
          cta: brief.callToAction,
          hashtags: candidate.hashtags,
          contentType: brief.contentType,
          goal: brief.goal,
          serviceEmphasis: brief.serviceEmphasis,
          templateKey: brief.templateKey,
        },
        { batch, recent },
      );
      content = candidate;
      if (!evaluation.shouldRegenerate) break;
    }

    if (!content) return null;

    /*
     * Attempts exhausted and still repetitive: keep the FRESHEST attempt rather
     * than the last one, and flag it for review instead of silently shipping.
     */
    if (evaluation?.shouldRegenerate && attempts.length > 1) {
      const best = uniqueness.pickBest(
        attempts.map((a) => ({
          caption: a.caption, headline: a.headline, cta: brief.callToAction,
          hashtags: a.hashtags, contentType: brief.contentType, goal: brief.goal,
          serviceEmphasis: brief.serviceEmphasis, templateKey: brief.templateKey,
          _raw: a,
        })),
        { batch, recent },
      );
      if (best) {
        content = best.candidate._raw;
        evaluation = best.evaluation;
      }
    }

    const fingerprint = uniqueness.fingerprint({
      caption: content.caption,
      headline: content.headline,
      cta: brief.callToAction,
      hashtags: content.hashtags,
      contentType: brief.contentType,
      goal: brief.goal,
      serviceEmphasis: brief.serviceEmphasis,
      templateKey: brief.templateKey,
    });

    const flagged = evaluation && evaluation.verdict !== 'unique';
    const duplicationNotes = flagged ? uniqueness.describe(evaluation) : null;

    let mediaAssetId = null;
    if (wantImages && content.headline) {
      // eslint-disable-next-line no-await-in-loop
      mediaAssetId = await renderItemImage({
        userId, profile, brief, content,
      }).catch(() => null);
    }

    const item = await runsRepo.createItem({
      plannerRunId: run.id,
      userId,
      position: brief.position,
      scheduledFor: brief.slot.scheduledForUtc,
      originalTimezone: run.timezone,
      contentType: brief.contentType,
      goal: brief.goal,
      platformTargets: brief.platforms,
      templateKey: brief.templateKey,
      aspectRatio: 'square',
      backgroundStyle: 'light',
      headline: content.headline,
      subheadline: content.subheadline,
      summary: content.summary,
      caption: content.caption,
      hashtags: content.hashtags,
      altText: content.imageAltText,
      brief: brief.brief,
      mediaAssetId,
      // Auto-queue mode still holds flagged posts for review rather than
      // approving something the engine already believes is repetitive.
      approvalStatus: autoQueue && !flagged
        ? PLANNER_ITEM_STATUS.APPROVED
        : PLANNER_ITEM_STATUS.NEEDS_REVIEW,
      duplicationScore: evaluation?.score ?? 0,
      duplicationNotes,
      regenerationCount: Math.max(0, attempts.length - 1),
      fingerprint: { ...fingerprint, visualExtras: extrasFor(content) },
      editedFields: [],
    });

    return { item, fingerprint, flagged };
  }

  /** The structured extras a content-type template renders, if present. */
  function extrasFor(content) {
    const extras = {};
    if (Array.isArray(content.bullets) && content.bullets.length) extras.bullets = content.bullets;
    if (content.stat?.value) extras.stat = content.stat;
    if (content.comparison?.leftTitle) extras.comparison = content.comparison;
    return Object.keys(extras).length ? extras : null;
  }

  async function renderItemImage({ userId, profile, brief, content, overrides = {} }) {
    const rendered = await socialImageService.generateSocialImage({
      userId,
      headline: overrides.headline ?? content.headline,
      subheadline: overrides.subheadline ?? content.subheadline,
      brandName: profile?.businessName ?? null,
      template: overrides.templateKey ?? brief.templateKey,
      aspectRatio: overrides.aspectRatio ?? 'square',
      backgroundStyle: overrides.backgroundStyle ?? 'light',
      logoUrl: profile?.logoUrl ?? null,
      primaryColor: profile?.primaryColor ?? null,
      secondaryColor: profile?.secondaryColor ?? null,
      accentColor: profile?.accentColor ?? null,
      headingFont: profile?.headingFont ?? null,
      bodyFont: profile?.bodyFont ?? null,
      cta: brief.callToAction,
      website: displayWebsite(profile?.websiteUrl),
      phone: null,
      businessCategory: profile?.businessCategory ?? null,
      serviceTag: brief.serviceEmphasis,
      bullets: content.bullets ?? null,
      stat: content.stat ?? null,
      comparison: content.comparison ?? null,
    });

    const asset = await mediaAssetService.createReadyImageAsset({
      userId,
      sourceUrl: rendered.sourceUrl,
      sourceAssetId: rendered.imageId,
      postId: null,
    });
    return asset.id;
  }

  // --- reads ---------------------------------------------------------------

  async function getPlan(userId, runId) {
    const run = await runsRepo.findRunByIdForUser(runId, userId);
    if (!run) throw new NotFoundError('Plan not found');
    const items = await runsRepo.listItemsForRun(runId, userId);
    const counts = await runsRepo.countItemsByStatus(runId, userId);
    return { run, items: await Promise.all(items.map((i) => decorateItem(userId, i))), counts };
  }

  /**
   * Attach the media preview token the board needs.
   *
   * The fingerprint is stripped: it is an internal similarity signal, not
   * something the client has any use for.
   */
  async function decorateItem(userId, item) {
    let media = null;
    if (item.mediaAssetId) {
      const asset = await mediaRepository.findMediaAssetByIdForUser(item.mediaAssetId, userId);
      if (asset) media = { publicToken: asset.publicToken, status: asset.status };
    }
    const { fingerprint, ...rest } = item;
    return { ...rest, media };
  }

  async function listPlans(userId, opts = {}) {
    const runs = await runsRepo.listRunsForUser(userId, opts);
    const out = [];
    for (const run of runs) {
      // eslint-disable-next-line no-await-in-loop
      const counts = await runsRepo.countItemsByStatus(run.id, userId);
      out.push({ ...run, counts });
    }
    return out;
  }

  async function requireItem(userId, itemId) {
    const item = await runsRepo.findItemByIdForUser(itemId, userId);
    if (!item) throw new NotFoundError('Planned post not found');
    return item;
  }

  // --- item editing --------------------------------------------------------

  /**
   * Apply a human edit. Every changed field is recorded so regeneration cannot
   * later overwrite it.
   */
  async function updateItem(userId, itemId, patch, { req } = {}) {
    const item = await requireItem(userId, itemId);
    if (item.approvalStatus === PLANNER_ITEM_STATUS.QUEUED) {
      throw new ConflictError('This post is already queued. Edit it from the queue instead.');
    }

    const fields = {};
    const errors = [];
    const edited = new Set(item.editedFields || []);

    /*
     * Mark a field as user-edited ONLY when its value actually changed.
     *
     * The edit drawer submits the whole form, so a user who retypes one caption
     * also sends back the untouched headline. Marking everything present in the
     * patch would freeze fields nobody edited, and "regenerate the caption"
     * would then stop refreshing the headline — quietly breaking the one
     * guarantee this feature makes.
     */
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    let changedAny = false;
    const applyEdit = (name, value) => {
      if (same(value, item[name])) return;
      fields[name] = value;
      edited.add(name);
      changedAny = true;
    };

    if (patch.caption !== undefined) {
      if (typeof patch.caption !== 'string' || patch.caption.trim() === '') {
        errors.push({ field: 'caption', message: 'Caption cannot be empty' });
      } else {
        applyEdit('caption', patch.caption.slice(0, 4000));
      }
    }
    if (patch.headline !== undefined) applyEdit('headline', String(patch.headline).slice(0, 80));
    if (patch.subheadline !== undefined) applyEdit('subheadline', String(patch.subheadline).slice(0, 140));
    if (patch.altText !== undefined) applyEdit('altText', String(patch.altText).slice(0, 420));
    if (patch.hashtags !== undefined) {
      if (!Array.isArray(patch.hashtags)) errors.push({ field: 'hashtags', message: 'Invalid hashtags' });
      else applyEdit('hashtags', patch.hashtags.filter((h) => typeof h === 'string').slice(0, 30));
    }
    if (patch.templateKey !== undefined) {
      /*
       * Check the RAW value, not the normalized one: normalizeTemplate falls
       * back to the default for anything unknown, so normalizing first would
       * silently accept garbage as "editorial-premium" instead of rejecting it.
       * A legacy name is still accepted, and normalized on the way in.
       */
      if (!IMAGE_TEMPLATE_VALUES.includes(patch.templateKey)) {
        errors.push({ field: 'templateKey', message: 'Choose a valid template' });
      } else {
        applyEdit('templateKey', normalizeTemplate(patch.templateKey));
      }
    }
    if (patch.aspectRatio !== undefined) applyEdit('aspectRatio', patch.aspectRatio);
    if (patch.backgroundStyle !== undefined) applyEdit('backgroundStyle', patch.backgroundStyle);
    if (patch.scheduledFor !== undefined) {
      const when = new Date(patch.scheduledFor);
      if (Number.isNaN(when.getTime())) errors.push({ field: 'scheduledFor', message: 'Invalid date and time' });
      else if (when.getTime() <= now().getTime()) {
        errors.push({ field: 'scheduledFor', message: 'The scheduled time must be in the future' });
      } else {
        applyEdit('scheduledFor', toMysqlUtc(when));
      }
    }
    if (patch.platformTargets !== undefined) {
      const platforms = Array.isArray(patch.platformTargets) ? patch.platformTargets : null;
      if (!platforms || platforms.length === 0 || platforms.some((p) => !PLATFORM_VALUES.includes(p))) {
        errors.push({ field: 'platformTargets', message: 'Choose at least one valid platform' });
      } else {
        applyEdit('platformTargets', [...new Set(platforms)]);
      }
    }

    if (errors.length) throw new ValidationError('Invalid changes', errors);
    // Re-submitting identical values is a no-op, not an "edit".
    if (!changedAny) return decorateItem(userId, item);

    fields.editedFields = [...edited];
    // A human touched it, so it is no longer a machine draft awaiting triage.
    if (item.approvalStatus === PLANNER_ITEM_STATUS.NEEDS_REVIEW) {
      fields.approvalStatus = PLANNER_ITEM_STATUS.DRAFT;
    }

    const updated = await runsRepo.updateItem(itemId, userId, fields);
    await logging.record(EVENT_TYPES.PLANNER_ITEM_UPDATED, {
      req, userId, message: 'Planned post updated',
      context: { itemId, fields: Object.keys(fields).filter((f) => f !== 'editedFields') },
    });
    return decorateItem(userId, updated);
  }

  /**
   * Regenerate ONE field without losing the rest.
   *
   * Fields the user edited are preserved unless they explicitly force it —
   * "regenerate the image" must never discard a rewritten caption.
   *
   * @param {'caption'|'image'} target
   */
  async function regenerateItem(userId, itemId, target, { force = false, req } = {}) {
    const item = await requireItem(userId, itemId);
    if (item.approvalStatus === PLANNER_ITEM_STATUS.QUEUED) {
      throw new ConflictError('This post is already queued. Edit it from the queue instead.');
    }
    const profile = await businessProfiles.findByUserId(userId);
    const edited = new Set(item.editedFields || []);

    if (target === 'caption') {
      if (edited.has('caption') && !force) {
        throw new ConflictError('You have edited this caption. Regenerating would discard your changes — confirm to continue.');
      }
      if (!openaiContentService.isAvailable()) throw new ConflictError('Content generation is not available');
      await assertUnderDailyLimit(userId, 1);

      const siblings = await runsRepo.listItemsForRun(item.plannerRunId, userId);
      const avoidPhrases = siblings
        .filter((s) => s.id !== item.id)
        .map((s) => s.headline)
        .filter(Boolean);

      const content = await openaiContentService.generatePlannerPost(
        {
          platform: item.platformTargets[0],
          contentType: item.contentType,
          goal: item.goal,
          tone: 'professional',
          brief: item.brief,
          brandName: profile?.businessName ?? null,
          language: profile?.defaultLanguage ?? null,
          callToAction: profile?.defaultCallToAction ?? null,
          hashtagPreference: 'moderate',
          avoidPhrases,
        },
        { userId },
      );

      const recent = await runsRepo.listRecentFingerprintsForUser(userId, {
        limit: PLANNER_LIMITS.DUPLICATE_LOOKBACK_ITEMS,
      });
      const evaluation = uniqueness.evaluate(
        {
          caption: content.caption, headline: content.headline,
          hashtags: content.hashtags, contentType: item.contentType,
          goal: item.goal, templateKey: item.templateKey,
        },
        { batch: [], recent },
      );

      const fields = {
        caption: content.caption,
        hashtags: content.hashtags,
        summary: content.summary,
        regenerationCount: item.regenerationCount + 1,
        duplicationScore: evaluation.score,
        duplicationNotes: evaluation.verdict === 'unique' ? null : uniqueness.describe(evaluation),
        approvalStatus: PLANNER_ITEM_STATUS.NEEDS_REVIEW,
      };
      // Headline/subheadline are only replaced when the user has not written
      // their own — this is what "regenerate one field" has to mean.
      if (!edited.has('headline')) fields.headline = content.headline;
      if (!edited.has('subheadline')) fields.subheadline = content.subheadline;
      if (!edited.has('altText')) fields.altText = content.imageAltText;
      if (force) {
        for (const f of ['caption', 'headline', 'subheadline', 'altText']) edited.delete(f);
        fields.editedFields = [...edited];
      }

      const updated = await runsRepo.updateItem(itemId, userId, fields);
      await logging.record(EVENT_TYPES.PLANNER_ITEM_REGENERATED, {
        req, userId, message: 'Planned caption regenerated', context: { itemId },
      });
      return decorateItem(userId, updated);
    }

    if (target === 'image') {
      if (!(await imageIntegrationVerified(userId))) {
        throw new ConflictError('Your HCTI credentials are not verified. Add them in Integrations to generate images.');
      }
      await assertUnderDailyLimit(userId, 1);

      const extras = item.fingerprint?.visualExtras ?? {};
      const mediaAssetId = await renderItemImage({
        userId,
        profile,
        brief: {
          templateKey: item.templateKey,
          callToAction: profile?.defaultCallToAction ?? null,
          serviceEmphasis: null,
        },
        content: {
          headline: item.headline,
          subheadline: item.subheadline,
          bullets: extras.bullets ?? null,
          stat: extras.stat ?? null,
          comparison: extras.comparison ?? null,
        },
        overrides: {
          templateKey: item.templateKey,
          aspectRatio: item.aspectRatio,
          backgroundStyle: item.backgroundStyle,
        },
      });

      const updated = await runsRepo.updateItem(itemId, userId, { mediaAssetId });
      await logging.record(EVENT_TYPES.PLANNER_ITEM_REGENERATED, {
        req, userId, message: 'Planned image regenerated', context: { itemId },
      });
      return decorateItem(userId, updated);
    }

    throw new ValidationError('Choose what to regenerate', [
      { field: 'target', message: 'Regenerate the caption or the image' },
    ]);
  }

  // --- approval ------------------------------------------------------------

  async function setItemStatus(userId, itemId, status, { req } = {}) {
    const item = await requireItem(userId, itemId);
    if (item.approvalStatus === PLANNER_ITEM_STATUS.QUEUED) {
      throw new ConflictError('This post is already queued');
    }
    if (![PLANNER_ITEM_STATUS.APPROVED, PLANNER_ITEM_STATUS.REJECTED, PLANNER_ITEM_STATUS.DRAFT].includes(status)) {
      throw new ValidationError('Invalid status', [{ field: 'status', message: 'Choose approve or reject' }]);
    }
    if (status === PLANNER_ITEM_STATUS.APPROVED && (!item.caption || !item.caption.trim())) {
      throw new ValidationError('This post has no caption to approve', [
        { field: 'caption', message: 'Add a caption before approving' },
      ]);
    }
    const updated = await runsRepo.updateItem(itemId, userId, { approvalStatus: status });
    await logging.record(
      status === PLANNER_ITEM_STATUS.APPROVED ? EVENT_TYPES.PLANNER_ITEM_APPROVED : EVENT_TYPES.PLANNER_ITEM_REJECTED,
      { req, userId, message: `Planned post ${status}`, context: { itemId } },
    );
    return decorateItem(userId, updated);
  }

  /** Bulk approve/reject. Returns per-item outcomes rather than failing wholesale. */
  async function bulkSetStatus(userId, runId, itemIds, status, { req } = {}) {
    const run = await runsRepo.findRunByIdForUser(runId, userId);
    if (!run) throw new NotFoundError('Plan not found');
    const items = await runsRepo.listItemsForRun(runId, userId);
    const targets = Array.isArray(itemIds) && itemIds.length
      ? items.filter((i) => itemIds.includes(i.id))
      : items;

    const results = { updated: [], skipped: [] };
    for (const item of targets) {
      if (item.approvalStatus === PLANNER_ITEM_STATUS.QUEUED) {
        results.skipped.push({ id: item.id, reason: 'already queued' });
        continue;
      }
      if (status === PLANNER_ITEM_STATUS.APPROVED && !item.caption?.trim()) {
        results.skipped.push({ id: item.id, reason: 'no caption' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await runsRepo.updateItem(item.id, userId, { approvalStatus: status });
      results.updated.push(item.id);
    }
    await logging.record(
      status === PLANNER_ITEM_STATUS.APPROVED ? EVENT_TYPES.PLANNER_ITEM_APPROVED : EVENT_TYPES.PLANNER_ITEM_REJECTED,
      { req, userId, message: `Bulk ${status}`, context: { runId, count: results.updated.length } },
    );
    return { ...results, plan: await getPlan(userId, runId) };
  }

  async function deleteItem(userId, itemId, { req } = {}) {
    const item = await requireItem(userId, itemId);
    if (item.approvalStatus === PLANNER_ITEM_STATUS.QUEUED) {
      throw new ConflictError('This post is queued. Cancel it from the queue instead.');
    }
    await runsRepo.deleteItem(itemId, userId);
    await logging.record(EVENT_TYPES.PLANNER_ITEM_DELETED, {
      req, userId, message: 'Planned post deleted', context: { itemId },
    });
    return { deleted: true };
  }

  /** Remove every rejected card from a plan. */
  async function removeRejected(userId, runId, { req } = {}) {
    const items = await runsRepo.listItemsForRun(runId, userId);
    const rejected = items.filter((i) => i.approvalStatus === PLANNER_ITEM_STATUS.REJECTED);
    for (const item of rejected) {
      // eslint-disable-next-line no-await-in-loop
      await runsRepo.deleteItem(item.id, userId);
    }
    return { removed: rejected.length, plan: await getPlan(userId, runId) };
  }

  async function deletePlan(userId, runId, { req } = {}) {
    const run = await runsRepo.findRunByIdForUser(runId, userId);
    if (!run) throw new NotFoundError('Plan not found');
    // Items cascade. Queued posts they produced survive: the post FK is SET NULL.
    await runsRepo.deleteRun(runId, userId);
    await logging.record(EVENT_TYPES.PLANNER_RUN_DELETED, {
      req, userId, message: 'Plan deleted', context: { runId },
    });
    return { deleted: true };
  }

  // --- queue integration ---------------------------------------------------

  /**
   * Materialise approved items into the real queue.
   *
   * This creates the same `scheduled_posts` rows the manual flow creates and
   * marks them queued for a FUTURE publishing phase. No provider endpoint is
   * called; nothing is published here or anywhere else in this file.
   */
  async function queueApproved(userId, runId, itemIds, { req } = {}) {
    const run = await runsRepo.findRunByIdForUser(runId, userId);
    if (!run) throw new NotFoundError('Plan not found');

    const items = await runsRepo.listItemsForRun(runId, userId);
    const targets = (Array.isArray(itemIds) && itemIds.length
      ? items.filter((i) => itemIds.includes(i.id))
      : items
    ).filter((i) => i.approvalStatus === PLANNER_ITEM_STATUS.APPROVED);

    if (targets.length === 0) {
      throw new ValidationError('Approve at least one post before queueing');
    }

    const accounts = await socialAccounts.listAccountsForUser(userId);
    const active = (accounts || []).filter((a) => a.status === SOCIAL_ACCOUNT_STATUS.ACTIVE);

    const queued = [];
    const skipped = [];

    for (const item of targets) {
      const accountIds = active
        .filter((a) => item.platformTargets.includes(ACCOUNT_TYPE_TO_PLATFORM[a.accountType]))
        .map((a) => a.id);
      if (accountIds.length === 0) {
        skipped.push({ id: item.id, reason: 'no active account for the selected platforms' });
        continue;
      }
      if (item.scheduledFor && new Date(`${item.scheduledFor.replace(' ', 'T')}Z`).getTime() <= now().getTime()) {
        skipped.push({ id: item.id, reason: 'the scheduled time has passed' });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const post = await withTransaction(async (conn) => {
        const draft = await posts.createDraftPost(
          {
            userId,
            title: item.summary || item.headline,
            prompt: item.brief,
            generationParams: {
              brandName: null,
              tone: null,
              callToAction: null,
              language: null,
              hashtagPreference: null,
              additionalInstructions: null,
              includeLogo: true,
              includeWebsite: true,
              includePhone: false,
              plannerRunId: run.id,
              plannerItemId: item.id,
            },
            templateName: item.templateKey,
            aspectRatio: item.aspectRatio,
            backgroundStyle: item.backgroundStyle,
          },
          conn,
        );

        const platformCaptions = {};
        for (const platform of item.platformTargets) {
          platformCaptions[platform] = { caption: item.caption, hashtags: item.hashtags };
        }
        await posts.updateGeneratedContent(
          draft.id,
          userId,
          {
            platformCaptions,
            baseCaption: item.caption,
            headline: item.headline,
            subheadline: item.subheadline,
            altText: item.altText,
            openaiModel: null,
            openaiResponseId: null,
            openaiUsage: null,
            contentGeneratedAt: toMysqlUtc(now()),
          },
          conn,
        );
        if (item.mediaAssetId) {
          await posts.attachMediaAsset(
            draft.id,
            userId,
            {
              mediaAssetId: item.mediaAssetId,
              template: item.templateKey,
              aspectRatio: item.aspectRatio,
              backgroundStyle: item.backgroundStyle,
              imageGeneratedAt: toMysqlUtc(now()),
            },
            conn,
          );
        }
        await posts.replacePostTargets(
          draft.id,
          userId,
          accountIds.map((id) => ({ socialAccountId: id, captionOverride: null })),
          conn,
        );
        return posts.schedulePost(
          draft.id,
          userId,
          { scheduledAtUtc: item.scheduledFor, originalTimezone: item.originalTimezone || run.timezone },
          conn,
        );
      });

      // eslint-disable-next-line no-await-in-loop
      await runsRepo.updateItem(item.id, userId, {
        postId: post.id,
        approvalStatus: PLANNER_ITEM_STATUS.QUEUED,
      });
      queued.push({ itemId: item.id, postId: post.id });
    }

    const counts = await runsRepo.countItemsByStatus(runId, userId);
    const allQueued = counts[PLANNER_ITEM_STATUS.QUEUED] > 0
      && counts[PLANNER_ITEM_STATUS.APPROVED] === 0
      && counts[PLANNER_ITEM_STATUS.NEEDS_REVIEW] === 0
      && counts[PLANNER_ITEM_STATUS.DRAFT] === 0;
    await runsRepo.updateRun(runId, userId, {
      status: allQueued ? PLANNER_RUN_STATUS.QUEUED : PLANNER_RUN_STATUS.PARTIALLY_QUEUED,
    });

    await logging.record(EVENT_TYPES.PLANNER_ITEMS_QUEUED, {
      req, userId, message: 'Planned posts queued',
      context: { runId, queued: queued.length, skipped: skipped.length },
    });

    return {
      queued,
      skipped,
      plan: await getPlan(userId, runId),
      // Honest: queueing stores the post. It does not publish it.
      notice: 'Approved posts are queued. Automatic publishing to providers will be enabled in a later phase.',
    };
  }

  /** Copy a planned post into a normal manual draft the user can take over. */
  async function duplicateAsDraft(userId, itemId, { req } = {}) {
    const item = await requireItem(userId, itemId);
    const draft = await posts.createDraftPost({
      userId,
      title: item.summary || item.headline,
      prompt: item.brief,
      generationParams: {
        brandName: null, tone: null, callToAction: null, language: null,
        hashtagPreference: null, additionalInstructions: null,
        includeLogo: true, includeWebsite: true, includePhone: false,
      },
      templateName: item.templateKey,
      aspectRatio: item.aspectRatio,
      backgroundStyle: item.backgroundStyle,
    });
    const platformCaptions = {};
    for (const platform of item.platformTargets) {
      platformCaptions[platform] = { caption: item.caption, hashtags: item.hashtags };
    }
    await posts.updateGeneratedContent(draft.id, userId, {
      platformCaptions,
      baseCaption: item.caption,
      headline: item.headline,
      subheadline: item.subheadline,
      altText: item.altText,
      openaiModel: null,
      openaiResponseId: null,
      openaiUsage: null,
      contentGeneratedAt: toMysqlUtc(now()),
    });
    await logging.record(EVENT_TYPES.PLANNER_ITEM_UPDATED, {
      req, userId, message: 'Planned post copied to a manual draft',
      context: { itemId, postId: draft.id },
    });
    return { postId: draft.id };
  }

  function displayWebsite(websiteUrl) {
    if (!websiteUrl) return null;
    try {
      return new URL(websiteUrl).host.replace(/^www\./i, '');
    } catch {
      return null;
    }
  }

  return {
    getPreferences,
    savePreferences,
    generatePlan,
    getPlan,
    listPlans,
    updateItem,
    regenerateItem,
    setItemStatus,
    bulkSetStatus,
    deleteItem,
    removeRejected,
    deletePlan,
    queueApproved,
    duplicateAsDraft,
    validatePreferencePatch,
  };
}

export const plannerService = createPlannerService();
export default plannerService;
