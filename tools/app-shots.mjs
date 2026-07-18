/**
 * Authenticated screenshot pass — logs in, drives each app route at a TRUE
 * viewport, and writes a PNG per route. Never CSS-scales the page: the browser
 * is launched at the real size, because scaling aliases hairlines and both
 * invents and hides defects.
 *
 * Also reports, per route, whether the page rendered, whether it overflows
 * horizontally, and any console errors — so a clean-looking shot with a red
 * console still fails.
 *
 * Usage: node tools/app-shots.mjs <baseUrl> <outDir> <width>x<height> [routes...]
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4910';
const OUT = process.argv[3] || '.';
const [W, H] = String(process.argv[4] || '1440x900').split('x').map(Number);
// Routes may be given with or without a leading slash. Pass them WITHOUT one on
// Windows/Git Bash, which rewrites a leading-slash argument into a filesystem
// path ("/dashboard" -> "C:/Program Files/Git/dashboard") before Node sees it.
const DEFAULT_ROUTES = [
  'dashboard', 'planner', 'create', 'automations', 'queue',
  'calendar', 'media', 'brand', 'connections', 'integrations',
  'profile', 'settings',
];
/*
 * Routes are given WITHOUT a leading slash, using "." for sub-paths:
 * "planner.week" -> "/planner/week". Git Bash rewrites a bare leading "/" into
 * a Windows absolute path, so a real slash cannot survive the argument list.
 */
const ROUTES = (process.argv.slice(5).length ? process.argv.slice(5) : DEFAULT_ROUTES)
  .map((r) => `/${String(r).replace(/^.*[/\\]/, '').replace(/\./g, '/').replace(/^\/+/, '')}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = `${W}x${H}`;

const b = await launch({ width: W, height: H, port: 9930 + (W % 50) });
try {
  await b.goto(`${BASE}/login`, { waitMs: 900 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1600);

  for (const route of ROUTES) {
    // eslint-disable-next-line no-await-in-loop
    await b.goto(`${BASE}${route}`, { waitMs: 1400 });
    // eslint-disable-next-line no-await-in-loop
    const info = await b.evaluate(`(() => ({
      path: location.pathname,
      h1: (document.querySelector('h1')||{}).textContent || '',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      skeleton: !!document.querySelector('.skeleton'),
      brokenImg: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
      activeNav: (document.querySelector('.nav-link[aria-current="page"]')||{}).textContent || '',
    }))()`);
    const name = route.replace(/\//g, '_').replace(/^_/, '') || 'root';
    // eslint-disable-next-line no-await-in-loop
    await b.screenshot(`${OUT}/app-${name}-${tag}.png`);
    const flags = [];
    if (info.path !== route) flags.push(`REDIRECTED->${info.path}`);
    if (info.overflow > 2) flags.push(`OVERFLOW ${info.overflow}px`);
    if (info.skeleton) flags.push('STILL-SKELETON');
    if (info.brokenImg) flags.push(`BROKEN-IMG ${info.brokenImg}`);
    if (!info.h1) flags.push('NO-H1');
    if (!info.activeNav) flags.push('NO-ACTIVE-NAV');
    console.log(`${flags.length ? 'FLAG' : ' ok '} ${tag} ${route.padEnd(14)} h1="${info.h1.slice(0, 34)}" nav="${info.activeNav.trim().slice(0, 18)}"${flags.length ? '  << ' + flags.join(', ') : ''}`);
  }

  const errs = b.problems().console.filter((l) => /error/i.test(l) && !/favicon|502|401|400/i.test(l));
  console.log(errs.length ? `CONSOLE ERRORS (${tag}):\n  ${errs.slice(0, 6).join('\n  ')}` : `console clean (${tag})`);
} finally {
  await b.close();
}
