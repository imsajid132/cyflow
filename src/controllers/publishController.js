/**
 * Publishing controller (factory) — the D2 per-target actions the Queue exposes:
 * retry a failed target, cancel a pending target, and read a target's SAFE
 * publish-attempt history. Ownership is the session user; nothing sensitive is
 * ever returned.
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ConflictError } from '../utils/errors.js';

export function createPublishController({ publishingService } = {}) {
  const retry = asyncHandler(async (req, res) => {
    const result = await publishingService.retryTarget(req.user.id, req.params.targetId);
    if (!result.ok) throw new ConflictError(result.reason || 'This target cannot be retried.');
    return sendSuccess(res, { retried: true });
  });

  const cancel = asyncHandler(async (req, res) => {
    const result = await publishingService.cancelTarget(req.user.id, req.params.targetId);
    if (!result.ok) throw new ConflictError(result.reason || 'This target cannot be cancelled.');
    return sendSuccess(res, { cancelled: true });
  });

  const attempts = asyncHandler(async (req, res) => {
    const attempts = await publishingService.listAttempts(req.user.id, req.params.targetId);
    return sendSuccess(res, { attempts });
  });

  return { retry, cancel, attempts };
}

export default createPublishController;
