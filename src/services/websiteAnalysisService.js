/**
 * Website analysis orchestration.
 *
 * Fetches at most 4 same-site pages (homepage + likely About/Services/Contact),
 * parses each into editable brand/business suggestions, and returns a sanitized
 * result. NEVER returns raw page HTML, internal fetch errors, or private
 * network diagnostics. Crawling is limited to the same registrable domain and
 * skips private/state-changing paths. Nothing is saved here — the user reviews
 * and edits the suggestions first.
 */

import { config as defaultConfig } from '../config/env.js';
import { WEBSITE_ANALYSIS, BUSINESS_LIMITS } from '../config/constants.js';
import { normalizeWebsiteUrl, isSameSite } from '../utils/urlSafety.js';
import { ValidationError } from '../utils/errors.js';
import { createWebsiteFetchService } from './websiteFetchService.js';
import { parsePage } from './websiteParser.js';

/** Reject SVGs carrying scripts or external references (never sanitize-and-hope). */
export function isUnsafeSvg(text) {
  const s = String(text || '').toLowerCase();
  return (
    s.includes('<script') ||
    s.includes('<foreignobject') ||
    /\son\w+\s*=/.test(s) ||
    /(xlink:href|href)\s*=\s*["']?\s*(https?:|\/\/|javascript:|data:)/.test(s) ||
    s.includes('<use') ||
    s.includes('<iframe') ||
    s.includes('<embed') ||
    s.includes('<object')
  );
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

export function createWebsiteAnalysisService({
  config = defaultConfig,
  fetchService = null,
  fetchImpl = undefined,
  lookup = undefined,
  normalizer = null, // optional OpenAI normalization; analysis works without it
  logging = null,
} = {}) {
  const http = fetchService || createWebsiteFetchService({ config, fetchImpl, lookup });

  /** Validate + fetch a logo. Only same-site logos are fetched. */
  async function validateLogo(logoUrl, siteHost) {
    if (!logoUrl) return { url: null, validated: false, reason: 'not_found' };
    let parsed;
    try {
      parsed = new URL(logoUrl);
    } catch {
      return { url: null, validated: false, reason: 'invalid_url' };
    }
    // Strict: only fetch assets from the analyzed site's own domain.
    if (!isSameSite(parsed.hostname, siteHost)) {
      // Keep as an editable suggestion, but never fetch an off-site asset.
      return { url: logoUrl, validated: false, reason: 'external_host' };
    }
    try {
      const res = await http.fetchImage(parsed);
      if (res.contentType === 'image/svg+xml' && isUnsafeSvg(res.text)) {
        return { url: null, validated: false, reason: 'unsafe_svg' };
      }
      return { url: res.finalUrl.toString(), validated: true, contentType: res.contentType };
    } catch {
      // Never surface the internal fetch error.
      return { url: logoUrl, validated: false, reason: 'unreachable' };
    }
  }

  /**
   * Analyze a public website into editable business suggestions.
   * @param {{ userId, websiteUrl }} input
   */
  async function analyzeWebsite({ userId, websiteUrl }) {
    const { url: startUrl, warnings } = normalizeWebsiteUrl(websiteUrl, { isProd: config.isProd });

    // 1) Homepage (required).
    const home = await http.fetchValidated(startUrl);
    const homeParsed = parsePage(home.text, home.finalUrl.toString());
    const siteHost = home.finalUrl.hostname;

    // 2) Up to 3 more same-site pages: About / Services / Contact.
    const pages = [{ kind: 'home', url: home.finalUrl.toString(), parsed: homeParsed }];
    const candidates = Object.entries(homeParsed.pageLinks || {}).slice(
      0,
      WEBSITE_ANALYSIS.MAX_PAGES - 1,
    );
    for (const [kind, link] of candidates) {
      if (pages.length >= WEBSITE_ANALYSIS.MAX_PAGES) break;
      let candidate;
      try {
        candidate = new URL(link);
      } catch {
        continue;
      }
      if (!isSameSite(candidate.hostname, siteHost)) continue; // same registrable domain only
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await http.fetchValidated(candidate);
        // eslint-disable-next-line no-await-in-loop
        pages.push({ kind, url: res.finalUrl.toString(), parsed: parsePage(res.text, res.finalUrl.toString()) });
      } catch {
        // A secondary page failing is non-fatal — homepage data still stands.
      }
    }

    const byKind = (kind) => pages.find((p) => p.kind === kind)?.parsed;
    const about = byKind('about');
    const services = byKind('services');
    const contact = byKind('contact');

    // 3) Merge — homepage identity wins; secondary pages fill the gaps.
    const merged = {
      businessName: firstNonEmpty(homeParsed.businessName, about?.businessName),
      description: firstNonEmpty(
        homeParsed.description,
        about?.description,
        about?.aboutText,
        homeParsed.aboutText,
      ).slice(0, BUSINESS_LIMITS.DESCRIPTION_MAX),
      phone: firstNonEmpty(homeParsed.phone, contact?.phone, about?.phone),
      email: firstNonEmpty(homeParsed.email, contact?.email, about?.email),
      address: firstNonEmpty(homeParsed.address, contact?.address),
      city: firstNonEmpty(homeParsed.city, contact?.city),
      region: firstNonEmpty(homeParsed.region, contact?.region),
      postalCode: firstNonEmpty(homeParsed.postalCode, contact?.postalCode),
      country: firstNonEmpty(homeParsed.country, contact?.country),
      colors: homeParsed.colors.length ? homeParsed.colors : about?.colors || [],
      fonts: homeParsed.fonts.headingFont || homeParsed.fonts.bodyFont ? homeParsed.fonts : about?.fonts || { headingFont: '', bodyFont: '' },
      socialLinks: homeParsed.socialLinks.length ? homeParsed.socialLinks : contact?.socialLinks || [],
    };

    // Services: prefer a dedicated Services page, then merge the homepage's.
    const serviceSet = [];
    const seen = new Set();
    for (const s of [...(services?.services || []), ...homeParsed.services]) {
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      serviceSet.push(s);
      if (serviceSet.length >= WEBSITE_ANALYSIS.MAX_SERVICES) break;
    }
    merged.services = serviceSet;

    // 4) Logo (validated; same-site fetch only) + favicon fallback.
    const logo = await validateLogo(homeParsed.logoUrl, siteHost);
    if (!logo.url && homeParsed.faviconUrl) {
      const fav = await validateLogo(homeParsed.faviconUrl, siteHost);
      if (fav.url) {
        logo.url = fav.url;
        logo.validated = fav.validated;
        logo.reason = 'favicon_fallback';
      }
    }

    // 5) Optional OpenAI normalization — best effort, never blocking.
    let normalized = null;
    if (normalizer && typeof normalizer.normalizeBusinessText === 'function') {
      try {
        normalized = await normalizer.normalizeBusinessText(
          {
            businessName: merged.businessName,
            // Plain extracted text ONLY — no HTML, no emails, no phone numbers.
            description: merged.description,
            services: merged.services,
          },
          { userId },
        );
      } catch {
        normalized = null; // failure must never block manual editing
      }
    }

    // 6) Sanitized suggestion payload — no HTML, no fetch internals.
    return {
      sourceUrl: home.finalUrl.origin + home.finalUrl.pathname,
      warnings,
      pagesAnalyzed: pages.map((p) => ({ kind: p.kind, url: p.url })),
      suggestions: {
        businessName: merged.businessName,
        businessCategory: normalized?.category || '',
        businessDescription: normalized?.description || merged.description,
        phone: merged.phone,
        email: merged.email,
        address: merged.address,
        city: merged.city,
        region: merged.region,
        postalCode: merged.postalCode,
        country: merged.country,
        websiteUrl: home.finalUrl.origin,
        primaryColor: merged.colors[0] || '',
        secondaryColor: merged.colors[1] || '',
        accentColor: merged.colors[2] || '',
        colorCandidates: merged.colors,
        headingFont: merged.fonts.headingFont || '',
        bodyFont: merged.fonts.bodyFont || '',
        logoUrl: logo.url || '',
        logoValidated: Boolean(logo.validated),
        faviconUrl: homeParsed.faviconUrl || '',
        services: normalized?.services?.length ? normalized.services : merged.services,
        locations: [merged.city, merged.region].filter(Boolean).slice(0, WEBSITE_ANALYSIS.MAX_LOCATIONS),
        socialLinks: merged.socialLinks,
        defaultTone: normalized?.tone || '',
      },
    };
  }

  return { analyzeWebsite, validateLogo };
}

export const websiteAnalysisService = createWebsiteAnalysisService();
export default websiteAnalysisService;
