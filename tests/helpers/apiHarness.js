/**
 * API test harness: build the real Express app wired with in-memory fakes, and
 * helpers to drive CSRF + session cookies through supertest agents.
 */

import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createFakeOverrides } from './fakes.js';

/** A strong default password that satisfies the policy. */
export const STRONG_PASSWORD = 'Sup3r-Secret-Pass';

export function defaultCreds(overrides = {}) {
  return {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: STRONG_PASSWORD,
    timezone: 'America/New_York',
    ...overrides,
  };
}

/** Build an app with fakes; returns { app, overrides }. */
export function makeApp(extraOverrides = {}) {
  const overrides = createFakeOverrides(extraOverrides);
  const app = createApp(overrides);
  return { app, overrides };
}

/** Fetch a CSRF token for the agent's current session. */
export async function getCsrf(agent) {
  const res = await agent.get('/api/csrf-token');
  return res.body?.data?.csrfToken;
}

/**
 * Register a user and return the authenticated agent + a fresh CSRF token
 * (the session was regenerated during registration).
 */
export async function registerUser(app, creds = defaultCreds()) {
  const agent = request.agent(app);
  const token = await getCsrf(agent);
  const res = await agent.post('/api/auth/register').set('X-CSRF-Token', token).send(creds);
  const csrf = await getCsrf(agent);
  return { agent, res, csrf };
}

export default { makeApp, getCsrf, registerUser, defaultCreds, STRONG_PASSWORD };
