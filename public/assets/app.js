/**
 * Cyflow Social — shared frontend runtime.
 *
 * Provides a safe API helper, in-memory CSRF handling, and small DOM utilities.
 * It NEVER stores secrets or auth tokens in localStorage/sessionStorage, never
 * fabricates backend responses, and never injects untrusted HTML (textContent
 * only). The CSRF token is cached in memory for the page's lifetime only.
 */

(function () {
  'use strict';

  /** In-memory CSRF token (never persisted). */
  let csrfToken = null;

  const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  /** Clear the cached CSRF token (e.g. after a session rotation). */
  function clearCachedCsrfToken() {
    csrfToken = null;
  }

  /**
   * Fetch (and cache) the CSRF token. Pass { forceRefresh: true } after the
   * session is rotated (login/register/password change).
   */
  async function getCsrfToken(options) {
    const forceRefresh = options && options.forceRefresh;
    if (csrfToken && !forceRefresh) return csrfToken;
    try {
      const res = await fetch('/api/csrf-token', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(function () {
        return null;
      });
      if (res.ok && data && data.data && data.data.csrfToken) {
        csrfToken = data.data.csrfToken;
        return csrfToken;
      }
    } catch (err) {
      /* network error — return null below */
    }
    return null;
  }

  /**
   * Safe JSON API request. Returns { ok, status, data, networkError }.
   * Never throws for HTTP errors — callers branch on the result.
   */
  async function apiRequest(path, options) {
    const opts = options || {};
    const method = (opts.method || 'GET').toUpperCase();
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    const init = {
      method: method,
      credentials: 'same-origin',
      headers: headers,
    };

    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }

    if (STATE_CHANGING.has(method)) {
      const token = await getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
    }

    let res;
    try {
      res = await fetch(path, init);
    } catch (err) {
      // Do NOT log the request body (may contain credentials).
      return { ok: false, status: 0, data: null, networkError: true };
    }

    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null; // non-JSON response
    }

    // Consistent 401 signalling for callers.
    if (res.status === 401) {
      return { ok: false, status: 401, data: data, unauthorized: true };
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  /** Load the current user; returns the user object or null. */
  async function me() {
    const res = await apiRequest('/api/auth/me');
    if (res.ok && res.data && res.data.data && res.data.data.user) {
      return res.data.data.user;
    }
    return null;
  }

  /** Redirect to the landing page (used on 401). */
  function handleUnauthorized() {
    if (window.location.pathname !== '/') {
      window.location.assign('/');
    }
  }

  /** Extract a safe, human-readable error message from an API result. */
  function errorMessage(result, fallback) {
    if (result && result.data && result.data.error && result.data.error.message) {
      return result.data.error.message;
    }
    if (result && result.networkError) return 'Network error. Please try again.';
    return fallback || 'Something went wrong. Please try again.';
  }

  /**
   * Render a safe notice into a container (textContent only — no HTML).
   * type: 'success' | 'error' | 'info'
   */
  function createSafeNotice(container, message, type) {
    if (!container) return;
    container.textContent = '';
    if (!message) {
      container.className = 'hidden';
      return;
    }
    const box = document.createElement('div');
    const base = 'rounded-lg px-3 py-2 text-sm border ';
    const styles = {
      success: 'bg-green-50 border-green-300 text-green-800',
      error: 'bg-red-50 border-red-300 text-red-800',
      info: 'bg-slate-50 border-slate-300 text-slate-700',
    };
    box.className = base + (styles[type] || styles.info);
    box.textContent = message; // safe: no HTML injection
    container.className = '';
    container.appendChild(box);
  }

  /** Toggle a button's loading state (disabled + label swap), preventing double submit. */
  function setButtonLoading(button, loading, loadingText) {
    if (!button) return;
    if (loading) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      if (loadingText) button.textContent = loadingText;
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }

  /** Set text content of an element by id, if present. */
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text == null ? '' : String(text);
  }

  /** Set a status pill's label + color state. */
  function setStatusPill(id, label, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = label;
    el.classList.remove('pill-ok', 'pill-warn', 'pill-err');
    el.classList.add(state === 'ok' ? 'pill-ok' : state === 'warn' ? 'pill-warn' : 'pill-err');
  }

  /** Refresh the live health panel, if the page has one. */
  async function refreshHealth() {
    if (!document.getElementById('health-status')) return;
    const res = await apiRequest('/health');
    const d = res.data && res.data.data;
    if (res.ok && d) {
      setStatusPill('health-status', d.status === 'ok' ? 'Online' : 'Degraded', d.status === 'ok' ? 'ok' : 'warn');
      setText('health-version', d.version || '—');
      setText('health-timestamp', d.timestampUtc || '—');
      setStatusPill('db-status', d.database && d.database.connected ? 'Connected' : 'Unavailable', d.database && d.database.connected ? 'ok' : 'err');
      setStatusPill('scheduler-status', d.scheduler && d.scheduler.enabled ? 'Enabled' : 'Disabled', d.scheduler && d.scheduler.enabled ? 'ok' : 'warn');
    } else {
      setStatusPill('health-status', 'Unreachable', 'err');
    }
  }

  window.CyflowSocial = {
    apiRequest: apiRequest,
    getCsrfToken: getCsrfToken,
    clearCachedCsrfToken: clearCachedCsrfToken,
    me: me,
    handleUnauthorized: handleUnauthorized,
    errorMessage: errorMessage,
    createSafeNotice: createSafeNotice,
    setButtonLoading: setButtonLoading,
    setText: setText,
    setStatusPill: setStatusPill,
    refreshHealth: refreshHealth,
  };

  // Prime the CSRF token early so the first form submit has it ready.
  document.addEventListener('DOMContentLoaded', function () {
    getCsrfToken();
  });
})();
