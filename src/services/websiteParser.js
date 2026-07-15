/**
 * Safe website HTML parsing / brand extraction.
 *
 * Pure functions over already-fetched HTML — no network, no script execution,
 * no form submission. `node-html-parser` builds an inert tree; nothing from the
 * page is ever evaluated. Everything returned is plain text/URLs that the user
 * reviews and edits before it is saved.
 */

import { parse } from 'node-html-parser';

import { WEBSITE_ANALYSIS, BUSINESS_LIMITS } from '../config/constants.js';
import { isSameSite, isDisallowedPath } from '../utils/urlSafety.js';

const SOCIAL_HOSTS = [
  'facebook.com',
  'instagram.com',
  'threads.net',
  'threads.com',
  'linkedin.com',
  'youtube.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'pinterest.com',
];

function clean(value, max) {
  if (typeof value !== 'string') return '';
  const s = value.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** Resolve a possibly-relative URL against a base; null when unusable. */
function resolveUrl(href, base) {
  if (typeof href !== 'string' || href.trim() === '') return null;
  const raw = href.trim();
  if (/^(javascript|data|vbscript|file|blob):/i.test(raw)) return null;
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

// --- colors ---------------------------------------------------------------

/** Normalize a CSS color to #rrggbb, or null. */
export function toHexColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) {
    const [r, g, b] = m[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(v);
  if (m) {
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    if (!Number.isFinite(alpha) || alpha < 0.5) return null; // effectively transparent
    const nums = [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
    if (nums.some((n) => !Number.isFinite(n))) return null;
    return `#${nums.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** True for white/near-white, black/near-black, or washed-out utility greys. */
export function isUtilityColor(hex) {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2 / 255;
  const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  if (lightness > 0.93) return true; // white / near-white
  if (lightness < 0.07) return true; // black / near-black
  if (saturation < 0.12) return true; // greys / low-value utility colors
  return false;
}

/** Collect brand-color candidates from <style> blocks + inline style attrs. */
export function extractColors(root) {
  const counts = new Map();
  const bump = (raw) => {
    const hex = toHexColor(raw);
    if (!hex || isUtilityColor(hex)) return;
    counts.set(hex, (counts.get(hex) || 0) + 1);
  };

  const cssChunks = [];
  root.querySelectorAll('style').forEach((el) => cssChunks.push(el.text || ''));
  root.querySelectorAll('[style]').forEach((el) => cssChunks.push(el.getAttribute('style') || ''));
  const css = cssChunks.join('\n');

  // CSS custom properties are the strongest brand signal — weight them.
  for (const m of css.matchAll(/--[\w-]*(?:color|brand|primary|secondary|accent)[\w-]*\s*:\s*([^;}\n]+)/gi)) {
    const hex = toHexColor(m[1]);
    if (hex && !isUtilityColor(hex)) counts.set(hex, (counts.get(hex) || 0) + 5);
  }
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,6}\b/g)) bump(m[0]);
  for (const m of css.matchAll(/rgba?\([^)]*\)/gi)) bump(m[0]);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, WEBSITE_ANALYSIS.MAX_COLORS)
    .map(([hex]) => hex);
}

// --- fonts ----------------------------------------------------------------

/** Return a safe font label from a font-family declaration. */
export function firstFontName(declaration) {
  if (typeof declaration !== 'string') return '';
  const first = declaration.split(',')[0] || '';
  const name = first.replace(/["']/g, '').trim();
  // Only plain font names — never URLs or expressions.
  if (!/^[A-Za-z0-9 _-]{1,80}$/.test(name)) return '';
  if (/^(inherit|initial|unset|revert|var)$/i.test(name)) return '';
  return clean(name, BUSINESS_LIMITS.FONT_MAX);
}

/** Detect heading/body fonts. Never downloads font files. */
export function extractFonts(root) {
  const cssChunks = [];
  root.querySelectorAll('style').forEach((el) => cssChunks.push(el.text || ''));
  const css = cssChunks.join('\n');

  const pick = (re) => {
    const m = re.exec(css);
    return m ? firstFontName(m[1]) : '';
  };

  // Prefer explicit CSS variables, then heading/body rules.
  const headingVar = pick(/--[\w-]*(?:heading|title|display)[\w-]*font[\w-]*\s*:\s*([^;}\n]+)/i);
  const bodyVar = pick(/--[\w-]*(?:body|base|text)[\w-]*font[\w-]*\s*:\s*([^;}\n]+)/i);
  const headingRule = pick(/(?:^|[},])\s*h1[^{]*\{[^}]*font-family\s*:\s*([^;}\n]+)/im);
  const bodyRule = pick(/(?:^|[},])\s*body[^{]*\{[^}]*font-family\s*:\s*([^;}\n]+)/im);
  const anyRule = pick(/font-family\s*:\s*([^;}\n]+)/i);

  const headingFont = headingVar || headingRule || anyRule || '';
  const bodyFont = bodyVar || bodyRule || anyRule || '';
  return { headingFont, bodyFont };
}

// --- JSON-LD ---------------------------------------------------------------

const ORG_TYPES = /^(organization|localbusiness|corporation|store|restaurant|professionalservice|.*business.*|.*service.*)$/i;

/** Extract Organization/LocalBusiness data from JSON-LD blocks. */
export function extractJsonLd(root) {
  const out = {};
  const nodes = [];
  root.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    let data;
    try {
      data = JSON.parse(el.text);
    } catch {
      return; // malformed JSON-LD is ignored, never thrown
    }
    const push = (v) => {
      if (Array.isArray(v)) v.forEach(push);
      else if (v && typeof v === 'object') {
        nodes.push(v);
        if (Array.isArray(v['@graph'])) v['@graph'].forEach(push);
      }
    };
    push(data);
  });

  for (const node of nodes) {
    const types = [].concat(node['@type'] || []).map((t) => String(t));
    if (!types.some((t) => ORG_TYPES.test(t))) continue;
    if (!out.name && typeof node.name === 'string') out.name = clean(node.name, BUSINESS_LIMITS.NAME_MAX);
    if (!out.description && typeof node.description === 'string') {
      out.description = clean(node.description, BUSINESS_LIMITS.DESCRIPTION_MAX);
    }
    if (!out.logo) {
      const logo = typeof node.logo === 'string' ? node.logo : node.logo?.url;
      if (typeof logo === 'string') out.logo = logo;
    }
    if (!out.phone && typeof node.telephone === 'string') out.phone = clean(node.telephone, BUSINESS_LIMITS.PHONE_MAX);
    if (!out.email && typeof node.email === 'string') out.email = clean(node.email, BUSINESS_LIMITS.EMAIL_MAX);
    if (!out.address && node.address && typeof node.address === 'object') {
      const a = node.address;
      out.address = clean(a.streetAddress, BUSINESS_LIMITS.ADDRESS_MAX);
      out.city = clean(a.addressLocality, BUSINESS_LIMITS.CITY_MAX);
      out.region = clean(a.addressRegion, BUSINESS_LIMITS.REGION_MAX);
      out.postalCode = clean(a.postalCode, BUSINESS_LIMITS.POSTAL_MAX);
      out.country = clean(a.addressCountry, BUSINESS_LIMITS.COUNTRY_MAX);
    } else if (!out.address && typeof node.address === 'string') {
      out.address = clean(node.address, BUSINESS_LIMITS.ADDRESS_MAX);
    }
    if (!out.sameAs && Array.isArray(node.sameAs)) {
      out.sameAs = node.sameAs.filter((s) => typeof s === 'string');
    }
  }
  return out;
}

// --- logo / favicon --------------------------------------------------------

const LOGO_HINT = /logo|brand|site-?icon|wordmark/i;

/**
 * Choose a logo by priority:
 * 1) JSON-LD logo  2) header logo img  3) img with logo-ish class/id/alt
 * 4) OG image only when it looks like a logo  5) favicon fallback.
 * Deliberately does NOT treat every large image as a logo.
 */
export function selectLogo({ root, baseUrl, jsonLd, ogImage, favicon }) {
  const abs = (href) => {
    const u = resolveUrl(href, baseUrl);
    return u ? u.toString() : null;
  };

  if (jsonLd?.logo) {
    const u = abs(jsonLd.logo);
    if (u) return { url: u, source: 'json_ld' };
  }

  const headerImg = root.querySelector('header img, .header img, #header img, nav img, .navbar img');
  if (headerImg) {
    const src = headerImg.getAttribute('src') || headerImg.getAttribute('data-src');
    const u = abs(src);
    if (u) return { url: u, source: 'header_image' };
  }

  for (const img of root.querySelectorAll('img')) {
    const hint = `${img.getAttribute('class') || ''} ${img.getAttribute('id') || ''} ${img.getAttribute('alt') || ''}`;
    if (LOGO_HINT.test(hint)) {
      const u = abs(img.getAttribute('src') || img.getAttribute('data-src'));
      if (u) return { url: u, source: 'logo_attribute' };
    }
  }

  if (ogImage && LOGO_HINT.test(ogImage)) {
    const u = abs(ogImage);
    if (u) return { url: u, source: 'og_image' };
  }

  if (favicon) return { url: favicon, source: 'favicon' };
  return { url: null, source: null };
}

export function extractFavicon(root, baseUrl) {
  const selectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="apple-touch-icon-precomposed"]',
  ];
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    const href = el?.getAttribute('href');
    const u = resolveUrl(href, baseUrl);
    if (u) return u.toString();
  }
  // Conventional fallback.
  const u = resolveUrl('/favicon.ico', baseUrl);
  return u ? u.toString() : null;
}

// --- contacts / services / links -------------------------------------------

const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function extractContacts(root, text) {
  const out = { phone: '', email: '' };
  const tel = root.querySelector('a[href^="tel:"]');
  if (tel) out.phone = clean(decodeURIComponent(tel.getAttribute('href').replace(/^tel:/i, '')), BUSINESS_LIMITS.PHONE_MAX);
  const mail = root.querySelector('a[href^="mailto:"]');
  if (mail) {
    const raw = mail.getAttribute('href').replace(/^mailto:/i, '').split('?')[0];
    out.email = clean(decodeURIComponent(raw), BUSINESS_LIMITS.EMAIL_MAX);
  }
  if (!out.phone) {
    const m = PHONE_RE.exec(text);
    if (m) out.phone = clean(m[0], BUSINESS_LIMITS.PHONE_MAX);
  }
  if (!out.email) {
    const m = EMAIL_RE.exec(text);
    if (m) out.email = clean(m[0], BUSINESS_LIMITS.EMAIL_MAX);
  }
  return out;
}

/** Social profile links found on the page (data only — no new providers). */
export function extractSocialLinks(root, baseUrl) {
  const found = new Map();
  for (const a of root.querySelectorAll('a[href]')) {
    const u = resolveUrl(a.getAttribute('href'), baseUrl);
    if (!u) continue;
    const host = u.hostname.replace(/^www\./, '');
    const match = SOCIAL_HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
    if (match && !found.has(match)) found.set(match, u.toString().slice(0, BUSINESS_LIMITS.URL_MAX));
    if (found.size >= WEBSITE_ANALYSIS.MAX_SOCIAL_LINKS) break;
  }
  return [...found.entries()].map(([platform, url]) => ({ platform, url }));
}

/** Concise service names — never a full-page text dump. */
export function extractServices(root) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const s = clean(raw, BUSINESS_LIMITS.SERVICE_MAX);
    if (!s || s.length < 3) return;
    if (/^(home|about|contact|blog|news|privacy|terms|login|menu|search|cookie)/i.test(s)) return;
    if (s.split(' ').length > 8) return; // sentences are not service names
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (out.length < WEBSITE_ANALYSIS.MAX_SERVICES) out.push(s);
  };

  const scopes = root.querySelectorAll(
    '[class*="service" i], [id*="service" i], section, .services li, ul.services li',
  );
  for (const scope of scopes) {
    for (const h of scope.querySelectorAll('h2, h3, h4')) add(h.text);
    if (out.length >= WEBSITE_ANALYSIS.MAX_SERVICES) break;
  }
  if (out.length === 0) {
    for (const h of root.querySelectorAll('h2, h3')) add(h.text);
  }
  return out;
}

/** Same-site candidate links for About / Services / Contact pages. */
export function discoverPageLinks(root, baseUrl) {
  const wanted = {
    about: /\babout\b|who-we-are|our-story|company/i,
    services: /\bservices?\b|what-we-do|solutions|treatments|products/i,
    contact: /\bcontact\b|get-in-touch|reach-us/i,
  };
  const found = {};
  for (const a of root.querySelectorAll('a[href]')) {
    const u = resolveUrl(a.getAttribute('href'), baseUrl);
    if (!u) continue;
    if (!isSameSite(u.hostname, new URL(baseUrl).hostname)) continue;
    if (isDisallowedPath(u.pathname)) continue;
    const hay = `${u.pathname} ${a.text || ''}`;
    for (const [key, re] of Object.entries(wanted)) {
      if (!found[key] && re.test(hay)) {
        u.search = '';
        found[key] = u.toString();
      }
    }
  }
  return found;
}

// --- top level -------------------------------------------------------------

/**
 * Parse one page into extracted fields.
 * @param {string} html
 * @param {string} baseUrl
 */
export function parsePage(html, baseUrl) {
  const root = parse(String(html || ''), { blockTextElements: { script: true, style: true } });

  const metaOf = (sel, attr = 'content') => root.querySelector(sel)?.getAttribute(attr) || '';
  const title = clean(root.querySelector('title')?.text, BUSINESS_LIMITS.NAME_MAX);
  const metaDescription = clean(metaOf('meta[name="description"]'), BUSINESS_LIMITS.DESCRIPTION_MAX);
  const ogTitle = clean(metaOf('meta[property="og:title"]'), BUSINESS_LIMITS.NAME_MAX);
  const ogDescription = clean(metaOf('meta[property="og:description"]'), BUSINESS_LIMITS.DESCRIPTION_MAX);
  const ogSiteName = clean(metaOf('meta[property="og:site_name"]'), BUSINESS_LIMITS.NAME_MAX);
  const ogImage = metaOf('meta[property="og:image"]');

  const jsonLd = extractJsonLd(root);
  const favicon = extractFavicon(root, baseUrl);
  const logo = selectLogo({ root, baseUrl, jsonLd, ogImage, favicon });

  // Visible text (script/style excluded) — bounded, used only for contacts/about.
  const bodyText = clean(root.querySelector('body')?.text || root.text || '', 20000);
  const contacts = extractContacts(root, bodyText);

  const aboutText = clean(
    root.querySelector('[class*="about" i] p, #about p, main p, article p')?.text || '',
    BUSINESS_LIMITS.DESCRIPTION_MAX,
  );

  return {
    title,
    metaDescription,
    ogTitle,
    ogDescription,
    ogSiteName,
    businessName: jsonLd.name || ogSiteName || ogTitle || title || '',
    description: jsonLd.description || metaDescription || ogDescription || aboutText || '',
    aboutText,
    logoUrl: logo.url,
    logoSource: logo.source,
    faviconUrl: favicon,
    phone: jsonLd.phone || contacts.phone || '',
    email: jsonLd.email || contacts.email || '',
    address: jsonLd.address || '',
    city: jsonLd.city || '',
    region: jsonLd.region || '',
    postalCode: jsonLd.postalCode || '',
    country: jsonLd.country || '',
    colors: extractColors(root),
    fonts: extractFonts(root),
    services: extractServices(root),
    socialLinks: extractSocialLinks(root, baseUrl),
    pageLinks: discoverPageLinks(root, baseUrl),
  };
}

export default { parsePage };
