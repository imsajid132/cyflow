/**
 * Dashboard page behavior: footer year and preventing submission of the
 * disabled Phase 1 forms. Live status is handled by app.js (refreshHealth).
 */

(function () {
  'use strict';

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // All forms are disabled in Phase 1 — guard against accidental submission.
  var forms = document.querySelectorAll('form');
  Array.prototype.forEach.call(forms, function (form) {
    form.addEventListener('submit', function (e) { e.preventDefault(); });
  });
})();
