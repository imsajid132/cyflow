/**
 * Business profile repository — prepared-statement access to `business_profiles`.
 *
 * Exactly one profile per user (UNIQUE user_id). Ownership always comes from the
 * authenticated session — a user id is never taken from a request body. JSON
 * columns are parsed safely; BIGINT ids are surfaced as strings. Internal
 * extraction diagnostics are not returned by default.
 */

import { getPool } from '../db/pool.js';
import { ONBOARDING_STATUS } from '../config/constants.js';

function runner(connection) {
  return connection ?? getPool();
}

function safeParseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Map a raw row to the sanitized API shape. */
export function sanitizeProfile(row, { includeDiagnostics = false } = {}) {
  if (!row) return null;
  const profile = {
    id: String(row.id),
    userId: String(row.user_id),
    businessName: row.business_name ?? null,
    websiteUrl: row.website_url ?? null,
    businessCategory: row.business_category ?? null,
    businessDescription: row.business_description ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    postalCode: row.postal_code ?? null,
    country: row.country ?? null,
    primaryColor: row.primary_color ?? null,
    secondaryColor: row.secondary_color ?? null,
    accentColor: row.accent_color ?? null,
    headingFont: row.heading_font ?? null,
    bodyFont: row.body_font ?? null,
    logoUrl: row.logo_url ?? null,
    logoMediaAssetId: row.logo_media_asset_id == null ? null : String(row.logo_media_asset_id),
    faviconUrl: row.favicon_url ?? null,
    defaultLanguage: row.default_language ?? null,
    defaultTone: row.default_tone ?? null,
    defaultCallToAction: row.default_call_to_action ?? null,
    services: safeParseJson(row.services_json, []),
    locations: safeParseJson(row.locations_json, []),
    socialLinks: safeParseJson(row.social_links_json, []),
    sourceType: row.source_type,
    onboardingStatus: row.onboarding_status,
    onboardingCompletedAt: row.onboarding_completed_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
  if (includeDiagnostics) {
    profile.extractedMetadata = safeParseJson(row.extracted_metadata_json, {});
    profile.manualFields = safeParseJson(row.manual_fields_json, []);
  }
  return profile;
}

const COLUMNS =
  'id, user_id, business_name, website_url, business_category, business_description, ' +
  'phone, email, address, city, region, postal_code, country, primary_color, ' +
  'secondary_color, accent_color, heading_font, body_font, logo_url, ' +
  'logo_media_asset_id, favicon_url, default_language, default_tone, ' +
  'default_call_to_action, services_json, locations_json, social_links_json, ' +
  'extracted_metadata_json, manual_fields_json, source_type, onboarding_status, ' +
  'onboarding_completed_at, created_at, updated_at';

/** Column map for whitelisted updates (prevents mass assignment). */
const FIELD_COLUMNS = {
  businessName: 'business_name',
  websiteUrl: 'website_url',
  businessCategory: 'business_category',
  businessDescription: 'business_description',
  phone: 'phone',
  email: 'email',
  address: 'address',
  city: 'city',
  region: 'region',
  postalCode: 'postal_code',
  country: 'country',
  primaryColor: 'primary_color',
  secondaryColor: 'secondary_color',
  accentColor: 'accent_color',
  headingFont: 'heading_font',
  bodyFont: 'body_font',
  logoUrl: 'logo_url',
  faviconUrl: 'favicon_url',
  defaultLanguage: 'default_language',
  defaultTone: 'default_tone',
  defaultCallToAction: 'default_call_to_action',
  sourceType: 'source_type',
};

const JSON_FIELD_COLUMNS = {
  services: 'services_json',
  locations: 'locations_json',
  socialLinks: 'social_links_json',
  extractedMetadata: 'extracted_metadata_json',
  manualFields: 'manual_fields_json',
};

export async function findByUserId(userId, options = {}, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${COLUMNS} FROM business_profiles WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return sanitizeProfile(rows[0] ?? null, options);
}

/** Raw row (internal use — includes diagnostics columns). */
export async function findRawByUserId(userId, connection) {
  const [rows] = await runner(connection).execute(
    `SELECT ${COLUMNS} FROM business_profiles WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Insert or update the single profile for a user (UNIQUE user_id upsert).
 * Only whitelisted fields are written.
 */
export async function createOrUpdateProfile(userId, data, connection) {
  const columns = ['user_id'];
  const placeholders = ['?'];
  const values = [userId];
  const updates = [];

  for (const [key, column] of Object.entries(FIELD_COLUMNS)) {
    if (data[key] !== undefined) {
      columns.push(column);
      placeholders.push('?');
      values.push(data[key]);
      updates.push(`${column} = VALUES(${column})`);
    }
  }
  for (const [key, column] of Object.entries(JSON_FIELD_COLUMNS)) {
    if (data[key] !== undefined) {
      columns.push(column);
      placeholders.push('?');
      values.push(data[key] == null ? null : JSON.stringify(data[key]));
      updates.push(`${column} = VALUES(${column})`);
    }
  }
  if (data.onboardingStatus !== undefined) {
    columns.push('onboarding_status');
    placeholders.push('?');
    values.push(data.onboardingStatus);
    updates.push('onboarding_status = VALUES(onboarding_status)');
  }
  if (data.logoMediaAssetId !== undefined) {
    columns.push('logo_media_asset_id');
    placeholders.push('?');
    values.push(data.logoMediaAssetId);
    updates.push('logo_media_asset_id = VALUES(logo_media_asset_id)');
  }

  const onDuplicate = updates.length > 0 ? updates.join(', ') : 'user_id = user_id';
  await runner(connection).execute(
    `INSERT INTO business_profiles (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON DUPLICATE KEY UPDATE ${onDuplicate}`,
    values,
  );
  return findByUserId(userId, {}, connection);
}

export function updateBrandDetails(userId, data, connection) {
  const allowed = {};
  for (const key of ['primaryColor', 'secondaryColor', 'accentColor', 'headingFont', 'bodyFont', 'logoUrl', 'faviconUrl']) {
    if (data[key] !== undefined) allowed[key] = data[key];
  }
  if (data.logoMediaAssetId !== undefined) allowed.logoMediaAssetId = data.logoMediaAssetId;
  return createOrUpdateProfile(userId, allowed, connection);
}

export function updateContactDetails(userId, data, connection) {
  const allowed = {};
  for (const key of ['phone', 'email', 'address', 'city', 'region', 'postalCode', 'country', 'websiteUrl']) {
    if (data[key] !== undefined) allowed[key] = data[key];
  }
  return createOrUpdateProfile(userId, allowed, connection);
}

export function updateServices(userId, services, connection) {
  return createOrUpdateProfile(userId, { services }, connection);
}

export async function updateOnboardingStatus(userId, status, connection) {
  await runner(connection).execute(
    `INSERT INTO business_profiles (user_id, onboarding_status) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE onboarding_status = VALUES(onboarding_status)`,
    [userId, status],
  );
  return findByUserId(userId, {}, connection);
}

export async function markOnboardingComplete(userId, completedAt, connection) {
  await runner(connection).execute(
    `INSERT INTO business_profiles (user_id, onboarding_status, onboarding_completed_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE onboarding_status = VALUES(onboarding_status),
                             onboarding_completed_at = VALUES(onboarding_completed_at)`,
    [userId, ONBOARDING_STATUS.COMPLETED, completedAt],
  );
  return findByUserId(userId, {}, connection);
}

export async function deleteBusinessProfile(userId, connection) {
  const [result] = await runner(connection).execute(
    'DELETE FROM business_profiles WHERE user_id = ?',
    [userId],
  );
  return (result.affectedRows ?? 0) > 0;
}

export default {
  sanitizeProfile,
  findByUserId,
  findRawByUserId,
  createOrUpdateProfile,
  updateBrandDetails,
  updateContactDetails,
  updateServices,
  updateOnboardingStatus,
  markOnboardingComplete,
  deleteBusinessProfile,
};
