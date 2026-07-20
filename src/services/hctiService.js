/**
 * HCTI (htmlcsstoimage.com) service.
 *
 * Uses per-request, user-supplied credentials via HTTP Basic auth. It NEVER
 * reads HCTI credentials from the environment, never logs them, never includes
 * the Basic auth value in thrown errors, and never surfaces raw provider
 * response bodies (which could echo input). `fetch` is injectable so the
 * classification logic can be unit-tested without the live API.
 *
 * NOTE: `testCredentials` performs a real (tiny) render and may consume ONE
 * HCTI render/operation against the user's account.
 */

import { Buffer } from 'node:buffer';

import { config } from '../config/env.js';
import { ValidationError } from '../utils/errors.js';
import { PROVIDER_ERROR_CATEGORY as CAT, PROVIDER_NAMES } from '../config/constants.js';
import { ProviderError, normalizeProviderError, classifyHttpStatus } from '../utils/providerErrors.js';

const HCTI = PROVIDER_NAMES.HCTI;
const OP = 'render_social_image';

/** A normalized HCTI ProviderError for a given category + status. */
function hctiError(category, httpStatus, userMessage) {
  return new ProviderError({
    provider: HCTI, operation: OP, category, httpStatus, userMessage,
  });
}

// A minimal, safe template used only to validate credentials.
const TEST_HTML = '<div style="width:8px;height:8px;background:#111"></div>';

function basicAuthHeader(userId, apiKey) {
  return `Basic ${Buffer.from(`${userId}:${apiKey}`).toString('base64')}`;
}

/**
 * Map an HTTP status to a normalized, credential-free ProviderError.
 *
 * HCTI returns 402 specifically when an account is out of render credits or has
 * an unpaid balance, so 402 refines to `credits_exhausted` rather than the
 * generic `payment_required` — that is the exact "No image" cause the operator
 * needs to see. Everything else uses the shared status classifier.
 */
function classifyStatus(status) {
  if (status === 402) return hctiError(CAT.CREDITS_EXHAUSTED, 402);
  return new ProviderError({
    provider: HCTI,
    operation: OP,
    category: classifyHttpStatus(status),
    httpStatus: status,
  });
}

/**
 * The normalized category for a thrown HCTI error. Kept exported for callers
 * that still ask for a token; a ProviderError already knows its category.
 */
export function classificationOf(err) {
  if (err instanceof ProviderError) return err.category;
  return normalizeProviderError(err, { provider: HCTI, operation: OP }).category;
}

export function createHctiService({ fetchImpl = globalThis.fetch } = {}) {
  /**
   * Render an image via HCTI and return { imageId, url }. Throws classified,
   * credential-free errors on failure. Used by generateImage + testCredentials.
   */
  async function renderImage({
    hctiUserId,
    hctiApiKey,
    html,
    css,
    viewportWidth,
    viewportHeight,
  }) {
    if (typeof hctiUserId !== 'string' || hctiUserId.length === 0) {
      throw new ValidationError('HCTI User ID is required');
    }
    if (typeof hctiApiKey !== 'string' || hctiApiKey.length === 0) {
      throw new ValidationError('HCTI API Key is required');
    }
    if (typeof html !== 'string' || html.length === 0) {
      throw new ValidationError('HTML content is required');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.hcti.requestTimeoutMs);

    const body = { html };
    if (css) body.css = css;
    if (viewportWidth) body.viewport_width = viewportWidth;
    if (viewportHeight) body.viewport_height = viewportHeight;

    let res;
    try {
      res = await fetchImpl(`${config.hcti.baseUrl}/image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: basicAuthHeader(hctiUserId, hctiApiKey),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // Never include the request (which carries the Authorization header).
      if (err instanceof ProviderError) throw err;
      if (err && err.name === 'AbortError') throw hctiError(CAT.NETWORK_TIMEOUT, null);
      throw hctiError(CAT.NETWORK_FAILURE, null);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw classifyStatus(res.status);
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      throw hctiError(CAT.RESPONSE_INVALID, null);
    }

    const url = payload && typeof payload.url === 'string' ? payload.url : null;
    const imageId = payload && typeof payload.id === 'string' ? payload.id : null;
    if (!url || !imageId) {
      throw hctiError(CAT.RESPONSE_INVALID, null);
    }
    // Validate the URL shape.
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      throw hctiError(CAT.RESPONSE_INVALID, null);
    }

    return { imageId, url };
  }

  /**
   * Generate an image from dynamic, caller-supplied credentials + template.
   * Throws classified errors on failure. (Used by later phases.)
   */
  async function generateImage({
    hctiUserId,
    hctiApiKey,
    html,
    css,
    viewportWidth,
    viewportHeight,
  }) {
    return renderImage({ hctiUserId, hctiApiKey, html, css, viewportWidth, viewportHeight });
  }

  /**
   * Validate credentials by performing a tiny real render. Returns a SAFE
   * result object (never throws for expected provider responses). May consume
   * one HCTI render against the user's account.
   * @returns {Promise<{success:boolean, imageId?:string, message:string, classification?:string}>}
   */
  async function testCredentials({ hctiUserId, hctiApiKey }) {
    try {
      const { imageId } = await renderImage({
        hctiUserId,
        hctiApiKey,
        html: TEST_HTML,
        viewportWidth: 16,
        viewportHeight: 16,
      });
      return { success: true, imageId, message: 'HCTI credentials verified successfully.' };
    } catch (err) {
      // Normalize to the shared safe model so the Integrations "Test connection"
      // result classifies auth / permission / credits / rate / network the same
      // way the render path does — and never echoes a provider body.
      const pe = normalizeProviderError(err, { provider: HCTI, operation: 'test_credentials' });
      return {
        success: false,
        classification: pe.category,
        category: pe.category,
        httpStatus: pe.httpStatus,
        retryable: pe.retryable,
        message: pe.userMessage,
      };
    }
  }

  return { generateImage, testCredentials, renderImage };
}

export const hctiService = createHctiService();
export default hctiService;
