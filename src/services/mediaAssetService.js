/**
 * Media asset service.
 *
 * Creates opaque-token media assets and safely proxies the underlying image
 * from the TRUSTED HCTI host only. Hardened against SSRF (host allow-list; no
 * client-supplied URLs), oversized responses, and non-image content. Never
 * exposes credentials or raw provider bodies.
 */

import { Buffer } from 'node:buffer';

import { config as defaultConfig } from '../config/env.js';
import { MEDIA_ASSET_STATUS } from '../config/constants.js';
import { AppError } from '../utils/errors.js';
import { generateSecureToken as defaultGenerateToken } from './encryptionService.js';
import * as defaultMediaRepo from '../repositories/mediaAssetRepository.js';

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export class MediaError extends AppError {
  constructor(message, statusCode = 404) {
    super(message, { statusCode, code: 'NOT_FOUND', expose: true });
  }
}

export function createMediaAssetService({
  config = defaultConfig,
  mediaRepository = defaultMediaRepo,
  fetchImpl = globalThis.fetch,
  generateSecureToken = defaultGenerateToken,
} = {}) {
  // Allow-list: the HCTI host (and its subdomains) derived from config.
  let allowedHost = 'hcti.io';
  try {
    allowedHost = new URL(config.hcti.baseUrl).host;
  } catch {
    /* keep default */
  }

  function isAllowedHost(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.host;
    return host === allowedHost || host.endsWith(`.${allowedHost}`);
  }

  function isValidPublicToken(token) {
    return typeof token === 'string' && PUBLIC_TOKEN_RE.test(token);
  }

  /** Create a READY image asset with an opaque public token. */
  async function createReadyImageAsset({ userId, sourceUrl, sourceAssetId = null, postId = null }, connection) {
    const publicToken = generateSecureToken(24);
    const asset = await mediaRepository.createMediaAsset(
      {
        userId,
        scheduledPostId: postId,
        publicToken,
        sourceProvider: 'hcti',
        sourceUrl,
        sourceAssetId,
        mimeType: 'image/png',
        fileExtension: 'png',
        status: MEDIA_ASSET_STATUS.READY,
        expiresAt: null,
      },
      connection,
    );
    return asset;
  }

  /**
   * Fetch + validate the upstream image for a READY asset. Returns
   * { buffer, contentType }. Throws MediaError on any problem.
   */
  async function fetchUpstreamImage(sourceUrl) {
    if (!sourceUrl || !isAllowedHost(sourceUrl)) {
      throw new MediaError('Media unavailable', 404);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.hcti.requestTimeoutMs);
    let res;
    try {
      res = await fetchImpl(sourceUrl, { method: 'GET', redirect: 'error', signal: controller.signal });
    } catch {
      throw new MediaError('Media unavailable', 502);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new MediaError('Media unavailable', 502);

    const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new MediaError('Media unavailable', 415);
    }

    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > config.hcti.maxImageBytes) {
      throw new MediaError('Media unavailable', 413);
    }

    let buffer;
    try {
      buffer = Buffer.from(await res.arrayBuffer());
    } catch {
      throw new MediaError('Media unavailable', 502);
    }
    if (buffer.length > config.hcti.maxImageBytes) {
      throw new MediaError('Media unavailable', 413);
    }

    return { buffer, contentType };
  }

  async function findServableAsset(publicToken) {
    if (!isValidPublicToken(publicToken)) return null;
    return mediaRepository.findReadyMediaAssetByPublicToken(publicToken);
  }

  return {
    isAllowedHost,
    isValidPublicToken,
    createReadyImageAsset,
    fetchUpstreamImage,
    findServableAsset,
  };
}

export const mediaAssetService = createMediaAssetService();
export default mediaAssetService;
