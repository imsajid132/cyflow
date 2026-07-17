/**
 * Media library controller.
 *
 * Thin: identity is always req.user.id, every rule lives in mediaLibraryService.
 * The upload handler receives the validated multipart file on req.file (memory
 * storage) and passes only its bytes and safe metadata to the service.
 */

import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export function createMediaLibraryController({ mediaLibraryService }) {
  const upload = asyncHandler(async (req, res) => {
    // multer put the file on req.file. The route rejects a missing/oversized/
    // multi-file upload before here; this is the last, service-side check.
    const file = req.file
      ? { buffer: req.file.buffer, originalName: req.file.originalname, declaredMime: req.file.mimetype }
      : null;
    const asset = await mediaLibraryService.uploadImage(req.user.id, file, { req });
    return sendSuccess(res, { media: asset }, 201);
  });

  const list = asyncHandler(async (req, res) => {
    const media = await mediaLibraryService.listMedia(req.user.id);
    return sendSuccess(res, { media });
  });

  const get = asyncHandler(async (req, res) => {
    const media = await mediaLibraryService.getMedia(req.user.id, req.params.id);
    return sendSuccess(res, { media });
  });

  const updateAlt = asyncHandler(async (req, res) => {
    const media = await mediaLibraryService.updateAltText(req.user.id, req.params.id, req.body.altText, { req });
    return sendSuccess(res, { media });
  });

  const remove = asyncHandler(async (req, res) => {
    const result = await mediaLibraryService.deleteMedia(req.user.id, req.params.id, { req });
    return sendSuccess(res, result);
  });

  const attach = asyncHandler(async (req, res) => {
    const result = await mediaLibraryService.attach(
      req.user.id, req.params.id, req.body.referenceType, req.body.referenceId, { req },
    );
    return sendSuccess(res, result);
  });

  const detach = asyncHandler(async (req, res) => {
    const result = await mediaLibraryService.detach(
      req.user.id, req.params.id, req.body.referenceType, req.body.referenceId, { req },
    );
    return sendSuccess(res, result);
  });

  return { upload, list, get, updateAlt, remove, attach, detach };
}

export default createMediaLibraryController;
