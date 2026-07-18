/**
 * Milestone F acceptance smoke — the public marketing site.
 *
 * Verifies every public page renders (header + hero + footer), navigation works,
 * there is no horizontal overflow at desktop and mobile widths, the authenticated
 * app stays gated (an app route redirects to /login when signed out), and there
 * are zero console errors. Also writes screenshots for a human/visual review.
 *
 * Usage: node tools/public-smoke.mjs [baseUrl] [outDir]
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4902';
const OUT = process.argv[3] || '.';
let pass = 0; let fail = 0; const failures = [];
const ok = (c, label) => { if (c) { pass += 1; console.log(`  PASS ${label}`); } else { fail += 1; failures.push(label); console.log(`  FAIL ${label}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = ['/', '/features', '/how-it-works', '/security', '/about', '/contact', '/privacy', '/terms'];

async function checkPage(b, route) {
  await b.goto(`${BASE}${route}`, { waitMs: 900 });
  const info = await b.evaluate(`(() => ({
    header: !!document.querySelector('.pub-header'),
    footer: !!document.querySelector('.pub-footer'),
    h1: !!document.querySelector('.pub-h1, .pub-h2'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    title: document.title,
    desc: (document.querySelector('meta[name=description]')||{}).content || '',
  }))()`);
  ok(info.header && info.footer && info.h1, `${route} renders header + content + footer`);
  ok(info.overflow <= 2, `${route} has no horizontal overflow (${info.overflow}px)`);
  ok(/Cyflow Social/.test(info.title), `${route} has an accurate title`);
  ok(info.desc.length > 20, `${route} has a meta description`);
}

// --- desktop -----------------------------------------------------------------
const desk = await launch({ width: 1440, height: 1000, port: 9903 });
try {
  for (const route of ROUTES) { await checkPage(desk, route); } // eslint-disable-line no-await-in-loop

  // nav: clicking Features navigates there.
  await desk.goto(`${BASE}/`, { waitMs: 700 });
  await desk.evaluate(`[...document.querySelectorAll('.pub-nav-link')].find(a=>a.textContent.trim()==='Features')?.click()`);
  await sleep(600);
  const afterNav = await desk.evaluate('location.pathname');
  ok(afterNav === '/features', 'a public nav link navigates (SPA, same-origin)');

  // auth boundary: an app route redirects to /login when signed out.
  await desk.goto(`${BASE}/dashboard`, { waitMs: 1000 });
  const authPath = await desk.evaluate('location.pathname');
  ok(authPath === '/login', 'the authenticated app redirects to /login when signed out');

  await desk.goto(`${BASE}/`, { waitMs: 800 });
  await desk.screenshot(`${OUT}/f-home-desktop.png`);
  await desk.goto(`${BASE}/features`, { waitMs: 700 });
  await desk.screenshot(`${OUT}/f-features-desktop.png`);

  const problems = desk.problems();
  const errs = problems.console.filter((l) => /error/i.test(l) && !/favicon|502|401/i.test(l));
  ok(errs.length === 0, `no console errors (desktop)${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally { await desk.close(); }

// --- mobile ------------------------------------------------------------------
const mob = await launch({ width: 390, height: 844, port: 9904 });
try {
  await mob.goto(`${BASE}/`, { waitMs: 900 });
  const m = await mob.evaluate(`(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    mobileNav: !!document.querySelector('.pub-nav-mobile'),
  }))()`);
  ok(m.overflow <= 2, `home has no horizontal overflow on mobile (${m.overflow}px)`);
  ok(m.mobileNav, 'the mobile nav toggle is present');
  await mob.screenshot(`${OUT}/f-home-mobile.png`);

  const problems = mob.problems();
  const errs = problems.console.filter((l) => /error/i.test(l) && !/favicon|502|401/i.test(l));
  ok(errs.length === 0, `no console errors (mobile)${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally { await mob.close(); }

console.log(`\nPUBLIC SMOKE: ${pass} passed, ${fail} failed`);
if (failures.length) console.log('FAILURES:\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);
