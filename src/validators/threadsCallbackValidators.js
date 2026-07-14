/**
 * express-validator chains for the Threads callback webhooks.
 *
 * Only presence/shape is validated here — signature verification happens in the
 * service. The signed_request value is NEVER echoed in validation output.
 */

import { body } from 'express-validator';

export const signedRequestValidator = [
  body('signed_request')
    .exists({ checkNull: true })
    .withMessage('signed_request is required')
    .bail()
    .isString()
    .withMessage('signed_request must be a string')
    .bail()
    .isLength({ min: 1, max: 8192 })
    .withMessage('signed_request is invalid'),
];

export default { signedRequestValidator };
