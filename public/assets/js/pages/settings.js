/**
 * Settings — workspace defaults and an honest account overview.
 *
 * The content defaults live on the business profile (the same record the Brand
 * page edits), so this page writes through the existing business-profile API
 * rather than inventing a second store.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, badge, notice, toast, field, selectField, val,
  setLoading, setFieldError, clearFieldErrors, formatDate,
} from '../ui.js';

const TONES = ['neutral', 'friendly', 'professional', 'playful', 'bold', 'informative'];

export async function render(root, ctx) {
  const [profile, state, capsRes] = await Promise.all([
    api.businessProfile(),
    api.onboardingState(),
    api.apiRequest('/api/posts/capabilities'),
  ]);
  if (capsRes.unauthorized) { ctx.navigate('/login'); return; }
  const caps = api.payload(capsRes) || {};

  const saveBtn = el('button', { className: 'btn btn-primary', text: 'Save defaults', attrs: { type: 'button' } });

  saveBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    setLoading(saveBtn, true, 'Saving…');
    try {
      const res = await api.apiRequest('/api/business-profile', {
        method: 'PUT',
        body: {
          defaultTone: val('defaultTone') || null,
          defaultLanguage: val('defaultLanguage').trim() || null,
          defaultCallToAction: val('defaultCallToAction').trim() || null,
        },
      });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        const errors = api.fieldErrors(res);
        for (const [f, message] of Object.entries(errors)) setFieldError(f, message);
        toast(api.errorMessage(res, 'Those defaults could not be saved.'), 'err');
        return;
      }
      toast('Defaults saved.', 'ok');
    } finally {
      setLoading(saveBtn, false);
    }
  });

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Settings', 'Defaults Cyflow applies when you create a new post.'),

    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Content defaults' })]),
      el('p', { className: 'card-sub', text: 'These prefill the Create Post form. You can override any of them per post.' }),
      el('div', { className: 'grid grid-3' }, [
        selectField({ id: 'defaultTone', label: 'Default tone', options: TONES, value: profile?.defaultTone || 'neutral' }),
        field({ id: 'defaultLanguage', label: 'Default language', value: profile?.defaultLanguage || '',
          hint: 'For example: English, Urdu, Spanish.' }),
        field({ id: 'defaultCallToAction', label: 'Default call to action', value: profile?.defaultCallToAction || '' }),
      ]),
      el('div', { className: 'row' }, [saveBtn]),
    ]),

    card([
      el('div', { className: 'card-head' }, [
        el('span', { className: 'card-title', text: 'Business setup' }),
        badge(state?.needsOnboarding ? 'Incomplete' : 'Complete', state?.needsOnboarding ? 'warn' : 'ok'),
      ]),
      el('p', { className: 'card-sub', text: profile?.businessName
        ? `Branding is applied from ${profile.businessName}.`
        : 'Add your business details so captions and images match your brand.' }),
      profile?.onboardingCompletedAt
        ? el('p', { className: 'hint', text: `Completed ${formatDate(profile.onboardingCompletedAt)}` })
        : null,
      el('div', { className: 'row', attrs: { style: 'gap:.5rem;margin-top:.6rem' } }, [
        el('a', { className: 'btn btn-secondary btn-sm', text: 'Edit brand', attrs: { href: '/brand', 'data-link': '' } }),
        state?.needsOnboarding
          ? el('a', { className: 'btn btn-primary btn-sm', text: 'Complete setup', attrs: { href: '/onboarding/business', 'data-link': '' } })
          : null,
      ]),
    ]),

    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Usage today' })]),
      typeof caps.generations?.usedToday === 'number'
        ? el('p', { text: `${caps.generations.usedToday} of ${caps.generations.dailyLimit} generations used in the last 24 hours.` })
        : el('p', { className: 'hint', text: 'Usage is unavailable right now.' }),
      el('p', { className: 'hint', text: 'Caption and image generations each count towards this limit.' }),
    ]),

    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Account' })]),
      el('p', { className: 'card-sub', text: 'Your name, email, timezone, and password live on the Profile page.' }),
      el('a', { className: 'btn btn-secondary btn-sm', text: 'Open profile', attrs: { href: '/profile', 'data-link': '', style: 'margin-top:.6rem' } }),
    ]),

    notice('Cyflow generates and schedules content. It does not publish to Facebook, Instagram, or Threads yet — that arrives in a later phase.', 'info'),
  ]));
}
