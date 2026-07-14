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

  // ===========================================================================
  // Create Post + Scheduled Queue (Phase 4)
  // ===========================================================================

  var TONES = ['neutral', 'friendly', 'professional', 'playful', 'bold', 'informative'];
  var HASHTAGS = ['none', 'minimal', 'moderate', 'rich'];
  var TEMPLATES = ['minimal', 'bold', 'professional'];
  var ASPECTS = ['square', 'portrait', 'landscape'];
  var BACKGROUNDS = ['light', 'dark', 'gradient-blue', 'gradient-warm', 'neutral'];
  var ACCOUNT_PLATFORM = { facebook_page: 'facebook', instagram_professional: 'instagram', threads_profile: 'threads' };

  var cp = { postId: null, post: null, activePlatform: null, userTimezone: 'UTC' };

  function fillSelect(id, values) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = '';
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    });
  }

  function cpNotice(msg, type) {
    App.createSafeNotice(document.getElementById('cp-notice'), msg || '', type || 'info');
  }
  function sqNotice(msg, type) {
    App.createSafeNotice(document.getElementById('sq-notice'), msg || '', type || 'info');
  }

  function collectFields() {
    return {
      title: document.getElementById('cp-title').value,
      brief: document.getElementById('cp-brief').value,
      brandName: document.getElementById('cp-brand').value,
      language: document.getElementById('cp-language').value,
      tone: document.getElementById('cp-tone').value,
      hashtagPreference: document.getElementById('cp-hashtags').value,
      callToAction: document.getElementById('cp-cta').value,
      additionalInstructions: document.getElementById('cp-notes').value,
      template: document.getElementById('cp-template').value,
      aspectRatio: document.getElementById('cp-aspect').value,
      backgroundStyle: document.getElementById('cp-bg').value,
    };
  }

  function selectedAccountIds() {
    var ids = [];
    document.querySelectorAll('#cp-accounts input[type=checkbox]:checked').forEach(function (c) {
      ids.push(c.value);
    });
    return ids;
  }

  async function loadCapabilities() {
    var res = await App.apiRequest('/api/posts/capabilities');
    if (res.unauthorized) return App.handleUnauthorized();
    var caps = res.ok && res.data && res.data.data;
    var openaiOk = !!(caps && caps.openai && caps.openai.available);
    var hctiOk = !!(caps && caps.hcti && caps.hcti.configured && caps.hcti.verified);
    var genContentBtn = document.getElementById('cp-gen-content');
    var genImageBtn = document.getElementById('cp-gen-image');
    if (genContentBtn) genContentBtn.disabled = !cp.postId || !openaiOk;
    if (genImageBtn) genImageBtn.disabled = !cp.postId || !hctiOk;
    document.getElementById('cp-openai-hint').classList.toggle('hidden', openaiOk);
    document.getElementById('cp-hcti-hint').classList.toggle('hidden', hctiOk);
  }

  async function loadCreatePostAccounts() {
    var res = await App.apiRequest('/api/social-accounts');
    if (res.unauthorized) return App.handleUnauthorized();
    var accounts = (res.ok && res.data && res.data.data && res.data.data.accounts) || [];
    var active = accounts.filter(function (a) { return a.status === 'active'; });
    var box = document.getElementById('cp-accounts');
    box.textContent = '';
    if (active.length === 0) {
      box.appendChild(el('p', 'text-slate-400', 'No active connected accounts. Connect one above first.'));
      return;
    }
    active.forEach(function (a) {
      var label = document.createElement('label');
      label.className = 'flex items-center gap-2';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = a.id;
      cb.dataset.accountType = a.accountType;
      cb.addEventListener('change', renderCaptionTabs);
      label.appendChild(cb);
      var text = (PROVIDER_LABELS[a.provider] || a.provider) + ' · ' + (a.displayName || a.providerAccountId);
      label.appendChild(el('span', '', text));
      box.appendChild(label);
    });
  }

  function selectedPlatforms() {
    var set = {};
    document.querySelectorAll('#cp-accounts input[type=checkbox]:checked').forEach(function (c) {
      var p = ACCOUNT_PLATFORM[c.dataset.accountType];
      if (p) set[p] = true;
    });
    return Object.keys(set);
  }

  function renderCaptionTabs() {
    var tabs = document.getElementById('cp-preview-tabs');
    if (!tabs) return;
    tabs.textContent = '';
    var platforms = selectedPlatforms();
    if (platforms.length === 0) {
      cp.activePlatform = null;
      document.getElementById('cp-caption').value = '';
      document.getElementById('cp-hashtag-preview').textContent = '';
      return;
    }
    if (!cp.activePlatform || platforms.indexOf(cp.activePlatform) === -1) cp.activePlatform = platforms[0];
    platforms.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = PROVIDER_LABELS[p === 'facebook' ? 'meta' : p] || p;
      b.className = 'rounded-full px-3 py-1 ' + (p === cp.activePlatform ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600');
      b.addEventListener('click', function () { cp.activePlatform = p; showCaptionFor(p); renderCaptionTabs(); });
      tabs.appendChild(b);
    });
    showCaptionFor(cp.activePlatform);
  }

  function showCaptionFor(platform) {
    var captions = (cp.post && cp.post.platformCaptions) || {};
    var sec = captions[platform] || {};
    document.getElementById('cp-caption').value = sec.caption || '';
    document.getElementById('cp-hashtag-preview').textContent = (sec.hashtags || []).join(' ');
  }

  function renderImagePreview() {
    var img = document.getElementById('cp-image');
    var empty = document.getElementById('cp-image-empty');
    var token = cp.post && cp.post.media && cp.post.media.publicToken;
    if (token) {
      img.src = '/media/' + encodeURIComponent(token);
      img.alt = (cp.post && cp.post.imageAltText) || 'Generated image';
      img.classList.remove('hidden');
      empty.classList.add('hidden');
      document.getElementById('cp-alt').textContent = cp.post.imageAltText ? 'Alt: ' + cp.post.imageAltText : '';
      document.getElementById('cp-image-info').textContent =
        'Template: ' + (cp.post.template || '—') + ' · Aspect: ' + (cp.post.aspectRatio || '—');
    } else {
      img.classList.add('hidden');
      empty.classList.remove('hidden');
      document.getElementById('cp-alt').textContent = '';
      document.getElementById('cp-image-info').textContent = '';
    }
  }

  function applyPostToForm(post) {
    cp.post = post;
    cp.postId = post.id;
    document.getElementById('cp-mode').textContent = 'Editing draft #' + post.id;
    document.getElementById('cp-title').value = post.title || '';
    document.getElementById('cp-brief').value = post.brief || '';
    var gp = post.generationParams || {};
    document.getElementById('cp-brand').value = gp.brandName || '';
    document.getElementById('cp-language').value = gp.language || '';
    if (gp.tone) document.getElementById('cp-tone').value = gp.tone;
    if (gp.hashtagPreference) document.getElementById('cp-hashtags').value = gp.hashtagPreference;
    document.getElementById('cp-cta').value = gp.callToAction || '';
    document.getElementById('cp-notes').value = gp.additionalInstructions || '';
    if (post.template) document.getElementById('cp-template').value = post.template;
    if (post.aspectRatio) document.getElementById('cp-aspect').value = post.aspectRatio;
    if (post.backgroundStyle) document.getElementById('cp-bg').value = post.backgroundStyle;
    renderCaptionTabs();
    renderImagePreview();
    document.getElementById('cp-schedule').disabled = false;
    loadCapabilities();
  }

  function resetCreatePost() {
    cp = { postId: null, post: null, activePlatform: null, userTimezone: cp.userTimezone };
    document.getElementById('cp-form').reset();
    document.getElementById('cp-mode').textContent = 'New draft';
    document.getElementById('cp-preview-tabs').textContent = '';
    document.getElementById('cp-caption').value = '';
    document.getElementById('cp-hashtag-preview').textContent = '';
    renderImagePreview();
    document.getElementById('cp-schedule').disabled = true;
    fillSelect('cp-template', TEMPLATES); fillSelect('cp-aspect', ASPECTS); fillSelect('cp-bg', BACKGROUNDS);
    fillSelect('cp-tone', TONES); fillSelect('cp-hashtags', HASHTAGS);
    loadCapabilities();
    loadCreatePostAccounts();
  }

  async function saveTargets() {
    var ids = selectedAccountIds();
    if (!cp.postId) return;
    var res = await App.apiRequest('/api/posts/' + cp.postId + '/targets', {
      method: 'PUT',
      body: { targets: ids.map(function (id) { return { socialAccountId: id }; }) },
    });
    if (res.unauthorized) return App.handleUnauthorized();
    if (res.ok && res.data && res.data.data) cp.post = res.data.data.post;
  }

  async function handleSaveDraft(e) {
    if (e) e.preventDefault();
    var btn = document.getElementById('cp-save');
    App.setButtonLoading(btn, true, 'Saving…');
    try {
      var fields = collectFields();
      var res;
      if (cp.postId) {
        res = await App.apiRequest('/api/posts/' + cp.postId, { method: 'PATCH', body: fields });
      } else {
        res = await App.apiRequest('/api/posts', { method: 'POST', body: fields });
      }
      if (res.unauthorized) return App.handleUnauthorized();
      if (res.ok && res.data && res.data.data) {
        applyPostToForm(res.data.data.post);
        await saveTargets();
        cpNotice('Draft saved.', 'success');
        loadQueue();
      } else {
        cpNotice(App.errorMessage(res, 'Could not save the draft.'), 'error');
      }
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  async function handleGenerateContent() {
    if (!cp.postId) { cpNotice('Save the draft first.', 'error'); return; }
    var btn = document.getElementById('cp-gen-content');
    App.setButtonLoading(btn, true, 'Generating…');
    try {
      await saveTargets();
      var res = await App.apiRequest('/api/posts/' + cp.postId + '/generate-content', { method: 'POST', body: {} });
      if (res.unauthorized) return App.handleUnauthorized();
      if (res.ok && res.data && res.data.data) {
        cp.post = res.data.data.post;
        renderCaptionTabs();
        cpNotice('Content generated. You can edit each caption.', 'success');
      } else {
        cpNotice(App.errorMessage(res, 'Content generation failed.'), 'error');
      }
    } finally {
      App.setButtonLoading(btn, false);
      loadCapabilities();
    }
  }

  async function handleGenerateImage() {
    if (!cp.postId) { cpNotice('Save the draft first.', 'error'); return; }
    var btn = document.getElementById('cp-gen-image');
    App.setButtonLoading(btn, true, 'Generating…');
    try {
      var res = await App.apiRequest('/api/posts/' + cp.postId + '/generate-image', { method: 'POST', body: {} });
      if (res.unauthorized) return App.handleUnauthorized();
      if (res.ok && res.data && res.data.data) {
        cp.post = res.data.data.post;
        renderImagePreview();
        cpNotice('Image generated.', 'success');
      } else {
        cpNotice(App.errorMessage(res, 'Image generation failed.'), 'error');
      }
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  async function handleSaveCaption() {
    if (!cp.postId || !cp.activePlatform) return;
    var caption = document.getElementById('cp-caption').value;
    // Map platform back to the selected account(s) as caption overrides.
    var overrides = [];
    document.querySelectorAll('#cp-accounts input[type=checkbox]:checked').forEach(function (c) {
      var platform = ACCOUNT_PLATFORM[c.dataset.accountType];
      overrides.push({ socialAccountId: c.value, captionOverride: platform === cp.activePlatform ? caption : undefined });
    });
    var res = await App.apiRequest('/api/posts/' + cp.postId + '/targets', { method: 'PUT', body: { targets: overrides.map(function (o) { return o.captionOverride === undefined ? { socialAccountId: o.socialAccountId } : o; }) } });
    if (res.ok) cpNotice('Caption saved for ' + cp.activePlatform + '.', 'success');
    else cpNotice(App.errorMessage(res, 'Could not save caption.'), 'error');
  }

  async function handleSchedule() {
    if (!cp.postId) { cpNotice('Save the draft first.', 'error'); return; }
    var date = document.getElementById('cp-date').value;
    var time = document.getElementById('cp-time').value;
    if (!date || !time) { cpNotice('Choose a schedule date and time.', 'error'); return; }
    var btn = document.getElementById('cp-schedule');
    App.setButtonLoading(btn, true, 'Scheduling…');
    try {
      await saveTargets();
      var res = await App.apiRequest('/api/posts/' + cp.postId + '/schedule', {
        method: 'POST',
        body: { scheduledDate: date, scheduledTime: time, timezone: cp.userTimezone },
      });
      if (res.unauthorized) return App.handleUnauthorized();
      if (res.ok && res.data && res.data.data) {
        cpNotice(res.data.data.notice || 'Post queued.', 'success');
        loadQueue();
      } else {
        cpNotice(App.errorMessage(res, 'Could not schedule the post.'), 'error');
      }
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  // --- Scheduled Queue ------------------------------------------------------

  function statusPillClass(status) {
    if (status === 'queued' || status === 'published') return 'pill-ok';
    if (status === 'failed' || status === 'partial') return 'pill-err';
    return 'pill-warn';
  }

  async function loadQueue() {
    var res = await App.apiRequest('/api/posts?limit=50');
    if (res.unauthorized) return App.handleUnauthorized();
    var posts = (res.ok && res.data && res.data.data && res.data.data.posts) || [];
    var list = document.getElementById('sq-list');
    var empty = document.getElementById('sq-empty');
    Array.prototype.slice.call(list.querySelectorAll('[data-post]')).forEach(function (n) { n.remove(); });
    if (posts.length === 0) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    posts.forEach(function (post) {
      var card = el('div', 'rounded-xl border border-slate-200 bg-white p-4');
      card.setAttribute('data-post', post.id);
      var top = el('div', 'flex items-start justify-between gap-3');
      var left = el('div', '');
      left.appendChild(el('div', 'text-sm font-medium text-slate-800', post.title || '(untitled)'));
      var meta = el('div', 'mt-1 flex items-center gap-2');
      meta.appendChild(el('span', 'text-xs font-medium px-2 py-0.5 rounded-full ' + statusPillClass(post.status), post.status));
      if (post.scheduledAtUtc) {
        meta.appendChild(el('span', 'text-xs text-slate-500', 'Scheduled: ' + formatDate(post.scheduledAtUtc) + (post.originalTimezone ? ' (' + post.originalTimezone + ')' : '')));
      }
      left.appendChild(meta);
      var accts = (post.targets || []).map(function (t) { return (PROVIDER_LABELS[t.provider] || t.provider); }).join(', ');
      left.appendChild(el('div', 'mt-1 text-xs text-slate-500', accts ? 'Accounts: ' + accts : 'No accounts'));
      var firstCaption = '';
      var pc = post.platformCaptions || {};
      var keys = Object.keys(pc);
      if (keys.length) firstCaption = (pc[keys[0]].caption || '').slice(0, 120);
      if (firstCaption) left.appendChild(el('div', 'mt-1 text-xs text-slate-400', firstCaption));
      left.appendChild(el('div', 'mt-1 text-xs text-slate-300', 'Created ' + formatDate(post.createdAt)));
      top.appendChild(left);

      if (post.media && post.media.publicToken) {
        var thumb = document.createElement('img');
        thumb.src = '/media/' + encodeURIComponent(post.media.publicToken);
        thumb.alt = '';
        thumb.className = 'h-16 w-16 rounded object-cover';
        top.appendChild(thumb);
      }
      card.appendChild(top);

      var actions = el('div', 'mt-3 flex flex-wrap gap-2');
      var editBtn = el('button', 'rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100', 'Edit');
      editBtn.type = 'button';
      editBtn.addEventListener('click', function () { openForEdit(post.id); });
      actions.appendChild(editBtn);
      if (post.status === 'draft' || post.status === 'queued' || post.status === 'retrying') {
        if (post.status !== 'draft') {
          var cancelBtn = el('button', 'rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50', 'Cancel');
          cancelBtn.type = 'button';
          cancelBtn.addEventListener('click', function () { cancelPost(post.id); });
          actions.appendChild(cancelBtn);
        }
        var delBtn = el('button', 'rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50', 'Delete');
        delBtn.type = 'button';
        delBtn.addEventListener('click', function () { deletePost(post.id); });
        actions.appendChild(delBtn);
      }
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function openForEdit(postId) {
    var res = await App.apiRequest('/api/posts/' + encodeURIComponent(postId));
    if (res.ok && res.data && res.data.data) {
      applyPostToForm(res.data.data.post);
      // Re-check the target account checkboxes.
      var targetIds = (res.data.data.post.targets || []).map(function (t) { return t.socialAccountId; });
      document.querySelectorAll('#cp-accounts input[type=checkbox]').forEach(function (c) {
        c.checked = targetIds.indexOf(c.value) !== -1;
      });
      renderCaptionTabs();
      document.getElementById('create-post').scrollIntoView({ behavior: 'smooth' });
    }
  }

  async function cancelPost(postId) {
    if (!window.confirm('Cancel this scheduled post?')) return;
    var res = await App.apiRequest('/api/posts/' + encodeURIComponent(postId) + '/cancel', { method: 'POST', body: {} });
    if (res.unauthorized) return App.handleUnauthorized();
    sqNotice(res.ok ? 'Post cancelled.' : App.errorMessage(res, 'Could not cancel.'), res.ok ? 'success' : 'error');
    loadQueue();
  }

  async function deletePost(postId) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    var res = await App.apiRequest('/api/posts/' + encodeURIComponent(postId), { method: 'DELETE', body: {} });
    if (res.unauthorized) return App.handleUnauthorized();
    sqNotice(res.ok ? 'Draft deleted.' : App.errorMessage(res, 'Could not delete.'), res.ok ? 'success' : 'error');
    if (String(cp.postId) === String(postId)) resetCreatePost();
    loadQueue();
  }

  function wireCreatePost(user) {
    cp.userTimezone = (user && user.timezone) || 'UTC';
    var tzSpan = document.getElementById('cp-tz');
    if (tzSpan) tzSpan.textContent = cp.userTimezone;
    resetCreatePost();

    document.getElementById('cp-form').addEventListener('submit', handleSaveDraft);
    document.getElementById('cp-gen-content').addEventListener('click', handleGenerateContent);
    document.getElementById('cp-gen-image').addEventListener('click', handleGenerateImage);
    document.getElementById('cp-schedule').addEventListener('click', handleSchedule);
    document.getElementById('cp-save-caption').addEventListener('click', handleSaveCaption);
    document.getElementById('cp-cancel-edit').addEventListener('click', function () { resetCreatePost(); cpNotice('', 'info'); });
    var sqRefresh = document.getElementById('sq-refresh');
    if (sqRefresh) sqRefresh.addEventListener('click', loadQueue);
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
    wireCreatePost(user);
    loadQueue();

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
