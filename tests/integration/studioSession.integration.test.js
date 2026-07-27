// What the studio puts back on screen, proven against a REAL database.
//
// The unit tests use a Map for the profile store, which cannot fail the way this
// actually fails. The brand is kept in a JSON column, and JSON columns are where
// this project has been bitten before: a driver that hands back a string instead
// of an object, a `CAST(? AS JSON)` MariaDB rejects, a merge that silently drops
// the other key in the same column. All of that is invisible until it runs on
// MariaDB, so it runs on MariaDB here.
//
// The other half is the week. A run id lived only in the browser tab that started
// it; finding the week again is a query, and a query is worth proving.
import { hasDatabase, resetDatabase, SKIP } from './helpers/db.js';
import '../helpers/setupEnv.js';

import test, { before, beforeEach, after } from 'node:test';   // eslint-disable-line import/first
import assert from 'node:assert/strict';                        // eslint-disable-line import/first

import { getPool, closePool } from '../../src/db/pool.js';                               // eslint-disable-line import/first
import * as users from '../../src/repositories/userRepository.js';                       // eslint-disable-line import/first
import * as businessProfiles from '../../src/repositories/businessProfileRepository.js'; // eslint-disable-line import/first
import { createStudioMemory } from '../../src/services/aiStudio/studioMemory.js';        // eslint-disable-line import/first
import { createWeekService } from '../../src/services/aiStudio/weekService.js';          // eslint-disable-line import/first

let pool;
before(() => { if (hasDatabase) pool = getPool(); });
after(async () => { if (hasDatabase) await closePool().catch(() => {}); });
beforeEach(async () => { if (hasDatabase) await resetDatabase(pool); });

const BRAND = {
  businessName: 'Karachi Coffee Roasters',
  industry: 'Specialty coffee cafe',
  description: 'Single-origin coffee and slow-steeped cold brew.',
  services: ['Cold brew', 'Single-origin beans'],
  logoUrl: 'https://x.example/logo.png',
  fonts: { heading: 'Playfair Display', body: 'Inter' },
  colors: { primary: '#6F4E37', secondary: '#2B1B12', accent: '#E4B363' },
  contact: { phone: '+92 300 0000000', email: 'hi@x.example', city: 'Karachi', websiteUrl: 'https://x.example' },
  socialLinks: { instagram: 'https://instagram.com/kcr' },
  images: [
    { url: 'https://x.example/shop.jpg', alt: 'The shop', kind: 'photo', chosen: true },
    { url: 'https://x.example/logo.png', alt: 'Logo', kind: 'logo', chosen: false },
  ],
};

async function seedUser(email = 'studio-session@example.test') {
  const u = await users.createUser({
    name: 'Operator', email, passwordHash: 'x'.repeat(60), timezone: 'Asia/Karachi',
  });
  return String(u.id);
}

test('a brand survives the round trip through a real JSON column', SKIP, async () => {
  const userId = await seedUser();
  const memory = createStudioMemory();

  await memory.rememberBrand(userId, BRAND);
  const back = await memory.recallBrand(userId);

  assert.ok(back, 'the brand came back at all');
  assert.equal(back.businessName, 'Karachi Coffee Roasters');
  assert.equal(back.industry, 'Specialty coffee cafe');
  assert.deepEqual(back.services, ['Cold brew', 'Single-origin beans']);
  assert.equal(back.fonts.heading, 'Playfair Display');
  // Saved brand colours must come back EXACTLY as saved — never re-derived.
  assert.equal(back.colors.primary, '#6F4E37');
  assert.equal(back.colors.secondary, '#2B1B12');
  assert.equal(back.colors.accent, '#E4B363');
  assert.equal(back.contact.city, 'Karachi');
  assert.equal(back.socialLinks.instagram, 'https://instagram.com/kcr');
  // Which pictures were ticked is a decision the user made.
  assert.equal(back.images.length, 2);
  assert.equal(back.images[0].chosen, true);
  assert.equal(back.images[1].chosen, false);
});

test('editing the brand replaces it rather than accumulating versions', SKIP, async () => {
  const userId = await seedUser();
  const memory = createStudioMemory();

  await memory.rememberBrand(userId, BRAND);
  await memory.rememberBrand(userId, { ...BRAND, industry: 'Coffee roastery and cafe' });

  const back = await memory.recallBrand(userId);
  assert.equal(back.industry, 'Coffee roastery and cafe');

  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM business_profiles');
  assert.equal(Number(rows[0].n), 1, 'one user, one profile row');
});

/*
 * This column belongs to onboarding's website extract as well. On a real
 * database the failure is silent: the write succeeds and the other key is simply
 * gone.
 */
test('remembering a brand does not wipe onboarding own extract', SKIP, async () => {
  const userId = await seedUser();
  await businessProfiles.createOrUpdateProfile(userId, {
    businessName: 'Karachi Coffee Roasters',
    extractedMetadata: { pagesAnalyzed: ['https://x.example', 'https://x.example/about'] },
  });

  await createStudioMemory().rememberBrand(userId, BRAND);

  const profile = await businessProfiles.findByUserId(userId, { includeDiagnostics: true });
  assert.deepEqual(
    profile.extractedMetadata.pagesAnalyzed,
    ['https://x.example', 'https://x.example/about'],
    'the onboarding extract is still there',
  );
  assert.equal(profile.extractedMetadata.aiStudioBrand.businessName, 'Karachi Coffee Roasters');
  // And the row's ordinary columns were not disturbed by a JSON-only write.
  assert.equal(profile.businessName, 'Karachi Coffee Roasters');
});

test('one user brand is not readable by another', SKIP, async () => {
  const mine = await seedUser('mine@example.test');
  const theirs = await seedUser('theirs@example.test');
  const memory = createStudioMemory();

  await memory.rememberBrand(mine, BRAND);
  assert.equal(await memory.recallBrand(theirs), null);
});

/*
 * The week takes five to eight minutes to build. The run id existed only in the
 * tab that started it, so without this a refresh abandoned posters that were
 * still being made.
 */
test('the week in progress is found again after the tab is gone', SKIP, async () => {
  const userId = await seedUser();
  const plan = Array.from({ length: 7 }, (_, i) => ({
    day: i + 1, job: 'introduce', angle: `Angle ${i + 1}`, service: 'Cold brew', why: 'For locals.',
  }));

  const svc = createWeekService({
    planner: async () => plan,
    generatePost: async () => { throw new Error('not called in this test'); },
  });

  const { runId } = await svc.startWeek(userId, {
    businessName: 'Karachi Coffee Roasters', industry: 'Specialty coffee cafe',
    primary: '#6F4E37', secondary: '#2B1B12', accent: '#E4B363', services: ['Cold brew'],
  }, { timezone: 'Asia/Karachi' });

  const found = await svc.findLatestWeek(userId);
  assert.ok(found, 'the week was found without being given its id');
  assert.equal(found.runId, runId);
  assert.equal(found.total, 7);
  assert.equal(found.ready, 0, 'nothing is built yet, and that is reported honestly');
  assert.equal(found.plan.length, 7, 'the seven ideas come back so the screen is not blank');

  /*
   * Every day says which kind of "not yet" it is. Half an hour of "0 / 7" with
   * nothing to explain it is the failure this prevents — and it reads the real
   * background_jobs rows the enqueue above created.
   */
  assert.equal(found.days.length, 7);
  assert.ok(found.days.every((d) => d.state === 'queued'), `all seven queued, got ${found.days.map((d) => d.state).join()}`);

  // A user with no studio week gets null, not someone else's.
  assert.equal(await createWeekService().findLatestWeek(await seedUser('nobody@example.test')), null);
});

/*
 * Activating a week, through the REAL planner queue on MariaDB.
 *
 * The unit tests record the queue call; they cannot see whether the schedule it
 * produces is one the queue will accept. Two things only a real run proves: the
 * first post must be timed into the FUTURE (queueing silently skips a slot whose
 * time has passed, which would drop the one post the user was promised goes out
 * immediately), and the account selection must be read from the RUN rather than
 * rebuilt — the defect that once attached seven Facebook Pages to one post.
 */
test('activating a week schedules it through the real queue', SKIP, async () => {
  const { buildContainer } = await import('../../src/container.js');
  const social = await import('../../src/repositories/socialAccountRepository.js');
  const postsRepo = await import('../../src/repositories/postRepository.js');

  const userId = await seedUser('activate@example.test');
  await social.upsertSocialAccount({
    userId, provider: 'meta', accountType: 'facebook_page', providerAccountId: 'fb-activate',
    displayName: 'Pioneer Construction NYC', username: 'pioneer', encryptedAccessToken: 'v1:t',
    scopes: [], providerMetadata: {}, status: 'active',
  });
  const [chosen] = await social.listAccountsForUser(userId);

  const container = buildContainer();
  const svc = container.aiStudioWeekService;

  const plan = Array.from({ length: 3 }, (_, i) => ({
    day: i + 1, job: 'introduce', angle: `Angle ${i + 1}`, service: 'Brick pointing', why: 'For owners.',
  }));
  const weekSvc = (await import('../../src/services/aiStudio/weekService.js')).createWeekService({
    planner: async () => plan,
    generatePost: async () => ({
      copy: {
        headline: 'Bad pointing lets water in', subtext: 'We stop it', cta: 'Book now', points: ['a', 'b'],
        captions: { facebook: 'FB copy', instagram: 'IG copy', threads: 'TH copy' },
        hashtags: ['#masonry'],
      },
      png: null,
      imageError: null,
    }),
    fetchPhoto: async () => null,
    queue: (u, r, ids) => container.plannerService.queueApproved(u, r, ids),
  });

  const { runId } = await weekSvc.startWeek(userId, {
    businessName: 'Pioneer Construction NYC', industry: 'General contractor',
    primary: '#121212', secondary: '#8a8a8a', accent: '#e8402a',
  }, { timezone: 'America/New_York' });
  for (let d = 1; d <= 3; d += 1) {
    // eslint-disable-next-line no-await-in-loop
    await weekSvc.runPostJob({ userId, payload: { runId, day: d } });
  }

  const out = await weekSvc.activateWeek(userId, runId, {
    accountIds: [String(chosen.id)],
    timezone: 'America/New_York',
    dailyTime: '09:00',
  });

  assert.equal(out.queued, 3, 'every post reached the queue, including the immediate one');
  assert.deepEqual(out.skipped, [], `nothing was skipped: ${JSON.stringify(out.skipped)}`);

  // In the tables, not only through the return value.
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM scheduled_posts WHERE user_id = ?', [userId]);
  assert.equal(Number(rows[0].n), 3);

  /*
   * Exactly one target per post, and it is the account that was CHOSEN. This is
   * the assertion that would have caught the seven-Pages fan-out.
   */
  const [targets] = await pool.query(
    `SELECT t.social_account_id AS acct, COUNT(*) AS n
       FROM scheduled_post_targets t JOIN scheduled_posts p ON p.id = t.scheduled_post_id
      WHERE p.user_id = ? GROUP BY t.social_account_id`,
    [userId],
  );
  assert.equal(targets.length, 1, 'one account, not a fan-out');
  assert.equal(String(targets[0].acct), String(chosen.id));
  assert.equal(Number(targets[0].n), 3);

  // The selection and the schedule are on the run, where a later profile edit
  // cannot reach them.
  const run = await (await import('../../src/repositories/plannerRunRepository.js')).findRunByIdForUser(runId, userId);
  assert.deepEqual(run.settings.selectedAccountIds, [String(chosen.id)]);
  assert.equal(run.settings.dailyTime, '09:00');
  assert.equal(run.timezone, 'America/New_York');
  assert.ok(postsRepo, 'posts repository is reachable');
});
