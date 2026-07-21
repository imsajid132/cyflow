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
import { encryptSecret } from '../src/services/encryptionService.js';
import { config as realConfig } from '../src/config/env.js';
import {
  createFakeOverrides, createFakePlannerOpenAI, createFakeSocialImageService,
  createFakeOpenAiVerifier, createFakePublishAdapters,
} from '../tests/helpers/fakes.js';
import { userMessageFor, isRetryableCategory } from '../src/utils/providerErrors.js';
import { PROVIDER_ERROR_CATEGORY as ERR_CAT, PROVIDER_NAMES } from '../src/config/constants.js';

/**
 * The provider-error scenario to seed, read from the environment so ONE
 * --with-image-error-plan flag can drive all ten authenticated E2E cases. The
 * safe message and the retryable flag are derived from the SAME production model
 * the real pipeline uses (userMessageFor / isRetryableCategory), so the seeded
 * card state is exactly what a real failure would persist — never a hand-written
 * string. Defaults reproduce the original HCTI credits case.
 */
function providerErrorScenarioFromEnv() {
  const kind = process.env.REVIEW_ERR_KIND || 'image'; // 'image' | 'content'
  const provider = process.env.REVIEW_ERR_PROVIDER
    || (kind === 'content' ? PROVIDER_NAMES.OPENAI : PROVIDER_NAMES.HCTI);
  const category = process.env.REVIEW_ERR_CATEGORY || ERR_CAT.CREDITS_EXHAUSTED;
  // Unset -> 402 (preserves the original HCTI-credits default for
  // error-visibility-smoke); the literal 'null' or '' -> no HTTP status (timeout,
  // invalid response, render failure, media persistence); otherwise the number.
  const rawStatus = process.env.REVIEW_ERR_STATUS;
  const httpStatus = rawStatus === undefined ? 402
    : (rawStatus === 'null' || rawStatus === '' ? null : Number(rawStatus));
  return {
    kind,
    provider,
    category,
    httpStatus: Number.isFinite(httpStatus) ? httpStatus : null,
    message: userMessageFor(provider, category),
    retryable: isRetryableCategory(category),
  };
}

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
  /*
   * The fake writer is told to ask the REAL credential check whether a given
   * user may generate.
   *
   * Without this the fake answers "yes, always" and a browser test watching for
   * "generation is blocked with no key" watches a path the harness has disabled.
   * It reported 201 on a plan for a user with no key — the harness passing over
   * the exact behaviour under test.
   *
   * Assigned after the overrides exist, because it closes over the repository.
   */
  let credentialCheck = async () => true;
  const openaiContentService = opts.repairEditorThreads
    ? createFakePlannerOpenAI({ validate: true, platformScript: { threads: [REPAIRED_EDITOR_THREADS] } })
    : opts.repairChecklist
    ? createFakePlannerOpenAI({
      validate: true,
      platformScript: { instagram: [REPAIRED_INSTAGRAM_CHECKLIST] },
    })
    : opts.repairThreads
    ? createFakePlannerOpenAI({
      validate: true,
      platformScript: { threads: [REPAIRED_THREADS] },
    })
    : createFakePlannerOpenAI({ isAvailableForUser: (u) => credentialCheck(u) });
  // D2: scriptable fake publish adapters so the browser smoke can drive publish
  // success, a per-platform failure (partial success), and reconciliation without
  // touching a real provider. The `script` object is mutated by /__review endpoints.
  const publishScript = {};
  const { adapters: publishAdapters } = createFakePublishAdapters(publishScript);
  // A per-tick logical clock, used ONLY for the live-publishing smoke. Time holds
  // still within a tick and advances between ticks, so an uncertain publish result
  // is reconciled on a LATER worker pass (as production's 60s-later reconcile job
  // would be) instead of inside the same drain. Other review runs keep real time.
  let clockMs = Date.parse('2026-07-18T09:00:00.000Z');
  const now = opts.livePublishing ? () => new Date(clockMs) : undefined;
  const advanceClock = (seconds) => { clockMs += Math.max(0, seconds) * 1000; };
  const overrides = createFakeOverrides({
    openaiContentService,
    socialImageService: { ...createFakeSocialImageService(), isReadyForUser: async () => true },
    // Test connection must not make a real network call from a review server.
    openAiVerifier: createFakeOpenAiVerifier(),
    publishAdapters,
    now,
    // Live publishing runs the FAKE adapters (never a real provider) when asked.
    config: {
      ...realConfig,
      publishing: {
        ...realConfig.publishing,
        liveEnabled: Boolean(opts.livePublishing),
        // The real 60s reconcile spacing; the per-tick clock (advanced 120s per
        // tick below) lands the reconcile job on the next tick, not the same one.
        reconcileDelaySeconds: 60,
      },
    },
  });
  // Now the repository exists: point the fake's availability at the real check.
  credentialCheck = (userId) =>
    (userId == null ? false : overrides.integrationRepository.hasConfiguredOpenAiCredentials(userId));
  const app = createApp(overrides);
  return { app, overrides, publishScript, advanceClock };
}

/**
 * Seed everything a review needs for one user id: brand, connections, a plan,
 * queued posts, verified image credentials.
 */
export async function seedWorld(overrides, userId, { withOpenAiKey = true } = {}) {
  const {
    businessProfileRepository, socialAccountRepository, plannerPreferenceRepository,
    integrationRepository, mediaAssetRepository, postRepository,
  } = overrides;

  await businessProfileRepository.createOrUpdateProfile(userId, {
    ...REVIEW_BUSINESS,
    onboardingStatus: 'completed',
    sourceType: 'website',
  });

  // A real AES envelope so the publishing pipeline's decryptSecret() succeeds.
  // The plaintext is an obvious fake — no real provider is ever contacted.
  const fakeAccessToken = encryptSecret('review-fake-access-token');
  for (const account of PROVIDER_ACCOUNTS) {
    // eslint-disable-next-line no-await-in-loop
    await socialAccountRepository.upsertSocialAccount({
      userId,
      ...account,
      encryptedAccessToken: fakeAccessToken,
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

  /*
   * A verified OpenAI key, because a customer without one can no longer
   * generate — and this seed represents a working customer.
   *
   * Found by running the existing browser suites after C1: every retry started
   * failing with "Add and verify your OpenAI API key", which was the new rule
   * doing exactly its job against a seeded user who had never configured one.
   * Before C1 the global application key covered for them silently. That is the
   * whole point of the change, visible in the harness.
   *
   * A REAL envelope, not the 'v1:fake' the HCTI seed uses: the resolver decrypts
   * this one, so it has to actually open. It encrypts a fake key that is valid
   * for nothing, under the test encryption key.
   */
  if (withOpenAiKey) {
    await integrationRepository.upsertEncryptedOpenAiCredentials({
      userId,
      encryptedApiKey: encryptSecret('sk-review-fake-not-a-real-key-000000000000000000000000'),
      model: 'gpt-4o-mini',
    });
    await integrationRepository.markOpenAiVerified(userId, '2026-07-12 09:00:00');
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

/*
 * A PASSING item with genuinely different Instagram and Threads copy, for the
 * platform-editor browser test. Both are valid, so the test drives editing,
 * saving and per-platform independence rather than repair.
 */
export const EDITOR_ITEM_COPY = Object.freeze({
  instagram: [
    'Search visibility is not one thing you buy once. It is a set of small, boring habits that compound, and most of them cost nothing but attention to the pages you already have.',
    'Start with the three pages you would be most annoyed to lose a customer over. Read them as a stranger would. Do they say what the job involves, what it costs to look into, and who it is for, in the first two lines?',
    'If they do, you are ahead of most of your competition already. If they do not, that is a free afternoon of work that beats any audit you could pay for this month.',
  ].join('\n\n'),
  threads: [
    'Most SEO advice is just "write pages a person would actually want to read." Everything else is downstream of that.',
    'Pick your top service page. Does it answer what the job is, what it costs to look into, and who it is for, before a visitor has to scroll? That is the whole test.',
  ].join('\n\n'),
});

/** The Threads copy the writer returns when the editor test retries Threads. */
export const REPAIRED_EDITOR_THREADS = [
  'Rewritten by the machine on request: your service page is your best salesperson, so read it as a stranger would once a month.',
  'Does it say what the job involves, what it costs to look into, and who it is for, before anyone scrolls? If not, that is your afternoon.',
].join('\n\n');

/*
 * The live CHECKLIST case, exactly as reported.
 *
 * Friday, Actionable Tips, format Checklist, family Checklist Guide, Instagram
 * Professional and Threads, Facebook unselected:
 *
 *   Threads had 6 paragraphs; allowed 1 to 3
 *   Instagram had 100 words; minimum 120
 *   Instagram had 11 paragraphs; allowed 2 to 4
 *
 * Both posts are GOOD checklists. Under the old line-splitting paragraph count
 * every item was a paragraph, so neither could ever pass.
 */
export const CHECKLIST_ITEM_COPY = Object.freeze({
  threads: [
    'Before you pay for another SEO audit, check these yourself. It takes ten minutes and it tells you whether the audit is worth buying.',
    '- Does every service page say what the job involves?',
    '- Can you find your phone number without scrolling?',
    '- Does the homepage name the town you work in?',
    '- Do your images have alt text?',
    '- Does anything load slower than three seconds?',
  ].join('\n'),
  // 106 words: genuinely under Instagram's 120 floor, and 3 prose paragraphs,
  // which is valid. Only the word count is really wrong.
  instagram: [
    'Most people paying for search work cannot say what they got for it last month.',
    'Here is what to check before you pay for another audit:',
    '- Does every service page say what the job involves?',
    '- Can a visitor find your phone number without scrolling?',
    '- Does the homepage name the town you actually work in?',
    '- Do your images carry alt text?',
    '- Does any page take longer than three seconds?',
    '- Is the same phone number on every page?',
    '- Does your title tag say what you do?',
    'If most of those fail, an audit will only tell you what you just read.',
  ].join('\n'),
});

/** The Instagram repair: the LIST grows, the prose count stays valid. */
export const REPAIRED_INSTAGRAM_CHECKLIST = [
  'Most people paying for search work cannot say what they got for it last month. That is not a failure of attention on their part; it is what happens when a report is built to look busy rather than to be read.',
  'Before you buy another audit, run these checks yourself. Each takes a minute and none of them needs any technical knowledge:',
  '- Does every service page say what the job actually involves, in plain words?',
  '- Can a visitor find your phone number without scrolling?',
  '- Does the homepage name the town you actually work in?',
  '- Do your images carry alt text that describes them?',
  '- Does any page take longer than three seconds to load?',
  '- Is the same phone number on every single page?',
  '- Does your title tag say what you do, or just your business name?',
  'If most of those fail, an audit will tell you what you have just read for yourself, and charge you to hear it again.',
].join('\n');

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
  const checklist = scenario === 'checklist';
  const editor = scenario === 'editor';

  if (editor) {
    /*
     * A PASSING item with distinct valid per-platform copy. The platform-editor
     * test edits Threads, saves, reloads and verifies independence, then retries
     * Threads with an overwrite confirmation — none of which needs a failure.
     */
    await overrides.plannerRunRepository.updateItem(target.id, userId, {
      caption: EDITOR_ITEM_COPY.instagram,
      platformCaptions: {
        instagram: { caption: EDITOR_ITEM_COPY.instagram, hashtags: ['#seo', '#smallbusiness'] },
        threads: { caption: EDITOR_ITEM_COPY.threads, hashtags: [] },
      },
      approvalStatus: 'needs_review',
      qualityStatus: 'passed',
      qualityFailures: null,
      duplicationScore: 0.1,
      duplicationNotes: null,
    });
    return { runId: plan.run.id, failedItemId: target.id, scenario };
  }

  if (scenario === 'image_error') {
    /*
     * A post whose provider operation failed with a specific, safe category —
     * parametrized by env so ONE flag drives all ten authenticated E2E cases.
     * The caption is INTACT. For an IMAGE failure the board must show
     * "Image failed / <PROVIDER> · <label>" + Retry image, never a bare
     * "No image". For a CONTENT (OpenAI) failure the card shows "Generation
     * failed" + the safe reason. Both must survive a refresh and leak no secret,
     * DB id, or raw provider body. Drives tools/error-visibility-smoke.mjs and
     * tools/provider-error-e2e-smoke.mjs.
     */
    const errS = providerErrorScenarioFromEnv();
    const ir = overrides.integrationRepository;

    if (errS.kind === 'content') {
      // An OpenAI content-generation failure: the ITEM is generation_failed and
      // carries the safe, provider-specific reason (no key, no raw body).
      await overrides.plannerRunRepository.updateItem(target.id, userId, {
        approvalStatus: 'generation_failed',
        qualityStatus: 'generation_failed',
        qualityFailures: [errS.message],
        mediaAssetId: null,
      });
      if (ir && typeof ir.upsertEncryptedOpenAiCredentials === 'function') {
        await ir.upsertEncryptedOpenAiCredentials({ userId, encryptedApiKey: 'v1:OPENAI_KEY' }).catch(() => {});
        if (ir.recordOpenAiHealth) {
          await ir.recordOpenAiHealth(userId, { success: false, category: errS.category, at: '2026-07-20 09:00:00' }).catch(() => {});
        }
      }
      return { runId: plan.run.id, failedItemId: target.id, scenario, errorKind: 'content' };
    }

    // An IMAGE failure (HCTI render categories + media persistence).
    await overrides.plannerRunRepository.updateItem(target.id, userId, {
      approvalStatus: 'needs_review',
      qualityStatus: 'passed',
      // Clear any rendered asset so the FAILED state is what the board reads
      // (a present media asset always reads as ready).
      mediaAssetId: null,
      imageStatus: 'failed',
      imageProvider: errS.provider,
      imageErrorCategory: errS.category,
      imageErrorCode: errS.category,
      imageErrorMessage: errS.message,
      imageHttpStatus: errS.httpStatus,
      imageRetryable: errS.retryable,
      imageAttemptCount: 2,
    });
    // Configure HCTI + a matching health state so the Integrations panel renders
    // its label editor and the last-error category (safe, credential-free).
    if (ir && typeof ir.upsertEncryptedHctiCredentials === 'function') {
      await ir.upsertEncryptedHctiCredentials({ userId, encryptedUserId: 'v1:HCTI_USER', encryptedApiKey: 'v1:HCTI_KEY' }).catch(() => {});
      if (ir.markHctiVerified) await ir.markHctiVerified(userId, '2026-07-18 09:00:00').catch(() => {});
      if (ir.setHctiLabel) await ir.setHctiLabel(userId, 'Main HCTI').catch(() => {});
      if (ir.recordHctiHealth) {
        await ir.recordHctiHealth(userId, { success: false, category: errS.category, at: '2026-07-20 09:00:00' }).catch(() => {});
      }
    }
    return { runId: plan.run.id, failedItemId: target.id, scenario, errorKind: 'image' };
  }

  const copy = checklist ? CHECKLIST_ITEM_COPY : FAILED_ITEM_COPY;
  await overrides.plannerRunRepository.updateItem(target.id, userId, {
    ...(duplicate ? {} : {
      caption: copy.instagram,
      contentFormat: checklist ? 'checklist' : undefined,
      platformCaptions: {
        instagram: { caption: copy.instagram, hashtags: ['#seo'] },
        threads: { caption: copy.threads, hashtags: [] },
      },
    }),
    approvalStatus: 'generation_failed',
    qualityStatus: 'generation_failed',
    qualityFailures: duplicate
      ? ['this post is a near-duplicate of another one']
      : checklist
        // The reported failures, verbatim. Under the fixed validator only the
        // Instagram word count is real; the paragraph counts were list items.
        ? [
          'Threads has 6 paragraphs; allowed 1 to 3',
          'Instagram has 100 words; minimum 120',
          'Instagram has 11 paragraphs; allowed 2 to 4',
        ]
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
export async function seedReviewUser(overrides, opts = {}) {
  const bcrypt = (await import('bcrypt')).default;
  const passwordHash = await bcrypt.hash(REVIEW_USER.password, 4);
  const user = await overrides.userRepository.createUser({
    name: REVIEW_USER.name,
    email: REVIEW_USER.email,
    passwordHash,
    timezone: REVIEW_USER.timezone,
  });
  await seedWorld(overrides, user.id, opts);
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
  // --with-checklist-plan  the live Checklist case (tools/checklist-smoke.mjs)
  const withChecklist = process.argv.includes('--with-checklist-plan');
  const withEditor = process.argv.includes('--with-editor-plan');
  // --with-image-error-plan  an approved post whose IMAGE failed (credits) —
  // the board must show the reason + Retry, never "No image" (error-visibility-smoke)
  const withImageError = process.argv.includes('--with-image-error-plan');
  /*
   * --without-openai-key  seed a customer who has NOT configured OpenAI.
   *
   * The default seed has a key, because the default seed represents a working
   * customer and every AI action needs one now. The OpenAI integration smoke
   * test needs the opposite: someone starting from nothing.
   */
  const withoutOpenAiKey = process.argv.includes('--without-openai-key');
  const livePublishing = process.argv.includes('--live-publishing');
  const { app, overrides, publishScript, advanceClock } = buildReviewApp({ repairThreads: withPlan, repairChecklist: withChecklist, repairEditorThreads: withEditor, livePublishing });
  const user = await seedReviewUser(overrides, { withOpenAiKey: !withoutOpenAiKey });

  let seeded = '';
  if (withPlan || withDuplicate || withChecklist || withEditor || withImageError) {
    const { buildPlannerService } = await import('./review-planner.mjs');
    const info = await seedFailedPlan(overrides, user.id, buildPlannerService(overrides), {
      scenario: withDuplicate ? 'duplicate' : withChecklist ? 'checklist' : withEditor ? 'editor' : withImageError ? 'image_error' : 'repair',
    });
    seeded = ` run=${info.runId} failedItem=${info.failedItemId} scenario=${info.scenario}`;
  }

  // D1: a review-only in-process "tick" that stands in for the separate
  // scheduler:once + worker:once processes (which need a real DB). It drives the
  // SAME durable pipeline — enqueue due refills, then drain the job queue — over
  // the shared in-memory fakes, so the browser smoke can watch an automation
  // fill its buffer without a database. Never mounted by createApp; review only.
  const express = (await import('express')).default;
  const { buildContainer } = await import('../src/container.js');
  const container = buildContainer(overrides);
  const wrapper = express();
  wrapper.post('/__review/tick', express.json(), async (req, res) => {
    try {
      const refills = await container.automationService.enqueueDueRefills({ limit: 100 });
      // D2: enqueue publish jobs for due, approved, queued targets (skipped when
      // live publishing is off). Uses the FAKE adapters — no real provider.
      const publishes = await container.publishingService.enqueueDuePublishTargets({ limit: 100 });
      const outcomes = await container.durableJobService.drain({ workerId: 'review-worker', max: 1000 });
      const counts = outcomes.reduce((m, o) => { m[o.outcome] = (m[o.outcome] || 0) + 1; return m; }, {});
      // Advance the per-tick clock (live-publishing only) so a reconcile job
      // enqueued this tick becomes due on the NEXT tick, never inside this drain.
      advanceClock(120);
      res.json({ ok: true, refills, publishes, processed: outcomes.length, counts });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || 'tick failed' });
    }
  });

  // Seed an automation whose slot mix forces a specific diagnostics reason, so a
  // browser can assert the "Only N of M prepared" banner for preparing / failures
  // / shortfall (+ skipped) states. Drives tools/automation-diagnostics-smoke.mjs.
  wrapper.post('/__review/seed-automation-diagnostics', express.json(), async (req, res) => {
    try {
      const {
        name = 'Diag', ready = 0, planned = 0, failed = 0, skipped = 0,
      } = req.body || {};
      const ar = overrides.automationRepository;
      const a = await ar.createAutomation({
        userId: user.id, name, status: 'active', mode: 'review', timezone: 'Asia/Karachi',
        selectedWeekdays: [1, 2, 3, 4, 5, 6, 7], postingTimes: ['09:00'], postsPerDay: 1,
        selectedPlatforms: ['facebook'], selectedAccountIds: ['1'],
        generationHorizonDays: 7, minimumReadyDays: 7, lowBufferDays: 3, missedPostPolicy: 'skip',
      });
      // A non-null backing run makes computeBuffer read the seeded slot mix.
      await ar.updateAutomation(a.id, user.id, { plannerRunId: '99000', status: 'active' });
      let seq = 0;
      const mk = async (status) => {
        const localDate = `2026-09-${String(1 + seq).padStart(2, '0')}`;
        const { slot } = await ar.createSlotIfAbsent({
          userId: user.id, automationId: a.id, localDate, localTime: '09:00', sequence: seq,
          scheduledForUtc: `${localDate} 04:00:00`, idempotencyKey: `diag:${a.id}:${seq}`,
        });
        seq += 1;
        if (status === 'ready') await ar.markSlotReady(slot.id, user.id, '1');
        else if (status !== 'planned') await ar.markSlotStatus(slot.id, user.id, status);
      };
      for (let i = 0; i < ready; i += 1) await mk('ready'); // eslint-disable-line no-await-in-loop
      for (let i = 0; i < planned; i += 1) await mk('planned'); // eslint-disable-line no-await-in-loop
      for (let i = 0; i < failed; i += 1) await mk('failed'); // eslint-disable-line no-await-in-loop
      for (let i = 0; i < skipped; i += 1) await mk('skipped'); // eslint-disable-line no-await-in-loop
      res.json({ ok: true, automationId: a.id });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || 'seed failed' });
    }
  });

  // D2: seed a DUE queued post with Instagram + Threads targets (never Facebook),
  // so the smoke can publish it. Optional { threadsFail, igSubmitted } scripts the
  // fake adapters for partial-success and reconciliation scenarios.
  wrapper.post('/__review/seed-publish', express.json(), async (req, res) => {
    try {
      const userId = user.id;
      const accts = await overrides.socialAccountRepository.listAccountsForUser(userId);
      const ig = accts.find((a) => a.accountType === 'instagram_professional');
      const th = accts.find((a) => a.accountType === 'threads_profile');
      // Reset then apply the requested adapter behaviour.
      for (const k of Object.keys(publishScript)) delete publishScript[k];
      if (req.body?.threadsFail) publishScript.threads = { publish: { status: 'permanent_failure', errorCategory: 'permission_required', safeMessage: 'Reconnect this Threads account.' } };
      if (req.body?.igSubmitted) {
        let n = 0;
        publishScript.instagram = { publish: () => { n += 1; return { status: 'submitted', providerContainerId: 'cont_review' }; }, reconcile: { status: 'published', providerPostId: 'ig_reconciled' } };
      }
      const draft = await overrides.postRepository.createDraftPost({ userId, title: req.body?.title || 'Publish test', prompt: 'brief' });
      await overrides.postRepository.updateGeneratedContent(draft.id, userId, { platformCaptions: { instagram: { caption: 'IG copy', hashtags: [] }, threads: { caption: 'Threads copy', hashtags: [] } }, baseCaption: 'base' });
      // A ready image so Instagram (media required) passes preflight. The token
      // is a harmless review fixture; no real asset is fetched by a fake adapter.
      const asset = await overrides.mediaAssetRepository.createMediaAsset({
        userId, publicToken: `review-media-${draft.id}`, status: 'ready',
        sourceUrl: 'https://example.test/review-1080.jpg', sourceProvider: 'upload',
        mimeType: 'image/jpeg', fileExtension: 'jpg', width: 1080, height: 1080,
      });
      await overrides.postRepository.attachMediaAsset(draft.id, userId, { mediaAssetId: asset.id });
      await overrides.postRepository.replacePostTargets(draft.id, userId, [{ socialAccountId: ig.id }, { socialAccountId: th.id }]);
      await overrides.postRepository.schedulePost(draft.id, userId, { scheduledAtUtc: '2020-01-01 00:00:00', originalTimezone: 'UTC' });
      res.json({ ok: true, postId: draft.id });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || 'seed failed' });
    }
  });
  // Reset/replace the fake-adapter script (e.g. clear a scripted failure before a retry).
  wrapper.post('/__review/publish-script', express.json(), (req, res) => {
    for (const k of Object.keys(publishScript)) delete publishScript[k];
    Object.assign(publishScript, req.body?.script || {});
    res.json({ ok: true });
  });
  // Review-only: the seed-publish fixtures reference an image by public token but
  // there is no object store behind this DB-less harness, so serve a tiny valid
  // PNG for those tokens. Real tokens fall through to the app's /media route.
  /*
   * A neutral light-grey 16x16 tile, NOT a 1x1 black pixel. The previous
   * placeholder rendered as a solid black square wherever a thumbnail was drawn,
   * which is indistinguishable from a broken image in a screenshot review and so
   * made every rendered page look defective when nothing was actually wrong.
   */
  const REVIEW_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP4+PUnSYhhVMOohuGrAQC0+98f6/R0hAAAAABJRU5ErkJggg==',
    'base64',
  );
  /*
   * Tokens this file seeds always get the tile. Plan generation also mints its
   * own media rows whose stored bytes are a 1x1 placeholder, and at the 80px a
   * planner card draws them a 1x1 becomes a solid black square that reads as a
   * broken image in a screenshot review. --placeholder-media widens the tile to
   * those too.
   *
   * It is OPT-IN, and deliberately so: serving every token unconditionally also
   * swallowed the app's own /media behaviour, and the media smoke caught it —
   * "serves inline (not as a download)" and both path-traversal refusals
   * started passing through this handler instead of the route under test. Only
   * the screenshot pass sets the flag; every smoke exercises the real route.
   */
  const placeholderMedia = process.argv.includes('--placeholder-media');
  wrapper.get('/media/:token', (req, res, next) => {
    const token = String(req.params.token || '');
    const seeded = token.startsWith('review-media-');
    // A conservative shape check, so a traversal payload can never match.
    const fixtureToken = placeholderMedia && /^[A-Za-z0-9_-]{16,}$/.test(token);
    if (!seeded && !fixtureToken) return next();
    res.status(200);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(REVIEW_PNG);
  });
  wrapper.use(app);

  wrapper.listen(port, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`review server on http://127.0.0.1:${port} (user ${user.id})${seeded}`);
  });
}
