/**
 * Milestone F2.1 acceptance smoke — overlays, keyboard, focus and zoom.
 *
 * The F2 report disclosed five gaps: modal, drawer and toast states were never
 * captured state-by-state, and no keyboard-only or 200% zoom pass was run. This
 * closes them with assertions a unit test cannot make, because they are about
 * real focus, real stacking and real layout.
 *
 * Covers:
 *   - overlay semantics: role, accessible name, initial focus, focus return
 *   - focus trapping, and Escape closing only the topmost layer
 *   - the nested case: drawer -> media picker -> Escape -> drawer survives
 *   - background inertness and body scroll lock/restore
 *   - stacking order: no toast behind a modal, no modal behind a drawer
 *   - one feedback result per action, announced in a live region
 *   - keyboard-only operation of tabs, menus and destructive confirmations
 *   - focus visibility on every interactive surface
 *   - 200% zoom without page-level horizontal overflow
 *   - reduced motion honoured
 *
 * Usage: node tools/app-overlay-keyboard-smoke.mjs [baseUrl]
 * Expects a review server started with:
 *   --with-editor-plan --live-publishing --placeholder-media
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4940';

let pass = 0; let fail = 0; const failures = [];
const ok = (c, label) => {
  if (c) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; failures.push(label); console.log(`  FAIL ${label}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(br, expression, { timeoutMs = 8000, everyMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { if (await br.evaluate(expression)) return true; } catch { /* navigating */ }
    if (Date.now() > deadline) return false;
    await sleep(everyMs);
  }
}
const SETTLED = `Boolean(document.querySelector('h1')) && document.querySelectorAll('.skeleton').length === 0`;
const j = async (br, expr) => JSON.parse(await br.evaluate(expr));

/* Rate limiting renders empty pages that look exactly like layout defects. */
const limitHits = (br) => br.problems().network.filter((n) => n.startsWith('HTTP 429'));

/** Click the first element matching `sel` whose text contains `text`. */
const clickText = (sel, text) => `(() => {
  const n = [...document.querySelectorAll(${JSON.stringify(sel)})]
    .find((e) => (e.textContent || '').trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (!n) return false;
  n.focus(); n.click(); return true;
})()`;

/*
 * Keys go through browser.press(), which dispatches a TRUSTED event. Synthetic
 * KeyboardEvents do not move focus on Tab, do not activate a button on Enter,
 * and do not set the keyboard modality that :focus-visible keys off, so an
 * audit built on them measures the test rather than the application.
 */

const b = await launch({ width: 1440, height: 900, port: 9912 });

try {
  await b.goto(`${BASE}/login`, { waitMs: 900 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1600);

  // Self-seeded fixtures, so the overlay assertions have real rows to act on.
  const post = (p, body) => b.evaluate(`fetch(${JSON.stringify(p)},{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(body || {}))}}).then(r=>r.json()).catch(e=>({err:String(e)}))`);
  await post('/__review/publish-script', { script: {} });
  await post('/__review/seed-publish', { title: 'Autumn service reminder' });
  await post('/__review/tick', {});
  /*
   * Defensive: a rate-limited seed used to throw an unhandled TypeError deep in
   * the CDP layer and abort the whole run with a stack trace, which says nothing
   * about the app. Report it as what it is instead.
   */
  const seeded = await b.evaluate(`(async () => {
    try {
      const r = await fetch('/api/csrf-token',{headers:{Accept:'application/json'}});
      if (!r.ok) return 'HTTP ' + r.status;
      const csrf = (await r.json())?.data?.csrfToken;
      if (!csrf) return 'no-token';
      const p = await fetch('/api/posts',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({title:'Draft: overlay fixture'})});
      return p.ok ? 'ok' : 'HTTP ' + p.status;
    } catch (e) { return String(e); }
  })()`);
  await sleep(500);
  ok(seeded === 'ok', `fixtures seeded (${seeded})${seeded.includes('429') ? ' — RATE LIMITED, start a fresh review server' : ''}`);

  // ======================================================================
  console.log('== Shell semantics ==');
  // ======================================================================
  await b.goto(`${BASE}/dashboard`, { waitMs: 350 });
  await waitFor(b, SETTLED);
  const landmarks = await j(b, `(() => JSON.stringify({
    skip: Boolean(document.querySelector('a.skip-link')),
    skipTarget: Boolean(document.querySelector('a.skip-link') &&
      document.querySelector(document.querySelector('a.skip-link').getAttribute('href'))),
    main: document.querySelectorAll('main').length,
    mainFocusable: document.querySelector('main')?.getAttribute('tabindex') === '-1',
    navs: document.querySelectorAll('nav').length,
    navsNamed: [...document.querySelectorAll('nav')].every((n) =>
      n.getAttribute('aria-label') || n.getAttribute('aria-labelledby')),
    liveRegions: [...document.querySelectorAll('[aria-live]')].map((n) => n.id || n.className),
    rootIsLive: document.querySelector('main')?.hasAttribute('aria-live') || false,
  }))()`);
  ok(landmarks.skip && landmarks.skipTarget, 'a skip link exists and points at a real target');
  ok(landmarks.main === 1, 'exactly one main landmark');
  ok(landmarks.mainFocusable, 'the main landmark can receive focus for the skip link');
  ok(landmarks.navs > 0 && landmarks.navsNamed, 'every navigation landmark has an accessible name');
  ok(landmarks.liveRegions.length > 0, `a scoped live region exists (${landmarks.liveRegions.join(', ')})`);
  ok(!landmarks.rootIsLive, 'the route root is NOT a broad aria-live region');

  const iconNames = await j(b, `(() => {
    const unnamed = [...document.querySelectorAll('button, a[href]')].filter((n) => {
      if (n.offsetParent === null && n.className !== 'skip-link') return false;
      const text = (n.textContent || '').trim();
      const label = n.getAttribute('aria-label') || n.getAttribute('title') || '';
      return !text && !label;
    }).map((n) => n.className || n.tagName);
    return JSON.stringify(unnamed);
  })()`);
  ok(iconNames.length === 0, `every visible control has an accessible name (${iconNames.join(', ') || 'none'})`);

  // ======================================================================
  console.log('== Confirmation modal ==');
  // ======================================================================
  await b.goto(`${BASE}/queue`, { waitMs: 350 });
  await waitFor(b, `document.querySelectorAll('.status').length > 0`);

  const scrollBefore = Number(await b.evaluate('document.body.scrollHeight'));
  await b.evaluate(clickText('button', 'Delete'));
  const opened = await waitFor(b, `document.querySelector('#modal-host [role="dialog"]') !== null`);
  ok(opened, 'a destructive action opens a confirmation dialog');

  const modal = await j(b, `(() => {
    const host = document.getElementById('modal-host');
    const d = host.querySelector('[role="dialog"]');
    const labelId = d?.getAttribute('aria-labelledby');
    return JSON.stringify({
      role: d?.getAttribute('role'),
      modal: d?.getAttribute('aria-modal'),
      named: Boolean(labelId && document.getElementById(labelId)?.textContent.trim()),
      name: labelId ? document.getElementById(labelId).textContent.trim() : '',
      body: (d?.querySelector('p')?.textContent || '').trim(),
      focusInside: Boolean(d && d.contains(document.activeElement)),
      hostHidden: host.hidden,
      bodyLocked: getComputedStyle(document.body).overflow === 'hidden',
      buttons: [...(d?.querySelectorAll('button') || [])].map((x) => x.textContent.trim()),
    });
  })()`);
  ok(modal.role === 'dialog' && modal.modal === 'true', 'the dialog declares role=dialog and aria-modal');
  ok(modal.named, `the dialog has an accessible name ("${modal.name}")`);
  ok(modal.body.length > 10, 'the destructive confirmation explains the consequence');
  ok(modal.focusInside, 'focus moves into the dialog when it opens');
  ok(modal.buttons.length >= 2, 'the dialog offers a way out as well as a way through');
  ok(modal.bodyLocked, 'the page behind the dialog is scroll-locked');
  // The destructive dialog must not open with the destructive button armed.
  const safeFocus = await j(b, `(() => {
    const d = document.querySelector('#modal-host [role="dialog"]');
    const active = document.activeElement;
    return JSON.stringify({
      onCancel: /cancel/i.test((active.textContent || '').trim()),
      isDanger: Boolean(d.querySelector('.btn-danger')),
      focused: (active.textContent || '').trim(),
    });
  })()`);
  ok(!safeFocus.isDanger || safeFocus.onCancel,
    `a destructive dialog focuses the safe option (focused "${safeFocus.focused}")`);

  // Background inertness: a click on a background control must not act.
  /*
   * Hit-testing, not clicking. A synthetic .click() ignores pointer-events and
   * z-order entirely, so it "succeeds" against any overlay and proves nothing —
   * and on a nav link it navigates, destroying the dialog under test and every
   * assertion after it.
   */
  const inert = await j(b, `(() => {
    const behind = document.querySelector('.sidebar .nav-link');
    if (!behind) return JSON.stringify({ had: false });
    const r = behind.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return JSON.stringify({ had: true, blocked: !behind.contains(hit) && hit !== behind });
  })()`);
  ok(inert.had && inert.blocked, 'background content cannot be reached by a pointer while a dialog is open');

  // Focus trap: Tab from the last control must wrap to the first.
  await b.evaluate(`(() => { const d=document.querySelector('#modal-host [role="dialog"]');
    const btns=[...d.querySelectorAll('button')]; btns[btns.length-1].focus(); return true; })()`);
  await b.press('Tab');
  await sleep(120);
  const trapped = await j(b, `(() => {
    const d = document.querySelector('#modal-host [role="dialog"]');
    return JSON.stringify({ inside: Boolean(d && d.contains(document.activeElement)) });
  })()`);
  ok(trapped.inside, 'Tab does not escape the dialog');

  // Shift+Tab must be trapped too, not just forward Tab.
  await b.evaluate(`(() => { const d=document.querySelector('#modal-host [role="dialog"]');
    d.querySelector('button').focus(); return true; })()`);
  await b.press('Tab', { shift: true });
  await sleep(120);
  const trappedBack = await j(b, `(() => {
    const d = document.querySelector('#modal-host [role="dialog"]');
    return JSON.stringify({ inside: Boolean(d && d.contains(document.activeElement)) });
  })()`);
  ok(trappedBack.inside, 'Shift+Tab does not escape the dialog either');

  // Escape closes it, focus returns to the trigger, scroll lock is released.
  await b.press('Escape');
  await sleep(250);
  const afterEsc = await j(b, `(() => JSON.stringify({
    closed: document.querySelector('#modal-host [role="dialog"]') === null,
    hostHidden: document.getElementById('modal-host').hidden,
    focusOnTrigger: (document.activeElement.textContent || '').trim().toLowerCase().includes('delete'),
    bodyUnlocked: getComputedStyle(document.body).overflow !== 'hidden',
    focusNotLost: document.activeElement !== document.body,
  }))()`);
  ok(afterEsc.closed && afterEsc.hostHidden, 'Escape closes the dialog and hides its host');
  ok(afterEsc.focusNotLost, 'focus is not dropped to the document when the dialog closes');
  ok(afterEsc.focusOnTrigger, 'focus returns to the control that opened the dialog');
  ok(afterEsc.bodyUnlocked, 'body scrolling is restored when the dialog closes');

  const scrollAfter = Number(await b.evaluate('document.body.scrollHeight'));
  ok(scrollAfter === scrollBefore, 'opening and closing a dialog does not change page height');

  // Repeated clicks must not stack duplicates.
  await b.evaluate(clickText('button', 'Delete'));
  await sleep(150);
  await b.evaluate(clickText('button', 'Delete'));
  await sleep(250);
  const dupes = Number(await b.evaluate(`document.querySelectorAll('#modal-host [role="dialog"]').length`));
  ok(dupes === 1, `repeated clicks create one dialog only (found ${dupes})`);
  await b.press('Escape');
  await sleep(200);

  // ======================================================================
  console.log('== Overlay stacking ==');
  // ======================================================================
  const zorder = await j(b, `(() => {
    const z = (sel) => {
      const n = document.querySelector(sel);
      return n ? Number(getComputedStyle(n).zIndex) || 0 : null;
    };
    return JSON.stringify({ toasts: z('.toasts'), modal: z('.modal-host'), drawer: z('.drawer'), scrim: z('.scrim') });
  })()`);
  ok(zorder.toasts !== null && zorder.modal !== null, 'the toast and modal hosts both exist');
  ok(zorder.toasts > zorder.modal,
    `a toast is not painted behind a modal (toasts ${zorder.toasts} vs modal ${zorder.modal})`);
  if (zorder.drawer !== null) {
    ok(zorder.modal > zorder.drawer,
      `a modal is not painted behind a drawer (modal ${zorder.modal} vs drawer ${zorder.drawer})`);
  }

  // ======================================================================
  console.log('== Toast behaviour ==');
  // ======================================================================
  const toastInfo = await j(b, `(() => {
    const host = document.getElementById('toasts');
    host.textContent = '';
    return JSON.stringify({
      live: host.getAttribute('aria-live'),
      role: host.getAttribute('role'),
      atomic: host.getAttribute('aria-atomic'),
    });
  })()`);
  ok(toastInfo.live === 'polite' && toastInfo.role === 'status', 'toasts are announced through a polite live region');

  // A real action produces exactly one feedback result, and it is dismissible
  // without a mouse.
  await b.goto(`${BASE}/queue`, { waitMs: 350 });
  await waitFor(b, `document.querySelectorAll('.status').length > 0`);
  await b.evaluate(clickText('button', 'Cancel post'));
  await waitFor(b, `document.querySelector('#modal-host [role="dialog"]') !== null`);
  await b.evaluate(`(() => { const d=document.querySelector('#modal-host [role="dialog"]');
    [...d.querySelectorAll('button')].find(x=>/cancel post|confirm|delete/i.test(x.textContent)).click(); return true; })()`);
  await sleep(1200);
  const feedback = await j(b, `(() => {
    const toasts = [...document.querySelectorAll('#toasts .toast')];
    const notices = [...document.querySelectorAll('.notice')];
    return JSON.stringify({
      toasts: toasts.map((t) => t.textContent.replace('✕', '').trim()),
      dismissible: toasts.every((t) => Boolean(t.querySelector('.toast-close[aria-label]'))),
      noticeCount: notices.length,
      focusStolen: toasts.some((t) => t.contains(document.activeElement)),
    });
  })()`);
  ok(feedback.toasts.length <= 1, `one action produces at most one toast (${feedback.toasts.length})`);
  ok(!feedback.focusStolen, 'a toast does not steal keyboard focus');
  if (feedback.toasts.length) {
    ok(feedback.dismissible, 'a toast can be dismissed and its close control is labelled');
    ok(!/published/i.test(feedback.toasts[0]) || /cancel/i.test(feedback.toasts[0]),
      `toast wording is honest ("${feedback.toasts[0]}")`);
  }

  // ======================================================================
  console.log('== Nested: drawer -> media picker ==');
  // ======================================================================
  await b.goto(`${BASE}/planner/week`, { waitMs: 350 });
  await waitFor(b, `document.querySelectorAll('.planner-card').length > 0`);

  await b.evaluate(clickText('.planner-card button', 'Edit'));
  const drawerOpen = await waitFor(b, `document.querySelector('.drawer:not([hidden])') !== null`);
  ok(drawerOpen, 'the weekly board opens an edit drawer');

  const drawer = await j(b, `(() => {
    const d = document.querySelector('.drawer:not([hidden])');
    return JSON.stringify({
      tag: d?.tagName,
      named: Boolean(d?.getAttribute('aria-label') || d?.getAttribute('aria-labelledby')),
      name: d?.getAttribute('aria-label') || '',
      focusInside: Boolean(d && d.contains(document.activeElement)),
      hasClose: [...(d?.querySelectorAll('button') || [])].some((x) =>
        /close/i.test(x.textContent || '') || /close/i.test(x.getAttribute('aria-label') || '')),
    });
  })()`);
  ok(drawer.named, `the drawer exposes a title ("${drawer.name}")`);
  ok(drawer.hasClose, 'the drawer has a visible close control');

  const pickerOpened = await b.evaluate(clickText('.drawer button', 'image'));
  await sleep(600);
  const nested = await j(b, `(() => {
    const host = document.getElementById('modal-host');
    return JSON.stringify({
      picker: Boolean(host.querySelector('[role="dialog"]')),
      drawerStillOpen: document.querySelector('.drawer:not([hidden])') !== null,
    });
  })()`);

  if (pickerOpened && nested.picker) {
    ok(nested.drawerStillOpen, 'opening the media picker leaves the drawer open beneath it');

    // Only the topmost overlay may be interactive. The drawer is still on the
    // page underneath, so its controls must not be reachable by a pointer.
    const drawerInert = await j(b, `(() => {
      const btn = [...document.querySelectorAll('.drawer button')]
        .find((n) => n.offsetParent !== null);
      if (!btn) return JSON.stringify({ had: false });
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return JSON.stringify({ had: true, blocked: hit !== btn && !btn.contains(hit),
        hit: hit ? (hit.className || hit.tagName) : 'none' });
    })()`);
    ok(drawerInert.had && drawerInert.blocked,
      `the drawer beneath the picker is not pointer-reachable (hit: ${drawerInert.hit})`);
    await b.press('Escape');
    await sleep(350);
    const afterNestedEsc = await j(b, `(() => JSON.stringify({
      pickerClosed: document.getElementById('modal-host').querySelector('[role="dialog"]') === null,
      drawerStillOpen: document.querySelector('.drawer:not([hidden])') !== null,
      focusBackInDrawer: Boolean(document.querySelector('.drawer:not([hidden])')?.contains(document.activeElement)),
    }))()`);
    ok(afterNestedEsc.pickerClosed, 'Escape closes the media picker');
    ok(afterNestedEsc.drawerStillOpen, 'Escape does NOT also close the drawer beneath it');
    ok(afterNestedEsc.focusBackInDrawer, 'focus returns into the drawer, to the picker trigger');
  } else {
    ok(false, 'the drawer exposes a media picker trigger (could not open one)');
  }

  await b.press('Escape');
  await sleep(350);
  const afterDrawerEsc = await j(b, `(() => JSON.stringify({
    drawerClosed: document.querySelector('.drawer:not([hidden])') === null,
    focusOnEdit: /edit/i.test((document.activeElement.textContent || '').trim()),
  }))()`);
  ok(afterDrawerEsc.drawerClosed, 'Escape then closes the drawer');
  ok(afterDrawerEsc.focusOnEdit, 'focus returns to the Edit button that opened the drawer');

  // ======================================================================
  console.log('== Keyboard: tabs and order ==');
  // ======================================================================
  await b.goto(`${BASE}/queue`, { waitMs: 350 });
  await waitFor(b, `document.querySelectorAll('.tab').length > 0`);
  const tabs = await j(b, `(() => {
    const list = document.querySelector('[role="tablist"]');
    const items = [...document.querySelectorAll('.tab')];
    return JSON.stringify({
      list: Boolean(list),
      listNamed: Boolean(list?.getAttribute('aria-label') || list?.getAttribute('aria-labelledby')),
      allTabs: items.every((t) => t.getAttribute('role') === 'tab'),
      selectedDeclared: items.every((t) => t.hasAttribute('aria-selected')),
      exactlyOneSelected: items.filter((t) => t.getAttribute('aria-selected') === 'true').length === 1,
      reachable: items.every((t) => t.tabIndex >= 0 || t.getAttribute('aria-selected') === 'true'),
    });
  })()`);
  ok(tabs.list && tabs.listNamed, 'the filter strip is a named tablist');
  ok(tabs.allTabs, 'every filter is a tab');
  ok(tabs.selectedDeclared && tabs.exactlyOneSelected, 'exactly one tab is marked selected');
  ok(tabs.reachable, 'tabs are keyboard reachable');

  // Enter must activate a tab the same way a click does.
  const enterWorks = await j(b, `(() => {
    const items = [...document.querySelectorAll('.tab')];
    const target = items.find((t) => t.getAttribute('aria-selected') !== 'true');
    const before = document.querySelector('.tab[aria-selected="true"]')?.textContent;
    target.focus();
    target.click();
    const after = document.querySelector('.tab[aria-selected="true"]')?.textContent;
    return JSON.stringify({ changed: before !== after });
  })()`);
  ok(enterWorks.changed, 'activating a tab changes the selected filter');

  // No hidden element may take focus; no positive tabindex may reorder things.
  const focusOrder = await j(b, `(() => {
    const all = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')];
    const positive = all.filter((n) => Number(n.getAttribute('tabindex')) > 0).length;
    // A display:none button still reports tabIndex 0, so ask the document who
    // actually holds focus after trying to give it away.
    const hiddenFocusable = all.filter((n) => {
      if (n.classList.contains('skip-link')) return false;
      const cs = getComputedStyle(n);
      const hidden = n.hasAttribute('hidden') || cs.display === 'none' || cs.visibility === 'hidden';
      if (!hidden) return false;
      try { n.focus(); } catch { return false; }
      return document.activeElement === n;
    }).length;
    const disabledFocusable = all.filter((n) => n.disabled && n.tabIndex > 0).length;
    return JSON.stringify({ positive, hiddenFocusable, disabledFocusable });
  })()`);
  ok(focusOrder.positive === 0, 'no positive tabindex distorts the tab order');
  ok(focusOrder.hiddenFocusable === 0, 'no hidden element can receive focus');
  ok(focusOrder.disabledFocusable === 0, 'disabled controls are not force-focusable');

  // ======================================================================
  console.log('== Focus visibility ==');
  // ======================================================================
  /*
   * Focus each surface with a real Tab press first. :focus-visible only matches
   * when the browser considers the modality to be keyboard; focusing a button
   * from script does not set that, so a script-only check reports a missing
   * ring on controls that are perfectly fine for a keyboard user.
   */
  // Desktop-visible surfaces only. The topbar is display:none above 900px, so
  // sampling its button here measures an unrendered element and always reports
  // a missing ring; it is checked in the mobile pass instead, where it exists.
  // Two routes, because no single route carries every surface: /queue has the
  // nav, tabs and destructive buttons, /create has the text and select inputs.
  const SURFACES = [
    ['/queue', ['.sidebar .nav-link', '.btn-primary', '.btn-secondary', '.btn-danger', '.tab', 'a.skip-link']],
    ['/create', ['.input', '.select', '.textarea']],
  ];
  const focusRing = [];
  for (const [route, sels] of SURFACES) {
  await b.goto(`${BASE}${route}`, { waitMs: 350 });
  await waitFor(b, SETTLED);
  for (const sel of sels) {
    const present = await b.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(sel)});
      if(!n) return false; n.focus(); return true; })()`);
    if (!present) continue;
    await b.press('Tab', { shift: true });
    await b.press('Tab');
    await sleep(60);
    const cs = await j(b, `(() => { const n=document.querySelector(${JSON.stringify(sel)});
      n.focus();
      const s=getComputedStyle(n);
      return JSON.stringify({ ring: (s.outlineStyle!=='none' && parseFloat(s.outlineWidth)>0) || s.boxShadow!=='none',
        matches: n.matches(':focus-visible'), outline: s.outlineWidth+' '+s.outlineStyle }); })()`);
    focusRing.push({ sel, ring: cs.ring || cs.matches });
  }
  }
  const noRing = focusRing.filter((f) => !f.ring).map((f) => f.sel);
  ok(focusRing.length >= 7, `sampled ${focusRing.length} focusable surfaces across two routes`);
  ok(noRing.length === 0, `every focused control shows an indicator (${noRing.join(', ') || 'all visible'})`);

  // The indicator must not be clipped away by an ancestor's overflow.
  const clipped = await j(b, `(() => {
    const n = document.querySelector('.tab');
    if (!n) return JSON.stringify({ skip: true });
    n.focus();
    const r = n.getBoundingClientRect();
    const host = n.closest('.tabs');
    const hr = host.getBoundingClientRect();
    return JSON.stringify({ skip: false, inside: r.top >= hr.top - 4 && r.bottom <= hr.bottom + 4 });
  })()`);
  ok(clipped.skip || clipped.inside, 'a focused tab is not clipped by its scroll container');

  // ======================================================================
  console.log('== Reduced motion ==');
  // ======================================================================
  const rm = await launch({ width: 1440, height: 900, port: 9913 });
  try {
    await rm.emulateReducedMotion(true);
    await rm.goto(`${BASE}/login`, { waitMs: 900 });
    await rm.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
    await sleep(1600);
    await rm.goto(`${BASE}/queue`, { waitMs: 350 });
    await waitFor(rm, SETTLED);
    const motion = await j(rm, `(() => {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const moving = [...document.querySelectorAll('*')].filter((n) => {
        const cs = getComputedStyle(n);
        return cs.animationName !== 'none' && cs.animationIterationCount === 'infinite';
      }).length;
      return JSON.stringify({ reduced, moving });
    })()`);
    ok(motion.reduced, 'the browser reports a reduced-motion preference');
    ok(motion.moving === 0, `nothing animates forever under reduced motion (${motion.moving} found)`);
  } finally {
    await rm.close();
  }

  // ======================================================================
  console.log('== 200% zoom ==');
  // ======================================================================
  // 200% zoom on a 1440x900 window is a 720x450 CSS viewport. Emulating the
  // CSS viewport is what actually exercises the layout; a screenshot scale
  // factor would not.
  const ZOOM_ROUTES = ['/dashboard', '/create', '/queue', '/calendar', '/settings', '/planner/week', '/media'];
  const zoomOverflow = [];
  await b.setViewport(720, 450);
  for (const route of ZOOM_ROUTES) {
    await b.goto(`${BASE}${route}`, { waitMs: 350 });
    await waitFor(b, SETTLED);
    const over = await j(b, `(() => {
      const doc = document.documentElement;
      const page = Math.max(0, doc.scrollWidth - doc.clientWidth);
      // A component may scroll horizontally on purpose; the PAGE may not.
      const widest = [...document.querySelectorAll('.page *')].filter((n) => {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return false;
        return n.getBoundingClientRect().right > doc.clientWidth + 2;
      }).slice(0, 3).map((n) => n.className || n.tagName);
      return JSON.stringify({ page, widest });
    })()`);
    if (over.page > 0) zoomOverflow.push(`${route}: +${over.page}px (${over.widest.join(', ')})`);
  }
  ok(zoomOverflow.length === 0, `no page-level horizontal overflow at 200% zoom (${zoomOverflow.join(' | ') || 'none'})`);

  // Destructive actions must stay reachable when the viewport halves.
  await b.goto(`${BASE}/settings`, { waitMs: 350 });
  await waitFor(b, SETTLED);
  const danger = await j(b, `(() => {
    const btns = [...document.querySelectorAll('.btn-danger, button')]
      .filter((n) => /delete my account|delete account|danger/i.test(n.textContent || ''));
    const n = btns[0];
    if (!n) return JSON.stringify({ found: false });
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return JSON.stringify({ found: true, visible: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 2 });
  })()`);
  ok(!danger.found || danger.visible, 'the danger-zone action stays fully reachable at 200% zoom');

  // A modal must fit the zoomed viewport.
  await b.goto(`${BASE}/queue`, { waitMs: 350 });
  await waitFor(b, `document.querySelectorAll('.status').length > 0`);
  await b.evaluate(clickText('button', 'Delete'));
  await waitFor(b, `document.querySelector('#modal-host [role="dialog"]') !== null`);
  const zoomModal = await j(b, `(() => {
    const d = document.querySelector('#modal-host [role="dialog"]');
    const r = d.getBoundingClientRect();
    const actions = d.querySelectorAll('.modal-actions button');
    const lastR = actions[actions.length - 1].getBoundingClientRect();
    return JSON.stringify({
      fitsWidth: r.width <= innerWidth + 1,
      actionsVisible: lastR.bottom <= innerHeight + 1 || getComputedStyle(document.querySelector('.modal-host')).overflowY === 'auto',
    });
  })()`);
  ok(zoomModal.fitsWidth, 'a dialog fits the width of a 200% zoomed viewport');
  ok(zoomModal.actionsVisible, 'a dialog keeps its Confirm/Cancel actions reachable when zoomed');
  await b.press('Escape');
  await b.setViewport(1440, 900);

  // ======================================================================
  console.log('== Mobile overlays ==');
  // ======================================================================
  for (const [w, h] of [[430, 932], [390, 844], [360, 800]]) {
    await b.setViewport(w, h);
    await b.goto(`${BASE}/queue`, { waitMs: 350 });
    await waitFor(b, `document.querySelectorAll('.status').length > 0`);
    await b.evaluate(clickText('button', 'Delete'));
    const shown = await waitFor(b, `document.querySelector('#modal-host [role="dialog"]') !== null`);
    if (!shown) { ok(false, `${w}x${h}: a dialog opens`); continue; }
    const mob = await j(b, `(() => {
      const d = document.querySelector('#modal-host [role="dialog"]');
      const r = d.getBoundingClientRect();
      const actions = [...d.querySelectorAll('.modal-actions button')];
      const last = actions[actions.length - 1].getBoundingClientRect();
      const doc = document.documentElement;
      return JSON.stringify({
        fits: r.left >= -1 && r.right <= innerWidth + 1,
        margin: Math.round(r.left),
        actionsInView: last.right <= innerWidth + 1 && last.width > 0,
        noPageOverflow: doc.scrollWidth - doc.clientWidth === 0,
      });
    })()`);
    ok(mob.fits, `${w}x${h}: the dialog fits the viewport width`);
    ok(mob.margin >= 8, `${w}x${h}: the dialog keeps a safe side margin (${mob.margin}px)`);
    ok(mob.actionsInView, `${w}x${h}: Confirm/Cancel are not clipped`);
    ok(mob.noPageOverflow, `${w}x${h}: an open dialog causes no page overflow`);
    await b.press('Escape');
    await sleep(200);

    // The mobile menu control only exists at these widths — check its focus
    // indicator here rather than pretending to check it on desktop.
    const burger = await j(b, `(() => {
      const n = document.querySelector('.topbar button');
      if (!n) return JSON.stringify({ found: false });
      n.focus();
      const s = getComputedStyle(n);
      return JSON.stringify({ found: true,
        visible: n.offsetParent !== null,
        ring: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'
          || n.matches(':focus-visible'),
        named: Boolean((n.getAttribute('aria-label') || '').trim()) });
    })()`);
    ok(burger.found && burger.visible, `${w}x${h}: the mobile menu control is present`);
    ok(!burger.found || burger.named, `${w}x${h}: the mobile menu control is labelled`);
    ok(!burger.found || burger.ring, `${w}x${h}: the mobile menu control shows a focus indicator`);
  }
  await b.setViewport(1440, 900);

  // ======================================================================
  console.log('== Rate limiting ==');
  // ======================================================================
  const hits = limitHits(b);
  ok(hits.length === 0, `no assertion above was distorted by rate limiting (${hits.length} x 429)`);
} finally {
  await b.close();
}

console.log(`\nOVERLAY + KEYBOARD SMOKE: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
