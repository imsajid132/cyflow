/**
 * The REAL application, on a real port, against a real MariaDB.
 *
 * Unlike tools/review-server.mjs — which wires in-memory fakes for every
 * repository — this starts the actual app with the actual repositories, so the
 * browser journey exercises real SQL, real transactions and real ownership
 * scoping. Only the external network boundaries are replaced: OpenAI, HCTI and
 * the three provider adapters, which are counting stubs that THROW if called.
 *
 * Requires CYFLOW_TEST_DB_* pointing at a disposable database. It seeds that
 * database and will delete rows in it.
 *
 * Usage: node --import ./tests/integration/helpers/preload.js tools/release-e2e-server.mjs <port>
 */

import http from 'node:http';

import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import * as users from '../src/repositories/userRepository.js';
import * as businessProfiles from '../src/repositories/businessProfileRepository.js';
import * as socialAccounts from '../src/repositories/socialAccountRepository.js';
import * as runsRepo from '../src/repositories/plannerRunRepository.js';
import * as automationsRepo from '../src/repositories/automationRepository.js';
// bcrypt directly: hashPassword lives inside createAuthService and is not
// exported, and the seed only needs a hash the real login will verify.
import bcrypt from 'bcrypt';

const PORT = Number(process.argv[2] || 4980);

export const E2E_USER = { email: 'release@example.test', password: 'Release-Pass-123456' };

/** Every provider call is counted, and every one of them is a failure. */
export const providerCalls = { facebook: 0, instagram: 0, threads: 0 };
const stub = (platform) => ({
  key: platform,
  async publish() { providerCalls[platform] += 1; throw new Error('provider call attempted'); },
  async reconcile() { providerCalls[platform] += 1; throw new Error('provider call attempted'); },
});

const ORIGINAL_COPY = 'Austin SEO tips for local businesses that want to rank this quarter.';

async function seed() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
      'publish_attempts', 'scheduled_post_targets', 'scheduled_posts',
      'automation_schedule_slots', 'background_jobs', 'worker_leases',
      'content_automations', 'post_revisions', 'planner_run_items', 'planner_runs',
      'planner_preferences', 'media_asset_references', 'media_assets',
      'user_data_exports', 'account_deletion_requests', 'activity_logs', 'api_usage',
      'social_accounts', 'oauth_states', 'data_deletion_requests', 'business_profiles',
      'user_integrations', 'sessions', 'users',
    ]) await conn.query(`TRUNCATE TABLE \`${t}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally { conn.release(); }

  const user = await users.createUser({
    name: 'Release Tester', email: E2E_USER.email,
    passwordHash: await bcrypt.hash(E2E_USER.password, 10), timezone: 'Asia/Karachi',
  });
  const userId = String(user.id);

  // A real business, so generated copy has something true to describe. Without
  // it the app now refuses to generate at all — that is the SEO/Austin fix.
  await businessProfiles.createOrUpdateProfile(userId, {
    businessName: 'NYC Waterproofing',
    businessCategory: 'Waterproofing contractor',
    businessDescription: 'Basement and foundation waterproofing for New York property owners.',
    city: 'New York', region: 'NY', country: 'US',
  });
  await businessProfiles.updateServices(userId, [
    'Basement Waterproofing', 'Foundation Waterproofing', 'French Drain Installation',
  ]).catch(() => {});

  /*
   * SEVEN active Facebook Pages, which is the operator's real account list.
   *
   * One Page is not enough to test this. With a single connected account,
   * "the selected account" and "every active account" are the same set, and the
   * fan-out that shipped was invisible — one target either way. The other six
   * exist so that a regression has somewhere to leak to.
   */
  const FACEBOOK_PAGES = [
    'NYC Waterproofing',
    'Sidewalks Repair NYC',
    'Pioneer Construction NYC',
    'NYC Concrete Contractor',
    'Roofing Contractor NYC',
    'Brick Pointing NYC',
    'Brownstone Repair NYC',
  ];
  for (const [i, displayName] of FACEBOOK_PAGES.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await socialAccounts.upsertSocialAccount({
      userId, provider: 'meta', accountType: 'facebook_page',
      providerAccountId: `fb-page-${i}`, displayName,
      username: `private-handle-${i}-not-user-facing`,
      encryptedAccessToken: `v1:local-disposable-token-${i}-not-real`,
      scopes: [], providerMetadata: {}, status: 'active',
    });
  }

  const accounts = await socialAccounts.listAccountsForUser(userId);
  // The automation selects THIS one, and only this one.
  const fbAccountId = accounts.find((a) => a.displayName === 'NYC Waterproofing').id;

  /*
   * A REAL automation, with the Facebook Page explicitly selected, and a run
   * linked to it. Account identity on the board resolves through this relation,
   * so seeding a bare run would test a different shape from the one the
   * operator actually has.
   */
  const automation = await automationsRepo.createAutomation({
    userId, name: 'Final Acceptance Automation', status: 'active', mode: 'review',
    timezone: 'Asia/Karachi', selectedWeekdays: [7], postingTimes: ['02:45'],
    postsPerDay: 1, rhythmKey: 'balanced', selectedPlatforms: ['facebook'],
    selectedAccountIds: [String(fbAccountId)],
    startDate: null, endDate: null,
    generationHorizonDays: 3, minimumReadyDays: 2, lowBufferDays: 1,
    missedPostPolicy: 'skip', failurePolicy: 'pause',
    configSnapshot: { platforms: ['facebook'], accountIds: [String(fbAccountId)], timezone: 'Asia/Karachi' },
  });

  /*
   * The two review items, stored as REAL UTC instants: 02:45 Asia/Karachi is
   * 21:45 UTC the previous day. Seeded directly rather than generated, so the
   * journey is deterministic and makes no model call — the generation path has
   * its own coverage.
   */
  const run = await runsRepo.createRun({
    userId, contentAutomationId: automation.id,
    name: 'Final Acceptance Automation', status: 'review',
    timezone: 'Asia/Karachi', startDate: null, endDate: null,
    settings: { platforms: ['facebook'] }, resolvedRhythm: {},
  });
  const mk = (instant, position) => runsRepo.createItem({
    userId, plannerRunId: run.id, scheduledFor: instant, originalTimezone: 'Asia/Karachi',
    contentType: 'insight', goal: 'awareness', templateKey: 'editorial-premium',
    aspectRatio: '1:1', backgroundStyle: 'light',
    headline: 'Austin SEO in 2026', subheadline: 'What moves rankings', summary: 's',
    caption: ORIGINAL_COPY, altText: 'A laptop showing search results',
    hashtags: ['#seo', '#austin'], platformTargets: ['facebook'],
    platformCaptions: {
      facebook: { postCopy: ORIGINAL_COPY, hashtags: ['#seo', '#austin'], validationStatus: 'passed' },
    },
    approvalStatus: 'needs_review', position,
  });
  const july19 = await mk('2026-07-18 21:45:00', 0);
  const july26 = await mk('2026-07-25 21:45:00', 1);
  return { userId, runId: run.id, automationId: automation.id, fbAccountId: String(fbAccountId), july19: july19.id, july26: july26.id };
}

/*
 * `publishAdapters` is the container's override key. Passing `adapters` is
 * silently ignored, which would build the real adapters and leave "zero
 * provider calls" resting on the live-publishing flag alone. Installed here,
 * any call throws and the count below is real evidence.
 */
const app = createApp({
  publishAdapters: { facebook: stub('facebook'), instagram: stub('instagram'), threads: stub('threads') },
});
const seeded = await seed();

/*
 * The probe is mounted IN FRONT of the application, not on it.
 *
 * createApp installs a catch-all 404 as its last handler, so a route added to
 * the same app afterwards is never reached. A wrapper that delegates to the
 * real app keeps the application itself completely untouched — this file adds
 * nothing to the product surface.
 */
const express = (await import('express')).default;
const wrapper = express();

wrapper.get('/__e2e/state', async (req, res) => {
  const pool = getPool();
  const [posts] = await pool.query('SELECT COUNT(*) AS n FROM scheduled_posts WHERE user_id = ?', [seeded.userId]);
  const [targets] = await pool.query(
    `SELECT COUNT(*) AS n FROM scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id WHERE p.user_id = ?`, [seeded.userId],
  );
  const [revisions] = await pool.query(
    "SELECT COUNT(*) AS n FROM post_revisions WHERE user_id = ? AND revision_type = 'manual_edit'", [seeded.userId],
  );
  /*
   * WHICH Pages, by name, not just how many rows.
   *
   * A count alone would have passed the fan-out if the operator had one Page
   * connected, and would have failed uninformatively with seven. The names make
   * the assertion say what actually went wrong.
   */
  const [targetNames] = await pool.query(
    `SELECT sa.display_name AS name
       FROM scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id
       JOIN social_accounts sa ON sa.id = t.social_account_id
      WHERE p.user_id = ? ORDER BY sa.display_name`, [seeded.userId],
  );
  const [activeAccounts] = await pool.query(
    "SELECT COUNT(*) AS n FROM social_accounts WHERE user_id = ? AND status = 'active'", [seeded.userId],
  );
  res.json({
    ...seeded,
    scheduledPosts: Number(posts[0].n),
    targets: Number(targets[0].n),
    targetNames: targetNames.map((r) => r.name),
    activeAccounts: Number(activeAccounts[0].n),
    manualEditRevisions: Number(revisions[0].n),
    providerCalls,
  });
});

wrapper.use(app);

const server = http.createServer(wrapper);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`release e2e server on http://127.0.0.1:${PORT} (real MariaDB, run ${seeded.runId})`);
});

const shutdown = async () => {
  server.close();
  await closePool().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
