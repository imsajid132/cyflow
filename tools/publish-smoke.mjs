/**
 * Milestone D2 publishing acceptance smoke.
 *
 * Drives the real app in headless Chrome against a review server started with
 * --live-publishing, which runs the SAME publish pipeline (enqueue due publish
 * targets -> durable publish jobs -> adapters -> reconciliation) over FAKE
 * adapters. NO real provider is ever contacted. It verifies: Instagram + Threads
 * publish (never Facebook), per-platform status in the Queue, partial success,
 * retry, reconciliation, no double-publish, and zero console errors.
 *
 * Usage: node tools/publish-smoke.mjs [baseUrl]
 */

import { launch } from './cdp.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4901';
let pass = 0; let fail = 0; const failures = [];
const ok = (c, label) => { if (c) { pass += 1; console.log(`  PASS ${label}`); } else { fail += 1; failures.push(label); console.log(`  FAIL ${label}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1440, height: 1000, port: 9901 });
const post = (path, body) => b.evaluate(`fetch(${JSON.stringify(path)}, { method:'POST', headers:{'Content-Type':'application/json'}, body: ${JSON.stringify(JSON.stringify(body || {}))} }).then(r=>r.json())`);
const tick = () => post('/__review/tick', {});
const listPosts = () => b.evaluate(`fetch('/api/posts?limit=100',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>j.data.posts)`);
const targetsOf = (posts, postId) => (posts.find((p) => String(p.id) === String(postId))?.targets) || [];

try {
  await b.goto(`${BASE}/login`, { waitMs: 1000 });
  await b.evaluate(`(() => { const s=(id,v)=>{const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}; s('email','review@cyflow.test'); s('password','Review-Pass-123456'); document.querySelector('form').requestSubmit(); })()`);
  await sleep(1500);

  // --- happy path: Instagram + Threads publish, never Facebook --------------
  await post('/__review/publish-script', { script: {} });
  const seed1 = await post('/__review/seed-publish', { title: 'Happy publish' });
  ok(seed1.ok && seed1.postId, 'seeded a due Instagram+Threads post');
  await tick();
  let posts = await listPosts();
  let targets = targetsOf(posts, seed1.postId);
  ok(targets.length === 2, `post has exactly two targets (${targets.length})`);
  ok(!targets.some((t) => t.accountType === 'facebook_page'), 'no Facebook target — it was not selected');
  ok(targets.every((t) => t.publishStatus === 'published'), 'both Instagram and Threads published');
  ok(posts.find((p) => String(p.id) === String(seed1.postId)).status === 'published', 'the post status is published');

  // --- idempotency: a second tick does not republish -----------------------
  const igBefore = targets.find((t) => t.accountType === 'instagram_professional').remotePostId;
  await tick();
  posts = await listPosts();
  const igAfter = targetsOf(posts, seed1.postId).find((t) => t.accountType === 'instagram_professional').remotePostId;
  ok(igBefore === igAfter && Boolean(igBefore), 'a second tick did not republish (same provider post id)');

  // --- partial success: Instagram publishes, Threads fails ------------------
  const seed2 = await post('/__review/seed-publish', { title: 'Partial publish', threadsFail: true });
  await tick();
  posts = await listPosts();
  targets = targetsOf(posts, seed2.postId);
  const ig2 = targets.find((t) => t.accountType === 'instagram_professional');
  const th2 = targets.find((t) => t.accountType === 'threads_profile');
  ok(ig2.publishStatus === 'published', 'Instagram published despite the Threads failure');
  ok(th2.publishStatus === 'failed', 'Threads is failed, not hidden behind a blanket success');
  ok(posts.find((p) => String(p.id) === String(seed2.postId)).status === 'partial', 'the post reports partial success');

  // --- retry the failed Threads target (after clearing the scripted failure) -
  await post('/__review/publish-script', { script: {} });
  await b.goto(`${BASE}/queue`, { waitMs: 1500 });
  const retried = await b.evaluate(`(async () => {
    const csrf = (await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json()).data.csrfToken;
    const r = await fetch('/api/publish/targets/${th2.id}/retry', { method:'POST', headers:{ 'X-CSRF-Token': csrf, Accept:'application/json' } });
    return r.status;
  })()`);
  ok(retried === 200, 'retry request accepted');
  await tick();
  posts = await listPosts();
  ok(targetsOf(posts, seed2.postId).find((t) => t.accountType === 'threads_profile').publishStatus === 'published', 'the retried Threads target publishes; Instagram stays published');
  ok(posts.find((p) => String(p.id) === String(seed2.postId)).status === 'published', 'the post is now fully published');

  // --- reconciliation: an uncertain Instagram result is reconciled ----------
  const seed3 = await post('/__review/seed-publish', { title: 'Reconcile publish', igSubmitted: true });
  await tick();
  posts = await listPosts();
  ok(targetsOf(posts, seed3.postId).find((t) => t.accountType === 'instagram_professional').publishStatus === 'reconciling', 'Instagram is reconciling after an uncertain result');
  await tick(); await tick();
  posts = await listPosts();
  ok(targetsOf(posts, seed3.postId).find((t) => t.accountType === 'instagram_professional').publishStatus === 'published', 'reconciliation resolved Instagram to published (no duplicate)');

  // --- the Queue renders per-target status ----------------------------------
  await b.goto(`${BASE}/queue`, { waitMs: 1500 });
  const queueText = await b.evaluate('document.body.innerText');
  ok(/Published/.test(queueText), 'the Queue shows Published per-target chips');
  ok(/enabled/i.test(queueText), 'the Queue reflects that live publishing is enabled');

  // --- attempt history is safe (no token / raw body) ------------------------
  const attempts = await b.evaluate(`fetch('/api/publish/targets/${th2.id}/attempts',{headers:{Accept:'application/json'}}).then(r=>r.json()).then(j=>JSON.stringify(j.data.attempts))`);
  ok(!/access_token|Bearer|"error":\{/.test(attempts), 'attempt history exposes no token or raw provider body');

  const problems = b.problems();
  const errs = problems.console.filter((l) => /error/i.test(l) && !/favicon|502/i.test(l));
  ok(errs.length === 0, `no console errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
} finally {
  await b.close();
}

console.log(`\nPUBLISH SMOKE: ${pass} passed, ${fail} failed`);
if (failures.length) console.log('FAILURES:\n  - ' + failures.join('\n  - '));
process.exit(fail ? 1 : 0);
