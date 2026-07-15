/**
 * Profile — the account details of the signed-in user.
 *
 * Passwords are only ever sent to the server; nothing is cached in the DOM,
 * localStorage, or sessionStorage. Inputs are cleared after a change.
 */

import * as api from '../api.js';
import {
  el, card, pageHead, notice, toast, field, val,
  setLoading, setFieldError, clearFieldErrors,
} from '../ui.js';

const TIMEZONES = (() => {
  try {
    const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return list.length ? list : ['UTC'];
  } catch {
    return ['UTC'];
  }
})();

export async function render(root, ctx) {
  const user = ctx.user || (await api.me());
  if (!user) { ctx.navigate('/login'); return; }

  // A datalist keeps the timezone field typable but guided.
  const tzList = el('datalist', { attrs: { id: 'tz-options' } },
    TIMEZONES.slice(0, 600).map((tz) => el('option', { attrs: { value: tz } })));

  const saveBtn = el('button', { className: 'btn btn-primary', text: 'Save profile', attrs: { type: 'button' } });
  const passwordBtn = el('button', { className: 'btn btn-primary', text: 'Change password', attrs: { type: 'button' } });

  saveBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    setLoading(saveBtn, true, 'Saving…');
    try {
      const res = await api.apiRequest('/api/auth/profile', {
        method: 'PATCH',
        body: { name: val('name').trim(), timezone: val('timezone').trim() },
      });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        const errors = api.fieldErrors(res);
        for (const [f, message] of Object.entries(errors)) setFieldError(f, message);
        toast(api.errorMessage(res, 'Your profile could not be saved.'), 'err');
        return;
      }
      const saved = api.payload(res)?.user;
      if (saved?.name) {
        const label = document.getElementById('nav-user-name');
        if (label) label.textContent = saved.name;
      }
      toast('Profile saved.', 'ok');
    } finally {
      setLoading(saveBtn, false);
    }
  });

  passwordBtn.addEventListener('click', async () => {
    clearFieldErrors(root);
    const currentPassword = val('currentPassword');
    const newPassword = val('newPassword');
    const confirmPassword = val('confirmPassword');
    if (!currentPassword) { setFieldError('currentPassword', 'Enter your current password'); document.getElementById('currentPassword')?.focus(); return; }
    if (newPassword !== confirmPassword) {
      setFieldError('confirmPassword', 'The two passwords do not match');
      document.getElementById('confirmPassword')?.focus();
      return;
    }
    setLoading(passwordBtn, true, 'Updating…');
    try {
      const res = await api.apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) {
        const errors = api.fieldErrors(res);
        for (const [f, message] of Object.entries(errors)) setFieldError(f, message);
        toast(api.errorMessage(res, 'Your password could not be changed.'), 'err');
        return;
      }
      for (const id of ['currentPassword', 'newPassword', 'confirmPassword']) {
        const node = document.getElementById(id);
        if (node) node.value = '';
      }
      toast('Password changed.', 'ok');
    } finally {
      setLoading(passwordBtn, false);
    }
  });

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Profile', 'Your account details.'),
    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Account' })]),
      el('div', { className: 'grid grid-2' }, [
        field({ id: 'name', label: 'Name', value: user.name || '' }),
        field({ id: 'email', label: 'Email', value: user.email || '', attrs: { disabled: true },
          hint: 'Contact support to change the email on your account.' }),
      ]),
      field({ id: 'timezone', label: 'Timezone', value: user.timezone || 'UTC',
        attrs: { list: 'tz-options', autocomplete: 'off' },
        hint: 'Used as the default when you schedule a post.' }),
      tzList,
      el('div', { className: 'row' }, [saveBtn]),
    ]),
    card([
      el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: 'Password' })]),
      el('p', { className: 'card-sub', text: 'Use at least 12 characters with upper case, lower case, and a number. Symbols and spaces are allowed.' }),
      field({ id: 'currentPassword', label: 'Current password', type: 'password', attrs: { autocomplete: 'current-password' } }),
      el('div', { className: 'grid grid-2' }, [
        field({ id: 'newPassword', label: 'New password', type: 'password', attrs: { autocomplete: 'new-password' } }),
        field({ id: 'confirmPassword', label: 'Confirm new password', type: 'password', attrs: { autocomplete: 'new-password' } }),
      ]),
      el('div', { className: 'row' }, [passwordBtn]),
    ]),
    notice('Cyflow stores your password only as a salted hash and can never show it back to you.', 'info'),
  ]));
}
