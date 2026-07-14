/**
 * express-validator chains for social account endpoints.
 */

import { body } from 'express-validator';

export const disconnectValidator = [
  body('confirm')
    .exists({ checkNull: true })
    .withMessage('Confirmation is required')
    .bail()
    .equals('DISCONNECT')
    .withMessage('Type DISCONNECT to confirm'),
];

export default { disconnectValidator };
