/**
 * Provider publishing adapters (D2) — Facebook Pages, Instagram Professional,
 * Threads. One shared contract, three implementations.
 *
 * Contract (all async, all NORMALIZED — they never throw for a provider error
 * and never return a raw token or raw provider body):
 *   getCapabilities()                      -> the registry entry
 *   preflight({ caption, mediaUrl })       -> { ok } | { ok:false, category, reason }
 *   publish({ providerAccountId, accessToken, caption, mediaUrl })
 *   getPublishStatus({ providerAccountId, accessToken, containerId })
 *   reconcile({ providerAccountId, accessToken, containerId, providerPostId })
 *   classifyError(status, data)            -> a safe PUBLISH_ERROR_CATEGORY
 *
 * publish/reconcile return:
 *   { status, providerPostId?, providerContainerId?, providerRequestId?,
 *     providerStatus?, errorCategory?, safeMessage? }
 * where status is one of ADAPTER_RESULT (submitted|published|retryable_failure|
 * permanent_failure|unknown_result).
 *
 * HTTP goes through the injected `http` (the SSRF-guarded providerHttp client),
 * so tests inject a fake fetchImpl. The access token is sent as a Bearer header,
 * never in the URL or body, so it cannot leak into a log or error.
 */

import {
  ADAPTER_RESULT, PUBLISH_ERROR_CATEGORY, PLATFORMS,
} from '../config/constants.js';
import { capabilityFor, checkPublishReadiness } from './providerCapabilities.js';

/** Map an HTTP status (and best-effort body code) to a safe category. */
function classifyStatus(status) {
  if (status === 401) return PUBLISH_ERROR_CATEGORY.AUTHENTICATION_REQUIRED;
  if (status === 403) return PUBLISH_ERROR_CATEGORY.PERMISSION_REQUIRED;
  if (status === 429) return PUBLISH_ERROR_CATEGORY.RATE_LIMITED;
  if (status === 400 || status === 422) return PUBLISH_ERROR_CATEGORY.VALIDATION_FAILED;
  if (status >= 500) return PUBLISH_ERROR_CATEGORY.PROVIDER_TRANSIENT;
  if (status === 404) return PUBLISH_ERROR_CATEGORY.ACCOUNT_UNAVAILABLE;
  return PUBLISH_ERROR_CATEGORY.PROVIDER_PERMANENT;
}

/** A SAFE, user-facing message per category — never a raw provider body. */
const SAFE_MESSAGE = Object.freeze({
  [PUBLISH_ERROR_CATEGORY.AUTHENTICATION_REQUIRED]: 'The account needs to be reconnected.',
  [PUBLISH_ERROR_CATEGORY.PERMISSION_REQUIRED]: 'This account is missing a required permission. Reconnect it to grant publishing.',
  [PUBLISH_ERROR_CATEGORY.ACCOUNT_UNAVAILABLE]: 'The selected account is no longer available.',
  [PUBLISH_ERROR_CATEGORY.MEDIA_REQUIRED]: 'This platform requires an image.',
  [PUBLISH_ERROR_CATEGORY.MEDIA_UNAVAILABLE]: 'The image could not be reached by the provider.',
  [PUBLISH_ERROR_CATEGORY.VALIDATION_FAILED]: 'The provider rejected this post.',
  [PUBLISH_ERROR_CATEGORY.RATE_LIMITED]: 'The provider is rate limiting requests. It will retry shortly.',
  [PUBLISH_ERROR_CATEGORY.PROVIDER_TRANSIENT]: 'The provider is temporarily unavailable. It will retry.',
  [PUBLISH_ERROR_CATEGORY.PROVIDER_PERMANENT]: 'The provider rejected this post.',
  [PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN]: 'The result is uncertain; it will be reconciled with the provider.',
  [PUBLISH_ERROR_CATEGORY.CONFIGURATION_ERROR]: 'This account cannot be published to.',
});
export const safeMessageFor = (category) => SAFE_MESSAGE[category] || 'Publishing could not be completed.';

const fail = (category) => ({
  status: (category === PUBLISH_ERROR_CATEGORY.RATE_LIMITED
    || category === PUBLISH_ERROR_CATEGORY.PROVIDER_TRANSIENT)
    ? ADAPTER_RESULT.RETRYABLE_FAILURE : ADAPTER_RESULT.PERMANENT_FAILURE,
  errorCategory: category,
  safeMessage: safeMessageFor(category),
});

/**
 * Shared adapter behaviour. `graphBase()` and the publish flow differ per
 * provider; everything else (preflight, classify) is common.
 */
function baseAdapter({ platform, http, config, graphBase, doPublish, doReconcile }) {
  const cap = capabilityFor(platform);
  const timeout = config?.publishing?.requestTimeoutMs ?? 30000;

  async function preflight({ caption, mediaUrl }) {
    return checkPublishReadiness({ accountType: cap.accountType, hasMedia: Boolean(mediaUrl), caption });
  }

  /** A guarded POST that never throws and never leaks the token. */
  async function post(url, form, accessToken) {
    try {
      const res = await http.request({
        url, method: 'POST', form, timeout,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res; // { ok, status, data }
    } catch {
      // Network / abort — an UNKNOWN result, never assume rejected.
      return { ok: false, status: 0, data: null, networkError: true };
    }
  }

  async function get(url, accessToken) {
    try {
      return await http.request({ url, method: 'GET', timeout, headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      return { ok: false, status: 0, data: null, networkError: true };
    }
  }

  return {
    platform,
    getCapabilities: () => cap,
    preflight,
    classifyError: classifyStatus,
    publish: (ctx) => doPublish({ ...ctx, cap, graphBase: graphBase(), post, get }),
    reconcile: doReconcile
      ? (ctx) => doReconcile({ ...ctx, cap, graphBase: graphBase(), get })
      : async () => ({ status: ADAPTER_RESULT.UNKNOWN_RESULT }),
    getPublishStatus: async ({ containerId, accessToken }) => {
      const res = await get(`${graphBase()}/${encodeURIComponent(containerId)}?fields=status_code,status`, accessToken);
      return res.ok ? { providerStatus: res.data?.status_code || res.data?.status || null } : { providerStatus: null };
    },
  };
}

/** Facebook Page: synchronous /feed (text) or /photos (image). */
function facebookAdapter({ http, config }) {
  const version = config?.providers?.meta?.graphVersion || '';
  const graphBase = () => `https://graph.facebook.com/${version}`;
  return baseAdapter({
    platform: PLATFORMS.FACEBOOK, http, config, graphBase,
    async doPublish({ providerAccountId, accessToken, caption, mediaUrl, graphBase: base, post }) {
      const path = mediaUrl ? 'photos' : 'feed';
      const form = mediaUrl ? { url: mediaUrl, caption: caption || '' } : { message: caption || '' };
      const res = await post(`${base}/${encodeURIComponent(providerAccountId)}/${path}`, form, accessToken);
      if (res.networkError) return { status: ADAPTER_RESULT.UNKNOWN_RESULT, errorCategory: PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN, safeMessage: safeMessageFor(PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN) };
      if (!res.ok) return fail(classifyStatus(res.status));
      const providerPostId = res.data?.post_id || res.data?.id || null;
      if (!providerPostId) return { status: ADAPTER_RESULT.UNKNOWN_RESULT, errorCategory: PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN, safeMessage: safeMessageFor(PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN) };
      return { status: ADAPTER_RESULT.PUBLISHED, providerPostId, providerStatus: 'published' };
    },
  });
}

/** Instagram Professional: container create -> media_publish. */
function instagramAdapter({ http, config }) {
  const version = config?.providers?.instagram?.graphVersion || '';
  const graphBase = () => `https://graph.instagram.com/${version}`;
  return baseAdapter({
    platform: PLATFORMS.INSTAGRAM, http, config, graphBase,
    async doPublish({ providerAccountId, accessToken, caption, mediaUrl, graphBase: base, post }) {
      if (!mediaUrl) return fail(PUBLISH_ERROR_CATEGORY.MEDIA_REQUIRED);
      // 1) create the container
      const create = await post(`${base}/${encodeURIComponent(providerAccountId)}/media`, { image_url: mediaUrl, caption: caption || '' }, accessToken);
      if (create.networkError) return { status: ADAPTER_RESULT.UNKNOWN_RESULT, errorCategory: PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN, safeMessage: safeMessageFor(PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN) };
      if (!create.ok) return fail(classifyStatus(create.status));
      const containerId = create.data?.id;
      if (!containerId) return fail(PUBLISH_ERROR_CATEGORY.PROVIDER_PERMANENT);
      // 2) publish the container
      const publish = await post(`${base}/${encodeURIComponent(providerAccountId)}/media_publish`, { creation_id: containerId }, accessToken);
      if (publish.networkError) {
        // The container exists but the publish result is uncertain — SUBMITTED,
        // reconcile against the container (never blindly recreate).
        return { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: containerId, errorCategory: PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN };
      }
      if (!publish.ok) {
        // A transient publish error is retryable with the SAME container.
        const category = classifyStatus(publish.status);
        if (category === PUBLISH_ERROR_CATEGORY.RATE_LIMITED || category === PUBLISH_ERROR_CATEGORY.PROVIDER_TRANSIENT) {
          return { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: containerId, errorCategory: category };
        }
        return { ...fail(category), providerContainerId: containerId };
      }
      const providerPostId = publish.data?.id || null;
      return { status: ADAPTER_RESULT.PUBLISHED, providerContainerId: containerId, providerPostId, providerStatus: 'published' };
    },
    async doReconcile({ providerAccountId, accessToken, containerId, graphBase: base, get }) {
      if (!containerId) return { status: ADAPTER_RESULT.UNKNOWN_RESULT };
      const res = await get(`${base}/${encodeURIComponent(containerId)}?fields=status_code,status`, accessToken);
      if (res.networkError) return { status: ADAPTER_RESULT.UNKNOWN_RESULT };
      if (!res.ok) return fail(classifyStatus(res.status));
      const code = res.data?.status_code || res.data?.status;
      if (code === 'FINISHED' || code === 'PUBLISHED') return { status: ADAPTER_RESULT.PUBLISHED, providerContainerId: containerId, providerStatus: String(code) };
      if (code === 'ERROR' || code === 'EXPIRED') return { ...fail(PUBLISH_ERROR_CATEGORY.PROVIDER_PERMANENT), providerContainerId: containerId };
      return { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: containerId, providerStatus: String(code || 'IN_PROGRESS') };
    },
  });
}

/** Threads: /threads container -> /threads_publish. */
function threadsAdapter({ http, config }) {
  const version = config?.providers?.threads?.graphVersion || '';
  const graphBase = () => `https://graph.threads.net/${version}`;
  return baseAdapter({
    platform: PLATFORMS.THREADS, http, config, graphBase,
    async doPublish({ providerAccountId, accessToken, caption, mediaUrl, graphBase: base, post }) {
      const form = mediaUrl
        ? { media_type: 'IMAGE', image_url: mediaUrl, text: caption || '' }
        : { media_type: 'TEXT', text: caption || '' };
      const create = await post(`${base}/${encodeURIComponent(providerAccountId)}/threads`, form, accessToken);
      if (create.networkError) return { status: ADAPTER_RESULT.UNKNOWN_RESULT, errorCategory: PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN, safeMessage: safeMessageFor(PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN) };
      if (!create.ok) return fail(classifyStatus(create.status));
      const containerId = create.data?.id;
      if (!containerId) return fail(PUBLISH_ERROR_CATEGORY.PROVIDER_PERMANENT);
      const publish = await post(`${base}/${encodeURIComponent(providerAccountId)}/threads_publish`, { creation_id: containerId }, accessToken);
      if (publish.networkError) return { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: containerId, errorCategory: PUBLISH_ERROR_CATEGORY.TIMEOUT_UNKNOWN };
      if (!publish.ok) {
        const category = classifyStatus(publish.status);
        if (category === PUBLISH_ERROR_CATEGORY.RATE_LIMITED || category === PUBLISH_ERROR_CATEGORY.PROVIDER_TRANSIENT) {
          return { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: containerId, errorCategory: category };
        }
        return { ...fail(category), providerContainerId: containerId };
      }
      const providerPostId = publish.data?.id || null;
      return { status: ADAPTER_RESULT.PUBLISHED, providerContainerId: containerId, providerPostId, providerStatus: 'published' };
    },
    async doReconcile({ providerAccountId, accessToken, containerId, graphBase: base, get }) {
      if (!containerId) return { status: ADAPTER_RESULT.UNKNOWN_RESULT };
      const res = await get(`${base}/${encodeURIComponent(containerId)}?fields=status`, accessToken);
      if (res.networkError) return { status: ADAPTER_RESULT.UNKNOWN_RESULT };
      if (!res.ok) return fail(classifyStatus(res.status));
      const code = res.data?.status;
      if (code === 'FINISHED' || code === 'PUBLISHED') return { status: ADAPTER_RESULT.PUBLISHED, providerContainerId: containerId, providerStatus: String(code) };
      if (code === 'ERROR' || code === 'EXPIRED') return { ...fail(PUBLISH_ERROR_CATEGORY.PROVIDER_PERMANENT), providerContainerId: containerId };
      return { status: ADAPTER_RESULT.SUBMITTED, providerContainerId: containerId, providerStatus: String(code || 'IN_PROGRESS') };
    },
  });
}

/** Build the { facebook, instagram, threads } adapter map from an http client. */
export function createAdapters({ http, config }) {
  return {
    [PLATFORMS.FACEBOOK]: facebookAdapter({ http, config }),
    [PLATFORMS.INSTAGRAM]: instagramAdapter({ http, config }),
    [PLATFORMS.THREADS]: threadsAdapter({ http, config }),
  };
}

export default { createAdapters, safeMessageFor };
