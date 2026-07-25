/**
 * src/services/aiStudio/weekService.js
 *
 * A planned week, turned into real posts — durably.
 *
 * WHY A JOB AND NOT A REQUEST. Seven posts is fourteen model calls and seven
 * renders: five to eight minutes. No browser waits that long, and the product
 * says the work must not depend on the app being open. So the request does the
 * one fast, interesting thing — planning the week, which the user then SEES —
 * and each post becomes a durable job the worker picks up. Close the tab and the
 * week still builds.
 *
 * WHERE IT LIVES. A planner run with its items, the same rows the Weekly Board,
 * the queue and publishing already read. Nothing new to migrate, and a week made
 * here is a week the rest of the application understands.
 *
 * Nothing here publishes.
 */

import { JOB_TYPES, PLANNER_RUN_STATUS, PLANNER_ITEM_STATUS, PLANNER_QUALITY_STATUS, IMAGE_RENDER_STATUS, PROVIDER_NAMES } from '../../config/constants.js';
import { toMysqlUtc, addSecondsUtc } from '../../utils/time.js';
import { normalizeProviderError } from '../../utils/providerErrors.js';
import { logProviderFailure } from '../../utils/providerLog.js';
import * as defaultRuns from '../../repositories/plannerRunRepository.js';
import * as defaultJobs from '../../repositories/backgroundJobRepository.js';
import { createMediaLibraryService } from '../mediaLibraryService.js';
import { planWeek, WEEK_LENGTH } from './weekPlanner.js';
import { generateAiPost } from './aiStudioEngine.js';
import { DESIGN_STYLES } from './designPrompts.js';

const DAY_SECONDS = 24 * 60 * 60;

export function createWeekService({
  runs = defaultRuns,
  jobs = defaultJobs,
  mediaLibraryService = createMediaLibraryService(),
  planner = planWeek,
  generatePost = generateAiPost,
  now = () => new Date(),
} = {}) {
  /**
   * Plan a week and enqueue its posts.
   *
   * The plan is made HERE, in the request, on purpose: it takes one call, it is
   * the part the user wants to see, and showing seven ideas immediately is the
   * difference between "something is happening" and a spinner. The slow part —
   * designing and rendering seven posters — is what becomes background work.
   *
   * @returns {Promise<{ runId:string, plan:object[] }>}
   */
  async function startWeek(userId, brand, { timezone = 'UTC' } = {}) {
    const plan = await planner({
      businessName: brand.businessName,
      industry: brand.industry,
      description: brand.description,
      services: brand.services,
      city: brand.city,
      region: brand.region,
      country: brand.country,
      tone: brand.tone,
      imageCount: Array.isArray(brand.images) ? brand.images.filter((i) => i.chosen !== false).length : 0,
    });

    const start = now();
    const run = await runs.createRun({
      userId,
      name: `${brand.businessName || 'Your brand'} — week of ${toMysqlUtc(start).slice(0, 10)}`,
      status: PLANNER_RUN_STATUS.GENERATING,
      startDate: toMysqlUtc(start).slice(0, 10),
      endDate: toMysqlUtc(addSecondsUtc((WEEK_LENGTH - 1) * DAY_SECONDS, start)).slice(0, 10),
      timezone,
      planLength: WEEK_LENGTH,
      postsPerDay: 1,
      /*
       * The brand and the plan are stored ON the run, so every post job builds
       * from exactly what the user confirmed — not from a profile that might be
       * edited while the week is still generating.
       */
      settings: { engine: 'ai_studio', brand, plan },
    });

    for (const entry of plan) {
      // eslint-disable-next-line no-await-in-loop
      await jobs.enqueueJob({
        userId,
        jobType: JOB_TYPES.AI_STUDIO_POST,
        // One job per day of this run: a replayed request cannot double a post.
        idempotencyKey: `ai_studio:${run.id}:day:${entry.day}`,
        payload: { runId: String(run.id), day: entry.day },
        maxAttempts: 3,
      });
    }

    return { runId: String(run.id), plan };
  }

  /**
   * Build ONE post of a week: the poster, the copy, the stored item.
   *
   * Runs as a durable job, so it must be safe to retry: the idempotency key is
   * the day, and a day that already has an item is left alone rather than
   * duplicated.
   */
  async function runPostJob(job) {
    const userId = job.userId;
    const runId = job.payload?.runId;
    const day = Number(job.payload?.day);
    if (!runId || !day) return;

    const run = await runs.findRunByIdForUser(runId, userId);
    if (!run) return;

    const settings = run.settings || {};
    const brand = settings.brand || {};
    const entry = (settings.plan || []).find((p) => p.day === day);
    if (!entry) return;

    // Already built (a retry after a lost lease, say). Never post twice.
    const existing = await runs.listItemsForRun(run.id, userId);
    if (existing.some((it) => it.position === day - 1)) return;

    /*
     * The chosen photographs are counted into the plan (so the strategist knows
     * whether picture-led posts are possible) but are not yet placed ON the
     * poster: the SVG renderer needs the bytes inline, which means fetching and
     * embedding each one. That is the next piece of work, and saying so here is
     * better than passing an argument the designer quietly ignores.
     */
    const post = await generatePost({
      brand: {
        businessName: brand.businessName,
        industry: brand.industry,
        tone: brand.tone,
      },
      colors: {
        primary: brand.primary || '#111827',
        secondary: brand.secondary || '#6b7280',
        accent: brand.accent || '#2563eb',
      },
      font: brand.headingFont || null,
      // The day's own angle is the whole point: it is what makes this post
      // different from the other six.
      angle: [entry.angle, entry.service ? `Service: ${entry.service}` : null, entry.why]
        .filter(Boolean).join('. '),
      // Rotate the three directions so a week does not look like one template
      // printed seven times.
      styleId: DESIGN_STYLES[(day - 1) % DESIGN_STYLES.length].id,
      port: 9700 + (day % 50),
    });

    let mediaAssetId = null;
    let image = {
      imageStatus: IMAGE_RENDER_STATUS.NOT_REQUESTED,
      imageProvider: null,
      imageErrorCategory: null,
      imageErrorCode: null,
      imageErrorMessage: null,
      imageHttpStatus: null,
      imageRetryable: null,
      imageAttemptCount: 0,
      imageLastAttemptAt: null,
    };

    if (post.png) {
      try {
        const asset = await mediaLibraryService.uploadImage(userId, {
          buffer: post.png,
          originalName: `week-${run.id}-day-${day}.png`,
          declaredMime: 'image/png',
        });
        mediaAssetId = asset.id;
        image = {
          ...image,
          imageStatus: IMAGE_RENDER_STATUS.READY,
          imageProvider: PROVIDER_NAMES.AI_STUDIO,
          imageAttemptCount: 1,
          imageLastAttemptAt: toMysqlUtc(now()),
        };
      } catch (err) {
        const pe = normalizeProviderError(err, { provider: PROVIDER_NAMES.MEDIA, operation: 'store_week_poster' });
        logProviderFailure(pe, { jobType: JOB_TYPES.AI_STUDIO_POST, plannerRunId: run.id });
        image = { ...image, imageStatus: IMAGE_RENDER_STATUS.FAILED, imageProvider: PROVIDER_NAMES.AI_STUDIO, imageErrorCategory: pe.category, imageErrorCode: pe.errorCode, imageErrorMessage: pe.userMessage, imageHttpStatus: pe.httpStatus, imageRetryable: pe.retryable, imageAttemptCount: 1, imageLastAttemptAt: toMysqlUtc(now()) };
      }
    } else if (post.imageError) {
      const pe = normalizeProviderError(post.imageError, { provider: PROVIDER_NAMES.AI_STUDIO, operation: 'design_render_poster' });
      logProviderFailure(pe, { jobType: JOB_TYPES.AI_STUDIO_POST, plannerRunId: run.id });
      image = { ...image, imageStatus: IMAGE_RENDER_STATUS.FAILED, imageProvider: PROVIDER_NAMES.AI_STUDIO, imageErrorCategory: pe.category, imageErrorCode: pe.errorCode, imageErrorMessage: pe.userMessage, imageHttpStatus: pe.httpStatus, imageRetryable: pe.retryable, imageAttemptCount: 1, imageLastAttemptAt: toMysqlUtc(now()) };
    }

    const caps = post.copy.captions || {};
    const scheduledFor = toMysqlUtc(addSecondsUtc((day - 1) * DAY_SECONDS, new Date(`${run.startDate}T09:00:00Z`)));

    await runs.createItem({
      plannerRunId: run.id,
      userId,
      position: day - 1,
      scheduledFor,
      originalTimezone: run.timezone,
      contentType: 'educational',
      goal: 'awareness',
      // Everything a week can go to. The accounts are chosen later, and the
      // copy for each platform is already written.
      platformTargets: ['facebook', 'instagram', 'threads'],
      aspectRatio: 'square',
      backgroundStyle: 'light',
      qualityStatus: PLANNER_QUALITY_STATUS.PASSED,
      headline: post.copy.headline || null,
      subheadline: post.copy.subtext || null,
      caption: caps.facebook || caps.instagram || caps.threads || '',
      hashtags: post.copy.hashtags || [],
      platformCaptions: {
        facebook: { caption: caps.facebook || '', hashtags: post.copy.hashtags || [] },
        instagram: { caption: caps.instagram || '', hashtags: post.copy.hashtags || [] },
        threads: { caption: caps.threads || '', hashtags: post.copy.hashtags || [] },
      },
      altText: post.copy.headline ? `${brand.businessName || 'Brand'}: ${post.copy.headline}` : null,
      brief: entry.angle,
      mediaAssetId,
      ...image,
      // A week is reviewed before anything is scheduled — never auto-approved.
      approvalStatus: PLANNER_ITEM_STATUS.NEEDS_REVIEW,
      fingerprint: {
        engine: 'ai_studio',
        day,
        job: entry.job,
        angle: entry.angle,
        service: entry.service,
        headlineNormalized: String(post.copy.headline || '').toLowerCase().trim(),
      },
      editedFields: [],
    });

    /*
     * The week is finished when every planned day has a post, and what it
     * becomes is REVIEW — not "done". The product says the user checks the week
     * before anything is scheduled, and the run status is where the rest of the
     * application reads that from.
     */
    const after = await runs.listItemsForRun(run.id, userId);
    if (after.length >= (settings.plan || []).length) {
      await runs.updateRun(run.id, userId, { status: PLANNER_RUN_STATUS.REVIEW }).catch(() => {});
    }
  }

  /** Progress for the studio screen: the plan, and what has been built. */
  async function getWeek(userId, runId) {
    const run = await runs.findRunByIdForUser(runId, userId);
    if (!run) return null;
    const items = await runs.listItemsForRun(run.id, userId);
    const plan = run.settings?.plan || [];
    return {
      runId: String(run.id),
      status: run.status,
      total: plan.length || WEEK_LENGTH,
      ready: items.length,
      plan,
      items,
    };
  }

  const handlers = { [JOB_TYPES.AI_STUDIO_POST]: runPostJob };

  return { startWeek, runPostJob, getWeek, handlers };
}

export const weekService = createWeekService();
export default createWeekService;
