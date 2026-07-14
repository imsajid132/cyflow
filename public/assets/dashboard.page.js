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
