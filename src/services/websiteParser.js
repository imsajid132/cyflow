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
/**
 * Generic families and system stacks. These are real CSS, but they are not a
 * BRAND's font — reporting "-apple-system" as the heading face tells the owner
 * nothing about their own site, and putting it in front of a designer is worse
 * than saying nothing.
 */
const NON_BRAND_FONTS = new Set([
  'inherit', 'initial', 'unset', 'revert', 'var',
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif',
  'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont',
]);

export function firstFontName(declaration) {
  if (typeof declaration !== 'string') return '';
  const first = declaration.split(',')[0] || '';
  const name = first.replace(/["']/g, '').trim();
  // Only plain font names — never URLs or expressions.
  if (!/^[A-Za-z0-9 _-]{1,80}$/.test(name)) return '';
  /*
   * A bare number is a font-WEIGHT that leaked in from a neighbouring property
   * (a site with `--heading-font-weight: 600` reported "600" as its heading
   * face). A font name always has letters in it.
   */
  if (!/[A-Za-z]/.test(name)) return '';
  if (NON_BRAND_FONTS.has(name.toLowerCase())) return '';
  return clean(name, BUSINESS_LIMITS.FONT_MAX);
}

/**
 * Font families named in a Google Fonts request, in the order requested.
 *
 * Most sites keep their CSS in an external file this parser never fetches, so
 * reading only inline <style> left the font fields empty on site after site.
 * The webfont REQUEST, though, is right there in the markup — a <link> to
 * fonts.googleapis.com, or an @import of one — and it names the faces exactly.
 * It is also the most reliable signal available: a site does not load a font it
 * has no intention of using.
 */
export function fontsFromWebfontLinks(root) {
  const urls = [];
  for (const link of root.querySelectorAll('link[href]')) {
    const href = link.getAttribute('href') || '';
    if (/fonts\.googleapis\.com/i.test(href)) urls.push(href);
  }
  for (const style of root.querySelectorAll('style')) {
    for (const m of String(style.text || '').matchAll(/@import\s+url\(([^)]+)\)/gi)) {
      const u = m[1].replace(/["']/g, '');
      if (/fonts\.googleapis\.com/i.test(u)) urls.push(u);
    }
  }

  const names = [];
  for (const url of urls) {
    // Both shapes: css2?family=Poppins:wght@400 and css?family=Roboto|Open+Sans
    for (const m of url.matchAll(/family=([^&]+)/gi)) {
      for (const part of decodeURIComponent(m[1]).split('|')) {
        const name = firstFontName(part.split(':')[0].replace(/\+/g, ' '));
        if (name && !names.includes(name)) names.push(name);
      }
    }
  }
  return names;
}

/**
 * Faces the site SHIPS, named in its own @font-face rules.
 *
 * This is the most reliable signal there is, and it was being ignored. A modern
 * site declares `font-family: var(--font-display)`, that variable resolves to
 * another variable, and every rule-based lookup ends at a `var(...)` it cannot
 * follow — which is why the font fields came back empty on a site that plainly
 * ships Inter. `@font-face{font-family:Inter}` says it outright: a site does not
 * self-host a face it has no intention of using.
 */
export function fontsFromFontFace(css) {
  const names = [];
  for (const block of String(css).matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const m = /font-family\s*:\s*([^;}]+)/i.exec(block[1]);
    if (!m) continue;
    const name = firstFontName(m[1]);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
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

  /*
   * Prefer explicit CSS variables, then heading/body rules.
   *
   * The variable patterns stop at `font` or `font-family` deliberately: they used
   * to allow any trailing word, so `--heading-font-weight: 600` matched and the
   * site's heading face was reported as "600".
   */
  const headingVar = pick(/--[\w-]*(?:heading|title|display)[\w-]*-?font(?:-family)?\s*:\s*([^;}\n]+)/i)
    // The other naming order is just as common: --font-display, --font-heading.
    || pick(/--font-(?:display|heading|title)\s*:\s*([^;}\n]+)/i);
  const bodyVar = pick(/--[\w-]*(?:body|base|text)[\w-]*-?font(?:-family)?\s*:\s*([^;}\n]+)/i)
    || pick(/--font-(?:sans|body|base|text)\s*:\s*([^;}\n]+)/i);
  const headingRule = pick(/(?:^|[},])\s*h1[^{]*\{[^}]*font-family\s*:\s*([^;}\n]+)/im);
  const bodyRule = pick(/(?:^|[},])\s*body[^{]*\{[^}]*font-family\s*:\s*([^;}\n]+)/im);
  const anyRule = pick(/font-family\s*:\s*([^;}\n]+)/i);

  /*
   * The webfont request is the fallback, not the first choice: a rule in the
   * page says where a face is USED, while a link only says it was loaded. But a
   * loaded face beats an empty field, and on a site whose CSS lives in an
   * external file it is the only thing there is. Two requested faces are read as
   * heading then body, which is the order sites almost always request them in.
   */
  /*
   * Then the faces the site actually ships or requests. A rule says where a face
   * is USED and wins; these say a face EXISTS, which is the only thing left to
   * go on once every rule has resolved to a `var(...)` nobody can follow.
   */
  const shipped = fontsFromFontFace(css);
  const requested = fontsFromWebfontLinks(root);
  const available = [...shipped, ...requested.filter((n) => !shipped.includes(n))];

  const headingFont = headingVar || headingRule || anyRule || available[0] || '';
  const bodyFont = bodyVar || bodyRule || anyRule || available[1] || available[0] || '';
  return { headingFont, bodyFont };
}

/**
 * Photographs the site uses, largest and most prominent first.
 *
 * A poster built from colour and type alone always looks like a template. The
 * business's OWN pictures are what make it look like their post, so the reader
 * collects them and the studio offers them to the designer.
 *
 * Deliberately conservative: only http(s) images, no data URIs, no tracking
 * pixels, no icons, and nothing that looks like a logo or a sprite. Dimensions
 * are read from the markup when they are declared — nothing is downloaded here.
 */
export function extractImages(root, baseUrl, limit = 40) {
  const out = [];
  const seen = new Set();
  // Names that give a picture's job away. These no longer EXCLUDE anything —
  // they label it, so the studio can tick the photographs by default and still
  // show everything else.
  const LOOKS_LOGO = /(logo|brand|wordmark)/i;
  const LOOKS_ICON = /(icon|favicon|sprite|avatar|badge|bullet|arrow|chevron|check)/i;
  const IS_JUNK = /(pixel|spacer|1x1|blank|tracking)/i;

  const add = (rawSrc, alt, w, h, hint) => {
    if (out.length >= limit) return;
    const u = resolveUrl(rawSrc, baseUrl);
    if (!u || !/^https?:$/.test(u.protocol)) return;
    const url = u.toString();
    if (seen.has(url)) return;
    // Only genuine non-pictures are refused: tracking pixels and spacers.
    if (IS_JUNK.test(url)) return;
    const width = Number(w) || 0;
    const height = Number(h) || 0;
    if (width && height && width <= 2 && height <= 2) return;

    const text = `${url} ${alt || ''}`;
    /*
     * A KIND, not a verdict. Every picture the site uses is returned — the owner
     * is the one who decides what belongs on their poster, and a filter that
     * silently drops things leaves them with a library missing the very photo
     * they wanted. The kind only decides what starts ticked.
     */
    let kind = 'photo';
    if (hint) kind = hint;
    else if (LOOKS_ICON.test(text) || (width && width < 100)) kind = 'icon';
    else if (LOOKS_LOGO.test(text) || /\.svg(\?|$)/i.test(url)) kind = 'logo';

    seen.add(url);
    out.push({ url: url.slice(0, BUSINESS_LIMITS.URL_MAX), alt: clean(alt || '', 160), width, height, kind });
  };

  /*
   * A client logo is not a photograph of this business.
   *
   * A real site offered five "photos" that were all its CUSTOMERS' logos, sitting
   * in a "trusted by" strip. On a poster they would advertise somebody else. Any
   * image inside a section that talks about clients, partners or brands is left
   * out, as is one whose own alt text calls it a logo.
   */
  const CLIENT_STRIP = /(client|partner|brand|trusted|as[- ]seen|featured[- ]in|logo|award|certif)/i;
  const inClientStrip = (img) => {
    let node = img.parentNode;
    for (let depth = 0; node && depth < 4; depth += 1) {
      const tag = String(node.rawTagName || '').toLowerCase();
      // Never walk out into the page itself: at <body> every heading on the site
      // is a descendant, so a single "Trusted by" section would disqualify every
      // photograph on the page.
      if (tag === 'body' || tag === 'html' || !tag) return false;

      const attrs = `${node.getAttribute?.('class') || ''} ${node.getAttribute?.('id') || ''}`;
      if (CLIENT_STRIP.test(attrs)) return true;

      // A heading belonging to THIS block — a direct child, not any descendant.
      for (const child of node.childNodes || []) {
        const childTag = String(child.rawTagName || '').toLowerCase();
        if (/^h[1-4]$/.test(childTag) && CLIENT_STRIP.test(child.text || '')) return true;
      }
      node = node.parentNode;
    }
    return false;
  };

  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src')
      || img.getAttribute('data-src')
      || img.getAttribute('data-lazy-src')
      || img.getAttribute('data-original')
      // A srcset's first candidate, for sites that ship no plain src at all.
      || String(img.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0]
      || '';
    // A client strip is LABELLED, not hidden: it is still a picture the site
    // uses, and the owner may well want their partner's mark on a post.
    const hint = inClientStrip(img) || CLIENT_STRIP.test(img.getAttribute('alt') || '') ? 'logo' : null;
    add(src, img.getAttribute('alt'), img.getAttribute('width'), img.getAttribute('height'), hint);
  }

  // Pictures the site set as its own preview, and CSS background images, which
  // on a modern site are often the hero photograph.
  const og = root.querySelector('meta[property="og:image"]');
  if (og) add(og.getAttribute('content'), 'Site preview image', 0, 0);
  for (const node of root.querySelectorAll('[style*="background-image"]')) {
    const m = /background-image\s*:\s*url\((['"]?)([^)'"]+)\1\)/i.exec(node.getAttribute('style') || '');
    if (m) add(m[2], node.getAttribute('aria-label') || '', 0, 0);
  }

  return out;
}

// --- JSON-LD ---------------------------------------------------------------

const ORG_TYPES = /^(organization|localbusiness|corporation|store|restaurant|professionalservice|.*business.*|.*service.*)$/i;

/** "GeneralContractor" -> "General contractor". A schema type read as English. */
export function humanizeSchemaType(type) {
  const words = String(type || '')
    // An acronym runs into the next word without a lowercase letter to split on:
    // "HVACBusiness" needs a break between the acronym and "Business".
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) return '';
  return clean(words.charAt(0).toUpperCase() + words.slice(1), BUSINESS_LIMITS.CATEGORY_MAX || 80);
}

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
    /*
     * The schema type IS the industry, and it is the only place most sites state
     * it. "GeneralContractor" becomes "General contractor" — a real answer where
     * the field was otherwise left blank for the owner to guess at. The generic
     * containers are skipped, because "Organization" tells nobody anything.
     */
    if (!out.category) {
      const specific = types.find((t) => !/^(organization|localbusiness|corporation|thing)$/i.test(t));
      if (specific) out.category = humanizeSchemaType(specific);
    }
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

/**
 * Placeholders a theme or CMS leaves behind where a business name belongs.
 * "default" is the one that reached production, on a site whose JSON-LD had
 * never been filled in.
 */
const PLACEHOLDER_NAMES = new Set([
  'default', 'untitled', 'home', 'homepage', 'index', 'website', 'site', 'my site',
  'my website', 'new site', 'sample', 'example', 'test', 'demo', 'page', 'main',
  'welcome', 'wordpress', 'shopify', 'wix site', 'squarespace', 'lorem ipsum',
]);

/** True when a candidate reads like a real business name rather than a stub. */
export function isRealBusinessName(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (s.length < 2) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  return !PLACEHOLDER_NAMES.has(s.toLowerCase());
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
    /*
     * A benefit is not a service. Section headings on a sales page are written
     * as promises — "Prevent water leaks and interior damage", "Increase
     * property value", "Help you pass NYC DOB inspections" — and a list of those
     * given to a designer produces a poster about outcomes with no idea what the
     * business actually does. A service is a noun phrase, so anything that opens
     * with a verb of promise, or addresses the reader, is dropped.
     */
    if (/^(prevent|increase|improve|reduce|save|protect|avoid|get|help|boost|ensure|keep|make|stop|enjoy|discover|learn|find|why|how|what|when)\b/i.test(s)) return;
    if (/\b(you|your|we|our)\b/i.test(s) && s.split(' ').length > 3) return;
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
    /*
     * The first CANDIDATE that is actually a name.
     *
     * A real site reported its business name as "default": its JSON-LD carried a
     * theme placeholder, and because that field was merely present it won over
     * the og:site_name and the title, which both held the real name. A
     * placeholder is worse than a missing value — it is confidently wrong, and it
     * would have gone onto every poster.
     */
    businessName: [jsonLd.name, ogSiteName, ogTitle, title].find(isRealBusinessName) || '',
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
    // The schema type is the only place most sites state what they do.
    businessCategory: jsonLd.category || '',
    colors: extractColors(root),
    fonts: extractFonts(root),
    services: extractServices(root),
    socialLinks: extractSocialLinks(root, baseUrl),
    // The business's own photographs. A poster made from colour and type alone
    // always looks like a template; their pictures are what make it theirs.
    images: extractImages(root, baseUrl),
    pageLinks: discoverPageLinks(root, baseUrl),
  };
}

export default { parsePage };
