/**
 * Drive every application route, at every required viewport, through the REAL
 * app: measure layout, collect console and network errors, and screenshot.
 *
 * Why CDP rather than `chrome --screenshot`: the flag-based screenshots proved
 * unreliable at mobile sizes. They CROPPED a correctly-laid-out page instead of
 * rendering it at the requested viewport, which invented an overflow bug that
 * did not exist. Emulation.setDeviceMetricsOverride sets a real viewport, and
 * Runtime.evaluate measures the real document, so the picture and the numbers
 * agree. A screenshot that can crop is not evidence.
 *
 * Usage: node tools/app-review.mjs <baseUrl> <outDir> [viewport]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { launch } from './cdp.mjs';

/** The seeded review account. An obvious fixture, never a real credential. */
export const REVIEW_CREDENTIALS = Object.freeze({
  email: 'review@cyflow.test',
  password: 'Review-Pass-123456',
});

export const VIEWPORTS = Object.freeze({
  desktop: { w: 1440, h: 900 },
  laptop: { w: 1280, h: 800 },
  tablet: { w: 1024, h: 768 },
  mobile: { w: 390, h: 844 },
  small: { w: 360, h: 800 },
});

/** Every route a signed-in user can reach, plus the two auth routes. */
export const ROUTES = Object.freeze([
  { path: '/login', name: 'login', auth: false },
  { path: '/register', name: 'register', auth: false },
  { path: '/dashboard', name: 'dashboard', auth: true },
  { path: '/planner', name: 'planner', auth: true },
  { path: '/planner/new', name: 'planner-new', auth: true },
  { path: '/planner/week', name: 'planner-week', auth: true },
  { path: '/planner/history', name: 'planner-history', auth: true },
  { path: '/create', name: 'create', auth: true },
  { path: '/calendar', name: 'calendar', auth: true },
  { path: '/queue', name: 'queue', auth: true },
  { path: '/brand', name: 'brand', auth: true },
  { path: '/connections', name: 'connections', auth: true },
  { path: '/integrations', name: 'integrations', auth: true },
  { path: '/profile', name: 'profile', auth: true },
  { path: '/settings', name: 'settings', auth: true },
  { path: '/onboarding/business', name: 'onboarding-business', auth: true },
  { path: '/onboarding/brand', name: 'onboarding-brand', auth: true },
  { path: '/onboarding/connections', name: 'onboarding-connections', auth: true },
]);

/**
 * Measure a rendered route. Everything here is observed, not inferred:
 * real scroll widths, real element boxes, the real accessibility-relevant DOM.
 */
const MEASURE = `(() => {
  const doc = document.documentElement;
  const out = {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    overflowBy: Math.max(0, doc.scrollWidth - doc.clientWidth),
    title: document.title,
    h1s: [...document.querySelectorAll('h1')].map((n) => n.textContent.trim()).filter(Boolean),
    skeletons: document.querySelectorAll('.skeleton, .skeleton-line').length,
    sidebarVisible: (() => { const s = document.querySelector('.sidebar'); return !!s && getComputedStyle(s).display !== 'none'; })(),
    drawerCloseVisible: (() => { const c = document.querySelector('.drawer-close'); return !!c && getComputedStyle(c).display !== 'none'; })(),
    brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
    // Anything sticking out past the right edge, named so a fix has a target.
    offenders: [...document.querySelectorAll('body *')]
      .filter((n) => n.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 5)
      .map((n) => n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).join('.') : '')),
    // Unlabelled controls are the commonest accessibility defect in a form.
    unlabelled: [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
      .filter((n) => !n.getAttribute('aria-label') && !n.getAttribute('aria-labelledby')
        && !(n.id && document.querySelector('label[for="' + n.id + '"]')))
      .map((n) => (n.tagName + '#' + (n.id || '?'))),
    // Text that reads as a placeholder shipped by mistake.
    placeholders: (document.body.innerText.match(/lorem ipsum|TODO|FIXME|coming soon/gi) || []),
  };
  return out;
})()`;

/**
 * Wait for the client router to actually finish: the right path, no skeletons,
 * and something rendered. A fixed sleep either wastes time or, worse, captures
 * a page mid-redirect and calls it evidence.
 */
async function settle(browser, expectedPath, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const state = await browser.evaluate(`(() => ({
      path: location.pathname,
      skeletons: document.querySelectorAll('.skeleton, .skeleton-line').length,
      hasContent: !!document.querySelector('#route-root')?.children.length,
    }))()`).catch(() => null);
    if (state && state.path === expectedPath && state.skeletons === 0 && state.hasContent) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 200); });
  }
  return false;
}

async function reviewRoute(browser, baseUrl, route, viewport, outDir) {
  const { w, h } = VIEWPORTS[viewport];
  await browser.setViewport(w, h);
  await browser.goto(`${baseUrl}${route.path}`, { waitMs: 600 });
  await settle(browser, route.path);
  const measured = await browser.evaluate(MEASURE);
  const problems = browser.problems();
  const file = join(outDir, `${route.name}-${viewport}.png`);
  await browser.screenshot(file);
  return { route: route.name, viewport, file, ...measured, ...problems };
}

export async function reviewAll({ baseUrl, outDir, viewports = ['desktop', 'mobile'] }) {
  mkdirSync(outDir, { recursive: true });
  const browser = await launch({ width: 1440, height: 900, port: 9333 });
  const results = [];
  try {
    /*
     * Sign in by driving the REAL login form: fill the real inputs, submit the
     * real form, let the real router redirect. This is the browser smoke test's
     * first step, and it is better evidence than a bespoke sign-in page — if
     * login is broken, the review fails here rather than silently reviewing
     * eighteen logged-out pages.
     */
    await browser.goto(`${baseUrl}/login`, { waitMs: 1500 });
    await browser.evaluate(`(() => {
      const setValue = (id, value) => {
        const input = document.getElementById(id);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setValue('email', ${JSON.stringify(REVIEW_CREDENTIALS.email)});
      setValue('password', ${JSON.stringify(REVIEW_CREDENTIALS.password)});
      document.querySelector('form').requestSubmit();
    })()`);
    const signedIn = await settle(browser, '/dashboard', 20000);
    if (!signedIn) {
      const where = await browser.evaluate('location.pathname');
      throw new Error(`login did not reach the dashboard (stopped at ${where})`);
    }

    for (const viewport of viewports) {
      for (const route of ROUTES) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await reviewRoute(browser, baseUrl, route, viewport, outDir));
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(outDir, 'review.json'), `${JSON.stringify(results, null, 2)}\n`);
  return results;
}

const args = process.argv.slice(2);
if (args.length) {
  const [baseUrl, outDir, ...viewports] = args;
  const results = await reviewAll({
    baseUrl,
    outDir,
    viewports: viewports.length ? viewports : ['desktop', 'mobile'],
  });

  let failures = 0;
  for (const r of results) {
    const issues = [];
    if (r.overflowBy > 0) issues.push(`OVERFLOW +${r.overflowBy}px [${r.offenders.join(', ')}]`);
    if (r.console.length) issues.push(`CONSOLE ${r.console.length}: ${r.console[0].slice(0, 90)}`);
    if (r.network.length) issues.push(`NETWORK ${r.network.length}: ${r.network[0].slice(0, 90)}`);
    if (r.brokenImages.length) issues.push(`BROKEN IMG: ${r.brokenImages.join(', ')}`);
    if (r.h1s.length !== 1) issues.push(`H1 count ${r.h1s.length}`);
    if (r.skeletons > 0) issues.push(`STILL LOADING (${r.skeletons} skeletons)`);
    if (r.unlabelled.length) issues.push(`UNLABELLED: ${r.unlabelled.join(', ')}`);
    if (r.placeholders.length) issues.push(`PLACEHOLDER TEXT: ${r.placeholders.join(', ')}`);
    if (r.viewport !== 'mobile' && r.viewport !== 'small' && r.drawerCloseVisible) issues.push('DRAWER CLOSE VISIBLE ON DESKTOP');
    if (issues.length) failures += 1;
    // eslint-disable-next-line no-console
    console.log(`${issues.length ? 'FAIL' : ' ok '} ${r.route.padEnd(24)} ${r.viewport.padEnd(8)} ${issues.join(' | ') || ''}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\n${results.length} checks, ${failures} with findings -> ${outDir}/review.json`);
}
