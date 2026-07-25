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
import { isClaudeConfigured } from '../services/aiStudio/claudeClient.js';

const STYLES = new Set(['showcase', 'editorial', 'dynamic']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hex = (v, fallback) => (typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : fallback);

export function createAiStudioController() {
  /** Whether the AI is configured, so the page can show a clear "add a key" note. */
  const status = asyncHandler(async (req, res) => sendSuccess(res, { configured: isClaudeConfigured() }));

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

  return { status, generate };
}

export default createAiStudioController;
