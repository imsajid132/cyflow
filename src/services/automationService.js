/**
 * Content automations: the ongoing configuration, the rolling buffer, the
 * lifecycle, and the two durable job handlers (refill, slot-generation).
 *
 * D1 PREPARES AND QUEUES ONLY. Nothing here calls a real provider publishing API;
 * "prepared" content is planner_run_items on the automation's backing run, which
 * the user reviews on the Weekly Board exactly as a hand-made plan.
 *
 * Authority + safety:
 *   - selected platforms/accounts are authoritative; an account whose platform is
 *     not selected is rejected, so an Instagram+Threads automation can never gain
 *     a Facebook target;
 *   - the backing run's frozen settings are the generation snapshot, so editing
 *     future settings never rewrites already-generated items;
 *   - refill and slot jobs are idempotent (deterministic keys), so a duplicated
 *     scheduler tick, a double click, or a worker restart creates no duplicate
 *     slot, post, or provider call;
 *   - ownership is enforced on every read/write; a cross-user id is not-found.
 */

import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import { toMysqlUtc, addSecondsUtc } from '../utils/time.js';
import { isSupportedTimezone } from './timezoneService.js';
import { buildSchedule } from './plannerScheduleService.js';
import { resolveRhythm } from './weeklyRhythmService.js';
import { TransientJobError, PermanentJobError } from './durableJobService.js';
import {
  PLATFORM_VALUES, PLATFORMS, AUTOMATION_STATUS, AUTOMATION_STATUS_TRANSITIONS, AUTOMATION_MODES,
  MISSED_POST_POLICIES, FAILURE_POLICIES, AUTOMATION_LIMITS, JOB_TYPES, SLOT_STATUS, RHYTHM_PRESETS,
  EVENT_TYPES,
} from '../config/constants.js';

import * as defaultAutomations from '../repositories/automationRepository.js';
import * as defaultJobs from '../repositories/backgroundJobRepository.js';
import * as defaultRuns from '../repositories/plannerRunRepository.js';
import * as defaultSocialAccounts from '../repositories/socialAccountRepository.js';
import { plannerService as defaultPlanner } from './plannerService.js';
import { openaiContentService as defaultOpenAI } from './openaiContentService.js';
import { socialImageService as defaultImages } from './socialImageService.js';
import { loggingService as defaultLogging } from './loggingService.js';

const ACCOUNT_TYPE_TO_PLATFORM = Object.freeze({
  facebook_page: PLATFORMS.FACEBOOK,
  instagram_professional: PLATFORMS.INSTAGRAM,
  threads_profile: PLATFORMS.THREADS,
});
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createAutomationService({
  automations = defaultAutomations,
  jobs = defaultJobs,
  runsRepo = defaultRuns,
  socialAccounts = defaultSocialAccounts,
  planner = defaultPlanner,
  openai = defaultOpenAI,
  images = defaultImages,
  logging = defaultLogging,
  config = { worker: { maxAttempts: 5, refillIntervalHours: 6 } },
  now = () => new Date(),
} = {}) {
  const refillIntervalHours = config?.worker?.refillIntervalHours ?? 6;
  const maxAttempts = config?.worker?.maxAttempts ?? 5;

  // --- validation -----------------------------------------------------------

  async function validateConfig(userId, input, { partial = false } = {}) {
    const errors = [];
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(input, k);

    if (!partial || has('name')) {
      const name = input.name == null ? null : String(input.name).trim().slice(0, AUTOMATION_LIMITS.MAX_NAME_LENGTH);
      out.name = name || null;
    }
    if (!partial || has('mode')) {
      if (!AUTOMATION_MODES.includes(input.mode)) errors.push({ field: 'mode', message: 'Choose a valid mode' });
      else out.mode = input.mode;
    }
    if (!partial || has('timezone')) {
      if (typeof input.timezone !== 'string' || !isSupportedTimezone(input.timezone)) {
        errors.push({ field: 'timezone', message: 'Choose a valid timezone' });
      } else out.timezone = input.timezone;
    }
    if (!partial || has('selectedWeekdays')) {
      const wd = Array.isArray(input.selectedWeekdays) ? input.selectedWeekdays.map(Number) : [];
      const clean = [...new Set(wd)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
      if (!clean.length || clean.length > AUTOMATION_LIMITS.MAX_WEEKDAYS) {
        errors.push({ field: 'selectedWeekdays', message: 'Choose at least one weekday' });
      } else out.selectedWeekdays = clean;
    }
    if (!partial || has('postingTimes')) {
      const times = Array.isArray(input.postingTimes) ? input.postingTimes.map((t) => String(t)) : [];
      const clean = [...new Set(times)].filter((t) => TIME_RE.test(t)).sort();
      if (!clean.length || clean.length > AUTOMATION_LIMITS.MAX_TIMES_PER_DAY) {
        errors.push({ field: 'postingTimes', message: 'Add between one and five valid HH:MM times' });
      } else out.postingTimes = clean;
    }
    if (!partial || has('postsPerDay')) {
      const n = Number(input.postsPerDay);
      if (!Number.isInteger(n) || n < AUTOMATION_LIMITS.MIN_POSTS_PER_DAY || n > AUTOMATION_LIMITS.MAX_POSTS_PER_DAY) {
        errors.push({ field: 'postsPerDay', message: 'Posts per day is out of range' });
      } else out.postsPerDay = n;
    }
    // posts per day cannot exceed the number of times supplied
    if (out.postsPerDay != null && out.postingTimes != null && out.postsPerDay > out.postingTimes.length) {
      errors.push({ field: 'postsPerDay', message: 'Posts per day cannot exceed the number of posting times' });
    }
    if (!partial || has('rhythmKey')) {
      if (input.rhythmKey != null && !RHYTHM_PRESETS.includes(input.rhythmKey)) {
        errors.push({ field: 'rhythmKey', message: 'Invalid weekly rhythm' });
      } else out.rhythmKey = input.rhythmKey ?? null;
    }
    if (!partial || has('selectedPlatforms')) {
      const plats = Array.isArray(input.selectedPlatforms) ? [...new Set(input.selectedPlatforms)] : [];
      const clean = plats.filter((p) => PLATFORM_VALUES.includes(p));
      if (!clean.length || clean.length !== plats.length) {
        errors.push({ field: 'selectedPlatforms', message: 'Choose at least one supported platform' });
      } else out.selectedPlatforms = clean;
    }
    if (!partial || has('selectedAccountIds')) {
      /*
       * Deduplicated, like selectedPlatforms, selectedWeekdays and postingTimes
       * beside it. This was the one selection field that kept repeats: sending
       * the same page id twice stored it twice, and the automation would then
       * publish to that one page twice per slot. A double-submitted wizard or a
       * repeated checkbox event is enough to produce it.
       */
      out.selectedAccountIds = [...new Set(
        (Array.isArray(input.selectedAccountIds) ? input.selectedAccountIds : []).map(String),
      )];
    }
    if (!partial || has('generationHorizonDays')) {
      const n = Number(input.generationHorizonDays ?? AUTOMATION_LIMITS.DEFAULT_HORIZON_DAYS);
      if (!Number.isInteger(n) || n < AUTOMATION_LIMITS.MIN_HORIZON_DAYS || n > AUTOMATION_LIMITS.MAX_HORIZON_DAYS) {
        errors.push({ field: 'generationHorizonDays', message: `Horizon must be ${AUTOMATION_LIMITS.MIN_HORIZON_DAYS}-${AUTOMATION_LIMITS.MAX_HORIZON_DAYS} days` });
      } else out.generationHorizonDays = n;
    }
    if (!partial || has('minimumReadyDays')) {
      out.minimumReadyDays = Number(input.minimumReadyDays ?? AUTOMATION_LIMITS.DEFAULT_MIN_READY_DAYS);
    }
    if (!partial || has('lowBufferDays')) {
      out.lowBufferDays = Number(input.lowBufferDays ?? AUTOMATION_LIMITS.DEFAULT_LOW_BUFFER_DAYS);
    }
    // buffer ordering: low <= min <= horizon
    const horizon = out.generationHorizonDays ?? input.generationHorizonDays ?? AUTOMATION_LIMITS.DEFAULT_HORIZON_DAYS;
    if (out.minimumReadyDays != null && (out.minimumReadyDays < AUTOMATION_LIMITS.MIN_READY_DAYS || out.minimumReadyDays > horizon)) {
      errors.push({ field: 'minimumReadyDays', message: 'Minimum ready days must be between 1 and the horizon' });
    }
    if (out.lowBufferDays != null && out.minimumReadyDays != null && (out.lowBufferDays < 1 || out.lowBufferDays > out.minimumReadyDays)) {
      errors.push({ field: 'lowBufferDays', message: 'Low-buffer warning must be between 1 and minimum ready days' });
    }
    if (!partial || has('missedPostPolicy')) {
      if (!MISSED_POST_POLICIES.includes(input.missedPostPolicy)) errors.push({ field: 'missedPostPolicy', message: 'Invalid missed-post policy' });
      else out.missedPostPolicy = input.missedPostPolicy;
    }
    if (!partial || has('failurePolicy')) {
      const fp = input.failurePolicy ?? 'pause';
      if (!FAILURE_POLICIES.includes(fp)) errors.push({ field: 'failurePolicy', message: 'Invalid failure policy' });
      else out.failurePolicy = fp;
    }
    if (has('startDate')) {
      if (input.startDate != null && !DATE_RE.test(String(input.startDate))) errors.push({ field: 'startDate', message: 'Invalid start date' });
      else out.startDate = input.startDate ?? null;
    }
    if (has('endDate')) {
      if (input.endDate != null && !DATE_RE.test(String(input.endDate))) errors.push({ field: 'endDate', message: 'Invalid end date' });
      else out.endDate = input.endDate ?? null;
    }

    if (errors.length) throw new ValidationError('Validation failed', errors);

    // Account ownership + platform match. Connected != selected; every selected
    // account must be owned, active, and of a SELECTED platform. And each selected
    // platform must have at least one selected account.
    if (out.selectedAccountIds != null || out.selectedPlatforms != null) {
      const platforms = out.selectedPlatforms ?? [];
      const accountIds = out.selectedAccountIds ?? [];
      const owned = await socialAccounts.listAccountsForUser(userId);
      const byId = new Map(owned.map((a) => [String(a.id), a]));
      const coveredPlatforms = new Set();
      for (const id of accountIds) {
        const acct = byId.get(String(id));
        if (!acct || acct.status !== 'active') {
          throw new ValidationError('Validation failed', [{ field: 'selectedAccountIds', message: 'One of the selected accounts is not connected' }]);
        }
        const platform = ACCOUNT_TYPE_TO_PLATFORM[acct.accountType];
        if (!platforms.includes(platform)) {
          throw new ValidationError('Validation failed', [{ field: 'selectedAccountIds', message: 'A selected account is not one of the selected platforms' }]);
        }
        coveredPlatforms.add(platform);
      }
      for (const platform of platforms) {
        if (!coveredPlatforms.has(platform)) {
          throw new ValidationError('Validation failed', [{ field: 'selectedAccountIds', message: `Select at least one ${platform} account` }]);
        }
      }
    }
    return out;
  }

  /** The immutable snapshot frozen onto future slots (and the backing run). */
  function buildSnapshot(cfg) {
    return {
      platforms: cfg.selectedPlatforms,
      accountIds: cfg.selectedAccountIds,
      timezone: cfg.timezone,
      weekdays: cfg.selectedWeekdays,
      times: cfg.postingTimes,
      postsPerDay: cfg.postsPerDay,
      rhythmPreset: cfg.rhythmKey || 'balanced',
      mode: cfg.mode,
    };
  }

  // --- CRUD -----------------------------------------------------------------

  async function createAutomation(userId, input, { req } = {}) {
    const cfg = await validateConfig(userId, input, { partial: false });
    const snapshot = buildSnapshot(cfg);
    const created = await automations.createAutomation({
      userId, name: cfg.name, status: AUTOMATION_STATUS.DRAFT, mode: cfg.mode, timezone: cfg.timezone,
      selectedWeekdays: cfg.selectedWeekdays, postingTimes: cfg.postingTimes, postsPerDay: cfg.postsPerDay,
      rhythmKey: cfg.rhythmKey, selectedPlatforms: cfg.selectedPlatforms, selectedAccountIds: cfg.selectedAccountIds,
      startDate: cfg.startDate ?? null, endDate: cfg.endDate ?? null,
      generationHorizonDays: cfg.generationHorizonDays, minimumReadyDays: cfg.minimumReadyDays,
      lowBufferDays: cfg.lowBufferDays, missedPostPolicy: cfg.missedPostPolicy, failurePolicy: cfg.failurePolicy,
      configSnapshot: snapshot,
    });
    await record(EVENT_TYPES.AUTOMATION_CREATED, { req, userId, automationId: created.id, message: 'Automation created' });
    return toPublic(created);
  }

  async function requireOwned(userId, id) {
    const a = await automations.findAutomationByIdForUser(id, userId);
    if (!a) throw new NotFoundError('Automation not found');
    return a;
  }

  async function listAutomations(userId) {
    const rows = await automations.listAutomationsForUser(userId);
    const out = [];
    for (const a of rows) out.push(await toPublic(a));
    return out;
  }

  async function getAutomation(userId, id) {
    return toPublic(await requireOwned(userId, id));
  }

  async function updateFutureSettings(userId, id, input, { req } = {}) {
    const a = await requireOwned(userId, id);
    if (a.status === AUTOMATION_STATUS.STOPPED) throw new ConflictError('A stopped automation cannot be edited');
    const cfg = await validateConfig(userId, { ...currentConfig(a), ...input }, { partial: false });
    const snapshot = buildSnapshot(cfg);
    const updated = await automations.updateAutomation(id, userId, {
      name: cfg.name, mode: cfg.mode, timezone: cfg.timezone, selectedWeekdays: cfg.selectedWeekdays,
      postingTimes: cfg.postingTimes, postsPerDay: cfg.postsPerDay, rhythmKey: cfg.rhythmKey,
      selectedPlatforms: cfg.selectedPlatforms, selectedAccountIds: cfg.selectedAccountIds,
      startDate: cfg.startDate ?? null, endDate: cfg.endDate ?? null,
      generationHorizonDays: cfg.generationHorizonDays, minimumReadyDays: cfg.minimumReadyDays,
      lowBufferDays: cfg.lowBufferDays, missedPostPolicy: cfg.missedPostPolicy, failurePolicy: cfg.failurePolicy,
      configSnapshot: snapshot,
    });
    // New settings apply to FUTURE ungenerated slots only. If the backing run
    // exists, refresh its frozen generation settings for slots not yet generated;
    // already-generated items keep the config they were made with.
    if (updated.plannerRunId) {
      await runsRepo.updateRun(updated.plannerRunId, userId, { settings: runSettings(updated), resolvedRhythm: resolveRhythm({ preset: snapshot.rhythmPreset }) }).catch(() => {});
    }
    await record(EVENT_TYPES.AUTOMATION_UPDATED, { req, userId, automationId: id, message: 'Automation settings updated' });
    return toPublic(updated);
  }

  function currentConfig(a) {
    return {
      name: a.name, mode: a.mode, timezone: a.timezone, selectedWeekdays: a.selectedWeekdays,
      postingTimes: a.postingTimes, postsPerDay: a.postsPerDay, rhythmKey: a.rhythmKey,
      selectedPlatforms: a.selectedPlatforms, selectedAccountIds: a.selectedAccountIds,
      startDate: a.startDate, endDate: a.endDate, generationHorizonDays: a.generationHorizonDays,
      minimumReadyDays: a.minimumReadyDays, lowBufferDays: a.lowBufferDays,
      missedPostPolicy: a.missedPostPolicy, failurePolicy: a.failurePolicy,
    };
  }

  // --- lifecycle ------------------------------------------------------------

  function assertTransition(a, to) {
    const allowed = AUTOMATION_STATUS_TRANSITIONS[a.status] || [];
    if (!allowed.includes(to)) {
      throw new ConflictError(`An automation that is ${a.status} cannot become ${to}`);
    }
  }

  async function ensureBackingRun(a, userId) {
    if (a.plannerRunId) {
      const run = await runsRepo.findRunByIdForUser(a.plannerRunId, userId);
      if (run) return run;
    }
    const run = await runsRepo.createRun({
      userId, contentAutomationId: a.id, businessProfileId: a.businessProfileId,
      name: a.name ? `Automation: ${a.name}` : 'Content automation',
      status: 'review', timezone: a.timezone,
      startDate: a.startDate ?? null, endDate: a.endDate ?? null,
      planLength: a.generationHorizonDays, postsPerDay: a.postsPerDay,
      settings: runSettings(a), resolvedRhythm: resolveRhythm({ preset: a.rhythmKey || 'balanced' }),
    });
    await automations.updateAutomation(a.id, userId, { plannerRunId: run.id });
    a.plannerRunId = run.id;
    return run;
  }

  function runSettings(a) {
    return {
      cadence: 'selected_weekdays', times: a.postingTimes, weekdays: a.selectedWeekdays,
      postsPerDay: a.postsPerDay, platforms: a.selectedPlatforms, timezone: a.timezone,
      rhythmPreset: a.rhythmKey || 'balanced',
    };
  }

  async function activate(userId, id, { req } = {}) {
    const a = await requireOwned(userId, id);
    if (a.status === AUTOMATION_STATUS.ACTIVE) return toPublic(a);
    assertTransition(a, AUTOMATION_STATUS.ACTIVE);
    await ensureBackingRun(a, userId);
    await automations.updateAutomation(id, userId, {
      status: AUTOMATION_STATUS.ACTIVE, attentionReason: null, nextRefillAt: now(), stoppedAt: null,
    });
    await enqueueRefill(userId, id);
    await record(EVENT_TYPES.AUTOMATION_ACTIVATED, { req, userId, automationId: id, message: 'Automation activated' });
    return getAutomation(userId, id);
  }

  async function pause(userId, id, { req } = {}) {
    const a = await requireOwned(userId, id);
    assertTransition(a, AUTOMATION_STATUS.PAUSED);
    await automations.updateAutomation(id, userId, { status: AUTOMATION_STATUS.PAUSED, nextRefillAt: null });
    await jobs.cancelJobsForAutomation({ automationId: id, userId });
    await record(EVENT_TYPES.AUTOMATION_PAUSED, { req, userId, automationId: id, message: 'Automation paused' });
    return getAutomation(userId, id);
  }

  async function resume(userId, id, { req } = {}) {
    const a = await requireOwned(userId, id);
    assertTransition(a, AUTOMATION_STATUS.ACTIVE);
    await ensureBackingRun(a, userId);
    await automations.updateAutomation(id, userId, { status: AUTOMATION_STATUS.ACTIVE, attentionReason: null, nextRefillAt: now() });
    await enqueueRefill(userId, id);
    await record(EVENT_TYPES.AUTOMATION_RESUMED, { req, userId, automationId: id, message: 'Automation resumed' });
    return getAutomation(userId, id);
  }

  async function stop(userId, id, { req } = {}) {
    const a = await requireOwned(userId, id);
    if (a.status === AUTOMATION_STATUS.STOPPED) return toPublic(a);
    await automations.updateAutomation(id, userId, {
      status: AUTOMATION_STATUS.STOPPED, nextRefillAt: null, stoppedAt: now(), attentionReason: null,
    });
    await jobs.cancelJobsForAutomation({ automationId: id, userId });
    const today = todayInZone(a.timezone);
    await automations.cancelFutureSlots(id, userId, today).catch(() => {});
    await record(EVENT_TYPES.AUTOMATION_STOPPED, { req, userId, automationId: id, message: 'Automation stopped' });
    return getAutomation(userId, id);
  }

  async function refillNow(userId, id, { req } = {}) {
    const a = await requireOwned(userId, id);
    if (![AUTOMATION_STATUS.ACTIVE, AUTOMATION_STATUS.ATTENTION_NEEDED].includes(a.status)) {
      throw new ConflictError('Only an active automation can be refilled');
    }
    const { created } = await enqueueRefill(userId, id);
    return { enqueued: created };
  }

  async function enqueueRefill(userId, id) {
    const bucket = toMysqlUtc(now()).slice(0, 16); // minute bucket -> double-click safe
    return jobs.enqueueJob({
      userId, automationId: id, jobType: JOB_TYPES.AUTOMATION_REFILL,
      idempotencyKey: `automation:${id}:refill:${bucket}`, payload: { automationId: id }, maxAttempts,
    });
  }

  /**
   * The scheduler tick (cross-user, system-level): enqueue an idempotent refill
   * job for every active automation whose buffer is due, and push its next-refill
   * time forward so the next tick does not pile up. Called by `scheduler:once`.
   */
  async function enqueueDueRefills({ limit = 50 } = {}) {
    const due = await automations.listDueForRefill({ now: now(), limit });
    let enqueued = 0;
    for (const a of due) {
      // eslint-disable-next-line no-await-in-loop
      const { created } = await enqueueRefill(a.userId, a.id);
      // eslint-disable-next-line no-await-in-loop
      await automations.updateAutomation(a.id, a.userId, {
        nextRefillAt: addSecondsUtc(refillIntervalHours * 3600, now()),
      });
      if (created) enqueued += 1;
    }
    return { due: due.length, enqueued };
  }

  // --- reads ----------------------------------------------------------------

  async function listUpcoming(userId, id) {
    const a = await requireOwned(userId, id);
    const today = todayInZone(a.timezone);
    // Enrich each ready slot with its item's headline/copy from the backing run,
    // which the user can open in full on the Weekly Board (/planner/week?run=).
    let itemsById = new Map();
    if (a.plannerRunId) {
      const plan = await planner.getPlan(userId, a.plannerRunId).catch(() => null);
      itemsById = new Map((plan?.items || []).map((it) => [String(it.id), it]));
    }
    const slots = await automations.listSlotsForAutomation(id, userId, { statuses: [SLOT_STATUS.READY], fromLocalDate: today });
    return slots.map((slot) => {
      const item = slot.plannerRunItemId ? itemsById.get(String(slot.plannerRunItemId)) : null;
      return {
        slotId: slot.id, localDate: slot.localDate, localTime: slot.localTime,
        scheduledForUtc: slot.scheduledForUtc,
        platformTargets: item?.platformTargets ?? a.selectedPlatforms,
        headline: item?.headline ?? null, media: item?.media ?? null,
      };
    });
  }

  async function listHistory(userId, id) {
    const a = await requireOwned(userId, id);
    const slots = await automations.listSlotsForAutomation(id, userId, {});
    return slots
      .slice(-50)
      .map((s) => ({ localDate: s.localDate, localTime: s.localTime, status: s.status, at: s.updatedAt }));
  }

  async function listFailures(userId, id) {
    await requireOwned(userId, id);
    const slots = await automations.listSlotsForAutomation(id, userId, { statuses: [SLOT_STATUS.FAILED] });
    return slots.map((s) => ({
      localDate: s.localDate, localTime: s.localTime,
      category: s.lastErrorCategory, reason: s.lastErrorMessage,
    }));
  }

  // --- buffer + public shape ------------------------------------------------

  async function computeBuffer(a) {
    if (!a.plannerRunId) return { readyDays: 0, through: null, low: true, ok: false, byStatus: {} };
    const today = todayInZone(a.timezone);
    const stats = await automations.bufferStats(a.id, a.userId, { fromLocalDate: today });
    return {
      readyDays: stats.readyDays, through: stats.through,
      low: stats.readyDays < a.lowBufferDays,
      ok: stats.readyDays >= a.minimumReadyDays,
      byStatus: stats.byStatus,
    };
  }

  async function toPublic(a) {
    const buffer = await computeBuffer(a).catch(() => ({ readyDays: 0, through: null, low: true, ok: false, byStatus: {} }));
    let nextPost = null;
    if (a.plannerRunId) {
      const today = todayInZone(a.timezone);
      const upcoming = await automations.listSlotsForAutomation(a.id, a.userId, { statuses: [SLOT_STATUS.READY], fromLocalDate: today }).catch(() => []);
      if (upcoming.length) nextPost = { localDate: upcoming[0].localDate, localTime: upcoming[0].localTime, scheduledForUtc: upcoming[0].scheduledForUtc };
    }
    return {
      id: a.id, name: a.name, status: a.status, mode: a.mode, timezone: a.timezone,
      selectedPlatforms: a.selectedPlatforms, selectedAccountIds: a.selectedAccountIds,
      selectedWeekdays: a.selectedWeekdays, postingTimes: a.postingTimes, postsPerDay: a.postsPerDay,
      rhythmKey: a.rhythmKey, startDate: a.startDate, endDate: a.endDate,
      generationHorizonDays: a.generationHorizonDays, minimumReadyDays: a.minimumReadyDays,
      lowBufferDays: a.lowBufferDays, missedPostPolicy: a.missedPostPolicy, failurePolicy: a.failurePolicy,
      generatedThroughDate: a.generatedThroughDate, attentionReason: a.attentionReason,
      lastRefillAt: a.lastRefillAt, nextRefillAt: a.nextRefillAt,
      plannerRunId: a.plannerRunId, // used by "View upcoming" -> /planner/week?run=
      createdAt: a.createdAt, stoppedAt: a.stoppedAt,
      readyBufferDays: buffer.readyDays, bufferLow: buffer.low, bufferOk: buffer.ok, nextPost,
    };
  }

  // --- durable job handlers -------------------------------------------------

  /** automation_refill: enqueue only the MISSING future slot jobs. */
  async function runRefillJob(job) {
    const userId = job.userId;
    const a = await automations.findAutomationByIdForUser(job.automationId, userId);
    if (!a) return; // gone
    if (![AUTOMATION_STATUS.ACTIVE, AUTOMATION_STATUS.ATTENTION_NEEDED].includes(a.status)) return; // paused/stopped -> no work

    await record(EVENT_TYPES.AUTOMATION_REFILL_STARTED, { userId, automationId: a.id, message: 'Refill started' });
    const run = await ensureBackingRun(a, userId);

    const schedule = buildSchedule({
      startDate: a.startDate || null, planLength: a.generationHorizonDays,
      cadence: 'selected_weekdays', weekdays: a.selectedWeekdays, times: a.postingTimes,
      postsPerDay: a.postsPerDay, timezone: a.timezone, now: now(),
    });
    let slots = schedule.slots;
    if (a.endDate) slots = slots.filter((s) => s.localDate <= a.endDate);
    slots = slots.slice(0, AUTOMATION_LIMITS.MAX_SLOTS_PER_REFILL);

    let enqueued = 0;
    for (const s of slots) {
      const seq = Math.max(0, a.postingTimes.indexOf(s.localTime));
      const key = `automation:${a.id}:slot:${s.localDate}:${s.localTime}:${seq}`;
      // eslint-disable-next-line no-await-in-loop
      const { slot, created } = await automations.createSlotIfAbsent({
        userId, automationId: a.id, localDate: s.localDate, localTime: s.localTime,
        sequence: seq, scheduledForUtc: s.scheduledForUtc, idempotencyKey: key,
      });
      if (created) {
        // eslint-disable-next-line no-await-in-loop
        await jobs.enqueueJob({
          userId, automationId: a.id, jobType: JOB_TYPES.GENERATE_SLOT,
          idempotencyKey: key, payload: { slotId: slot.id, runId: run.id }, maxAttempts,
        });
        enqueued += 1;
      }
    }

    const today = schedule.startDate;
    const buf = await automations.bufferStats(a.id, userId, { fromLocalDate: today });
    await automations.updateAutomation(a.id, userId, {
      generatedThroughDate: buf.through || a.generatedThroughDate,
      lastRefillAt: toMysqlUtc(now()),
      nextRefillAt: addSecondsUtc(refillIntervalHours * 3600, now()),
    });

    // Buffer is genuinely low and cannot grow (nothing new to enqueue) -> warn.
    if (buf.readyDays < a.lowBufferDays && enqueued === 0) {
      await record(EVENT_TYPES.AUTOMATION_BUFFER_LOW, {
        userId, automationId: a.id, level: 'warn', message: 'Content buffer is low',
        context: { readyDays: buf.readyDays, lowBufferDays: a.lowBufferDays },
      });
    }
    await record(EVENT_TYPES.AUTOMATION_REFILL_COMPLETED, {
      userId, automationId: a.id, message: 'Refill completed', context: { enqueued, readyDays: buf.readyDays },
    });
  }

  /** generate_automation_slot: prepare exactly one item for one slot. */
  async function runSlotJob(job) {
    const userId = job.userId;
    const slotId = job.payload?.slotId;
    const a = await automations.findAutomationByIdForUser(job.automationId, userId);
    if (!a) return;
    const slot = await automations.findSlotByIdForUser(slotId, userId);
    if (!slot || slot.automationId !== a.id) return;
    // Paused/stopped consume ZERO provider usage.
    if (![AUTOMATION_STATUS.ACTIVE, AUTOMATION_STATUS.ATTENTION_NEEDED].includes(a.status)) return;
    if ([SLOT_STATUS.READY, SLOT_STATUS.SKIPPED, SLOT_STATUS.CANCELLED, SLOT_STATUS.FAILED].includes(slot.status)) return;

    // Missed-post policy: the intended time already passed.
    const passed = new Date(`${String(slot.scheduledForUtc).replace(' ', 'T')}Z`).getTime() < now().getTime();
    if (passed && (a.missedPostPolicy === 'skip' || a.missedPostPolicy === 'next_safe_time')) {
      await automations.markSlotStatus(slot.id, userId, SLOT_STATUS.SKIPPED, { message: 'Intended time passed before it was prepared' });
      await record(EVENT_TYPES.AUTOMATION_SLOT_SKIPPED, { userId, automationId: a.id, message: 'Slot skipped (missed window)' });
      return;
    }

    // Precondition: the user's OpenAI integration must be usable. Missing/invalid
    // is a PERMANENT condition — stop, set attention, no repeated provider calls.
    const openaiOk = await openai.isAvailable(userId).catch(() => false);
    if (!openaiOk) {
      await automations.markSlotStatus(slot.id, userId, SLOT_STATUS.FAILED, { category: 'permanent', message: 'OpenAI credentials are not available' });
      await setAttention(a, userId, 'Add and verify your OpenAI API key in Integrations to keep this automation running.');
      throw new PermanentJobError('OpenAI credentials not available');
    }

    await automations.markSlotStatus(slot.id, userId, SLOT_STATUS.GENERATING, {});
    try {
      const { item } = await planner.generateAutomationSlotItem({
        userId, runId: a.plannerRunId,
        slot: { localDate: slot.localDate, localTime: slot.localTime, scheduledForUtc: slot.scheduledForUtc },
      });
      if (!item) {
        // A transient generation miss (provider blip). Retry this job.
        await automations.resetSlotToPlanned(slot.id, userId, { message: 'Generation produced no content; will retry' });
        throw new TransientJobError('Slot generation produced no content');
      }
      await automations.markSlotReady(slot.id, userId, item.id);
      await record(EVENT_TYPES.AUTOMATION_SLOT_PREPARED, { userId, automationId: a.id, message: 'Slot prepared', context: { slotId: slot.id } });
      // Success while in attention means the problem cleared — self-heal.
      if (a.status === AUTOMATION_STATUS.ATTENTION_NEEDED) {
        await automations.updateAutomation(a.id, userId, { status: AUTOMATION_STATUS.ACTIVE, attentionReason: null });
        await record(EVENT_TYPES.AUTOMATION_RECOVERED, { userId, automationId: a.id, message: 'Automation recovered' });
      }
    } catch (err) {
      if (err instanceof PermanentJobError) throw err;
      const lastAttempt = job.attemptCount >= job.maxAttempts;
      if (lastAttempt) {
        await automations.markSlotStatus(slot.id, userId, SLOT_STATUS.FAILED, { category: 'transient', message: safeMsg(err) });
        await record(EVENT_TYPES.AUTOMATION_SLOT_FAILED, { userId, automationId: a.id, level: 'warn', message: 'Slot generation failed', context: { slotId: slot.id } });
      } else {
        await automations.resetSlotToPlanned(slot.id, userId, { message: safeMsg(err) }).catch(() => {});
      }
      if (err instanceof TransientJobError) throw err;
      throw new TransientJobError(safeMsg(err));
    }
  }

  async function setAttention(a, userId, reason) {
    if (a.status === AUTOMATION_STATUS.STOPPED || a.status === AUTOMATION_STATUS.PAUSED) return;
    if (a.failurePolicy !== 'pause') {
      // continue policy: record the reason but keep running.
      await record(EVENT_TYPES.AUTOMATION_ATTENTION_REQUIRED, { userId, automationId: a.id, level: 'warn', message: reason });
      return;
    }
    await automations.updateAutomation(a.id, userId, { status: AUTOMATION_STATUS.ATTENTION_NEEDED, attentionReason: reason });
    await record(EVENT_TYPES.AUTOMATION_ATTENTION_REQUIRED, { userId, automationId: a.id, level: 'warn', message: reason });
  }

  async function record(eventType, { req, userId, automationId = null, level = 'info', message = null, context = null } = {}) {
    await logging.record(eventType, {
      req, userId, level, message,
      context: { ...(context || {}), ...(automationId ? { automationId } : {}) },
    }).catch(() => {});
  }

  /** Handlers map for the durable job service. */
  const handlers = {
    [JOB_TYPES.AUTOMATION_REFILL]: runRefillJob,
    [JOB_TYPES.GENERATE_SLOT]: runSlotJob,
  };

  return {
    createAutomation, listAutomations, getAutomation, updateFutureSettings,
    activate, pause, resume, stop, refillNow,
    listUpcoming, listHistory, listFailures,
    enqueueDueRefills,
    runRefillJob, runSlotJob, handlers,
    _validateConfig: validateConfig,
  };
}

// --- helpers ----------------------------------------------------------------

/** Today's calendar date in an IANA zone as YYYY-MM-DD. */
function todayInZone(timeZone, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    return parts; // en-CA formats as YYYY-MM-DD
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function safeMsg(err) {
  const m = err && typeof err.message === 'string' ? err.message : 'Unknown error';
  return m.length > 500 ? m.slice(0, 500) : m;
}

export default { createAutomationService };
