/**
 * Onboarding wizard — 3 steps.
 *
 *  1. /onboarding/business    — analyze a website, or enter details manually
 *  2. /onboarding/brand       — review + edit everything before it is saved
 *  3. /onboarding/connections — connect Facebook / Instagram / Threads
 *
 * Website analysis is an EXPLICIT action; results are suggestions held in memory
 * until the user saves them. Nothing is re-crawled on refresh.
 */

import * as api from '../api.js';
import { el, card, steps, notice, toast, setLoading, val, setFieldError, clearFieldErrors } from '../ui.js';
import { buildBrandForm } from '../components/brandForm.js';
import { renderProviderCards, consumeOAuthResult } from '../components/providerCards.js';

// In-memory only (never sessionStorage) — suggestions from the last analysis.
let pendingSuggestions = null;

function wizard(children) {
  return el('div', { className: 'wizard' }, children);
}

// --- step 1 ---------------------------------------------------------------

function renderBusiness(root, ctx) {
  const errorHost = el('div', { attrs: { id: 'analyze-error' } });

  const analyzeBtn = el('button', { className: 'btn btn-primary', text: 'Analyze website', attrs: { type: 'button', id: 'analyze' } });
  const websiteCard = el('div', { className: 'choice' }, [
    el('h3', { text: 'Analyze my website' }),
    el('p', { text: 'We read a few public pages of your site to suggest your logo, colours, fonts, services, and contact details. You review and edit everything before anything is saved.' }),
    el('div', { className: 'field', attrs: { style: 'width:100%' } }, [
      el('label', { className: 'label', text: 'Website address', attrs: { for: 'websiteUrl' } }),
      el('input', { className: 'input', attrs: { id: 'websiteUrl', type: 'url', placeholder: 'yourbusiness.com', autocomplete: 'url' } }),
      el('p', { className: 'field-error', attrs: { id: 'websiteUrl-error', hidden: true } }),
    ]),
    analyzeBtn,
    el('p', { className: 'hint', text: 'Privacy: we fetch at most 4 public pages from your own domain over HTTPS, never sign in, never run scripts, and never store the page content.' }),
  ]);

  const manualBtn = el('button', { className: 'btn btn-secondary', text: 'Enter details manually', attrs: { type: 'button' } });
  manualBtn.addEventListener('click', () => {
    pendingSuggestions = null;
    ctx.navigate('/onboarding/brand');
  });
  const manualCard = el('div', { className: 'choice' }, [
    el('h3', { text: 'Enter details manually' }),
    el('p', { text: 'No website, or prefer to type it in? Fill in your business details yourself. You can analyze a website later from the Brand page.' }),
    el('span', { className: 'spacer' }),
    manualBtn,
  ]);

  analyzeBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    errorHost.textContent = '';
    const url = val('websiteUrl').trim();
    if (!url) {
      setFieldError('websiteUrl', 'Enter your website address');
      document.getElementById('websiteUrl')?.focus();
      return;
    }
    setLoading(analyzeBtn, true, 'Analyzing…');
    errorHost.appendChild(notice('Reading your website… this usually takes a few seconds.', 'info'));
    try {
      const res = await api.apiRequest('/api/business-profile/analyze-website', { method: 'POST', body: { websiteUrl: url } });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      errorHost.textContent = '';
      if (res.ok) {
        pendingSuggestions = api.payload(res)?.suggestions || null;
        toast('Website analyzed. Review the details below.', 'ok');
        ctx.navigate('/onboarding/brand');
        return;
      }
      // Safe message only — never a raw crawler error.
      errorHost.appendChild(notice(api.errorMessage(res, 'We could not analyze that website.'), 'err'));
      errorHost.appendChild(el('p', { className: 'hint', text: 'You can still continue and enter your details manually.' }));
    } finally {
      setLoading(analyzeBtn, false);
    }
  });

  root.appendChild(wizard([
    steps(1, 3, ['Business', 'Brand', 'Connections']),
    el('div', {}, [
      el('h1', { text: 'Set up your business' }),
      el('p', { className: 'sub', text: 'This personalises your captions and branded images. It takes about a minute.' }),
    ]),
    errorHost,
    el('div', { className: 'grid grid-2' }, [websiteCard, manualCard]),
  ]));
}

// --- step 2 ---------------------------------------------------------------

async function renderBrand(root, ctx) {
  const profile = await api.businessProfile();
  const form = buildBrandForm({ profile: profile || {}, suggestions: pendingSuggestions });

  const backBtn = el('button', { className: 'btn btn-ghost', text: 'Back', attrs: { type: 'button' } });
  backBtn.addEventListener('click', () => ctx.navigate('/onboarding/business'));

  const reanalyzeBtn = el('button', { className: 'btn btn-secondary', text: 'Re-analyze website', attrs: { type: 'button' } });
  reanalyzeBtn.addEventListener('click', () => ctx.navigate('/onboarding/business'));

  const saveBtn = el('button', { className: 'btn btn-primary', text: 'Save and continue', attrs: { type: 'button' } });
  saveBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    setLoading(saveBtn, true, 'Saving…');
    try {
      const patch = form.collect();
      // Explicit user review → these are the user's values (PUT), not raw
      // suggestions, so they are recorded as manual edits and never later
      // overwritten by another analysis.
      const res = await api.apiRequest('/api/business-profile', { method: 'PUT', body: patch });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (res.ok) {
        pendingSuggestions = null;
        toast('Business details saved.', 'ok');
        ctx.navigate('/onboarding/connections');
        return;
      }
      const errors = api.fieldErrors(res);
      let first = null;
      for (const [f, message] of Object.entries(errors)) {
        setFieldError(f, message);
        if (!first) first = f;
      }
      if (first) document.getElementById(first)?.focus();
      toast(api.errorMessage(res, 'Please check the highlighted fields.'), 'err');
    } finally {
      setLoading(saveBtn, false);
    }
  });

  root.appendChild(wizard([
    steps(2, 3, ['Business', 'Brand', 'Connections']),
    el('div', {}, [
      el('h1', { text: 'Review your brand' }),
      el('p', { className: 'sub', text: pendingSuggestions ? 'We found these details on your website. Edit anything that is not right — nothing is saved until you continue.' : 'Fill in your business details. You can change any of this later on the Brand page.' }),
    ]),
    pendingSuggestions ? notice('Suggested values are marked “extracted”. Your edits always win over future website analyses.', 'info') : null,
    form.node,
    el('div', { className: 'row' }, [backBtn, pendingSuggestions ? reanalyzeBtn : null, el('span', { className: 'spacer' }), saveBtn]),
  ]));
}

// --- step 3 ---------------------------------------------------------------

async function renderConnections(root, ctx) {
  consumeOAuthResult();
  const host = el('div', {});

  async function finish(skip) {
    const res = await api.apiRequest('/api/business-profile/complete-onboarding', { method: 'POST', body: {} });
    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (res.ok) {
      toast(skip ? 'Setup saved. You can connect accounts any time.' : 'You’re all set.', 'ok');
      ctx.navigate('/dashboard');
    } else {
      toast(api.errorMessage(res, 'Could not finish setup.'), 'err');
    }
  }

  const backBtn = el('button', { className: 'btn btn-ghost', text: 'Back', attrs: { type: 'button' } });
  backBtn.addEventListener('click', () => ctx.navigate('/onboarding/brand'));
  const skipBtn = el('button', { className: 'btn btn-secondary', text: 'Skip for now', attrs: { type: 'button' } });
  skipBtn.addEventListener('click', () => finish(true));
  const continueBtn = el('button', { className: 'btn btn-primary', text: 'Continue to dashboard', attrs: { type: 'button' } });
  continueBtn.addEventListener('click', () => finish(false));

  root.appendChild(wizard([
    steps(3, 3, ['Business', 'Brand', 'Connections']),
    el('div', {}, [
      el('h1', { text: 'Connect your accounts' }),
      el('p', { className: 'sub', text: 'Connect the accounts you want to post to. You can connect more than one Facebook Page, and you can do this later.' }),
    ]),
    host,
    el('div', { className: 'row' }, [backBtn, el('span', { className: 'spacer' }), skipBtn, continueBtn]),
  ]));

  await renderProviderCards(host);
}

export async function render(root, ctx) {
  if (ctx.view === 'brand') return renderBrand(root, ctx);
  if (ctx.view === 'connections') return renderConnections(root, ctx);
  return renderBusiness(root, ctx);
}
