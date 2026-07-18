/**
 * Account controller (factory) — user data export + account deletion (G).
 * Ownership is always the session user; the export download is session-gated
 * (no token in the URL) and never exposes storage keys or raw provider data.
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

// accountDataService is always injected by the container (it has no config-free
// singleton — building it eagerly would load env at import time).
export function createAccountController({ accountDataService } = {}) {
  const requestExport = asyncHandler(async (req, res) => {
    const exportRow = await accountDataService.requestExport(req.user.id, { req });
    return sendSuccess(res, { export: exportRow }, 202);
  });

  const getExport = asyncHandler(async (req, res) => {
    const exportRow = await accountDataService.getExport(req.user.id);
    return sendSuccess(res, { export: exportRow });
  });

  const downloadExport = asyncHandler(async (req, res) => {
    const { buffer, filename, contentType } = await accountDataService.downloadExport(req.user.id);
    res.status(200);
    res.setHeader('Content-Type', contentType || 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(buffer.length));
    return res.end(buffer);
  });

  const requestDeletion = asyncHandler(async (req, res) => {
    const result = await accountDataService.requestDeletion(req.user.id, {
      currentPassword: req.body.currentPassword,
      confirmText: req.body.confirmText,
      reason: req.body.reason,
    }, { req });
    return sendSuccess(res, result, 202);
  });

  const getDeletion = asyncHandler(async (req, res) => {
    const deletion = await accountDataService.getDeletion(req.user.id);
    return sendSuccess(res, { deletion });
  });

  return { requestExport, getExport, downloadExport, requestDeletion, getDeletion };
}

export default createAccountController;
