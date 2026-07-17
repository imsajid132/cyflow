/**
 * The live checklist case, driven in a real browser.
 *
 * Friday, Actionable Tips, format Checklist, family Checklist Guide, Instagram
 * Professional and Threads, Facebook unselected. Reported:
 *
 *   Threads had 6 paragraphs; allowed 1 to 3
 *   Instagram had 100 words; minimum 120
 *   Instagram had 11 paragraphs; allowed 2 to 4
 *
 * ...and after one targeted retry the word count was fixed and the paragraph
 * count went to 14. Both posts were good checklists all along; every item was
 * being counted as a prose paragraph.
 *
 * Requires:
 *   node tools/review-server.mjs <port> --with-checklist-plan
 *
 * Usage: node tools/checklist-smoke.mjs <baseUrl>
 */

import { mkdirSync } from 'node:fs';
import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4812';
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

const ITEM = (id) => `(async () => {
  const plans = await (await fetch('/api/planner/plans', { headers: { Accept: 'application/json' } })).json();
  const runId = plans.data.plans[0].id;
  const plan = await (await fetch('/api/planner/plans/' + runId, { headers: { Accept: 'application/json' } })).json();
  const i = plan.data.items.find((x) => String(x.id) === '${id}');
  return JSON.stringify({
    instagram: i.platformCaptions?.instagram?.caption ?? null,
    threads: i.platformCaptions?.threads?.caption ?? null,
    caption: i.caption,
    qualityStatus: i.qualityStatus,
    qualityFailures: i.qualityFailures,
    platformTargets: i.platformTargets,
    mediaToken: i.media?.publicToken ?? null,
    templateKey: i.templateKey,
    scheduledFor: i.scheduledFor,
    originalTimezone: i.originalTimezone,
  });
})()`;

const DRAWER_COPY = `(() => {
  const d = document.querySelector('.drawer');
  if (!d || d.hidden) return null;
  const f = d.querySelector('#d-caption');
  return f ? f.value.trim() : null;
})()`;

const words = (s) => (s ? s.trim().split(/\s+/).length : 0);
// The same distinction the validator makes: a line that opens with a bullet is
// an item, not a paragraph.
const LIST_MARKER = /^\s*(?:[-*•·‣▪◦–—]|\d+[.)])\s+/;
const shapeOf = (s) => {
  const lines = (s || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return {
    prose: lines.filter((l) => !LIST_MARKER.test(l)).length,
    items: lines.filter((l) => LIST_MARKER.test(l)).length,
    words: words(s),
  };
};

async function main() {
  const browser = await launch({ width: 1440, height: 1000, port: 9812 });
  try {
    await browser.setViewport(1440, 1000);
    await browser.goto(`${BASE}/login`, { waitMs: 800 });
    await settle(browser, "document.getElementById('email') && document.querySelector('form') ? true : null");
    await browser.evaluate(`(() => {
      const set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
      set('email', ${JSON.stringify(CREDS.email)});
      set('password', ${JSON.stringify(CREDS.password)});
      document.querySelector('form').requestSubmit();
    })()`);
    check('signs in through the real login form', Boolean(await settle(browser, "location.pathname === '/dashboard'")));

    await browser.goto(`${BASE}/planner/week`, { waitMs: 1800 });
    const itemId = await settle(browser, `(() => {
      const c = document.querySelector('[data-item]');
      return c ? c.getAttribute('data-item') : null;
    })()`);
    check('the weekly board renders the seeded checklist item', Boolean(itemId), `item ${itemId}`);
    if (!itemId) return;

    const before = JSON.parse(await browser.evaluate(ITEM(itemId)));
    const thBefore = shapeOf(before.threads);
    const igBefore = shapeOf(before.instagram);

    check(
      'the Threads post is a real checklist: 1 paragraph + 5 items',
      thBefore.prose === 1 && thBefore.items === 5,
      JSON.stringify(thBefore),
    );
    check(
      'the Instagram post is a real checklist, genuinely under its word floor',
      igBefore.items === 7 && igBefore.words < 120,
      JSON.stringify(igBefore),
    );

    /*
     * THE FIX, as the user sees it. The reported failures said Threads had 6
     * paragraphs and Instagram had 11. The card now shows only what is really
     * wrong: Instagram's word count. Threads was never broken.
     */
    const shown = JSON.parse(await browser.evaluate(`(() => {
      const c = document.querySelector('[data-item="${itemId}"]');
      return JSON.stringify({
        summary: c.querySelector('.planner-failure-summary')?.textContent?.trim() ?? null,
        reasons: [...c.querySelectorAll('.planner-failure-list li')].map((li) => li.textContent.trim()),
      });
    })()`));
    check('the failed card still shows exact details', shown.reasons.length > 0, JSON.stringify(shown.reasons));

    // --- open the drawer, then retry ONCE with extra clicks ---
    await browser.evaluate(`(() => {
      const c = document.querySelector('[data-item="${itemId}"]');
      [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    })()`);
    check('the edit drawer opens', Boolean(await settle(browser, DRAWER_COPY)));

    await browser.evaluate(`(() => {
      window.__regen = 0;
      const real = window.fetch;
      window.fetch = (u, i) => { if (String(u).includes('/regenerate')) window.__regen += 1; return real(u, i); };
    })()`);
    const click = JSON.parse(await browser.evaluate(`(() => {
      const c = document.querySelector('[data-item="${itemId}"]');
      const b = [...c.querySelectorAll('button')].find((x) => /Retry/.test(x.textContent));
      for (let i = 0; i < 4; i += 1) b.click();
      return JSON.stringify({ disabled: b.disabled, label: b.textContent.trim() });
    })()`));
    check('the retry button disables itself on the first click', click.disabled === true);

    const recovered = await settle(browser, `(() => {
      const c = document.querySelector('[data-item="${itemId}"]');
      if (!c) return null;
      const b = [...c.querySelectorAll('.badge')].map((x) => x.textContent.trim());
      return b.includes('Generation failed') ? null : JSON.stringify(b);
    })()`, 20000);
    check('the status recovers from "Generation failed"', Boolean(recovered), recovered || 'still failed');
    check('four clicks sent exactly ONE request', (await browser.evaluate('window.__regen')) === 1);
    check('one request produced exactly one toast', (await browser.evaluate('document.querySelectorAll("#toasts .toast").length')) === 1);

    // --- what the repair actually did ---
    const after = JSON.parse(await browser.evaluate(ITEM(itemId)));
    const igAfter = shapeOf(after.instagram);
    const thAfter = shapeOf(after.threads);

    check(
      'the Instagram word count is now valid',
      igAfter.words >= 120 && igAfter.words <= 200,
      `${igBefore.words} -> ${igAfter.words} words`,
    );
    check(
      'the repair GREW THE LIST rather than adding paragraphs',
      igAfter.items >= igBefore.items && igAfter.prose <= 4,
      `items ${igBefore.items} -> ${igAfter.items}, prose ${igBefore.prose} -> ${igAfter.prose}`,
    );
    check(
      'the prose count stayed inside 2 to 4 (it went 11 -> 14 before)',
      igAfter.prose >= 2 && igAfter.prose <= 4,
      `${igAfter.prose} prose paragraphs`,
    );
    check(
      'the list is still readable: every item is still an item',
      igAfter.items >= 5,
      `${igAfter.items} items`,
    );
    check(
      'the VALID Threads checklist was not touched',
      after.threads === before.threads,
      after.threads === before.threads ? '' : 'a passing sibling was rewritten',
    );
    check('the stale failure detail is cleared', after.qualityFailures === null, JSON.stringify(after.qualityFailures));

    // --- preserved ---
    check('the image is unchanged', after.mediaToken === before.mediaToken);
    check('the template is unchanged', after.templateKey === before.templateKey);
    check('the schedule is unchanged', after.scheduledFor === before.scheduledFor);
    check('the timezone is unchanged', after.originalTimezone === 'Asia/Karachi');
    check(
      'the platform selection is unchanged, and no Facebook appeared',
      JSON.stringify(after.platformTargets) === JSON.stringify(before.platformTargets)
        && !after.platformTargets.includes('facebook'),
      JSON.stringify(after.platformTargets),
    );

    // --- card, drawer, reopened drawer, reload all agree ---
    const openDrawer = await browser.evaluate(DRAWER_COPY);
    check('the drawer stayed open through the retry', openDrawer !== null);
    check('the open drawer matches the stored copy', openDrawer === after.caption.trim());

    await browser.evaluate(`(() => {
      const d = document.querySelector('.drawer');
      [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close').click();
    })()`);
    await browser.evaluate(`(() => {
      const c = document.querySelector('[data-item="${itemId}"]');
      [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    })()`);
    check('a reopened drawer shows the same copy', (await settle(browser, DRAWER_COPY)) === openDrawer);

    await browser.goto(`${BASE}/planner/week`, { waitMs: 2000 });
    await settle(browser, `document.querySelector('[data-item="${itemId}"]') ? true : null`);
    const reloaded = JSON.parse(await browser.evaluate(ITEM(itemId)));
    check('a reload shows the same repaired copy', reloaded.instagram === after.instagram);
    check('a reload shows the untouched Threads copy', reloaded.threads === before.threads);

    /*
     * The console must be clean. One known harness artifact is excluded: the
     * /media/<token> 502 is the SSRF-safe image proxy correctly refusing to
     * fetch the fake asset's non-existent upstream.
     */
    const problems = browser.problems();
    const artifact = (l) => /favicon/i.test(l) || (/502/.test(l) && problems.network.some((n) => /\/media\//.test(n)));
    const noise = problems.console.filter((l) => !artifact(l));
    check('no console errors beyond known harness fixtures', noise.length === 0, noise.slice(0, 2).join(' | '));

    mkdirSync('.render-review/final-master/app', { recursive: true });
    await browser.screenshot('.render-review/final-master/app/checklist-repaired.png');
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.pass);
  // eslint-disable-next-line no-console
  console.log(`\n${results.length} checks, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

await main();
