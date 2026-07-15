/**
 * Integrations — HCTI credentials only.
 *
 * The user's HCTI User ID and API Key are encrypted server-side. They are never
 * returned after saving, so this page only ever shows configured/verified state
 * and empty inputs. The OpenAI key is centrally managed by the admin and is
 * never shown, requested, or referenced here as something a user supplies.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, badge, notice, toast, field, val,
  setLoading, setFieldError, clearFieldErrors, confirmModal,
} from '../ui.js';

function statusRow(status) {
  const configured = Boolean(status?.configured);
  const verified = Boolean(status?.verified);
  const bits = [
    badge(configured ? 'Credentials saved' : 'Not configured', configured ? 'ok' : 'warn'),
    badge(verified ? 'Verified' : 'Not verified', verified ? 'ok' : 'warn'),
  ];
  // maskedUserId is the only credential-derived value the API ever returns.
  if (status?.maskedUserId) bits.push(el('span', { className: 'card-sub', text: status.maskedUserId }));
  return el('div', { className: 'row', attrs: { style: 'gap:.5rem' } }, bits);
}

export async function render(root, ctx) {
  const [statusRes, capsRes] = await Promise.all([
    api.apiRequest('/api/integrations/hcti'),
    api.apiRequest('/api/posts/capabilities'),
  ]);
  if (statusRes.unauthorized || capsRes.unauthorized) { ctx.navigate('/login'); return; }

  let status = api.payload(statusRes) || {};
  const caps = api.payload(capsRes) || {};

  const statusHost = el('div', {}, [statusRow(status)]);
  const saveBtn = el('button', { className: 'btn btn-primary', text: 'Save credentials', attrs: { type: 'button' } });
  const testBtn = el('button', { className: 'btn btn-secondary', text: 'Test connection', attrs: { type: 'button' } });
  const removeBtn = el('button', { className: 'btn btn-danger', text: 'Remove', attrs: { type: 'button' } });
  const resultHost = el('div', {});

  function refresh(next) {
    if (next) status = { ...status, ...next };
    statusHost.textContent = '';
    statusHost.appendChild(statusRow(status));
    removeBtn.hidden = !status.configured;
  }

  saveBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    resultHost.textContent = '';
    const hctiUserId = val('hctiUserId').trim();
    const hctiApiKey = val('hctiApiKey').trim();
    if (!hctiUserId) { setFieldError('hctiUserId', 'Enter your HCTI User ID'); document.getElementById('hctiUserId')?.focus(); return; }
    if (!hctiApiKey) { setFieldError('hctiApiKey', 'Enter your HCTI API Key'); document.getElementById('hctiApiKey')?.focus(); return; }

    setLoading(saveBtn, true, 'Saving…');
    try {
      const res = await api.apiRequest('/api/integrations/hcti', { method: 'PUT', body: { hctiUserId, hctiApiKey } });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        const errors = api.fieldErrors(res);
        for (const [f, message] of Object.entries(errors)) setFieldError(f, message);
        toast(api.errorMessage(res, 'Those credentials could not be saved.'), 'err');
        return;
      }
      // Clear the inputs immediately — plaintext credentials never linger.
      document.getElementById('hctiUserId').value = '';
      document.getElementById('hctiApiKey').value = '';
      refresh(api.payload(res));
      resultHost.appendChild(notice('Saved. Test the connection to verify the credentials work.', 'ok'));
      toast('Credentials saved and encrypted.', 'ok');
    } finally {
      setLoading(saveBtn, false);
    }
  });

  testBtn.addEventListener('click', async () => {
    resultHost.textContent = '';
    setLoading(testBtn, true, 'Testing…');
    try {
      const res = await api.apiRequest('/api/integrations/hcti/test', { method: 'POST' });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        resultHost.appendChild(notice(api.errorMessage(res, 'The test render failed. Check your credentials and try again.'), 'err'));
        return;
      }
      // A failed test is a 200 with success:false — the message is already safe.
      const body = api.payload(res) || {};
      refresh({ verified: Boolean(body.verified) });
      resultHost.appendChild(notice(
        body.message || (body.success ? 'HCTI responded successfully.' : 'The test render failed.'),
        body.success ? 'ok' : 'err',
      ));
      toast(body.success ? 'HCTI verified.' : 'HCTI could not be verified.', body.success ? 'ok' : 'err');
    } finally {
      setLoading(testBtn, false);
    }
  });

  removeBtn.addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Remove HCTI credentials?',
      message: 'Image generation stops working until you add credentials again. Your posts and drafts are not affected.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    // The API requires an explicit confirmation token on this destructive call.
    const res = await api.apiRequest('/api/integrations/hcti', { method: 'DELETE', body: { confirm: 'DELETE' } });
    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) { toast(api.errorMessage(res, 'The credentials could not be removed.'), 'err'); return; }
    refresh({ configured: false, verified: false, verifiedAt: null, maskedUserId: null });
    resultHost.textContent = '';
    toast('Credentials removed.', 'ok');
  });

  removeBtn.hidden = !status.configured;

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Integrations', 'Connect the services Cyflow uses to build your posts.'),
    card([
      el('div', { className: 'card-head' }, [
        el('span', { className: 'card-title', text: 'HTML/CSS to Image (HCTI)' }),
        statusHost,
      ]),
      el('p', { className: 'card-sub', text: 'Cyflow renders your branded images through your own HCTI account. Both values are encrypted before they are stored and are never shown again after saving.' }),
      el('div', { className: 'grid grid-2' }, [
        field({ id: 'hctiUserId', label: 'HCTI User ID', attrs: { autocomplete: 'off', spellcheck: 'false' } }),
        field({ id: 'hctiApiKey', label: 'HCTI API Key', type: 'password', attrs: { autocomplete: 'new-password' } }),
      ]),
      el('div', { className: 'row', attrs: { style: 'gap:.5rem' } }, [
        saveBtn, testBtn, el('span', { className: 'spacer' }), removeBtn,
      ]),
      resultHost,
      el('p', { className: 'hint', text: 'Find both values in your HCTI dashboard. Cyflow only uses them to render your images.' }),
    ]),
    card([
      el('div', { className: 'card-head' }, [
        el('span', { className: 'card-title', text: 'Caption generation' }),
        badge(caps.openai?.available ? 'Available' : 'Unavailable', caps.openai?.available ? 'ok' : 'warn'),
      ]),
      el('p', { className: 'card-sub', text: 'Captions are generated using Cyflow’s own managed provider account. There is nothing for you to configure, and Cyflow never asks you for an AI provider key.' }),
      typeof caps.generations?.usedToday === 'number'
        ? el('p', { className: 'hint', text: `Generations used today: ${caps.generations.usedToday} of ${caps.generations.dailyLimit}.` })
        : null,
    ]),
    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Social accounts' })]),
      el('p', { className: 'card-sub', text: 'Facebook Pages, Instagram Professional, and Threads are connected on the Connections page.' }),
      el('a', { className: 'btn btn-secondary btn-sm', text: 'Manage connections', attrs: { href: '/connections', 'data-link': '', style: 'margin-top:.6rem' } }),
    ]),
    notice('Cyflow does not publish to any provider yet. Connected accounts and scheduled posts are stored for a future publishing phase.', 'info'),
  ]));
}
