// What the studio remembers between visits.
//
// Reading a website takes the better part of a minute and is then corrected by
// hand, field by field. All of that lived in one browser tab: a refresh and the
// user was back at an empty URL box with nothing to show for the work. These
// tests pin the parts that make keeping it safe — it never overwrites someone
// else's data in the same column, it never throws into the request that
// triggered it, and it will not hand back whatever shape happens to be stored.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStudioMemory, sanitizeBrand } from '../src/services/aiStudio/studioMemory.js';

const BRAND = {
  businessName: 'NYC Waterproofing',
  industry: 'Waterproofing contractor',
  description: 'Basement waterproofing across the five boroughs.',
  services: ['Basement Waterproofing', 'French Drain Installation'],
  logoUrl: 'https://x.test/logo.png',
  fonts: { heading: 'Inter', body: 'Georgia' },
  colors: { primary: '#0b1a2e', secondary: '#1e3a8a', accent: '#dc2626' },
  contact: { phone: '(212) 555-0100', email: 'hi@x.test', city: 'New York', websiteUrl: 'https://x.test' },
  socialLinks: { facebook: 'https://facebook.com/x' },
  images: [
    { url: 'https://x.test/a.jpg', alt: 'Facade', kind: 'photo', chosen: true },
    { url: 'https://x.test/b.png', alt: 'Logo', kind: 'logo', chosen: false },
  ],
};

/** A profile store that behaves like the repository: one row per user. */
function fakeProfiles(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    rows,
    findByUserId: async (userId) => rows.get(String(userId)) || null,
    createOrUpdateProfile: async (userId, data) => {
      const existing = rows.get(String(userId)) || {};
      rows.set(String(userId), { ...existing, ...data });
      return rows.get(String(userId));
    },
  };
}

test('a brand saved is the brand handed back', async () => {
  const profiles = fakeProfiles();
  const memory = createStudioMemory({ profiles });

  await memory.rememberBrand('7', BRAND);
  const back = await memory.recallBrand('7');

  assert.equal(back.businessName, 'NYC Waterproofing');
  assert.equal(back.industry, 'Waterproofing contractor');
  assert.deepEqual(back.services, ['Basement Waterproofing', 'French Drain Installation']);
  assert.equal(back.fonts.heading, 'Inter');
  assert.equal(back.colors.primary, '#0b1a2e');
  assert.equal(back.contact.phone, '(212) 555-0100');
  assert.equal(back.socialLinks.facebook, 'https://facebook.com/x');
  // Which pictures are ticked is a decision the user made; losing it means
  // making it again.
  assert.equal(back.images.length, 2);
  assert.equal(back.images[0].chosen, true);
  assert.equal(back.images[1].chosen, false);
});

/*
 * The column this writes to belongs to onboarding's website extract as well.
 * Writing only our key would quietly delete theirs.
 */
test('remembering a brand does not delete what else is in that column', async () => {
  const profiles = fakeProfiles({
    7: { extractedMetadata: { onboardingExtract: { pages: 4 }, somethingElse: true } },
  });
  const memory = createStudioMemory({ profiles });

  await memory.rememberBrand('7', BRAND);

  const saved = profiles.rows.get('7').extractedMetadata;
  assert.deepEqual(saved.onboardingExtract, { pages: 4 }, 'the other extract survived');
  assert.equal(saved.somethingElse, true);
  assert.equal(saved.aiStudioBrand.businessName, 'NYC Waterproofing');
});

test('one user cannot read another user brand', async () => {
  const profiles = fakeProfiles();
  const memory = createStudioMemory({ profiles });
  await memory.rememberBrand('7', BRAND);
  assert.equal(await memory.recallBrand('999'), null);
});

/*
 * Remembering is a convenience, never the point of the request that triggered
 * it. A database hiccup must not turn a successful website read into an error on
 * screen.
 */
test('a store that fails does not fail the request that triggered it', async () => {
  const memory = createStudioMemory({
    profiles: {
      findByUserId: async () => { throw new Error('database is down'); },
      createOrUpdateProfile: async () => { throw new Error('database is down'); },
    },
  });
  assert.equal(await memory.rememberBrand('7', BRAND), null);
  assert.equal(await memory.recallBrand('7'), null);
});

test('an empty form is not worth restoring', async () => {
  const profiles = fakeProfiles();
  const memory = createStudioMemory({ profiles });
  assert.equal(await memory.rememberBrand('7', { businessName: '', services: [] }), null);
  assert.equal(await memory.rememberBrand('7', null), null);
  assert.equal(profiles.rows.size, 0, 'nothing was written');
});

/*
 * A JSON column accepts literally anything. This runs on the way out as well as
 * the way in, so a row written by an older version cannot put an unexpected
 * shape on screen.
 */
test('stored junk cannot reach the screen', () => {
  const brand = sanitizeBrand({
    businessName: 'X'.repeat(500),
    colors: { primary: 'javascript:alert(1)', secondary: '#1e3a8a', accent: 'red' },
    services: ['ok', 42, null, { nested: true }],
    socialLinks: ['array', 'not', 'object'],
    images: [{ url: '' }, { url: 'https://x.test/a.jpg' }, 'not an object'],
    fonts: 'not an object',
    contact: null,
  });

  assert.equal(brand.businessName.length, 120, 'long text is cut, not stored whole');
  assert.equal(brand.colors.primary, '#111827', 'a non-colour falls back rather than being kept');
  assert.equal(brand.colors.accent, '#2563eb');
  assert.equal(brand.colors.secondary, '#1e3a8a', 'a real colour is preserved exactly');
  assert.deepEqual(brand.services, ['ok'], 'only strings survive');
  assert.deepEqual(brand.socialLinks, {}, 'an array cannot say which link is which, so it is dropped');
  assert.equal(brand.images.length, 1, 'a picture with no address is not a picture');
  assert.equal(brand.fonts.heading, '');
  assert.equal(brand.contact.phone, '');
});
