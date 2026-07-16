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
 *
 * @param {{ repairThreads?: boolean }} [opts] when set, the writer returns a
 *        valid Threads post and the REAL validator accepts it — so the browser
 *        retry exercises a genuine repair rather than a stubbed success.
 */
export function buildReviewApp(opts = {}) {
  const openaiContentService = opts.repairThreads
    ? createFakePlannerOpenAI({
      validate: true,
      platformScript: { threads: [REPAIRED_THREADS] },
    })
    : createFakePlannerOpenAI();
  const overrides = createFakeOverrides({
    openaiContentService,
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

/*
 * Planner item 31, as a fixture.
 *
 * Instagram is perfectly good copy. Threads is 44 words against a floor of 45 —
 * the exact reported state, one word short. Both are measured by the test that
 * uses them, so neither can drift.
 */
export const FAILED_ITEM_COPY = Object.freeze({
  instagram: [
    'Most people paying for search work cannot say what they got for it last month. That is not a failure of attention on their part. It is what happens when a report is built to look busy rather than to be read.',
    'Ask which pages were touched and why those ones. Ask what changed on them, in plain words, and what the change was meant to do. A good answer is short and specific: the page for the service you actually sell was thin, so it now says what the job involves and what it costs to look into. A weak answer talks about visibility and momentum.',
    'None of this needs you to understand technical work. It needs a straight reply. If the reply arrives dressed in vocabulary, you have learned something anyway, and you have learned it before the invoice rather than after it.',
  ].join('\n\n'),
  threads: [
    'Most people paying for SEO could not tell you what they got for it last month. Ask which pages were worked on, and why those ones.',
    'A vague answer is itself the answer. You do not need the vocabulary to judge a straight reply.',
  ].join('\n\n'),
});

/** What the writer returns when the Threads post is repaired: 69 words. */
export const REPAIRED_THREADS = [
  'Ask an agency which pages it worked on last month, and why those ones. The answer tells you more than the report will.',
  'A useful reply sounds like this: the page for the service you actually sell was thin, so it now explains what the job involves. A weak reply talks about visibility.',
  'You do not need the vocabulary to judge a straight answer. That is the whole test.',
].join('\n\n');

/**
 * Seed a real plan whose first item is planner item 31, so the retry can be
 * driven in a browser.
 *
 * The plan is generated through the REAL service, then one item is put into the
 * reported state: Instagram valid, Threads one word short, nothing duplicated.
 * Nothing about the retry path is stubbed — clicking Retry in the browser runs
 * the real validator, the real repair loop and the real single-flight guard.
 */
export async function seedFailedPlan(overrides, userId, plannerService, { scenario = 'repair' } = {}) {
  /*
   * Start tomorrow, not on a fixed date. The schedule engine drops slots that
   * are already in the past, so a hardcoded date silently produces an empty
   * plan the moment it goes stale.
   */
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);

  const plan = await plannerService.generatePlan(userId, {
    startDate: tomorrow,
    planLength: 2,
    cadence: 'every_day',
    times: ['09:00'],
    postsPerDay: 1,
    timezone: 'Asia/Karachi',
    platforms: ['instagram', 'threads'],
    contentRhythmPreset: 'balanced',
  });

  const target = plan.items[0];

  /*
   * Two different failures, because they take two different routes through the
   * planner and each has its own browser test.
   *
   * 'repair'    — planner item 31. Threads one word short, Instagram fine,
   *               nothing duplicated. The retry rewrites Threads ONLY, so the
   *               card's copy (which is Instagram's) does not change.
   * 'duplicate' — the Phase 4.8 failure. The post repeats another post, so the
   *               angle itself must change and every platform follows. This is
   *               the only scenario where the visible copy changes, which is
   *               what the drawer-staleness test needs in order to mean
   *               anything.
   */
  const duplicate = scenario === 'duplicate';
  await overrides.plannerRunRepository.updateItem(target.id, userId, {
    ...(duplicate ? {} : {
      caption: FAILED_ITEM_COPY.instagram,
      platformCaptions: {
        instagram: { caption: FAILED_ITEM_COPY.instagram, hashtags: ['#seo'] },
        threads: { caption: FAILED_ITEM_COPY.threads, hashtags: [] },
      },
    }),
    approvalStatus: 'generation_failed',
    qualityStatus: 'generation_failed',
    qualityFailures: duplicate
      ? ['this post is a near-duplicate of another one']
      : ['Threads has 44 words; the minimum is 45'],
    duplicationScore: duplicate ? 0.91 : 0.157,
    duplicationNotes: duplicate
      ? 'Too similar to a recent post: a similar angle, the same hashtags.'
      : null,
    regenerationCount: duplicate ? 0 : 9,
  });

  return { runId: plan.run.id, failedItemId: target.id, scenario };
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
  // --with-failed-plan   planner item 31: Threads one word short (tools/repair-smoke.mjs)
  // --with-duplicate-plan the 4.8 failure: a near-duplicate  (tools/retry-smoke.mjs)
  const withPlan = process.argv.includes('--with-failed-plan');
  const withDuplicate = process.argv.includes('--with-duplicate-plan');
  const { app, overrides } = buildReviewApp({ repairThreads: withPlan });
  const user = await seedReviewUser(overrides);

  let seeded = '';
  if (withPlan || withDuplicate) {
    const { buildPlannerService } = await import('./review-planner.mjs');
    const info = await seedFailedPlan(overrides, user.id, buildPlannerService(overrides), {
      scenario: withDuplicate ? 'duplicate' : 'repair',
    });
    seeded = ` run=${info.runId} failedItem=${info.failedItemId} scenario=${info.scenario}`;
  }

  app.listen(port, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`review server on http://127.0.0.1:${port} (user ${user.id})${seeded}`);
  });
}
