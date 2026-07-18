// Milestone F2.1: overlay invariants that a browser found and a reader missed.
//
// These assert the SOURCE, because the behaviours they protect were each
// introduced by a single line and would be silently undone by a single line.
// The behaviour itself is proved in the browser by
// tools/app-overlay-keyboard-smoke.mjs; these are the cheap regression guards
// that run on every `node --test`.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (...p) => readFileSync(path.join(PUBLIC_DIR, ...p), 'utf8');

const UI = read('assets', 'js', 'ui.js');
const PICKER = read('assets', 'js', 'components', 'mediaPicker.js');
const CSS = read('assets', 'css', 'design-system.css');

test('the page behind an overlay is scroll-locked, and the lock is depth-counted', () => {
  assert.match(UI, /export function lockScroll\(\)/, 'ui.js must export lockScroll');
  assert.match(UI, /export function unlockScroll\(\)/, 'ui.js must export unlockScroll');

  // Depth-counted: overlays nest (the media picker opens over the edit drawer),
  // so closing the inner one must not unlock the page under the outer one.
  assert.match(UI, /scrollDepth \+= 1/, 'lockScroll must increment a depth counter');
  assert.match(UI, /scrollDepth = Math\.max\(0, scrollDepth - 1\)/,
    'unlockScroll must decrement, and must not go negative');
  assert.match(UI, /if \(scrollDepth === 0\) document\.body\.style\.overflow = previousOverflow/,
    'the page must only unlock at depth zero, and must restore the previous value');
});

test('confirmModal locks on open and unlocks on every close path', () => {
  const body = UI.slice(UI.indexOf('export function confirmModal'));
  assert.match(body, /lockScroll\(\)/, 'confirmModal must lock the page when it opens');
  assert.match(body, /unlockScroll\(\)/, 'confirmModal must unlock the page when it closes');

  // One close() funnel, so Escape, Cancel, Confirm and backdrop all unlock.
  const closes = body.slice(0, body.indexOf('const confirmBtn'));
  assert.match(closes, /const close = \(result\) => \{[\s\S]*?unlockScroll\(\);/,
    'unlock must happen inside the shared close path, not on one button');
});

test('the media picker locks too, so a nested overlay keeps the page still', () => {
  assert.match(PICKER, /lockScroll/, 'the media picker must lock the page');
  assert.match(PICKER, /unlockScroll/, 'the media picker must unlock the page');
});

test('backdrop dismiss survives a click inside the dialog', () => {
  // `{ once: true }` looked harmless: a click anywhere inside the dialog also
  // bubbles to the host, consuming the one-shot listener without closing
  // anything, after which clicking the backdrop did nothing at all.
  const body = UI.slice(UI.indexOf('export function confirmModal'));
  assert.doesNotMatch(body, /addEventListener\('click',[^)]*\{\s*once:\s*true\s*\}/,
    'the backdrop listener must not be one-shot');
  assert.match(body, /host\.addEventListener\('click', onBackdrop\)/,
    'the backdrop listener must be a named handler');
  assert.match(body, /host\.removeEventListener\('click', onBackdrop\)/,
    'the backdrop listener must be removed when the dialog closes');
});

test('a toast is painted above the modal host and the drawer', () => {
  const zOf = (selector) => {
    const block = CSS.slice(CSS.indexOf(selector));
    const m = block.slice(0, 400).match(/z-index:\s*(\d+)/);
    assert.ok(m, `${selector} must declare a z-index`);
    return Number(m[1]);
  };
  const toasts = zOf('.toasts {');
  const modal = zOf('.modal-host {');
  const drawer = zOf('.drawer {');

  // A toast is the app answering the user. Below the modal host it was painted
  // behind the very dialog whose action produced it.
  assert.ok(toasts > modal, `.toasts (${toasts}) must sit above .modal-host (${modal})`);
  assert.ok(toasts > drawer, `.toasts (${toasts}) must sit above .drawer (${drawer})`);
  assert.ok(modal > drawer, `.modal-host (${modal}) must sit above .drawer (${drawer})`);
});

test('the toast region is announced, and its close control is labelled', () => {
  const html = read('app.html');
  assert.match(html, /id="toasts"[^>]*role="status"/, 'the toast host must be a status region');
  assert.match(html, /id="toasts"[^>]*aria-live="polite"/, 'toasts must announce politely');
  assert.match(UI, /className: 'toast-close'[\s\S]{0,160}'aria-label': 'Dismiss'/,
    'the toast close control must carry an accessible name');
});

test('the route root is not a broad live region', () => {
  const html = read('app.html');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') + 7);
  assert.doesNotMatch(main, /aria-live/,
    'pages rebuild large subtrees; announcing the whole route would flood a screen reader');
});

test('[hidden] cannot be defeated by a component display rule', () => {
  // .drawer declares display:flex. Without a strong [hidden] rule the drawer
  // stayed rendered and focusable while marked hidden.
  assert.match(CSS, /\[hidden\]\s*\{\s*display:\s*none\s*!important/,
    'a global [hidden] rule must out-rank component display declarations');
});

test('a focus indicator is defined globally, not per component', () => {
  assert.match(CSS, /:focus-visible\s*\{[^}]*outline:\s*2px solid/,
    'every focusable surface must inherit a visible focus ring');
  assert.match(CSS, /:focus-visible\s*\{[^}]*outline-offset/,
    'the ring must be offset so it is not lost against the control border');
});

test('a destructive dialog opens with the safe option focused', () => {
  // It focused the confirm button unconditionally, so "Delete this post?"
  // opened with Delete already focused: one Enter and the post was gone.
  const body = UI.slice(UI.indexOf('export function confirmModal'));
  assert.match(body, /\(danger \? cancelBtn : confirmBtn\)\.focus\(\)/,
    'danger dialogs must focus Cancel; only non-destructive ones may focus Confirm');
  assert.doesNotMatch(body, /\n\s*confirmBtn\.focus\(\);/,
    'confirm must not be focused unconditionally');
});
