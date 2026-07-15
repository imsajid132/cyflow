/**
 * Same-origin API client.
 *
 * The CSRF token lives in memory ONLY — never localStorage/sessionStorage.
 * No auth tokens, captions, credentials, or website extracts are ever persisted
 * in browser storage. Never throws on HTTP errors; callers branch on `ok`.
 */

let csrfToken = null;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function clearCachedCsrfToken() {
  csrfToken = null;
}

export async function getCsrfToken({ forceRefresh = false } = {}) {
  if (csrfToken && !forceRefresh) return csrfToken;
  try {
    const res = await fetch('/api/csrf-token', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.data?.csrfToken) {
      csrfToken = data.data.csrfToken;
      return csrfToken;
    }
  } catch {
    /* network error → null below */
  }
  return null;
}

/**
 * @returns {Promise<{ok:boolean,status:number,data:any,unauthorized?:boolean,networkError?:boolean}>}
 */
export async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const init = { method, credentials: 'same-origin', headers };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  if (STATE_CHANGING.has(method)) {
    const token = await getCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    // Never log the request body — it may contain user content.
    return { ok: false, status: 0, data: null, networkError: true };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401) return { ok: false, status: 401, data, unauthorized: true };
  return { ok: res.ok, status: res.status, data };
}

/** Unwrap `{ success, data }` → data, or null. */
export function payload(result) {
  return result?.data?.data ?? null;
}

/** A safe, human-readable message from an API result. */
export function errorMessage(result, fallback = 'Something went wrong. Please try again.') {
  const message = result?.data?.error?.message;
  if (typeof message === 'string' && message) return message;
  if (result?.networkError) return 'Network error. Please try again.';
  return fallback;
}

/** Field-level validation errors, keyed by field name. */
export function fieldErrors(result) {
  const details = result?.data?.error?.details;
  const out = {};
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && typeof d.field === 'string' && !out[d.field]) out[d.field] = String(d.message || 'Invalid');
    }
  }
  return out;
}

// --- convenience endpoints -------------------------------------------------

export async function me() {
  const res = await apiRequest('/api/auth/me');
  return payload(res)?.user ?? null;
}

export async function onboardingState() {
  const res = await apiRequest('/api/business-profile/onboarding-state');
  return payload(res);
}

export async function businessProfile() {
  const res = await apiRequest('/api/business-profile');
  return payload(res)?.profile ?? null;
}

// --- planner ---------------------------------------------------------------

export async function plannerPreferences() {
  const res = await apiRequest('/api/planner/preferences');
  return payload(res)?.preferences ?? null;
}

export async function plannerPlans({ limit = 20 } = {}) {
  const res = await apiRequest(`/api/planner/plans?limit=${encodeURIComponent(limit)}`);
  return payload(res)?.plans ?? [];
}

export async function plannerPlan(runId) {
  const res = await apiRequest(`/api/planner/plans/${encodeURIComponent(runId)}`);
  return res;
}

/** The full IANA catalogue, with offsets computed for the planning date. */
export async function plannerTimezones({ search = '', forDate = '', limit = 0 } = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (forDate) params.set('forDate', forDate);
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  const res = await apiRequest(`/api/planner/timezones${query ? `?${query}` : ''}`);
  return payload(res)?.timezones ?? [];
}

/** What a plan WOULD create. Never generates anything. */
export async function plannerSummary(body) {
  const res = await apiRequest('/api/planner/plans/summary', { method: 'POST', body });
  return res;
}

/** What deleting a plan would do, for the confirmation. */
export async function plannerDeletionImpact(runId) {
  const res = await apiRequest(`/api/planner/plans/${encodeURIComponent(runId)}/deletion-impact`);
  return res;
}

export default {
  apiRequest, getCsrfToken, clearCachedCsrfToken, me, payload, errorMessage, fieldErrors,
  plannerPreferences, plannerPlans, plannerPlan, plannerTimezones, plannerSummary,
  plannerDeletionImpact,
};
