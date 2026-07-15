/**
 * Hardened fetcher for the website analyzer.
 *
 * Every request (including EVERY redirect hop) is validated: scheme, hostname,
 * DNS resolution, and all resolved IPs against private/loopback/link-local/
 * metadata ranges. Redirects are followed manually so each destination is
 * re-checked. Responses are capped by bytes and time, must be HTML, and no
 * authentication headers are ever sent. Internal fetch errors are never
 * surfaced — callers get a generic, safe error.
 */

import { config as defaultConfig } from '../config/env.js';
import { WEBSITE_ANALYSIS, LOGO_MIME_TYPES } from '../config/constants.js';
import { ValidationError, ExternalServiceError } from '../utils/errors.js';
import { assertPublicHost, isBlockedHostname } from '../utils/urlSafety.js';

const HTML_TYPES = ['text/html', 'application/xhtml+xml'];

/** Read a response body with a hard byte cap (streams when available). */
async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ExternalServiceError('The website response was too large');
  }

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ExternalServiceError('The website response was too large');
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return { bytes: merged, text: new TextDecoder('utf-8').decode(merged) };
  }

  // Fallback (used by test fakes): still capped.
  const text = await res.text();
  if (typeof text === 'string' && text.length > maxBytes) {
    throw new ExternalServiceError('The website response was too large');
  }
  return { bytes: null, text };
}

function contentTypeOf(res) {
  return String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
}

export function createWebsiteFetchService({
  config = defaultConfig,
  fetchImpl = globalThis.fetch,
  lookup = undefined,
} = {}) {
  /**
   * Fetch one URL, following redirects manually and re-validating each hop.
   * @param {URL|string} startUrl already-normalized URL
   * @param {{ accept?: string[], maxBytes?: number }} [opts]
   * @returns {Promise<{ finalUrl: URL, contentType: string, text: string, bytes: Uint8Array|null }>}
   */
  async function fetchValidated(startUrl, opts = {}) {
    const accept = opts.accept || HTML_TYPES;
    const maxBytes = opts.maxBytes || WEBSITE_ANALYSIS.MAX_PAGE_BYTES;

    let current = startUrl instanceof URL ? new URL(startUrl.toString()) : new URL(String(startUrl));
    let hops = 0;

    for (;;) {
      // --- validate this hop -------------------------------------------------
      if (current.protocol !== 'https:' && current.protocol !== 'http:') {
        throw new ValidationError('That website address cannot be analyzed');
      }
      if (config.isProd && current.protocol !== 'https:') {
        throw new ValidationError('Only secure (https) website addresses can be analyzed');
      }
      if (current.username || current.password || isBlockedHostname(current.hostname)) {
        throw new ValidationError('That website address cannot be analyzed');
      }
      // DNS + private-range check for THIS hop (redirects included).
      await assertPublicHost(current.hostname, { lookup });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBSITE_ANALYSIS.TIMEOUT_MS);
      let res;
      try {
        res = await fetchImpl(current.toString(), {
          method: 'GET',
          redirect: 'manual', // we re-validate every hop ourselves
          signal: controller.signal,
          // No credentials, no cookies, no auth headers — ever.
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': 'CyflowSocialBot/1.0 (+business profile analyzer)',
          },
        });
      } catch (err) {
        // Never surface the internal fetch/DNS error.
        if (err && err.name === 'AbortError') {
          throw new ExternalServiceError('The website took too long to respond');
        }
        throw new ExternalServiceError('That website could not be reached');
      } finally {
        clearTimeout(timer);
      }

      // --- redirects ---------------------------------------------------------
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new ExternalServiceError('That website could not be reached');
        hops += 1;
        if (hops > WEBSITE_ANALYSIS.MAX_REDIRECTS) {
          throw new ExternalServiceError('That website redirected too many times');
        }
        let next;
        try {
          next = new URL(location, current); // resolve relative redirects
        } catch {
          throw new ExternalServiceError('That website could not be reached');
        }
        next.hash = '';
        next.search = '';
        current = next;
        continue; // re-validate the new hop at the top of the loop
      }

      if (!res.ok) {
        throw new ExternalServiceError('That website could not be reached');
      }

      const contentType = contentTypeOf(res);
      if (!accept.includes(contentType)) {
        // Reject PDFs, images, downloads, executables, anything non-HTML.
        throw new ExternalServiceError('That address did not return a web page');
      }

      const { text, bytes } = await readCapped(res, maxBytes);
      return { finalUrl: current, contentType, text, bytes };
    }
  }

  /**
   * Fetch an image (logo/favicon) with MIME + size validation.
   * @returns {Promise<{ finalUrl: URL, contentType: string, bytes: Uint8Array|null, text: string }>}
   */
  async function fetchImage(startUrl) {
    return fetchValidated(startUrl, {
      accept: LOGO_MIME_TYPES,
      maxBytes: WEBSITE_ANALYSIS.MAX_LOGO_BYTES,
    });
  }

  return { fetchValidated, fetchImage };
}

export const websiteFetchService = createWebsiteFetchService();
export default websiteFetchService;
