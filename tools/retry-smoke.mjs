/**
 * The Phase 4.8 retry, driven in a real browser.
 *
 * Reproduces the reported sequence exactly: open the drawer, note the copy,
 * click Retry, and check that the status, the weekly card, the ALREADY-OPEN
 * drawer, a reopened drawer and a full page reload all agree.
 *
 * The card-versus-drawer disagreement is invisible to any unit test, because it
 * was never about the data layer: both read the same field. The drawer was
 * holding an item object captured when it opened. Only a browser can catch that.
 *
 * REQUIRES the DUPLICATE scenario:
 *
 *   node tools/review-server.mjs <port> --with-duplicate-plan
 *
 * That is not incidental. A duplicate is the case where the post's angle itself
 * has to change, so the primary copy is rewritten and the visible text moves —
 * which is the only way "the drawer still shows the old copy" can be observed
 * at all. The other failure (tools/repair-smoke.mjs) rewrites one sibling
 * platform and deliberately leaves the visible copy alone, so running this
 * against it would report a stale drawer that is in fact perfectly correct.
 *
 * Usage: node tools/retry-smoke.mjs <baseUrl>
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4800';
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
    const value = await browser.evaluate(predicate).catch(() => null);
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 250); });
  }
  return null;
}

/** The card's copy and status for a given item, read from the live DOM. */
const CARD_STATE = (itemId) => `(() => {
  const card = document.querySelector('[data-item="${itemId}"]');
  if (!card) return null;
  return {
    copy: card.querySelector('.planner-caption')?.textContent?.trim() || '',
    status: card.querySelector('.status')?.textContent?.trim() || '',
    statuses: [...card.querySelectorAll('.status')].map((b) => b.textContent.trim()),
    hasApprove: [...card.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Approve'),
    hasRetry: [...card.querySelectorAll('button')].some((b) => /Retry/.test(b.textContent)),
  };
})()`;

/** The drawer's post-copy textarea, read from the live DOM. */
const DRAWER_COPY = `(() => {
  const drawer = document.querySelector('.drawer');
  if (!drawer || drawer.hidden) return null;
  const field = drawer.querySelector('#d-copy-instagram') || drawer.querySelector('.pe-copy');
  return field ? field.value.trim() : null;
})()`;

async function main() {
  const browser = await launch({ width: 1440, height: 900, port: 9800 });
  try {
    await browser.setViewport(1440, 900);

    // --- sign in through the real form ---
    await browser.goto(`${BASE}/login`, { waitMs: 800 });
    // Wait for the router to actually render the form. A fixed sleep either
    // wastes time or fills fields that do not exist yet.
    const formReady = await settle(browser, `document.getElementById('email') && document.querySelector('form') ? true : null`);
    check('the login form renders', Boolean(formReady));
    await browser.evaluate(`(() => {
      const set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
      set('email', ${JSON.stringify(CREDS.email)});
      set('password', ${JSON.stringify(CREDS.password)});
      document.querySelector('form').requestSubmit();
    })()`);
    const signedIn = await settle(browser, `location.pathname === '/dashboard'`);
    check('signs in through the real login form', Boolean(signedIn));

    // --- open the weekly board ---
    await browser.goto(`${BASE}/planner/week`, { waitMs: 1500 });
    const itemId = await settle(browser, `(() => {
      const card = document.querySelector('[data-item]');
      return card ? card.getAttribute("data-item") : null;
    })()`);
    check('the weekly board renders the plan', Boolean(itemId), `item ${itemId}`);
    if (!itemId) return;

    // --- the failed item shows honestly ---
    const failed = await browser.evaluate(CARD_STATE(itemId));
    check(
      'a failed item is labelled "Generation failed", not a raw key',
      failed.statuses.some((s) => s === 'Generation failed'),
      JSON.stringify(failed.statuses),
    );
    check('a failed item offers no Approve button', failed.hasApprove === false);
    check('a failed item offers Retry', failed.hasRetry === true);

    // --- open the drawer and record the OLD copy ---
    await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    })()`);
    const oldDrawerCopy = await settle(browser, DRAWER_COPY);
    check('the edit drawer opens and shows the current copy', Boolean(oldDrawerCopy));
    const oldCardState = await browser.evaluate(CARD_STATE(itemId));

    // The card and the drawer must agree BEFORE anything changes.
    check(
      'card and drawer agree before the retry',
      Boolean(oldDrawerCopy) && oldDrawerCopy.startsWith(oldCardState.copy.replace(/…$/, '').slice(0, 40)),
      '',
    );

    // --- click Retry, with the drawer still open ---
    await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      [...card.querySelectorAll('button')].find((b) => /Retry/.test(b.textContent)).click();
    })()`);

    const changed = await settle(browser, `(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      if (!card) return null;
      const copy = card.querySelector('.planner-caption')?.textContent?.trim() || '';
      return copy && copy !== ${JSON.stringify(oldCardState.copy)} ? copy : null;
    })()`, 20000);
    check('the weekly card shows the retried copy', Boolean(changed));

    const afterRetry = await browser.evaluate(CARD_STATE(itemId));
    check(
      'the status leaves "Generation failed"',
      !afterRetry.statuses.includes('Generation failed'),
      JSON.stringify(afterRetry.statuses),
    );

    // --- THE REGRESSION: the already-open drawer must have changed too ---
    const openDrawerCopy = await browser.evaluate(DRAWER_COPY);
    check('the drawer stayed open through the retry', openDrawerCopy !== null);
    check(
      'the ALREADY-OPEN drawer shows the retried copy, not the old copy',
      openDrawerCopy !== null && openDrawerCopy !== oldDrawerCopy,
      openDrawerCopy === oldDrawerCopy ? 'drawer is stale' : '',
    );
    check(
      'the open drawer and the card agree after the retry',
      Boolean(openDrawerCopy) && openDrawerCopy.startsWith(afterRetry.copy.replace(/…$/, '').slice(0, 40)),
    );

    // --- close and reopen ---
    await browser.evaluate(`(() => {
      const drawer = document.querySelector('.drawer');
      [...drawer.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close').click();
    })()`);
    await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    })()`);
    const reopened = await settle(browser, DRAWER_COPY);
    check('a reopened drawer shows the same latest copy', reopened === openDrawerCopy);

    // --- full page reload ---
    await browser.goto(`${BASE}/planner/week`, { waitMs: 2000 });
    await settle(browser, `document.querySelector('[data-item="${itemId}"]') ? true : null`);
    const afterReload = await browser.evaluate(CARD_STATE(itemId));
    check('a page reload shows the retried copy', afterReload.copy === afterRetry.copy, afterReload.copy.slice(0, 40));

    await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    })()`);
    const drawerAfterReload = await settle(browser, DRAWER_COPY);
    check('the drawer after a reload shows the retried copy', drawerAfterReload === openDrawerCopy);

    /*
     * --- the console must be clean ---
     *
     * Two known harness artifacts are excluded, and only these:
     *
     *   /media/<token> 502 — the image proxy correctly failing to fetch the
     *   fake media asset's upstream (https://example.com/...), which does not
     *   exist. That is the SSRF-safe proxy doing its job against fixture data,
     *   not a product defect. A real HCTI render would return a real URL.
     *
     *   favicon — browsers request it unprompted.
     *
     * Anything else is a genuine error and fails this check.
     */
    const problems = browser.problems();
    const isHarnessArtifact = (line) => /favicon/i.test(line)
      || (/502/.test(line) && problems.network.some((n) => /\/media\//.test(n)));
    const noise = problems.console.filter((line) => !isHarnessArtifact(line));
    check('no console errors beyond known harness fixtures', noise.length === 0, noise.slice(0, 2).join(' | '));
    const realNetwork = problems.network.filter((n) => !/\/media\/|favicon/.test(n));
    check('no failed requests beyond known harness fixtures', realNetwork.length === 0, realNetwork.slice(0, 2).join(' | '));

    await browser.screenshot('.render-review/phase-4.8/retry-after.png');
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.pass);
  // eslint-disable-next-line no-console
  console.log(`\n${results.length} checks, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

await main();
