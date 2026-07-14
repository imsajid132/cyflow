/**
 * Provider registry.
 *
 * Resolves ONLY the three supported providers (meta/instagram/threads) and
 * rejects anything else. Never dynamically imports a path derived from user
 * input. Supports dependency injection (config + fetch/http) for tests.
 */

import { config as defaultConfig } from '../config/env.js';
import { createProviderHttp } from '../utils/providerHttp.js';
import { createMetaProvider } from './metaProvider.js';
import { createInstagramProvider } from './instagramProvider.js';
import { createThreadsProvider } from './threadsProvider.js';
import { PROVIDERS, PROVIDER_VALUES } from '../config/constants.js';
import { OAuthError, OAUTH_ERROR_CODES } from '../utils/oauthErrors.js';

export function createProviderRegistry({ config = defaultConfig, fetchImpl, http } = {}) {
  const httpClient = http ?? createProviderHttp({ fetchImpl });

  const providers = {
    [PROVIDERS.META]: createMetaProvider({
      providerConfig: config.providers.meta,
      http: httpClient,
    }),
    [PROVIDERS.INSTAGRAM]: createInstagramProvider({
      providerConfig: config.providers.instagram,
      http: httpClient,
    }),
    [PROVIDERS.THREADS]: createThreadsProvider({
      providerConfig: config.providers.threads,
      http: httpClient,
    }),
  };

  function isValidProvider(key) {
    return PROVIDER_VALUES.includes(key) && Boolean(providers[key]);
  }

  function get(key) {
    if (!isValidProvider(key)) {
      throw new OAuthError(OAUTH_ERROR_CODES.PROVIDER_CONFIGURATION_ERROR, 'Unknown provider');
    }
    return providers[key];
  }

  function availability() {
    return {
      meta: providers[PROVIDERS.META].isConfigured(),
      instagram: providers[PROVIDERS.INSTAGRAM].isConfigured(),
      threads: providers[PROVIDERS.THREADS].isConfigured(),
    };
  }

  return { get, isValidProvider, availability, providers };
}

export const providerRegistry = createProviderRegistry();
export default providerRegistry;
