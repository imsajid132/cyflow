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
import { ValidationError } from '../utils/errors.js';
import { normalizeProviderError } from '../utils/providerErrors.js';
import { PROVIDER_NAMES } from '../config/constants.js';
import { generateAiPost } from '../services/aiStudio/aiStudioEngine.js';
import { refineBrand } from '../services/aiStudio/brandRefiner.js';
import { isClaudeConfigured } from '../services/aiStudio/claudeClient.js';
import { websiteAnalysisService as defaultWebsiteAnalysis } from '../services/websiteAnalysisService.js';

const STYLES = new Set(['showcase', 'editorial', 'dynamic']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hex = (v, fallback) => (typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : fallback);

export function createAiStudioController({ websiteAnalysis = defaultWebsiteAnalysis } = {}) {
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
    const foundImages = list(s.images, 12).map((im) => ({
      url: String(im?.url || ''), alt: String(im?.alt || ''),
      width: Number(im?.width) || 0, height: Number(im?.height) || 0,
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
     * Which pictures are actually of this business.
     *
     * A rule cannot tell a company's own work from its customers' logos — a real
     * site offered five "photos" that were all client marks from a trusted-by
     * strip, and a poster carrying one would advertise somebody else. The model
     * can tell, from the description and the filename.
     *
     * `null` means it did not answer, which is NOT a decision to discard the
     * photographs: they are all kept, exactly as before.
     */
    const images = Array.isArray(refined?.keepImages)
      ? refined.keepImages.map((i) => foundImages[i]).filter(Boolean)
      : foundImages;

    return sendSuccess(res, {
      sourceUrl: result?.sourceUrl ?? null,
      pagesAnalyzed: list(result?.pagesAnalyzed, 8),
      warnings: list(result?.warnings, 6),
      brand: {
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
      },
    });
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

  return { status, analyze, generate };
}

export default createAiStudioController;
