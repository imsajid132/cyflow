/**
 * Hardened HTTP client for provider (OAuth/Graph) calls.
 *
 * - Native fetch (injectable for tests) with an AbortController timeout.
 * - JSON and form-urlencoded request bodies.
 * - Safe response parsing with a maximum response-size guard.
 * - Sanitized errors (OAuthError) — never echo secrets or raw bodies.
 *
 * SSRF guard: every request URL MUST be a fixed https:// application constant
 * supplied by a provider module. URLs are never taken from request input,
 * the database, or the frontend.
 */

import { config } from '../config/env.js';
import { OAuthError, OAUTH_ERROR_CODES } from './oauthErrors.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

/** Coarse status → classification (callers may refine for 400s). */
export function classifyHttpStatus(status) {
  if (status === 401) return OAUTH_ERROR_CODES.INVALID_TOKEN;
  if (status === 403) return OAUTH_ERROR_CODES.PERMISSION_DENIED;
  if (status === 429) return OAUTH_ERROR_CODES.RATE_LIMITED;
  if (status >= 500) return OAUTH_ERROR_CODES.PROVIDER_UNAVAILABLE;
  return OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE;
}

export function createProviderHttp({ fetchImpl = globalThis.fetch, timeoutMs } = {}) {
  const defaultTimeout = timeoutMs ?? config.oauth.httpTimeoutMs;

  /**
   * Perform a provider request.
   * @param {{ url:string, method?:string, headers?:object, form?:object,
   *           json?:object, timeout?:number }} opts
   * @returns {Promise<{ ok:boolean, status:number, data:any }>}
   */
  async function request(opts) {
    const { url, method = 'GET', headers = {}, form, json, timeout } = opts;

    // Defense-in-depth SSRF guard — only fixed https endpoints are allowed.
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new OAuthError(
        OAUTH_ERROR_CODES.PROVIDER_CONFIGURATION_ERROR,
        'Invalid provider endpoint',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout ?? defaultTimeout);

    const finalHeaders = Object.assign({ Accept: 'application/json' }, headers);
    let body;
    if (form) {
      finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    } else if (json) {
      finalHeaders['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }

    let res;
    try {
      res = await fetchImpl(url, { method, headers: finalHeaders, body, signal: controller.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new OAuthError(OAUTH_ERROR_CODES.PROVIDER_UNAVAILABLE, 'The provider request timed out');
      }
      // Do NOT attach the request (it carries the Authorization header).
      throw new OAuthError(OAUTH_ERROR_CODES.PROVIDER_UNAVAILABLE, 'Could not reach the provider');
    } finally {
      clearTimeout(timer);
    }

    // Response-size guard (header hint + hard cap while reading).
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE, 'Provider response too large');
    }
    let text = '';
    try {
      text = await res.text();
    } catch {
      throw new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE, 'Could not read provider response');
    }
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new OAuthError(OAUTH_ERROR_CODES.INVALID_PROVIDER_RESPONSE, 'Provider response too large');
    }

    let data = null;
    const ct = res.headers.get('content-type') || '';
    const looksJson = text.trim().startsWith('{') || text.trim().startsWith('[');
    if (ct.includes('application/json') || looksJson) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    return { ok: res.ok, status: res.status, data };
  }

  return { request };
}

export default { createProviderHttp, classifyHttpStatus };
