/**
 * Landing page behavior: tab switching, timezone selector, and the login /
 * registration forms. Uses the shared CyflowSocial API helper. Redirects
 * already-authenticated users (and successful auth) to /dashboard.
 */

(function () {
  'use strict';

  var App = window.CyflowSocial;

  // Footer year.
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Dev banner only on local hosts.
  var host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    var banner = document.getElementById('dev-banner');
    if (banner) banner.classList.remove('hidden');
  }

  // --- Timezone selector ----------------------------------------------------
  function detectTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }

  function supportedTimezones() {
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        return Intl.supportedValuesOf('timeZone');
      }
    } catch (e) {
      /* fall through */
    }
    // Reasonable fallback list (not limited to three).
    return [
      'UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'America/Sao_Paulo', 'America/Mexico_City', 'Asia/Karachi', 'Asia/Dubai',
      'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
      'Australia/Sydney', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
      'Europe/Madrid', 'Europe/Moscow', 'Pacific/Auckland',
    ];
  }

  function populateTimezones() {
    var select = document.getElementById('reg-timezone');
    if (!select) return;
    var zones = supportedTimezones();
    var detected = detectTimezone();
    if (zones.indexOf(detected) === -1) zones = [detected].concat(zones);

    select.textContent = '';
    zones.forEach(function (zone) {
      var opt = document.createElement('option');
      opt.value = zone;
      opt.textContent = zone;
      if (zone === detected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // --- Tabs -----------------------------------------------------------------
  var tabLogin = document.getElementById('tab-login');
  var tabRegister = document.getElementById('tab-register');
  var loginForm = document.getElementById('login-form');
  var registerForm = document.getElementById('register-form');

  function activate(which) {
    var loginActive = which === 'login';
    if (loginForm) loginForm.classList.toggle('hidden', !loginActive);
    if (registerForm) registerForm.classList.toggle('hidden', loginActive);
    if (tabLogin) {
      tabLogin.setAttribute('aria-selected', String(loginActive));
      tabLogin.classList.toggle('bg-white', loginActive);
      tabLogin.classList.toggle('text-slate-900', loginActive);
      tabLogin.classList.toggle('border-indigo-500', loginActive);
      tabLogin.classList.toggle('bg-slate-50', !loginActive);
      tabLogin.classList.toggle('text-slate-500', !loginActive);
      tabLogin.classList.toggle('border-transparent', !loginActive);
    }
    if (tabRegister) {
      tabRegister.setAttribute('aria-selected', String(!loginActive));
      tabRegister.classList.toggle('bg-white', !loginActive);
      tabRegister.classList.toggle('text-slate-900', !loginActive);
      tabRegister.classList.toggle('border-indigo-500', !loginActive);
      tabRegister.classList.toggle('bg-slate-50', loginActive);
      tabRegister.classList.toggle('text-slate-500', loginActive);
      tabRegister.classList.toggle('border-transparent', loginActive);
    }
  }
  if (tabLogin) tabLogin.addEventListener('click', function () { activate('login'); });
  if (tabRegister) tabRegister.addEventListener('click', function () { activate('register'); });

  // --- Auth submit handlers -------------------------------------------------
  async function handleLogin(e) {
    e.preventDefault();
    var notice = document.getElementById('login-notice');
    var btn = document.getElementById('login-submit');
    App.createSafeNotice(notice, '', 'info');
    App.setButtonLoading(btn, true, 'Signing in…');
    try {
      var res = await App.apiRequest('/api/auth/login', {
        method: 'POST',
        body: {
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value,
        },
      });
      if (res.ok) {
        App.clearCachedCsrfToken(); // session rotated
        window.location.assign('/dashboard');
        return;
      }
      App.createSafeNotice(notice, App.errorMessage(res, 'Invalid email or password.'), 'error');
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    var notice = document.getElementById('register-notice');
    var btn = document.getElementById('register-submit');
    App.createSafeNotice(notice, '', 'info');
    App.setButtonLoading(btn, true, 'Creating account…');
    try {
      var res = await App.apiRequest('/api/auth/register', {
        method: 'POST',
        body: {
          name: document.getElementById('reg-name').value,
          email: document.getElementById('reg-email').value,
          password: document.getElementById('reg-password').value,
          timezone: document.getElementById('reg-timezone').value,
        },
      });
      if (res.ok) {
        App.clearCachedCsrfToken(); // session rotated
        window.location.assign('/dashboard');
        return;
      }
      App.createSafeNotice(notice, App.errorMessage(res, 'Could not create your account.'), 'error');
    } finally {
      App.setButtonLoading(btn, false);
    }
  }

  if (loginForm) loginForm.addEventListener('submit', handleLogin);
  if (registerForm) registerForm.addEventListener('submit', handleRegister);

  // --- On load: redirect if already authenticated ---------------------------
  document.addEventListener('DOMContentLoaded', async function () {
    populateTimezones();
    var user = await App.me();
    if (user) {
      window.location.assign('/dashboard');
    }
  });
})();
