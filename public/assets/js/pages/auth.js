/**
 * Login + Register pages.
 *
 * After success the session is rotated server-side, so the cached CSRF token is
 * refreshed, then onboarding state decides where the user lands. No password or
 * token ever touches browser storage.
 */

import * as api from '../api.js';
import { el, card, field, setFieldError, clearFieldErrors, val, setLoading, toast } from '../ui.js';
import { postAuthRedirect } from '../router.js';

function timezones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch { /* fall through */ }
  return ['UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
}
function detectedTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/**
 * What the product actually does, in the user's terms.
 *
 * Every line here is a real, implemented capability. There are no customer
 * counts, no testimonials and no statistics, because we have none: inventing
 * social proof on a sign-in page is the same dishonesty the content engine
 * refuses to commit on a customer's behalf.
 */
const VALUE_POINTS = Object.freeze([
  { title: 'A week of posts, planned by weekday', body: 'Monday teaches, Friday gives practical tips, Sunday recaps. You can change any day.' },
  { title: 'Written per platform, not copy-pasted', body: 'Your Facebook, Instagram and Threads posts are written separately, from the same brief.' },
  { title: 'Your brand, on every image', body: 'Your saved colours, your logo, your fonts. Rendered at 1080 and ready to review.' },
]);

/**
 * The brand panel beside the form.
 *
 * A restrained field with a faint grid, the app mark, and three honest points.
 * The composition is CSS: no illustration is fetched, nothing animates, and it
 * collapses away entirely on mobile so a phone shows the form, not decoration.
 */
function brandPanel() {
  return el('aside', { className: 'auth-brand', attrs: { 'aria-hidden': 'true' } }, [
    el('div', { className: 'auth-brand-grid' }),
    el('div', { className: 'auth-brand-inner' }, [
      el('div', { className: 'auth-brand-lockup' }, [
        el('img', { attrs: { src: '/assets/brand/cyflow-mark-192.png', alt: '', width: 40, height: 40 } }),
        el('span', { text: 'Cyflow Social' }),
      ]),
      el('p', { className: 'auth-brand-lede', text: 'Plan a week of social posts that sound like your business wrote them.' }),
      el('ul', { className: 'auth-points' }, VALUE_POINTS.map((point) => el('li', {}, [
        el('span', { className: 'auth-point-tick', attrs: { 'aria-hidden': 'true' } }),
        el('div', {}, [
          el('span', { className: 'auth-point-title', text: point.title }),
          el('span', { className: 'auth-point-body', text: point.body }),
        ]),
      ]))),
    ]),
  ]);
}

function shell(title, subtitle, form, footer) {
  return el('div', { className: 'auth-split' }, [
    brandPanel(),
    el('div', { className: 'auth-card' }, [
      card([
        el('div', { className: 'stack' }, [
          // The Cyflow APPLICATION mark. Correct here: this is app chrome.
          // On mobile the brand panel is gone, so this is the only mark shown.
          el('div', { className: 'row auth-mark', attrs: { style: 'gap:.6rem' } }, [
            el('img', { attrs: { src: '/assets/brand/cyflow-mark-64.png', alt: '', width: 28, height: 28 } }),
            el('span', { text: 'Cyflow Social', attrs: { style: 'font-weight:700' } }),
          ]),
          el('div', {}, [el('h1', { text: title }), el('p', { className: 'sub', text: subtitle })]),
          el('div', { className: 'field-error', attrs: { id: 'form-error', role: 'alert', hidden: true } }),
          form,
          footer,
          el('p', {
            className: 'auth-reassure',
            text: 'Your password is hashed and your session stays on this device. Cyflow never posts anything without your say-so.',
          }),
        ]),
      ]),
    ]),
  ]);
}

function showFormError(message) {
  const node = document.getElementById('form-error');
  if (!node) return;
  node.textContent = message || '';
  node.hidden = !message;
}

function applyFieldErrors(result) {
  const errors = api.fieldErrors(result);
  let first = null;
  for (const [f, message] of Object.entries(errors)) {
    const id = { name: 'name', email: 'email', password: 'password', timezone: 'timezone' }[f];
    if (id) {
      setFieldError(id, message);
      if (!first) first = id;
    }
  }
  if (first) document.getElementById(first)?.focus();
  return Object.keys(errors).length > 0;
}

function renderLogin(root) {
  const form = el('form', { className: 'stack', attrs: { novalidate: true } }, [
    field({ id: 'email', label: 'Email', type: 'email', attrs: { autocomplete: 'email', required: true } }),
    field({ id: 'password', label: 'Password', type: 'password', attrs: { autocomplete: 'current-password', required: true } }),
    el('button', { className: 'btn btn-primary btn-block', text: 'Sign in', attrs: { type: 'submit', id: 'submit' } }),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    showFormError('');
    const btn = document.getElementById('submit');
    setLoading(btn, true, 'Signing in…');
    try {
      const res = await api.apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: val('email'), password: val('password') },
      });
      if (res.ok) {
        api.clearCachedCsrfToken(); // session rotated
        await api.getCsrfToken({ forceRefresh: true });
        await postAuthRedirect();
        return;
      }
      if (!applyFieldErrors(res)) showFormError(api.errorMessage(res, 'Invalid email or password.'));
    } finally {
      setLoading(btn, false);
    }
  });

  root.appendChild(
    shell('Welcome back', 'Sign in to manage your social content.', form,
      el('p', { className: 'hint' }, [
        'New to Cyflow? ',
        el('a', { text: 'Create an account', attrs: { href: '/register', 'data-link': '' } }),
      ]),
    ),
  );
}

function renderRegister(root) {
  const zones = timezones();
  const detected = detectedTimezone();
  const tzSelect = el('select', { className: 'select', attrs: { id: 'timezone', name: 'timezone' } },
    (zones.includes(detected) ? zones : [detected, ...zones]).map((z) => {
      const o = el('option', { text: z, attrs: { value: z } });
      if (z === detected) o.selected = true;
      return o;
    }),
  );

  const form = el('form', { className: 'stack', attrs: { novalidate: true } }, [
    field({ id: 'name', label: 'Your name', attrs: { autocomplete: 'name', required: true } }),
    field({ id: 'email', label: 'Email', type: 'email', attrs: { autocomplete: 'email', required: true } }),
    el('div', { className: 'field' }, [
      el('label', { className: 'label', text: 'Timezone', attrs: { for: 'timezone' } }),
      tzSelect,
      el('p', { className: 'hint', text: 'Used to schedule posts in your local time.' }),
      el('p', { className: 'field-error', attrs: { id: 'timezone-error', hidden: true } }),
    ]),
    field({
      id: 'password', label: 'Password', type: 'password',
      hint: 'At least 12 characters, with an uppercase letter, a lowercase letter, and a number.',
      attrs: { autocomplete: 'new-password', required: true },
    }),
    el('button', { className: 'btn btn-primary btn-block', text: 'Create account', attrs: { type: 'submit', id: 'submit' } }),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    showFormError('');
    const btn = document.getElementById('submit');
    setLoading(btn, true, 'Creating account…');
    try {
      const res = await api.apiRequest('/api/auth/register', {
        method: 'POST',
        body: { name: val('name'), email: val('email'), password: val('password'), timezone: val('timezone') },
      });
      if (res.ok) {
        api.clearCachedCsrfToken(); // session rotated
        await api.getCsrfToken({ forceRefresh: true });
        toast('Account created. Let’s set up your business.', 'ok');
        await postAuthRedirect();
        return;
      }
      if (!applyFieldErrors(res)) showFormError(api.errorMessage(res, 'Could not create your account.'));
    } finally {
      setLoading(btn, false);
    }
  });

  root.appendChild(
    shell('Create your account', 'Set up Cyflow Social for your business.', form,
      el('p', { className: 'hint' }, [
        'Already have an account? ',
        el('a', { text: 'Sign in', attrs: { href: '/login', 'data-link': '' } }),
      ]),
    ),
  );
}

export async function render(root, ctx) {
  if (ctx.view === 'register') renderRegister(root);
  else renderLogin(root);
}
