/**
 * Brand page — full business-profile editing with a live preview.
 *
 * "Analyze website again" is a controlled action: it returns SUGGESTIONS which
 * are shown for review. It never silently replaces values the user typed.
 */

import * as api from '../api.js';
import { el, card, pageHead, notice, toast, setLoading, setFieldError, clearFieldErrors, confirmModal } from '../ui.js';
import { buildBrandForm } from '../components/brandForm.js';

function preview(profile) {
  /*
   * Neutral fallbacks, never invented brand hues.
   *
   * This preview used to fall back to #4f46e5 and #0ea5e9 (the app's old indigo
   * and a sky blue), so a business that had saved no colours was shown a
   * purple-to-blue gradient labelled as THEIR brand. That is the opposite of
   * what this page is for, and blue and purple are exactly the hues the creative
   * rules forbid introducing.
   */
  const primary = profile.primaryColor || '#111827';
  const accent = profile.accentColor || '#374151';
  return el('div', { className: 'brand-preview' }, [
    el('div', {
      className: 'brand-preview-head',
      attrs: { style: `background:linear-gradient(135deg, ${primary} 0%, ${accent} 100%)` },
    }, [
      profile.logoUrl ? el('img', { className: 'brand-preview-logo', attrs: { src: profile.logoUrl, alt: '' } }) : null,
      el('div', {}, [
        el('div', { text: profile.businessName || 'Your business', attrs: { style: 'font-weight:700;font-size:1.05rem' } }),
        el('div', { text: profile.businessCategory || '', attrs: { style: 'font-size:.8rem;opacity:.9' } }),
      ]),
    ]),
    el('div', { className: 'brand-preview-body' }, [
      el('p', { className: 'card-sub', text: profile.businessDescription || 'Your business description will appear here.' }),
      el('div', { className: 'row', attrs: { style: 'margin-top:.6rem' } }, [
        el('span', { className: 'swatch', attrs: { style: `background:${primary};width:34px` }, title: primary }),
        el('span', { className: 'swatch', attrs: { style: `background:${profile.secondaryColor || '#64748b'};width:34px` } }),
        el('span', { className: 'swatch', attrs: { style: `background:${accent};width:34px` } }),
        el('span', { className: 'spacer' }),
        el('span', { className: 'card-sub', text: [profile.headingFont, profile.bodyFont].filter(Boolean).join(' / ') || 'Default fonts' }),
      ]),
    ]),
  ]);
}

export async function render(root, ctx) {
  const profile = (await api.businessProfile()) || {};
  let suggestions = null;

  const previewHost = el('div', {}, [preview(profile)]);
  const formHost = el('div', {});
  let form = buildBrandForm({ profile });
  formHost.appendChild(form.node);

  const saveBtn = el('button', { className: 'btn btn-primary', text: 'Save changes', attrs: { type: 'button' } });
  const analyzeBtn = el('button', { className: 'btn btn-secondary', text: 'Analyze website again', attrs: { type: 'button' } });
  const suggestionHost = el('div', {});

  saveBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    setLoading(saveBtn, true, 'Saving…');
    try {
      const patch = form.collect();
      const res = await api.apiRequest('/api/business-profile', { method: 'PUT', body: patch });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (res.ok) {
        const saved = api.payload(res)?.profile || {};
        previewHost.textContent = '';
        previewHost.appendChild(preview(saved));
        toast('Brand saved.', 'ok');
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

  analyzeBtn.addEventListener('click', async () => {
    const website = document.getElementById('websiteUrl')?.value?.trim();
    if (!website) {
      setFieldError('websiteUrl', 'Add your website address first');
      document.getElementById('websiteUrl')?.focus();
      return;
    }
    const ok = await confirmModal({
      title: 'Analyze website again?',
      message: 'This returns fresh suggestions from your website. Anything you have edited by hand is kept — suggestions never overwrite your edits automatically.',
      confirmText: 'Analyze',
    });
    if (!ok) return;

    setLoading(analyzeBtn, true, 'Analyzing…');
    suggestionHost.textContent = '';
    try {
      const res = await api.apiRequest('/api/business-profile/analyze-website', { method: 'POST', body: { websiteUrl: website } });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        suggestionHost.appendChild(notice(api.errorMessage(res, 'We could not analyze that website.'), 'err'));
        return;
      }
      suggestions = api.payload(res)?.suggestions || null;
      // Re-render the form with suggestions marked, without discarding the
      // saved profile values (profile wins; suggestions only fill blanks).
      const current = (await api.businessProfile()) || {};
      formHost.textContent = '';
      form = buildBrandForm({ profile: current, suggestions });
      formHost.appendChild(form.node);
      suggestionHost.appendChild(notice('Fresh suggestions loaded and marked “extracted”. Review them, then Save changes. Your existing values were kept.', 'info'));
      toast('Website analyzed — review the suggestions.', 'ok');
    } finally {
      setLoading(analyzeBtn, false);
    }
  });

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Brand', 'Your business identity powers captions and branded images.', [analyzeBtn, saveBtn]),
    suggestionHost,
    el('div', { className: 'grid', attrs: { style: 'grid-template-columns:minmax(0,2fr) minmax(0,1fr)' } }, [
      formHost,
      el('div', { className: 'stack' }, [
        card([el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Live preview' })]), previewHost]),
        card([
          el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Social post style' })]),
          el('p', { className: 'card-sub', text: 'Generated images use your logo, colours, and fonts with the template you pick on the Create Post page.' }),
          el('a', { className: 'btn btn-secondary btn-sm', text: 'Create a post', attrs: { href: '/create', 'data-link': '', style: 'margin-top:.6rem' } }),
        ]),
      ]),
    ]),
  ]));
}
