/**
 * src/services/aiStudio/studioMemory.js
 *
 * What the studio remembers between visits.
 *
 * WHY THIS EXISTS. Reading a website takes the better part of a minute, and the
 * result is then corrected by hand — the industry fixed, a phone number retyped,
 * pictures ticked and unticked. All of that lived in one browser tab. A refresh,
 * a closed laptop, a phone that slept, and it was gone: the user was back at an
 * empty URL box with nothing to show for the work.
 *
 * WHERE IT IS KEPT. Server-side, on the user's own business profile row, in the
 * JSON column that already exists for exactly this kind of extract. Not in the
 * browser: a website extract carries a real business's contact details, and this
 * application does not put those in localStorage (see public/assets/js/api.js).
 * Nothing new to migrate either — the last migration took a day to land.
 *
 * The brand is stored in the shape the SCREEN holds, so restoring it is a render
 * rather than a translation. One user, one saved brand, overwritten each time.
 */

import * as defaultProfiles from '../../repositories/businessProfileRepository.js';

/** Where the brand lives inside the profile's extract column. */
const KEY = 'aiStudioBrand';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hex = (v, fallback) => (typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : fallback);
const list = (v, max, f) => (Array.isArray(v) ? v.map(f).filter(Boolean).slice(0, max) : []);

/**
 * The brand, reduced to the fields the studio actually uses.
 *
 * This runs on the way IN and on the way OUT. On the way in because the body is
 * user input and a JSON column will accept literally anything, including a
 * megabyte of nested nonsense. On the way out because a row written by an older
 * version of this file should not be able to put unexpected shapes on screen.
 */
export function sanitizeBrand(input) {
  if (!input || typeof input !== 'object') return null;
  const c = input.colors && typeof input.colors === 'object' ? input.colors : {};
  const f = input.fonts && typeof input.fonts === 'object' ? input.fonts : {};
  const k = input.contact && typeof input.contact === 'object' ? input.contact : {};

  const brand = {
    businessName: str(input.businessName, 120),
    industry: str(input.industry, 120),
    description: str(input.description, 600),
    tone: str(input.tone, 120),
    services: list(input.services, 20, (s) => str(s, 80)),

    logoUrl: str(input.logoUrl, 2000),
    logoValidated: Boolean(input.logoValidated),
    faviconUrl: str(input.faviconUrl, 2000),

    fonts: { heading: str(f.heading, 80), body: str(f.body, 80) },

    colors: {
      primary: hex(c.primary, '#111827'),
      secondary: hex(c.secondary, '#6b7280'),
      accent: hex(c.accent, '#2563eb'),
    },
    colorCandidates: list(input.colorCandidates, 12, (x) => (HEX_RE.test(String(x)) ? String(x) : null)),

    contact: {
      phone: str(k.phone, 40),
      email: str(k.email, 254),
      address: str(k.address, 255),
      city: str(k.city, 120),
      region: str(k.region, 120),
      postalCode: str(k.postalCode, 32),
      country: str(k.country, 80),
      websiteUrl: str(k.websiteUrl, 2000),
    },
    locations: list(input.locations, 6, (l) => str(l, 160)),
    /*
     * Social links arrive as an object keyed by network from the reader, and the
     * screen edits them as one. An array would silently lose which link is which.
     */
    socialLinks:
      input.socialLinks && typeof input.socialLinks === 'object' && !Array.isArray(input.socialLinks)
        ? Object.fromEntries(
          Object.entries(input.socialLinks).slice(0, 12).map(([key, v]) => [str(key, 40), str(v, 2000)]),
        )
        : {},

    // Which pictures are ticked is a decision the user made; losing it means
    // making it again.
    images: list(input.images, 40, (im) => {
      const url = str(im?.url, 2000);
      if (!url) return null;
      return {
        url,
        alt: str(im?.alt, 200),
        width: Number(im?.width) || 0,
        height: Number(im?.height) || 0,
        kind: str(im?.kind, 20) || 'photo',
        chosen: im?.chosen !== false,
      };
    }),

    sourceUrl: str(input.sourceUrl, 2000),
  };

  // A brand with no name is an empty form, not something worth restoring.
  return brand.businessName || brand.contact.websiteUrl || brand.sourceUrl ? brand : null;
}

export function createStudioMemory({ profiles = defaultProfiles } = {}) {
  /**
   * Keep this brand for next time. Overwrites the previous one.
   *
   * Remembering is a convenience, never the point of the request that triggered
   * it: a failure here must not turn a successful analysis into an error on
   * screen. It is logged nowhere and swallowed, and the user simply has to read
   * the site again.
   */
  async function rememberBrand(userId, input) {
    const brand = sanitizeBrand(input);
    if (!brand) return null;
    try {
      /*
       * Merge, never replace. This column belongs to onboarding's website
       * extract as well; writing only our key would quietly delete theirs.
       */
      const existing = await profiles.findByUserId(userId, { includeDiagnostics: true });
      const metadata = existing?.extractedMetadata && typeof existing.extractedMetadata === 'object'
        ? { ...existing.extractedMetadata }
        : {};
      metadata[KEY] = brand;
      await profiles.createOrUpdateProfile(userId, { extractedMetadata: metadata });
      return brand;
    } catch {
      return null;
    }
  }

  /** The brand this user last had on screen, or null. */
  async function recallBrand(userId) {
    try {
      const profile = await profiles.findByUserId(userId, { includeDiagnostics: true });
      return sanitizeBrand(profile?.extractedMetadata?.[KEY]);
    } catch {
      return null;
    }
  }

  return { rememberBrand, recallBrand };
}

export const studioMemory = createStudioMemory();
export default createStudioMemory;
