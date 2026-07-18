// Milestone F — the public marketing site: routes serve the shell, the content
// makes only honest claims, and the authenticated app stays out of the index.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

import { createApp, APP_ROUTES } from '../src/app.js';
import { closePool } from '../src/db/pool.js';

const app = createApp();
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (rel) => readFileSync(path.join(PUBLIC_DIR, rel), 'utf8');
const marketingRaw = read('assets/js/pages/marketing.js');
// Strip comments so the file's own honest description of what it avoids
// ("no invented metrics, testimonials, …") is not mistaken for a claim.
const marketing = marketingRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const chrome = read('assets/js/components/publicChrome.js');
const router = read('assets/js/router.js');

test.after(async () => { await closePool(); });

const PUBLIC_ROUTES = ['/', '/features', '/how-it-works', '/security', '/about', '/contact', '/privacy', '/terms'];

test('every public route is declared and serves the shell without auth', async () => {
  for (const route of PUBLIC_ROUTES) {
    assert.ok(APP_ROUTES.includes(route), `${route} is an app-served route`);
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).get(route);
    assert.equal(res.status, 200, `${route} serves the shell`);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /id="route-root"/);
  }
});

test('the marketing module and public chrome exist and export what the router needs', () => {
  assert.match(marketing, /export async function render/);
  assert.match(chrome, /export function publicHeader/);
  assert.match(chrome, /export function publicFooter/);
  // The router maps public paths to the marketing module with a public layout.
  assert.match(router, /layout: 'public'/);
  assert.match(router, /pages\/marketing\.js/);
});

test('the public site mentions exactly the three supported platforms', () => {
  for (const p of ['Facebook Pages', 'Instagram Professional', 'Threads']) {
    assert.match(marketing, new RegExp(p));
  }
  const banned = /\b(tiktok|pinterest|linkedin|youtube|whatsapp|snapchat|twitter|\bX\b)\b/i;
  assert.equal(banned.test(marketing), false, 'no unsupported platform is advertised');
});

test('the public site invents no metrics, testimonials, ratings or certifications', () => {
  // Fabricated social proof.
  assert.equal(/trusted by|join (thousands|hundreds|millions)|\d[\d,]*\+?\s*(customers|users|businesses|teams) (use|trust|love)/i.test(marketing), false, 'no invented customer counts');
  assert.equal(/testimonial|"\s*[A-Z][^"]{10,}"\s*[—-]\s*[A-Z]/.test(marketing), false, 'no testimonials');
  assert.equal(/★|[0-9](\.[0-9])?\s*\/\s*5\b|[0-9]\s*stars?\b|rated [0-9]/i.test(marketing), false, 'no star ratings');
  assert.equal(/guaranteed results|money[- ]back|guaranteed (reach|engagement|growth)/i.test(marketing), false, 'no guarantees');
});

test('the public site never claims live publishing is verified or on by default', () => {
  assert.equal(/live publishing (is )?(verified|confirmed|enabled by default|already live)/i.test(marketing), false);
  // It states the honest dependency instead.
  assert.match(marketing, /depends on your connected .*accounts and approved .*permissions|approved app permissions/i);
});

test('privacy and terms are clearly marked as drafts pending legal review', () => {
  assert.match(marketing, /pending legal review|not a substitute for legal advice/i);
  assert.match(marketing, /No company legal name/i);
});

test('robots.txt keeps the authenticated app out of the index', async () => {
  const res = await request(app).get('/robots.txt');
  assert.equal(res.status, 200);
  for (const disallow of ['/dashboard', '/create', '/queue', '/api/']) {
    assert.match(res.text, new RegExp(`Disallow: ${disallow.replace('/', '\\/')}`));
  }
});
