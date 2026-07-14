/**
 * Public media controller (factory).
 *
 * Serves ready, unexpired media assets by opaque token, proxying the image from
 * the trusted HCTI host only. Sets a safe Content-Type, `X-Content-Type-Options:
 * nosniff`, and a sensible cache policy. Never exposes database ids, credentials,
 * provider responses, or upstream query strings. Returns a safe placeholder on
 * any failure.
 */

import { mediaAssetService as defaultMediaService } from '../services/mediaAssetService.js';

// 1x1 transparent PNG placeholder for unavailable media.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC',
  'base64',
);

function sendPlaceholder(res, statusCode = 404) {
  res.status(statusCode);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(PLACEHOLDER_PNG);
}

export function createMediaController({ mediaAssetService = defaultMediaService } = {}) {
  async function serveMedia(req, res) {
    const token = req.params.publicToken;
    try {
      const asset = await mediaAssetService.findServableAsset(token);
      if (!asset || !asset.sourceUrl) {
        return sendPlaceholder(res, 404);
      }
      const { buffer, contentType } = await mediaAssetService.fetchUpstreamImage(asset.sourceUrl);
      res.status(200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.setHeader('Content-Length', String(buffer.length));
      return res.end(buffer);
    } catch (err) {
      // Never leak upstream details — respond with a safe placeholder.
      const statusCode = err && Number.isInteger(err.statusCode) ? err.statusCode : 404;
      return sendPlaceholder(res, statusCode >= 400 && statusCode < 600 ? statusCode : 404);
    }
  }

  return { serveMedia };
}

export default createMediaController;
