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
import * as defaultMedia from '../../repositories/mediaAssetRepository.js';
import { createMediaLibraryService } from '../mediaLibraryService.js';
import { planWeek, WEEK_LENGTH } from './weekPlanner.js';
import { generateAiPost, generateAiCopy, designPoster } from './aiStudioEngine.js';
import { DESIGN_STYLES } from './designPrompts.js';
import { fetchPosterPhoto, photoForDay } from './posterPhoto.js';

const DAY_SECONDS = 24 * 60 * 60;

/** The two things a reviewer can ask for again, separately. */
export const REGENERATE = { POSTER: 'poster', CAPTION: 'caption' };

/** Statuses that mean a job has not finished yet, so a second one is refused. */
const IN_FLIGHT = new Set(['pending', 'running', 'retry_scheduled']);

/**
 * `ai_studio:<run>:day:<n>` builds a day; `…:day:<n>:poster:<seq>` and
 * `…:day:<n>:caption:<seq>` redo one piece of it. Parsed rather than assumed:
 * reading the day off the END of the key was right until regeneration made the
 * keys longer, at which point every day would have read as a sequence number.
 */
function parseJobKey(key) {
  const parts = String(key || '').split(':');
  if (parts[0] !== 'ai_studio' || parts[2] !== 'day') return null;
  const day = Number(parts[3]);
  if (!Number.isInteger(day)) return null;
  return { day, kind: parts[4] || null };
}

export function createWeekService({
  runs = defaultRuns,
  jobs = defaultJobs,
  media = defaultMedia,
  mediaLibraryService = createMediaLibraryService(),
  planner = planWeek,
  generatePost = generateAiPost,
  generateCopy = generateAiCopy,
  designOnly = designPoster,
  fetchPhoto = fetchPosterPhoto,
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

    // A regeneration is the same kind of work on an existing day, so it travels
    // as the same job type and lands here.
    if (job.payload?.regenerate) return runRegenerateJob(job);

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
     * A real photograph OF this business, embedded in the poster.
     *
     * This is what the posters were missing. Colour and type alone read as a
     * coloured slide next to a designed post; a picture of the work is what
     * makes it look like the business rather than a template. The bytes have to
     * travel inside the SVG because resvg will not fetch a URL, and fetching is
     * done through the safe path (see posterPhoto.js). A picture that cannot be
     * had is simply absent: a plainer poster beats a lost post.
     */
    const photo = await loadPhoto(brand.images, day);

    const post = await generatePost({
      photo,
      brand: {
        businessName: brand.businessName,
        industry: brand.industry,
        tone: brand.tone,
        websiteUrl: brand.websiteUrl,
        phone: brand.phone,
        city: brand.city,
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
        /*
         * The poster's supporting points, kept so that redesigning it later can
         * rebuild the same content block. They belong to the post's identity as
         * much as its headline does, and there is no column for them; this JSON
         * travels with the item and is ours.
         */
        posterPoints: post.copy.points || [],
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

  /**
   * The day's photograph, fetched and made embeddable — or null.
   *
   * Never throws and never blocks the post: a poster without the picture is
   * plainer, a post that failed because a website was slow is nothing at all.
   */
  async function loadPhoto(images, day) {
    const pick = photoForDay(images, day);
    if (!pick) return null;
    const fetched = await fetchPhoto(pick.url).catch(() => null);
    return fetched ? { ...fetched, alt: pick.alt || '' } : null;
  }

  /** The day's post inside a run, or null. Position is zero-based; days are not. */
  async function findDay(userId, runId, day) {
    const run = await runs.findRunByIdForUser(runId, userId);
    if (!run) return null;
    const items = await runs.listItemsForRun(run.id, userId);
    const item = items.find((it) => (it.position ?? 0) + 1 === day);
    return item ? { run, item } : null;
  }

  /**
   * Ask for one piece of one day again: the poster, or the captions.
   *
   * Two separate asks, because they are two separate dissatisfactions. Someone
   * who does not like the picture does not want the words rewritten as well, and
   * redoing the whole post to change one of them would spend a model call to
   * throw its answer away.
   *
   * It is a durable job, like the original build: a design call plus a render can
   * take a minute, and the product says the work must not depend on the tab
   * staying open. A second request while one is still running is REFUSED rather
   * than queued — an impatient double-click should not buy two posters.
   */
  async function requestRegenerate(userId, runId, day, kind) {
    if (kind !== REGENERATE.POSTER && kind !== REGENERATE.CAPTION) return null;
    const found = await findDay(userId, runId, day);
    if (!found) return null;

    const prefix = `ai_studio:${found.run.id}:day:${day}:${kind}:`;
    const previous = typeof jobs.listJobsByKeyPrefix === 'function'
      ? await jobs.listJobsByKeyPrefix(userId, prefix).catch(() => [])
      : [];
    if (previous.some((j) => IN_FLIGHT.has(j.status))) return { queued: false, alreadyRunning: true };

    await jobs.enqueueJob({
      userId,
      jobType: JOB_TYPES.AI_STUDIO_POST,
      // The sequence makes each ASK its own job while a retry of one ask stays
      // idempotent.
      idempotencyKey: `${prefix}${previous.length + 1}`,
      payload: { runId: String(found.run.id), day, regenerate: kind },
      maxAttempts: 3,
    });

    /*
     * Say so on the item immediately. Between the click and the worker picking
     * the job up, the card would otherwise show the old poster with no sign that
     * anything was happening, and the honest answer is "being redrawn".
     */
    if (kind === REGENERATE.POSTER) {
      await runs.updateItem(found.item.id, userId, { imageStatus: IMAGE_RENDER_STATUS.QUEUED }).catch(() => {});
    }
    return { queued: true, day, kind };
  }

  /** Redo the poster, or the captions, for a day that already exists. */
  async function runRegenerateJob(job) {
    const userId = job.userId;
    const day = Number(job.payload?.day);
    const kind = job.payload?.regenerate;
    const found = await findDay(userId, job.payload?.runId, day);
    if (!found) return;
    const { run, item } = found;

    const brand = run.settings?.brand || {};
    const entry = (run.settings?.plan || []).find((p) => p.day === day) || {};
    const angle = [entry.angle, entry.service ? `Service: ${entry.service}` : null, entry.why]
      .filter(Boolean).join('. ');

    if (kind === REGENERATE.CAPTION) {
      /*
       * New words for the same picture. The poster keeps its headline: those
       * words are SET IN THE IMAGE, and rewriting them here would leave the
       * caption describing a poster that says something else.
       */
      const copy = await generateCopy({
        brand: { businessName: brand.businessName, industry: brand.industry, tone: brand.tone },
        angle,
      });
      const caps = copy.captions || {};
      const hashtags = copy.hashtags || [];
      await runs.updateItem(item.id, userId, {
        caption: caps.facebook || caps.instagram || caps.threads || '',
        hashtags,
        platformCaptions: {
          facebook: { caption: caps.facebook || '', hashtags },
          instagram: { caption: caps.instagram || '', hashtags },
          threads: { caption: caps.threads || '', hashtags },
        },
        regenerationCount: Number(item.regenerationCount || 0) + 1,
      });
      return;
    }

    // A new poster for the same words. The style ROTATES on each attempt, so
    // "again" produces a different composition rather than the same one redrawn.
    const count = Number(item.regenerationCount || 0) + 1;
    const attemptedAt = toMysqlUtc(now());
    /*
     * A DIFFERENT photograph, not just a different layout. Asking again is
     * asking for something else, and the picture is the loudest thing on the
     * poster — redrawing the type around the same image would look like the
     * same poster.
     */
    const photo = await loadPhoto(brand.images, day + count);
    const design = await designOnly({
      photo,
      brand: {
        businessName: brand.businessName, industry: brand.industry, tone: brand.tone,
        websiteUrl: brand.websiteUrl, phone: brand.phone, city: brand.city,
      },
      colors: {
        primary: brand.primary || '#111827',
        secondary: brand.secondary || '#6b7280',
        accent: brand.accent || '#2563eb',
      },
      font: brand.headingFont || null,
      content: {
        headline: item.headline || '',
        subtext: item.subheadline || '',
        cta: entry.cta || '',
        // Kept on the item when it was first built, so the new design can
        // rebuild the same content block instead of losing it.
        points: item.fingerprint?.posterPoints || [],
      },
      styleId: DESIGN_STYLES[(day - 1 + count) % DESIGN_STYLES.length].id,
      port: 9700 + (day % 50),
    });

    if (!design.png) {
      const pe = normalizeProviderError(
        design.imageError || new Error('The poster could not be designed.'),
        { provider: PROVIDER_NAMES.AI_STUDIO, operation: 'regenerate_poster' },
      );
      logProviderFailure(pe, { jobType: JOB_TYPES.AI_STUDIO_POST, plannerRunId: run.id });
      /*
       * The OLD poster is left in place. A failed retry that also erased what
       * the user already had would punish them for asking, and the previous
       * poster is still a real poster.
       */
      await runs.updateItem(item.id, userId, {
        imageStatus: item.mediaAssetId ? IMAGE_RENDER_STATUS.READY : IMAGE_RENDER_STATUS.FAILED,
        imageErrorCategory: pe.category,
        imageErrorCode: pe.errorCode,
        imageErrorMessage: pe.userMessage,
        imageHttpStatus: pe.httpStatus,
        imageRetryable: pe.retryable,
        imageAttemptCount: Number(item.imageAttemptCount || 0) + 1,
        imageLastAttemptAt: attemptedAt,
      });
      // Thrown so the durable job records the failure and retries it.
      throw pe;
    }

    const asset = await mediaLibraryService.uploadImage(userId, {
      buffer: design.png,
      originalName: `week-${run.id}-day-${day}-v${count + 1}.png`,
      declaredMime: 'image/png',
    });

    await runs.updateItem(item.id, userId, {
      mediaAssetId: asset.id,
      imageStatus: IMAGE_RENDER_STATUS.READY,
      imageProvider: PROVIDER_NAMES.AI_STUDIO,
      imageErrorCategory: null,
      imageErrorCode: null,
      imageErrorMessage: null,
      imageHttpStatus: null,
      imageRetryable: null,
      imageAttemptCount: Number(item.imageAttemptCount || 0) + 1,
      imageLastAttemptAt: attemptedAt,
      regenerationCount: count,
    });
  }

  /**
   * Progress for the studio screen: the plan, and what has been built.
   *
   * The poster travels as a URL. An item carries a media id, which means nothing
   * to a browser — without resolving it here the screen would show a week of
   * blank cards while every poster sat finished in storage.
   */
  async function getWeek(userId, runId) {
    const run = await runs.findRunByIdForUser(runId, userId);
    if (!run) return null;
    const items = await runs.listItemsForRun(run.id, userId);
    const plan = run.settings?.plan || [];

    /*
     * What each day's job is DOING. A week whose posts never appear has to be
     * explainable: without this the screen can only count to zero for ever, and
     * cannot tell a day that is queued from one that failed three times and
     * stopped. A category and a safe message only.
     */
    // Reading job state is diagnostic: it must never be able to break the page
    // it exists to explain, so an absent or failing lookup simply says nothing.
    const jobRows = typeof jobs.listJobsByKeyPrefix === 'function'
      ? await jobs.listJobsByKeyPrefix(userId, `ai_studio:${run.id}:day:`).catch(() => [])
      : [];
    const jobByDay = new Map();
    // Which days are having a piece redone right now, and which piece.
    const regenByDay = new Map();
    for (const j of jobRows) {
      const parsed = parseJobKey(j.idempotencyKey);
      if (!parsed) continue;
      if (!parsed.kind) { jobByDay.set(parsed.day, j); continue; }
      if (IN_FLIGHT.has(j.status)) regenByDay.set(parsed.day, parsed.kind);
    }

    const posts = [];
    for (const item of items) {
      let posterUrl = null;
      if (item.mediaAssetId) {
        // eslint-disable-next-line no-await-in-loop
        const asset = await media.findMediaAssetByIdForUser(item.mediaAssetId, userId).catch(() => null);
        if (asset?.publicToken) posterUrl = `/media/${asset.publicToken}`;
      }
      const entry = plan.find((p) => p.day === (item.position ?? 0) + 1) || {};
      posts.push({
        id: String(item.id),
        day: (item.position ?? 0) + 1,
        job: entry.job || '',
        angle: item.brief || entry.angle || '',
        headline: item.headline || '',
        subheadline: item.subheadline || '',
        hashtags: item.hashtags || [],
        captions: {
          facebook: item.platformCaptions?.facebook?.caption || item.caption || '',
          instagram: item.platformCaptions?.instagram?.caption || '',
          threads: item.platformCaptions?.threads?.caption || '',
        },
        posterUrl,
        // Honest about a poster that failed: the card says why, and can retry.
        imageStatus: item.imageStatus || null,
        imageError: item.imageErrorMessage || null,
        // 'poster' | 'caption' | null — so the card can say which half of it is
        // being redone, and disable only that button.
        regenerating: regenByDay.get((item.position ?? 0) + 1) || null,
        scheduledFor: item.scheduledFor || null,
      });
    }
    posts.sort((a, b) => a.day - b.day);

    /*
     * A day that has no post yet says WHY, in the plan itself. "Waiting" and
     * "gave up after three tries" look identical on screen otherwise, and one of
     * them needs the user to do something.
     */
    const builtDays = new Set(posts.map((p) => p.day));
    const days = plan.map((entry) => {
      if (builtDays.has(entry.day)) return { ...entry, state: 'built' };
      const j = jobByDay.get(entry.day);
      if (!j) return { ...entry, state: 'queued' };
      if (j.status === 'failed') {
        return {
          ...entry,
          state: 'failed',
          errorCategory: j.lastErrorCategory,
          error: j.lastErrorMessage || 'This post could not be built.',
          attempts: j.attemptCount,
        };
      }
      if (j.status === 'running') return { ...entry, state: 'building' };
      // Queued, or waiting out a retry backoff after a transient failure.
      return {
        ...entry,
        state: j.attemptCount > 0 ? 'retrying' : 'queued',
        attempts: j.attemptCount,
        error: j.attemptCount > 0 ? (j.lastErrorMessage || null) : null,
      };
    });

    const failed = days.filter((d) => d.state === 'failed').length;

    return {
      runId: String(run.id),
      status: run.status,
      total: plan.length || WEEK_LENGTH,
      ready: posts.length,
      failed,
      plan,
      days,
      posts,
    };
  }

  /**
   * The week this user is in the middle of, without being told which one.
   *
   * A week takes five to eight minutes to build, which is long enough to close
   * the tab, and the run id only ever existed in that tab's memory. Without this
   * a refresh lost a week that was still being built and would keep building —
   * finished posters nobody could reach.
   *
   * The newest studio run wins, whatever state it is in: one still generating is
   * the one to watch, and a finished one is the one to review.
   */
  async function findLatestWeek(userId) {
    const recent = await runs.listRunsForUser(userId, { limit: 20 }).catch(() => []);
    const mine = recent.find((r) => r.settings?.engine === 'ai_studio');
    return mine ? getWeek(userId, mine.id) : null;
  }

  const handlers = { [JOB_TYPES.AI_STUDIO_POST]: runPostJob };

  return { startWeek, runPostJob, requestRegenerate, getWeek, findLatestWeek, handlers };
}

export const weekService = createWeekService();
export default createWeekService;
