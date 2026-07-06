/**
 * OAuth2 scaffold (Phase 7). Enough to drive the authorization-code flow: build
 * the authorize URL, exchange a code for tokens, and refresh. Real provider apps
 * are registered later; the token calls use `fetch` and are easily mocked.
 */

export interface OAuth2ProviderConfig {
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
}

/** Build the provider authorization URL for the code flow. */
export function buildAuthorizationUrl(
  config: OAuth2ProviderConfig,
  options: { state: string; scopes?: string[] },
): string {
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", options.state);
  const scopes = options.scopes ?? config.scopes ?? [];
  if (scopes.length > 0) url.searchParams.set("scope", scopes.join(" "));
  return url.toString();
}

function parseTokenResponse(json: Record<string, unknown>): OAuth2Tokens {
  if (typeof json.access_token !== "string") {
    throw new Error("OAuth2 token response missing access_token");
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    tokenType: typeof json.token_type === "string" ? json.token_type : undefined,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
  };
}

async function postForm(url: string, form: Record<string, string>): Promise<OAuth2Tokens> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    throw new Error(`OAuth2 token request failed with status ${res.status}`);
  }
  return parseTokenResponse((await res.json()) as Record<string, unknown>);
}

/** Exchange an authorization code for tokens. */
export function exchangeCodeForToken(
  config: OAuth2ProviderConfig,
  code: string,
): Promise<OAuth2Tokens> {
  return postForm(config.tokenUrl, {
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
}

/** Refresh an access token. */
export function refreshAccessToken(
  config: OAuth2ProviderConfig,
  refreshToken: string,
): Promise<OAuth2Tokens> {
  return postForm(config.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
}

/** A token refresher — real providers implement this; stored tokens use it. */
export interface TokenRefresher {
  refresh(refreshToken: string): Promise<OAuth2Tokens>;
}
