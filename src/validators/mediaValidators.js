/**
 * Validators for the media library API.
 *
 * The upload body itself is a multipart file, validated from its BYTES in the
 * service — express-validator never sees it. These cover the id param, the alt
 * text, and the attach/detach reference shape.
 */

import { body, param } from 'express-validator';

const idPattern = /^\d{1,20}$/;

/** Reference types the API accepts — mirrors the media_asset_references ENUM. */
export const MEDIA_REFERENCE_TYPES = ['planner_run_item', 'scheduled_post'];

export const mediaIdParamValidator = [
  param('id').matches(idPattern).withMessage('Invalid media id'),
];

export const mediaAltValidator = [
  ...mediaIdParamValidator,
  body('altText').optional({ nullable: true }).isString().isLength({ max: 500 }).withMessage('Alt text is too long'),
];

export const mediaReferenceValidator = [
  ...mediaIdParamValidator,
  body('referenceType').isIn(MEDIA_REFERENCE_TYPES).withMessage('Unsupported reference type'),
  body('referenceId').matches(idPattern).withMessage('Invalid reference id'),
];

export default { mediaIdParamValidator, mediaAltValidator, mediaReferenceValidator, MEDIA_REFERENCE_TYPES };
