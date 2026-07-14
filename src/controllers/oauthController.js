/**
 * OAuth controller (factory).
 *
 * Exposes provider availability, a POST start endpoint that returns a
 * server-built authorization URL, and per-provider GET callbacks that verify +
 * consume state and redirect to the dashboard with only safe query values
 * (no code/state/token, never a user-provided URL).
 */

import { PROVIDER_VALUES } from '../config/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { NotFoundError } from '../utils/errors.js';
import { oauthService as defaultOAuthService } from '../services/oauthService.js';

/** Build a safe dashboard redirect path (fixed base + whitelisted params). */
function dashboardRedirect(params) {
  const qs = new URLSearchParams(params).toString();
  return `/dashboard?${qs}`;
}

export function createOAuthController({ oauthService = defaultOAuthService } = {}) {
  function assertKnownProvider(provider) {
    if (!PROVIDER_VALUES.includes(provider)) {
      throw new NotFoundError('Unknown provider');
    }
  }

  const getProviders = asyncHandler(async (req, res) => {
    return sendSuccess(res, { providers: oauthService.getProviderAvailability() });
  });

  const startOAuth = asyncHandler(async (req, res) => {
    const { provider } = req.params;
    assertKnownProvider(provider);
    const { authorizationUrl } = await oauthService.startOAuth(
      { userId: req.user.id, provider },
      { req },
    );
    return sendSuccess(res, { authorizationUrl });
  });

  /** Build a GET callback handler bound to a fixed provider. */
  function makeCallback(provider) {
    return asyncHandler(async (req, res) => {
      // Read only known query fields; never echo them.
      const { code, state, error } = req.query;
      const result = await oauthService.completeOAuth(
        {
          userId: req.user.id,
          provider,
          state: typeof state === 'string' ? state : undefined,
          code: typeof code === 'string' ? code : undefined,
          providerError: typeof error === 'string' ? error : undefined,
        },
        { req },
      );

      if (result.ok) {
        return res.redirect(302, dashboardRedirect({ oauth: 'success', provider }));
      }
      return res.redirect(
        302,
        dashboardRedirect({ oauth: 'error', provider, code: result.classification }),
      );
    });
  }

  return {
    getProviders,
    startOAuth,
    metaCallback: makeCallback('meta'),
    instagramCallback: makeCallback('instagram'),
    threadsCallback: makeCallback('threads'),
  };
}

export default createOAuthController;
