import { randomBytes } from "node:crypto";
import { exchangeCodeForToken, refreshAccessToken, type OAuth2ProviderConfig, type OAuth2Tokens } from "./oauth2";
import type { EncryptionService } from "./crypto";
import type { ConnectionService } from "./service";
import {
  GOOGLE_APPS,
  refreshGoogleToken,
  tokensToCredentials,
  type GoogleConfig,
  type GoogleCredentials,
} from "./google";

/**
 * Real Microsoft (Azure AD / Entra) OAuth2 for Microsoft Graph. One provider
 * shared by the Microsoft apps (Outlook, OneDrive). Client secret stays here.
 */

export const MICROSOFT_APPS = new Set(["outlook", "onedrive", "teams"]);
const IDENTITY = ["openid", "email", "profile", "offline_access", "https://graph.microsoft.com/User.Read"];

export const MICROSOFT_SCOPES: Record<string, string[]> = {
  outlook: [...IDENTITY, "https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"],
  onedrive: [...IDENTITY, "https://graph.microsoft.com/Files.ReadWrite.All"],
  // ChannelMessage.Send may require tenant-admin consent in some organisations.
  teams: [
    ...IDENTITY,
    "https://graph.microsoft.com/Team.ReadBasic.All",
    "https://graph.microsoft.com/Channel.ReadBasic.All",
    "https://graph.microsoft.com/ChannelMessage.Send",
    "https://graph.microsoft.com/Chat.ReadWrite",
  ],
};

export const MICROSOFT_LABELS: Record<string, string> = { outlook: "Outlook", onedrive: "OneDrive", teams: "Microsoft Teams" };

const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const ME_URL = "https://graph.microsoft.com/v1.0/me";

export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webUrl?: string;
}

export function microsoftConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MicrosoftConfig | null {
  const { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URI } = env;
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_REDIRECT_URI) return null;
  return { clientId: MICROSOFT_CLIENT_ID, clientSecret: MICROSOFT_CLIENT_SECRET, redirectUri: MICROSOFT_REDIRECT_URI, webUrl: env.WEB_APP_URL };
}

function providerConfig(cfg: MicrosoftConfig): OAuth2ProviderConfig {
  return { authorizationUrl: AUTH_URL, tokenUrl: TOKEN_URL, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri };
}

export function microsoftAuthorizeUrl(cfg: MicrosoftConfig, app: string, state: string): string {
  const scopes = MICROSOFT_SCOPES[app] ?? MICROSOFT_SCOPES.outlook;
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export function exchangeMicrosoftCode(cfg: MicrosoftConfig, code: string): Promise<OAuth2Tokens> {
  return exchangeCodeForToken(providerConfig(cfg), code);
}
export function refreshMicrosoftToken(cfg: MicrosoftConfig, refreshToken: string): Promise<OAuth2Tokens> {
  return refreshAccessToken(providerConfig(cfg), refreshToken);
}

export async function fetchMicrosoftEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(ME_URL, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
    return json.mail ?? json.userPrincipalName ?? null;
  } catch {
    return null;
  }
}

/* ---- CSRF state (AES-GCM encrypted, self-validating) ---- */
const STATE_TTL_MS = 10 * 60_000;
export function makeMicrosoftState(enc: EncryptionService, app: string): string {
  return enc.encrypt(JSON.stringify({ app, nonce: randomBytes(12).toString("hex"), ts: Date.now(), p: "ms" }));
}
export function readMicrosoftState(enc: EncryptionService, state: string | undefined): { app: string } | null {
  if (!state) return null;
  try {
    const data = JSON.parse(enc.decrypt(state)) as { app?: string; ts?: number };
    if (!data.app || !MICROSOFT_APPS.has(data.app)) return null;
    if (typeof data.ts !== "number" || Date.now() - data.ts > STATE_TTL_MS) return null;
    return { app: data.app };
  } catch {
    return null;
  }
}

function isExpired(creds: Partial<GoogleCredentials>): boolean {
  return typeof creds.expiry === "number" && creds.expiry < Date.now() + 60_000;
}

/**
 * A `ctx.getConnection` resolver that refreshes an expired Google OR Microsoft
 * token (and re-stores it) before execution. Other apps pass straight through.
 */
export function makeCloudGetConnection(
  connections: ConnectionService,
  googleConfig: GoogleConfig | null,
  microsoftConfig: MicrosoftConfig | null,
): (id: string) => Promise<Record<string, unknown> | null> {
  return async (id: string) => {
    const row = await connections.getRowById(id);
    if (!row) return null;
    const creds = row.credentials as Record<string, unknown> & Partial<GoogleCredentials>;
    if (!creds.refresh_token || !isExpired(creds)) return creds;
    try {
      if (googleConfig && GOOGLE_APPS.has(row.appKey)) {
        const fresh = await refreshGoogleToken(googleConfig, String(creds.refresh_token));
        const updated = tokensToCredentials(fresh, null, creds);
        await connections.updateCredentials(id, updated as unknown as Record<string, unknown>);
        return updated as unknown as Record<string, unknown>;
      }
      if (microsoftConfig && MICROSOFT_APPS.has(row.appKey)) {
        const fresh = await refreshMicrosoftToken(microsoftConfig, String(creds.refresh_token));
        const updated = tokensToCredentials(fresh, null, creds);
        await connections.updateCredentials(id, updated as unknown as Record<string, unknown>);
        return updated as unknown as Record<string, unknown>;
      }
    } catch {
      return creds; // fall through with the stale token; the API call surfaces the auth error
    }
    return creds;
  };
}
