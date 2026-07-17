/**
 * Multipart parsing for a single image upload.
 *
 * multer is used ONLY to parse the multipart body into memory — never to store
 * anything. Every real check (magic bytes, dimensions, pixel cap) happens after
 * this, in imageValidation, against the bytes. multer's own limits are a cheap
 * first gate so a hostile body is dropped before it reaches the validator:
 *
 *   - memory storage: nothing is written to disk here, so there is no temp file
 *     to leak, race, or forget to clean up;
 *   - exactly ONE field named "image", exactly ONE file: extra fields and extra
 *     files are rejected, not silently ignored;
 *   - a byte ceiling from config, so an enormous upload is refused at the socket
 *     rather than buffered whole.
 *
 * multer's file.mimetype comes from the request and is NOT trusted; it is passed
 * to the validator only as a "declared" value to cross-check against the real
 * bytes, never as the answer.
 */

import multer from 'multer';

import { config as defaultConfig } from '../config/env.js';
import { ValidationError } from '../utils/errors.js';

export function createMediaUploadMiddleware({ config = defaultConfig } = {}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.media.maxUploadBytes,
      files: 1,
      fields: 4, // a little room for a stray CSRF/alt field; still bounded
    },
    fileFilter: (req, file, cb) => {
      // Only the "image" field carries a file. Anything else is a malformed
      // request, refused here rather than parsed.
      if (file.fieldname !== 'image') {
        cb(new ValidationError('Unexpected file field'));
        return;
      }
      cb(null, true);
    },
  }).single('image');

  // Wrap so multer's own errors become the app's ValidationError with a safe,
  // friendly message instead of a raw multer stack.
  return function parseSingleImage(req, res, next) {
    upload(req, res, (err) => {
      if (!err) { next(); return; }
      if (err.code === 'LIMIT_FILE_SIZE') {
        const mb = Math.floor(config.media.maxUploadBytes / (1024 * 1024));
        next(new ValidationError(`That image is too large. The maximum is ${mb} MB.`));
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        next(new ValidationError('Upload one image at a time.'));
        return;
      }
      if (err instanceof ValidationError) { next(err); return; }
      next(new ValidationError('That upload could not be read.'));
    });
  };
}

export default createMediaUploadMiddleware;
