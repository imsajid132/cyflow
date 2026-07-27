/**
 * AI Studio controller (factory).
 *
 * A visible, on-demand version of the AI poster studio: the user confirms their
 * brand + a topic, and Claude designs a poster (rendered for free with resvg) and
 * writes the platform captions. This is the same engine the daily automation uses
 * (src/services/aiStudio/aiStudioEngine.js) — here it is driven by hand so the
 * user can SEE and test it. Nothing here publishes.
 *
 * Identity is always the session user (`req.user.id`). Safe by construction: the
 * key never reaches the browser, no raw provider error or prompt is returned, and
 * an image failure degrades to captions-only with a safe message rather than a
 * crash.
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { normalizeProviderError } from '../utils/providerErrors.js';
import { PROVIDER_NAMES } from '../config/constants.js';
import { generateAiPost } from '../services/aiStudio/aiStudioEngine.js';
import { refineBrand } from '../services/aiStudio/brandRefiner.js';
import { isClaudeConfigured } from '../services/aiStudio/claudeClient.js';
import { websiteAnalysisService as defaultWebsiteAnalysis } from '../services/websiteAnalysisService.js';
import { weekService as defaultWeekService } from '../services/aiStudio/weekService.js';
import { studioMemory as defaultMemory } from '../services/aiStudio/studioMemory.js';

const STYLES = new Set(['showcase', 'editorial', 'dynamic']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hex = (v, fallback) => (typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : fallback);

export function createAiStudioController({
  websiteAnalysis = defaultWebsiteAnalysis,
  weekService = defaultWeekService,
  memory = defaultMemory,
} = {}) {
  /** Whether the AI is configured, so the page can show a clear "add a key" note. */
  const status = asyncHandler(async (req, res) => sendSuccess(res, { configured: isClaudeConfigured() }));

  /**
   * Read a website and return the brand it suggests, so the studio can be filled
   * from a URL instead of typed out.
   *
   * It calls the ANALYZER directly rather than businessProfileService, because
   * that path also moves the account's onboarding status — a side effect that
   * belongs to first-time setup, not to someone trying a URL in the studio.
   * Nothing is saved here; the answer only prefills the form.
   */
  const analyze = asyncHandler(async (req, res) => {
    const websiteUrl = str(req.body?.url ?? req.body?.websiteUrl, 300);
    if (!websiteUrl) throw new ValidationError('Enter a website address to read.');

    let result;
    try {
      result = await websiteAnalysis.analyzeWebsite({ userId: req.user.id, websiteUrl });
    } catch (err) {
      // The analyzer's own message is written for people ("that site could not be
      // reached"); anything else becomes a safe generic one.
      throw err instanceof ValidationError
        ? err
        : new ValidationError('That website could not be read. Check the address, or fill the brand in by hand.');
    }

    /*
     * EVERYTHING the reader found is returned, not a chosen subset.
     *
     * The product is explicit about this: if the app found it, the user sees it
     * — logo, both fonts, every colour, the services, the contact details, the
     * social links. A field that is hidden is a field the user cannot correct,
     * and the reader is often almost-right rather than right.
     */
    const s = result?.suggestions || {};
    const list = (v, max) => (Array.isArray(v) ? v.filter(Boolean).slice(0, max) : []);

    /*
     * Ask Claude what the page MEANS, now that the parser has said what it
     * CONTAINS.
     *
     * A real SEO company came back with its industry as "Professional service"
     * and its services as "Six services. One unified playbook." — the schema
     * container it happened to declare, and a list of section headings with the
     * real services mixed in and indistinguishable by rule. Telling them apart is
     * a judgement, and the product says Claude makes those.
     *
     * Only the four editorial fields are replaced, and only when the model
     * actually returns something. Colours, logo, fonts and contact details are
     * facts it cannot see from text, so they stay exactly as read.
     */
    const foundImages = list(s.images, 40).map((im) => ({
      url: String(im?.url || ''), alt: String(im?.alt || ''),
      width: Number(im?.width) || 0, height: Number(im?.height) || 0,
      kind: String(im?.kind || 'photo'),
    })).filter((im) => im.url);

    const refined = await refineBrand({
      websiteUrl: s.websiteUrl || result?.sourceUrl || '',
      businessName: s.businessName || '',
      industry: s.businessCategory || '',
      description: s.businessDescription || '',
      services: list(s.services, 20),
      images: foundImages,
    });

    /*
     * EVERY picture is returned. The model's opinion only decides what starts
     * TICKED.
     *
     * Filtering them out was wrong twice over: a site was left showing no
     * pictures at all, and an owner who wanted one the model had rejected had no
     * way to reach it. So this is a library — everything the site uses, with the
     * photographs of this business already selected and everything else there to
     * be picked up. When the model says nothing, the picture's own kind decides:
     * photographs on, logos and icons off.
     */
    const picked = Array.isArray(refined?.keepImages) ? new Set(refined.keepImages) : null;
    const images = foundImages.map((im, i) => ({
      ...im,
      chosen: picked ? picked.has(i) : im.kind === 'photo',
    }));

    const brand = {
      businessName: s.businessName || '',
      // Claude's reading wins where it produced one; the scrape is the fallback.
      industry: refined?.industry || s.businessCategory || '',
      description: refined?.description || s.businessDescription || '',
      tone: refined?.tone || s.defaultTone || '',
      services: refined?.services?.length ? refined.services : list(s.services, 12),

      // Identity marks. `logoValidated` is reported honestly: an unvalidated
      // logo is shown, but the UI can say it could not be verified.
      logoUrl: s.logoUrl || '',
      logoValidated: Boolean(s.logoValidated),
      faviconUrl: s.faviconUrl || '',

      fonts: { heading: s.headingFont || '', body: s.bodyFont || '' },

      colors: {
        primary: hex(s.primaryColor, '#111827'),
        secondary: hex(s.secondaryColor, '#6b7280'),
        accent: hex(s.accentColor, s.primaryColor && HEX_RE.test(s.primaryColor) ? s.primaryColor : '#2563eb'),
      },
      colorCandidates: list(s.colorCandidates, 12).filter((c) => HEX_RE.test(c)),

      contact: {
        phone: s.phone || '',
        email: s.email || '',
        address: s.address || '',
        city: s.city || '',
        region: s.region || '',
        postalCode: s.postalCode || '',
        country: s.country || '',
        websiteUrl: s.websiteUrl || '',
      },
      locations: list(s.locations, 6),
      socialLinks: s.socialLinks && typeof s.socialLinks === 'object' ? s.socialLinks : {},
      /*
       * The business's own photographs. These are what stop a poster looking
       * like a template, so they travel with the brand rather than being
       * fetched again later.
       */
      images,
      sourceUrl: result?.sourceUrl || websiteUrl,
    };

    // Kept before it is sent, so a refresh two seconds later still has it. A
    // failure to remember is not a failure to analyse: it never throws.
    await memory.rememberBrand(req.user.id, brand);

    return sendSuccess(res, {
      sourceUrl: result?.sourceUrl ?? null,
      pagesAnalyzed: list(result?.pagesAnalyzed, 8),
      warnings: list(result?.warnings, 6),
      brand,
    });
  });

  /**
   * Keep the brand as it now stands on screen.
   *
   * The reader is often almost-right, so the product makes every field editable
   * — and an edit that a refresh throws away is worse than no edit at all,
   * because the user has to notice it is gone before they can redo it. The
   * screen sends its state here as it changes.
   */
  const saveBrand = asyncHandler(async (req, res) => {
    const brand = await memory.rememberBrand(req.user.id, req.body?.brand ?? req.body);
    return sendSuccess(res, { saved: Boolean(brand) });
  });

  /**
   * Everything this user should see when the studio opens.
   *
   * Two things survive a closed tab: the brand they corrected, and the week that
   * is still building. Both are found here, so the page can restore itself
   * without the user having to remember a run id that only ever lived in a tab.
   */
  const resume = asyncHandler(async (req, res) => {
    const [brand, week] = await Promise.all([
      memory.recallBrand(req.user.id),
      weekService.findLatestWeek(req.user.id).catch(() => null),
    ]);
    return sendSuccess(res, { brand: brand ?? null, week: week ?? null });
  });

  /**
   * Design one poster + write the captions. ~30-60s (two Claude calls + a free
   * render). Returns a data-URL PNG (or null with a safe note if the render
   * failed) plus the copy. The key and any raw provider text stay server-side.
   */
  const generate = asyncHandler(async (req, res) => {
    if (!isClaudeConfigured()) {
      throw new ValidationError('The AI is not configured yet. Add AI_API_KEY in your environment to use the studio.');
    }

    const body = req.body || {};
    const brand = {
      businessName: str(body.businessName, 120),
      industry: str(body.industry, 120),
      tone: str(body.tone, 120),
    };
    if (!brand.businessName) throw new ValidationError('Enter your business name to design a poster.');

    const colors = {
      primary: hex(body.primaryColor ?? body.colors?.primary, '#111827'),
      secondary: hex(body.secondaryColor ?? body.colors?.secondary, '#6b7280'),
      accent: hex(body.accentColor ?? body.colors?.accent, '#2563eb'),
    };
    const styleId = STYLES.has(body.styleId) ? body.styleId : 'showcase';
    const angle = str(body.angle, 400);
    const font = str(body.font, 80) || null;

    let post;
    try {
      post = await generateAiPost({ brand, colors, font, angle, styleId });
    } catch (err) {
      // Normalize for a safe log line; never return the raw provider text.
      const pe = normalizeProviderError(err, { provider: PROVIDER_NAMES.AI_STUDIO, operation: 'ai_studio_generate' });
      throw new ValidationError(
        pe.retryable
          ? 'The AI is busy right now. Please try again in a moment.'
          : 'The AI could not design this poster. Please adjust the details and try again.',
      );
    }

    const pngDataUrl = post.png ? `data:image/png;base64,${post.png.toString('base64')}` : null;
    const imageNote = post.png
      ? null
      : 'The post copy is ready, but the poster image could not be rendered this time. Try Generate again.';

    return sendSuccess(res, {
      styleId,
      headline: post.copy.headline,
      subtext: post.copy.subtext,
      cta: post.copy.cta,
      captions: post.copy.captions,
      hashtags: post.copy.hashtags,
      pngDataUrl,
      imageNote,
    });
  });

  /**
   * Plan a week and start building it.
   *
   * The plan comes back in the response — the user sees seven ideas at once —
   * while the posters build as durable jobs. Closing the tab does not stop them.
   */
  const startWeek = asyncHandler(async (req, res) => {
    if (!isClaudeConfigured()) {
      throw new ValidationError('The AI is not configured yet. Add AI_API_KEY in your environment to use the studio.');
    }
    const b = req.body || {};
    const businessName = str(b.businessName, 120);
    if (!businessName) throw new ValidationError('Enter your business name before generating a week.');

    const brand = {
      businessName,
      industry: str(b.industry, 120),
      description: str(b.description, 600),
      tone: str(b.tone, 120),
      services: Array.isArray(b.services) ? b.services.map((s) => str(s, 80)).filter(Boolean).slice(0, 20) : [],
      headingFont: str(b.headingFont, 80),
      primary: hex(b.primary, '#111827'),
      secondary: hex(b.secondary, '#6b7280'),
      accent: hex(b.accent, '#2563eb'),
      city: str(b.city, 80), region: str(b.region, 80), country: str(b.country, 80),
      websiteUrl: str(b.websiteUrl, 300), logoUrl: str(b.logoUrl, 500),
      images: Array.isArray(b.images)
        ? b.images.slice(0, 40).map((im) => ({ url: str(im?.url, 500), alt: str(im?.alt, 160), chosen: im?.chosen !== false }))
          .filter((im) => im.url)
        : [],
    };

    try {
      const out = await weekService.startWeek(req.user.id, brand, { timezone: str(b.timezone, 60) || 'UTC' });
      return sendSuccess(res, out, 201);
    } catch (err) {
      const pe = normalizeProviderError(err, { provider: PROVIDER_NAMES.AI_STUDIO, operation: 'plan_week' });
      throw new ValidationError(pe.retryable
        ? 'The AI is busy right now. Please try again in a moment.'
        : 'The week could not be planned. Please check your brand details and try again.');
    }
  });

  /** Progress: the plan, and how many posts are built so far. */
  const getWeek = asyncHandler(async (req, res) => {
    const week = await weekService.getWeek(req.user.id, req.params.runId);
    if (!week) throw new NotFoundError('That week was not found');
    return sendSuccess(res, week);
  });

  /**
   * Redo one piece of one day: its poster, or its captions.
   *
   * Two separate asks on purpose. Someone who dislikes the picture is not asking
   * for the words to be rewritten, and the product gives each its own control.
   * It runs as a durable job, so the answer here is "queued", not the result.
   */
  const regenerate = asyncHandler(async (req, res) => {
    if (!isClaudeConfigured()) {
      throw new ValidationError('The AI is not configured yet, so nothing can be regenerated.');
    }
    const day = Number(req.params.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new ValidationError('That day is not part of this week.');
    const kind = req.params.kind;
    if (kind !== 'poster' && kind !== 'caption') throw new ValidationError('There is nothing by that name to regenerate.');

    const out = await weekService.requestRegenerate(req.user.id, req.params.runId, day, kind);
    if (!out) throw new NotFoundError('That post was not found');
    if (out.alreadyRunning) {
      // Not an error: the user asked twice for something already happening.
      return sendSuccess(res, { queued: false, message: 'That one is already being redone.' });
    }
    return sendSuccess(res, {
      queued: true,
      message: kind === 'poster' ? 'A new poster is being designed.' : 'New post copy is being written.',
    }, 202);
  });

  return { status, analyze, saveBrand, resume, generate, startWeek, getWeek, regenerate };
}

export default createAiStudioController;
