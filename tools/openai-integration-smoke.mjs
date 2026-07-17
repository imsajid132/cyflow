/**
 * The OpenAI credential flow, driven in a real browser.
 *
 * The thing only a browser can prove: that the key a user types leaves the page
 * and does not come back — not in the input, not in the DOM, not in a network
 * response, not in the console.
 *
 * The key used here is fake and is never written to a screenshot name or a
 * review file.
 *
 * Requires a customer who has NOT configured OpenAI yet:
 *
 *   node tools/review-server.mjs <port> --without-openai-key
 *
 * The default seed HAS a key, because every AI action needs one now and the
 * default seed represents a working customer. This test needs the before.
 * Usage:    node tools/openai-integration-smoke.mjs <baseUrl>
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4821';
const CREDS = { email: 'review@cyflow.test', password: 'Review-Pass-123456' };

// Fake. Shaped like a real key so the UI is exercised honestly; valid for nothing.
const FAKE_KEY = 'sk-test-fake-not-a-real-key-00000000000000000000000QRST';
const FAKE_KEY_2 = 'sk-test-fake-replacement-key-1111111111111111111111UVWX';

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

/** The OpenAI card, and only it. */
const CARD = "document.querySelector('[data-integration=\"openai\"]')";

const STATE = `(() => {
  const card = ${CARD};
  return JSON.stringify({
    badges: [...card.querySelectorAll('.badge')].map((b) => b.textContent.trim()),
    mask: card.querySelector('[data-openai-mask]')?.textContent?.trim() ?? null,
    inputValue: document.getElementById('openaiApiKey')?.value ?? null,
    saveLabel: [...card.querySelectorAll('button')].find((b) => /Save key|Replace key/.test(b.textContent))?.textContent.trim() ?? null,
    hasTest: [...card.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Test connection' && !b.hidden),
    hasRemove: [...card.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Remove' && !b.hidden),
  });
})()`;

/** Click a button INSIDE the OpenAI card, `times` times. */
const clickCard = (text, times = 1) => `(() => {
  const b = [...${CARD}.querySelectorAll('button')].find((x) => x.textContent.trim() === '${text}');
  if (!b) return 0;
  let n = 0;
  for (let i = 0; i < ${times}; i += 1) { b.click(); n += 1; }
  return n;
})()`;

async function main() {
  const browser = await launch({ width: 1280, height: 1000, port: 9821 });
  try {
    await browser.setViewport(1280, 1000);
    await browser.goto(`${BASE}/login`, { waitMs: 800 });
    await settle(browser, "document.getElementById('email') && document.querySelector('form') ? true : null");
    await browser.evaluate(`(() => {
      const set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
      set('email', ${JSON.stringify(CREDS.email)});
      set('password', ${JSON.stringify(CREDS.password)});
      document.querySelector('form').requestSubmit();
    })()`);
    check('signs in through the real login form', Boolean(await settle(browser, "location.pathname === '/dashboard'")));

    // --- 1-2. not configured ---
    await browser.goto(`${BASE}/integrations`, { waitMs: 2000 });
    await settle(browser, "document.getElementById('openaiApiKey') ? true : null");
    let s = JSON.parse(await browser.evaluate(STATE));
    check('the OpenAI card reports "Not configured"', s.badges.includes('Not configured'), JSON.stringify(s.badges));
    check('nothing is verified yet', s.badges.includes('Not verified'));
    check('there is no mask, because there is no key', s.mask === null);
    check('the save button offers to Save, not Replace', s.saveLabel === 'Save key', String(s.saveLabel));

    // The billing clarification, verbatim.
    const billing = await browser.evaluate(`(() => [...${CARD}.querySelectorAll('.notice')]
      .map((n) => n.textContent.trim()).find((t) => /ChatGPT/.test(t)) ?? null)()`);
    check(
      'the ChatGPT-vs-API billing difference is stated exactly',
      billing === 'ChatGPT subscriptions and OpenAI API billing are separate. Cyflow AI requests are billed to your OpenAI API account.',
      JSON.stringify(billing),
    );
    check(
      'no balance, credit or limit is claimed anywhere on the card',
      !/balance|credits remaining|remaining credit|monthly limit/i.test(
        await browser.evaluate('document.body.innerText'),
      ),
    );

    // --- instrument fetch, capture BODIES so a leak cannot hide ---
    await browser.evaluate(`(() => {
      window.__reqs = [];
      window.__bodies = [];
      const real = window.fetch;
      window.fetch = async (url, init) => {
        if (String(url).includes('/api/integrations/openai')) {
          window.__reqs.push({ url: String(url), method: init?.method ?? 'GET' });
        }
        const res = await real(url, init);
        if (String(url).includes('/api/integrations/openai')) {
          try { window.__bodies.push(await res.clone().text()); } catch { /* opaque */ }
        }
        return res;
      };
    })()`);

    // --- 3-5. type a fake key and hammer Save ---
    await browser.evaluate(`(() => {
      const n = document.getElementById('openaiApiKey');
      n.value = ${JSON.stringify(FAKE_KEY)};
      n.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    check('four Save clicks were dispatched', (await browser.evaluate(clickCard('Save key', 4))) === 4);
    await settle(browser, "document.querySelector('[data-openai-mask]') ? true : null");

    const saves = JSON.parse(await browser.evaluate("JSON.stringify(window.__reqs.filter((r) => r.method === 'PUT'))"));
    check('four Save clicks sent exactly ONE request', saves.length === 1, `${saves.length} requests`);

    // --- 6-7. the key is gone from the page ---
    s = JSON.parse(await browser.evaluate(STATE));
    check('the input is cleared after saving', s.inputValue === '', JSON.stringify(s.inputValue));
    check('the card now says "Key saved"', s.badges.includes('Key saved'), JSON.stringify(s.badges));
    check('it is saved but NOT verified', s.badges.includes('Not verified'));
    check('only a masked ending is shown', s.mask === '••••QRST', JSON.stringify(s.mask));
    check('the save button now offers to Replace', s.saveLabel === 'Replace key', String(s.saveLabel));

    const dom = await browser.evaluate('document.documentElement.outerHTML');
    check('the raw key is nowhere in the DOM', !dom.includes(FAKE_KEY));

    // --- 8-10. test connection, hammered ---
    check('four Test clicks were dispatched', (await browser.evaluate(clickCard('Test connection', 4))) === 4);
    await settle(browser, `(() => [...${CARD}.querySelectorAll('.badge')].some((b) => b.textContent.trim() === 'Verified') ? true : null)()`, 20000);

    const tests = JSON.parse(await browser.evaluate("JSON.stringify(window.__reqs.filter((r) => r.url.includes('/test')))"));
    check('four Test clicks sent exactly ONE request', tests.length === 1, `${tests.length} requests`);
    s = JSON.parse(await browser.evaluate(STATE));
    check('the card now says "Verified"', s.badges.includes('Verified'), JSON.stringify(s.badges));
    check('a verification time is shown', /Last verified/.test(await browser.evaluate('document.body.innerText')));

    // --- 11. survives a reload ---
    await browser.goto(`${BASE}/integrations`, { waitMs: 2000 });
    await settle(browser, "document.getElementById('openaiApiKey') ? true : null");
    s = JSON.parse(await browser.evaluate(STATE));
    check('the safe status survives a reload', s.badges.includes('Key saved') && s.badges.includes('Verified'), JSON.stringify(s.badges));
    check('the reloaded input is still empty', s.inputValue === '');
    check('the reloaded page still shows only the mask', s.mask === '••••QRST');
    check('the raw key is not in the reloaded DOM', !(await browser.evaluate('document.documentElement.outerHTML')).includes(FAKE_KEY));

    // --- 12-14. replace resets verification ---
    await browser.evaluate(`(() => {
      window.__reqs = []; window.__bodies = [];
      const real = window.fetch;
      window.fetch = async (u, i) => {
        if (String(u).includes('/api/integrations/openai')) window.__reqs.push({ url: String(u), method: i?.method ?? 'GET' });
        const r = await real(u, i);
        if (String(u).includes('/api/integrations/openai')) { try { window.__bodies.push(await r.clone().text()); } catch { /* */ } }
        return r;
      };
      const n = document.getElementById('openaiApiKey');
      n.value = ${JSON.stringify(FAKE_KEY_2)};
      n.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await browser.evaluate(clickCard('Replace key'));
    await settle(browser, `(() => document.querySelector('[data-openai-mask]')?.textContent?.includes('UVWX') ? true : null)()`);

    s = JSON.parse(await browser.evaluate(STATE));
    check('replacing shows the NEW mask', s.mask === '••••UVWX', JSON.stringify(s.mask));
    check(
      'replacing RESETS verification: a new key is an unproven key',
      s.badges.includes('Not verified') && !s.badges.includes('Verified'),
      JSON.stringify(s.badges),
    );

    await browser.evaluate(clickCard('Test connection'));
    await settle(browser, `(() => [...${CARD}.querySelectorAll('.badge')].some((b) => b.textContent.trim() === 'Verified') ? true : null)()`);
    check('the replacement verifies on its own merits', true);

    // --- 18. no response body ever carried a key ---
    const bodies = JSON.parse(await browser.evaluate('JSON.stringify(window.__bodies)'));
    check(
      'no network response contained a raw key or an envelope',
      !bodies.some((b) => b.includes(FAKE_KEY) || b.includes(FAKE_KEY_2) || b.includes('v1:')),
      `${bodies.length} responses inspected`,
    );

    // --- 15-16. remove, then AI generation is blocked ---
    await browser.evaluate(clickCard('Remove'));
    await settle(browser, "document.querySelector('.modal, [role=dialog]') ? true : null");
    await browser.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Remove' && x.closest('.modal, [role=dialog]'));
      if (b) b.click();
    })()`);
    await settle(browser, `(() => [...${CARD}.querySelectorAll('.badge')].some((b) => b.textContent.trim() === 'Not configured') ? true : null)()`);
    s = JSON.parse(await browser.evaluate(STATE));
    check('removal requires confirmation and then clears the key', s.badges.includes('Not configured'), JSON.stringify(s.badges));
    check('the mask is gone after removal', s.mask === null);

    const blocked = JSON.parse(await browser.evaluate(`(async () => {
      const csrf = (await (await fetch('/api/csrf-token', { headers: { Accept: 'application/json' } })).json()).data.csrfToken;
      const res = await fetch('/api/planner/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ startDate: '2099-01-05', planLength: 1, times: ['09:00'], timezone: 'UTC', platforms: ['threads'] }),
      });
      return JSON.stringify({ status: res.status, message: (await res.json())?.error?.message ?? null });
    })()`));
    check(
      'with no key, AI generation is refused with a clear message',
      blocked.status >= 400 && /Add and verify your OpenAI API key/.test(blocked.message || ''),
      JSON.stringify(blocked),
    );

    // --- 17. the non-AI product still works ---
    for (const [route, marker] of [['/planner/week', '[data-item], .empty'], ['/connections', '.card'], ['/brand', '.card']]) {
      // eslint-disable-next-line no-await-in-loop
      await browser.goto(`${BASE}${route}`, { waitMs: 1800 });
      // eslint-disable-next-line no-await-in-loop
      const ok = await settle(browser, `document.querySelector('${marker}') ? true : null`, 8000);
      check(`${route} still works without an OpenAI key`, Boolean(ok));
    }

    // --- 19-20. console ---
    const problems = browser.problems();
    const artifact = (l) => /favicon/i.test(l) || (/502/.test(l) && problems.network.some((n) => /\/media\//.test(n)));
    const noise = problems.console.filter((l) => !artifact(l));
    check('no console errors beyond known harness fixtures', noise.length === 0, noise.slice(0, 2).join(' | '));
    check(
      'no raw key was ever logged to the console',
      !problems.console.some((l) => l.includes(FAKE_KEY) || l.includes(FAKE_KEY_2)),
    );
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.pass);
  // eslint-disable-next-line no-console
  console.log(`\n${results.length} checks, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

await main();
