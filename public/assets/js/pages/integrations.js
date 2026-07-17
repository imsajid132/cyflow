/**
 * Integrations — the two credentials a customer supplies themselves.
 *
 * OpenAI API and HCTI. Both are encrypted server-side and neither is ever
 * returned after saving, so this page only ever shows configured/verified state
 * and empty inputs. A "replace" is typing a new value, never editing the old
 * one — the old one is not ours to hand back.
 *
 * Social accounts are deliberately NOT here. Those are authorised through OAuth
 * on Connections; these are secrets someone pastes. Putting "sign in with
 * Facebook" beside "paste your API key" teaches exactly the wrong habit.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, badge, notice, toast, field, selectField, val,
  setLoading, setFieldError, clearFieldErrors, confirmModal, formatDate,
} from '../ui.js';

/** Models a customer may pick. Mirrors OPENAI_MODELS; the server re-validates. */
const OPENAI_MODEL_OPTIONS = [
  { value: 'gpt-5-mini', label: 'GPT-5 mini (fast, lower cost)' },
  { value: 'gpt-5', label: 'GPT-5 (highest quality)' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
];

function statusRow(status) {
  const configured = Boolean(status?.configured);
  const verified = Boolean(status?.verified);
  const bits = [
    badge(configured ? 'Credentials saved' : 'Not configured', configured ? 'ok' : 'warn'),
    badge(verified ? 'Verified' : 'Not verified', verified ? 'ok' : 'warn'),
  ];
  // maskedUserId is the only credential-derived value the API ever returns.
  if (status?.maskedUserId) bits.push(el('span', { className: 'card-sub', text: status.maskedUserId }));
  // Same "last verified" affordance the OpenAI card carries, so the two cards
  // report their state identically.
  if (status?.verifiedAt) {
    bits.push(el('span', { className: 'card-sub', text: `Last verified ${formatDate(status.verifiedAt)}` }));
  }
  return el('div', { className: 'row', attrs: { style: 'gap:.5rem;flex-wrap:wrap' } }, bits);
}

/**
 * Saved and verified are DIFFERENT facts and are shown as different badges.
 *
 * A key that is stored but has never authenticated is not "connected", and
 * saying so would be the app claiming something it has not checked.
 */
function openAiStatusRow(status) {
  const configured = Boolean(status?.configured);
  const verified = Boolean(status?.verified);
  const bits = [
    badge(configured ? 'Key saved' : 'Not configured', configured ? 'ok' : 'warn'),
    badge(verified ? 'Verified' : 'Not verified', verified ? 'ok' : 'warn'),
  ];
  // The mask is the only credential-derived value the API ever returns.
  if (status?.maskedKey) {
    bits.push(el('span', { className: 'card-sub', attrs: { 'data-openai-mask': '' }, text: status.maskedKey }));
  }
  if (status?.verifiedAt) {
    bits.push(el('span', { className: 'card-sub', text: `Last verified ${formatDate(status.verifiedAt)}` }));
  }
  return el('div', { className: 'row', attrs: { style: 'gap:.5rem;flex-wrap:wrap' } }, bits);
}

export async function render(root, ctx) {
  const [statusRes, openAiRes] = await Promise.all([
    api.apiRequest('/api/integrations/hcti'),
    api.apiRequest('/api/integrations/openai'),
  ]);
  if (statusRes.unauthorized || openAiRes.unauthorized) { ctx.navigate('/login'); return; }

  let status = api.payload(statusRes) || {};
  let openAi = api.payload(openAiRes) || {};

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
    // Test only makes sense once something is stored — offering it on an empty
    // card is an action that can only fail. Mirrors the OpenAI card.
    testBtn.hidden = !status.configured;
    // Replacing, not editing: the stored credentials are never returned, so the
    // button says which action this is.
    saveBtn.textContent = status.configured ? 'Replace credentials' : 'Save credentials';
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
      // One feedback per action, in the toast — the OpenAI card's pattern.
      toast('Credentials saved. Test the connection to verify them.', 'ok');
    } finally {
      // setLoading restores the label it cached at load-start, which would undo
      // the Save->Replace flip refresh() just made; re-apply it after.
      setLoading(saveBtn, false);
      refresh();
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
      refresh({ verified: Boolean(body.verified), verifiedAt: body.verifiedAt ?? null });
      // One feedback per action: the inline result only, matching the OpenAI card.
      resultHost.appendChild(notice(
        body.message || (body.success ? 'HCTI responded successfully.' : 'The test render failed.'),
        body.success ? 'ok' : 'err',
      ));
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
    resultHost.textContent = '';
    setLoading(removeBtn, true, 'Removing…');
    try {
      // The API requires an explicit confirmation token on this destructive call.
      const res = await api.apiRequest('/api/integrations/hcti', { method: 'DELETE', body: { confirm: 'DELETE' } });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) { toast(api.errorMessage(res, 'The credentials could not be removed.'), 'err'); return; }
      refresh({ configured: false, verified: false, verifiedAt: null, maskedUserId: null });
      toast('Credentials removed.', 'ok');
    } finally {
      setLoading(removeBtn, false);
    }
  });

  // Set the initial button/label state the same way the OpenAI card does.
  refresh();

  // --- OpenAI API ----------------------------------------------------------
  //
  // The card that replaced "Post copy generation", which used to say Cyflow
  // "never asks you for an AI provider key" and that there was "nothing for you
  // to configure". That was true of a design where one application key served
  // every customer — the design C1 removed. The key is the customer's now, and
  // this is where they put it.

  const aiStatusHost = el('div', {}, [openAiStatusRow(openAi)]);
  const aiSaveBtn = el('button', { className: 'btn btn-primary', text: 'Save key', attrs: { type: 'button' } });
  const aiTestBtn = el('button', { className: 'btn btn-secondary', text: 'Test connection', attrs: { type: 'button' } });
  const aiRemoveBtn = el('button', { className: 'btn btn-danger', text: 'Remove', attrs: { type: 'button' } });
  const aiResultHost = el('div', {});
  const modelSelect = selectField({
    id: 'openaiModel',
    label: 'Model',
    options: OPENAI_MODEL_OPTIONS,
    value: openAi.model || OPENAI_MODEL_OPTIONS[0].value,
  });

  function refreshAi(next) {
    if (next) openAi = { ...openAi, ...next };
    aiStatusHost.textContent = '';
    aiStatusHost.appendChild(openAiStatusRow(openAi));
    aiRemoveBtn.hidden = !openAi.configured;
    aiTestBtn.hidden = !openAi.configured;
    // Replacing, not editing: the stored key is never put back in the box, so
    // the label has to say which action this is.
    aiSaveBtn.textContent = openAi.configured ? 'Replace key' : 'Save key';
  }

  aiSaveBtn.addEventListener('click', async () => {
    if (aiSaveBtn.disabled) return;
    clearFieldErrors(root);
    aiResultHost.textContent = '';
    const apiKey = val('openaiApiKey').trim();
    if (!apiKey) {
      setFieldError('openaiApiKey', 'Enter your OpenAI API key');
      document.getElementById('openaiApiKey')?.focus();
      return;
    }
    setLoading(aiSaveBtn, true, 'Saving…');
    try {
      const res = await api.apiRequest('/api/integrations/openai', {
        method: 'PUT',
        body: { apiKey, model: val('openaiModel') || null },
      });
      if (!res.ok) {
        aiResultHost.appendChild(notice(api.errorMessage(res, 'That key could not be saved.'), 'err'));
        return;
      }
      // Clear the input immediately. The key is not ours to keep in the DOM.
      document.getElementById('openaiApiKey').value = '';
      refreshAi(api.payload(res));
      toast('OpenAI API key saved. Test the connection to verify it.', 'ok');
    } finally {
      setLoading(aiSaveBtn, false);
      refreshAi();
    }
  });

  aiTestBtn.addEventListener('click', async () => {
    if (aiTestBtn.disabled) return;
    aiResultHost.textContent = '';
    setLoading(aiTestBtn, true, 'Testing…');
    try {
      const res = await api.apiRequest('/api/integrations/openai/test', { method: 'POST' });
      if (!res.ok) {
        aiResultHost.appendChild(notice(api.errorMessage(res, 'The key could not be tested.'), 'err'));
        return;
      }
      const body = api.payload(res);
      refreshAi({ verified: body.verified, verifiedAt: body.verifiedAt ?? null });
      aiResultHost.appendChild(notice(body.message, body.success ? 'ok' : 'err'));
    } finally {
      setLoading(aiTestBtn, false);
    }
  });

  aiRemoveBtn.addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Remove your OpenAI API key?',
      message: 'Cyflow will stop generating new post copy until you add a key again. Your existing plans and posts are not affected.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    aiResultHost.textContent = '';
    setLoading(aiRemoveBtn, true, 'Removing…');
    try {
      const res = await api.apiRequest('/api/integrations/openai', { method: 'DELETE', body: { confirm: 'DELETE' } });
      if (!res.ok) {
        aiResultHost.appendChild(notice(api.errorMessage(res, 'The key could not be removed.'), 'err'));
        return;
      }
      refreshAi(api.payload(res));
      toast('OpenAI API key removed.', 'ok');
    } finally {
      setLoading(aiRemoveBtn, false);
    }
  });

  const openAiCard = card([
    el('div', { className: 'card-head' }, [
      el('span', { className: 'card-title', text: 'OpenAI API' }),
      aiStatusHost,
    ]),
  ]);
  // Both cards carry a "Test connection" and a "Remove". Naming the card is what
  // lets a test — or an assistive technology — tell them apart.
  openAiCard.setAttribute('data-integration', 'openai');
  openAiCard.append(...[
    el('p', { className: 'card-sub', text: 'Cyflow writes your post copy through your own OpenAI API account. Your key is encrypted before it is stored and is never shown again after saving.' }),
    el('div', { className: 'grid grid-2' }, [
      // Always empty. The stored key is never returned by the API and is never
      // put back into this box — "replace" means type a new one.
      field({
        id: 'openaiApiKey',
        label: openAi.configured ? 'New OpenAI API key' : 'OpenAI API key',
        type: 'password',
        attrs: { autocomplete: 'new-password', spellcheck: 'false', placeholder: 'sk-…' },
      }),
      modelSelect,
    ]),
    el('div', { className: 'row', attrs: { style: 'gap:.5rem' } }, [
      aiSaveBtn, aiTestBtn, el('span', { className: 'spacer' }), aiRemoveBtn,
    ]),
    aiResultHost,
    /*
     * The billing sentence, verbatim and deliberately prominent.
     *
     * The single most likely misunderstanding is "I pay for ChatGPT, so this is
     * covered". It is not: they are separate products with separate billing, and
     * a customer who learns that from a surprise invoice learns it the worst way.
     *
     * Nothing here claims a balance, a credit total or a limit — the API does not
     * tell us any of that, and inventing it would be a lie about someone's money.
     */
    notice('ChatGPT subscriptions and OpenAI API billing are separate. Cyflow AI requests are billed to your OpenAI API account.', 'info'),
    el('p', { className: 'hint', text: 'Create a key at platform.openai.com under API keys. Cyflow uses it only to write your posts.' }),
  ]);
  refreshAi();

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Integrations', 'Connect the services Cyflow uses to build your posts.'),
    card([
      el('div', { className: 'card-head' }, [
        el('span', { className: 'card-title', text: 'HTML/CSS to Image (HCTI)' }),
        statusHost,
      ]),
      el('p', { className: 'card-sub', text: 'Cyflow renders your branded images through your own HCTI account. Both values are encrypted before they are stored and are never shown again after saving.' }),
      el('div', { className: 'grid grid-2' }, [
        // Always empty; "replace" means typing new values. The label says so when
        // credentials already exist, mirroring the OpenAI card.
        field({ id: 'hctiUserId', label: status.configured ? 'New HCTI User ID' : 'HCTI User ID', attrs: { autocomplete: 'off', spellcheck: 'false' } }),
        field({ id: 'hctiApiKey', label: status.configured ? 'New HCTI API Key' : 'HCTI API Key', type: 'password', attrs: { autocomplete: 'new-password' } }),
      ]),
      el('div', { className: 'row', attrs: { style: 'gap:.5rem' } }, [
        saveBtn, testBtn, el('span', { className: 'spacer' }), removeBtn,
      ]),
      resultHost,
      el('p', { className: 'hint', text: 'Find both values in your HCTI dashboard. Cyflow only uses them to render your images.' }),
    ]),
    openAiCard,
    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Social accounts' })]),
      el('p', { className: 'card-sub', text: 'Facebook Pages, Instagram Professional, and Threads are connected on the Connections page.' }),
      el('a', { className: 'btn btn-secondary btn-sm', text: 'Manage connections', attrs: { href: '/connections', 'data-link': '', style: 'margin-top:.6rem' } }),
    ]),
    notice('Cyflow does not publish to any provider yet. Connected accounts and scheduled posts are stored for a future publishing phase.', 'info'),
  ]));
}
