/**
 * OAuth2 scaffold for the connection UI. Real provider client secrets live ONLY
 * on the server (env). The frontend gets a "start" URL or a clear "setup
 * required" message — never a secret. Token exchange is intentionally not wired
 * (it needs a real provider app); the callback returns a placeholder.
 */
import { buildAuthorizationUrl } from "@cyflow/connections";
import type { OAuthCallbackResult, OAuthStartDTO } from "./types";

let stateSeq = 0;

export function oauthStart(provider: string): OAuthStartDTO {
  const p = provider.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const clientId = process.env[`OAUTH_${p}_CLIENT_ID`];
  const authorizationUrl = process.env[`OAUTH_${p}_AUTH_URL`];
  const tokenUrl = process.env[`OAUTH_${p}_TOKEN_URL`] ?? "";
  const redirectUri =
    process.env[`OAUTH_${p}_REDIRECT_URI`] ??
    `${(process.env.API_PUBLIC_URL ?? "").replace(/\/$/, "")}/oauth/${provider}/callback`;

  if (!clientId || !authorizationUrl) {
    return {
      provider,
      configured: false,
      message: `OAuth provider setup required — set OAUTH_${p}_CLIENT_ID and OAUTH_${p}_AUTH_URL (plus TOKEN_URL, REDIRECT_URI, SCOPES) on the API server.`,
    };
  }

  const scopes = (process.env[`OAUTH_${p}_SCOPES`] ?? "").split(/[\s,]+/).filter(Boolean);
  const state = `${provider}-${(stateSeq += 1).toString(36)}`;
  const authUrl = buildAuthorizationUrl(
    { authorizationUrl, tokenUrl, clientId, clientSecret: "", redirectUri, scopes },
    { state },
  );
  return { provider, configured: true, message: "Redirect the user to authUrl to authorize.", authUrl, state };
}

export function oauthCallback(provider: string, query: Record<string, unknown>): OAuthCallbackResult {
  if (typeof query.error === "string") {
    return { ok: false, message: `OAuth error from ${provider}: ${query.error}` };
  }
  if (typeof query.code === "string") {
    return {
      ok: false,
      message:
        "Authorization code received. Token exchange is a server-side scaffold — configure a real provider client + secret to complete it.",
    };
  }
  return { ok: false, message: "Missing authorization code." };
}
