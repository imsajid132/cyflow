// A week planned in one go, so the seven posts differ by design.
//
// Asking seven separate times "what should a post for this business say?"
// produces seven answers to the same question, and they converge: the same
// service, the same angle, phrased a little differently. That is the duplicate
// the product bans outright, and comparing finished posts cannot undo it.
// Planning the WEEK makes difference a requirement rather than an accident.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { planWeek, WEEK_LENGTH } from '../src/services/aiStudio/weekPlanner.js';

/** Run `fn` with a stubbed Claude reply, capturing the prompt it was sent. */
async function withClaude(reply, fn) {
  const savedKey = process.env.AI_API_KEY;
  const savedFetch = globalThis.fetch;
  const sent = [];
  process.env.AI_API_KEY = 'test-key';
  globalThis.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: reply }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  try {
    return { result: await fn(), sent };
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = savedKey;
  }
}

const BRAND = {
  businessName: 'NYC Waterproofing',
  industry: 'Waterproofing contractor',
  description: 'Basement and foundation waterproofing for New York property owners.',
  services: ['Basement Waterproofing', 'French Drain Installation', 'Leak Inspection'],
  city: 'Brooklyn', region: 'NY', tone: 'direct, practical',
};

const goodWeek = (n = WEEK_LENGTH) => JSON.stringify({
  posts: Array.from({ length: n }, (_, i) => ({
    day: i + 1,
    job: ['introduce', 'answer', 'proof', 'explain', 'warn', 'season', 'invite'][i % 7],
    angle: `Angle number ${i + 1}, unlike the others`,
    service: BRAND.services[i % BRAND.services.length],
    why: 'For owners with a damp basement.',
  })),
});

test('a full week comes back, in day order', async () => {
  const { result } = await withClaude(goodWeek(), () => planWeek(BRAND));
  assert.equal(result.length, WEEK_LENGTH);
  assert.deepEqual(result.map((p) => p.day), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result[0].service, 'Basement Waterproofing');
});

test('the brand travels with the request, so the plan is about THIS business', async () => {
  const { sent } = await withClaude(goodWeek(), () => planWeek(BRAND));
  const prompt = JSON.stringify(sent[0]);
  for (const fact of ['NYC Waterproofing', 'Waterproofing contractor', 'French Drain Installation', 'Brooklyn']) {
    assert.ok(prompt.includes(fact), `the plan must know "${fact}"`);
  }
});

test('angles already used are sent as things not to repeat', async () => {
  const avoid = ['We fixed a leaking basement in Park Slope', 'Why French drains fail'];
  const { sent } = await withClaude(goodWeek(), () => planWeek(BRAND, { avoid }));
  const prompt = JSON.stringify(sent[0]);
  for (const a of avoid) assert.ok(prompt.includes(a), 'a used angle must be named as off limits');
});

/*
 * A short plan is a FAILURE, not a small week. Padding it would mean generating
 * the missing days from the same empty question the week planner exists to
 * avoid — seven near-identical posts, which is worse than asking again.
 */
test('a short plan is refused rather than padded', async () => {
  await assert.rejects(
    () => withClaude(goodWeek(4), () => planWeek(BRAND)).then((r) => r.result),
    /4 of 7/,
  );
});

test('a reply that is not a plan is refused', async () => {
  await assert.rejects(() => withClaude('Sorry, I cannot help with that.', () => planWeek(BRAND)).then((r) => r.result));
  await assert.rejects(() => withClaude(JSON.stringify({ posts: [] }), () => planWeek(BRAND)).then((r) => r.result));
});

test('an entry with no angle does not count towards the week', async () => {
  // An angle is the one thing that makes a post different from its neighbours,
  // so an entry without one is not a post.
  const half = JSON.stringify({
    posts: Array.from({ length: WEEK_LENGTH }, (_, i) => ({
      day: i + 1, job: 'introduce', angle: i < 3 ? `Angle ${i}` : '', service: '', why: '',
    })),
  });
  await assert.rejects(() => withClaude(half, () => planWeek(BRAND)).then((r) => r.result), /3 of 7/);
});
