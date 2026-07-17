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
  DUPLICATION_THRESHOLDS,
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
  PLATFORM_LABELS,
  ACCOUNT_TYPE_TO_PLATFORM,
  SOCIAL_ACCOUNT_STATUS,
  POST_STATUS,
  EVENT_TYPES,
  USAGE_OPERATIONS,
  IMAGE_TEMPLATE_VALUES,
} from '../config/constants.js';

/**
 * A platform list reduced to its identity, for COMPARISON only.
 *
 * Sorted and deduped, because ["threads","instagram"] and ["instagram","threads"]
 * are the same selection. Never STORED in this shape: the request's order is
 * meaningful downstream, since platforms[0] is the primary the post is written
 * for and the rest are written against it.
 */
export const normalizePlatformList = (list) =>
  [...new Set(Array.isArray(list) ? list : [])].sort().join(',');

/**
 * The platform contract: what gets generated is exactly what was selected.
 *
 * Every layer between the request and the writer has a chance to add a platform
 * — a default merge, a connected-account lookup, a fallback. One of them did,
 * and users got Facebook posts they never asked for. This is the one place that
 * says no.
 *
 * It runs BEFORE the run row is written and before any OpenAI or HCTI call, so
 * a mismatch costs nothing: no plan, no spend, no half-generated week to clean
 * up after.
 *
 * It throws rather than repairing, and that is the point. "Repairing" a
 * platform mismatch means picking a destination on the user's behalf — which is
 * precisely what the removed fallback did, and precisely the defect this guards.
 *
 * Exported because it is a pure invariant: nothing in normal operation should
 * ever trip it, so the only way to know it works is to test it directly.
 *
 * @throws {ConflictError} when any brief targets a different set than `selected`
 */
export function assertPlatformContract(selected, briefs) {
  const expected = normalizePlatformList(selected);
  for (const brief of briefs || []) {
    if (normalizePlatformList(brief.platforms) !== expected) {
      throw new ConflictError(
        'This plan could not be generated: the posts were built for different platforms than you selected. '
        + 'Nothing was generated and nothing was charged. Please try again.',
      );
    }
  }
}

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
import {
  postCopyIssues,
  measurePostCopy,
  targetBandFor,
  repairGuidance,
} from './contentStyleGuard.js';
import { normalizePlatformCopy, applyPlatformEdit } from './platformCopy.js';

import * as defaultPlannerPrefs from '../repositories/plannerPreferenceRepository.js';
import * as defaultPlannerRuns from '../repositories/plannerRunRepository.js';
import * as defaultPlannerRevisions from '../repositories/plannerRevisionRepository.js';
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
  revisions: revisionsRepo = defaultPlannerRevisions,
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
    // Resolved the SAME way generatePlan resolves it, from the same input, so
    // the platform list the wizard shows is the list that will be generated. A
    // summary computed differently from the thing it summarises is a lie with a
    // delay on it.
    const resolved = await resolvePlatforms(userId, options.platforms ?? prefs.platforms);

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

    const errors = [...summary.errors, ...(platformSelectionErrors(resolved) ?? [])];

    return {
      ...summary,
      valid: errors.length === 0,
      errors,
      platforms: resolved.platforms,
      // What the user asked for, before it was narrowed to what is connected.
      // The wizard shows `platforms`; this is here so a chosen-but-disconnected
      // account can be named rather than silently vanishing from the summary.
      selectedPlatforms: resolved.selected,
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

  /**
   * Where this plan will actually be written for.
   *
   * CONNECTED IS NOT SELECTED. This function used to end with:
   *
   *   if (!Array.isArray(requested) || requested.length === 0) return available;
   *
   * ...so a request that named no platforms silently received every connected
   * account. A user with a Facebook Page connected but not chosen got Facebook
   * posts, and when the Facebook copy failed validation their plan was marked
   * "Generation failed" for a platform they had never asked for. Connected
   * accounts are the ELIGIBLE destinations; only the request says which are the
   * ACTUAL ones.
   *
   * Nothing is unioned in: not saved defaults, not connected accounts, not the
   * previous plan, not a fallback provider. The selection is filtered down to
   * what is connected and never up.
   *
   * An empty result is returned as an empty result. The caller decides which
   * error that is, because "you have connected nothing" and "you chose nothing"
   * are different problems with different fixes.
   *
   * @returns {{ available: string[], selected: string[], platforms: string[] }}
   *          `selected` is what was asked for (deduped), `platforms` is that
   *          same list narrowed to what is actually connected. Request order is
   *          preserved: platforms[0] is the primary the post is written for.
   */
  async function resolvePlatforms(userId, requested) {
    const accounts = await socialAccounts.listAccountsForUser(userId);
    const active = (accounts || []).filter((a) => a.status === SOCIAL_ACCOUNT_STATUS.ACTIVE);
    const available = [...new Set(active.map((a) => ACCOUNT_TYPE_TO_PLATFORM[a.accountType]).filter(Boolean))];
    const selected = Array.isArray(requested)
      ? [...new Set(requested.filter((p) => PLATFORM_VALUES.includes(p)))]
      : [];
    return { available, selected, platforms: selected.filter((p) => available.includes(p)) };
  }

  /**
   * Turn an empty platform resolution into the RIGHT error.
   *
   * Three different situations used to collapse into one silent fallback:
   * nothing connected, nothing chosen, and chosen-but-not-connected. Each needs
   * a different action from the user, so each says so.
   *
   * @returns {Array|null} validation errors, or null when the selection is fine
   */
  function platformSelectionErrors({ available, selected, platforms }) {
    if (available.length === 0) {
      return [{
        field: 'platforms',
        message: 'Connect at least one Facebook Page, Instagram Professional account, or Threads profile',
      }];
    }
    if (selected.length === 0) {
      return [{ field: 'platforms', message: 'Choose at least one platform for these posts' }];
    }
    if (platforms.length === 0) {
      return [{
        field: 'platforms',
        message: 'None of the platforms you chose are connected. Connect them, or choose a different platform.',
      }];
    }
    return null;
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
    // Per-user now: availability is a fact about THIS customer's key, not about
    // the process. Checked before any spend.
    if (!(await openaiContentService.isAvailable(userId))) {
      throw new ConflictError(
        'Add and verify your OpenAI API key in Integrations before using AI generation.',
      );
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

    /*
     * The platforms for THIS run, and nothing else.
     *
     * `options.platforms ?? prefs.platforms` is a fallback, not a union: an
     * explicit selection in the request wins outright, and the saved default is
     * only consulted when the request names none at all. `??` and not `||` on
     * purpose — an empty array is an explicit "none", and it must reach the
     * error below rather than quietly inherit the saved list.
     */
    const resolved = await resolvePlatforms(userId, options.platforms ?? prefs.platforms);

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
     *
     * Schedule and platform problems are reported TOGETHER, in one error, the
     * same way summarizePlan reports them. Checking platforms first and
     * returning early would answer "you chose no platforms" to someone whose
     * dates are also wrong, and send them round the loop twice.
     */
    const summary = summarizeSchedule(scheduleInput);
    const setupErrors = [...summary.errors, ...(platformSelectionErrors(resolved) ?? [])];
    if (setupErrors.length) throw new ValidationError('This plan cannot be generated as configured', setupErrors);
    const { platforms } = resolved;

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

    /*
     * The last gate before anything is written or spent.
     *
     * `platforms` is about to be frozen onto the run as its immutable selection
     * snapshot, and each brief is about to become an item's platform_targets.
     * If those two ever disagree, the user gets posts for a platform they did
     * not choose — which is precisely what happened. Checking here means a
     * mismatch produces no run row and no API call at all.
     */
    assertPlatformContract(platforms, briefs);

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
    // Counted apart from `flagged`, because only THIS one is about similarity.
    let duplicateFlagged = 0;
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
      if (outcome.duplicateFlagged) duplicateFlagged += 1;
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

    /*
     * Say what actually happened, not what the counter happens to be called.
     *
     * `flagged` is true for ANY reason a post was held: a duplicate, a style
     * rejection, a platform note. The note said "flagged for similarity review"
     * for all of them, so a plan whose Facebook copy came out the wrong LENGTH
     * was reported to the user as two similar posts. It sent people looking for
     * a repetition problem they did not have.
     *
     * Similarity is now counted separately and claimed only when the
     * duplication data says so.
     */
    if (duplicateFlagged > 0) {
      notes.push(`${duplicateFlagged} post${duplicateFlagged === 1 ? '' : 's'} flagged for similarity review.`);
    }
    if (hardFailed > 0) {
      notes.push(`${hardFailed} post${hardFailed === 1 ? ' needs' : 's need'} another rewrite.`);
    }
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
    let repairNotes = [];

    for (let attempt = 0; attempt <= PLANNER_LIMITS.MAX_REGENERATION_ATTEMPTS; attempt += 1) {
      let candidate;
      try {
        // eslint-disable-next-line no-await-in-loop
        candidate = await openaiContentService.generatePlannerPost(
          {
            ...postRequestFrom({ brief, profile }),
            platform: primaryPlatform,
            avoidPhrases,
            avoidOpenings,
            // Tell the next attempt what was actually wrong with the last one,
            // and by how much: the verdict alone produces another near-miss.
            styleIssues: styleRejections,
            repairNotes,
            targetBand: targetBandFor(
              primaryPlatform,
              attempt,
              content ? measurePostCopy(content.caption, primaryPlatform) : null,
            ),
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
      repairNotes = styleRejections.length
        ? repairGuidance(candidate.caption, primaryPlatform, attempt + 1)
        : [];
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

    // The first version of each platform's copy, for the timeline.
    await recordItemRevisions(userId, item, 'generated');

    // `duplicateFlagged` is reported separately from `flagged`: the run's note
    // may only claim a similarity problem when there actually is one.
    return { item, fingerprint, flagged, duplicateFlagged, hardFailed };
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
  /**
   * Write ONE platform's post copy, repairing it against the validator.
   *
   * Bounded at PLANNER_LIMITS.MAX_COPY_ATTEMPTS, and each attempt is genuinely
   * different from the one before it:
   *
   *   1. aim at the platform's safe target band
   *   2. same band, plus the exact counts the last attempt missed by
   *   3. a narrower band pushed away from the edge that was actually missed
   *
   * Then it stops. A fourth attempt at a prompt that has failed three times is
   * not a strategy, it is spend — and the user's Retry button is still there,
   * each click buying a fresh bounded run of three.
   *
   * Nothing here ever edits the returned copy to satisfy a count. A post that
   * is one word short is sent back to the writer with "add a real detail, do
   * not pad", because appending "Get in touch today!" would pass the check and
   * make the post worse.
   *
   * @returns {{ content, issues: string[], calls: number }} `issues` is the
   *          FINAL verdict: empty means this platform is good.
   */
  async function writePlatformPost({
    userId, platform, request, siblingCopy = null, siblingPlatform = null,
    priorIssues = [], priorNotes = [],
  }) {
    let content = null;
    let issues = [];
    let tooSimilar = false;
    /*
     * The FIRST attempt of a retry already knows the numbers.
     *
     * The copy that failed is sitting in the database, so its counts can be
     * measured before a single call is made. Starting a retry with an empty
     * verdict would throw that away and make attempt 1 an unguided re-roll —
     * which is what nine of item 31's regenerations were.
     *
     * A fresh generation passes neither, because there is nothing to repair yet.
     */
    let repairNotes = priorNotes;
    let styleIssues = priorIssues.slice(0, 6);
    let calls = 0;

    for (let attempt = 0; attempt < PLANNER_LIMITS.MAX_COPY_ATTEMPTS; attempt += 1) {
      const targetBand = targetBandFor(platform, attempt, content ? measurePostCopy(content.caption, platform) : null);
      let candidate;
      try {
        // eslint-disable-next-line no-await-in-loop
        candidate = await openaiContentService.generatePlannerPost(
          { ...request, platform, siblingCopy, styleIssues, repairNotes, targetBand },
          { userId },
        );
      } catch {
        // A call that threw told us nothing, so it cannot inform the next
        // attempt. It still counts against the budget: an unavailable model
        // must not become an unbounded loop.
        // eslint-disable-next-line no-continue
        continue;
      }
      calls += 1;
      content = candidate;
      issues = candidate._style?.rejections ?? [];

      tooSimilar = siblingCopy
        ? uniqueness.platformCopyTooSimilar(siblingCopy, candidate.caption)
        : false;
      if (issues.length === 0 && !tooSimilar) break;

      // Tell the next attempt exactly what this one measured, and what to fix.
      styleIssues = issues.slice(0, 6);
      repairNotes = repairGuidance(candidate.caption, platform, attempt + 1);
      if (tooSimilar) {
        repairNotes = [
          ...repairNotes,
          'your last attempt was too close to the post already written for another platform: '
          + 'change the opening sentence and the structure, not just the wording',
        ];
      }
    }

    /*
     * The verdict covers BOTH ways this copy can be unusable.
     *
     * `issues` carried only the style rejections, so copy that survived three
     * attempts still reading as a paste of its sibling came back with an empty
     * verdict and would have been stored as a pass. The one caller that noticed
     * was checking for it separately; the repair path was not. Deciding it here,
     * once, is what stops the next caller inheriting that gap.
     */
    const verdict = [...issues];
    if (content && tooSimilar) {
      const other = siblingPlatform ? (PLATFORM_LABELS[siblingPlatform] ?? siblingPlatform) : 'another platform';
      verdict.push(`${PLATFORM_LABELS[platform] ?? platform} repeats the post written for ${other}`);
    }
    return { content, issues: verdict, calls };
  }

  /** The request fields a platform post is written from, shared by every path. */
  function postRequestFrom({ brief, profile }) {
    return {
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
    };
  }

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
      // eslint-disable-next-line no-await-in-loop
      const { content: variant, issues } = await writePlatformPost({
        userId,
        platform,
        request: postRequestFrom({ brief, profile }),
        siblingCopy: primary.caption,
        siblingPlatform: primaryPlatform,
      });

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
      /*
       * The variant survived its attempts and is still invalid.
       *
       * The exact reasons are reported, not summarised. This line used to push
       * `the ${platform} post could not be written to a valid length or shape`
       * and throw `issues` away — while `issues` held "Threads has 44 words;
       * the minimum is 45". The number the user needed was one stack frame from
       * being stored, and instead they got a sentence that told them nothing and
       * sent them to phpMyAdmin.
       */
      for (const reason of issues) identical.push(reason);
    }

    return {
      platformCaptions,
      platformNotes: notes.slice(0, 4),
      platformIdenticalNotes: identical.slice(0, 6),
    };
  }

  /**
   * Which of this item's platforms currently hold copy the validator rejects.
   *
   * Read from the SAME canonical resolver the queue publishes from, so a repair
   * cannot disagree with what would actually go out.
   *
   * @returns {Map<string, string[]>} platform -> exact reasons. Absent means it
   *          is fine, and a platform that is fine is never rewritten.
   */
  function failingPlatforms(item) {
    const stored = platformCaptionsFor(item);
    const failing = new Map();
    for (const platform of item.platformTargets) {
      const issues = postCopyIssues(stored[platform]?.caption ?? '', platform);
      if (issues.length) failing.set(platform, issues);
    }
    return failing;
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
    /*
     * The resolved per-platform copy the editor renders.
     *
     * Attached here, from the canonical platform_captions_json, so the drawer
     * and Create Post read platformCopy directly instead of deriving every tab
     * from item.caption — the gap C2 closes. Selected platforms only; validation
     * and measurements included so the tabs need no second round-trip.
     */
    return { ...rest, media, platformCopy: normalizePlatformCopy(item) };
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

    /*
     * Per-platform copy edits.
     *
     * `patch.platformCaptions` is { platform: { postCopy, hashtags } } and is
     * the authoritative path once the drawer has tabs. Each named platform:
     *
     *   - MUST be in the item's immutable platform snapshot. This is the whole
     *     of "Facebook cannot be added to an Instagram + Threads item": a
     *     platform not in platformTargets is rejected before anything is written,
     *     with no OpenAI call, no HCTI call and no revision;
     *   - is validated by the existing style guard (prose paragraphs, not list
     *     items; hashtags separate) so a manual edit is held to the same bar as
     *     generated copy;
     *   - is merged so siblings are written back byte-for-byte (applyPlatformEdit).
     *
     * The revisions to record are collected here and written AFTER the row is
     * saved, so a failed save cannot leave an orphan revision.
     */
    const platformRevisions = [];
    let editedPlatformCaptions = null;
    const currentCopy = normalizePlatformCopy(item);
    if (patch.platformCaptions !== undefined) {
      const edits = patch.platformCaptions && typeof patch.platformCaptions === 'object'
        ? patch.platformCaptions : null;
      if (!edits) {
        errors.push({ field: 'platformCaptions', message: 'Invalid platform copy' });
      } else {
        for (const [platform, value] of Object.entries(edits)) {
          if (!item.platformTargets.includes(platform)) {
            // Unselected platform (or a bogus one). This is the injection guard.
            errors.push({
              field: `platformCaptions.${platform}`,
              message: `${PLATFORM_LABELS[platform] ?? platform} is not one of this post's platforms`,
            });
            continue;
          }
          const postCopy = typeof value?.postCopy === 'string' ? value.postCopy.slice(0, 4000) : null;
          if (postCopy === null || postCopy.trim() === '') {
            errors.push({ field: `platformCaptions.${platform}`, message: 'Post copy cannot be empty' });
            continue;
          }
          const hashtags = Array.isArray(value.hashtags)
            ? value.hashtags.filter((h) => typeof h === 'string').slice(0, 30)
            : (currentCopy[platform]?.hashtags ?? []);
          // Only an ACTUAL change is an edit. Re-saving identical copy is a no-op
          // and records no revision — the reopen/reload/duplicate-save case.
          const before = currentCopy[platform];
          if (before && same({ c: before.postCopy, h: before.hashtags }, { c: postCopy, h: hashtags })) {
            continue;
          }
          editedPlatformCaptions = applyPlatformEdit(
            editedPlatformCaptions ? { ...item, platformCaptions: editedPlatformCaptions } : item,
            platform,
            { postCopy, hashtags },
            toMysqlUtc(now()),
          );
          const issues = postCopyIssues(postCopy, platform);
          platformRevisions.push({
            platform,
            postCopy,
            hashtags,
            validationStatus: issues.length === 0 ? 'passed' : 'failed',
          });
        }
      }
    }

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

    /*
     * Commit the per-platform edits into the fields to persist.
     *
     * When the PRIMARY platform's copy was edited, the canonical `caption` and
     * `hashtags` move with it: those two fields ARE the primary platform's copy
     * for every legacy reader (the queue's fallback, an old client), so leaving
     * them stale would split the source of truth the moment a tab was used. A
     * sibling edit never touches them.
     */
    if (editedPlatformCaptions) {
      fields.platformCaptions = editedPlatformCaptions;
      changedAny = true;
      const primary = item.platformTargets[0];
      const editedPrimary = platformRevisions.find((r) => r.platform === primary);
      if (editedPrimary) {
        fields.caption = editedPrimary.postCopy;
        fields.hashtags = editedPrimary.hashtags;
        edited.add('caption');
      }
    }

    // Re-submitting identical values is a no-op, not an "edit".
    if (!changedAny) return decorateItem(userId, item);

    fields.editedFields = [...edited];
    // A human touched it, so it is no longer a machine draft awaiting triage.
    if (item.approvalStatus === PLANNER_ITEM_STATUS.NEEDS_REVIEW) {
      fields.approvalStatus = PLANNER_ITEM_STATUS.DRAFT;
    }
    /*
     * Editing a hard failure clears it — but ONLY when every selected platform
     * now passes.
     *
     * The generator could not write a valid post and a person just did, so
     * holding their work hostage to the machine's verdict would be absurd. But
     * clearing the failure while another platform is still invalid would let an
     * unusable post be approved. So the failure clears only when the WHOLE item
     * is valid: the platform just edited, and every sibling, measured against
     * the resulting state. A caption-only edit (no tabs) keeps its old
     * behaviour, because that path has a single platform's copy to judge.
     */
    if (item.approvalStatus === PLANNER_ITEM_STATUS.GENERATION_FAILED && edited.has('caption')) {
      const resultingItem = {
        ...item,
        ...fields,
        platformCaptions: fields.platformCaptions ?? item.platformCaptions,
        caption: fields.caption ?? item.caption,
      };
      const resulting = normalizePlatformCopy(resultingItem);
      const allPass = Object.values(resulting).every((p) => p.validationStatus === 'passed');
      if (allPass) {
        fields.approvalStatus = PLANNER_ITEM_STATUS.DRAFT;
        fields.qualityStatus = PLANNER_QUALITY_STATUS.NEEDS_REVIEW;
        fields.qualityFailures = null;
      }
    }

    const updated = await runsRepo.updateItem(itemId, userId, fields);

    /*
     * Manual-edit revisions, AFTER the row is saved so a failed save leaves no
     * orphan. One per platform whose copy actually changed; the repository
     * suppresses an identical repeat, so a duplicate save adds nothing.
     */
    for (const rev of platformRevisions) {
      // eslint-disable-next-line no-await-in-loop
      await revisionsRepo.recordRevision({
        userId,
        plannerRunItemId: itemId,
        platform: rev.platform,
        revisionType: 'manual_edit',
        postCopy: rev.postCopy,
        hashtags: rev.hashtags,
        validationStatus: rev.validationStatus,
      }).catch(() => {});
    }

    await logging.record(EVENT_TYPES.PLANNER_ITEM_UPDATED, {
      req, userId, message: 'Planned post updated',
      context: { itemId, fields: Object.keys(fields).filter((f) => f !== 'editedFields') },
    });
    return decorateItem(userId, updated);
  }

  /** The revision timeline for one item, owner-scoped. */
  async function getItemRevisions(userId, itemId) {
    await requireItem(userId, itemId); // ownership: throws NotFound for another user
    return revisionsRepo.listRevisionsForItem(itemId, userId, { limit: 50 });
  }

  /**
   * Record one revision per selected platform, from the item's resolved copy.
   *
   * Used for the whole-item lifecycle types (generated, approved, queued) where
   * every platform's current copy is snapshotted at once. Per-platform types
   * (manual_edit, retry) are recorded at their own call sites, because they know
   * exactly which platform changed. Best-effort: a revision that fails to write
   * must never break the generation, approval or queueing it records.
   */
  async function recordItemRevisions(userId, item, revisionType) {
    const copy = normalizePlatformCopy(item);
    for (const [platform, entry] of Object.entries(copy)) {
      // eslint-disable-next-line no-await-in-loop
      await revisionsRepo.recordRevision({
        userId,
        plannerRunItemId: item.id,
        platform,
        revisionType,
        postCopy: entry.postCopy,
        hashtags: entry.hashtags,
        validationStatus: entry.validationStatus,
      }).catch(() => {});
    }
  }

  /*
   * Regenerations currently running, keyed by user + item + target.
   *
   * A user whose post says "Generation failed" clicks Retry, sees nothing
   * happen for several seconds, and clicks it again. Each click was a full
   * generation: real OpenAI spend, and a race between two writes to the same
   * row where the loser's copy silently won or lost depending on ordering.
   *
   * The second click is now REFUSED rather than queued, because joining it to
   * the first would return the first's answer to a user who asked for a fresh
   * one, and running it after would charge them twice for the same request.
   *
   * Honest about what this is: an in-process guard, not a distributed lock. It
   * holds for this application (a single Node process) and it closes the
   * reported defect. Two processes would need the lock in the database, and
   * this map would not be the place to pretend otherwise.
   */
  const inFlightRegenerations = new Map();

  /**
   * The same contract, on the regeneration side.
   *
   * A retry writes for `item.platformTargets`, so a drifted item would spend an
   * OpenAI call on a platform the run never selected. Checked before the
   * generator is reached, so a mismatch costs nothing.
   *
   * A run with NO platform snapshot is left alone rather than rejected. Those
   * are runs from before the snapshot existed, their configuration is immutable
   * by design, and refusing to retry them would be breaking working plans to
   * enforce a rule written after they were made. There is nothing to compare
   * against, so nothing is claimed.
   */
  async function assertItemMatchesRunPlatforms(userId, item) {
    const run = await runsRepo.findRunByIdForUser(item.plannerRunId, userId);
    const snapshot = run?.settings?.platforms;
    if (!Array.isArray(snapshot) || snapshot.length === 0) return;
    if (normalizePlatformList(item.platformTargets) !== normalizePlatformList(snapshot)) {
      throw new ConflictError(
        'This post targets different platforms than the plan it belongs to, so it was not regenerated. '
        + 'Nothing was charged. Delete this plan and generate it again.',
      );
    }
  }

  /**
   * Rewrite only the platforms whose copy the validator rejects.
   *
   * Everything not named here is untouched by construction rather than by
   * promise: this function writes `caption`, `hashtags` and the failing
   * platforms' entries in `platformCaptions`, and nothing else. The image, the
   * headline, the subheadline, the schedule, the timezone, the platform
   * selection and the template are never in the update at all, so no future
   * edit to it can quietly start clobbering them.
   *
   * `caption` moves only when the PRIMARY platform is one of the failures,
   * because `caption` IS the primary platform's copy — the canonical field the
   * board edits and the resolver falls back to.
   */
  async function repairFailingPlatforms({
    userId, item, profile, failing, avoidPhrases, avoidOpenings, force = false, edited = new Set(), req,
  }) {
    const primaryPlatform = item.platformTargets[0];
    const stored = platformCaptionsFor(item);
    // The overwrite-confirmation guard for a user-edited platform lives in
    // runRegeneration, before this is reached, so a decline never gets here.
    const request = {
      ...postRequestFrom({
        brief: {
          format: item.contentFormat ?? item.contentType,
          contentType: item.contentType,
          goal: item.goal,
          tone: 'professional',
          brief: item.brief,
          serviceEmphasis: null,
          audienceProblem: item.audienceProblem ?? null,
          location: null,
          callToAction: profile?.defaultCallToAction ?? null,
        },
        profile,
      }),
      avoidPhrases,
      // Openings already used elsewhere in this plan, plus this item's own
      // previous opening: a repair must not simply reword what was rejected.
      avoidOpenings,
    };

    const platformCaptions = { ...(item.platformCaptions ?? {}) };
    // Every platform that is NOT being repaired keeps its exact stored entry,
    // INCLUDING its userEdited flag — a passing platform the user wrote by hand
    // stays marked as theirs through a sibling's repair. The spread above already
    // carries it; this only fills a genuine gap (a NULL column, a legacy item)
    // from the resolver's fallback, and a fallback is never user-edited.
    for (const platform of item.platformTargets) {
      if (!failing.has(platform) && !item.platformCaptions?.[platform]) {
        platformCaptions[platform] = stored[platform];
      }
    }

    const remaining = [];
    const retryRevisions = [];
    let primary = null;

    for (const [platform, priorIssues] of failing) {
      // A repair is written against a platform that is STAYING, so it cannot
      // drift into being a copy of the post it will sit beside.
      const sibling = item.platformTargets.find((p) => p !== platform && !failing.has(p));
      // eslint-disable-next-line no-await-in-loop
      const { content, issues } = await writePlatformPost({
        userId,
        platform,
        request,
        siblingCopy: sibling ? stored[sibling]?.caption ?? null : null,
        siblingPlatform: sibling ?? null,
        priorIssues,
        // Measured from the copy that is actually stored, so the first attempt
        // is told "you wrote 44 words, the floor is 45, aim for 55 to 85" rather
        // than being asked to guess what "too short" meant.
        priorNotes: repairGuidance(stored[platform]?.caption ?? '', platform, 0),
      });

      if (!content?.caption) {
        // Nothing usable came back. Keep what is already there and say so:
        // replacing real copy with nothing would be worse than a failed status.
        remaining.push(...priorIssues);
        // eslint-disable-next-line no-continue
        continue;
      }

      // A repaired platform is machine copy again: userEdited is NOT carried over.
      platformCaptions[platform] = { caption: content.caption, hashtags: content.hashtags };
      if (platform === primaryPlatform) primary = content;
      remaining.push(...issues);
      retryRevisions.push({
        platform,
        postCopy: content.caption,
        hashtags: content.hashtags,
        validationStatus: issues.length === 0 ? 'passed' : 'failed',
      });
    }

    const stillFailing = remaining.length > 0;
    const fields = {
      platformCaptions,
      regenerationCount: item.regenerationCount + 1,
      qualityStatus: stillFailing
        ? PLANNER_QUALITY_STATUS.GENERATION_FAILED
        : PLANNER_QUALITY_STATUS.NEEDS_REVIEW,
      // Cleared on success. A stale reason under a passing post is a lie the
      // user has no way to disprove.
      qualityFailures: stillFailing ? remaining.slice(0, 8) : null,
      approvalStatus: stillFailing
        ? PLANNER_ITEM_STATUS.GENERATION_FAILED
        : PLANNER_ITEM_STATUS.NEEDS_REVIEW,
    };

    /*
     * The canonical caption and the fingerprint move ONLY with the primary.
     *
     * A fingerprint describes the primary platform's copy. Refreshing it after
     * repairing a sibling would describe text that platform never held, and
     * poison the next duplicate comparison with it.
     */
    if (primary) {
      fields.caption = primary.caption;
      fields.hashtags = primary.hashtags;
      /*
       * A forced repair that actually rewrote the canonical caption clears its
       * edit flag, because the user's text is genuinely gone — that is what
       * they confirmed. Only `caption`, and only when the primary was rewritten:
       * a repair of a sibling leaves the human's caption untouched, so claiming
       * to have discarded it would be a lie, and the headline is never rewritten
       * here at all.
       */
      if (force && edited.has('caption')) {
        const remainingEdits = new Set(edited);
        remainingEdits.delete('caption');
        fields.editedFields = [...remainingEdits];
      }
      fields.fingerprint = {
        ...uniqueness.fingerprint({
          caption: primary.caption,
          headline: item.headline,
          hashtags: primary.hashtags,
          cta: profile?.defaultCallToAction ?? null,
          contentType: item.contentType,
          format: item.contentFormat ?? item.contentType,
          pillar: item.contentPillar ?? null,
          goal: item.goal,
          serviceEmphasis: item.fingerprint?.serviceEmphasis ?? null,
          audienceProblem: item.audienceProblem ?? null,
          templateKey: item.templateKey,
        }),
        visualExtras: item.fingerprint?.visualExtras ?? null,
      };
    }

    const updated = await runsRepo.updateItem(item.id, userId, fields);

    // A retry revision per platform that was actually rewritten, after the save.
    for (const rev of retryRevisions) {
      // eslint-disable-next-line no-await-in-loop
      await revisionsRepo.recordRevision({
        userId,
        plannerRunItemId: item.id,
        platform: rev.platform,
        revisionType: 'retry',
        postCopy: rev.postCopy,
        hashtags: rev.hashtags,
        validationStatus: rev.validationStatus,
      }).catch(() => {});
    }

    await logging.record(EVENT_TYPES.PLANNER_ITEM_REGENERATED, {
      req,
      userId,
      message: 'Planned post copy repaired',
      context: { itemId: item.id, platforms: [...failing.keys()], resolved: !stillFailing },
    });
    return decorateItem(userId, updated);
  }

  /**
   * Attach an owned library image to a planner item, or clear it.
   *
   * Copy-only fields, schedule, timezone and platform selection are untouched:
   * this writes mediaAssetId and moves a reference, nothing else. No OpenAI, no
   * HCTI — selecting an uploaded image is a purely local operation.
   *
   * A replaced generated image is NOT deleted; it stays in the library for
   * reuse, and its planner_run_item reference is simply detached.
   *
   * @param {string|null} mediaAssetId the owned asset, or null to clear
   */
  async function setItemMedia(userId, itemId, mediaAssetId) {
    const item = await requireItem(userId, itemId);
    if (item.approvalStatus === PLANNER_ITEM_STATUS.QUEUED) {
      throw new ConflictError('This post is already queued. Edit it from the queue instead.');
    }

    // Verify the new asset is the user's own. A cross-user id is a not-found,
    // never an attach.
    if (mediaAssetId != null) {
      const asset = await mediaRepository.findMediaAssetByIdForUser(mediaAssetId, userId);
      if (!asset) throw new NotFoundError('Media not found');
    }

    // Move the reference: detach the old image's, attach the new one's. The old
    // asset itself is left in the library.
    if (item.mediaAssetId && String(item.mediaAssetId) !== String(mediaAssetId)) {
      await mediaRepository.detachMediaReference({
        userId, mediaAssetId: item.mediaAssetId, referenceType: 'planner_run_item', referenceId: itemId,
      }).catch(() => {});
    }
    if (mediaAssetId != null) {
      await mediaRepository.attachMediaReference({
        userId, mediaAssetId, referenceType: 'planner_run_item', referenceId: itemId,
      }).catch(() => {});
    }

    const updated = await runsRepo.updateItem(itemId, userId, { mediaAssetId: mediaAssetId ?? null });
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
  async function regenerateItem(userId, itemId, target, opts = {}) {
    const key = `${userId}:${itemId}:${target}`;
    if (inFlightRegenerations.has(key)) {
      throw new ConflictError('This post is already being regenerated. Wait for it to finish.');
    }
    const run = runRegeneration(userId, itemId, target, opts)
      .finally(() => inFlightRegenerations.delete(key));
    inFlightRegenerations.set(key, run);
    return run;
  }

  async function runRegeneration(userId, itemId, target, { force = false, req } = {}) {
    const item = await requireItem(userId, itemId);
    if (item.approvalStatus === PLANNER_ITEM_STATUS.QUEUED) {
      throw new ConflictError('This post is already queued. Edit it from the queue instead.');
    }
    await assertItemMatchesRunPlatforms(userId, item);
    const profile = await businessProfiles.findByUserId(userId);
    const edited = new Set(item.editedFields || []);

    if (target === 'caption') {
      if (edited.has('caption') && !force) {
        throw new ConflictError('You have edited this caption. Regenerating would discard your changes — confirm to continue.');
      }
      if (!(await openaiContentService.isAvailable(userId))) {
        throw new ConflictError('Add and verify your OpenAI API key in Integrations before using AI generation.');
      }
      await assertUnderDailyLimit(userId, 1);

      const siblings = await runsRepo.listItemsForRun(item.plannerRunId, userId);
      const others = siblings.filter((s) => s.id !== item.id);
      const avoidPhrases = others.map((s) => s.headline).filter(Boolean);
      // Openings already used elsewhere in this plan, plus this item's own
      // previous opening: a retry must not simply reword what failed.
      const avoidOpenings = [
        ...others.map((s) => s.fingerprint?.openingText).filter(Boolean),
        item.fingerprint?.openingText,
      ].filter(Boolean);

      /*
       * Tell the retry exactly why the last attempt failed, and what not to
       * repeat. Without this a retry is an unguided re-roll of the same prompt
       * that produced the defect, which is how a user ends up clicking Retry
       * four times and getting four failures.
       */
      const priorReasons = [
        ...(Array.isArray(item.qualityFailures) ? item.qualityFailures : []),
        ...(item.duplicationNotes ? [item.duplicationNotes] : []),
      ];
      const primaryPlatform = item.platformTargets[0];

      /*
       * Repair what is broken, and nothing else — but only when something IS
       * broken.
       *
       * Two different user intents arrive here. "Regenerate post copy" in the
       * drawer means "write me a fresh post", and it must keep refreshing the
       * headline and the rest. "Retry generation" on a failed card means "this
       * did not work, fix it", and the minimal correct answer is to rewrite the
       * copy that failed and leave everything else exactly as it is — including
       * the headline, because the headline is what the EXISTING image renders,
       * and changing one without the other would make the picture disagree with
       * the post.
       *
       * The item's status already separates them: Retry only exists on a
       * hard-failed card. So a repair is scoped to hard-failed items, and only
       * when the damage is genuinely platform-local.
       *
       * A duplicate is excluded because it is an ITEM problem, not a platform
       * one: the post repeats another post, so the angle itself has to change
       * and every platform follows the new one. Narrowing that to a single
       * platform would leave the repetition exactly where it was.
       */
      const isRetryOfFailure = item.qualityStatus === PLANNER_QUALITY_STATUS.GENERATION_FAILED
        || item.approvalStatus === PLANNER_ITEM_STATUS.GENERATION_FAILED;
      const duplicateProblem = Boolean(item.duplicationNotes)
        || (item.duplicationScore ?? 0) >= DUPLICATION_THRESHOLDS.REGENERATE;
      const failing = isRetryOfFailure && !duplicateProblem ? failingPlatforms(item) : new Map();

      /*
       * A platform the user wrote by hand is not overwritten without a yes.
       *
       * This is the ONE overwrite-confirmation guard, placed where both paths
       * pass through it. A repair rewrites only the failing platforms; a full
       * regeneration rewrites all of them — so the set to protect is exactly the
       * set about to be rewritten. A user-edited platform in that set, without
       * force, throws here, BEFORE the model is reached: declining costs no
       * OpenAI call, no usage record and no revision. A user-edited SIBLING that
       * is not being rewritten is never in the set and never asks.
       *
       * The legacy edited.has('caption') guard above still covers the primary
       * for pre-C2 items that have no per-platform userEdited flag.
       */
      if (!force) {
        const rewritten = failing.size > 0 ? [...failing.keys()] : item.platformTargets;
        const editedTargets = rewritten.filter((p) => item.platformCaptions?.[p]?.userEdited === true);
        if (editedTargets.length) {
          const names = editedTargets.map((p) => PLATFORM_LABELS[p] ?? p).join(' and ');
          throw new ConflictError(
            `You edited the ${names} copy by hand. Regenerating replaces your version. Confirm to continue.`,
          );
        }
      }

      if (failing.size > 0) {
        return repairFailingPlatforms({
          userId, item, profile, failing, avoidPhrases, avoidOpenings, force, edited, req,
        });
      }

      const content = await openaiContentService.generatePlannerPost(
        {
          platform: primaryPlatform,
          format: item.contentFormat ?? item.contentType,
          contentType: item.contentType,
          goal: item.goal,
          tone: 'professional',
          brief: item.brief,
          brandName: profile?.businessName ?? null,
          businessCategory: profile?.businessCategory ?? null,
          businessDescription: profile?.businessDescription ?? null,
          // The service is already named inside `item.brief`, which is the text
          // the writer works from; there is no separate service column.
          audienceProblem: item.audienceProblem ?? null,
          website: displayWebsite(profile?.websiteUrl),
          language: profile?.defaultLanguage ?? null,
          callToAction: profile?.defaultCallToAction ?? null,
          hashtagPreference: 'moderate',
          avoidPhrases,
          avoidOpenings,
          styleIssues: priorReasons,
          targetBand: targetBandFor(primaryPlatform, 0),
        },
        { userId },
      );

      /*
       * The duplicate comparison, with THIS item excluded by id.
       *
       * Comparing a regeneration against its own stored fingerprint is comparing
       * it against itself: same pillar, same service, same format, same
       * template, same hashtags, because it is the same item. Those soft axes
       * all matched and produced "Too similar to a recent post: a similar angle,
       * the same hashtags, the same writing format" — a post condemned by its
       * identity while its actual words scored 0.21 similar.
       *
       * Everything else still counts: siblings in this run, other runs, the
       * user's recent history. The lookback is also time-bounded now, matching
       * generation, which it silently was not.
       */
      const recent = await runsRepo.listRecentFingerprintsForUser(userId, {
        limit: PLANNER_LIMITS.DUPLICATE_LOOKBACK_ITEMS,
        sinceUtc: addSecondsUtc(-PLANNER_LIMITS.DUPLICATE_LOOKBACK_DAYS * 24 * 3600, now()),
        excludeItemId: item.id,
      });
      /*
       * The candidate carries its FULL identity now (service, CTA, format,
       * pillar). That makes the comparison against OTHER posts accurate rather
       * than accidentally lenient — which is only safe because this item is no
       * longer in the candidate set.
       */
      const candidate = {
        caption: content.caption,
        headline: content.headline,
        hashtags: content.hashtags,
        cta: profile?.defaultCallToAction ?? null,
        contentType: item.contentType,
        format: item.contentFormat ?? item.contentType,
        pillar: item.contentPillar ?? null,
        goal: item.goal,
        // The item has no service column; its normalized service lives in the
        // fingerprint, which is the same form every other fingerprint stores.
        serviceEmphasis: item.fingerprint?.serviceEmphasis ?? null,
        audienceProblem: item.audienceProblem ?? null,
        templateKey: item.templateKey,
      };
      const evaluation = uniqueness.evaluate(candidate, { batch: [], recent });

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

      /*
       * Rewrite the OTHER platforms too.
       *
       * The retry used to write only `generated_caption` and leave
       * `platform_captions_json` untouched. Those are two sources of truth for
       * the same text, and they diverged the moment a retry ran: the board
       * showed the new copy while the drawer and, far worse, the QUEUE still
       * held the old one. A retried post would have published its pre-retry
       * text. Regenerating every target platform keeps the two in step, and
       * `platformCaptionsFor()` stays the single canonical resolver.
       *
       * Sibling platforms are not "preserved" here in the sense of keeping stale
       * text: the primary copy changed, so a Threads post written against the
       * OLD primary would no longer belong to this post at all.
       */
      const { platformCaptions, platformIdenticalNotes } = await generatePlatformCopy({
        userId,
        brief: {
          platforms: item.platformTargets,
          format: item.contentFormat ?? item.contentType,
          contentType: item.contentType,
          goal: item.goal,
          tone: 'professional',
          brief: item.brief,
          serviceEmphasis: null,
          audienceProblem: item.audienceProblem ?? null,
          location: null,
          callToAction: profile?.defaultCallToAction ?? null,
        },
        profile,
        primaryPlatform,
        primary: content,
      });

      const hardFailed = stillFailing || platformIdenticalNotes.length > 0;
      const failures = [
        ...retryRejections,
        ...platformIdenticalNotes,
        ...(evaluation.score >= HARD_DUPLICATE_SCORE ? ['this post is a near-duplicate of another one'] : []),
      ];

      const fields = {
        caption: content.caption,
        hashtags: content.hashtags,
        summary: content.summary,
        // NULL for a single-platform plan, exactly as generation writes it, so
        // the resolver's fallback to `caption` behaves identically either way.
        platformCaptions,
        regenerationCount: item.regenerationCount + 1,
        duplicationScore: evaluation.score,
        duplicationNotes: evaluation.verdict === 'unique' ? null : uniqueness.describe(evaluation),
        // The fingerprint must describe the copy that is actually stored. A
        // stale one would poison the NEXT comparison with text that no longer
        // exists anywhere.
        fingerprint: {
          ...uniqueness.fingerprint(candidate),
          visualExtras: item.fingerprint?.visualExtras ?? null,
        },
        qualityStatus: hardFailed
          ? PLANNER_QUALITY_STATUS.GENERATION_FAILED
          : PLANNER_QUALITY_STATUS.NEEDS_REVIEW,
        qualityFailures: hardFailed ? failures.slice(0, 8) : null,
        approvalStatus: hardFailed
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
      // A full regeneration is a real state change per platform: record it, so
      // the timeline shows the rewrite the same way a targeted repair does.
      await recordItemRevisions(userId, updated, 'retry');
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
    // An approval snapshot: what each platform said at the moment it was approved.
    if (status === PLANNER_ITEM_STATUS.APPROVED) await recordItemRevisions(userId, updated, 'approved');
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
      const savedItem = await runsRepo.updateItem(item.id, userId, { approvalStatus: status });
      // eslint-disable-next-line no-await-in-loop
      if (status === PLANNER_ITEM_STATUS.APPROVED) await recordItemRevisions(userId, savedItem, 'approved');
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
      /*
       * A post the generator could not write never reaches the queue.
       *
       * Reaching here requires approvalStatus APPROVED, and both approval paths
       * already refuse a hard-failed item — so this is defence in depth rather
       * than a known hole. It is worth having because the two fields can only
       * disagree through a bug, and the consequence of that bug would be
       * queueing invalid copy for a future publishing phase. Gated on
       * qualityStatus, the engine's RECORD of what happened, because
       * approvalStatus is a thing the user can move.
       */
      if (item.qualityStatus === PLANNER_QUALITY_STATUS.GENERATION_FAILED) {
        skipped.push({ id: item.id, reason: 'generation failed, needs a retry or an edit' });
        continue;
      }
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
      // The copy as it went into the queue, per platform. `item` here still
      // carries platformCaptions and caption, which is what was just queued.
      // eslint-disable-next-line no-await-in-loop
      await recordItemRevisions(userId, item, 'queued');
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

  /**
   * Generate ONE item for a content-automation slot into an existing backing
   * run, reusing the exact planner generation path (dedup, style guard,
   * per-platform copy, image, revisions). The automation slot-generation worker
   * calls this; it never queues or publishes.
   *
   * Ownership: the run must belong to userId. The automation's frozen settings on
   * the run (platforms, rhythm, tone) are authoritative — a later preference
   * change cannot rewrite it. Returns { item } (decorated) or { item: null } when
   * generation produced nothing (a transient miss the worker retries).
   */
  async function generateAutomationSlotItem({ userId, runId, slot }) {
    const run = await runsRepo.findRunByIdForUser(runId, userId);
    if (!run) throw new NotFoundError('Automation run not found');
    const profile = await businessProfiles.findByUserId(userId).catch(() => null);

    const settings = run.settings || {};
    const platforms = Array.isArray(settings.platforms) ? settings.platforms : [];
    if (!platforms.length) throw new ValidationError('The automation has no selected platforms');

    const rhythm = run.resolvedRhythm || resolveRhythm({ preset: settings.rhythmPreset });
    const preferences = {
      goals: settings.goals ?? DEFAULT_GOALS,
      contentMix: settings.contentMix ?? DEFAULT_CONTENT_MIX,
      tone: settings.tone ?? null,
      ctaMode: settings.ctaMode ?? null,
    };

    const weekday = (() => {
      const d = new Date(`${slot.localDate}T00:00:00Z`);
      const g = d.getUTCDay();
      return g === 0 ? 7 : g;
    })();
    const scheduleSlot = {
      localDate: slot.localDate,
      localTime: slot.localTime,
      weekday,
      scheduledForUtc: slot.scheduledForUtc,
      scheduledForInstant: new Date(`${String(slot.scheduledForUtc).replace(' ', 'T')}Z`),
    };

    const briefs = buildBriefSet({ slots: [scheduleSlot], preferences, profile, platforms, rhythm });
    if (!briefs.length) throw new ValidationError('No brief could be built for this slot');
    const existing = await runsRepo.listItemsForRun(run.id, userId);
    const brief = { ...briefs[0], position: existing.length };

    // The same platform contract the planner enforces: an item can only target
    // platforms the automation selected. This is the no-Facebook-injection guard.
    assertPlatformContract(platforms, [brief]);

    // Recent history (which already includes this run's committed items) drives
    // dedup, so each independently-generated slot stays distinct.
    const recent = await runsRepo.listRecentFingerprintsForUser(userId, {
      limit: PLANNER_LIMITS.DUPLICATE_LOOKBACK_ITEMS,
      sinceUtc: addSecondsUtc(-PLANNER_LIMITS.DUPLICATE_LOOKBACK_DAYS * 24 * 3600, now()),
      excludeRunId: null,
    });
    const wantImages = await imageIntegrationVerified(userId);

    const outcome = await generateOneItem({
      userId, run, brief, profile, batch: [], recent, autoQueue: false, wantImages,
    });
    if (!outcome) return { item: null };
    return { item: await decorateItem(userId, outcome.item) };
  }

  return {
    getPreferences,
    describeWeeklyRhythm,
    savePreferences,
    summarizePlan,
    describeDeletion,
    generatePlan,
    generateAutomationSlotItem,
    getPlan,
    listPlans,
    updateItem,
    getItemRevisions,
    setItemMedia,
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
