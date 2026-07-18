/**
 * Validators for account export/deletion (G). The deletion gate requires the
 * current password AND a literal typed confirmation, so a single stray click can
 * never delete an account. Values are never echoed back.
 */

import { body } from 'express-validator';

export const accountDeletionValidator = [
  body('currentPassword').isString().withMessage('Your password is required').bail().isLength({ min: 1, max: 200 }),
  body('confirmText').isString().withMessage('Confirmation is required').bail()
    .custom((v) => v === 'DELETE').withMessage('Type DELETE to confirm'),
  body('reason').optional({ nullable: true }).isString().isLength({ max: 255 }),
];

export default { accountDeletionValidator };
