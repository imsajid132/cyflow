/**
 * Trusted, server-owned branded social image templates.
 *
 * This module is the orchestrator: it validates and clamps every input, derives
 * the palette and type scale via brandKit, hands a safe context to the chosen
 * layout, and returns the HTML/CSS pair HCTI renders.
 *
 * Security properties (also asserted by tests):
 *   - user text is HTML-escaped and can only ever become inert text
 *   - colours must be #rrggbb or the derived default palette is used
 *   - font labels must be plain names or a system stack is used
 *   - a logo must be absolute https or no <img> is emitted at all
 *   - no url() is ever written to CSS, so a render fetches no remote asset
 *   - class names and structure are authored here, never supplied by a caller
 *
 * No photography is invented. Visual interest comes from CSS geometry, and
 * `photo-overlay` keeps a real background-image slot for a future provider.
 */

import {
  ASPECT_RATIOS,
  IMAGE_TEMPLATES,
  BACKGROUND_STYLES,
  LEGACY_IMAGE_TEMPLATE_ALIASES,
  PLANNER_VISUAL_LIMITS,
  POSTER_LIMITS,
} from '../config/constants.js';
import {
  escapeHtml,
  safeColor,
  safeImageUrl,
  buildPalette,
  fontStack,
  fontCategory,
  headlineScale,
  subheadlineScale,
  clampText,
  eyebrowFrom,
  TEXT_LIMITS,
} from './brandKit.js';
import { baseCss } from './baseStyles.js';
import { LAYOUTS, LAYOUT_IDS, LAYOUT_LABELS } from './layouts/index.js';

export { escapeHtml, safeColor, safeImageUrl } from './brandKit.js';
export { LAYOUT_LABELS, LAYOUT_IDS } from './layouts/index.js';

export const DEFAULT_TEMPLATE = 'editorial-premium';

/**
 * Escape, clamp and count-limit the Make poster field sets.
 *
 * Returns an object with one optional group per concept. Every string is
 * escaped here so poster layouts handle only trusted text, exactly like the rest
 * of the template system. A group whose required content is absent is omitted,
 * so a layout falls back cleanly rather than rendering an empty scaffold. A
 * testimonial group is returned ONLY when a real quote and author are present,
 * because the testimonial card must never show a half or invented review.
 */
function sanitizePoster(poster) {
  if (!poster || typeof poster !== 'object') return null;
  const P = POSTER_LIMITS;
  const str = (v, max) => escapeHtml(clampText(v, max));
  const list = (arr, max, n) => (Array.isArray(arr)
    ? arr.filter((s) => typeof s === 'string' && s.trim()).slice(0, n).map((s) => str(s, max))
    : []);
  const out = {};

  if (poster.service) {
    const s = poster.service;
    out.service = {
      problem: str(s.problem, P.BLOCK_TEXT_MAX),
      solution: str(s.solution, P.BLOCK_TEXT_MAX),
      result: str(s.result, P.BLOCK_TEXT_MAX),
      tags: list(s.tags, P.TAG_MAX, P.TAGS_MAX),
    };
  }
  if (poster.stat && clampText(poster.stat.bigStat, P.BIG_STAT_MAX)) {
    const s = poster.stat;
    out.stat = {
      bigStat: str(s.bigStat, P.BIG_STAT_MAX),
      statDesc: str(s.statDesc, P.STAT_DESC_MAX),
      overline: str(s.overline, P.OVERLINE_MAX),
      badges: list(s.badges, P.BADGE_TEXT_MAX, P.BADGES_MAX),
    };
  }
  if (poster.cheatsheet && Array.isArray(poster.cheatsheet.tips)) {
    const tips = poster.cheatsheet.tips
      .filter((t) => t && typeof t.main === 'string' && t.main.trim())
      .slice(0, P.TIPS_MAX)
      .map((t) => ({ main: str(t.main, P.TIP_MAIN_MAX), sub: str(t.sub, P.TIP_SUB_MAX) }));
    if (tips.length) {
      out.cheatsheet = {
        overline: str(poster.cheatsheet.overline, P.OVERLINE_MAX),
        highlight: str(poster.cheatsheet.highlight, P.HIGHLIGHT_MAX),
        tips,
      };
    }
  }
  if (poster.project) {
    const p = poster.project;
    out.project = {
      details: list(p.details, P.DETAIL_MAX, P.DETAILS_MAX),
      timeline: str(p.timeline, P.META_VALUE_MAX),
      result: str(p.result, P.META_VALUE_MAX),
      location: str(p.location, P.REVIEW_LOCATION_MAX),
    };
  }
  if (poster.warning) {
    const w = poster.warning;
    out.warning = {
      highlight: str(w.highlight, P.HIGHLIGHT_MAX),
      mistake: str(w.mistake, P.WARN_TEXT_MAX),
      consequence: str(w.consequence, P.WARN_TEXT_MAX),
      fix: str(w.fix, P.WARN_TEXT_MAX),
      proTip: str(w.proTip, P.PRO_TIP_MAX),
    };
  }
  if (poster.quote && clampText(poster.quote.part1, P.QUOTE_PART_MAX)) {
    const q = poster.quote;
    out.quote = {
      part1: str(q.part1, P.QUOTE_PART_MAX),
      part2: str(q.part2, P.QUOTE_PART_MAX),
      subquote: str(q.subquote, P.SUBQUOTE_MAX),
    };
  }
  if (poster.testimonial) {
    const t = poster.testimonial;
    const quote = clampText(t.quote, P.REVIEW_QUOTE_MAX);
    const author = clampText(t.author, P.REVIEW_AUTHOR_MAX);
    // Both or nothing. A quote with no attribution, or an attribution with no
    // quote, is not a review and does not render.
    if (quote && author) {
      out.testimonial = {
        quote: escapeHtml(quote),
        author: escapeHtml(author),
        location: str(t.location, P.REVIEW_LOCATION_MAX),
        initials: escapeHtml(clampText(initialsOf(author), 3)),
      };
    }
  }

  return Object.keys(out).length ? out : null;
}

/** Up to two initials from a name, for the testimonial author chip. */
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const letters = parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  return letters || '';
}

/** Map any accepted template name (current or legacy) onto a real layout. */
export function normalizeTemplate(name) {
  if (typeof name === 'string') {
    if (LAYOUTS[name]) return name;
    const aliased = LEGACY_IMAGE_TEMPLATE_ALIASES[name];
    if (aliased && LAYOUTS[aliased]) return aliased;
  }
  return DEFAULT_TEMPLATE;
}

function dimensionsFor(aspectRatio) {
  return ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS.square;
}

/**
 * Non-square canvases scale the type rather than reflowing the layout: the
 * design system is authored against the 1080 square, and portrait/landscape
 * derive from it. Landscape is much shorter, so it steps down hardest.
 */
function scaleBase(aspectRatio) {
  if (aspectRatio === 'landscape') return 0.62;
  if (aspectRatio === 'portrait') return 1.04;
  return 1;
}

/**
 * Build the trusted HTML + CSS for a branded image.
 *
 * @param {{
 *   template?: string, aspectRatio?: string, backgroundStyle?: string,
 *   brandName?: string, headline?: string, subheadline?: string,
 *   logoUrl?: string, primaryColor?: string, secondaryColor?: string,
 *   accentColor?: string, headingFont?: string, bodyFont?: string,
 *   cta?: string, website?: string, phone?: string,
 *   businessCategory?: string, serviceTag?: string,
 *   bullets?: string[], stat?: { value, label },
 *   comparison?: { leftTitle, rightTitle, leftItems, rightItems },
 * }} input
 * @returns {{ html:string, css:string, width:number, height:number, template:string, templateLabel:string }}
 */
export function buildTemplate(input = {}) {
  const template = normalizeTemplate(input.template);
  const layout = LAYOUTS[template];
  const backgroundStyle = BACKGROUND_STYLES.includes(input.backgroundStyle) ? input.backgroundStyle : 'light';
  const aspectRatio = ASPECT_RATIOS[input.aspectRatio] ? input.aspectRatio : 'square';
  const { width, height } = dimensionsFor(aspectRatio);
  const base = scaleBase(aspectRatio);

  const palette = buildPalette({
    primaryColor: input.primaryColor,
    secondaryColor: input.secondaryColor,
    accentColor: input.accentColor,
    backgroundStyle,
  });

  const fonts = {
    display: fontStack(input.headingFont),
    body: fontStack(input.bodyFont),
    // Utility type (eyebrow, footer, CTA) stays in the body voice so the
    // display face keeps its impact.
    utility: fontStack(input.bodyFont),
  };

  const headline = clampText(input.headline, TEXT_LIMITS.HEADLINE);
  const sub = clampText(input.subheadline, TEXT_LIMITS.SUBHEADLINE);

  const type = {
    headline: headlineScale(headline, { base }),
    sub: subheadlineScale(sub, { base }),
  };

  /*
   * Structured extras for the content-type layouts. Each is escaped, clamped
   * and count-limited here, so a layout can render them directly and an absent
   * or malformed value simply produces no block rather than a broken one.
   */
  const V = PLANNER_VISUAL_LIMITS;
  const bullets = Array.isArray(input.bullets)
    ? input.bullets
        .filter((b) => typeof b === 'string' && b.trim())
        .slice(0, V.BULLETS_MAX)
        .map((b) => escapeHtml(clampText(b, V.BULLET_MAX)))
    : [];

  const statValue = escapeHtml(clampText(input.stat?.value, V.STAT_VALUE_MAX));
  const statLabel = escapeHtml(clampText(input.stat?.label, V.STAT_LABEL_MAX));

  const compareItems = (items) =>
    Array.isArray(items)
      ? items
          .filter((i) => typeof i === 'string' && i.trim())
          .slice(0, V.COMPARE_ITEMS_MAX)
          .map((i) => escapeHtml(clampText(i, V.COMPARE_ITEM_MAX)))
      : [];
  const comparison = input.comparison
    ? {
        leftTitle: escapeHtml(clampText(input.comparison.leftTitle, V.COMPARE_TITLE_MAX)),
        rightTitle: escapeHtml(clampText(input.comparison.rightTitle, V.COMPARE_TITLE_MAX)),
        leftItems: compareItems(input.comparison.leftItems),
        rightItems: compareItems(input.comparison.rightItems),
      }
    : null;

  // Escape once, here — layouts and parts only ever handle safe strings.
  const text = {
    brandName: escapeHtml(clampText(input.brandName, TEXT_LIMITS.BRAND)),
    headline: escapeHtml(headline),
    sub: escapeHtml(sub),
    cta: escapeHtml(clampText(input.cta, TEXT_LIMITS.CTA)),
    website: escapeHtml(clampText(input.website, TEXT_LIMITS.WEBSITE)),
    phone: escapeHtml(clampText(input.phone, TEXT_LIMITS.PHONE)),
    tag: escapeHtml(clampText(input.serviceTag, TEXT_LIMITS.TAG)),
    eyebrow: escapeHtml(eyebrowFrom({
      brandName: clampText(input.brandName, TEXT_LIMITS.BRAND),
      businessCategory: clampText(input.businessCategory, TEXT_LIMITS.TAG),
    })),
    // Content-type extras — already escaped and clamped above.
    bullets,
    statValue,
    statLabel,
    comparison,
    // Design-family extras: the category badge and the place label.
    badge: escapeHtml(clampText(input.badge, V.BADGE_MAX)),
    locationLabel: escapeHtml(clampText(input.locationLabel, V.LOCATION_MAX)),
    /*
     * Phase 4.8 structured fields. Each is optional; a layout that wants one
     * falls back to headline/subheadline/bullets when it is absent.
     *
     * The FAQ answer gets its OWN limit rather than borrowing the subheadline's.
     * A subheadline is one supporting line under a headline; an answer is the
     * whole point of the card and sits in a panel sized for a paragraph. At 140
     * characters a real answer was being cut mid-word with an ellipsis, which
     * looked like a rendering fault and made the card useless.
     */
    answerSummary: escapeHtml(clampText(input.answerSummary, TEXT_LIMITS.ANSWER)),
    emphasisPhrase: escapeHtml(clampText(input.emphasisPhrase, 40)),
    /*
     * The Make poster field sets. Each concept owns one group; the group is
     * escaped, clamped and count-limited here so a poster layout renders trusted
     * strings directly and an absent field simply drops rather than breaking the
     * composition. A group is null when its inputs are absent, which is how a
     * poster layout knows to fall back to the plain headline block.
     */
    poster: sanitizePoster(input.poster),
  };

  const logoUrl = escapeHtml(safeImageUrl(input.logoUrl));

  const ctx = { width, height, palette, fonts, type, text, logoUrl, scope: `.tpl-${template}` };
  const rendered = layout.render(ctx);

  return {
    html: rendered.html.replace(/\n\s*/g, ''),
    css: `${baseCss(ctx)}\n${rendered.css}`,
    width,
    height,
    template,
    templateLabel: layout.label,
  };
}

/** Template slugs + labels, for building a picker. */
export function listTemplates() {
  return IMAGE_TEMPLATES.filter((id) => LAYOUTS[id]).map((id) => ({ id, label: LAYOUT_LABELS[id] }));
}

export default {
  buildTemplate,
  normalizeTemplate,
  listTemplates,
  escapeHtml,
  safeColor,
  safeImageUrl,
  fontCategory,
  LAYOUT_IDS,
  LAYOUT_LABELS,
  DEFAULT_TEMPLATE,
};
