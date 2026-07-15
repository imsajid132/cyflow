import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSocialImageService } from '../src/services/socialImageService.js';
import { createFakeIntegrationRepository, createFakeApiUsageRepository } from './helpers/fakes.js';

// A fake HCTI service that captures the html/css it is asked to render.
function fakeHcti({ error } = {}) {
  const calls = [];
  return {
    _calls: calls,
    async generateImage(args) {
      calls.push(args);
      if (error) throw error;
      return { imageId: 'img_1', url: 'https://hcti.io/v1/image/img_1.png' };
    },
  };
}

// Identity-ish decrypt: 'v1:VALUE' -> 'VALUE'.
const fakeDecrypt = (v) => String(v).replace(/^v1:/, '');

async function seedHcti(integration, { verified = true } = {}) {
  await integration.upsertEncryptedHctiCredentials({
    userId: '5',
    encryptedUserId: 'v1:HCTI_USER',
    encryptedApiKey: 'v1:HCTI_KEY',
  });
  if (verified) await integration.markHctiVerified('5', '2026-01-01 00:00:00');
}

function build({ hcti = fakeHcti(), integration = createFakeIntegrationRepository() } = {}) {
  const apiUsage = createFakeApiUsageRepository();
  const svc = createSocialImageService({
    integrationRepository: integration,
    hctiService: hcti,
    apiUsage,
    decryptSecret: fakeDecrypt,
  });
  return { svc, hcti, integration, apiUsage };
}

test('rejects when HCTI is not configured or not verified', async () => {
  const notConfigured = build();
  await assert.rejects(
    () => notConfigured.svc.generateSocialImage({ userId: '5', headline: 'Hi' }),
    (e) => { assert.equal(e.classification, 'hcti_not_configured'); return true; },
  );

  const unverified = build();
  await seedHcti(unverified.integration, { verified: false });
  await assert.rejects(
    () => unverified.svc.generateSocialImage({ userId: '5', headline: 'Hi' }),
    (e) => { assert.equal(e.classification, 'hcti_not_verified'); return true; },
  );
});

test('uses a trusted template, escapes user text, and decrypts creds only for the render', async () => {
  const b = build();
  await seedHcti(b.integration);
  const result = await b.svc.generateSocialImage({
    userId: '5',
    headline: 'Hello <script>alert(1)</script>',
    subheadline: '<img src=x onerror=alert(2)>',
    brandName: 'Acme & Co',
    template: 'bold',
    aspectRatio: 'portrait',
    backgroundStyle: 'dark',
  });

  const call = b.hcti._calls[0];
  // Dynamic decrypted credentials passed to HCTI.
  assert.equal(call.hctiUserId, 'HCTI_USER');
  assert.equal(call.hctiApiKey, 'HCTI_KEY');
  // Trusted template class present.
  assert.match(call.html, /tpl-bold/);
  // User text escaped to inert text — no raw tags survive (so no executable
  // markup); the escaped forms are present as harmless text.
  assert.equal(call.html.includes('<script'), false);
  assert.equal(call.html.includes('<img'), false);
  assert.match(call.html, /&lt;script&gt;/);
  assert.match(call.html, /&lt;img/);
  // Escaped wherever the layout places it — bold-service-promo sets the brand
  // name as an uppercased eyebrow.
  assert.match(call.html, /Acme &amp; Co|ACME &amp; CO/);
  // Correct dimensions for portrait.
  assert.equal(call.viewportWidth, 1080);
  assert.equal(call.viewportHeight, 1350);

  // Result exposes no credentials.
  const blob = JSON.stringify(result);
  assert.equal(blob.includes('HCTI_USER'), false);
  assert.equal(blob.includes('HCTI_KEY'), false);
  assert.equal(result.sourceUrl, 'https://hcti.io/v1/image/img_1.png');
});

test('arbitrary background style is ignored (safe preset only)', async () => {
  const b = build();
  await seedHcti(b.integration);
  await b.svc.generateSocialImage({
    userId: '5',
    headline: 'Hi',
    backgroundStyle: 'evil { background: url(http://attacker) }',
  });
  const call = b.hcti._calls[0];
  assert.equal(call.css.includes('attacker'), false);
  assert.equal(call.css.includes('evil'), false);
});

test('HCTI failure is classified safely with no credential leakage', async () => {
  const hcti = fakeHcti({ error: new Error('HCTI 401 body with secret') });
  const b = build({ hcti });
  await seedHcti(b.integration);
  await assert.rejects(
    () => b.svc.generateSocialImage({ userId: '5', headline: 'Hi' }),
    (e) => {
      assert.equal(e.classification, 'image_generation_failed');
      assert.equal(e.message.includes('secret'), false);
      assert.equal(e.message.includes('HCTI_KEY'), false);
      return true;
    },
  );
});

test('meters HCTI usage', async () => {
  const b = build();
  await seedHcti(b.integration);
  await b.svc.generateSocialImage({ userId: '5', headline: 'Hi', template: 'minimal', aspectRatio: 'square' });
  assert.equal(b.apiUsage._rows.length, 1);
  assert.equal(b.apiUsage._rows[0].service, 'hcti');
  assert.equal(b.apiUsage._rows[0].operation, 'generate_image');
});
