/**
 * The design system behind every generated social image.
 *
 * A business's brand colours are arbitrary user input — they can be neon,
 * muddy, or clashing — so this module never uses them raw. It derives a
 * disciplined palette from them: neutrals are tinted with the brand hue rather
 * than being flat greys, and loud inputs are normalized into a usable band.
 * That is what keeps every template feeling like part of one premium system
 * regardless of what the business typed in.
 *
 * Nothing here trusts its input. Colours must be #rrggbb, font labels must be
 * plain names, and logos must be absolute https — anything else falls back to a
 * safe default instead of reaching the CSS.
 */

import { IMAGE_TEXT_LIMITS } from '../config/constants.js';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FONT_NAME_RE = /^[A-Za-z0-9 _-]{1,80}$/;

/** Escape a string for safe insertion into HTML text nodes. */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only a validated hex colour may reach the CSS. */
export function safeColor(value, fallback = null) {
  return typeof value === 'string' && HEX_RE.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

/** Only an absolute https URL may be used as an <img src>. */
export function safeImageUrl(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!/^https:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

// --- colour maths ----------------------------------------------------------

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  if (ss === 0) {
    const v = ll * 255;
    return rgbToHex(v, v, v);
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const channel = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return rgbToHex(channel(hh + 1 / 3) * 255, channel(hh) * 255, channel(hh - 1 / 3) * 255);
}

/** WCAG relative luminance. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const lin = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const AA_CONTRAST = 4.5;

/**
 * Pick readable ink for a filled colour: whichever of the brand-tinted dark or
 * white actually reads better. `darkInk` must be a dark colour — a filled CTA
 * needs ink chosen for the fill it sits on, not for the page's light/dark mode.
 */
export function inkOn(background, darkInk, lightInk = '#ffffff') {
  return contrastRatio(background, darkInk) >= contrastRatio(background, lightInk) ? darkInk : lightInk;
}

/**
 * Nudge a fill's lightness until some ink can sit on it at AA contrast.
 *
 * A brand colour like #ff0088 leaves neither white nor near-black readable at
 * its native lightness, which would ship a CTA nobody can read. Walking the
 * lightness outward finds the nearest passing shade, so the colour still looks
 * like the business's brand while the text on it stays legible.
 */
export function ensureReadableFill(hex, darkInk, target = AA_CONTRAST) {
  const passes = (candidate) =>
    Math.max(contrastRatio(candidate, darkInk), contrastRatio(candidate, '#ffffff')) >= target;
  if (passes(hex)) return hex;

  const { h, s, l } = hexToHsl(hex);
  for (let delta = 1; delta <= 70; delta += 1) {
    const darker = hslToHex(h, s, l - delta);
    if (l - delta >= 0 && passes(darker)) return darker;
    const lighter = hslToHex(h, s, l + delta);
    if (l + delta <= 100 && passes(lighter)) return lighter;
  }
  // Unreachable for any sRGB input, but never return an unreadable fill.
  return hslToHex(h, s, 28);
}

// --- palette ---------------------------------------------------------------

const DEFAULT_PRIMARY = '#1f3a8a';
const DEFAULT_ACCENT = '#e0653a';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Derive the full working palette from whatever the business supplied.
 *
 * Loud or washed-out brand colours are pulled into a usable band rather than
 * rejected, so the business still recognizes its brand while the composition
 * stays legible. Neutrals carry a trace of the brand hue — that shared tint is
 * what makes the set read as one designed system instead of a colour swap.
 */
export function buildPalette({ primaryColor, secondaryColor, accentColor, backgroundStyle = 'light' } = {}) {
  const primaryRaw = safeColor(primaryColor) || DEFAULT_PRIMARY;
  const p = hexToHsl(primaryRaw);

  /*
   * A grey, black, or near-white brand colour has no hue to work with. Forcing
   * it up to a minimum saturation would invent one — a white brand would come
   * out brown — so achromatic brands stay achromatic and simply darken into a
   * usable charcoal.
   */
  const achromatic = p.s < 10;
  const brandS = achromatic ? clamp(p.s, 0, 10) : clamp(p.s, 32, 82);
  const brandL = achromatic ? clamp(p.l, 18, 34) : clamp(p.l, 32, 56);

  /*
   * Ink for filled areas (CTA, brand panels) is always the dark tint, whatever
   * the page mode: text on a coloured button is chosen for the button.
   */
  const fillInk = hslToHex(p.h, achromatic ? 0 : 22, 13);

  // Normalize the brand colour into a band that can carry large filled areas.
  const brand = ensureReadableFill(hslToHex(p.h, brandS, brandL), fillInk);
  const brandDeep = hslToHex(p.h, achromatic ? brandS : clamp(p.s, 28, 70), clamp(brandL * 0.55, 12, 26));
  const brandSoft = hslToHex(p.h, achromatic ? clamp(brandS, 0, 8) : clamp(p.s, 20, 55), clamp(brandL + 50, 82, 93));

  // Support colour: the secondary if usable, otherwise an analogous shift.
  const secondaryRaw = safeColor(secondaryColor);
  const support = secondaryRaw
    ? (() => {
        const s = hexToHsl(secondaryRaw);
        if (s.s < 10) return hslToHex(s.h, clamp(s.s, 0, 10), clamp(s.l, 34, 62));
        return hslToHex(s.h, clamp(s.s, 18, 70), clamp(s.l, 34, 62));
      })()
    : hslToHex(p.h + 28, clamp(p.s * 0.7, 18, 55), clamp(p.l + 8, 40, 62));

  // Accent is used sparingly, so it keeps more of its punch — but it carries
  // the CTA label, so it still has to be readable.
  const accentRaw = safeColor(accentColor) || safeColor(secondaryColor) || DEFAULT_ACCENT;
  const a = hexToHsl(accentRaw);
  const accent = ensureReadableFill(hslToHex(a.h, clamp(a.s, 45, 92), clamp(a.l, 38, 60)), fillInk);

  const dark = backgroundStyle === 'dark';

  /*
   * Neutrals carry a trace of the brand hue rather than being flat greys —
   * that shared tint is what makes the whole set read as one designed system.
   * An achromatic brand has no hue to borrow, so its neutrals stay true grey.
   */
  const tint = (amount) => (achromatic ? 0 : amount);
  const wash = dark ? hslToHex(p.h, tint(16), 11) : hslToHex(p.h, tint(14), 97);
  const surface = dark ? hslToHex(p.h, tint(14), 15) : hslToHex(p.h, tint(18), 99);
  const ink = dark ? hslToHex(p.h, tint(10), 96) : hslToHex(p.h, tint(22), 13);
  const muted = dark ? hslToHex(p.h, tint(8), 72) : hslToHex(p.h, tint(10), 42);
  const hairline = dark ? hslToHex(p.h, tint(12), 26) : hslToHex(p.h, tint(16), 88);

  return {
    brand,
    brandDeep: dark ? brandSoft : brandDeep,
    brandSoft: dark ? brandDeep : brandSoft,
    support,
    accent,
    wash,
    surface,
    ink,
    muted,
    hairline,
    // Chosen for the fill, not the page mode.
    onBrand: inkOn(brand, fillInk),
    onAccent: inkOn(accent, fillInk),
    isDark: dark,
  };
}

// --- typography ------------------------------------------------------------

const SERIF_HINTS = [
  'serif', 'playfair', 'georgia', 'merriweather', 'lora', 'times', 'garamond',
  'baskerville', 'cormorant', 'crimson', 'spectral', 'bitter', 'rockwell',
  'slab', 'bodoni', 'didot', 'caslon', 'palatino', 'cambria', 'tinos',
];
const MONO_HINTS = ['mono', 'consolas', 'courier', 'menlo', 'inconsolata', 'iosevka', 'hack'];
const CONDENSED_HINTS = ['condensed', 'narrow', 'compressed', 'oswald', 'anton', 'bebas', 'archivo narrow'];

const STACKS = {
  sans: "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', 'Palatino Linotype', serif",
  mono: "ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace",
  condensed: "'Arial Narrow', 'Helvetica Neue Condensed', 'Segoe UI', Arial, sans-serif",
};

/**
 * Classify a brand font label into a style category.
 *
 * Font files are never downloaded, so a label alone cannot render. Classifying
 * it and rendering the closest system stack keeps a serif brand looking like a
 * serif brand instead of collapsing every business onto one generic sans.
 */
export function fontCategory(label) {
  if (typeof label !== 'string' || !FONT_NAME_RE.test(label.trim())) return 'sans';
  const name = label.trim().toLowerCase();
  if (MONO_HINTS.some((h) => name.includes(h))) return 'mono';
  if (SERIF_HINTS.some((h) => name.includes(h))) return 'serif';
  if (CONDENSED_HINTS.some((h) => name.includes(h))) return 'condensed';
  return 'sans';
}

/**
 * Build a font stack for a brand label. The label leads (in case the rendering
 * browser happens to have it) and a matching system stack always follows.
 */
export function fontStack(label) {
  const category = fontCategory(label);
  const named = typeof label === 'string' && FONT_NAME_RE.test(label.trim()) ? `'${label.trim()}', ` : '';
  return `${named}${STACKS[category]}`;
}

/**
 * Size the headline to its own length.
 *
 * A fixed size makes short headlines look timid and long ones overflow, which
 * is exactly what makes a generated graphic read as a text dump. Bucketing by
 * character count keeps the type block optically similar at any length.
 */
export function headlineScale(headline, { base = 1 } = {}) {
  const len = String(headline || '').length;
  let size;
  let leading;
  let tracking;
  if (len <= 18) { size = 118; leading = 0.98; tracking = -0.03; }
  else if (len <= 32) { size = 96; leading = 1.02; tracking = -0.025; }
  else if (len <= 48) { size = 78; leading = 1.06; tracking = -0.02; }
  else if (len <= 64) { size = 64; leading = 1.1; tracking = -0.015; }
  else { size = 54; leading = 1.14; tracking = -0.01; }
  return {
    size: Math.round(size * base),
    leading,
    tracking: `${tracking}em`,
  };
}

/** Sub-headline sizing follows the headline so the pair stays in proportion. */
export function subheadlineScale(sub, { base = 1 } = {}) {
  const len = String(sub || '').length;
  const size = len <= 60 ? 34 : len <= 100 ? 30 : 27;
  return { size: Math.round(size * base), leading: 1.4 };
}

// --- text ------------------------------------------------------------------

/** Hard-cap text at the documented limits so no layout can be overrun. */
export function clampText(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Derive the eyebrow label shown above the headline.
 *
 * It names the business or its category — never invented marketing copy.
 */
export function eyebrowFrom({ brandName, businessCategory }) {
  const source = brandName || businessCategory || '';
  return clampText(source, 34).toUpperCase();
}

export const TEXT_LIMITS = Object.freeze({
  HEADLINE: IMAGE_TEXT_LIMITS.HEADLINE_MAX,
  SUBHEADLINE: IMAGE_TEXT_LIMITS.SUBHEADLINE_MAX,
  CTA: 40,
  WEBSITE: 60,
  PHONE: 32,
  BRAND: 40,
  TAG: 28,
});

export default {
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
  contrastRatio,
  inkOn,
  ensureReadableFill,
  hexToHsl,
  hslToHex,
  luminance,
  TEXT_LIMITS,
  AA_CONTRAST,
};
