import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createBusinessProfileService, validateProfilePatch } from '../src/services/businessProfileService.js';
import { createFakeBusinessProfileRepository, createFakeWebsiteAnalysisService } from './helpers/fakes.js';

const noopLogging = { record: async () => {} };

function build(extra = {}) {
  const profiles = extra.profiles || createFakeBusinessProfileRepository();
  const analyzer = extra.analyzer || createFakeWebsiteAnalysisService();
  const svc = createBusinessProfileService({ profiles, analyzer, logging: noopLogging });
  return { svc, profiles, analyzer };
}

// --- validation ------------------------------------------------------------

test('rejects unknown fields (no mass assignment)', () => {
  assert.throws(() => validateProfilePatch({ userId: '999' }), /Unknown fields/i);
  assert.throws(() => validateProfilePatch({ onboardingStatus: 'completed' }), /Unknown fields/i);
  assert.throws(() => validateProfilePatch({ sourceType: 'website' }), /Unknown fields/i);
  assert.throws(() => validateProfilePatch({ id: '1' }), /Unknown fields/i);
});

test('validates colors, fonts, tone, urls, email', () => {
  assert.throws(() => validateProfilePatch({ primaryColor: 'red' }), /hex/i);
  assert.throws(() => validateProfilePatch({ primaryColor: '#12' }), /hex/i);
  assert.equal(validateProfilePatch({ primaryColor: '#1A73E8' }).primaryColor, '#1a73e8');

  assert.throws(() => validateProfilePatch({ headingFont: 'url(http://evil/f.woff)' }), /plain font/i);
  assert.equal(validateProfilePatch({ headingFont: 'Poppins' }).headingFont, 'Poppins');

  assert.throws(() => validateProfilePatch({ defaultTone: 'sarcastic' }), /Invalid tone/i);
  assert.equal(validateProfilePatch({ defaultTone: 'friendly' }).defaultTone, 'friendly');

  assert.throws(() => validateProfilePatch({ websiteUrl: 'http://localhost' }), /valid URL/i);
  assert.throws(() => validateProfilePatch({ websiteUrl: 'javascript:alert(1)' }), /valid URL/i);
  assert.equal(validateProfilePatch({ websiteUrl: 'acme.example' }).websiteUrl, 'https://acme.example/');

  assert.throws(() => validateProfilePatch({ email: 'not-an-email' }), /valid email/i);
});

test('validates and deduplicates service arrays', () => {
  const out = validateProfilePatch({ services: ['Roofing', 'roofing', '  Gutters  ', ''] });
  assert.deepEqual(out.services, ['Roofing', 'Gutters']);
  assert.throws(() => validateProfilePatch({ services: 'roofing' }), /list/i);
  assert.throws(() => validateProfilePatch({ services: [123] }), /text/i);
  assert.throws(() => validateProfilePatch({ services: Array.from({ length: 20 }, (_, i) => `S${i}`) }), /At most/i);
});

// --- profile lifecycle -----------------------------------------------------

test('creates and updates exactly one profile per user', async () => {
  const { svc, profiles } = build();
  await svc.updateBusinessProfile('5', { businessName: 'Acme' });
  await svc.updateBusinessProfile('5', { businessName: 'Acme Ltd', city: 'Springfield' });
  assert.equal(profiles._rows.size, 1);
  const profile = await svc.getBusinessProfile('5');
  assert.equal(profile.businessName, 'Acme Ltd');
  assert.equal(profile.city, 'Springfield');
});

test('ownership: each user has their own profile', async () => {
  const { svc } = build();
  await svc.updateBusinessProfile('5', { businessName: 'Acme' });
  assert.equal(await svc.getBusinessProfile('6'), null);
  await svc.updateBusinessProfile('6', { businessName: 'Other' });
  assert.equal((await svc.getBusinessProfile('5')).businessName, 'Acme');
  assert.equal((await svc.getBusinessProfile('6')).businessName, 'Other');
});

test('manual setup marks source_type manual', async () => {
  const { svc } = build();
  const p = await svc.saveManualBusinessProfile('5', { businessName: 'Manual Co', services: ['A'] });
  assert.equal(p.sourceType, 'manual');
  assert.equal(p.businessName, 'Manual Co');
});

// --- manual-edit preservation ----------------------------------------------

test('extracted data never silently overwrites a manually edited field', async () => {
  const { svc } = build();
  // User edits the name by hand.
  await svc.updateBusinessProfile('5', { businessName: 'My Chosen Name' });

  // A later analysis suggests a different name + a new city.
  const { profile, preservedFields } = await svc.saveExtractedBusinessProfile('5', {
    businessName: 'Scraped Name',
    city: 'Springfield',
  });

  assert.equal(profile.businessName, 'My Chosen Name'); // preserved
  assert.equal(profile.city, 'Springfield'); // applied (never edited by hand)
  assert.deepEqual(preservedFields, ['businessName']);
  assert.equal(profile.sourceType, 'mixed');
});

// --- onboarding state ------------------------------------------------------

test('onboarding state transitions through analysis to completion', async () => {
  const { svc } = build();
  // A brand-new user with no profile is never locked out.
  const initial = await svc.getOnboardingState('5');
  assert.equal(initial.status, 'not_started');
  assert.equal(initial.hasProfile, false);
  assert.equal(initial.needsOnboarding, true);
  assert.equal(initial.canUseApp, true);

  await svc.analyzeBusinessWebsite('5', 'https://acme.example');
  assert.equal((await svc.getOnboardingState('5')).status, 'brand_review');

  await svc.saveExtractedBusinessProfile('5', { businessName: 'Acme Ltd' });
  await svc.completeOnboarding('5');

  const done = await svc.getOnboardingState('5');
  assert.equal(done.status, 'completed');
  assert.equal(done.needsOnboarding, false);
  assert.ok(done.completedAt);
});

test('a failed analysis rolls the state back and never leaks internals', async () => {
  const analyzer = createFakeWebsiteAnalysisService({ error: new Error('ECONNREFUSED 10.0.0.1:80 internal') });
  const { svc } = build({ analyzer });
  await assert.rejects(() => svc.analyzeBusinessWebsite('5', 'https://acme.example'));
  assert.equal((await svc.getOnboardingState('5')).status, 'business_source');
});

test('analysis returns suggestions only — nothing is saved automatically', async () => {
  const { svc } = build();
  const result = await svc.analyzeBusinessWebsite('5', 'https://acme.example');
  assert.ok(result.suggestions.businessName);
  // The profile still has no business data until the user reviews + saves.
  const profile = await svc.getBusinessProfile('5');
  assert.equal(profile.businessName, null);
});

test('deleting a business profile removes only that user profile', async () => {
  const { svc } = build();
  await svc.updateBusinessProfile('5', { businessName: 'Acme' });
  await svc.updateBusinessProfile('6', { businessName: 'Other' });
  await svc.deleteBusinessProfile('5');
  assert.equal(await svc.getBusinessProfile('5'), null);
  assert.equal((await svc.getBusinessProfile('6')).businessName, 'Other');
});
