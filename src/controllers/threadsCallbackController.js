/**
 * Threads uninstall / data-deletion callback controller (factory).
 *
 * PUBLIC endpoints (no session/CSRF) authenticated by signed_request. The
 * data-deletion response uses the exact shape Meta requires
 * (`{ url, confirmation_code }`). The status endpoint returns a simple, non-
 * personal confirmation. Callback query/body values are never echoed.
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { threadsCallbackService as defaultService } from '../services/threadsCallbackService.js';

// Confirmation codes are base64url tokens.
const CODE_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function createThreadsCallbackController({ threadsCallbackService = defaultService } = {}) {
  const uninstall = asyncHandler(async (req, res) => {
    await threadsCallbackService.handleUninstall(req.body?.signed_request, { req });
    // Meta expects a 200 acknowledgement.
    return res.status(200).json({ success: true });
  });

  const dataDeletion = asyncHandler(async (req, res) => {
    const result = await threadsCallbackService.handleDataDeletion(req.body?.signed_request, { req });
    // Exact response shape required by Meta.
    return res.status(200).json({
      url: result.url,
      confirmation_code: result.confirmationCode,
    });
  });

  const deletionStatus = asyncHandler(async (req, res) => {
    const code = req.params.confirmationCode;
    if (typeof code !== 'string' || !CODE_RE.test(code)) {
      return res.status(404).json({ status: 'not_found', message: 'No matching deletion request was found.' });
    }
    const status = await threadsCallbackService.getDeletionStatus(code);
    if (!status) {
      return res.status(404).json({ status: 'not_found', message: 'No matching deletion request was found.' });
    }
    // Simple, non-personal confirmation.
    return res.status(200).json({
      confirmationCode: status.confirmationCode,
      status: status.status,
      message:
        status.status === 'completed'
          ? 'Your Threads data deletion request has been received and completed.'
          : 'Your Threads data deletion request has been received.',
    });
  });

  return { uninstall, dataDeletion, deletionStatus };
}

export default createThreadsCallbackController;
