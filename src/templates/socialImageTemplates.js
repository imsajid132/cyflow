/**
 * Trusted, server-owned social image templates.
 *
 * Templates emit escaped user text into a fixed HTML structure (class names
 * only — no inline styles, scripts, iframes, forms, or event handlers) plus a
 * preset CSS string. All CSS is server-owned; nothing is taken from client
 * input. User text is HTML-escaped and never becomes executable markup. Only
 * system fonts are used (no external fetches → no SSRF via web fonts).
 */

import { ASPECT_RATIOS, IMAGE_TEMPLATES, BACKGROUND_STYLES } from '../config/constants.js';

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

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const BACKGROUNDS = {
  light: { bg: '#ffffff', fg: '#0f172a', muted: '#475569', accent: '#4f46e5' },
  dark: { bg: '#0f172a', fg: '#f8fafc', muted: '#cbd5e1', accent: '#818cf8' },
  'gradient-blue': {
    bg: 'linear-gradient(135deg,#4f46e5 0%,#0ea5e9 100%)',
    fg: '#ffffff',
    muted: 'rgba(255,255,255,0.85)',
    accent: '#ffffff',
  },
  'gradient-warm': {
    bg: 'linear-gradient(135deg,#f59e0b 0%,#ef4444 100%)',
    fg: '#ffffff',
    muted: 'rgba(255,255,255,0.9)',
    accent: '#ffffff',
  },
  neutral: { bg: '#f1f5f9', fg: '#0f172a', muted: '#475569', accent: '#4f46e5' },
};

function dims(aspectRatio) {
  return ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS.square;
}

function baseCss(width, height, palette) {
  return `
    * { margin:0; padding:0; box-sizing:border-box; }
    html,body { width:${width}px; height:${height}px; }
    .card {
      width:${width}px; height:${height}px; display:flex; overflow:hidden;
      background:${palette.bg}; color:${palette.fg};
      font-family:${FONT_STACK}; -webkit-font-smoothing:antialiased;
    }
    .inner { width:100%; height:100%; display:flex; flex-direction:column; padding:8%; }
    .brand { font-size:26px; font-weight:700; letter-spacing:0.04em; color:${palette.accent}; }
    .headline { color:${palette.fg}; line-height:1.08; }
    .subheadline { color:${palette.muted}; line-height:1.35; }
  `;
}

const TEMPLATE_CSS = {
  minimal: `
    .tpl-minimal .inner { justify-content:center; align-items:center; text-align:center; gap:20px; }
    .tpl-minimal .brand { margin-bottom:8px; text-transform:uppercase; }
    .tpl-minimal .headline { font-size:64px; font-weight:600; max-width:88%; }
    .tpl-minimal .subheadline { font-size:30px; font-weight:400; max-width:80%; }
  `,
  bold: `
    .tpl-bold .inner { justify-content:flex-end; gap:16px; }
    .tpl-bold .brand { font-size:30px; text-transform:uppercase; }
    .tpl-bold .headline { font-size:84px; font-weight:800; text-transform:uppercase; max-width:100%; }
    .tpl-bold .subheadline { font-size:34px; font-weight:600; max-width:90%; }
  `,
  professional: `
    .tpl-professional .inner { justify-content:center; gap:22px; border-left:10px solid ${'{accent}'}; padding-left:9%; }
    .tpl-professional .brand { font-size:24px; letter-spacing:0.08em; text-transform:uppercase; }
    .tpl-professional .headline { font-size:60px; font-weight:700; max-width:94%; }
    .tpl-professional .subheadline { font-size:28px; font-weight:400; max-width:84%; }
  `,
};

/**
 * Build the trusted HTML + CSS for an image template.
 * @param {{ template, aspectRatio, backgroundStyle, brandName, headline, subheadline }} input
 * @returns {{ html:string, css:string, width:number, height:number }}
 */
export function buildTemplate(input) {
  const template = IMAGE_TEMPLATES.includes(input.template) ? input.template : 'minimal';
  const backgroundStyle = BACKGROUND_STYLES.includes(input.backgroundStyle)
    ? input.backgroundStyle
    : 'light';
  const palette = BACKGROUNDS[backgroundStyle] || BACKGROUNDS.light;
  const { width, height } = dims(input.aspectRatio);

  const brand = escapeHtml(input.brandName || '');
  const headline = escapeHtml(input.headline || '');
  const subheadline = escapeHtml(input.subheadline || '');

  const brandHtml = brand ? `<div class="brand">${brand}</div>` : '';
  const subHtml = subheadline ? `<p class="subheadline">${subheadline}</p>` : '';

  const html =
    `<div class="card tpl-${template}">` +
    `<div class="inner">${brandHtml}<h1 class="headline">${headline}</h1>${subHtml}</div>` +
    `</div>`;

  const templateCss = (TEMPLATE_CSS[template] || TEMPLATE_CSS.minimal).replace(
    '{accent}',
    palette.accent,
  );
  const css = `${baseCss(width, height, palette)}\n${templateCss}`;

  return { html, css, width, height };
}

export default { buildTemplate, escapeHtml };
