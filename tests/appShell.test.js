// Phase 4.5b: the multi-page app shell + frontend safety invariants.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

import { createApp, APP_ROUTES } from '../src/app.js';
import { closePool } from '../src/db/pool.js';

const app = createApp();
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

test.after(async () => {
  await closePool();
});

/** Every .js file under public/assets/js, recursively. */
function frontendFiles(dir = path.join(PUBLIC_DIR, 'assets', 'js')) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...frontendFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Strip comments so prose about a banned API is not mistaken for a use of it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const FRONTEND = frontendFiles().map((file) => ({
  file: path.relative(PUBLIC_DIR, file).replace(/\\/g, '/'),
  raw: readFileSync(file, 'utf8'),
  source: stripComments(readFileSync(file, 'utf8')),
}));

test('the app declares exactly the planned routes', () => {
  assert.deepEqual([...APP_ROUTES], [
    '/',
    // F: public marketing site.
    '/features', '/how-it-works', '/security', '/about', '/contact', '/privacy', '/terms',
    '/login', '/register', '/onboarding', '/onboarding/business',
    '/onboarding/brand', '/onboarding/connections', '/dashboard', '/brand',
    '/connections', '/create', '/queue', '/calendar',
    // C3: media library.
    '/media',
    '/integrations',
    '/profile', '/settings',
    // D1: always-on content automations.
    '/automations',
    // Phase 4.7: auto content planner.
    '/planner', '/planner/new', '/planner/week', '/planner/history',
  ]);
});

test('every app route is directly loadable and serves the shell', async () => {
  for (const route of APP_ROUTES) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).get(route);
    assert.equal(res.status, 200, `${route} should serve the shell`);
    assert.match(res.headers['content-type'], /text\/html/, `${route} content-type`);
    assert.match(res.text, /id="route-root"/, `${route} must render the shell`);
    assert.match(res.text, /assets\/js\/main\.js/, `${route} must load the app bundle`);
  }
});

test('deep-linking a route does not bypass the API 404/HTML 404 split', async () => {
  const api404 = await request(app).get('/api/not-a-real-endpoint');
  assert.equal(api404.status, 404);
  assert.equal(api404.body.success, false);

  const html404 = await request(app).get('/queue/not-a-subroute');
  assert.equal(html404.status, 404);
  assert.match(html404.headers['content-type'], /text\/html/);
});

test('the shell has a skip link, a landmark, and a live region', async () => {
  const res = await request(app).get('/dashboard');
  assert.match(res.text, /class="skip-link"/);
  assert.match(res.text, /<main[^>]*id="main"/);
  assert.match(res.text, /id="toasts"/);
  assert.match(res.text, /lang="en"/);
  assert.match(res.text, /name="viewport"/);
});

test('every planned page module exists and exports render()', async () => {
  const pages = ['auth', 'onboarding', 'dashboard', 'brand', 'connections',
    'create', 'queue', 'calendar', 'integrations', 'profile', 'settings'];
  for (const page of pages) {
    const entry = FRONTEND.find((f) => f.file === `assets/js/pages/${page}.js`);
    assert.ok(entry, `pages/${page}.js must exist`);
    assert.match(entry.source, /export async function render|export function render/, `pages/${page}.js must export render`);
  }
});

test('the legacy single-page frontend is gone', () => {
  for (const legacy of ['index.html', 'dashboard.html', 'assets/app.js', 'assets/index.page.js', 'assets/dashboard.page.js']) {
    assert.throws(() => statSync(path.join(PUBLIC_DIR, legacy)), `${legacy} must be removed`);
  }
});

test('no frontend module stores anything in browser storage', () => {
  for (const { file, source } of FRONTEND) {
    assert.equal(/localStorage/.test(source), false, `${file} must not use localStorage`);
    assert.equal(/sessionStorage/.test(source), false, `${file} must not use sessionStorage`);
    assert.equal(/document\.cookie/.test(source), false, `${file} must not read or write cookies`);
    assert.equal(/indexedDB/.test(source), false, `${file} must not use indexedDB`);
  }
});

test('untrusted values never reach innerHTML', () => {
  for (const { file, source } of FRONTEND) {
    const assignments = source.match(/\.innerHTML\s*=\s*([^\n;]+)/g) || [];
    for (const assignment of assignments) {
      // The only permitted innerHTML sinks are locally authored, constant SVG.
      assert.ok(
        /opts\.trustedSvg|PATHS\[|PROVIDER_SVG\[/.test(assignment),
        `${file}: innerHTML may only receive locally authored SVG — found ${assignment}`,
      );
    }
    assert.equal(/outerHTML\s*=/.test(source), false, `${file} must not assign outerHTML`);
    assert.equal(/insertAdjacentHTML/.test(source), false, `${file} must not use insertAdjacentHTML`);
    assert.equal(/document\.write/.test(source), false, `${file} must not use document.write`);
    assert.equal(/\beval\s*\(/.test(source), false, `${file} must not use eval`);
    assert.equal(/new Function\s*\(/.test(source), false, `${file} must not build functions from strings`);
  }
});

test('the CSRF token lives in memory only and is sent as a header', () => {
  const api = FRONTEND.find((f) => f.file === 'assets/js/api.js');
  assert.ok(api);
  assert.match(api.source, /let csrfToken/);
  assert.match(api.source, /X-CSRF-Token/i);
  assert.equal(/localStorage|sessionStorage/.test(api.source), false);
});

test('OAuth navigation is restricted to approved provider hosts', () => {
  const cards = FRONTEND.find((f) => f.file === 'assets/js/components/providerCards.js');
  assert.ok(cards);
  // Only the three supported providers, and each pinned to its own host.
  assert.match(cards.source, /www\.facebook\.com/);
  assert.match(cards.source, /www\.instagram\.com/);
  assert.match(cards.source, /threads\.net/);
  // The host is checked before any navigation happens.
  assert.match(cards.source, /PROVIDER_HOSTS/);
  const navIndex = cards.source.indexOf('window.location.assign');
  assert.ok(navIndex > 0, 'connect() must navigate via window.location.assign');
  assert.ok(cards.source.slice(0, navIndex).includes('PROVIDER_HOSTS'),
    'the provider host must be validated before navigating');
});

test('no unsupported social platform appears anywhere in the frontend', () => {
  const banned = /\b(tiktok|pinterest|linkedin|youtube|whatsapp|snapchat|twitter)\b/i;
  for (const { file, source } of FRONTEND) {
    assert.equal(banned.test(source), false, `${file} must not reference unsupported platforms`);
  }
  const shell = readFileSync(path.join(PUBLIC_DIR, 'app.html'), 'utf8');
  assert.equal(banned.test(shell), false);
});

test('the frontend contains no credentials and loads nothing from a third party', () => {
  const secretish = /(sk-[A-Za-z0-9]{10,}|api[_-]?key\s*[:=]\s*['"][^'"]{8,}|client[_-]?secret\s*[:=]\s*['"][^'"]+)/i;
  for (const { file, source } of FRONTEND) {
    assert.equal(secretish.test(source), false, `${file} must not contain a credential`);
    // Only same-origin requests: no absolute URLs are fetched by the frontend.
    const fetches = source.match(/apiRequest\(\s*['"`]([^'"`]+)/g) || [];
    for (const call of fetches) {
      assert.match(call, /\(\s*['"`]\//, `${file}: ${call} must be a same-origin path`);
    }
  }
  const shell = readFileSync(path.join(PUBLIC_DIR, 'app.html'), 'utf8');
  const remote = shell.match(/(src|href)="https?:\/\/[^"]+"/g) || [];
  assert.deepEqual(remote, [], 'the shell must not load remote scripts, styles, or fonts');
});

test('the app never claims that publishing happens', () => {
  // No page may claim a blanket "posts are published now" success.
  const claims = /(now publishing|posts are published|published automatically|publishing to your accounts now)/i;
  for (const { file, source } of FRONTEND) {
    assert.equal(claims.test(source), false, `${file} must not claim posts are published`);
  }
  // Pages that mention scheduling but are NOT the publishing surface must still
  // state publishing is not the thing they do.
  const honest = ['planner', 'plannerWeek', 'plannerNew']
    .map((p) => FRONTEND.find((f) => f.file === `assets/js/pages/${p}.js`));
  for (const page of honest) {
    assert.ok(page);
    assert.match(page.source, /later phase|future publishing phase|does not publish|not published|nothing is published/i,
      `${page.file} must state that publishing is not implemented yet`);
  }
  // D2/E: the Queue and Create Post are the publishing surfaces. Each must
  // honestly reflect the live-publishing flag being OFF (default) rather than
  // imply posts actually go out to a provider.
  for (const name of ['queue', 'create', 'dashboard']) {
    const surface = FRONTEND.find((f) => f.file === `assets/js/pages/${name}.js`);
    assert.match(surface.source, /turned off|nothing is sent|not live|not sent/i,
      `${name} must honestly show when live publishing is disabled`);
  }
});

test('the planner never claims autopilot is live', () => {
  // Autopilot is PREPARED (a stored flag + date). No job runs it, so the UI
  // must not imply otherwise.
  const claims = /(autopilot is (running|active|live)|generates? automatically every week|will post for you)/i;
  for (const { file, source } of FRONTEND) {
    assert.equal(claims.test(source), false, `${file} must not claim autopilot is live`);
  }
  // Where autopilot is offered, the limitation is stated.
  const settings = FRONTEND.find((f) => f.file === 'assets/js/pages/settings.js');
  assert.match(settings.source, /not running yet/i, 'settings must say autopilot is not running yet');
});
