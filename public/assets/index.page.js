/**
 * Landing page behavior: tab switching, footer year, and a development-only
 * "setup in progress" banner. No backend mutations, no secrets.
 */

(function () {
  'use strict';

  // Footer year.
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Show the dev banner only on local development hosts.
  var host = window.location.hostname;
  var isDev = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (isDev) {
    var banner = document.getElementById('dev-banner');
    if (banner) banner.classList.remove('hidden');
  }

  // Tab switching between Sign in / Create account.
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

  // Forms are disabled in Phase 1 — prevent any accidental submission.
  [loginForm, registerForm].forEach(function (form) {
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); });
  });
})();
