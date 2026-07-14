/**
 * Encryption service — AES-256-GCM using Node's built-in `node:crypto`.
 *
 * Ciphertext format (versioned, all base64):
 *
 *     v1:<iv-base64>:<auth-tag-base64>:<ciphertext-base64>
 *
 * The 32-byte key is supplied by validated config (ENCRYPTION_KEY_BASE64).
 * Secrets are never logged; malformed or tampered payloads are rejected.
 */

import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { config } from '../config/env.js';
import { ENCRYPTION } from '../config/constants.js';
import { ConfigurationError } from '../utils/errors.js';

const { ALGORITHM, IV_BYTES, AUTH_TAG_BYTES, KEY_BYTES, PREFIX } = ENCRYPTION;

/** Resolve the AES key buffer, validating length once. */
function getKey() {
  const key = config.encryptionKey;
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    // Should never happen — env.js validates this at startup.
    throw new ConfigurationError('Encryption key is not configured correctly');
  }
  return key;
}

/**
 * Encrypt a UTF-8 plaintext string into the versioned envelope.
 * @param {string} plaintext
 * @returns {string} `v1:<iv>:<tag>:<ciphertext>`
 */
export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encryptSecret expects a string');
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a versioned envelope back to the original plaintext.
 * Throws on any malformation or authentication-tag mismatch.
 * @param {string} payload
 * @returns {string} plaintext
 */
export function decryptSecret(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('Invalid ciphertext payload');
  }
  const parts = payload.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed ciphertext: expected 4 segments');
  }
  const [version, ivB64, tagB64, dataB64] = parts;
  if (version !== PREFIX) {
    throw new Error(`Unsupported ciphertext version: ${version}`);
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  if (iv.length !== IV_BYTES) {
    throw new Error('Malformed ciphertext: bad IV length');
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('Malformed ciphertext: bad auth tag length');
  }

  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // .final() throws if the auth tag does not verify (tamper/incorrect key).
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Produce a masked, display-safe representation of a secret value.
 * Reveals at most the last 4 characters; never the middle.
 * @param {string} value
 * @returns {string} e.g. "••••1234" or "••••" for short values
 */
export function maskSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  const visible = value.length > 8 ? value.slice(-4) : '';
  return `••••${visible}`;
}

/**
 * Hash an OAuth `state` value (SHA-256, hex). Only the hash is persisted.
 * @param {string} value
 * @returns {string} 64-char lowercase hex digest
 */
export function hashOAuthState(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('hashOAuthState expects a non-empty string');
  }
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Timing-safe comparison of two strings (e.g. CSRF/state tokens).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generate a cryptographically secure random token (base64url).
 * @param {number} [bytes=32]
 * @returns {string}
 */
export function generateSecureToken(bytes = 32) {
  const n = Number.isInteger(bytes) && bytes > 0 ? bytes : 32;
  return crypto.randomBytes(n).toString('base64url');
}

export default {
  encryptSecret,
  decryptSecret,
  maskSecret,
  hashOAuthState,
  timingSafeEqual,
  generateSecureToken,
};
