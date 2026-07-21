/**
 * Platform selection, driven in a real browser.
 *
 * The reported bug: a user created a three-day plan for Instagram Professional
 * and Threads, and every item came back targeting facebook, threads and
 * instagram — the order the ACCOUNTS were connected in, not the order anyone
 * ticks boxes. Two of the three posts then failed because the Facebook copy,
 * for a platform never chosen, missed its length band.
 *
 * Only a browser can prove the fix end to end, because the bug lived in the gap
 * between what the form showed and what the request said. This wraps fetch and
 * reads the ACTUAL payload, then follows it to the immutable snapshot, the
 * board, the drawer, a reload and the queue.
 *
 * Requires the plain review server (no --with-failed-plan):
 *
 *   node tools/review-server.mjs <port>
 *
 * Usage: node tools/platform-smoke.mjs <baseUrl>
 */

import { mkdirSync } from 'node:fs';
import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4808';
const CREDS = { email: 'review@cyflow.test', password: 'Review-Pass-123456' };

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  // eslint-disable-next-line no-console
  console.log(`${pass ? ' ok ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

async function settle(browser, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const value = await browser.evaluate(predicate).catch(() => null);
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 200); });
  }
  return null;
}

/** Every platform checkbox: its id, its visible label, and whether it is ticked. */
const PLATFORM_BOXES = `(() => JSON.stringify(
  [...document.querySelectorAll('input[data-platform]')].map((i) => ({
    platform: i.getAttribute('data-platform'),
    label: i.closest('label')?.querySelector('span')?.textContent?.trim() ?? null,
    checked: i.checked,
  })),
))()`;

async function main() {
  const browser = await launch({ width: 1440, height: 1000, port: 9808 });
  try {
    await browser.setViewport(1440, 1000);

    await browser.goto(`${BASE}/login`, { waitMs: 800 });
    const formReady = await settle(browser, "document.getElementById('email') && document.querySelector('form') ? true : null");
    check('the login form renders', Boolean(formReady));
    await browser.evaluate(`(() => {
      const set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
      set('email', ${JSON.stringify(CREDS.email)});
      set('password', ${JSON.stringify(CREDS.password)});
      document.querySelector('form').requestSubmit();
    })()`);
    check('signs in through the real login form', Boolean(await settle(browser, "location.pathname === '/dashboard'")));

    // --- the wizard ---
    await browser.goto(`${BASE}/planner/new`, { waitMs: 2000 });
    await settle(browser, "document.querySelector('input[data-platform]') ? true : null");
    const boxes = JSON.parse(await browser.evaluate(PLATFORM_BOXES));

    check(
      'all three connected providers are offered',
      boxes.length === 3 && ['facebook', 'instagram', 'threads'].every((p) => boxes.some((b) => b.platform === p)),
      JSON.stringify(boxes.map((b) => b.platform)),
    );

    // --- REQUIREMENT: no lowercase internal ids in front of users ---
    check(
      'the Facebook box is labelled "Facebook", not the raw id',
      boxes.find((b) => b.platform === 'facebook')?.label === 'Facebook',
      JSON.stringify(boxes.find((b) => b.platform === 'facebook')?.label),
    );
    check(
      'Instagram is labelled "Instagram Professional"',
      boxes.find((b) => b.platform === 'instagram')?.label === 'Instagram Professional',
      JSON.stringify(boxes.find((b) => b.platform === 'instagram')?.label),
    );
    check(
      'no control shows a lowercase platform id',
      boxes.every((b) => b.label && b.label[0] === b.label[0].toUpperCase()),
      JSON.stringify(boxes.map((b) => b.label)),
    );

    // --- THE BUG: a connected Facebook Page must not tick itself ---
    check(
      'Facebook is visibly UNCHECKED',
      boxes.find((b) => b.platform === 'facebook')?.checked === false,
      'a connected Page ticked itself',
    );
    check(
      'Instagram and Threads are checked, because the saved choice says so',
      boxes.filter((b) => b.checked).map((b) => b.platform).sort().join(',') === 'instagram,threads',
      JSON.stringify(boxes.filter((b) => b.checked).map((b) => b.platform)),
    );

    // --- the pre-submit confirmation ---
    const confirmed = await settle(browser, `(() => {
      const dd = document.querySelector('[data-confirm-platforms]');
      return dd ? dd.textContent.trim() : null;
    })()`);
    check(
      'the page states, before submitting, exactly where these posts go',
      confirmed === 'Instagram Professional and Threads',
      JSON.stringify(confirmed),
    );
    const rows = JSON.parse(await browser.evaluate(`(() => JSON.stringify(
      [...document.querySelectorAll('.plan-confirm dt')].map((dt) => dt.textContent.trim()),
    ))()`));
    check(
      'the confirmation covers platforms, accounts, dates, times, posts and rhythm',
      ['Platforms', 'Accounts', 'Dates', 'Times', 'Posts', 'Weekly rhythm'].every((k) => rows.includes(k)),
      JSON.stringify(rows),
    );

    // --- capture the ACTUAL request payload ---
    await browser.evaluate(`(() => {
      window.__planPayload = null;
      const real = window.fetch;
      window.fetch = (url, init) => {
        if (String(url).endsWith('/api/planner/plans') && init?.method === 'POST') {
          try { window.__planPayload = JSON.parse(init.body); } catch { window.__planPayload = 'unparseable'; }
        }
        return real(url, init);
      };
    })()`);

    await browser.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Generate/i.test(b.textContent) && !b.disabled);
      btn.click();
    })()`);

    const payload = await settle(browser, 'window.__planPayload ? JSON.stringify(window.__planPayload) : null', 10000);
    check('the plan request was sent', Boolean(payload));
    const sent = JSON.parse(payload || '{}');
    check(
      'the request payload carries exactly the ticked platforms',
      JSON.stringify(sent.platforms) === JSON.stringify(['instagram', 'threads']),
      JSON.stringify(sent.platforms),
    );
    check(
      'the payload matches what the page promised',
      JSON.stringify(sent.platforms?.length) === '2' && !sent.platforms.includes('facebook'),
    );

    // --- the board ---
    const onBoard = await settle(browser, "location.pathname === '/planner/week' ? true : null", 30000);
    check('generation lands on the weekly board', Boolean(onBoard));
    const itemId = await settle(browser, `(() => {
      const c = document.querySelector('[data-item]');
      return c ? c.getAttribute('data-item') : null;
    })()`);
    check('the board renders the plan', Boolean(itemId), `item ${itemId}`);
    if (!itemId) return;

    // --- the immutable snapshot, and every item ---
    const SNAPSHOT = `(async () => {
      const plans = await (await fetch('/api/planner/plans', { headers: { Accept: 'application/json' } })).json();
      const runId = plans.data.plans[0].id;
      const plan = await (await fetch('/api/planner/plans/' + runId, { headers: { Accept: 'application/json' } })).json();
      return JSON.stringify({
        runId,
        snapshot: plan.data.run.settings.platforms,
        items: plan.data.items.map((i) => i.platformTargets),
        firstItemId: plan.data.items[0].id,
      });
    })()`;
    const state = JSON.parse(await browser.evaluate(SNAPSHOT));

    check(
      'the immutable run snapshot stores exactly the selection',
      JSON.stringify(state.snapshot) === JSON.stringify(['instagram', 'threads']),
      JSON.stringify(state.snapshot),
    );
    check(
      'EVERY item targets exactly the selection, and no Facebook',
      state.items.every((t) => JSON.stringify(t) === JSON.stringify(['instagram', 'threads'])),
      JSON.stringify(state.items[0]),
    );
    check(
      'the snapshot and the payload agree',
      JSON.stringify(state.snapshot) === JSON.stringify(sent.platforms),
    );

    // --- what the cards SHOW ---
    const shown = JSON.parse(await browser.evaluate(`(() => JSON.stringify(
      [...document.querySelectorAll('[data-item] .planner-meta')].map((p) => p.textContent.trim()),
    ))()`));
    check(
      'every card shows only Instagram Professional and Threads',
      shown.length > 0 && shown.every((s) => /Instagram Professional/.test(s) && /Threads/.test(s) && !/acebook/i.test(s)),
      JSON.stringify(shown[0]),
    );
    check(
      'no card mentions Facebook, in any casing',
      !shown.some((s) => /facebook/i.test(s)),
      JSON.stringify(shown.find((s) => /facebook/i.test(s)) || ''),
    );

    // --- the drawer ---
    await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${state.firstItemId}"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    })()`);
    const drawerPlatforms = await settle(browser, `(() => {
      const d = document.querySelector('.drawer');
      if (!d || d.hidden) return null;
      const line = [...d.querySelectorAll('.card-sub')].map((p) => p.textContent).find((t) => /Instagram|Threads|acebook/.test(t));
      return line || null;
    })()`);
    check('the edit drawer opens', Boolean(drawerPlatforms));
    check(
      'the drawer names only Instagram Professional and Threads',
      Boolean(drawerPlatforms) && /Instagram Professional/.test(drawerPlatforms)
        && /Threads/.test(drawerPlatforms) && !/acebook/i.test(drawerPlatforms),
      JSON.stringify(drawerPlatforms),
    );

    // --- a reload ---
    await browser.goto(`${BASE}/planner/week`, { waitMs: 2500 });
    await settle(browser, "document.querySelector('[data-item]') ? true : null");
    const afterReload = JSON.parse(await browser.evaluate(SNAPSHOT));
    check(
      'a reload preserves the exact platform list',
      JSON.stringify(afterReload.snapshot) === JSON.stringify(['instagram', 'threads'])
        && afterReload.items.every((t) => JSON.stringify(t) === JSON.stringify(['instagram', 'threads'])),
      JSON.stringify(afterReload.snapshot),
    );
    const reloadedShown = JSON.parse(await browser.evaluate(`(() => JSON.stringify(
      [...document.querySelectorAll('[data-item] .planner-meta')].map((p) => p.textContent.trim()),
    ))()`));
    check('Facebook is still absent after a reload', !reloadedShown.some((s) => /facebook/i.test(s)));

    // --- approve and queue ---
    await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${afterReload.firstItemId}"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve').click();
    })()`);
    await settle(browser, `(() => {
      const card = document.querySelector('[data-item="${afterReload.firstItemId}"]');
      return card && [...card.querySelectorAll('.badge')].some((b) => b.textContent.trim() === 'Approved') ? true : null;
    })()`);

    const queued = await browser.evaluate(`(async () => {
      const csrf = (await (await fetch('/api/csrf-token', { headers: { Accept: 'application/json' } })).json()).data.csrfToken;
      const res = await fetch('/api/planner/plans/${afterReload.runId}/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ itemIds: [] }),
      });
      const body = await res.json();
      const posts = await (await fetch('/api/posts', { headers: { Accept: 'application/json' } })).json();
      return JSON.stringify({
        queued: body.data?.queued?.length ?? 0,
        targets: (posts.data?.posts || []).flatMap((p) => (p.targets || []).map((t) => t.provider || t.accountType || '')),
      });
    })()`);
    const q = JSON.parse(queued);
    check('an approved post queues', q.queued > 0, JSON.stringify(q));
    check(
      'the queued post touches no Facebook account',
      !q.targets.some((t) => /meta|facebook/i.test(t)),
      JSON.stringify(q.targets),
    );

    /*
     * --- the console must be clean ---
     *
     * Two known harness artifacts are excluded, and only these:
     *
     *   /media/<token> 502 — the SSRF-safe image proxy correctly failing to
     *   fetch the fake media asset's upstream (https://example.com/...), which
     *   does not exist. A real HCTI render would return a real URL.
     *
     *   favicon — browsers request it unprompted.
     */
    const problems = browser.problems();
    const isHarnessArtifact = (line) => /favicon/i.test(line)
      || (/502/.test(line) && problems.network.some((n) => /\/media\//.test(n)));
    const noise = problems.console.filter((line) => !isHarnessArtifact(line));
    check('no console errors beyond known harness fixtures', noise.length === 0, noise.slice(0, 2).join(' | '));
    const realNetwork = problems.network.filter((n) => !/\/media\/|favicon/.test(n));
    check('no failed requests beyond known harness fixtures', realNetwork.length === 0, realNetwork.slice(0, 2).join(' | '));

    mkdirSync('.render-review/platforms', { recursive: true });
    await browser.screenshot('.render-review/platforms/board.png');
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.pass);
  // eslint-disable-next-line no-console
  console.log(`\n${results.length} checks, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

await main();
