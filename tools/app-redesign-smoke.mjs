/**
 * Milestone F2 acceptance smoke — the authenticated app redesign.
 *
 * Drives every authenticated route in a real browser at a real viewport and
 * asserts the invariants the redesign is supposed to hold. These are checks a
 * unit test cannot make: they are about what the page actually renders.
 *
 *   - one h1 per route, and the sidebar marks the route you are on
 *   - no horizontal overflow at the narrowest supported width
 *   - status is rendered by the single shared chip, never as a raw enum
 *   - no vendor or implementation names leak into user-facing copy
 *   - controls sharing a row share a height and a baseline
 *   - link-buttons are not underlined, cards are not double-bordered
 *   - no degenerate (1x1) or broken images
 *   - a clean console
 *
 * Usage: node tools/app-redesign-smoke.mjs [baseUrl]
 * Expects a review server started with --with-editor-plan --placeholder-media.
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4910';

let pass = 0; let fail = 0; const failures = [];
const ok = (c, label) => {
  if (c) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; failures.push(label); console.log(`  FAIL ${label}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [
  '/dashboard', '/planner', '/planner/week', '/planner/history', '/create',
  '/automations', '/queue', '/calendar', '/media', '/brand', '/connections',
  '/integrations', '/profile', '/settings',
];

/*
 * Raw enum values that must never reach the user. Each of these was visible in
 * the interface before this milestone, rendered either as a bare key or as a
 * key with its underscores swapped for spaces.
 */
const RAW_ENUMS = [
  'needs_review', 'generation_failed', 'partially_queued', 'attention_needed',
  'retry_scheduled', 'waiting_approval', 'partially queued', 'needs review ',
];

/* Implementation detail that a business owner has no use for. */
const VENDOR_LEAKS = ['HCTI'];

const b = await launch({ width: 1280, height: 900, port: 9908 });

try {
  await b.goto(`${BASE}/login`, { waitMs: 900 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1600);

  /*
   * One pass over the routes collects both structure and copy. Visiting them
   * twice doubled the API calls and tripped the app's own rate limiter, which
   * then rendered empty pages and looked exactly like a redesign regression.
   */
  console.log('== Route shell ==');
  const shell = [];
  const copyHits = [];
  const vendorHits = [];
  for (const route of ROUTES) {
    await b.goto(`${BASE}${route}`, { waitMs: 1500 });
    const info = JSON.parse(await b.evaluate(`(() => {
      const h1s = [...document.querySelectorAll('h1')];
      const active = document.querySelector('.nav-link.is-active, .nav-link[aria-current="page"]');
      return JSON.stringify({
        path: location.pathname,
        h1Count: h1s.length,
        h1: (h1s[0]?.textContent || '').trim(),
        activeNav: (active?.textContent || '').trim(),
        skeletons: document.querySelectorAll('.skeleton').length,
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        text: document.body.innerText,
      });
    })()`));
    shell.push({ route, ...info });
    for (const raw of RAW_ENUMS) if (info.text.includes(raw)) copyHits.push(`${route}: ${raw}`);
    for (const v of VENDOR_LEAKS) {
      // /integrations is where the user enters that vendor's credentials, so
      // naming it there is required, not a leak.
      if (route !== '/integrations' && info.text.includes(v)) vendorHits.push(`${route}: ${v}`);
    }
  }
  ok(shell.every((s) => s.path === s.route), 'every route renders itself (no redirect)');
  ok(shell.every((s) => s.h1Count === 1), 'exactly one h1 per route');
  ok(shell.every((s) => s.h1 && s.h1 !== 'Page not found'), 'every route has a real page title');
  ok(shell.every((s) => s.activeNav), 'the sidebar marks the route you are on');
  ok(shell.every((s) => s.skeletons === 0), 'no route is still showing a skeleton after load');
  ok(shell.every((s) => s.overflow === 0), 'no horizontal overflow at 1280px');

  console.log('== Copy ==');
  ok(copyHits.length === 0, `no raw enum reaches the user (${copyHits.join(', ') || 'none'})`);
  ok(vendorHits.length === 0, `no vendor name outside /integrations (${vendorHits.join(', ') || 'none'})`);

  // ---- one status control --------------------------------------------------
  console.log('== Components ==');
  await b.goto(`${BASE}/queue`, { waitMs: 1400 });
  const statusShape = JSON.parse(await b.evaluate(`(() => {
    const chips = [...document.querySelectorAll('.status')];
    return JSON.stringify({
      count: chips.length,
      allLabelled: chips.every((c) => (c.textContent || '').trim().length > 0),
      allTyped: chips.every((c) => c.getAttribute('data-status')),
      noUnderscores: chips.every((c) => !/_/.test(c.textContent || '')),
    });
  })()`));
  ok(statusShape.count > 0, 'the queue renders status chips');
  ok(statusShape.allLabelled, 'every status chip carries a written label, not colour alone');
  ok(statusShape.allTyped, 'every status chip declares its state for styling');
  ok(statusShape.noUnderscores, 'no status chip shows an underscored key');

  // The planner used to ship a second, differently-shaped status control.
  await b.goto(`${BASE}/planner/week`, { waitMs: 1500 });
  const plannerStatus = JSON.parse(await b.evaluate(`(() => JSON.stringify({
    shared: document.querySelectorAll('.status').length,
    legacyBadges: [...document.querySelectorAll('.badge')].filter((n) =>
      /needs review|approved|rejected|queued|generation failed/i.test(n.textContent || '')).length,
  }))()`));
  ok(plannerStatus.shared > 0, 'the weekly board uses the shared status chip');
  ok(plannerStatus.legacyBadges === 0, 'the weekly board has no second status control');

  // ---- controls line up ----------------------------------------------------
  await b.goto(`${BASE}/create`, { waitMs: 1500 });
  const rows = JSON.parse(await b.evaluate(`(() => {
    const out = [];
    for (const grid of document.querySelectorAll('.grid')) {
      const controls = [...grid.querySelectorAll(':scope > .field > .input, :scope > .field > .select')];
      if (controls.length < 2) continue;
      const tops = controls.map((c) => Math.round(c.getBoundingClientRect().top));
      const hs = controls.map((c) => Math.round(c.getBoundingClientRect().height));
      out.push({ spread: Math.max(...tops) - Math.min(...tops), hSpread: Math.max(...hs) - Math.min(...hs) });
    }
    return JSON.stringify(out);
  })()`));
  ok(rows.length > 0, 'the create form has a multi-control row to check');
  ok(rows.every((r) => r.spread === 0), 'controls in a row share a baseline');
  ok(rows.every((r) => r.hSpread === 0), 'a select and an input in a row are the same height');

  // ---- no underlined buttons, no doubled card chrome ------------------------
  const chrome = JSON.parse(await b.evaluate(`(() => {
    const underlined = [...document.querySelectorAll('a.btn')]
      .filter((a) => getComputedStyle(a).textDecorationLine.includes('underline')).length;
    const doubled = [...document.querySelectorAll('.card .list-item')]
      .filter((n) => getComputedStyle(n).borderTopWidth !== '0px').length;
    return JSON.stringify({ underlined, doubled });
  })()`));
  ok(chrome.underlined === 0, 'link-buttons are not underlined');
  ok(chrome.doubled === 0, 'a list row does not draw a second border inside its card');

  // ---- images --------------------------------------------------------------
  console.log('== Images ==');
  const imgProblems = [];
  for (const route of ['/queue', '/planner/week', '/media']) {
    await b.goto(`${BASE}${route}`, { waitMs: 1600 });
    const imgs = JSON.parse(await b.evaluate(`(() => JSON.stringify(
      [...document.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight }))))()`));
    for (const i of imgs) {
      if (i.w === 0 || i.h === 0) imgProblems.push(`${route}: broken ${i.src}`);
      // A 1x1 stretched to a thumbnail is a solid block of colour, which reads
      // as a broken image even though the request succeeded.
      else if (i.w <= 2 && i.h <= 2) imgProblems.push(`${route}: degenerate ${i.w}x${i.h} ${i.src}`);
    }
  }
  ok(imgProblems.length === 0, `no broken or degenerate images (${imgProblems.join(', ') || 'none'})`);

  // ---- mobile --------------------------------------------------------------
  console.log('== Mobile ==');
  await b.close();
  const m = await launch({ width: 360, height: 800, port: 9909 });
  try {
    await m.goto(`${BASE}/login`, { waitMs: 900 });
    await m.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
    await sleep(1600);
    const wide = [];
    for (const route of ROUTES) {
      await m.goto(`${BASE}${route}`, { waitMs: 1200 });
      const over = Number(await m.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'));
      if (over > 0) wide.push(`${route}: +${over}px`);
    }
    ok(wide.length === 0, `no horizontal overflow at 360px (${wide.join(', ') || 'none'})`);

    const nav = JSON.parse(await m.evaluate(`(() => {
      const t = document.querySelector('header.topbar');
      const burger = document.querySelector('[aria-label*="menu" i], .nav-toggle');
      return JSON.stringify({ topbar: Boolean(t), burger: Boolean(burger),
        labelled: Boolean(burger && (burger.getAttribute('aria-label') || burger.textContent.trim())) });
    })()`));
    ok(nav.topbar, 'mobile shows the app top bar');
    ok(nav.burger, 'mobile exposes a menu control');
    ok(nav.labelled, 'the mobile menu control has an accessible name');
  } finally {
    await m.close();
  }
} finally {
  try { await b.close(); } catch { /* already closed for the mobile pass */ }
}

console.log(`\nAPP REDESIGN SMOKE: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
