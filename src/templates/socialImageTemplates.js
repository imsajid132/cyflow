/**
 * Trusted, server-owned branded social image templates.
 *
 * Templates emit escaped user text into a fixed structure (class names only —
 * no inline styles, scripts, iframes, forms, or event handlers) plus a preset
 * CSS string built ONLY from validated values:
 *   - colours must match #rrggbb (else the preset palette is used)
 *   - font names must match a strict plain-name pattern (else a system stack)
 *   - the logo URL must be absolute https (else no logo is rendered)
 * User text is HTML-escaped and never becomes executable markup. Only system
 * fonts are loaded — nothing is fetched from an analyzed website at render time
 * except the business's own validated logo, which HCTI loads as an image.
 *
 * Layouts: Clean Editorial, Bold Service, Professional Local Business, and
 * Photo Overlay Ready (a real background-image slot — we never invent a photo).
 */

import {
  ASPECT_RATIOS,
  IMAGE_TEMPLATES,
  BACKGROUND_STYLES,
  LEGACY_IMAGE_TEMPLATE_ALIASES,
} from '../config/constants.js';

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

const SYSTEM_FONTS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FONT_NAME_RE = /^[A-Za-z0-9 _-]{1,80}$/;

/** Only a validated hex colour may reach the CSS. */
export function safeColor(value, fallback) {
  return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

/** Only a validated plain font name may reach the CSS (no url(), no quotes). */
export function safeFontStack(name) {
  if (typeof name === 'string' && FONT_NAME_RE.test(name.trim())) {
    return `'${name.trim()}', ${SYSTEM_FONTS}`;
  }
  return SYSTEM_FONTS;
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

const BACKGROUNDS = {
  light: { bg: '#ffffff', fg: '#0f172a', muted: '#475569', accent: '#4f46e5' },
  dark: { bg: '#0f172a', fg: '#f8fafc', muted: '#cbd5e1', accent: '#818cf8' },
  'gradient-blue': { bg: 'linear-gradient(135deg,#4f46e5 0%,#0ea5e9 100%)', fg: '#ffffff', muted: 'rgba(255,255,255,.88)', accent: '#ffffff' },
  'gradient-warm': { bg: 'linear-gradient(135deg,#f59e0b 0%,#ef4444 100%)', fg: '#ffffff', muted: 'rgba(255,255,255,.9)', accent: '#ffffff' },
  neutral: { bg: '#f1f5f9', fg: '#0f172a', muted: '#475569', accent: '#4f46e5' },
};

function normalizeTemplate(name) {
  if (IMAGE_TEMPLATES.includes(name)) return name;
  if (LEGACY_IMAGE_TEMPLATE_ALIASES[name]) return LEGACY_IMAGE_TEMPLATE_ALIASES[name];
  return 'editorial';
}

function dims(aspectRatio) {
  return ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS.square;
}

/** Relative luminance → pick readable ink for a solid brand colour. */
function readableInk(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return L > 0.55 ? '#0f172a' : '#ffffff';
}

function baseCss(width, height, t) {
  return `
    * { margin:0; padding:0; box-sizing:border-box; }
    html,body { width:${width}px; height:${height}px; }
    .card {
      position:relative; width:${width}px; height:${height}px; display:flex; overflow:hidden;
      background:${t.canvas}; color:${t.fg}; font-family:${t.bodyFont};
      -webkit-font-smoothing:antialiased;
    }
    .inner { position:relative; z-index:2; width:100%; height:100%; display:flex; flex-direction:column; padding:7%; }
    .logo { height:64px; max-width:44%; object-fit:contain; }
    .brand { font-size:26px; font-weight:700; letter-spacing:.02em; color:${t.accent}; }
    .headline { font-family:${t.headingFont}; color:${t.fg}; line-height:1.06; }
    .subheadline { color:${t.muted}; line-height:1.35; }
    .meta { display:flex; gap:18px; flex-wrap:wrap; align-items:center; font-size:24px; color:${t.muted}; }
    .cta {
      display:inline-block; align-self:flex-start; padding:14px 26px; border-radius:999px;
      background:${t.accent}; color:${t.ctaInk}; font-weight:700; font-size:26px;
    }
    .rule { height:6px; width:96px; border-radius:6px; background:${t.accent}; }
    /* Geometric brand accents — deliberately abstract; we never fabricate a photo. */
    .accent-blob {
      position:absolute; z-index:1; border-radius:50%; opacity:.18;
      background:${t.secondary}; width:${Math.round(width * 0.62)}px; height:${Math.round(width * 0.62)}px;
      right:${-Math.round(width * 0.22)}px; top:${-Math.round(width * 0.18)}px;
    }
    .accent-bar { position:absolute; z-index:1; left:0; top:0; bottom:0; width:14px; background:${t.accent}; }
    .accent-corner {
      position:absolute; z-index:1; right:0; bottom:0; width:0; height:0;
      border-left:${Math.round(width * 0.3)}px solid transparent;
      border-bottom:${Math.round(width * 0.3)}px solid ${t.secondary}; opacity:.22;
    }
    /* Photo Overlay Ready: a real background-image slot for a future provider. */
    .photo-slot { position:absolute; inset:0; z-index:0; background:${t.photoSlot}; }
    .scrim { position:absolute; inset:0; z-index:1; background:linear-gradient(180deg, rgba(2,6,23,.15) 0%, rgba(2,6,23,.78) 100%); }
  `;
}

const LAYOUT_CSS = {
  editorial: `
    .tpl-editorial .inner { justify-content:center; gap:22px; }
    .tpl-editorial .top { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .tpl-editorial .headline { font-size:66px; font-weight:600; max-width:94%; letter-spacing:-.01em; }
    .tpl-editorial .subheadline { font-size:30px; max-width:84%; }
    .tpl-editorial .foot { margin-top:auto; display:flex; align-items:center; justify-content:space-between; gap:16px; }
  `,
  'bold-service': `
    .tpl-bold-service .inner { justify-content:flex-end; gap:18px; }
    .tpl-bold-service .top { display:flex; align-items:center; gap:16px; margin-bottom:auto; }
    .tpl-bold-service .headline { font-size:88px; font-weight:800; text-transform:uppercase; letter-spacing:-.02em; }
    .tpl-bold-service .subheadline { font-size:32px; font-weight:600; max-width:88%; }
    .tpl-bold-service .foot { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
  `,
  'professional-local': `
    .tpl-professional-local .inner { justify-content:center; gap:20px; padding-left:9%; }
    .tpl-professional-local .top { display:flex; align-items:center; gap:16px; }
    .tpl-professional-local .headline { font-size:60px; font-weight:700; max-width:92%; }
    .tpl-professional-local .subheadline { font-size:28px; max-width:82%; }
    .tpl-professional-local .foot { margin-top:auto; display:flex; flex-direction:column; gap:12px; }
  `,
  'photo-overlay': `
    .tpl-photo-overlay .card { color:#fff; }
    .tpl-photo-overlay .inner { justify-content:flex-end; gap:16px; }
    .tpl-photo-overlay .top { display:flex; align-items:center; gap:16px; margin-bottom:auto; }
    .tpl-photo-overlay .headline { font-size:74px; font-weight:750; color:#fff; max-width:94%; }
    .tpl-photo-overlay .subheadline { font-size:30px; color:rgba(255,255,255,.92); max-width:86%; }
    .tpl-photo-overlay .brand { color:#fff; }
    .tpl-photo-overlay .meta { color:rgba(255,255,255,.9); }
    .tpl-photo-overlay .foot { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
  `,
};

/**
 * Build the trusted HTML + CSS for a branded image.
 * @param {{ template, aspectRatio, backgroundStyle, brandName, headline,
 *           subheadline, logoUrl, primaryColor, secondaryColor, accentColor,
 *           headingFont, bodyFont, cta, website, phone }} input
 * @returns {{ html:string, css:string, width:number, height:number, template:string }}
 */
export function buildTemplate(input = {}) {
  const template = normalizeTemplate(input.template);
  const backgroundStyle = BACKGROUND_STYLES.includes(input.backgroundStyle) ? input.backgroundStyle : 'light';
  const palette = BACKGROUNDS[backgroundStyle] || BACKGROUNDS.light;
  const { width, height } = dims(input.aspectRatio);

  // Brand colours (validated) take precedence over the preset palette.
  const primary = safeColor(input.primaryColor, null);
  const secondary = safeColor(input.secondaryColor, null) || primary || palette.accent;
  const accent = safeColor(input.accentColor, null) || primary || palette.accent;

  const isPhoto = template === 'photo-overlay';
  const canvas = isPhoto ? '#0f172a' : primary && backgroundStyle === 'light' ? '#ffffff' : palette.bg;
  const fg = isPhoto ? '#ffffff' : palette.fg;

  const t = {
    canvas,
    fg,
    muted: isPhoto ? 'rgba(255,255,255,.9)' : palette.muted,
    accent,
    secondary,
    ctaInk: readableInk(accent),
    headingFont: safeFontStack(input.headingFont),
    bodyFont: safeFontStack(input.bodyFont),
    // The slot a future image provider fills; until then, a brand-tinted wash.
    photoSlot: `linear-gradient(135deg, ${secondary} 0%, ${accent} 100%)`,
  };

  const brand = escapeHtml(input.brandName || '');
  const headline = escapeHtml(input.headline || '');
  const subheadline = escapeHtml(input.subheadline || '');
  const cta = escapeHtml(input.cta || '');
  const website = escapeHtml(input.website || '');
  const phone = escapeHtml(input.phone || '');
  const logo = safeImageUrl(input.logoUrl);

  const logoHtml = logo ? `<img class="logo" src="${escapeHtml(logo)}" alt="">` : '';
  const brandHtml = brand ? `<span class="brand">${brand}</span>` : '';
  const topHtml = logoHtml || brandHtml ? `<div class="top">${logoHtml}${logoHtml && brandHtml ? '' : brandHtml}</div>` : '';

  const metaBits = [];
  if (website) metaBits.push(`<span>${website}</span>`);
  if (phone) metaBits.push(`<span>${phone}</span>`);
  const metaHtml = metaBits.length ? `<div class="meta">${metaBits.join('')}</div>` : '';
  const ctaHtml = cta ? `<span class="cta">${cta}</span>` : '';
  const subHtml = subheadline ? `<p class="subheadline">${subheadline}</p>` : '';

  const decor = isPhoto
    ? '<div class="photo-slot"></div><div class="scrim"></div>'
    : template === 'professional-local'
      ? '<div class="accent-bar"></div><div class="accent-corner"></div>'
      : '<div class="accent-blob"></div>';

  const footHtml =
    ctaHtml || metaHtml ? `<div class="foot">${ctaHtml}${metaHtml}</div>` : '';

  const html =
    `<div class="card tpl-${template}">${decor}` +
    `<div class="inner">${topHtml}` +
    (template === 'editorial' ? '<div class="rule"></div>' : '') +
    `<h1 class="headline">${headline}</h1>${subHtml}${footHtml}</div></div>`;

  const css = `${baseCss(width, height, t)}\n${LAYOUT_CSS[template] || LAYOUT_CSS.editorial}`;
  return { html, css, width, height, template };
}

export default { buildTemplate, escapeHtml, safeColor, safeFontStack, safeImageUrl };
