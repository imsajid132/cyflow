/**
 * The editor's UX guarantees, in a real browser: unsaved-change protection,
 * keyboard tab navigation, and mobile layout.
 *
 * Requires: node tools/review-server.mjs <port> --with-editor-plan
 * Usage:    node tools/editor-ux-smoke.mjs <baseUrl>
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4843';
const CREDS = { email: 'review@cyflow.test', password: 'Review-Pass-123456' };

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  // eslint-disable-next-line no-console
  console.log(`${pass ? ' ok ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

async function settle(browser, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const v = await browser.evaluate(predicate).catch(() => null);
    if (v) return v;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 200); });
  }
  return null;
}

async function signIn(browser) {
  await browser.goto(`${BASE}/login`, { waitMs: 900 });
  await settle(browser, "document.getElementById('email') && document.querySelector('form') ? true : null");
  await browser.evaluate(`(() => {
    const set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
    set('email', ${JSON.stringify(CREDS.email)});
    set('password', ${JSON.stringify(CREDS.password)});
    document.querySelector('form').requestSubmit();
  })()`);
  return settle(browser, "location.pathname === '/dashboard'");
}

const openDrawer = async (browser) => {
  await browser.goto(`${BASE}/planner/week`, { waitMs: 1800 });
  const id = await settle(browser, `(() => { const c = document.querySelector('[data-item]'); return c ? c.getAttribute('data-item') : null; })()`);
  await browser.evaluate(`(() => { const c = document.querySelector('[data-item="${id}"]'); [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click(); })()`);
  await settle(browser, "document.querySelector('.pe-tab') ? true : null");
  return id;
};

async function main() {
  const browser = await launch({ width: 1440, height: 1000, port: 9843 });
  try {
    await browser.setViewport(1440, 1000);
    check('signs in', Boolean(await signIn(browser)));

    // --- unsaved-change protection ---
    await openDrawer(browser);
    // Edit Threads, then try to Close.
    await browser.evaluate(`(() => {
      const t = document.getElementById('d-copy-threads');
      t.value = t.value + ' an extra unsaved sentence here.';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await browser.evaluate(`(() => { [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.trim() === 'Close').click(); })()`);
    const warned = await settle(browser, `(() => {
      const m = document.querySelector('.modal, [role="dialog"]');
      return m && /unsaved|discard/i.test(m.textContent) ? true : null;
    })()`, 6000);
    check('closing with unsaved edits warns', Boolean(warned));

    // Cancel: the drawer stays open and the edit remains.
    if (warned) {
      await browser.evaluate(`(() => {
        const m = document.querySelector('.modal, [role="dialog"]');
        const cancel = [...m.querySelectorAll('button')].find((b) => /cancel|keep|back/i.test(b.textContent)) || [...m.querySelectorAll('button')].pop();
        cancel.click();
      })()`);
      await new Promise((r) => { setTimeout(r, 400); });
    }
    const stillOpen = await browser.evaluate("document.querySelector('.drawer') && !document.querySelector('.drawer').hidden");
    check('cancelling keeps the drawer open', Boolean(stillOpen));
    const editKept = await browser.evaluate("(document.getElementById('d-copy-threads')?.value || '').includes('an extra unsaved sentence')");
    check('the unsaved edit is still there after cancel', Boolean(editKept));

    // Save, then close: no warning.
    await browser.evaluate(`(() => { [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.trim() === 'Save changes').click(); })()`);
    await settle(browser, "document.querySelector('.drawer') && document.querySelector('.drawer').hidden ? true : null", 8000);
    const noWarnAfterSave = await browser.evaluate(`(() => !document.querySelector('.modal, [role="dialog"]'))()`);
    check('saving then closing does not warn', Boolean(noWarnAfterSave));

    // --- keyboard tab navigation ---
    await openDrawer(browser);
    const keyed = await browser.evaluate(`(() => {
      const tabs = [...document.querySelectorAll('.pe-tab')];
      tabs[0].focus();
      const before = document.activeElement === tabs[0];
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const moved = document.activeElement === tabs[1];
      const selected = tabs[1].getAttribute('aria-selected') === 'true';
      // roles present
      const list = document.querySelector('.pe-tabs').getAttribute('role') === 'tablist';
      const panelRole = document.querySelector('.pe-panel').getAttribute('role') === 'tabpanel';
      const controls = tabs[0].getAttribute('aria-controls');
      return JSON.stringify({ before, moved, selected, list, panelRole, hasControls: Boolean(controls) });
    })()`);
    const k = JSON.parse(keyed);
    check('ArrowRight moves focus to the next tab', k.before && k.moved, keyed);
    check('the newly focused tab becomes selected', k.selected);
    check('the tab strip has correct ARIA roles', k.list && k.panelRole && k.hasControls);

    // --- mobile layout at 390 x 844 ---
    await browser.setViewport(390, 844);
    await openDrawer(browser);
    const mobile = await browser.evaluate(`(() => {
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const strip = document.querySelector('.pe-tabs');
      const tabsFit = strip && strip.scrollWidth >= strip.clientWidth - 1; // may scroll horizontally, which is allowed
      const copyVisible = Boolean(document.querySelector('.pe-copy'));
      return JSON.stringify({ overflow, tabsExist: Boolean(strip), copyVisible });
    })()`);
    const m = JSON.parse(mobile);
    check('no full-page horizontal overflow on mobile', m.overflow <= 1, `${m.overflow}px`);
    check('the tab strip and copy area render on mobile', m.tabsExist && m.copyVisible);

    // Escape closes the drawer (when clean).
    await browser.evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
    const closed = await settle(browser, "document.querySelector('.drawer') && document.querySelector('.drawer').hidden ? true : null", 4000);
    check('Escape closes a clean drawer', Boolean(closed));

    const problems = browser.problems();
    const artifact = (l) => /favicon/i.test(l)
      || (/502/.test(l) && problems.network.some((n) => /\/media\//.test(n)));
    const noise = problems.console.filter((l) => !artifact(l));
    check('no console errors beyond known harness fixtures', noise.length === 0, noise.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.pass);
  // eslint-disable-next-line no-console
  console.log(`\n${results.length} checks, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

await main();
