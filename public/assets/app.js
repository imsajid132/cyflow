/**
 * Cyflow Social — minimal frontend bootstrap (Phase 1).
 *
 * Provides a safe API helper and reads two live backend signals: /health and
 * /api/csrf-token. It NEVER stores secrets in localStorage, never fabricates
 * backend responses, and never injects untrusted HTML (uses textContent only).
 */

(function () {
  'use strict';

  /** In-memory CSRF token for this page load (not persisted). */
  let csrfToken = null;

  /**
   * Safe JSON fetch helper. Returns { ok, status, data } and never throws for
   * HTTP errors — callers branch on `ok`.
   * @param {string} pathname
   * @param {RequestInit} [options]
   */
  async function apiFetch(pathname, options = {}) {
    const opts = {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(options.headers || {}) },
      ...options,
    };
    // Attach CSRF token to state-changing requests when we have one.
    const method = (opts.method || 'GET').toUpperCase();
    if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      opts.headers['X-CSRF-Token'] = csrfToken;
    }
    try {
      const res = await fetch(pathname, opts);
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: null, networkError: true };
    }
  }

  /** Fetch and cache the CSRF token. */
  async function loadCsrfToken() {
    const { ok, data } = await apiFetch('/api/csrf-token');
    if (ok && data && data.success && data.data && data.data.csrfToken) {
      csrfToken = data.data.csrfToken;
      return csrfToken;
    }
    return null;
  }

  /** Set text content of an element by id, if present. */
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /** Set a status pill's label + color state. */
  function setStatusPill(id, label, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = label;
    el.dataset.state = state; // styled via CSS attribute selectors / classes
    el.classList.remove('pill-ok', 'pill-warn', 'pill-err');
    el.classList.add(
      state === 'ok' ? 'pill-ok' : state === 'warn' ? 'pill-warn' : 'pill-err',
    );
  }

  /** Refresh the live health panel, if the page has one. */
  async function refreshHealth() {
    if (!document.getElementById('health-status')) return;
    const { ok, data } = await apiFetch('/health');
    if (ok && data && data.data) {
      const d = data.data;
      setStatusPill('health-status', d.status === 'ok' ? 'Online' : 'Degraded', d.status === 'ok' ? 'ok' : 'warn');
      setText('health-version', d.version || '—');
      setText('health-timestamp', d.timestampUtc || '—');
      setStatusPill(
        'db-status',
        d.database && d.database.connected ? 'Connected' : 'Unavailable',
        d.database && d.database.connected ? 'ok' : 'err',
      );
      setStatusPill(
        'scheduler-status',
        d.scheduler && d.scheduler.enabled ? 'Enabled' : 'Disabled',
        d.scheduler && d.scheduler.enabled ? 'ok' : 'warn',
      );
    } else {
      setStatusPill('health-status', 'Unreachable', 'err');
      setStatusPill('db-status', 'Unknown', 'err');
      setStatusPill('scheduler-status', 'Unknown', 'err');
    }
  }

  // Expose a tiny, safe namespace for page scripts (no secrets).
  window.CyflowSocial = {
    apiFetch,
    loadCsrfToken,
    refreshHealth,
    getCsrfToken: () => csrfToken,
  };

  document.addEventListener('DOMContentLoaded', async () => {
    await loadCsrfToken();
    await refreshHealth();
  });
})();
