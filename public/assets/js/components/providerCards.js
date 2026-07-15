/**
 * Shared provider connection cards (onboarding step 3 + /connections).
 *
 * Renders Facebook Pages / Instagram Professional / Threads cards with locally
 * authored SVG icons, availability, connected accounts (multiple Pages shown
 * cleanly), and Verify / Disconnect actions.
 *
 * OAuth navigation is restricted to the known provider hosts — an unexpected
 * authorization host aborts the connect instead of navigating.
 */

import * as api from '../api.js';
import { el, badge, statusTone, toast, confirmModal, setLoading, formatDate } from '../ui.js';
import { providerIcon, PROVIDER_LABELS } from '../icons.js';

const PROVIDER_HOSTS = { meta: 'www.facebook.com', instagram: 'www.instagram.com', threads: 'threads.net' };
const BLURB = {
  meta: 'Publish to the Facebook Pages you manage. You can connect more than one Page.',
  instagram: 'Connect an Instagram Professional (Business or Creator) account.',
  threads: 'Connect your Threads profile.',
};

async function connect(provider, button) {
  setLoading(button, true, 'Connecting…');
  try {
    const res = await api.apiRequest(`/api/oauth/${provider}/start`, { method: 'POST', body: {} });
    if (res.unauthorized) { window.location.assign('/login'); return; }
    const url = api.payload(res)?.authorizationUrl;
    if (!url) { toast(api.errorMessage(res, 'Could not start the connection.'), 'err'); return; }

    // Validate the authorization host before leaving the app (no open redirect).
    let parsed;
    try { parsed = new URL(url); } catch { parsed = null; }
    if (!parsed || parsed.protocol !== 'https:' || parsed.hostname !== PROVIDER_HOSTS[provider]) {
      toast('Unexpected authorization address. Connection aborted.', 'err');
      return;
    }
    window.location.assign(url);
  } finally {
    setLoading(button, false);
  }
}

async function verify(id, button, reload) {
  setLoading(button, true, 'Verifying…');
  try {
    const res = await api.apiRequest(`/api/social-accounts/${encodeURIComponent(id)}/verify`, { method: 'POST', body: {} });
    if (res.unauthorized) { window.location.assign('/login'); return; }
    const data = api.payload(res);
    if (res.ok && data?.verified) toast('Account verified.', 'ok');
    else toast(api.errorMessage(res, 'Verification failed.'), 'err');
    await reload();
  } finally {
    setLoading(button, false);
  }
}

async function disconnect(account, button, reload) {
  const ok = await confirmModal({
    title: 'Disconnect account?',
    message: `Cyflow will remove its stored access for ${account.displayName || account.providerAccountId}. Your other connected accounts are unaffected.`,
    confirmText: 'Disconnect',
    danger: true,
  });
  if (!ok) return;
  setLoading(button, true, 'Disconnecting…');
  try {
    const res = await api.apiRequest(`/api/social-accounts/${encodeURIComponent(account.id)}`, {
      method: 'DELETE',
      body: { confirm: 'DISCONNECT' },
    });
    if (res.unauthorized) { window.location.assign('/login'); return; }
    toast(res.ok ? 'Account disconnected.' : api.errorMessage(res, 'Could not disconnect.'), res.ok ? 'ok' : 'err');
    await reload();
  } finally {
    setLoading(button, false);
  }
}

function accountRow(account, reload) {
  const verifyBtn = el('button', { className: 'btn btn-secondary btn-sm', text: 'Verify', attrs: { type: 'button' } });
  const disconnectBtn = el('button', { className: 'btn btn-danger btn-sm', text: 'Disconnect', attrs: { type: 'button' } });
  verifyBtn.addEventListener('click', () => verify(account.id, verifyBtn, reload));
  disconnectBtn.addEventListener('click', () => disconnect(account, disconnectBtn, reload));

  return el('div', { className: 'account-row' }, [
    el('div', {}, [
      el('div', { className: 'account-name', text: account.displayName || account.providerAccountId }),
      el('div', { className: 'account-meta', text: account.username ? `@${account.username}` : account.accountType.replace(/_/g, ' ') }),
      el('div', { className: 'account-meta', text: account.lastVerifiedAt ? `Last verified ${formatDate(account.lastVerifiedAt)}` : 'Not verified yet' }),
    ]),
    el('div', { className: 'row' }, [badge(account.status, statusTone(account.status)), verifyBtn, disconnectBtn]),
  ]);
}

function providerCard(provider, available, accounts, reload) {
  const mine = accounts.filter((a) => a.provider === provider);
  const connectBtn = el('button', {
    className: 'btn btn-primary btn-sm',
    text: mine.length ? 'Connect another' : 'Connect',
    attrs: { type: 'button', disabled: !available },
  });
  connectBtn.addEventListener('click', () => connect(provider, connectBtn));

  return el('div', { className: 'card' }, [
    el('div', { className: 'provider-head' }, [
      providerIcon(provider),
      el('div', {}, [
        el('div', { className: 'card-title', text: PROVIDER_LABELS[provider] }),
        el('div', { className: 'card-sub', text: BLURB[provider] }),
      ]),
    ]),
    el('div', { className: 'row', attrs: { style: 'margin-top:.8rem' } }, [
      badge(available ? 'Connection available' : 'Not configured', available ? 'ok' : 'warn'),
      el('span', { className: 'spacer' }),
      connectBtn,
    ]),
    mine.length
      ? el('div', { attrs: { style: 'margin-top:.6rem' } }, mine.map((a) => accountRow(a, reload)))
      : el('p', { className: 'hint', attrs: { style: 'margin-top:.6rem' }, text: available ? 'No accounts connected yet.' : 'This provider is not configured on the server.' }),
  ]);
}

/** Read `?oauth=…` from the URL, show a safe notice, then strip the params. */
export function consumeOAuthResult() {
  const params = new URLSearchParams(window.location.search);
  const oauth = params.get('oauth');
  if (!oauth) return;
  const provider = params.get('provider');
  const code = params.get('code');
  const label = PROVIDER_LABELS[provider] || 'account';
  if (oauth === 'success') {
    toast(`Connected ${label} successfully.`, 'ok');
  } else {
    // Never render a provider error string from the URL — map by safe code.
    const SAFE = {
      permission_denied: 'The connection was cancelled or not granted.',
      invalid_state: 'The connection could not be verified. Please try again.',
      expired_state: 'The connection request expired. Please try again.',
      provider_configuration_error: 'That provider is not configured.',
      no_publishable_account: 'No publishable account was found.',
      account_not_eligible: 'A professional/business account is required.',
    };
    toast(SAFE[code] || 'The connection could not be completed.', 'err');
  }
  window.history.replaceState({}, document.title, window.location.pathname);
}

/**
 * Render provider cards into `host`, reloading data itself.
 * @returns {Promise<{ accounts: object[], availability: object }>}
 */
export async function renderProviderCards(host) {
  async function reload() {
    const [provRes, accRes] = await Promise.all([
      api.apiRequest('/api/oauth/providers'),
      api.apiRequest('/api/social-accounts'),
    ]);
    if (provRes.unauthorized || accRes.unauthorized) { window.location.assign('/login'); return { accounts: [], availability: {} }; }
    const availability = api.payload(provRes)?.providers || {};
    const accounts = api.payload(accRes)?.accounts || [];

    host.textContent = '';
    host.appendChild(el('div', { className: 'grid grid-3' },
      ['meta', 'instagram', 'threads'].map((p) => providerCard(p, Boolean(availability[p]), accounts, reload)),
    ));
    return { accounts, availability };
  }
  return reload();
}

export default { renderProviderCards, consumeOAuthResult };
