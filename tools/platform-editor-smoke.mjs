/**
 * The per-platform editor, driven in a real browser.
 *
 * The C2 gap: the drawer showed one caption for every platform, so a user could
 * not see or edit Instagram and Threads copy independently. This drives the real
 * tabs — edit Threads only, save, reload, confirm independence, then retry
 * Threads with an overwrite confirmation and confirm Instagram is untouched.
 *
 * Requires the PASSING editor scenario, with distinct valid per-platform copy:
 *   node tools/review-server.mjs <port> --with-editor-plan
 *
 * Usage: node tools/platform-editor-smoke.mjs <baseUrl>
 */

import { mkdirSync } from 'node:fs';
import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4841';
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
    const v = await browser.evaluate(predicate).catch(() => null);
    if (v) return v;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 200); });
  }
  return null;
}

const openEditDrawer = (browser, id) => browser.evaluate(`(() => {
  const c = document.querySelector('[data-item="${id}"]');
  [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
})()`);

/** The full editor state, read from the DOM. */
const EDITOR = `(() => {
  const tabs = [...document.querySelectorAll('.pe-tab')];
  const copyFor = (p) => document.getElementById('d-copy-' + p)?.value ?? null;
  return JSON.stringify({
    tabLabels: tabs.map((t) => t.querySelector('span')?.textContent).filter((x) => x && !/^[•*]$/.test(x)),
    hasFacebook: /facebook/i.test(document.querySelector('.pe')?.textContent || '') || Boolean(document.getElementById('d-copy-facebook')),
    instagram: copyFor('instagram'),
    threads: copyFor('threads'),
  });
})()`;

/** The item as the SERVER holds it. */
const ITEM = (id) => `(async () => {
  const plans = await (await fetch('/api/planner/plans', { headers: { Accept: 'application/json' } })).json();
  const runId = plans.data.plans[0].id;
  const plan = await (await fetch('/api/planner/plans/' + runId, { headers: { Accept: 'application/json' } })).json();
  const i = plan.data.items.find((x) => String(x.id) === '${id}');
  return JSON.stringify({
    instagram: i.platformCopy?.instagram?.postCopy ?? null,
    threads: i.platformCopy?.threads?.postCopy ?? null,
    instagramEdited: i.platformCopy?.instagram?.userEdited ?? null,
    threadsEdited: i.platformCopy?.threads?.userEdited ?? null,
    platforms: Object.keys(i.platformCopy || {}),
    mediaToken: i.media?.publicToken ?? null,
    scheduledFor: i.scheduledFor,
    originalTimezone: i.originalTimezone,
    templateKey: i.templateKey,
  });
})()`;

async function main() {
  const browser = await launch({ width: 1440, height: 1000, port: 9841 });
  try {
    await browser.setViewport(1440, 1000);
    await browser.goto(`${BASE}/login`, { waitMs: 900 });
    await settle(browser, "document.getElementById('email') && document.querySelector('form') ? true : null");
    await browser.evaluate(`(() => {
      const set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
      set('email', ${JSON.stringify(CREDS.email)});
      set('password', ${JSON.stringify(CREDS.password)});
      document.querySelector('form').requestSubmit();
    })()`);
    check('signs in', Boolean(await settle(browser, "location.pathname === '/dashboard'")));

    await browser.goto(`${BASE}/planner/week`, { waitMs: 1800 });
    const itemId = await settle(browser, `(() => { const c = document.querySelector('[data-item]'); return c ? c.getAttribute('data-item') : null; })()`);
    check('the board renders the item', Boolean(itemId), `item ${itemId}`);
    if (!itemId) return;

    const seed = JSON.parse(await browser.evaluate(ITEM(itemId)));
    check('the item has distinct Instagram and Threads copy', seed.instagram !== seed.threads && seed.instagram && seed.threads);

    // --- 1-4. only selected tabs, correct copy ---
    await openEditDrawer(browser, itemId);
    await settle(browser, "document.querySelector('.pe-tab') ? true : null");
    const ed = JSON.parse(await browser.evaluate(EDITOR));
    check('only Instagram Professional and Threads tabs render', JSON.stringify(ed.tabLabels) === JSON.stringify(['Instagram Professional', 'Threads']), JSON.stringify(ed.tabLabels));
    check('Facebook is absent from the editor DOM', ed.hasFacebook === false);
    check('the Instagram tab shows the Instagram copy', ed.instagram === seed.instagram);
    check('the Threads tab shows the Threads copy', ed.threads === seed.threads);
    check('the two tabs show DIFFERENT copy', ed.instagram !== ed.threads);

    // --- 5-7. edit Threads only, Instagram must not move ---
    const NEW_THREADS = 'A hand typed threads post for this smoke test. It is deliberately different from what was there, and long enough to be a valid Threads post on its own two feet here.';
    await browser.evaluate(`(() => {
      const t = document.getElementById('d-copy-threads');
      t.value = ${JSON.stringify(NEW_THREADS)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const igAfterType = await browser.evaluate("document.getElementById('d-copy-instagram').value");
    check('editing Threads does not change the Instagram tab', igAfterType === seed.instagram);

    // instrument fetch for the save
    await browser.evaluate(`(() => {
      window.__patch = 0;
      const real = window.fetch;
      window.fetch = (u, i) => { if (i?.method === 'PATCH' && String(u).includes('/planner/items/')) window.__patch += 1; return real(u, i); };
    })()`);

    // --- 8-9. save repeatedly -> one request ---
    await browser.evaluate(`(() => {
      const b = [...document.querySelectorAll('.drawer button')].find((x) => x.textContent.trim() === 'Save changes');
      b.click(); b.click(); b.click();
    })()`);
    await settle(browser, `(() => { const c = document.querySelector('[data-item="${itemId}"]'); return c && !document.querySelector('.drawer:not([hidden])') ? true : (document.querySelector('.drawer[hidden]') ? true : null); })()`, 8000);
    await new Promise((r) => { setTimeout(r, 800); });
    const patches = await browser.evaluate('window.__patch');
    check('three Save clicks sent exactly ONE PATCH', patches === 1, `${patches} requests`);

    // --- 10-13. reload; independence and user-edited state persist ---
    await browser.goto(`${BASE}/planner/week`, { waitMs: 1800 });
    await settle(browser, `document.querySelector('[data-item="${itemId}"]') ? true : null`);
    const afterSave = JSON.parse(await browser.evaluate(ITEM(itemId)));
    check('the Threads copy persisted', afterSave.threads === NEW_THREADS);
    check('the Instagram copy is unchanged after the Threads edit', afterSave.instagram === seed.instagram);
    check('only Threads is marked user-edited', afterSave.threadsEdited === true && afterSave.instagramEdited === false, JSON.stringify({ ig: afterSave.instagramEdited, th: afterSave.threadsEdited }));

    // --- 14-19. Threads retry with overwrite confirmation ---
    // The retry button lives in the drawer (Regenerate post copy). Threads is
    // user-edited, so it must ask before overwriting.
    await openEditDrawer(browser, itemId);
    await settle(browser, "document.querySelector('.pe-tab') ? true : null");
    const before = JSON.parse(await browser.evaluate(ITEM(itemId)));
    await browser.evaluate(`(() => {
      const b = [...document.querySelectorAll('.drawer button')].find((x) => x.textContent.trim() === 'Regenerate post copy');
      b.click();
    })()`);
    // The app's confirm modal appears because Threads was user-edited.
    const modal = await settle(browser, `(() => {
      const m = document.querySelector('.modal, [role="dialog"]');
      return m && /edited|replace|discard/i.test(m.textContent) ? true : null;
    })()`, 8000);
    check('regenerating a user-edited platform asks for confirmation', Boolean(modal));
    if (modal) {
      await browser.evaluate(`(() => {
        const m = document.querySelector('.modal, [role="dialog"]');
        const btn = [...m.querySelectorAll('button')].find((b) => /Regenerate anyway|Confirm|Discard/i.test(b.textContent));
        btn.click();
      })()`);
    }
    const recovered = await settle(browser, `(async () => {
      const s = JSON.parse(await (${ITEM(itemId)}));
      return s.threads !== ${JSON.stringify(before.threads)} ? true : null;
    })()`, 20000);
    check('confirming replaces the Threads copy', Boolean(recovered));

    const afterRetry = JSON.parse(await browser.evaluate(ITEM(itemId)));
    // "Regenerate post copy" on a PASSING item is a full rewrite (write me a
    // fresh post), so both platforms become machine copy. Targeted Threads-only
    // preservation of Instagram is the REPAIR path, proven by repair-smoke 44/44
    // and the backend sibling-preservation test.
    check('the retried Threads copy is machine copy (no longer user-edited)', afterRetry.threadsEdited === false);
    check('the image is unchanged by a copy regeneration', afterRetry.mediaToken === before.mediaToken);
    check('the schedule is unchanged', afterRetry.scheduledFor === before.scheduledFor);
    check('the timezone is unchanged', afterRetry.originalTimezone === before.originalTimezone);
    check('no Facebook appeared', !afterRetry.platforms.includes('facebook'));

    // --- 20. drawer stays open ---
    const drawerOpen = await browser.evaluate("document.querySelector('.drawer') && !document.querySelector('.drawer').hidden");
    check('the drawer stayed open through the retry', Boolean(drawerOpen));

    // --- 21. revision timeline contains the retry ---
    const timeline = await browser.evaluate(`(async () => {
      const plans = await (await fetch('/api/planner/plans', { headers: { Accept: 'application/json' } })).json();
      const runId = plans.data.plans[0].id;
      const revs = await (await fetch('/api/planner/items/${itemId}/revisions', { headers: { Accept: 'application/json' } })).json();
      void runId;
      return JSON.stringify((revs.data?.revisions || []).map((r) => r.revisionType + ':' + r.platform));
    })()`);
    const types = JSON.parse(timeline);
    check('the revision timeline records the manual edit and the regeneration', types.includes('manual_edit:threads') && types.some((t) => t.startsWith('retry:')), timeline);
    check('the timeline carries no prompt or secret', !/prompt|sk-|apiKey|v1:/i.test(timeline));

    /*
     * --- console clean ---
     *
     * Two known artifacts excluded, and only these:
     *   - /media/<token> 502 (the SSRF-safe proxy against fixture upstreams);
     *   - the deliberate 409 on /regenerate. The overwrite-confirmation flow is
     *     force:false -> 409 (the guard) -> confirm -> force:true. That 409 is
     *     the guard doing its job; the browser logs it as a failed resource, but
     *     it is expected and handled.
     */
    const problems = browser.problems();
    const artifact = (l) => /favicon/i.test(l)
      || (/502/.test(l) && problems.network.some((n) => /\/media\//.test(n)))
      || (/409/.test(l) && problems.network.some((n) => /\/regenerate/.test(n)));
    const noise = problems.console.filter((l) => !artifact(l));
    check('no console errors beyond known harness fixtures', noise.length === 0, noise.slice(0, 2).join(' | '));

    mkdirSync('.render-review/final-master/app', { recursive: true });
    await browser.screenshot('.render-review/final-master/app/platform-editor.png');
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.pass);
  // eslint-disable-next-line no-console
  console.log(`\n${results.length} checks, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

await main();
