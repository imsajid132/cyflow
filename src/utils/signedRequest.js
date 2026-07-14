/**
 * Meta/Threads `signed_request` verification.
 *
 * A signed_request is `<base64url-signature>.<base64url-payload>` where the
 * signature is HMAC-SHA256 of the encoded payload using the app secret. This
 * verifies the signature in constant time and returns the decoded payload.
 *
 * SECURITY: never logs the signed_request, the secret, the signature, or any
 * decoded personal data. Throws a generic ValidationError on any problem.
 */

import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

import { ValidationError } from './errors.js';

/**
 * Parse and verify a signed_request.
 * @param {string} signedRequest
 * @param {string} appSecret
 * @returns {{ user_id?: string, algorithm?: string, issued_at?: number }} decoded payload
 */
export function parseSignedRequest(signedRequest, appSecret) {
  if (typeof appSecret !== 'string' || appSecret.length === 0) {
    // Configuration problem — surface as a generic validation error (never leak).
    throw new ValidationError('Signed request could not be verified');
  }
  if (typeof signedRequest !== 'string' || signedRequest.length === 0) {
    throw new ValidationError('Missing signed_request');
  }

  const parts = signedRequest.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ValidationError('Malformed signed_request');
  }
  const [encodedSig, encodedPayload] = parts;

  let providedSig;
  try {
    providedSig = Buffer.from(encodedSig, 'base64url');
  } catch {
    throw new ValidationError('Malformed signed_request');
  }

  const expectedSig = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();

  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    throw new ValidationError('Invalid signed_request signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('Malformed signed_request payload');
  }

  if (payload && payload.algorithm && String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256') {
    throw new ValidationError('Unsupported signed_request algorithm');
  }

  return payload;
}

export default { parseSignedRequest };
