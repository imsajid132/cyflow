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
