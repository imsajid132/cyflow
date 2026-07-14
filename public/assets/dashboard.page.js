/**
 * Dashboard behavior: auth guard, profile + password, and functional HCTI
 * settings. All requests go through the shared CyflowSocial API helper. No
 * secrets are stored client-side or logged; HCTI credentials are never
 * prefilled and inputs are cleared after a successful save.
 */

(function () {
  'use strict';

  var App = window.CyflowSocial;

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // --- timezone helpers -----------------------------------------------------
  function detectTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }
  function supportedTimezones() {
    try {
      if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
    } catch (e) { /* fall through */ }
    return ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London',
      'Europe/Paris', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo',
      'Australia/Sydney'];
  }
  function fillTimezoneSelect(select, selected) {
    if (!select) return;
    var zones = supportedTimezones();
    var current = selected || detectTimezone();
    if (zones.indexOf(current) === -1) zones = [current].concat(zones);
    select.textContent = '';
    zones.forEach(function (zone) {
      var opt = document.createElement('option');
      opt.value = zone;
      opt.textContent = zone;
      if (zone === current) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      var d = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
      if (isNaN(d.getTime())) return String(value);
      return d.toLocaleString();
    } catch (e) {
      return String(value);
    }
  }

  // --- HCTI status ----------------------------------------------------------
  function renderHctiStatus(status) {
    var configured = !!(status && status.configured);
    var verified = !!(status && status.verified);
    App.setStatusPill('hcti-configured', configured ? 'Configured' : 'Not configured', configured ? 'ok' : 'warn');
    App.setStatusPill('hcti-verified', verified ? 'Verified' : 'Not verified', verified ? 'ok' : 'warn');
    App.setText('hcti-masked', (status && status.maskedUserId) || '—');
    App.setText('hcti-verified-at', status && status.verifiedAt ? formatDate(status.verifiedAt) : '—');

    var testBtn = document.getElementById('hcti-test');
    var delBtn = document.getElementById('hcti-delete');
    if (testBtn) testBtn.disabled = !configured;
    if (delBtn) delBtn.disabled = !configured;
  }

  async function loadHctiStatus() {
    var res = await App.apiRequest('/api/integrations/hcti');
    if (res.unauthorized) return App.handleUnauthorized();
    if (res.ok && res.data && res.data.data) renderHctiStatus(res.data.data);
  }

  async function handleHctiSave(e) {
    e.preventDefault();
    var notice = document.getElementById('hcti-notice');
    var btn = document.getElementById('hcti-save');
    var userInput = document.getElementById('hcti-user');
    var keyInput = document.getElementById('hcti-key');
    App.createSafeNotice(notice, '', 'info');

    if (!userInput.value || !keyInput.value) {
      App.createSafeNotice(notice, 'Enter both your HCTI User ID and API Key.', 'error');
      return;
    }
    App.setButtonLoading(btn, true, 'Saving…');
    try {
      var res = await App.apiRequest('/api/integrations/hcti', {
        method: 'PUT',
        body: { hctiUserId: userInput.value, hctiApiKey: keyInput.value },
      });
      if (res.unauthorized) return App.handleUnauthorized();
      if (res.ok) {
        // Clear inputs after a successful save — never keep credentials around.
        userInput.value = '';
        keyInput.value = '';
        App.createSafeNotice(notice, 'Credentials saved and encrypted. Test them to verify.', 'success');
        if (res.data && res.data.data) renderHctiStatus(res.data.data);
        loadHctiStatus();
      } else {
        App.createSafeNotice(notice, App.errorMessage(res, 'Could not save credentials.'), 'error');
      }
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  async function handleHctiTest() {
    var notice = document.getElementById('hcti-notice');
    var btn = document.getElementById('hcti-test');
    App.createSafeNotice(notice, '', 'info');
    App.setButtonLoading(btn, true, 'Testing…');
    try {
      var res = await App.apiRequest('/api/integrations/hcti/test', { method: 'POST', body: {} });
      if (res.unauthorized) return App.handleUnauthorized();
      var payload = res.data && res.data.data;
      if (res.ok && payload && payload.success) {
        App.createSafeNotice(notice, payload.message || 'Credentials verified.', 'success');
      } else {
        var msg = (payload && payload.message) || App.errorMessage(res, 'Credential test failed.');
        App.createSafeNotice(notice, msg, 'error');
      }
      loadHctiStatus();
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  async function handleHctiDelete() {
    var notice = document.getElementById('hcti-notice');
    var btn = document.getElementById('hcti-delete');
    if (!window.confirm('Delete your HCTI credentials? This cannot be undone.')) return;
    App.setButtonLoading(btn, true, 'Deleting…');
    try {
      var res = await App.apiRequest('/api/integrations/hcti', {
        method: 'DELETE',
        body: { confirm: 'DELETE' },
      });
      if (res.unauthorized) return App.handleUnauthorized();
      if (res.ok) {
        App.createSafeNotice(notice, 'HCTI credentials deleted.', 'success');
        loadHctiStatus();
      } else {
        App.createSafeNotice(notice, App.errorMessage(res, 'Could not delete credentials.'), 'error');
      }
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  // --- Profile & password ---------------------------------------------------
  async function handleProfileSave(e) {
    e.preventDefault();
    var notice = document.getElementById('profile-notice');
    var btn = document.getElementById('profile-save');
    App.createSafeNotice(notice, '', 'info');
    App.setButtonLoading(btn, true, 'Saving…');
    try {
      var res = await App.apiRequest('/api/auth/profile', {
        method: 'PATCH',
        body: {
          name: document.getElementById('profile-name').value,
          timezone: document.getElementById('profile-timezone').value,
        },
      });
      if (res.unauthorized) return App.handleUnauthorized();
      if (res.ok && res.data && res.data.data) {
        applyUser(res.data.data.user);
        App.createSafeNotice(notice, 'Profile updated.', 'success');
      } else {
        App.createSafeNotice(notice, App.errorMessage(res, 'Could not update profile.'), 'error');
      }
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    var notice = document.getElementById('password-notice');
    var btn = document.getElementById('password-save');
    var current = document.getElementById('current-password');
    var next = document.getElementById('new-password');
    App.createSafeNotice(notice, '', 'info');
    App.setButtonLoading(btn, true, 'Changing…');
    try {
      var res = await App.apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current.value, newPassword: next.value },
      });
      // Always clear password fields regardless of outcome.
      current.value = '';
      next.value = '';
      if (res.unauthorized) return App.handleUnauthorized();
      if (res.ok) {
        // Session + CSRF rotated server-side — refresh our cached token.
        App.clearCachedCsrfToken();
        await App.getCsrfToken({ forceRefresh: true });
        App.createSafeNotice(notice, 'Password changed successfully.', 'success');
      } else {
        App.createSafeNotice(notice, App.errorMessage(res, 'Could not change password.'), 'error');
      }
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  async function handleLogout() {
    var btn = document.getElementById('logout-btn');
    App.setButtonLoading(btn, true, 'Logging out…');
    var res = await App.apiRequest('/api/auth/logout', { method: 'POST', body: {} });
    App.clearCachedCsrfToken();
    // Regardless of the exact result, return to the landing page.
    window.location.assign('/');
    return res;
  }

  // --- user display ---------------------------------------------------------
  function applyUser(user) {
    if (!user) return;
    App.setText('user-name', user.name);
    App.setText('overview-name', user.name);
    App.setText('overview-timezone', user.timezone);
    App.setText('overview-created', formatDate(user.createdAt));
    var nameInput = document.getElementById('profile-name');
    if (nameInput) nameInput.value = user.name || '';
    fillTimezoneSelect(document.getElementById('profile-timezone'), user.timezone);
  }

  // --- Connected accounts (OAuth) -------------------------------------------

  // The hostname each provider's authorization URL MUST use before we navigate.
  var PROVIDER_HOSTS = { meta: 'www.facebook.com', instagram: 'www.instagram.com', threads: 'threads.net' };
  var PROVIDER_LABELS = { meta: 'Facebook Pages', instagram: 'Instagram Professional', threads: 'Threads' };

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  // Show a one-time OAuth result banner from the dashboard URL, then strip it.
  function handleOAuthResultFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var oauth = params.get('oauth');
    if (!oauth) return;
    var provider = params.get('provider');
    var code = params.get('code');
    var notice = document.getElementById('oauth-result-notice');
    var label = (provider && PROVIDER_LABELS[provider]) || 'account';
    if (oauth === 'success') {
      App.createSafeNotice(notice, 'Connected ' + label + ' successfully.', 'success');
    } else {
      // Never render the raw provider error text — map to a safe message by code.
      var safe = {
        permission_denied: 'The connection was cancelled or not granted.',
        invalid_state: 'The connection could not be verified. Please try again.',
        expired_state: 'The connection request expired. Please try again.',
        provider_configuration_error: 'That provider is not configured.',
        no_publishable_account: 'No publishable account was found.',
        account_not_eligible: 'A professional/business account is required.',
      };
      App.createSafeNotice(notice, safe[code] || 'The connection could not be completed.', 'error');
    }
    // Remove the OAuth query params from history.
    window.history.replaceState({}, document.title, '/dashboard');
  }

  function renderProviderCards(availability) {
    var container = document.getElementById('provider-cards');
    if (!container) return;
    container.textContent = '';
    Object.keys(PROVIDER_LABELS).forEach(function (provider) {
      var available = !!(availability && availability[provider]);
      var card = el('div', 'rounded-xl border border-slate-200 bg-white p-4');
      card.appendChild(el('div', 'text-sm font-semibold text-slate-800', PROVIDER_LABELS[provider]));
      var status = el(
        'span',
        'mt-2 inline-block text-xs font-medium px-2.5 py-1 rounded-full ' + (available ? 'pill-ok' : 'pill-warn'),
        available ? 'Connection available' : 'Not configured',
      );
      card.appendChild(status);
      var btn = el('button', 'mt-3 block w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:bg-slate-300 disabled:cursor-not-allowed', 'Connect');
      btn.type = 'button';
      btn.disabled = !available;
      if (available) btn.addEventListener('click', function () { connectProvider(provider, btn); });
      card.appendChild(btn);
      container.appendChild(card);
    });
  }

  async function connectProvider(provider, btn) {
    App.setButtonLoading(btn, true, 'Connecting…');
    try {
      var res = await App.apiRequest('/api/oauth/' + provider + '/start', { method: 'POST', body: {} });
      if (res.unauthorized) return App.handleUnauthorized();
      var url = res.ok && res.data && res.data.data && res.data.data.authorizationUrl;
      if (!url) {
        App.createSafeNotice(document.getElementById('accounts-notice'), App.errorMessage(res, 'Could not start the connection.'), 'error');
        return;
      }
      // Validate the authorization URL host before navigating (no open redirect).
      var parsed;
      try { parsed = new URL(url); } catch (e) { parsed = null; }
      if (!parsed || parsed.protocol !== 'https:' || parsed.hostname !== PROVIDER_HOSTS[provider]) {
        App.createSafeNotice(document.getElementById('accounts-notice'), 'Unexpected authorization URL. Connection aborted.', 'error');
        return;
      }
      window.location.assign(url);
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  function renderAccounts(accounts) {
    var list = document.getElementById('accounts-list');
    var empty = document.getElementById('accounts-empty');
    if (!list) return;
    // Clear all but the empty placeholder.
    Array.prototype.slice.call(list.querySelectorAll('[data-account]')).forEach(function (n) { n.remove(); });
    if (!accounts || accounts.length === 0) {
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');

    accounts.forEach(function (acc) {
      var card = el('div', 'rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3');
      card.setAttribute('data-account', acc.id);

      var info = el('div', '');
      info.appendChild(el('div', 'text-sm font-medium text-slate-800', acc.displayName || acc.providerAccountId));
      var meta = PROVIDER_LABELS[acc.provider] || acc.provider;
      if (acc.username) meta += ' · @' + acc.username;
      info.appendChild(el('div', 'text-xs text-slate-500', meta));
      var statusState = acc.status === 'active' ? 'pill-ok' : acc.status === 'error' || acc.status === 'revoked' ? 'pill-err' : 'pill-warn';
      var statusRow = el('div', 'mt-1 flex items-center gap-2');
      statusRow.appendChild(el('span', 'text-xs font-medium px-2 py-0.5 rounded-full ' + statusState, acc.status));
      statusRow.appendChild(el('span', 'text-xs text-slate-400', acc.lastVerifiedAt ? 'Verified ' + formatDate(acc.lastVerifiedAt) : 'Not verified'));
      info.appendChild(statusRow);
      card.appendChild(info);

      var actions = el('div', 'flex gap-2');
      var verifyBtn = el('button', 'rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100', 'Verify');
      verifyBtn.type = 'button';
      verifyBtn.addEventListener('click', function () { verifyAccount(acc.id, verifyBtn); });
      var disconnectBtn = el('button', 'rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50', 'Disconnect');
      disconnectBtn.type = 'button';
      disconnectBtn.addEventListener('click', function () { disconnectAccount(acc.id, disconnectBtn); });
      actions.appendChild(verifyBtn);
      actions.appendChild(disconnectBtn);
      card.appendChild(actions);

      list.appendChild(card);
    });
  }

  async function loadProviders() {
    var res = await App.apiRequest('/api/oauth/providers');
    if (res.unauthorized) return App.handleUnauthorized();
    if (res.ok && res.data && res.data.data) renderProviderCards(res.data.data.providers);
  }

  async function loadAccounts() {
    var res = await App.apiRequest('/api/social-accounts');
    if (res.unauthorized) return App.handleUnauthorized();
    if (res.ok && res.data && res.data.data) renderAccounts(res.data.data.accounts);
  }

  async function verifyAccount(id, btn) {
    App.setButtonLoading(btn, true, 'Verifying…');
    try {
      var res = await App.apiRequest('/api/social-accounts/' + encodeURIComponent(id) + '/verify', { method: 'POST', body: {} });
      if (res.unauthorized) return App.handleUnauthorized();
      var notice = document.getElementById('accounts-notice');
      if (res.ok && res.data && res.data.data && res.data.data.verified) {
        App.createSafeNotice(notice, 'Account verified.', 'success');
      } else {
        App.createSafeNotice(notice, App.errorMessage(res, 'Verification failed.'), 'error');
      }
      loadAccounts();
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  async function disconnectAccount(id, btn) {
    if (!window.confirm('Disconnect this account? Its stored access will be removed.')) return;
    App.setButtonLoading(btn, true, 'Disconnecting…');
    try {
      var res = await App.apiRequest('/api/social-accounts/' + encodeURIComponent(id), {
        method: 'DELETE',
        body: { confirm: 'DISCONNECT' },
      });
      if (res.unauthorized) return App.handleUnauthorized();
      var notice = document.getElementById('accounts-notice');
      if (res.ok) App.createSafeNotice(notice, 'Account disconnected.', 'success');
      else App.createSafeNotice(notice, App.errorMessage(res, 'Could not disconnect.'), 'error');
      loadAccounts();
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  // --- init -----------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async function () {
    var user = await App.me();
    if (!user) {
      App.handleUnauthorized();
      return;
    }
    applyUser(user);
    App.refreshHealth();
    loadHctiStatus();
    handleOAuthResultFromUrl();
    loadProviders();
    loadAccounts();

    var logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    var hctiForm = document.getElementById('hcti-form');
    if (hctiForm) hctiForm.addEventListener('submit', handleHctiSave);
    var hctiTest = document.getElementById('hcti-test');
    if (hctiTest) hctiTest.addEventListener('click', handleHctiTest);
    var hctiDelete = document.getElementById('hcti-delete');
    if (hctiDelete) hctiDelete.addEventListener('click', handleHctiDelete);

    var profileForm = document.getElementById('profile-form');
    if (profileForm) profileForm.addEventListener('submit', handleProfileSave);
    var passwordForm = document.getElementById('password-form');
    if (passwordForm) passwordForm.addEventListener('submit', handlePasswordChange);
  });
})();
