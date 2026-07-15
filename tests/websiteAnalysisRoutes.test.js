import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeApp, registerUser } from './helpers/apiHarness.js';
import { createFakeWebsiteAnalysisService } from './helpers/fakes.js';
import { ValidationError } from '../src/utils/errors.js';

async function setup(extra = {}) {
  const { app, overrides } = makeApp(extra);
  const { agent, csrf } = await registerUser(app);
  return { app, overrides, agent, csrf };
}

test('POST /analyze-website returns editable suggestions (nothing saved yet)', async () => {
  const { agent, csrf } = await setup();
  const res = await agent
    .post('/api/business-profile/analyze-website')
    .set('X-CSRF-Token', csrf)
    .send({ websiteUrl: 'https://example.com' });

  assert.equal(res.status, 200);
  const s = res.body.data.suggestions;
  assert.equal(s.businessName, 'Acme Ltd');
  assert.equal(s.primaryColor, '#1a73e8');
  assert.ok(Array.isArray(s.services));
  assert.ok(Array.isArray(res.body.data.pagesAnalyzed));

  // The profile is NOT written by analysis — the user reviews first.
  const profile = await agent.get('/api/business-profile');
  assert.equal(profile.body.data.profile.businessName, null);
  // …but the onboarding state advanced to brand review.
  assert.equal(profile.body.data.profile.onboardingStatus, 'brand_review');
});

test('analyze-website requires CSRF and a URL', async () => {
  const { agent, csrf } = await setup();
  const noCsrf = await agent.post('/api/business-profile/analyze-website').send({ websiteUrl: 'https://example.com' });
  assert.equal(noCsrf.status, 403);

  const noUrl = await agent.post('/api/business-profile/analyze-website').set('X-CSRF-Token', csrf).send({});
  assert.equal(noUrl.status, 400);
});

test('analyze-website never returns raw HTML or internal fetch details', async () => {
  const { agent, csrf } = await setup();
  const res = await agent
    .post('/api/business-profile/analyze-website')
    .set('X-CSRF-Token', csrf)
    .send({ websiteUrl: 'https://example.com' });
  const blob = JSON.stringify(res.body);
  assert.equal(blob.includes('<html'), false);
  assert.equal(blob.includes('<script'), false);
  assert.equal(blob.includes('doctype'), false);
});

test('a blocked target surfaces a safe message with no private network detail', async () => {
  const analyzer = createFakeWebsiteAnalysisService({
    error: new ValidationError('That website address cannot be analyzed'),
  });
  const { agent, csrf } = await setup({ websiteAnalysisService: analyzer });
  const res = await agent
    .post('/api/business-profile/analyze-website')
    .set('X-CSRF-Token', csrf)
    .send({ websiteUrl: 'http://127.0.0.1' });

  assert.equal(res.status, 400);
  const blob = JSON.stringify(res.body);
  assert.match(res.body.error.message, /cannot be analyzed/i);
  // No IPs, ports, or internal diagnostics leak to the client.
  assert.equal(/127\.0\.0\.1|10\.\d|169\.254|ECONN|EAI_/.test(blob), false);
});

test('applying reviewed suggestions saves them and preserves manual edits', async () => {
  const { agent, csrf } = await setup();
  // User hand-edits the name first.
  await agent.put('/api/business-profile').set('X-CSRF-Token', csrf).send({ businessName: 'My Chosen Name' });

  const applied = await agent
    .post('/api/business-profile/apply-extracted')
    .set('X-CSRF-Token', csrf)
    .send({ businessName: 'Acme Ltd', city: 'Springfield', primaryColor: '#1a73e8' });

  assert.equal(applied.status, 200);
  assert.equal(applied.body.data.profile.businessName, 'My Chosen Name'); // preserved
  assert.equal(applied.body.data.profile.city, 'Springfield'); // applied
  assert.deepEqual(applied.body.data.preservedFields, ['businessName']);
});

test('the analyzer receives the session user, never a body-supplied id', async () => {
  const analyzer = createFakeWebsiteAnalysisService();
  const { agent, csrf, overrides } = await setup({ websiteAnalysisService: analyzer });
  const realUserId = overrides.userRepository._rows[0].id;

  await agent
    .post('/api/business-profile/analyze-website')
    .set('X-CSRF-Token', csrf)
    .send({ websiteUrl: 'https://example.com', userId: '999' });

  assert.equal(analyzer._calls[0].userId, realUserId);
  assert.notEqual(analyzer._calls[0].userId, '999');
});
