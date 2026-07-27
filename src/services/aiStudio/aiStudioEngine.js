/**
 * src/services/aiStudio/aiStudioEngine.js
 *
 * The AI poster studio, as ONE post: given a business's brand + today's angle,
 * Claude writes the poster copy AND the ready-to-post captions (one text call),
 * then designs the 1080x1080 poster HTML (a second text call) which a FREE
 * renderer rasterizes to a PNG.
 *
 * This is an ADDITIVE alternative to the OpenAI + HCTI "Make parity" engine. It
 * is only used when AI_STUDIO_MODE=on AND the AI client is configured; otherwise
 * the tested engine runs exactly as before. Nothing here ever publishes.
 *
 * Why copy is written from TEXT, not vision: the AgentRouter proxy panics on
 * image inputs, so we do NOT ask Claude to "look at" the finished poster. Because
 * WE choose the poster's copy (headline / sub-text / CTA), a text-grounded
 * caption says the same thing a vision caption would, and it is reliable.
 *
 * Copy rules mirror CLAUDE.md exactly: proper multi-paragraph posts, a shorter
 * platform-specific Threads post, NO em/en dashes, and never an invented fact.
 */
import { askClaude, parseJsonFromModel, extractHtml, isClaudeConfigured } from './claudeClient.js';
import { readAiConfigFile } from './aiConfigFile.js';
import {
  DESIGN_STYLES,
  DESIGN_SYSTEM_PROMPT,
  buildDesignUserPrompt,
  SVG_DESIGN_SYSTEM_PROMPT,
  SVG_PHOTO_RULES,
  buildSvgDesignUserPrompt,
} from './designPrompts.js';
import { renderHtmlToPng, renderSvgToPng } from './posterRenderer.js';

/** What the designer writes where the photograph's bytes will go. */
export const PHOTO_TOKEN = '{{PHOTO}}';

/** Pull a bare <svg>...</svg> out of a model response (tolerates fences/prose). */
export function extractSvg(text) {
  let s = (text || '').trim();
  const fence = s.match(/```(?:svg|xml|html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<svg[\s>]/i);
  if (start === -1) return null;
  const end = s.lastIndexOf('</svg>');
  if (end === -1) return null;
  return s.slice(start, end + 6).trim();
}

/**
 * On only when explicitly enabled AND the key is present. Default: OFF.
 *
 * Two accepted names for the flag, for the same reason the key has two: the
 * production host's panel refuses to store `AI_STUDIO_MODE` (see the note in
 * claudeClient.js). `AI_STUDIO_MODE` stays the documented primary.
 */
export function isAiStudioMode() {
  const file = readAiConfigFile();
  const raw = process.env.AI_STUDIO_MODE
    || process.env.CYFLOW_STUDIO_MODE
    || file.AI_STUDIO_MODE
    || file.CYFLOW_STUDIO_MODE
    || '';
  return String(raw).trim().toLowerCase() === 'on';
}

export function isAiStudioEnabled() {
  return isAiStudioMode() && isClaudeConfigured();
}

/** Rotate the three aesthetic directions by position so daily posts vary. */
export function styleIdForPosition(position) {
  const i = Number.isInteger(position) ? Math.abs(position) : 0;
  return DESIGN_STYLES[i % DESIGN_STYLES.length].id;
}

const COPY_SYSTEM = `You are a senior brand designer and social-media copywriter for a small business.
For ONE social media post you produce two things at once:
  (A) the SHORT on-poster copy that will be set as type on a 1080x1080 poster, and
  (B) the ready-to-post caption for each platform.

Rules for the ON-POSTER copy:
- HEADLINE: punchy, 2 to 6 words. SUB-TEXT: one short supporting line. CTA: 2 to 4 words (e.g. "Book now", "Get a free quote").
- POINTS: 3 short supporting points, 2 to 5 words each, that the designer will set as a list ON the poster. They are the EVIDENCE for the headline: the steps, the signs to look for, what is included, what goes wrong. Not slogans, and not a restatement of the headline. Give an empty array only if the angle genuinely supports no list.
- It is real marketing for THIS business. Never invent a statistic, price, discount, guarantee or result that you were not given.

Rules for the CAPTIONS:
- Facebook and Instagram are PROPER posts: 2 to 4 short paragraphs, about 100 to 180 words. Warm, specific, human. Not one promotional line.
- Threads is shorter and punchier, about 40 to 100 words. Written fresh, NOT a trimmed Instagram post.
- NEVER use an em dash or an en dash anywhere. Use a period, comma, colon, parentheses, or a normal hyphen where grammar needs it.
- Do NOT put hashtags inside the caption sentences.
- Never invent facts. If something is not given, leave it out.

Return ONLY a single JSON object, no markdown and no commentary:
{ "headline": "...", "subtext": "...", "cta": "...",
  "points": ["...", "...", "..."],
  "facebook": "...", "instagram": "...", "threads": "...",
  "hashtags": ["#one", "#two", "#three"] }`;

/** Strip any stray em/en dash the model slips in, as a safety net for the rules. */
const noDashes = (s) => String(s || '').replace(/[—–]/g, '-');

/**
 * One text call: the poster copy AND the platform captions for this post.
 * @param {{ brand:{businessName?:string,industry?:string,tone?:string}, angle?:string }} args
 * @returns {Promise<{headline:string,subtext:string,cta:string,captions:{facebook:string,instagram:string,threads:string},hashtags:string[]}>}
 */
export async function generateAiCopy({ brand = {}, angle = '' }) {
  const userText = `BUSINESS: ${brand.businessName || '(unknown)'}
INDUSTRY: ${brand.industry || '(unknown)'}
BRAND TONE: ${brand.tone || 'professional, modern'}

TODAY'S ANGLE / FOCUS FOR THIS POST (use it so each day's post is different):
${angle || 'A general brand-awareness post about what this business does best.'}

Write the on-poster copy and the three captions now. Return ONLY the JSON object.`;

  const raw = await askClaude({ system: COPY_SYSTEM, userText, maxTokens: 1600 });
  const obj = parseJsonFromModel(raw) || {};
  const hashtags = Array.isArray(obj.hashtags)
    ? obj.hashtags.map((h) => String(h || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    headline: noDashes(obj.headline).slice(0, 120),
    subtext: noDashes(obj.subtext).slice(0, 240),
    cta: noDashes(obj.cta).slice(0, 40),
    // The evidence the poster's content block is built from. Capped short: a
    // list row that wraps is a list row that overflows the canvas.
    points: Array.isArray(obj.points)
      ? obj.points.map((p) => noDashes(p).trim().slice(0, 48)).filter(Boolean).slice(0, 5)
      : [],
    captions: {
      facebook: noDashes(obj.facebook),
      instagram: noDashes(obj.instagram),
      threads: noDashes(obj.threads),
    },
    hashtags,
  };
}

/**
 * JUST the poster: one design call + the free render, for copy already written.
 *
 * Separate from `generateAiPost` because "design this again" is its own action.
 * Re-running the whole post to get a different picture would rewrite the words
 * as well, which is not what someone asking for a new poster meant — and it
 * would spend a second model call to throw its answer away.
 *
 * NEVER throws: the PNG is optional data, and a design or render failure returns
 * `{ png:null, imageError }` so the caller can record a safe, retryable state.
 *
 * `ask` is injectable so the photograph substitution below can be tested
 * without a network call — it is the only part of this function with a rule
 * that can be got wrong silently.
 *
 * @param {{
 *   brand:object, colors:{primary:string,secondary:string,accent:string},
 *   font?:string, content:{headline:string,subtext:string,cta:string},
 *   styleId?:string, port?:number, photo?:{dataUri:string,alt?:string}|null,
 *   ask?:Function
 * }} input
 * @returns {Promise<{ markup:(string|null), png:(Buffer|null), imageError:(Error|null) }>}
 */
export async function designPoster({
  brand = {}, colors, font, content, styleId, port = 9700, photo = null, ask = askClaude,
}) {
  const style = DESIGN_STYLES.find((s) => s.id === styleId) || DESIGN_STYLES[0];
  // Default to the browserless SVG path — free forever and Hostinger-safe. The
  // HTML + headless-Chrome path is opt-in for a VPS / local dev (higher fidelity).
  const mode = String(process.env.POSTER_RENDER_MODE || 'svg').toLowerCase();

  let markup = null;
  let png = null;
  let imageError = null;
  try {
    if (mode === 'local' || mode === 'remote') {
      const raw = await ask({
        system: DESIGN_SYSTEM_PROMPT,
        userText: buildDesignUserPrompt({ brand, colors, font, content }, style.direction),
        maxTokens: 4000,
      });
      markup = extractHtml(raw);
      if (!markup || !/<html|<!doctype/i.test(markup)) throw new Error('The AI did not return a valid poster document.');
      png = await renderHtmlToPng(markup, { port });
    } else {
      const raw = await ask({
        // The photograph rules are appended rather than always present: telling a
        // model how to place an image it does not have invites it to invent one.
        system: photo?.dataUri ? `${SVG_DESIGN_SYSTEM_PROMPT}\n${SVG_PHOTO_RULES}` : SVG_DESIGN_SYSTEM_PROMPT,
        userText: buildSvgDesignUserPrompt(
          { brand, colors, font, content, hasPhoto: Boolean(photo?.dataUri), photoAlt: photo?.alt || '' },
          style.direction,
        ),
        maxTokens: 4000,
      });
      markup = extractSvg(raw);
      if (!markup) throw new Error('The AI did not return a valid SVG poster.');

      /*
       * The bytes go in AFTER the model answers. A model asked to emit base64
       * either hallucinates it or spends its whole response on it, and either
       * way the poster is lost — so it writes a token and we do the swap.
       *
       * If it ignored the token, the poster is still a poster: it renders
       * without the photograph rather than failing.
       */
      if (photo?.dataUri) markup = markup.split(PHOTO_TOKEN).join(photo.dataUri);
      // A leftover token would be an <image> pointing at nothing. Strip any
      // element still carrying it rather than shipping a broken reference.
      if (markup.includes(PHOTO_TOKEN)) {
        markup = markup.replace(new RegExp(`<image\\b[^>]*${PHOTO_TOKEN}[^>]*/?>`, 'g'), '');
      }

      png = await renderSvgToPng(markup);
    }
  } catch (err) {
    imageError = err;
  }
  return { markup, png, imageError };
}

/**
 * The whole post: copy (text call) + poster design (text call) + free render.
 *
 * NEVER throws for a render failure — the PNG is optional data. If Claude is
 * unreachable for the COPY it throws (there is no post without copy); a design or
 * render failure returns `{ png:null, imageError }` so the caller records a safe,
 * retryable image state instead of losing the post.
 *
 * @param {{
 *   brand:{businessName?:string,industry?:string,tone?:string},
 *   colors:{primary:string,secondary:string,accent:string},
 *   font?:string, angle?:string, styleId?:string, port?:number
 * }} input
 * @returns {Promise<{ copy:object, html:(string|null), png:(Buffer|null), imageError:(Error|null) }>}
 */
export async function generateAiPost(input) {
  const { brand = {}, colors, font, angle = '', styleId, port = 9700, photo = null } = input;
  const copy = await generateAiCopy({ brand, angle });
  const design = await designPoster({
    brand,
    colors,
    font,
    content: { headline: copy.headline, subtext: copy.subtext, cta: copy.cta, points: copy.points },
    styleId,
    port,
    photo,
  });
  return { copy, ...design };
}
