/**
 * Centralized, validated environment configuration.
 *
 * `buildConfig(sourceEnv)` is a pure factory: it validates and coerces a plain
 * environment object and returns `{ config, providerAvailability }`, or throws
 * a sanitized (secret-free) Error listing every problem. The module also builds
 * a default `config` from `process.env` at import time so the rest of the app
 * can simply `import { config } from './config/env.js'`.
 *
 * External provider credentials (Meta / Instagram / Threads / OpenAI) are
 * OPTIONAL in development — when absent the provider is reported as unavailable
 * rather than crashing the process.
 */

import { Buffer } from 'node:buffer';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Build a validated, frozen config object from a raw environment map.
 * @param {Record<string, string | undefined>} raw
 * @returns {{ config: object, providerAvailability: object }}
 */
export function buildConfig(raw = process.env) {
  const NODE_ENV = raw.NODE_ENV || 'development';
  const IS_PROD = NODE_ENV === 'production';

  /** Accumulated, human-readable problems (never contain secret values). */
  const errors = [];

  function requireString(name, { allowEmpty = false } = {}) {
    const value = raw[name];
    if (value === undefined || value === null || (!allowEmpty && String(value).trim() === '')) {
      errors.push(`Missing required environment variable: ${name}`);
      return '';
    }
    return value;
  }

  function optionalString(name) {
    const value = raw[name];
    return value === undefined || value === null || String(value).trim() === '' ? '' : value;
  }

  function toNumber(name, { required = true, fallback, min, max, integer = true } = {}) {
    const rawValue = raw[name];
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
      if (required) errors.push(`Missing required numeric variable: ${name}`);
      return fallback;
    }
    const num = Number(rawValue);
    if (!Number.isFinite(num)) {
      errors.push(`Invalid number for ${name}`);
      return fallback;
    }
    if (integer && !Number.isInteger(num)) {
      errors.push(`Expected an integer for ${name}`);
      return fallback;
    }
    if (min !== undefined && num < min) {
      errors.push(`${name} must be >= ${min}`);
      return fallback;
    }
    if (max !== undefined && num > max) {
      errors.push(`${name} must be <= ${max}`);
      return fallback;
    }
    return num;
  }

  function toBoolean(name, fallback = false) {
    const rawValue = raw[name];
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
      return fallback;
    }
    const normalized = String(rawValue).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    errors.push(`Invalid boolean for ${name} (use true/false)`);
    return fallback;
  }

  function validateUrl(name, value, { required = true } = {}) {
    if (!value) {
      if (required) errors.push(`Missing required URL variable: ${name}`);
      return '';
    }
    try {
      // eslint-disable-next-line no-new
      new URL(value);
      return value;
    } catch {
      errors.push(`Invalid URL for ${name}`);
      return '';
    }
  }

  /** Decode ENCRYPTION_KEY_BASE64 and confirm it is exactly 32 bytes. */
  function validateEncryptionKey(name) {
    const value = raw[name];
    if (!value || String(value).trim() === '') {
      errors.push(`Missing required variable: ${name}`);
      return null;
    }
    let buf;
    try {
      buf = Buffer.from(String(value), 'base64');
    } catch {
      errors.push(`${name} is not valid base64`);
      return null;
    }
    if (buf.length !== 32) {
      errors.push(
        `${name} must decode to exactly 32 bytes (got ${buf.length}); generate one with: ` +
          `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`,
      );
      return null;
    }
    return buf;
  }

  // --- Core -----------------------------------------------------------------
  const PORT = toNumber('PORT', { required: false, fallback: 3000, min: 1, max: 65535 });
  const PUBLIC_BASE_URL = validateUrl('PUBLIC_BASE_URL', requireString('PUBLIC_BASE_URL'));

  // --- Database -------------------------------------------------------------
  const db = {
    host: requireString('DB_HOST'),
    port: toNumber('DB_PORT', { required: false, fallback: 3306, min: 1, max: 65535 }),
    user: requireString('DB_USER'),
    password: raw.DB_PASSWORD ?? '',
    database: requireString('DB_NAME'),
    connectionLimit: toNumber('DB_CONNECTION_LIMIT', {
      required: false,
      fallback: 10,
      min: 1,
      max: 100,
    }),
  };

  // --- Session & crypto -----------------------------------------------------
  const encryptionKey = validateEncryptionKey('ENCRYPTION_KEY_BASE64');
  const session = {
    secret: requireString('SESSION_SECRET'),
    cookieName: optionalString('SESSION_COOKIE_NAME') || 'cyflow_social_session',
    maxAgeMs: toNumber('SESSION_MAX_AGE_MS', {
      required: false,
      fallback: 604800000,
      min: 60000,
    }),
  };
  const bcryptRounds = toNumber('BCRYPT_ROUNDS', {
    required: false,
    fallback: 12,
    min: 8,
    max: 15,
  });

  // --- OpenAI (centralized admin key — never user-provided) ----------------
  // OpenAI is "enabled" when OPENAI_API_KEY is set. When enabled, the model
  // name MUST come from OPENAI_TEXT_MODEL — we never invent/hardcode a model.
  // In production a missing model is a hard error; in development the provider
  // is simply reported unavailable.
  const openaiKey = optionalString('OPENAI_API_KEY');
  const openaiModel = optionalString('OPENAI_TEXT_MODEL');
  const openaiEnabled = openaiKey !== '';
  if (openaiEnabled && openaiModel === '' && IS_PROD) {
    errors.push('OPENAI_TEXT_MODEL is required when OPENAI_API_KEY is set');
  }
  /*
   * OPENAI_PLANNER_MODEL is optional. Planner generation and the critic review
   * are a harder job than a one-off caption, so they may warrant a different
   * model; when it is not set they use OPENAI_TEXT_MODEL. Like the text model it
   * is never hardcoded and never defaulted to an invented name, and it is never
   * exposed to a normal user.
   */
  const openaiPlannerModel = optionalString('OPENAI_PLANNER_MODEL');
  /*
   * ALLOW_LEGACY_GLOBAL_OPENAI_KEY — a development and test convenience, and
   * nothing else.
   *
   * OPENAI_API_KEY used to serve every customer silently. It now serves nobody
   * unless an operator turns this on AND the process is not production (see
   * openaiClientResolver.legacyGlobalKeyAllowed). Default false, because the
   * safe state has to be the one you get by doing nothing.
   *
   * This is NOT a customer integration and is never presented as one. A
   * customer's key lives encrypted in user_integrations, per user.
   */
  const allowLegacyGlobalKey = optionalString('ALLOW_LEGACY_GLOBAL_OPENAI_KEY') === 'true';
  if (allowLegacyGlobalKey && IS_PROD) {
    errors.push(
      'ALLOW_LEGACY_GLOBAL_OPENAI_KEY must not be enabled in production. '
      + 'Each customer supplies their own OpenAI API key in Integrations.',
    );
  }
  const openai = {
    apiKey: openaiKey,
    // No invented default — empty string until configured.
    textModel: openaiModel,
    // Falls back to the text model rather than to a guess.
    plannerModel: openaiPlannerModel || openaiModel,
    allowLegacyGlobalKey,
    available: openaiKey !== '' && openaiModel !== '',
    requestTimeoutMs: toNumber('OPENAI_REQUEST_TIMEOUT_MS', {
      required: false,
      fallback: 45000,
      min: 1000,
    }),
    maxOutputTokens: toNumber('OPENAI_MAX_OUTPUT_TOKENS', {
      required: false,
      fallback: 1200,
      min: 1,
    }),
  };

  // --- HCTI (per-user credentials; only base config here) -------------------
  const hctiBase =
    validateUrl('HCTI_API_BASE_URL', optionalString('HCTI_API_BASE_URL') || 'https://hcti.io/v1', {
      required: false,
    }) || 'https://hcti.io/v1';
  const hcti = {
    baseUrl: hctiBase,
    requestTimeoutMs: toNumber('HCTI_REQUEST_TIMEOUT_MS', {
      required: false,
      fallback: 45000,
      min: 1000,
    }),
    maxImageBytes: toNumber('HCTI_MAX_IMAGE_BYTES', {
      required: false,
      fallback: 10485760,
      min: 1024,
    }),
  };

  // --- Providers — optional in dev; unavailable when absent -----------------
  // A provider is "enabled" when ANY of its required fields is set. Once
  // enabled, ALL required fields (app id, app secret, redirect URI, and the
  // provider's Graph API version) must be present: production hard-errors while
  // development reports the provider unavailable. No API version is invented.
  // In production, redirect URIs must be absolute HTTPS URLs.
  function buildProvider(prefix, { graphVersionEnvKey }) {
    const appId = optionalString(`${prefix}_APP_ID`);
    const appSecret = optionalString(`${prefix}_APP_SECRET`);
    const redirectUri = optionalString(`${prefix}_REDIRECT_URI`);
    const graphVersion = optionalString(graphVersionEnvKey);

    if (redirectUri) {
      validateUrl(`${prefix}_REDIRECT_URI`, redirectUri, { required: false });
      // Enforce HTTPS for redirect URIs in production only.
      if (IS_PROD) {
        let parsed;
        try {
          parsed = new URL(redirectUri);
        } catch {
          parsed = null;
        }
        if (parsed && parsed.protocol !== 'https:') {
          errors.push(`${prefix}_REDIRECT_URI must be an absolute HTTPS URL in production`);
        }
      }
    }

    const requiredFields = [
      [`${prefix}_APP_ID`, appId],
      [`${prefix}_APP_SECRET`, appSecret],
      [`${prefix}_REDIRECT_URI`, redirectUri],
      [graphVersionEnvKey, graphVersion],
    ];

    const enabled = requiredFields.some(([, v]) => v !== '' && v !== undefined);
    const available = requiredFields.every(([, v]) => v !== '' && v !== undefined);

    if (IS_PROD && enabled && !available) {
      const missing = requiredFields.filter(([, v]) => !v).map(([k]) => k);
      errors.push(
        `${prefix} provider is enabled but missing required configuration: ${missing.join(', ')}`,
      );
    }

    return { appId, appSecret, redirectUri, graphVersion, available };
  }

  const meta = buildProvider('META', { graphVersionEnvKey: 'META_GRAPH_API_VERSION' });
  const instagram = buildProvider('INSTAGRAM', {
    graphVersionEnvKey: 'INSTAGRAM_GRAPH_API_VERSION',
  });
  const threads = buildProvider('THREADS', { graphVersionEnvKey: 'THREADS_GRAPH_API_VERSION' });

  // --- OAuth (state + provider HTTP behavior) -------------------------------
  const oauth = {
    stateTtlMinutes: toNumber('OAUTH_STATE_TTL_MINUTES', {
      required: false,
      fallback: 10,
      min: 1,
    }),
    httpTimeoutMs: toNumber('OAUTH_HTTP_TIMEOUT_MS', {
      required: false,
      fallback: 30000,
      min: 1000,
    }),
    tokenRefreshLeewayMinutes: toNumber('OAUTH_TOKEN_REFRESH_LEEWAY_MINUTES', {
      required: false,
      fallback: 10,
      min: 0,
    }),
  };

  // --- Scheduler ------------------------------------------------------------
  const scheduler = {
    enabled: toBoolean('SCHEDULER_ENABLED', true),
    cron: optionalString('SCHEDULER_CRON') || '* * * * *',
    batchSize: toNumber('SCHEDULER_BATCH_SIZE', { required: false, fallback: 10, min: 1 }),
    concurrency: toNumber('SCHEDULER_CONCURRENCY', { required: false, fallback: 3, min: 1 }),
    lockTimeoutMinutes: toNumber('SCHEDULER_LOCK_TIMEOUT_MINUTES', {
      required: false,
      fallback: 15,
      min: 1,
    }),
    maxRetries: toNumber('SCHEDULER_MAX_RETRIES', { required: false, fallback: 3, min: 0 }),
    baseRetryMinutes: toNumber('SCHEDULER_BASE_RETRY_MINUTES', {
      required: false,
      fallback: 5,
      min: 1,
    }),
  };

  // --- Limits ---------------------------------------------------------------
  const limits = {
    maxPostPromptLength: toNumber('MAX_POST_PROMPT_LENGTH', { required: false, fallback: 5000, min: 1 }),
    maxCustomHtmlLength: toNumber('MAX_CUSTOM_HTML_LENGTH', { required: false, fallback: 20000, min: 1 }),
    maxCustomCssLength: toNumber('MAX_CUSTOM_CSS_LENGTH', { required: false, fallback: 20000, min: 1 }),
    maxDailyGenerationsPerUser: toNumber('MAX_DAILY_GENERATIONS_PER_USER', {
      required: false,
      fallback: 100,
      min: 1,
    }),
  };

  // --- Media storage (C3) ---------------------------------------------------
  //
  // Uploaded image bytes live on a private filesystem path, OUTSIDE the public
  // app source. The default sits under the OS temp dir so local dev and the
  // test suite work with zero configuration — but a temp dir is wiped on
  // redeploy, so PRODUCTION MUST set MEDIA_STORAGE_PATH to a persistent
  // directory. That requirement is a deployment blocker, documented in the
  // runbook, not enforced here (a dev machine has no persistent path to give).
  const media = {
    storageDriver: optionalString('MEDIA_STORAGE_DRIVER') || 'local',
    storagePath: optionalString('MEDIA_STORAGE_PATH')
      || path.join(os.tmpdir(), 'cyflow-media'),
    maxUploadBytes: toNumber('MAX_MEDIA_UPLOAD_BYTES', {
      required: false,
      fallback: 8 * 1024 * 1024, // 8 MB — ample for a social image, mean to a bomb
      min: 1024,
    }),
  };

  const logLevel = optionalString('LOG_LEVEL') || 'info';

  if (errors.length > 0) {
    const message = [
      'Invalid Cyflow Social configuration. Fix the following and restart:',
      ...errors.map((e) => `  - ${e}`),
    ].join('\n');
    throw new Error(message);
  }

  const config = Object.freeze({
    env: NODE_ENV,
    isProd: IS_PROD,
    isDev: !IS_PROD,
    port: PORT,
    publicBaseUrl: PUBLIC_BASE_URL,
    logLevel,
    db: Object.freeze(db),
    session: Object.freeze(session),
    bcryptRounds,
    /** Raw 32-byte AES key buffer. Never log this. */
    encryptionKey,
    openai: Object.freeze(openai),
    hcti: Object.freeze(hcti),
    providers: Object.freeze({
      meta: Object.freeze(meta),
      instagram: Object.freeze(instagram),
      threads: Object.freeze(threads),
    }),
    oauth: Object.freeze(oauth),
    scheduler: Object.freeze(scheduler),
    limits: Object.freeze(limits),
    media: Object.freeze(media),
  });

  const providerAvailability = Object.freeze({
    meta: meta.available,
    instagram: instagram.available,
    threads: threads.available,
    openai: openai.available,
  });

  return { config, providerAvailability };
}

// Build the default config from process.env at import time (fail-fast).
const built = buildConfig(process.env);

export const config = built.config;
export const providerAvailability = built.providerAvailability;
export default config;
