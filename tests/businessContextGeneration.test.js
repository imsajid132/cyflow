// Why the generated posts were about SEO in Austin for a New York
// waterproofing company.
//
// Nothing was hardcoded and nothing was stale. The profile lookup ended in
// `.catch(() => null)`, and the brief builder drops every empty field before
// sending it, so a user with no business profile had their post written from a
// brief containing no business at all:
//
//     platform: facebook
//     format: insight
//     goal: awareness
//     language: English
//
// Asked to write marketing copy for an unnamed business, a model invents one,
// and a generic marketing agency in Austin is the archetypal thing it invents.
// The emptiness was invisible because the filter REMOVED the missing lines
// rather than reporting them.
//
// These tests inspect the request at the provider boundary. No network call is
// made and no real model is involved.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createPlannerService, missingBusinessContext, assertBusinessContext } from '../src/services/plannerService.js';
import {
  createFakePlannerPreferenceRepository, createFakePlannerRunRepository,
  createFakePlannerRevisionRepository, createFakeBusinessProfileRepository,
  createFakeSocialAccountRepository, createFakePostRepository,
  createFakeMediaAssetRepository, createFakeApiUsageRepository,
  createFakePlannerOpenAI, createFakeSocialImageService, fakeWithTransaction,
} from './helpers/fakes.js';
import { createMediaAssetService } from '../src/services/mediaAssetService.js';
import { contentUniquenessService } from '../src/services/contentUniquenessService.js';

const USER = '11';
const NOW = new Date('2026-07-15T09:00:00Z');
const noop = { record: async () => {} };

const COMPLETE_PROFILE = {
  businessName: 'NYC Waterproofing',
  businessCategory: 'Waterproofing contractor',
  businessDescription: 'Basement and foundation waterproofing for New York property owners.',
  city: 'New York', region: 'NY',
  services: ['Basement Waterproofing', 'Foundation Waterproofing', 'French Drain Installation'],
};

/**
 * A planner wired to a capturing OpenAI fake.
 *
 * The capture happens at the SAME boundary the real network call would leave
 * from, so the assertions are about what the model would actually have been
 * given.
 */
function makePlanner({ profile } = {}) {
  const captured = [];
  const business = createFakeBusinessProfileRepository();
  if (profile) business.createOrUpdateProfile(USER, profile);

  const openai = createFakePlannerOpenAI({ validate: true, isAvailableForUser: () => true });
  const capturingOpenAi = new Proxy(openai, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return async (...args) => {
        if (args[0] && typeof args[0] === 'object') captured.push({ method: String(prop), input: args[0] });
        return value.apply(target, args);
      };
    },
  });

  const runs = createFakePlannerRunRepository();
  const social = createFakeSocialAccountRepository();
  const media = createFakeMediaAssetRepository();
  const planner = createPlannerService({
    preferences: createFakePlannerPreferenceRepository(), runs,
    revisions: createFakePlannerRevisionRepository(), businessProfiles: business,
    socialAccounts: social, posts: createFakePostRepository({ socialAccounts: social }),
    mediaRepository: media, apiUsage: createFakeApiUsageRepository(),
    openaiContentService: capturingOpenAi,
    socialImageService: { ...createFakeSocialImageService(), isReadyForUser: async () => false },
    mediaAssetService: createMediaAssetService({ mediaRepository: media }),
    uniqueness: contentUniquenessService, logging: noop,
    withTransaction: fakeWithTransaction, now: () => NOW,
  });
  return { planner, captured, runs, business };
}

async function automationRun(runs, settings = {}) {
  return runs.createRun({
    userId: USER, status: 'generating', timezone: 'Asia/Karachi',
    startDate: null, endDate: null,
    settings: { platforms: ['facebook'], rhythmPreset: 'balanced', ...settings },
    resolvedRhythm: null,
  });
}

const slot = { localDate: '2026-07-19', localTime: '02:45', scheduledForUtc: '2026-07-18 21:45:00' };

// ============================================================ the guard itself
test('a missing profile is reported as missing, not silently accepted', () => {
  assert.deepEqual(missingBusinessContext(null), ['businessName']);
  assert.deepEqual(missingBusinessContext({}), ['businessName', 'businessDetails']);
  // A name alone does not describe a business.
  assert.deepEqual(missingBusinessContext({ businessName: 'NYC Waterproofing' }), ['businessDetails']);
  // A name plus any one substantive field is enough to write something true.
  assert.deepEqual(missingBusinessContext({ businessName: 'X', businessCategory: 'Plumber' }), []);
  assert.deepEqual(missingBusinessContext({ businessName: 'X', services: ['Drains'] }), []);
  assert.deepEqual(missingBusinessContext({ businessName: 'X', city: 'New York' }), []);
  // Whitespace is not content.
  assert.deepEqual(missingBusinessContext({ businessName: '   ', businessCategory: 'Plumber' }), ['businessName']);
});

test('the refusal names the page the user has to go and complete', () => {
  try {
    assertBusinessContext(null);
    assert.fail('an empty profile must be refused');
  } catch (err) {
    assert.match(err.message, /business profile/i);
    assert.match(err.message, /will not invent a business/i, 'the refusal must say why');
    assert.ok(err.details.some((d) => /Business page/i.test(d.message)), 'and where to fix it');
  }
});

// ================================================== the request at the boundary
test('generation refuses outright when there is no business profile', async () => {
  const { planner, captured, runs } = makePlanner();          // no profile at all
  const run = await automationRun(runs);

  await assert.rejects(
    planner.generateAutomationSlotItem({ userId: USER, runId: run.id, slot }),
    /business profile/i,
  );
  assert.equal(captured.length, 0, 'not one request may reach the model without a business');
});

test('the captured request carries the real business, and no invented one', async () => {
  const { planner, captured, runs } = makePlanner({ profile: COMPLETE_PROFILE });
  const run = await automationRun(runs);

  await planner.generateAutomationSlotItem({ userId: USER, runId: run.id, slot });
  assert.ok(captured.length > 0, 'a request must reach the boundary');

  const payload = JSON.stringify(captured);
  assert.match(payload, /NYC Waterproofing/, 'the business name must be in the request');
  assert.match(payload, /[Ww]aterproofing/, 'and what it does');

  // The exact content that appeared on staging.
  for (const wrong of ['Austin', 'SEO', 'search ranking', 'link building', 'site audit', 'digital marketing']) {
    assert.ok(!new RegExp(wrong, 'i').test(payload),
      `the request must not contain "${wrong}" — that is invented content`);
  }
});

test('the brief the model receives is not empty of business', async () => {
  const { planner, captured, runs } = makePlanner({ profile: COMPLETE_PROFILE });
  const run = await automationRun(runs);
  await planner.generateAutomationSlotItem({ userId: USER, runId: run.id, slot });

  // The specific failure: a brief with nothing but platform, format and goal.
  const first = captured[0].input;
  const businessFields = ['brandName', 'businessCategory', 'businessDescription'];
  const present = businessFields.filter((f) => {
    const v = first[f];
    return typeof v === 'string' && v.trim() !== '';
  });
  assert.ok(present.length >= 2,
    `the brief must carry the business, got only: ${present.join(', ') || 'nothing'}`);
  assert.equal(first.brandName, 'NYC Waterproofing');
});

test('a name with no substance is refused rather than half-generated', async () => {
  const { planner, captured, runs } = makePlanner({ profile: { businessName: 'NYC Waterproofing' } });
  const run = await automationRun(runs);

  await assert.rejects(
    planner.generateAutomationSlotItem({ userId: USER, runId: run.id, slot }),
    /business profile/i,
  );
  assert.equal(captured.length, 0,
    'a name alone leaves the model to invent the services and the city');
});

test('no other user\'s business can reach the request', async () => {
  const { planner, captured, runs, business } = makePlanner({ profile: COMPLETE_PROFILE });
  business.createOrUpdateProfile('999', {
    businessName: 'Someone Else Ltd', businessCategory: 'Bakery',
  });
  const run = await automationRun(runs);
  await planner.generateAutomationSlotItem({ userId: USER, runId: run.id, slot });

  const payload = JSON.stringify(captured);
  assert.ok(!payload.includes('Someone Else Ltd'), "another user's business must never appear");
  assert.ok(!payload.includes('Bakery'));
});

test('the refusal is permanent, so the worker stops instead of retrying forever', () => {
  // Retrying cannot create a business profile. The classification lives in
  // automationService, next to the identical OpenAI-credentials precondition.
  const source = readFileSync(
    new URL('../src/services/automationService.js', import.meta.url), 'utf8',
  );
  assert.match(source, /Business profile is incomplete/);
  assert.match(source, /throw new PermanentJobError\('Business profile incomplete'\)/);
  assert.match(source, /setAttention\(a, userId,\s*\n?\s*'Complete your Business profile/,
    'the automation must tell the user the one thing to do');
});
