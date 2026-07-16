/**
 * A seeded review server: the REAL app, on a real port, with no database.
 *
 * `createApp(overrides)` already accepts fake repositories, and in the test
 * environment express-session falls back to its in-memory store. So the whole
 * application boots without MySQL, serving the real shell, the real page
 * modules and the real API. Only the data underneath is fixture data.
 *
 * That distinction is the point: this is not a mockup. Headless Chrome drives
 * the same router, the same ui.js and the same stylesheet a user gets in
 * production, so a layout bug here is a layout bug there.
 *
 * The seed is deliberately realistic: a business with a saved brand, all three
 * supported providers connected, a generated plan, queued and draft posts, and
 * verified image credentials. Nothing here is a real credential.
 *
 * Usage: node tools/review-server.mjs [port]
 */

import './setup-env.mjs';

import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { createFakeOverrides, createFakePlannerOpenAI, createFakeSocialImageService } from '../tests/helpers/fakes.js';

export const REVIEW_USER = Object.freeze({
  name: 'Sam Rivers',
  email: 'review@cyflow.test',
  password: 'Review-Pass-123456',
  timezone: 'Asia/Karachi',
});

export const REVIEW_BUSINESS = Object.freeze({
  businessName: 'Cyfrow Solutions',
  businessCategory: 'SEO agency',
  businessDescription:
    'An SEO agency working with small businesses on search visibility, from technical fixes and on-page work through to local search and content.',
  services: [
    'Keyword Research and Strategy', 'Content Writing', 'On-Page SEO', 'Local SEO',
    'WordPress Website Design', 'Link Building', 'SEO Audit', 'Technical SEO',
  ],
  locations: ['Lahore', 'Karachi'],
  city: 'Lahore',
  region: 'Punjab',
  websiteUrl: 'https://cyfrowsolutions.com',
  contactEmail: 'hello@cyfrowsolutions.com',
  contactPhone: '+92 300 0000000',
  defaultCallToAction: 'Ask us',
  defaultLanguage: 'English',
  defaultTone: 'professional',
  // The CUSTOMER's palette. Never Cyflow's green.
  primaryColor: '#111827',
  secondaryColor: '#23A455',
  accentColor: '#FDC70F',
  headingFont: 'Helvetica Neue',
  bodyFont: 'Helvetica Neue',
  /*
   * No logo on purpose.
   *
   * An unreachable https URL renders a broken image, and a review screenshot
   * containing one is not evidence of anything. The honest alternative is a
   * business that has not uploaded a logo yet, which also exercises the empty
   * state added in this phase. What must NEVER go here is a Cyflow asset: this
   * is the customer's brand, and borrowing the app's mark to fill the gap is
   * the exact violation the separation rules exist to prevent.
   */
  logoUrl: null,
});

/** The three supported providers, and only those. */
const PROVIDER_ACCOUNTS = Object.freeze([
  { provider: 'meta', accountType: 'facebook_page', providerAccountId: 'fb_1', displayName: 'Cyfrow Solutions', username: 'cyfrowsolutions' },
  { provider: 'meta', accountType: 'facebook_page', providerAccountId: 'fb_2', displayName: 'Cyfrow Solutions Lahore', username: 'cyfrowlahore' },
  { provider: 'instagram', accountType: 'instagram_professional', providerAccountId: 'ig_1', displayName: 'Cyfrow Solutions', username: 'cyfrow.solutions' },
  { provider: 'threads', accountType: 'threads_profile', providerAccountId: 'th_1', displayName: 'Cyfrow Solutions', username: 'cyfrow.solutions' },
]);

/**
 * Build the app with fakes. Returns the app plus the repositories, so a caller
 * can seed data that belongs to the user it just registered.
 */
export function buildReviewApp() {
  const overrides = createFakeOverrides({
    openaiContentService: createFakePlannerOpenAI(),
    socialImageService: { ...createFakeSocialImageService(), isReadyForUser: async () => true },
  });
  const app = createApp(overrides);
  return { app, overrides };
}

/**
 * Seed everything a review needs for one user id: brand, connections, a plan,
 * queued posts, verified image credentials.
 */
export async function seedWorld(overrides, userId) {
  const {
    businessProfileRepository, socialAccountRepository, plannerPreferenceRepository,
    integrationRepository, mediaAssetRepository, postRepository,
  } = overrides;

  await businessProfileRepository.createOrUpdateProfile(userId, {
    ...REVIEW_BUSINESS,
    onboardingStatus: 'completed',
    sourceType: 'website',
  });

  for (const account of PROVIDER_ACCOUNTS) {
    // eslint-disable-next-line no-await-in-loop
    await socialAccountRepository.upsertSocialAccount({
      userId,
      ...account,
      encryptedAccessToken: 'v1:fake-not-a-real-token',
      scopes: [],
      providerMetadata: {},
      status: 'active',
      verifiedAt: '2026-07-12 09:00:00',
    });
  }

  await plannerPreferenceRepository.upsertPreferences(userId, {
    cadence: 'every_day',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    times: ['09:00'],
    platforms: ['instagram', 'threads'],
    goals: ['awareness', 'education', 'trust_building'],
    tone: 'professional',
    ctaMode: 'some',
    approvalMode: 'require_approval',
    defaultPlanLength: 7,
    postsPerDay: 1,
    timezone: 'Asia/Karachi',
    contentRhythmPreset: 'balanced',
  });

  // Verified image credentials, so the planner offers images.
  if (integrationRepository?.saveHctiCredentials) {
    await integrationRepository.saveHctiCredentials(userId, {
      encryptedUserId: 'v1:fake', encryptedApiKey: 'v1:fake',
    });
    if (integrationRepository.markHctiVerified) await integrationRepository.markHctiVerified(userId);
  }

  return { mediaAssetRepository, postRepository };
}

/** Register the review user + seed their world. Uses the real password hashing. */
export async function seedReviewUser(overrides) {
  const bcrypt = (await import('bcrypt')).default;
  const passwordHash = await bcrypt.hash(REVIEW_USER.password, 4);
  const user = await overrides.userRepository.createUser({
    name: REVIEW_USER.name,
    email: REVIEW_USER.email,
    passwordHash,
    timezone: REVIEW_USER.timezone,
  });
  await seedWorld(overrides, user.id);
  return user;
}

/*
 * pathToFileURL, not string-building: on Windows import.meta.url is
 * file:///D:/... with three slashes, so a hand-rolled comparison never matches
 * and the server silently refuses to start. Guarded on argv[1] existing, so
 * importing this module (rather than running it) cannot throw.
 */
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.argv[2] || 4599);
  const { app, overrides } = buildReviewApp();
  const user = await seedReviewUser(overrides);
  app.listen(port, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`review server on http://127.0.0.1:${port} (seeded user ${user.id})`);
  });
}
