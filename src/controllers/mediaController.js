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
import { createMediaLibraryService } from '../services/mediaLibraryService.js';

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

export function createMediaController({
  mediaAssetService = defaultMediaService,
  mediaLibraryService = createMediaLibraryService(),
} = {}) {
  /**
   * Serve an asset by its opaque public token.
   *
   * A LOCAL upload's bytes are read from private storage and streamed directly
   * with a safe, sniff-proof Content-Type. An HCTI asset keeps its existing
   * proxy path. Neither exposes a filesystem path, a storage key, a user id, or
   * upstream query strings — the token is the only handle, and it is unguessable
   * and can be revoked by deleting the asset.
   */
  async function serveMedia(req, res) {
    const token = req.params.publicToken;
    try {
      // Local upload first: read validated bytes from storage.
      const local = await mediaLibraryService.readByPublicToken(token).catch(() => null);
      if (local && local.driver === 'local' && local.buffer) {
        res.status(200);
        // The Content-Type comes from the asset's VALIDATED mime, never from the
        // client. nosniff stops the browser second-guessing it.
        res.setHeader('Content-Type', local.contentType || 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.setHeader('Content-Length', String(local.buffer.length));
        return res.end(local.buffer);
      }

      // Otherwise the HCTI proxy path, unchanged.
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
