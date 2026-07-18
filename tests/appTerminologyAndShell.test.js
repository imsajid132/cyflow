/**
 * Phase 4.8 — user-facing terminology and the application shell.
 *
 * "Caption" is the word that produced one-line adverts. The database columns
 * keep the name for compatibility, but nothing a user reads may say it: the
 * product writes POST COPY, and a Facebook post is not an Instagram post.
 */

import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { APP_ROUTES } from '../src/app.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function frontendFiles(dir = path.join(PUBLIC_DIR, 'assets', 'js')) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...frontendFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const FRONTEND = frontendFiles().map((file) => ({
  file: path.relative(PUBLIC_DIR, file).replace(/\\/g, '/'),
  source: stripComments(readFileSync(file, 'utf8')),
}));

/**
 * Strings a user actually reads: the values of text/label/title/subtitle/
 * placeholder options, and toast/confirm messages. Deliberately not every
 * string in the file, because `item.caption` and `platformCaptions` are field
 * names the API and the database still use and must keep using.
 */
function userFacingStrings(source) {
  const out = [];
  const optionRe = /(?:text|label|title|subtitle|placeholder|message|confirmText):\s*'((?:[^'\\]|\\.)*)'/g;
  const callRe = /(?:toast|notice)\(\s*'((?:[^'\\]|\\.)*)'/g;
  for (const re of [optionRe, callRe]) {
    let match = re.exec(source);
    while (match) {
      out.push(match[1]);
      match = re.exec(source);
    }
  }
  return out;
}

test('no user-facing string in the app says "caption"', () => {
  const offenders = [];
  for (const { file, source } of FRONTEND) {
    for (const str of userFacingStrings(source)) {
      if (/caption/i.test(str)) offenders.push(`${file}: "${str}"`);
    }
  }
  assert.deepEqual(offenders, [], `user-facing copy must say "post copy":\n${offenders.join('\n')}`);
});

test('the internal caption field names are untouched, because the API uses them', () => {
  const create = FRONTEND.find((f) => f.file === 'assets/js/pages/create.js');
  const week = FRONTEND.find((f) => f.file === 'assets/js/pages/plannerWeek.js');
  // C2: both now read the resolved per-platform copy. create.js renders
  // post.platformCopy; plannerWeek sends platformCaptions on save.
  assert.match(create.source, /platformCopy|platformCaptions|\.caption/, 'create.js reads the resolved platform copy');
  assert.match(week.source, /platformCaptions/, 'plannerWeek.js sends per-platform copy');
});

test('the planner and create pages say "post copy" to the user', () => {
  const create = FRONTEND.find((f) => f.file === 'assets/js/pages/create.js');
  const week = FRONTEND.find((f) => f.file === 'assets/js/pages/plannerWeek.js');
  // E rebuilt Create Post as a workspace; the "Post copy" section is the surface.
  assert.match(create.source, /Post copy/);
  assert.match(week.source, /Post copy/);
  assert.match(week.source, /Regenerate post copy/);
});

// --- the shell --------------------------------------------------------------

test('navigation is grouped, and every destination is a real app route', () => {
  const nav = FRONTEND.find((f) => f.file === 'assets/js/nav.js');
  assert.ok(nav);
  for (const label of ['Workspace', 'Business', 'Account']) {
    assert.ok(nav.source.includes(`'${label}'`), `missing nav group: ${label}`);
  }

  /*
   * Checked against APP_ROUTES, the server's real route table.
   *
   * This used to assert `/^\/[a-z]+$/` — a shape check that "/nonexistent"
   * passes — while its name promised the destination existed. A link to a route
   * the server does not serve is a 404 the test would happily allow.
   */
  const paths = [...nav.source.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.length >= 10, 'the sidebar should offer the whole app');
  for (const p of paths) {
    assert.ok(APP_ROUTES.includes(p), `the sidebar links to ${p}, which the server does not serve`);
  }
});

test('the drawer close control is mobile-only', () => {
  const css = readFileSync(path.join(PUBLIC_DIR, 'assets', 'css', 'design-system.css'), 'utf8');
  /*
   * This was a real defect: `.drawer-close { display:none }` was declared
   * BEFORE `.icon-btn { display:inline-flex }` at equal specificity, so the
   * later rule won and a stray close button sat in the desktop sidebar. The
   * fix depends on !important, so the test pins it.
   */
  assert.match(css, /\.drawer-close\s*\{\s*display:\s*none\s*!important/,
    'the desktop rule must out-rank .icon-btn');
  assert.match(css, /\.drawer-close\s*\{\s*display:\s*inline-flex\s*!important/,
    'the mobile rule must re-show it at equal weight');
});

// --- no third-party runtime -------------------------------------------------

test('no page loads a remote script, style, or font', () => {
  for (const page of ['app.html', '404.html']) {
    const html = readFileSync(path.join(PUBLIC_DIR, page), 'utf8');
    const remote = html.match(/(src|href)="https?:\/\/[^"]+"/g) || [];
    assert.deepEqual(remote, [], `${page} must not load anything from a third party`);
  }
});

/** Markup with HTML comments removed: what the browser renders, not the prose. */
const markup = (file) => readFileSync(path.join(PUBLIC_DIR, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

test('the Tailwind CDN is gone from the app and from the CSP', () => {
  // 404.html was the only consumer; it now uses the local design system.
  const html = markup('404.html');
  assert.ok(!/tailwind/i.test(html));
  assert.match(html, /assets\/css\/design-system\.css/);

  // ...so the policy that existed for it must not survive it. 'unsafe-eval'
  // was only there because the Play CDN compiles in the browser. The CSP is
  // read with ITS comments stripped too, for the same reason: an explanation of
  // what was removed must not read as the thing still being there.
  const appSource = readFileSync(path.join(PUBLIC_DIR, '..', 'src', 'app.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const csp = appSource.slice(appSource.indexOf('contentSecurityPolicy'), appSource.indexOf('crossOriginEmbedderPolicy'));
  assert.ok(!csp.includes('cdn.tailwindcss.com'), 'the CSP must not allow a third-party script host');
  assert.ok(!csp.includes("'unsafe-eval'"), 'the CSP must not allow eval');
  assert.match(csp, /'script-src':\s*\[\s*"'self'"\s*\]/, 'scripts must be same-origin only');
});

test('the 404 page is on the design system and carries no retired colour', () => {
  const html = markup('404.html').toLowerCase();
  for (const token of ['indigo', '#6366f1', '#4f46e5']) {
    assert.ok(!html.includes(token), `404.html still renders ${token}`);
  }
  assert.match(html, /cyflow-mark/, 'the 404 page should carry the real app mark');
});

// --- the mobile drawer is modal, so its focus must be too --------------------

test('the drawer traps focus, locks scroll, and returns focus to its trigger', () => {
  /*
   * Verified in a real browser (tools/cdp.mjs) at 390x844: focus enters the
   * drawer, Tab wraps forward and back, body scroll locks while it is open,
   * Escape closes it, and focus returns to the toggle. This test pins the
   * implementation those behaviours depend on, because a unit test cannot press
   * Tab and the browser check does not run in CI.
   */
  const nav = FRONTEND.find((f) => f.file === 'assets/js/nav.js');
  assert.ok(nav);
  assert.match(nav.source, /function trapDrawerFocus/, 'the drawer needs a focus trap');
  assert.match(nav.source, /event\.key !== 'Tab'/, 'the trap must act on Tab');
  assert.match(nav.source, /shiftKey/, 'the trap must handle Shift+Tab');
  assert.match(nav.source, /document\.body\.style\.overflow = open \? 'hidden' : ''/,
    'the body must not scroll behind an open drawer');
  assert.match(nav.source, /toggle\.focus\(\)/, 'focus must return to the control that opened it');
  assert.match(nav.source, /key === 'Escape'/, 'Escape must close the drawer');
});
