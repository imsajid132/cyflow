/**
 * Validation & sanitization helpers.
 *
 * Small, dependency-light utilities usable both inside express-validator chains
 * and in service code. HTML sanitization uses `sanitize-html`.
 */

import sanitizeHtmlLib from 'sanitize-html';
import {
  PROVIDER_VALUES,
  ACCOUNT_TYPE_VALUES,
  SUPPORTED_PROVIDER_ACCOUNTS,
} from '../config/constants.js';

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True for a syntactically plausible email of reasonable length. */
export function isEmail(value) {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    EMAIL_RE.test(value)
  );
}

/** Lowercase & trim an email for consistent storage/lookup. */
export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Trim and collapse a value to a bounded plain string. */
export function toBoundedString(value, maxLength) {
  const s = value == null ? '' : String(value).trim();
  if (typeof maxLength === 'number' && s.length > maxLength) {
    return s.slice(0, maxLength);
  }
  return s;
}

/** True when a non-empty string within [min, max] length. */
export function isNonEmptyString(value, { min = 1, max = Infinity } = {}) {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max;
}

/** Strip ALL HTML — returns text-only content. */
export function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return sanitizeHtmlLib(value, { allowedTags: [], allowedAttributes: {} }).trim();
}

/**
 * Sanitize user-authored HTML to a conservative allow-list. Intended for
 * template HTML fed to image generation later; scripts/styles/handlers removed.
 * @param {string} value
 * @returns {string}
 */
export function sanitizeUserHtml(value) {
  if (typeof value !== 'string') return '';
  return sanitizeHtmlLib(value, {
    allowedTags: sanitizeHtmlLib.defaults.allowedTags.concat([
      'img',
      'h1',
      'h2',
      'span',
      'section',
      'header',
      'footer',
      'figure',
      'figcaption',
    ]),
    allowedAttributes: {
      '*': ['class', 'id', 'style'],
      img: ['src', 'alt', 'width', 'height'],
      a: ['href', 'name', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'data'],
    // Never allow inline event handlers or scripts.
    disallowedTagsMode: 'discard',
  });
}

/** True if a supported provider identifier. */
export function isSupportedProvider(provider) {
  return PROVIDER_VALUES.includes(provider);
}

/** True if a supported account_type identifier. */
export function isSupportedAccountType(accountType) {
  return ACCOUNT_TYPE_VALUES.includes(accountType);
}

/** True if (provider, accountType) is one of the allowed v1 combinations. */
export function isSupportedProviderAccount(provider, accountType) {
  return SUPPORTED_PROVIDER_ACCOUNTS.some(
    (combo) => combo.provider === provider && combo.accountType === accountType,
  );
}

/** Parse a positive integer within optional bounds, else return fallback. */
export function toPositiveInt(value, { fallback = null, min = 1, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export default {
  isEmail,
  normalizeEmail,
  toBoundedString,
  isNonEmptyString,
  stripHtml,
  sanitizeUserHtml,
  isSupportedProvider,
  isSupportedAccountType,
  isSupportedProviderAccount,
  toPositiveInt,
};
