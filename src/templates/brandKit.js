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
 * Nudge a colour's lightness until it is readable ON a given background.
 *
 * Brand-coloured text (eyebrows, the big stat figure) sits directly on the
 * canvas. A dark navy brand on a dark canvas is invisible, so the shade — not
 * the hue — is adjusted until it passes. The hue is what the business
 * recognizes; the lightness is ours to solve with.
 */
export function ensureReadableOn(hex, background, target = AA_CONTRAST) {
  if (contrastRatio(hex, background) >= target) return hex;
  const { h, s, l } = hexToHsl(hex);
  // Move away from the background's lightness first — that is the direction
  // that can actually gain contrast.
  const bgLight = luminance(background) > 0.4;
  const order = bgLight ? [-1, 1] : [1, -1];
  for (let delta = 1; delta <= 100; delta += 1) {
    for (const direction of order) {
      const candidate = hslToHex(h, s, l + direction * delta);
      const next = l + direction * delta;
      if (next < 0 || next > 100) continue;
      if (contrastRatio(candidate, background) >= target) return candidate;
    }
  }
  return bgLight ? hslToHex(h, s, 12) : hslToHex(h, s, 94);
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
/** Used only when every saved colour is too light to be a field. */
const NEUTRAL_CANVAS = '#141719';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** Chroma proxy: how much colour a hex actually carries (0..100). */
export function chromaOf(hex) {
  const { s, l } = hexToHsl(hex);
  // A saturated colour at L=0 or L=100 still reads as black/white, so weight
  // saturation by how far the colour is from those extremes.
  return s * (1 - Math.abs(l - 50) / 50);
}

/**
 * Assign each saved brand colour a ROLE rather than mutating its value.
 *
 * This is the correction to the earlier design, which clamped every brand
 * colour into a mid lightness band so it could "carry a filled area". That
 * destroyed exactly the palettes real brands use: a near-black primary like
 * #111827 was forced up to L=32% and came out as an unrelated mid-blue.
 *
 * Taste comes from WHERE a colour is used and HOW MUCH area it gets — not from
 * rewriting the hex. So the values are preserved exactly and sorted into roles:
 *
 *   canvas   — the darkest/most neutral colour, used as a large field
 *   accent   — the most chromatic bright colour, used sparingly (CTA, emphasis)
 *   support  — the next most chromatic, used for secondary marks
 *
 * @returns {{ canvas, accent, support, source: 'saved_brand_palette'|'fallback_palette',
 *             adjusted: string[], provided: string[] }}
 */
export function resolveBrandRoles({ primaryColor, secondaryColor, accentColor } = {}) {
  const provided = [
    ['primary', safeColor(primaryColor)],
    ['secondary', safeColor(secondaryColor)],
    ['accent', safeColor(accentColor)],
  ].filter(([, hex]) => Boolean(hex));

  if (provided.length === 0) {
    return {
      canvas: DEFAULT_PRIMARY,
      accent: DEFAULT_ACCENT,
      support: DEFAULT_ACCENT,
      source: 'fallback_palette',
      provided: [],
    };
  }

  const hexes = provided.map(([, hex]) => hex);
  const byLuminance = [...hexes].sort((a, b) => luminance(a) - luminance(b));
  const byChroma = [...hexes].sort((a, b) => chromaOf(b) - chromaOf(a));

  /*
   * The canvas is the darkest saved colour. If every saved colour is near-white
   * there is no field to fill — white on white is not a design — so the canvas
   * role falls back to a NEUTRAL near-black. A neutral is not "an unrelated
   * blue": it introduces no hue the brand did not have.
   */
  let canvas = byLuminance[0];
  let canvasFallback = false;
  if (luminance(canvas) > 0.85) {
    canvas = NEUTRAL_CANVAS;
    canvasFallback = true;
  }

  // The accent must not be the canvas, and should be the most colourful thing
  // available — that is what a CTA wants.
  const accent = byChroma.find((h) => h !== canvas) || byChroma[0];
  const support = byChroma.find((h) => h !== canvas && h !== accent) || accent;

  return {
    canvas,
    accent,
    support,
    source: 'saved_brand_palette',
    canvasFallback,
    provided: hexes,
  };
}

/**
 * Derive the working palette from whatever the business supplied.
 *
 * Saved brand colours are used EXACTLY. The only permitted change is a
 * readability adjustment when text could not otherwise sit on a fill, and every
 * such adjustment is reported in `adjusted` so it is visible rather than silent.
 */
export function buildPalette({ primaryColor, secondaryColor, accentColor, backgroundStyle = 'light' } = {}) {
  const roles = resolveBrandRoles({ primaryColor, secondaryColor, accentColor });
  const adjusted = [];

  const canvasHsl = hexToHsl(roles.canvas);
  const achromatic = canvasHsl.s < 10;
  const canvasIsDark = luminance(roles.canvas) < 0.18;

  /*
   * Ink for filled areas is always dark, whatever the page mode: text on a
   * coloured button is chosen for the button, not for the page.
   */
  const fillInk = hslToHex(canvasHsl.h, achromatic ? 0 : 18, 12);

  // Exact, unless text genuinely cannot sit on them.
  const brand = keepOrAdjust(roles.canvas, fillInk, 'brand', adjusted);
  const accent = keepOrAdjust(roles.accent, fillInk, 'accent', adjusted);
  const support = keepOrAdjust(roles.support, fillInk, 'support', adjusted);

  // Derived shades of the brand colour, for depth. These are DERIVED, so they
  // may move — the saved value itself is still available as `brand`.
  const brandDeep = hslToHex(canvasHsl.h, canvasHsl.s, clamp(canvasHsl.l * 0.6, 4, 22));
  const brandSoft = hslToHex(canvasHsl.h, achromatic ? clamp(canvasHsl.s, 0, 8) : clamp(canvasHsl.s * 0.5, 8, 40), 92);

  const dark = backgroundStyle === 'dark';

  /*
   * Neutrals carry a trace of the brand hue rather than being flat greys — that
   * shared tint is what makes the set read as one designed system. An
   * achromatic brand has no hue to borrow, so its neutrals stay true grey.
   */
  const tint = (amount) => (achromatic ? 0 : amount);
  const wash = dark ? hslToHex(canvasHsl.h, tint(16), 11) : hslToHex(canvasHsl.h, tint(12), 97);
  // Still a tint, never pure white: the shared trace of brand hue is what makes
  // the surfaces read as one system.
  const surface = dark ? hslToHex(canvasHsl.h, tint(14), 15) : hslToHex(canvasHsl.h, tint(10), 99);
  const ink = dark ? hslToHex(canvasHsl.h, tint(8), 96) : hslToHex(canvasHsl.h, tint(18), 12);
  const muted = dark ? hslToHex(canvasHsl.h, tint(8), 72) : hslToHex(canvasHsl.h, tint(10), 44);
  const hairline = dark ? hslToHex(canvasHsl.h, tint(12), 26) : hslToHex(canvasHsl.h, tint(14), 89);

  return {
    brand,
    brandDeep,
    brandSoft,
    support,
    accent,
    wash,
    surface,
    ink,
    muted,
    hairline,
    // Brand-coloured TEXT sitting on the canvas. The fill shades are chosen for
    // text-on-them; these are chosen for them-on-the-canvas — the opposite
    // problem, so they are computed separately.
    brandOnWash: ensureReadableOn(brand, wash),
    accentOnWash: ensureReadableOn(accent, wash),
    onBrand: inkOn(brand, fillInk),
    onAccent: inkOn(accent, fillInk),
    onSupport: inkOn(support, fillInk),
    isDark: dark,
    // True when the saved primary is dark enough to be a full-bleed field. The
    // layouts use this to pick a dark composition rather than pasting a dark
    // brand onto a light wash.
    canvasIsDark,
    /*
     * Provenance, surfaced in image metadata for debugging. `adjusted` names any
     * role whose value had to move for legibility, so a mismatch between the
     * saved palette and the render is never a mystery.
     */
    source: roles.source,
    adjusted,
    providedColors: roles.provided,
  };
}

/** Keep a colour exactly unless no ink can sit on it; record any change. */
function keepOrAdjust(hex, fillInk, role, adjusted) {
  const safe = ensureReadableFill(hex, fillInk);
  if (safe.toLowerCase() !== hex.toLowerCase()) adjusted.push(role);
  return safe;
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
  const text = String(headline || '');
  const len = text.length;
  let size;
  let leading;
  let tracking;
  if (len <= 18) { size = 108; leading = 1; tracking = -0.03; }
  else if (len <= 32) { size = 90; leading = 1.04; tracking = -0.025; }
  else if (len <= 48) { size = 74; leading = 1.08; tracking = -0.02; }
  else if (len <= 64) { size = 62; leading = 1.1; tracking = -0.015; }
  else { size = 52; leading = 1.14; tracking = -0.01; }

  /*
   * Step down once more when one word is long enough to be stranded on its own
   * line. A single-word line is the most visible sign of a machine-set headline,
   * and the spec is explicit: shrink before allowing one.
   */
  const longestWord = text.split(/\s+/).reduce((max, w) => Math.max(max, w.length), 0);
  if (longestWord >= 11 && size > 60) size = Math.round(size * 0.88);

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
  // The FAQ answer panel is sized for a short paragraph, not a support line.
  // Measured against the rendered card: 260 fills the panel without overflowing
  // it at the smallest supported answer type size.
  ANSWER: 260,
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
  resolveBrandRoles,
  chromaOf,
  fontStack,
  fontCategory,
  headlineScale,
  subheadlineScale,
  clampText,
  eyebrowFrom,
  contrastRatio,
  inkOn,
  ensureReadableFill,
  ensureReadableOn,
  hexToHsl,
  hslToHex,
  luminance,
  TEXT_LIMITS,
  AA_CONTRAST,
};
