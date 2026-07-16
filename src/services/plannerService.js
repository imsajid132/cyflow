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
  PLANNER_QUALITY_STATUS,
  HARD_DUPLICATE_SCORE,
  PLANNER_LIMITS,
  PLANNER_APPROVAL_MODES,
  PLANNER_CADENCES,
  PLANNER_TONES,
  PLANNER_CTA_MODES,
  PLANNER_GOALS,
  PLANNER_CONTENT_TYPES,
  PLANNER_FORMATS,
  CONTENT_PILLARS,
  VISUAL_FAMILY_KEYS,
  RHYTHM_PRESETS,
  RHYTHM_CTA_MODES,
  RHYTHM_PRESET_LABELS,
  PLANNER_WEEKDAY_LABELS,
  PLATFORM_VALUES,
  ACCOUNT_TYPE_TO_PLATFORM,
  SOCIAL_ACCOUNT_STATUS,
  POST_STATUS,
  EVENT_TYPES,
  USAGE_OPERATIONS,
  IMAGE_TEMPLATE_VALUES,
} from '../config/constants.js';

/** Post states that represent work already sent out — never destroy these. */
const PUBLISHED_STATUSES = Object.freeze([POST_STATUS.PUBLISHED, POST_STATUS.PARTIAL]);
/** Post states that are scheduled but not yet out, so they can be cancelled. */
const CANCELLABLE_STATUSES = Object.freeze([
  POST_STATUS.QUEUED,
  POST_STATUS.PROCESSING,
  POST_STATUS.RETRYING,
]);
import { ValidationError, NotFoundError, ConflictError, RateLimitError } from '../utils/errors.js';
import { toMysqlUtc, addSecondsUtc } from '../utils/time.js';
import { isSupportedTimezone } from './timezoneService.js';
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
import { buildSchedule, summarizeSchedule, nextWeeklyRunAt } from './plannerScheduleService.js';
import { buildBriefSet, DEFAULT_CONTENT_MIX, DEFAULT_GOALS } from './plannerBriefService.js';
import { resolveRhythm, describeRhythm } from './weeklyRhythmService.js';
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
  // Explicit, and 1 unless the user says otherwise. Existing users who never
  // chose keep the behaviour they already had.
  postsPerDay: 1,
  timezone: null,
  autopilotEnabled: false,
  nextPlanGenerationAt: null,
  // Phase 4.8: the weekly rhythm. Balanced is the documented default, and a
  // user who never touches this gets exactly the brief's Monday-to-Sunday week.
  contentRhythmPreset: 'balanced',
  contentRhythm: null,
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

  /**
   * The weekly rhythm, resolved and labelled for display.
   *
   * The wizard shows the user which strategy each weekday carries BEFORE they
   * generate, because a plan whose reasoning is invisible is indistinguishable
   * from a plan with no reasoning. Accepts an optional preset/custom pair so the
   * preview reflects what is selected right now rather than what is saved.
   */
  async function describeWeeklyRhythm(userId, { preset, customRhythm } = {}) {
    const prefs = await getPreferences(userId);
    const rhythm = resolveRhythm({
      preset: preset ?? prefs.contentRhythmPreset,
      customRhythm: customRhythm ?? prefs.contentRhythm,
    });
    return {
      preset: rhythm.preset,
      presetLabel: RHYTHM_PRESET_LABELS[rhythm.preset] || null,
      presets: RHYTHM_PRESETS.map((key) => ({ key, label: RHYTHM_PRESET_LABELS[key] })),
      weekdays: describeRhythm(rhythm).map((day) => ({
        ...day,
        label: PLANNER_WEEKDAY_LABELS[day.weekday],
      })),
    };
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

    if (patch.contentRhythmPreset !== undefined) {
      if (!RHYTHM_PRESETS.includes(patch.contentRhythmPreset)) {
        errors.push({ field: 'contentRhythmPreset', message: 'Choose a valid weekly rhythm' });
      } else out.contentRhythmPreset = patch.contentRhythmPreset;
    }

    /*
     * A custom rhythm is per-weekday overrides. Everything is bounded and
     * whitelisted here: an unknown pillar, format, family or CTA mode is a
     * validation error rather than something that reaches the generator. `null`
     * is a legitimate value meaning "clear my overrides, use the preset".
     */
    if (patch.contentRhythm !== undefined) {
      if (patch.contentRhythm === null) {
        out.contentRhythm = null;
      } else if (typeof patch.contentRhythm !== 'object' || Array.isArray(patch.contentRhythm)) {
        errors.push({ field: 'contentRhythm', message: 'Invalid weekly rhythm' });
      } else {
        const clean = {};
        let bad = null;
        for (const [key, value] of Object.entries(patch.contentRhythm)) {
          const weekday = Number(key);
          if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) { bad = 'Weekdays run from 1 (Monday) to 7 (Sunday)'; break; }
          if (!value || typeof value !== 'object' || Array.isArray(value)) { bad = 'Invalid weekday settings'; break; }
          const day = {};
          if (value.enabled !== undefined) day.enabled = value.enabled === true;
          if (value.locked !== undefined) day.locked = value.locked === true;
          if (value.pillar !== undefined && value.pillar !== null) {
            if (!CONTENT_PILLARS.includes(value.pillar)) { bad = 'Unknown content pillar'; break; }
            day.pillar = value.pillar;
          }
          if (value.format !== undefined && value.format !== null) {
            if (!PLANNER_FORMATS.includes(value.format)) { bad = 'Unknown writing format'; break; }
            day.format = value.format;
          }
          if (value.visualFamily !== undefined && value.visualFamily !== null) {
            if (!VISUAL_FAMILY_KEYS.includes(value.visualFamily)) { bad = 'Unknown visual family'; break; }
            day.visualFamily = value.visualFamily;
          }
          if (value.ctaMode !== undefined && value.ctaMode !== null) {
            if (!RHYTHM_CTA_MODES.includes(value.ctaMode)) { bad = 'Unknown call to action mode'; break; }
            day.ctaMode = value.ctaMode;
          }
          if (Array.isArray(value.services)) {
            // Eligible services for this weekday. Bounded, trimmed, and stored
            // as plain strings; nothing here is interpolated anywhere.
            day.services = value.services
              .filter((s) => typeof s === 'string' && s.trim())
              .slice(0, 12)
              .map((s) => s.trim().slice(0, 80));
          }
          clean[weekday] = day;
        }
        if (bad) errors.push({ field: 'contentRhythm', message: bad });
        else out.contentRhythm = Object.keys(clean).length ? clean : null;
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
    if (patch.postsPerDay !== undefined) {
      const n = Number(patch.postsPerDay);
      if (!Number.isInteger(n) || n < 1 || n > PLANNER_LIMITS.MAX_POSTS_PER_DAY) {
        errors.push({
          field: 'postsPerDay',
          message: `Posts per day must be between 1 and ${PLANNER_LIMITS.MAX_POSTS_PER_DAY}`,
        });
      } else out.postsPerDay = n;
    }
    if (patch.timezone !== undefined) {
      /*
       * isSupportedTimezone, not isValidTimezone: Intl accepts a bare offset
       * like "+05:00" as a timeZone, and storing an offset would be wrong the
       * moment DST moved. Only a named IANA zone may be persisted.
       */
      if (patch.timezone !== null && !isSupportedTimezone(patch.timezone)) {
        errors.push({ field: 'timezone', message: 'Choose a valid IANA timezone, for example Asia/Karachi' });
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

  // --- plan preview --------------------------------------------------------

  /**
   * Describe what a plan WOULD create, before anything is generated.
   *
   * The wizard renders this and generatePlan validates against the same
   * function, so the sentence a user reads ("7 active days x 2 posts per day =
   * 14 posts") is a promise the server keeps rather than a client-side guess.
   */
  async function summarizePlan(userId, options = {}) {
    const prefs = await getPreferences(userId);
    const platforms = await resolvePlatforms(userId, options.platforms ?? prefs.platforms);

    const summary = summarizeSchedule({
      startDate: options.startDate,
      planLength: options.planLength ?? prefs.defaultPlanLength,
      cadence: options.cadence ?? prefs.cadence,
      weekdays: options.weekdays ?? prefs.weekdays,
      times: options.times ?? prefs.times,
      postsPerDay: options.postsPerDay ?? prefs.postsPerDay,
      timezone: options.timezone || prefs.timezone || 'UTC',
      now: now(),
    });

    const errors = [...summary.errors];
    if (platforms.length === 0) {
      errors.push({
        field: 'platforms',
        message: 'Connect at least one Facebook Page, Instagram Professional account, or Threads profile',
      });
    }

    return {
      ...summary,
      valid: errors.length === 0,
      errors,
      platforms,
      contentMix: options.contentMix ?? prefs.contentMix,
      approvalMode: options.approvalMode ?? prefs.approvalMode,
      tone: prefs.tone,
    };
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

    const requestedTz = options.timezone || prefs.timezone || 'UTC';
    if (!isSupportedTimezone(requestedTz)) {
      throw new ValidationError('This plan cannot be generated as configured', [
        { field: 'timezone', message: 'Choose a valid IANA timezone, for example Asia/Karachi' },
      ]);
    }
    const timezone = requestedTz;

    const platforms = await resolvePlatforms(userId, options.platforms ?? prefs.platforms);
    if (platforms.length === 0) {
      throw new ValidationError(
        'Connect at least one Facebook Page, Instagram Professional account, or Threads profile before generating a plan',
      );
    }

    const scheduleInput = {
      startDate: options.startDate,
      planLength: options.planLength ?? prefs.defaultPlanLength,
      cadence: options.cadence ?? prefs.cadence,
      weekdays: options.weekdays ?? prefs.weekdays,
      times: options.times ?? prefs.times,
      postsPerDay: options.postsPerDay ?? prefs.postsPerDay,
      timezone,
      now: now(),
    };

    /*
     * The same summary the wizard displays is the gate here, so the count the
     * user was shown is the count they get. Generation cannot start until it
     * validates.
     */
    const summary = summarizeSchedule(scheduleInput);
    if (!summary.valid) throw new ValidationError('This plan cannot be generated as configured', summary.errors);

    const schedule = buildSchedule(scheduleInput);
    if (schedule.slots.length === 0) {
      throw new ValidationError(
        'That combination of days and times produces no upcoming slots. Try a later start date or different days.',
      );
    }

    // One OpenAI call per post; images are one HCTI call each when enabled.
    await assertUnderDailyLimit(userId, schedule.slots.length);

    /*
     * Resolve the weekly rhythm ONCE, here, and freeze it onto the run. Explicit
     * run options win over saved preferences (input fidelity); the frozen
     * snapshot is what the brief builder reads, so a later change to the user's
     * saved rhythm can never rewrite this plan.
     */
    const rhythm = resolveRhythm({
      preset: options.contentRhythmPreset ?? prefs.contentRhythmPreset,
      customRhythm: options.customRhythm ?? prefs.contentRhythm,
    });

    const briefs = buildBriefSet({ slots: schedule.slots, preferences: prefs, profile, platforms, rhythm });

    const run = await runsRepo.createRun({
      userId,
      businessProfileId: profile?.id ?? null,
      name: options.name || defaultRunName(schedule),
      status: PLANNER_RUN_STATUS.GENERATING,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      timezone: schedule.timezone,
      planLength: options.planLength ?? prefs.defaultPlanLength,
      postsPerDay: schedule.postsPerDay,
      // The immutable generation-configuration snapshot. Written once; never
      // recomputed. Explicit options that were resolved above are what get
      // recorded, so the run reflects exactly what was requested.
      settings: {
        cadence: schedule.cadence,
        times: schedule.timesUsed,
        weekdays: schedule.weekdays,
        postsPerDay: schedule.postsPerDay,
        activeDays: schedule.activeDays,
        platforms,
        timezone: schedule.timezone,
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        goals: prefs.goals,
        contentMix: prefs.contentMix,
        tone: prefs.tone,
        ctaMode: prefs.ctaMode,
        rhythmPreset: rhythm.preset,
        approvalMode: options.approvalMode ?? prefs.approvalMode,
      },
      resolvedRhythm: rhythm,
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
    let hardFailed = 0;

    for (const brief of briefs) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await generateOneItem({
        userId, run, brief, profile, batch, recent, autoQueue, wantImages,
      });
      if (!outcome) continue;
      created.push(outcome.item);
      batch.push(outcome.fingerprint);
      if (outcome.flagged) flagged += 1;
      if (outcome.hardFailed) hardFailed += 1;
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
    if (hardFailed > 0) notes.push(`${hardFailed} post${hardFailed === 1 ? '' : 's'} could not be generated and need a retry.`);
    if (schedule.skippedPast > 0) notes.push(`${schedule.skippedPast} past time slot${schedule.skippedPast === 1 ? '' : 's'} skipped.`);
    if (!wantImages) notes.push('Images were not generated because HCTI is not verified.');

    /*
     * A plan where EVERY post hard-failed is a failed plan, and says so. Saying
     * "review" over a run with nothing reviewable in it is the dishonesty this
     * avoids. A partial failure stays reviewable: the posts that worked are
     * real work, and the ones that did not carry their own status.
     */
    const allFailed = hardFailed > 0 && hardFailed === created.length;
    const runQuality = allFailed
      ? PLANNER_QUALITY_STATUS.GENERATION_FAILED
      : hardFailed > 0 || flagged > 0
        ? PLANNER_QUALITY_STATUS.NEEDS_REVIEW
        : PLANNER_QUALITY_STATUS.PASSED;

    const updated = await runsRepo.updateRun(run.id, userId, {
      status: allFailed
        ? PLANNER_RUN_STATUS.FAILED
        : autoQueue ? PLANNER_RUN_STATUS.QUEUED : PLANNER_RUN_STATUS.REVIEW,
      qualityStatus: runQuality,
      qualityFailures: hardFailed > 0
        ? created.filter((i) => i.qualityStatus === PLANNER_QUALITY_STATUS.GENERATION_FAILED)
          .map((i) => ({ itemId: i.id, reasons: i.qualityFailures || [] }))
          .slice(0, 28)
        : null,
      generationNotes: notes.join(' ').slice(0, PLANNER_LIMITS.NOTES_MAX) || null,
    });

    await logging.record(EVENT_TYPES.PLANNER_RUN_COMPLETED, {
      req, userId, message: 'Plan generated',
      context: { runId: run.id, items: created.length, flagged, hardFailed },
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
    const avoidOpenings = batch.map((fp) => fp.openingText).filter(Boolean);

    const attempts = [];
    let evaluation = null;
    let content = null;
    let styleRejections = [];

    for (let attempt = 0; attempt <= PLANNER_LIMITS.MAX_REGENERATION_ATTEMPTS; attempt += 1) {
      let candidate;
      try {
        // eslint-disable-next-line no-await-in-loop
        candidate = await openaiContentService.generatePlannerPost(
          {
            platform: primaryPlatform,
            format: brief.format,
            contentType: brief.contentType,
            goal: brief.goal,
            tone: brief.tone,
            brief: brief.brief,
            brandName: profile?.businessName ?? null,
            businessCategory: profile?.businessCategory ?? null,
            businessDescription: profile?.businessDescription ?? null,
            serviceEmphasis: brief.serviceEmphasis,
            audienceProblem: brief.audienceProblem,
            location: brief.location,
            website: displayWebsite(profile?.websiteUrl),
            language: profile?.defaultLanguage ?? null,
            callToAction: brief.callToAction,
            avoidPhrases,
            avoidOpenings,
            // Tell the next attempt what was actually wrong with the last one.
            styleIssues: styleRejections,
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
      styleRejections = candidate._style?.rejections ?? [];
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
      /*
       * Two independent reasons to try again: the copy is repetitive, or it is
       * generic filler the style guard could not repair. Either is worth another
       * attempt — shipping "In today's digital world" is not a saving.
       */
      if (!evaluation.shouldRegenerate && styleRejections.length === 0) break;
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

    /*
     * The other platforms get their OWN post, written for them.
     *
     * This runs after the primary copy has settled, so every variant is written
     * against the copy that actually ships rather than against an attempt that
     * was later discarded.
     */
    const { platformCaptions, platformNotes, platformIdenticalNotes } = await generatePlatformCopy({
      userId, brief, profile, primaryPlatform, primary: content,
    });

    const fingerprint = uniqueness.fingerprint({
      caption: content.caption,
      headline: content.headline,
      cta: brief.callToAction,
      hashtags: content.hashtags,
      contentType: brief.contentType,
      goal: brief.goal,
      serviceEmphasis: brief.serviceEmphasis,
      templateKey: brief.templateKey,
      format: brief.format,
    });

    /*
     * A post is held for a human when it repeats something, when the style guard
     * could not save it, OR when two platforms ended up with the same post. All
     * go in the same note, because from the reviewer's side they are the same
     * question: "is this good enough?"
     */
    const duplicateFlagged = evaluation && evaluation.verdict !== 'unique';
    const styleFlagged = styleRejections.length > 0;
    const platformFlagged = platformNotes.length > 0;
    const flagged = duplicateFlagged || styleFlagged || platformFlagged;

    /*
     * HARD failures versus soft ones.
     *
     * A style rejection that SURVIVED every retry is not "worth a look": the
     * copy is the wrong length, carries a banned phrase, or states a claim the
     * business never made, and three attempts could not fix it. Calling that
     * "Needs review" would put an unusable post in front of a human wearing the
     * same badge as a merely-repetitive one. It gets its own status and cannot
     * be approved.
     *
     * Repetition stays soft: a near-duplicate is a judgement call a human can
     * genuinely make, so it is reviewable. Only a near-identical post is hard.
     */
    const hardFailures = [];
    for (const reason of styleRejections) hardFailures.push(reason);
    if (evaluation && evaluation.score >= HARD_DUPLICATE_SCORE) {
      hardFailures.push('this post is a near-duplicate of another one');
    }
    for (const note of platformIdenticalNotes) hardFailures.push(note);
    const hardFailed = hardFailures.length > 0;

    const notes = [];
    if (duplicateFlagged) notes.push(uniqueness.describe(evaluation));
    if (styleFlagged) notes.push(`Needs rewrite: ${styleRejections.join('; ')}.`);
    for (const note of platformNotes) notes.push(note);
    const duplicationNotes = notes.length ? notes.join(' ').slice(0, 500) : null;

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
      // Phase 4.8 strategy metadata: what this post is for, and why it looks
      // the way it does. Persisted so the board can show it and the duplicate
      // memory can compare against it later.
      contentPillar: brief.pillar ?? null,
      contentFormat: brief.format ?? null,
      audienceProblem: brief.audienceProblem ?? null,
      topicAngle: brief.angle ?? null,
      ctaStrategy: brief.ctaStrategy ?? null,
      visualFamily: brief.visualFamily ?? null,
      qualityStatus: hardFailed
        ? PLANNER_QUALITY_STATUS.GENERATION_FAILED
        : flagged
          ? PLANNER_QUALITY_STATUS.NEEDS_REVIEW
          : PLANNER_QUALITY_STATUS.PASSED,
      qualityFailures: hardFailed ? hardFailures.slice(0, 8) : null,
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
      platformCaptions,
      altText: content.imageAltText,
      brief: brief.brief,
      mediaAssetId,
      /*
       * A hard failure gets its own status, never "needs review": it cannot be
       * approved, only retried, edited or deleted. Auto-queue still holds merely
       * flagged posts for a human rather than approving something the engine
       * already believes is repetitive.
       */
      approvalStatus: hardFailed
        ? PLANNER_ITEM_STATUS.GENERATION_FAILED
        : autoQueue && !flagged
          ? PLANNER_ITEM_STATUS.APPROVED
          : PLANNER_ITEM_STATUS.NEEDS_REVIEW,
      duplicationScore: evaluation?.score ?? 0,
      duplicationNotes,
      regenerationCount: Math.max(0, attempts.length - 1),
      fingerprint: { ...fingerprint, visualExtras: extrasFor(content, brief) },
      editedFields: [],
    });

    return { item, fingerprint, flagged, hardFailed };
  }

  /**
   * Write this post again, properly, for each of the OTHER target platforms.
   *
   * The old behaviour fanned the primary platform's string out to all three
   * targets, so a Threads post was a Facebook post pasted into a shorter box.
   * Each platform now gets its own generation, its own length band and its own
   * opening, with the primary copy supplied as context so the FACTS stay shared
   * while the writing does not.
   *
   * Every failure here is soft. A variant that will not generate, or generates
   * badly, falls back to the primary copy and says so in a note: a plan with one
   * reused post is a worse plan, but a plan that failed to save is not a plan.
   *
   * @returns {{ platformCaptions: object|null, platformNotes: string[],
   *             platformIdenticalNotes: string[] }}
   *          `platformNotes` are soft (reviewable); `platformIdenticalNotes` are
   *          hard: two platforms ended up with the same post, which is the exact
   *          defect per-platform generation exists to prevent.
   */
  async function generatePlatformCopy({ userId, brief, profile, primaryPlatform, primary }) {
    const platformCaptions = {
      [primaryPlatform]: { caption: primary.caption, hashtags: primary.hashtags },
    };
    const notes = [];
    const identical = [];
    const others = brief.platforms.filter((p) => p !== primaryPlatform);
    // A single-platform plan has nothing to differentiate; leave the column NULL
    // and let the reader fall back to `caption`.
    if (others.length === 0) {
      return { platformCaptions: null, platformNotes: notes, platformIdenticalNotes: identical };
    }

    for (const platform of others) {
      let variant = null;
      for (let attempt = 0; attempt <= PLANNER_LIMITS.MAX_REGENERATION_ATTEMPTS; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const candidate = await openaiContentService.generatePlannerPost(
            {
              platform,
              format: brief.format,
              contentType: brief.contentType,
              goal: brief.goal,
              tone: brief.tone,
              brief: brief.brief,
              brandName: profile?.businessName ?? null,
              businessCategory: profile?.businessCategory ?? null,
              businessDescription: profile?.businessDescription ?? null,
              serviceEmphasis: brief.serviceEmphasis,
              audienceProblem: brief.audienceProblem,
              location: brief.location,
              website: displayWebsite(profile?.websiteUrl),
              language: profile?.defaultLanguage ?? null,
              callToAction: brief.callToAction,
              siblingCopy: primary.caption,
              styleIssues: variant?._style?.rejections ?? [],
            },
            { userId },
          );
          variant = candidate;
          const tooSimilar = uniqueness.platformCopyTooSimilar(primary.caption, candidate.caption);
          if ((candidate._style?.rejections ?? []).length === 0 && !tooSimilar) break;
        } catch {
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      if (!variant?.caption) {
        // Falling back to the primary copy keeps the plan usable, but it IS the
        // "one post pasted twice" defect, so it is reported as hard rather than
        // hidden behind a soft note.
        platformCaptions[platform] = { caption: primary.caption, hashtags: primary.hashtags };
        identical.push(`the ${platform} post could not be written separately and repeats the ${primaryPlatform} post`);
        // eslint-disable-next-line no-continue
        continue;
      }

      platformCaptions[platform] = { caption: variant.caption, hashtags: variant.hashtags };
      const rejections = variant._style?.rejections ?? [];
      if (rejections.length) {
        // The variant survived its own retries and is still invalid: hard.
        identical.push(`the ${platform} post could not be written to a valid length or shape`);
      }
      if (uniqueness.platformCopyTooSimilar(primary.caption, variant.caption)) {
        identical.push(`the ${platform} post is the same post as the ${primaryPlatform} one`);
      }
    }

    return {
      platformCaptions,
      platformNotes: notes.slice(0, 4),
      platformIdenticalNotes: identical.slice(0, 4),
    };
  }

  /**
   * The copy each target platform actually publishes.
   *
   * Prefers the post written FOR that platform. Falls back to the item's
   * canonical caption when there is no variant — an item from before this column
   * existed, a single-platform plan, or a variant that failed to generate. The
   * fallback is the old behaviour, so an old item queues exactly as it always
   * did rather than failing.
   *
   * A user edit to `caption` is respected: the review board edits the canonical
   * field, so an edited caption must win over a stale generated variant for the
   * primary platform.
   */
  function platformCaptionsFor(item) {
    const variants = item.platformCaptions;
    const out = {};
    for (const platform of item.platformTargets) {
      const variant = variants?.[platform];
      const usable = variant && typeof variant.caption === 'string' && variant.caption.trim();
      out[platform] = usable
        ? { caption: variant.caption, hashtags: Array.isArray(variant.hashtags) ? variant.hashtags : [] }
        : { caption: item.caption, hashtags: item.hashtags };
    }
    return out;
  }

  /** The structured extras a content-type template renders, if present. */
  function extrasFor(content, brief) {
    const extras = {};
    if (Array.isArray(content.bullets) && content.bullets.length) extras.bullets = content.bullets;
    if (content.stat?.value) extras.stat = content.stat;
    if (content.comparison?.leftTitle) extras.comparison = content.comparison;
    if (content.badge) extras.badge = content.badge;
    else if (brief?.formatLabel) extras.badge = brief.formatLabel;
    if (brief?.location) extras.locationLabel = brief.location;
    // Persisted so a later image regeneration can rebuild the FAQ card with its
    // real answer instead of silently falling back to the truncated subheadline.
    if (content.answerSummary) extras.answerSummary = content.answerSummary;
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
      // The design families' category badge and place label.
      badge: overrides.badge ?? content.badge ?? brief.formatLabel ?? null,
      locationLabel: overrides.locationLabel ?? brief.location ?? null,
      /*
       * The FAQ answer. Without this hop the faq-editorial layout falls back to
       * the subheadline, which is clamped to 140 characters, so a real answer
       * renders truncated mid-word.
       */
      answerSummary: overrides.answerSummary ?? content.answerSummary ?? null,
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
    /*
     * Editing a hard failure clears it. The generator could not write a valid
     * post, but a person just did, and holding their work hostage to the
     * machine's verdict would be absurd. The quality record is cleared with it,
     * because it no longer describes what is there.
     */
    if (item.approvalStatus === PLANNER_ITEM_STATUS.GENERATION_FAILED && edited.has('caption')) {
      fields.approvalStatus = PLANNER_ITEM_STATUS.DRAFT;
      fields.qualityStatus = PLANNER_QUALITY_STATUS.NEEDS_REVIEW;
      fields.qualityFailures = null;
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

      /*
       * A retry RE-VALIDATES. It does not launder.
       *
       * This previously set NEEDS_REVIEW unconditionally and never looked at the
       * new copy's style verdict, so "Retry" — the very action the failure
       * message tells the user to take — cleared a hard failure even when the
       * regenerated copy was just as invalid. The retry now earns its status:
       * still-rejected copy stays failed, valid copy is released for review.
       */
      const retryRejections = content._style?.rejections ?? [];
      const stillFailing = retryRejections.length > 0
        || evaluation.score >= HARD_DUPLICATE_SCORE;

      const fields = {
        caption: content.caption,
        hashtags: content.hashtags,
        summary: content.summary,
        regenerationCount: item.regenerationCount + 1,
        duplicationScore: evaluation.score,
        duplicationNotes: evaluation.verdict === 'unique' ? null : uniqueness.describe(evaluation),
        qualityStatus: stillFailing
          ? PLANNER_QUALITY_STATUS.GENERATION_FAILED
          : PLANNER_QUALITY_STATUS.NEEDS_REVIEW,
        qualityFailures: stillFailing ? retryRejections.slice(0, 8) : null,
        approvalStatus: stillFailing
          ? PLANNER_ITEM_STATUS.GENERATION_FAILED
          : PLANNER_ITEM_STATUS.NEEDS_REVIEW,
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
          formatLabel: extras.badge ?? null,
          location: extras.locationLabel ?? null,
        },
        content: {
          headline: item.headline,
          subheadline: item.subheadline,
          bullets: extras.bullets ?? null,
          stat: extras.stat ?? null,
          comparison: extras.comparison ?? null,
          badge: extras.badge ?? null,
          answerSummary: extras.answerSummary ?? null,
        },
        overrides: {
          templateKey: item.templateKey,
          aspectRatio: item.aspectRatio,
          backgroundStyle: item.backgroundStyle,
          badge: extras.badge ?? null,
          locationLabel: extras.locationLabel ?? null,
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
      throw new ValidationError('This post has no post copy to approve', [
        { field: 'caption', message: 'Add post copy before approving' },
      ]);
    }
    /*
     * A hard failure cannot be approved into the queue.
     *
     * The gate is on `qualityStatus`, the engine's RECORD of what happened, not
     * on `approvalStatus`, which the user can move. Gating on approvalStatus was
     * bypassable in two calls: set the item to `draft` (a legitimate status the
     * validator accepts), which clears `generation_failed` from approvalStatus,
     * then approve it. The failure record survived and the post queued anyway,
     * which made "Generation failed" exactly the cosmetic label this was meant
     * to prevent.
     *
     * qualityStatus is only cleared by a human editing the copy (updateItem) or
     * by a regeneration that actually passes. Those are the two ways someone
     * takes responsibility for the post.
     */
    if (status === PLANNER_ITEM_STATUS.APPROVED
      && item.qualityStatus === PLANNER_QUALITY_STATUS.GENERATION_FAILED) {
      throw new ConflictError(
        'This post could not be generated. Retry it or edit it before approving.',
      );
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
        results.skipped.push({ id: item.id, reason: 'no post copy' });
        continue;
      }
      // Approve-all must never sweep a hard failure into the queue. Keyed on the
      // engine's record, not the movable approval status, for the same reason as
      // setItemStatus above.
      if (status === PLANNER_ITEM_STATUS.APPROVED
        && item.qualityStatus === PLANNER_QUALITY_STATUS.GENERATION_FAILED) {
        results.skipped.push({ id: item.id, reason: 'generation failed, needs a retry or an edit' });
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

  /**
   * What deleting this plan would actually do.
   *
   * Shown in the confirmation so "Delete plan" is never a guess. Also the
   * source of truth for whether deletion is allowed at all.
   */
  async function describeDeletion(userId, runId) {
    const run = await runsRepo.findRunByIdForUser(runId, userId);
    if (!run) throw new NotFoundError('Plan not found');

    const items = await runsRepo.listItemsForRun(runId, userId);
    const linked = [];
    for (const item of items) {
      if (!item.postId) continue;
      // eslint-disable-next-line no-await-in-loop
      const post = await posts.findPostByIdForUser(item.postId, userId);
      if (post) linked.push(post);
    }

    const published = linked.filter((p) => PUBLISHED_STATUSES.includes(p.status));
    const queued = linked.filter((p) => CANCELLABLE_STATUSES.includes(p.status));
    const drafts = linked.filter((p) => p.status === POST_STATUS.DRAFT);
    const plannerOnly = items.filter((i) => !i.postId);

    return {
      run,
      counts: {
        plannerItems: items.length,
        plannerOnlyItems: plannerOnly.length,
        draftPosts: drafts.length,
        queuedPosts: queued.length,
        publishedPosts: published.length,
      },
      // A plan that produced published history is archived, never destroyed.
      mustArchive: published.length > 0,
      // Queued posts block a plain delete: they are scheduled work the user has
      // already approved, and removing them silently would be a surprise.
      blockedByQueued: published.length === 0 && queued.length > 0,
      queuedPostIds: queued.map((p) => p.id),
    };
  }

  /**
   * Delete or archive a plan.
   *
   * Rules, in order:
   *   published history  → ARCHIVE. Never destroy a record of what went out.
   *   queued posts       → REFUSE, unless the caller explicitly opts into
   *                        `cancelQueued`, which cancels them first.
   *   drafts / planner-only items → delete with the plan.
   *
   * The whole thing runs in one transaction: a half-deleted plan whose posts
   * were cancelled would be worse than either outcome.
   */
  async function deletePlan(userId, runId, { cancelQueued = false, req } = {}) {
    const plan = await describeDeletion(userId, runId);

    if (plan.mustArchive) {
      const archived = await runsRepo.updateRun(runId, userId, {
        status: PLANNER_RUN_STATUS.ARCHIVED,
        archivedAt: toMysqlUtc(now()),
      });
      await logging.record(EVENT_TYPES.PLANNER_RUN_ARCHIVED, {
        req, userId, message: 'Plan archived (it has published history)',
        context: { runId, publishedPosts: plan.counts.publishedPosts },
      });
      return {
        deleted: false,
        archived: true,
        run: archived,
        notice: `This plan has ${plan.counts.publishedPosts} published post${plan.counts.publishedPosts === 1 ? '' : 's'}, so it was archived instead of deleted. Published history is never removed.`,
      };
    }

    if (plan.blockedByQueued && !cancelQueued) {
      throw new ConflictError(
        `This plan has ${plan.counts.queuedPosts} queued post${plan.counts.queuedPosts === 1 ? '' : 's'}. Cancel them first, or choose "Cancel queued posts and delete plan".`,
      );
    }

    await withTransaction(async (conn) => {
      if (cancelQueued) {
        for (const postId of plan.queuedPostIds) {
          // eslint-disable-next-line no-await-in-loop
          await posts.cancelScheduledPost(postId, userId, conn);
        }
      }
      // Planner items cascade with the run. Any post the plan created survives
      // as an independent record (the FK is ON DELETE SET NULL) — cancelled if
      // we just cancelled it, still a draft otherwise.
      await runsRepo.deleteRun(runId, userId, conn);
    });

    await logging.record(EVENT_TYPES.PLANNER_RUN_DELETED, {
      req, userId, message: 'Plan deleted',
      context: {
        runId,
        plannerItems: plan.counts.plannerItems,
        cancelledPosts: cancelQueued ? plan.counts.queuedPosts : 0,
      },
    });

    return {
      deleted: true,
      archived: false,
      cancelledPosts: cancelQueued ? plan.counts.queuedPosts : 0,
    };
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

        await posts.updateGeneratedContent(
          draft.id,
          userId,
          {
            platformCaptions: platformCaptionsFor(item),
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
    /*
     * "Queued" means there is nothing left to do. An outstanding hard failure is
     * something left to do, so it counts as unfinished exactly like a draft or a
     * pending review. (A REJECTED item does not: the user decided about it.)
     * Without this a run with five queued posts and two failures reported itself
     * as fully queued and the failures fell out of sight.
     */
    const allQueued = counts[PLANNER_ITEM_STATUS.QUEUED] > 0
      && counts[PLANNER_ITEM_STATUS.APPROVED] === 0
      && counts[PLANNER_ITEM_STATUS.NEEDS_REVIEW] === 0
      && counts[PLANNER_ITEM_STATUS.DRAFT] === 0
      && (counts[PLANNER_ITEM_STATUS.GENERATION_FAILED] || 0) === 0;
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
    await posts.updateGeneratedContent(draft.id, userId, {
      platformCaptions: platformCaptionsFor(item),
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
    describeWeeklyRhythm,
    savePreferences,
    summarizePlan,
    describeDeletion,
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
