/**
 * The double-click and the targeted repair, driven in a real browser.
 *
 * Planner item 31 is seeded exactly as it exists live: Instagram valid, Threads
 * 44 words against a floor of 45, nothing duplicated, regeneration_count 9.
 *
 * Two things here can only be proved in a browser. The first is the double
 * click: the button looked identical for the several seconds a retry took, so
 * people clicked it again, and every click was another full generation. No unit
 * test sees a mouse. The second is that repairing Threads leaves the Instagram
 * copy on screen ALONE — a "retry" that silently rewrote good copy the user had
 * not asked to change would look, from the card, exactly like a success.
 *
 * Usage: node tools/repair-smoke.mjs <baseUrl>
 */

import { mkdirSync } from 'node:fs';
import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4801';
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
    await new Promise((r) => { setTimeout(r, 200); });
  }
  return null;
}

/** Everything the card shows, read from the live DOM. */
const CARD_STATE = (id) => `(() => {
  const card = document.querySelector('[data-item="${id}"]');
  if (!card) return null;
  return {
    copy: card.querySelector('.planner-caption')?.textContent?.trim() || '',
    statuses: [...card.querySelectorAll('.status')].map((b) => b.textContent.trim()),
    hasRetry: [...card.querySelectorAll('button')].some((b) => /Retry/.test(b.textContent)),
    retryDisabled: [...card.querySelectorAll('button')].find((b) => /Retry/.test(b.textContent))?.disabled ?? null,
    thumb: card.querySelector('img')?.getAttribute('src') || null,
    failureSummary: card.querySelector('.planner-failure-summary')?.textContent?.trim() || null,
    failureReasons: [...card.querySelectorAll('.planner-failure-list li')].map((li) => li.textContent.trim()),
  };
})()`;

const DRAWER_COPY = `(() => {
  const drawer = document.querySelector('.drawer');
  if (!drawer || drawer.hidden) return null;
  const field = drawer.querySelector('#d-copy-instagram') || drawer.querySelector('.pe-copy');
  return field ? field.value.trim() : null;
})()`;

/** The item as the SERVER holds it: the only place per-platform copy is visible. */
const ITEM_VIA_API = (id) => `(async () => {
  const res = await fetch('/api/planner/plans', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const body = await res.json();
  const runId = body.data.plans[0].id;
  const plan = await (await fetch('/api/planner/plans/' + runId, { credentials: 'same-origin', headers: { Accept: 'application/json' } })).json();
  const item = plan.data.items.find((i) => String(i.id) === '${id}');
  return JSON.stringify({
    instagram: item.platformCaptions?.instagram?.caption ?? null,
    threads: item.platformCaptions?.threads?.caption ?? null,
    caption: item.caption,
    qualityStatus: item.qualityStatus,
    approvalStatus: item.approvalStatus,
    qualityFailures: item.qualityFailures,
    platformTargets: item.platformTargets,
    scheduledFor: item.scheduledFor,
    originalTimezone: item.originalTimezone,
    templateKey: item.templateKey,
    mediaToken: item.media?.publicToken ?? null,
    headline: item.headline,
  });
})()`;

const countWords = (s) => (s ? s.trim().split(/\s+/).length : 0);

async function main() {
  const browser = await launch({ width: 1440, height: 900, port: 9801 });
  try {
    await browser.setViewport(1440, 900);

    // --- sign in through the real form ---
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

    // --- the seeded failure ---
    await browser.goto(`${BASE}/planner/week`, { waitMs: 1500 });
    const itemId = await settle(browser, `(() => {
      const card = document.querySelector('[data-item]');
      return card ? card.getAttribute('data-item') : null;
    })()`);
    check('the weekly board renders the plan', Boolean(itemId), `item ${itemId}`);
    if (!itemId) return;

    const before = JSON.parse(await browser.evaluate(ITEM_VIA_API(itemId)));
    check(
      'Threads is seeded one word short of the floor',
      countWords(before.threads) === 44,
      `${countWords(before.threads)} words`,
    );
    check(
      'Instagram is seeded valid, and must survive untouched',
      countWords(before.instagram) >= 120,
      `${countWords(before.instagram)} words`,
    );

    const failed = await browser.evaluate(CARD_STATE(itemId));
    check('the card is labelled "Generation failed"', failed.statuses.includes('Generation failed'), JSON.stringify(failed.statuses));
    check('the card offers Retry', failed.hasRetry === true);

    // --- REQUIREMENT 11: the user can see why, without opening phpMyAdmin ---
    check(
      'a failed card explains itself in a sentence',
      failed.failureSummary === 'Threads needs another rewrite.',
      JSON.stringify(failed.failureSummary),
    );
    check(
      'the exact measurement is one click away, on the card',
      failed.failureReasons.includes('Threads has 44 words; the minimum is 45'),
      JSON.stringify(failed.failureReasons),
    );

    /*
     * --- a plan with an unwritable post in it cannot be approved wholesale ---
     *
     * The server has always refused these one by one, so "Approve all" appeared
     * to work: it approved what it could and quietly skipped the rest. The user
     * pressed a button labelled "all" and was told nothing.
     */
    const bulk = JSON.parse(await browser.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /^Approve all$/.test(b.textContent.trim()));
      return JSON.stringify({
        exists: Boolean(btn),
        disabled: btn ? btn.disabled : null,
        why: btn?.getAttribute('title') ?? null,
        explanation: [...document.querySelectorAll('.planner-bulk .notice')].map((n) => n.textContent.trim())[0] ?? null,
      });
    })()`));
    check('Approve all is not actionable while a post could not be generated', bulk.exists && bulk.disabled === true, JSON.stringify(bulk));
    check('the disabled button says why', /could not be generated/i.test(bulk.why || ''), JSON.stringify(bulk.why));
    check(
      'the plan explains what to do about the failure',
      /could not be generated, so this plan cannot be approved in one go/.test(bulk.explanation || ''),
      JSON.stringify(bulk.explanation),
    );
    check(
      'it says the working posts can still be approved individually',
      /can still be approved individually/.test(bulk.explanation || ''),
    );

    // ...and the server refuses to queue it, whatever the page does.
    const queueAttempt = JSON.parse(await browser.evaluate(`(async () => {
      const csrf = (await (await fetch('/api/csrf-token', { headers: { Accept: 'application/json' } })).json()).data.csrfToken;
      const bulkRes = await fetch('/api/planner/plans/1/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ itemIds: ['${itemId}'], status: 'approved' }),
      });
      const bulkBody = await bulkRes.json();
      const queueRes = await fetch('/api/planner/plans/1/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ itemIds: ['${itemId}'] }),
      });
      const queueBody = await queueRes.json();
      return JSON.stringify({
        approved: bulkBody.data?.updated?.length ?? 0,
        skipped: bulkBody.data?.skipped ?? [],
        queueStatus: queueRes.status,
        queued: queueBody.data?.queued?.length ?? 0,
      });
    })()`));
    check(
      'a failed post cannot be bulk-approved, even by a direct request',
      queueAttempt.approved === 0 && queueAttempt.skipped.some((s) => /generation failed/.test(s.reason)),
      JSON.stringify(queueAttempt),
    );
    check('a failed post cannot be queued', queueAttempt.queued === 0, JSON.stringify(queueAttempt));

    // The exact detail is still on the card after all that.
    check(
      'the exact failure details are still visible',
      (await browser.evaluate(CARD_STATE(itemId))).failureReasons.includes('Threads has 44 words; the minimum is 45'),
    );

    // --- open the drawer and record what it shows ---
    await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    })()`);
    const drawerBefore = await settle(browser, DRAWER_COPY);
    check('the edit drawer opens', Boolean(drawerBefore));

    /*
     * --- THE DOUBLE CLICK ---
     *
     * Count real requests by wrapping fetch, then click five times as fast as
     * the page will accept. The reported behaviour was that every one of these
     * became a full generation.
     */
    await browser.evaluate(`(() => {
      window.__regenCalls = 0;
      const real = window.fetch;
      window.fetch = (url, init) => {
        if (String(url).includes('/regenerate')) window.__regenCalls += 1;
        return real(url, init);
      };
      window.__toastCount = () => document.querySelectorAll('#toasts .toast').length;
    })()`);

    const clicked = await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      const btn = [...card.querySelectorAll('button')].find((b) => /Retry/.test(b.textContent));
      let dispatched = 0;
      for (let i = 0; i < 5; i += 1) { btn.click(); dispatched += 1; }
      return JSON.stringify({ dispatched, disabledAfterFirst: btn.disabled, label: btn.textContent.trim() });
    })()`);
    const click = JSON.parse(clicked);
    check('five clicks were dispatched at the button', click.dispatched === 5);
    check('the button disables itself on the first click', click.disabledAfterFirst === true);
    check('the button says it is working', /Retrying/.test(click.label), click.label);

    // Wait for the retry to land.
    const recovered = await settle(browser, `(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      if (!card) return null;
      const badges = [...card.querySelectorAll('.status')].map((b) => b.textContent.trim());
      return badges.includes('Generation failed') ? null : JSON.stringify(badges);
    })()`, 20000);
    check('the status recovers from "Generation failed"', Boolean(recovered), recovered || 'still failed');

    const regenCalls = await browser.evaluate('window.__regenCalls');
    check('five clicks sent exactly ONE request', regenCalls === 1, `${regenCalls} requests`);

    const toasts = await browser.evaluate('document.querySelectorAll("#toasts .toast").length');
    check('one request produced exactly one toast', toasts === 1, `${toasts} toasts`);

    // --- what actually changed ---
    const after = JSON.parse(await browser.evaluate(ITEM_VIA_API(itemId)));

    check(
      'the Threads post was rewritten and now clears the floor',
      after.threads !== before.threads && countWords(after.threads) >= 45,
      `${countWords(before.threads)} -> ${countWords(after.threads)} words`,
    );
    check(
      'the repair cleared the floor with room to spare, not by one word',
      countWords(after.threads) >= 55,
      `${countWords(after.threads)} words`,
    );
    check(
      'the VALID Instagram post was not touched',
      after.instagram === before.instagram,
      after.instagram === before.instagram ? '' : 'good copy was rewritten',
    );
    check('the canonical caption still matches Instagram', after.caption === before.instagram);
    check('the stale failure detail is gone', after.qualityFailures === null, JSON.stringify(after.qualityFailures));
    check('the card no longer shows a failure block', (await browser.evaluate(CARD_STATE(itemId))).failureSummary === null);

    // --- preserved, and provably so ---
    check('the image is unchanged', after.mediaToken === before.mediaToken);
    check('the schedule is unchanged', after.scheduledFor === before.scheduledFor);
    check('the timezone is unchanged', after.originalTimezone === before.originalTimezone, after.originalTimezone);
    check('the template is unchanged', after.templateKey === before.templateKey);
    check('the headline is unchanged, so the existing image still matches', after.headline === before.headline);
    check(
      'the platform selection is unchanged, and no Facebook appeared',
      JSON.stringify(after.platformTargets) === JSON.stringify(before.platformTargets)
        && !after.platformTargets.includes('facebook'),
      JSON.stringify(after.platformTargets),
    );

    // --- the drawer ---
    const drawerAfter = await browser.evaluate(DRAWER_COPY);
    check('the drawer stayed open through the retry', drawerAfter !== null);
    check(
      'the open drawer agrees with the server',
      drawerAfter === after.caption.trim(),
      drawerAfter === after.caption.trim() ? '' : 'drawer disagrees with the stored copy',
    );

    await browser.evaluate(`(() => {
      const drawer = document.querySelector('.drawer');
      [...drawer.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close').click();
    })()`);
    await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    })()`);
    const reopened = await settle(browser, DRAWER_COPY);
    check('a reopened drawer shows the same copy', reopened === drawerAfter);

    // --- a full page reload ---
    await browser.goto(`${BASE}/planner/week`, { waitMs: 2000 });
    await settle(browser, `document.querySelector('[data-item="${itemId}"]') ? true : null`);
    const reloaded = JSON.parse(await browser.evaluate(ITEM_VIA_API(itemId)));
    check('a reload shows the repaired Threads copy', reloaded.threads === after.threads);
    check('a reload still shows the untouched Instagram copy', reloaded.instagram === before.instagram);
    check('a reload shows the recovered status', reloaded.qualityStatus !== 'generation_failed', reloaded.qualityStatus);

    await browser.evaluate(`(() => {
      const card = document.querySelector('[data-item="${itemId}"]');
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    })()`);
    const drawerReloaded = await settle(browser, DRAWER_COPY);
    check('the drawer after a reload shows the same copy', drawerReloaded === drawerAfter);

    /*
     * --- the console must be clean ---
     *
     * One known harness artifact is excluded, and only one:
     *
     *   /media/<token> 502 — the image proxy correctly failing to fetch the
     *   fake media asset's upstream (https://example.com/...), which does not
     *   exist. That is the SSRF-safe proxy doing its job against fixture data.
     *   A real HCTI render would return a real URL.
     *
     *   favicon — browsers request it unprompted.
     *
     * Anything else is a real error and fails this check.
     */
    const problems = browser.problems();
    const isHarnessArtifact = (line) => /favicon/i.test(line)
      || (/502/.test(line) && problems.network.some((n) => /\/media\//.test(n)));
    const noise = problems.console.filter((line) => !isHarnessArtifact(line));
    check('no console errors beyond known harness fixtures', noise.length === 0, noise.slice(0, 2).join(' | '));
    const realNetwork = problems.network.filter((n) => !/\/media\/|favicon/.test(n));
    check('no failed requests beyond known harness fixtures', realNetwork.length === 0, realNetwork.slice(0, 2).join(' | '));

    mkdirSync('.render-review/repair', { recursive: true });
    await browser.screenshot('.render-review/repair/after-retry.png');
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.pass);
  // eslint-disable-next-line no-console
  console.log(`\n${results.length} checks, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

await main();
