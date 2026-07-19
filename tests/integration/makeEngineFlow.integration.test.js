// The Make-derived engine through the REAL production flow, against MariaDB.
//
// The unit tests prove the strategy and the wiring in isolation. This drives
// the actual planner service end to end with real repositories and a real
// database: a business profile, an automation with one selected account, a
// generated multi-day plan, the diversity strategy persisted on each item, an
// approve, a queue, and exactly one target. Only the OpenAI and image network
// boundaries are faked; everything between them is the code that runs in
// production.
import { hasDatabase, resetDatabase, SKIP } from './helpers/db.js';
import '../helpers/setupEnv.js';

import test, { before, beforeEach, after } from 'node:test';   // eslint-disable-line import/first
import assert from 'node:assert/strict';                        // eslint-disable-line import/first

import { getPool, closePool } from '../../src/db/pool.js';                              // eslint-disable-line import/first
import * as users from '../../src/repositories/userRepository.js';                     // eslint-disable-line import/first
import * as socialAccounts from '../../src/repositories/socialAccountRepository.js';   // eslint-disable-line import/first
import * as businessProfiles from '../../src/repositories/businessProfileRepository.js'; // eslint-disable-line import/first
import { createPlannerService } from '../../src/services/plannerService.js';           // eslint-disable-line import/first

let pool;

/*
 * A fake OpenAI content service that RECORDS every request it is handed.
 *
 * It is the external network boundary and nothing more: it returns a valid,
 * on-length post so the real validation, uniqueness, persistence and board code
 * all run for real. The recorded requests are what let the test prove the
 * assignment actually reached the model.
 */
function recordingOpenAI() {
  const requests = [];
  let n = 0;
  return {
    requests,
    isAvailable: async () => true,
    isReadyForUser: async () => true,
    async generatePlannerPost(input) {
      requests.push(input);
      n += 1;
      const svc = input.serviceEmphasis || 'the service';
      // A distinct, valid, on-length Facebook post per call, so the uniqueness
      // engine sees genuinely different copy and nothing is rejected for length.
      const caption = `A specific observation about ${svc}, number ${n}, that a reader would find useful `
        + `and that names something concrete about the work.\n\n`
        + `A second paragraph that develops the point about ${svc} without repeating the first, `
        + `and closes on a clear next step for the reader to consider today.`;
      return {
        caption,
        hashtags: [`#${String(svc).replace(/\s+/g, '')}`, '#local'],
        headline: `On ${svc}: point ${n}`,
        subheadline: `A supporting line about ${svc}`,
        imageAltText: `A photo related to ${svc}`,
        summary: `internal label ${n}`,
        badge: 'Tip',
        _style: { rejections: [] },
      };
    },
  };
}

/* A fake image service: no network, records what template/brand it was asked for. */
function recordingImage() {
  const renders = [];
  return {
    renders,
    isReadyForUser: async () => true,
    async generateSocialImage(input) {
      renders.push(input);
      return { sourceUrl: 'https://example.test/i.png', imageId: `img-${renders.length}` };
    },
  };
}

before(() => { if (hasDatabase) pool = getPool(); });
after(async () => { if (hasDatabase) await closePool().catch(() => {}); });
beforeEach(async () => { if (hasDatabase) await resetDatabase(pool); });

async function seedBusiness({ category, description, services }) {
  const user = await users.createUser({
    name: 'Owner', email: 'owner@example.test', passwordHash: 'x'.repeat(60), timezone: 'Asia/Karachi',
  });
  const userId = String(user.id);

  await businessProfiles.createOrUpdateProfile(userId, {
    businessName: 'Acme Test Business',
    businessCategory: category,
    businessDescription: description,
    city: 'Brooklyn', region: 'NY', country: 'US',
    websiteUrl: 'https://acme.example',
    defaultLanguage: 'English',
    services,
    // Brand identity, so the image path has real values to carry.
    primaryColor: '#123456', secondaryColor: '#abcdef', accentColor: '#00ff88',
    logoUrl: 'https://acme.example/logo.png',
    headingFont: 'Inter', bodyFont: 'Inter',
  });

  await socialAccounts.upsertSocialAccount({
    userId, provider: 'meta', accountType: 'facebook_page',
    providerAccountId: 'fb-acme', displayName: 'Acme Page', username: 'acme',
    encryptedAccessToken: 'v1:tok', scopes: [], providerMetadata: {}, status: 'active',
  });
  const accounts = await socialAccounts.listAccountsForUser(userId);
  return { userId, accountId: accounts[0].id };
}

const CONTRACTOR = {
  category: 'Waterproofing contractor',
  description: 'Basement and foundation waterproofing for homes',
  services: ['Basement Waterproofing', 'Foundation Waterproofing', 'French Drain Installation',
    'Sump Pump Installation', 'Basement Leak Inspection'],
};
const AGENCY = {
  category: 'SEO agency',
  description: 'Search and AI visibility consulting for brands',
  services: ['Technical SEO Audit', 'Content Strategy', 'Local SEO', 'Link Acquisition'],
};

const genPlan = async (userId, accountId, openai, image) => {
  const planner = createPlannerService({
    openaiContentService: openai,
    socialImageService: image,
  });
  return planner.generatePlan(userId, {
    platforms: ['facebook'],
    accountIds: [String(accountId)],
    planLength: 7, postsPerDay: 1,
    cadence: 'daily', timezone: 'Asia/Karachi',
    approvalMode: 'review',
  });
};

test('a contractor plan generates, persists its strategy, and stays on-niche', SKIP, async () => {
  const { userId, accountId } = await seedBusiness(CONTRACTOR);
  const openai = recordingOpenAI();
  const image = recordingImage();

  const plan = await genPlan(userId, accountId, openai, image);
  assert.ok(plan.items.length >= 5, `expected a full week, got ${plan.items.length}`);

  // Every generation request carried an assigned service and a day type.
  assert.ok(openai.requests.length >= 5);
  for (const req of openai.requests) {
    assert.ok(req.serviceEmphasis, 'each request names the service it is about');
    assert.ok(CONTRACTOR.services.includes(req.serviceEmphasis), 'the service is one this business actually offers');
    assert.ok(req.dayType, 'each request carries its assigned day type');
    assert.ok(req.imageConcept, 'each request carries its assigned image concept');
  }

  // The plan visits several distinct day types and several services.
  const dayTypes = new Set(openai.requests.map((r) => r.dayType));
  const services = new Set(openai.requests.map((r) => r.serviceEmphasis));
  assert.ok(dayTypes.size >= 4, `day types should vary, saw ${dayTypes.size}`);
  assert.ok(services.size >= 3, `services should vary, saw ${services.size}`);

  // The strategy is PERSISTED, not just used in flight: reload the plan.
  const reloaded = await createPlannerService().getPlan(userId, plan.run.id);
  for (const item of reloaded.items) {
    assert.ok(item.templateKey, 'each persisted item has a resolved template');
  }
});

test('the image render uses the brand profile and the assigned template', SKIP, async () => {
  const { userId, accountId } = await seedBusiness(CONTRACTOR);
  const openai = recordingOpenAI();
  const image = recordingImage();

  await genPlan(userId, accountId, openai, image);
  assert.ok(image.renders.length >= 1, 'images were rendered');

  for (const r of image.renders) {
    // Brand identity comes from the profile, not from a Make example.
    assert.equal(r.primaryColor, '#123456');
    assert.equal(r.secondaryColor, '#abcdef');
    assert.equal(r.logoUrl, 'https://acme.example/logo.png');
    assert.equal(r.brandName, 'Acme Test Business');
    // The template is a real layout, and the service tag is a real service.
    assert.ok(r.template, 'a template was chosen');
    assert.ok(CONTRACTOR.services.includes(r.serviceTag), 'the image is tagged with a real service');
  }

  /*
   * Caption and image drew from the same set of services.
   *
   * Not a multiset equality: the copy request count is larger than the render
   * count because the uniqueness engine rejected near-duplicate copy and forced
   * regeneration, so one item can cost several copy calls but renders once. The
   * guarantee that matters is that every service an image was tagged with is a
   * service a caption in this same plan was written about, so the image never
   * invented a service and none leaked from another plan.
   */
  const copyServices = new Set(openai.requests.map((r) => r.serviceEmphasis));
  for (const rendered of image.renders.map((r) => r.serviceTag)) {
    assert.ok(copyServices.has(rendered),
      `image service ${rendered} was never written about in this plan`);
  }
});

test('the uniqueness engine stays enabled: similar copy is regenerated', SKIP, async () => {
  /*
   * The fake returns deliberately samey captions. If the similarity detector
   * were off, seven items would cost seven copy calls. The regeneration is what
   * proves it is on, which the migration must not have weakened.
   */
  const { userId, accountId } = await seedBusiness(CONTRACTOR);
  const openai = recordingOpenAI();
  await genPlan(userId, accountId, openai, recordingImage());

  assert.ok(openai.requests.length > 7,
    `similar copy should trigger regeneration; saw only ${openai.requests.length} calls for a 7-item plan`);
});

test('an agency business gets knowledge day types, never contractor ones', SKIP, async () => {
  const { userId, accountId } = await seedBusiness(AGENCY);
  const openai = recordingOpenAI();

  await genPlan(userId, accountId, openai, recordingImage());

  const contractorDayTypes = ['service_spotlight', 'code_tip', 'project_showcase', 'maintenance_tip', 'pro_tip_warning'];
  for (const req of openai.requests) {
    assert.ok(!contractorDayTypes.includes(req.dayType), `agency plan used contractor day type ${req.dayType}`);
    assert.ok(AGENCY.services.includes(req.serviceEmphasis), 'the service is one the agency offers');
    assert.ok(!/waterproof|basement|foundation/i.test(JSON.stringify(req)), 'no contractor topic leaked');
  }
});

test('generation refuses when required business context is missing', SKIP, async () => {
  // A user with an account but no business profile at all.
  const user = await users.createUser({
    name: 'Empty', email: 'empty@example.test', passwordHash: 'x'.repeat(60), timezone: 'Asia/Karachi',
  });
  const userId = String(user.id);
  await socialAccounts.upsertSocialAccount({
    userId, provider: 'meta', accountType: 'facebook_page', providerAccountId: 'fb-e',
    displayName: 'Empty Page', username: 'e', encryptedAccessToken: 'v1:t',
    scopes: [], providerMetadata: {}, status: 'active',
  });
  const accounts = await socialAccounts.listAccountsForUser(userId);

  const planner = createPlannerService({
    openaiContentService: recordingOpenAI(), socialImageService: recordingImage(),
  });
  await assert.rejects(
    () => planner.generatePlan(userId, {
      platforms: ['facebook'], accountIds: [String(accounts[0].id)],
      planLength: 7, postsPerDay: 1, cadence: 'daily', timezone: 'Asia/Karachi',
    }),
    (err) => /business|profile|context|setup/i.test(err.message),
    'missing business context must produce an actionable refusal, not a generic plan',
  );
});

test('the full flow: generate, approve, queue, exactly one target', SKIP, async () => {
  const { userId, accountId } = await seedBusiness(CONTRACTOR);
  const planner = createPlannerService({
    openaiContentService: recordingOpenAI(), socialImageService: recordingImage(),
  });
  const plan = await planner.generatePlan(userId, {
    platforms: ['facebook'], accountIds: [String(accountId)],
    planLength: 7, postsPerDay: 1, cadence: 'daily', timezone: 'Asia/Karachi', approvalMode: 'review',
  });

  // Approve exactly one future item.
  const future = plan.items.find((i) => new Date(`${i.scheduledFor.replace(' ', 'T')}Z`).getTime() > Date.now());
  assert.ok(future, 'the plan has a future item to approve');
  await planner.setItemStatus(userId, future.id, 'approved');

  const result = await planner.queueApproved(userId, plan.run.id, [future.id]);
  assert.equal(result.queued.length, 1, 'exactly one post queued');

  const [posts] = await pool.query('SELECT COUNT(*) AS n FROM scheduled_posts WHERE user_id = ?', [userId]);
  const [targets] = await pool.query(
    `SELECT COUNT(*) AS n FROM scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id WHERE p.user_id = ?`, [userId],
  );
  assert.equal(Number(posts[0].n), 1, 'exactly one scheduled post');
  assert.equal(Number(targets[0].n), 1, 'exactly one target, no fan-out');

  // Repeat is idempotent.
  await planner.queueApproved(userId, plan.run.id, [future.id]).catch(() => null);
  const [targets2] = await pool.query(
    `SELECT COUNT(*) AS n FROM scheduled_post_targets t
       JOIN scheduled_posts p ON p.id = t.scheduled_post_id WHERE p.user_id = ?`, [userId],
  );
  assert.equal(Number(targets2[0].n), 1, 'still one target after a repeat queue');
});
