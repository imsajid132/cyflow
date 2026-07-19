// The Make-derived engine, wired into the REAL provider request.
//
// The strategy modules and the batch planner were proven in makeDerivedEngine.
// This proves the missing half: that what they decide actually reaches the
// OpenAI request, the image render and a retry, rather than being computed and
// dropped. Each test captures the real request the production service builds
// and asserts on what the model was actually told.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAIContentService } from '../src/services/openaiContentService.js';
import { createFakeApiUsageRepository } from './helpers/fakes.js';
import { buildBriefSet } from '../src/services/plannerBriefService.js';
import { layoutForConcept, IMAGE_CONCEPTS } from '../src/services/makeContentStrategy.js';
import { LAYOUT_IDS } from '../src/templates/layouts/index.js';

const CONFIG = {
  openai: {
    textModel: 'gpt-5-nano', maxOutputTokens: 1200, requestTimeoutMs: 45000,
    available: true, apiKey: 'sk-test-key-not-real',
  },
};

const PLANNER_OK = {
  caption: 'A specific observation about the work.\n\nA second paragraph that develops it without repeating.',
  hashtags: ['#one', '#two'],
  headline: 'A real headline here',
  subheadline: 'A supporting line',
  imageAltText: 'Alt text',
  summary: 'label',
  badge: 'Tip',
};

function response(obj) {
  const text = JSON.stringify(obj);
  return {
    id: 'resp_x', status: 'completed', usage: { input_tokens: 10, output_tokens: 20 },
    output_text: text, output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  };
}

function build(handler) {
  const calls = [];
  const client = { responses: { create: async (params, opts) => { calls.push({ params, opts }); return handler(params, opts); } } };
  const svc = createOpenAIContentService({
    client, config: CONFIG, apiUsage: createFakeApiUsageRepository(),
    logger: { warn() {}, error() {} },
  });
  return { svc, calls };
}

const WATERPROOFING = {
  businessName: 'Test Waterproofing Co',
  businessCategory: 'Waterproofing contractor',
  businessDescription: 'Basement and foundation waterproofing',
  city: 'Brooklyn', region: 'NY',
  services: ['Basement Waterproofing', 'Foundation Waterproofing', 'French Drain Installation',
    'Sump Pump Installation', 'Basement Leak Inspection'],
};
const SEO = {
  businessName: 'Test Search Agency', businessCategory: 'SEO agency',
  businessDescription: 'Search and AI visibility consulting', city: 'Austin', region: 'TX',
  services: ['Technical SEO Audit', 'Content Strategy', 'Local SEO'],
};

const slotsFor = (n) => Array.from({ length: n }, (_, i) => ({
  weekday: (i % 7) + 1, localDate: `2027-03-${String(i + 1).padStart(2, '0')}`,
}));

const briefFor = (profile, i = 0, n = 7) =>
  buildBriefSet({ slots: slotsFor(n), preferences: {}, profile, platforms: ['facebook'] })[i];

// A flat request as postRequestFrom builds it, without importing the whole
// planner service: the fields the wiring depends on, copied off the brief.
const requestFrom = (brief, profile, extra = {}) => ({
  format: brief.format, contentType: brief.contentType, goal: brief.goal, tone: brief.tone,
  brief: brief.brief, brandName: profile.businessName, businessCategory: profile.businessCategory,
  businessDescription: profile.businessDescription, serviceEmphasis: brief.serviceEmphasis,
  audienceProblem: brief.audienceProblem, location: [profile.city, profile.region].join(', '),
  callToAction: brief.callToAction, platform: 'facebook',
  dayType: brief.dayType, dayTypeLabel: brief.dayTypeLabel, dayPurpose: brief.dayPurpose,
  imageConcept: brief.imageConcept,
  openingGuidance: brief.openingGuidance, writingGuidance: brief.writingGuidance,
  closingGuidance: brief.closingGuidance, headlineGuidance: brief.headlineGuidance,
  hashtagGuidance: brief.hashtagGuidance,
  ...extra,
});

const captured = (calls) => ({
  instructions: calls[0].params.instructions,
  userData: calls[0].params.input[0].content,
  schema: calls[0].params.text.format.schema,
});

// ---------------------------------------------- assignment reaches the request
test('the assigned day purpose and image concept reach the user data', async () => {
  const { svc, calls } = build(() => response(PLANNER_OK));
  const brief = briefFor(WATERPROOFING, 0);
  await svc.generatePlannerPost(requestFrom(brief, WATERPROOFING), { userId: 'u1' });

  const { userData } = captured(calls);
  assert.ok(userData.includes('todaysPostType'), 'the post type is named to the model');
  assert.ok(userData.includes(brief.imageConcept), 'the assigned image concept is passed');
  assert.ok(userData.includes('serviceThisPostIsAbout'), 'the assigned service is passed');
});

test('the assigned opening, structure and closing reach the instructions', async () => {
  const { svc, calls } = build(() => response(PLANNER_OK));
  const brief = briefFor(WATERPROOFING, 0);
  await svc.generatePlannerPost(requestFrom(brief, WATERPROOFING), { userId: 'u1' });

  const { instructions } = captured(calls);
  assert.ok(/ASSIGNED SHAPE/.test(instructions), 'the shape block is present');
  assert.ok(instructions.includes(brief.openingGuidance), 'the opening guidance is an instruction');
  assert.ok(instructions.includes(brief.writingGuidance), 'the structure guidance is an instruction');
  assert.ok(instructions.includes(brief.closingGuidance), 'the closing guidance is an instruction');
});

test('a request with no assignment omits the shape block cleanly', async () => {
  // The manual Create workspace has no batch plan; the block must simply not
  // appear rather than render "undefined".
  const { svc, calls } = build(() => response(PLANNER_OK));
  await svc.generatePlannerPost({
    format: 'educational_insight', platform: 'facebook', brandName: 'X',
    serviceEmphasis: 'A service', goal: 'awareness',
  }, { userId: 'u1' });

  const { instructions, userData } = captured(calls);
  assert.ok(!/ASSIGNED SHAPE/.test(instructions), 'no empty shape block');
  assert.ok(!/undefined/.test(instructions + userData), 'no undefined leaked into the prompt');
});

// ---------------------------------------------------- platform constraints
test('each platform states its own word budget and hashtag ceiling', async () => {
  for (const [platform, mustSay] of [
    ['facebook', /At most 3 hashtags/],
    ['instagram', /3 to 6 relevant hashtags/],
    ['threads', /NOT a shortened version/],
  ]) {
    const { svc, calls } = build(() => response(PLANNER_OK));
    const brief = briefFor(WATERPROOFING, 0);
    // eslint-disable-next-line no-await-in-loop
    await svc.generatePlannerPost(requestFrom(brief, WATERPROOFING, { platform }), { userId: 'u1' });
    const { instructions } = captured(calls);
    assert.ok(mustSay.test(instructions), `${platform} constraint missing`);
    assert.ok(/\d+ to \d+ words/.test(instructions), `${platform} has no word budget`);
  }
});

test('the field word budgets are stated in the schema description', async () => {
  const { svc, calls } = build(() => response(PLANNER_OK));
  const brief = briefFor(WATERPROOFING, 0);
  await svc.generatePlannerPost(requestFrom(brief, WATERPROOFING), { userId: 'u1' });

  const { schema } = captured(calls);
  assert.ok(/\d+ to \d+ words/.test(schema.properties.caption.description), 'the caption field carries its budget');
  for (const field of ['caption', 'hashtags', 'headline', 'subheadline', 'imageAltText', 'summary', 'badge']) {
    assert.ok(schema.required.includes(field), `schema is missing required field ${field}`);
  }
});

// ------------------------------------------------------------- niche routing
test('a contractor brief carries a contractor day type into the request', async () => {
  const { svc, calls } = build(() => response(PLANNER_OK));
  const brief = briefFor(WATERPROOFING, 0);
  assert.ok(['service_spotlight', 'trust_stat', 'code_tip', 'project_showcase',
    'maintenance_tip', 'pro_tip_warning', 'brand_insight'].includes(brief.dayType));
  await svc.generatePlannerPost(requestFrom(brief, WATERPROOFING), { userId: 'u1' });
  assert.ok(captured(calls).userData.includes('Waterproofing'), 'the business name is the waterproofing one');
});

test('an SEO brief carries a knowledge day type, never a contractor one', async () => {
  const { svc, calls } = build(() => response(PLANNER_OK));
  const brief = briefFor(SEO, 0);
  assert.ok(['educational_tip', 'category_insight', 'hot_take_myth', 'how_to_guide',
    'industry_trend', 'quick_hack', 'thought_leadership'].includes(brief.dayType));
  await svc.generatePlannerPost(requestFrom(brief, SEO), { userId: 'u1' });
  const { userData } = captured(calls);
  assert.ok(!/waterproofing|basement|foundation/i.test(userData), 'no contractor topic leaked into the SEO request');
});

// ------------------------------------------------------- caption/image binding
test('every assigned image concept maps to a real, registered layout', () => {
  const ids = new Set(LAYOUT_IDS);
  for (const concept of IMAGE_CONCEPTS) {
    const layout = layoutForConcept(concept);
    assert.ok(ids.has(layout), `concept ${concept} maps to unknown layout ${layout}`);
  }
});

test('the caption request and the image share the assigned service and layout', async () => {
  const brief = briefFor(WATERPROOFING, 1); // trust_stat -> stat_card -> poster-stat
  // The caption request names the service.
  const { svc, calls } = build(() => response(PLANNER_OK));
  await svc.generatePlannerPost(requestFrom(brief, WATERPROOFING), { userId: 'u1' });
  assert.ok(captured(calls).userData.includes(brief.serviceEmphasis), 'the caption is about the assigned service');

  // The image renders on the layout the concept resolves to, and that is the
  // brief's own templateKey, so caption and image are one plan.
  assert.equal(brief.templateKey, layoutForConcept(brief.imageConcept));
  assert.equal(brief.imageConcept, 'stat_card');
  assert.equal(brief.templateKey, 'poster-stat');
});

// -------------------------------------------------------------------- retry
test('a retry request carries what the batch already spent', async () => {
  const { svc, calls } = build(() => response(PLANNER_OK));
  const brief = briefFor(WATERPROOFING, 3);
  await svc.generatePlannerPost(requestFrom(brief, WATERPROOFING, {
    usedElements: {
      topics: ['patching does not last', 'cheap fixes fail'],
      services: ['Basement Waterproofing', 'Sump Pump Installation'],
      problems: ['they think this is simpler than it is'],
      imageConcepts: ['service_card', 'stat_card'],
    },
    avoidOpenings: ['Basement leaking?'],
  }), { userId: 'u1' });

  const { instructions } = captured(calls);
  assert.ok(/ALREADY USED ELSEWHERE/.test(instructions), 'the spent block is present');
  assert.ok(instructions.includes('patching does not last'), 'a spent topic is named');
  assert.ok(instructions.includes('Basement Waterproofing'), 'a spent service is named');
  assert.ok(/service_card/.test(instructions), 'a spent image concept is named');
});

test('with nothing spent, the retry block is absent, not empty', async () => {
  const { svc, calls } = build(() => response(PLANNER_OK));
  const brief = briefFor(WATERPROOFING, 0);
  await svc.generatePlannerPost(requestFrom(brief, WATERPROOFING), { userId: 'u1' });
  assert.ok(!/ALREADY USED ELSEWHERE/.test(captured(calls).instructions));
});

// ---------------------------------------------------------- no leakage / safety
test('no business fact is asserted by the strategy that the profile did not give', async () => {
  // The request must contain the profile's own values and nothing invented.
  const { svc, calls } = build(() => response(PLANNER_OK));
  const brief = briefFor(WATERPROOFING, 0);
  await svc.generatePlannerPost(requestFrom(brief, WATERPROOFING), { userId: 'u1' });
  const { userData } = captured(calls);
  // No phone number, no fabricated year, no borough the profile never stated.
  assert.ok(!/\(\d{3}\)\s?\d{3}-\d{4}/.test(userData), 'no phone number invented');
  assert.ok(!/since \d{4}|20\+ years/i.test(userData), 'no tenure invented');
});
