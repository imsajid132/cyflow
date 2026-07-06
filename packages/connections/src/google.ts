import { randomBytes } from "node:crypto";
import { exchangeCodeForToken, refreshAccessToken, type OAuth2ProviderConfig, type OAuth2Tokens } from "./oauth2";
import type { EncryptionService } from "./crypto";
import type { ConnectionService } from "./service";

/**
 * Real Google OAuth2 (Phase B). One provider shared across the Google apps.
 * Client secret lives ONLY here (server-side); the frontend never sees it.
 */

export const GOOGLE_APPS = new Set(["gmail", "sheets", "drive", "calendar"]);
const IDENTITY = ["openid", "https://www.googleapis.com/auth/userinfo.email"];

export const GOOGLE_SCOPES: Record<string, string[]> = {
  gmail: [...IDENTITY, "https://www.googleapis.com/auth/gmail.modify"],
  sheets: [...IDENTITY, "https://www.googleapis.com/auth/spreadsheets"],
  drive: [...IDENTITY, "https://www.googleapis.com/auth/drive"],
  calendar: [...IDENTITY, "https://www.googleapis.com/auth/calendar"],
};

export const GOOGLE_LABELS: Record<string, string> = {
  gmail: "Gmail",
  sheets: "Google Sheets",
  drive: "Google Drive",
  calendar: "Google Calendar",
};

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Frontend base URL to redirect back to after the callback. */
  webUrl?: string;
}

/** Read Google OAuth config from the environment (null if not fully set). */
export function googleConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) return null;
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
    webUrl: env.WEB_APP_URL,
  };
}

function providerConfig(cfg: GoogleConfig): OAuth2ProviderConfig {
  return {
    authorizationUrl: AUTH_URL,
    tokenUrl: TOKEN_URL,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUri: cfg.redirectUri,
  };
}

/** Build the Google consent URL (offline access + forced consent for a refresh token). */
export function googleAuthorizeUrl(cfg: GoogleConfig, app: string, state: string): string {
  const scopes = GOOGLE_SCOPES[app] ?? GOOGLE_SCOPES.gmail;
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export function exchangeGoogleCode(cfg: GoogleConfig, code: string): Promise<OAuth2Tokens> {
  return exchangeCodeForToken(providerConfig(cfg), code);
}
export function refreshGoogleToken(cfg: GoogleConfig, refreshToken: string): Promise<OAuth2Tokens> {
  return refreshAccessToken(providerConfig(cfg), refreshToken);
}

/** Best-effort account email (for labelling multi-account connections). */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { email?: string };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

/* ---- CSRF state: AES-GCM encrypted { app, nonce, ts } (stateless, self-validating) ---- */
const STATE_TTL_MS = 10 * 60_000;

export function makeOAuthState(enc: EncryptionService, app: string): string {
  return enc.encrypt(JSON.stringify({ app, nonce: randomBytes(12).toString("hex"), ts: Date.now() }));
}
export function readOAuthState(enc: EncryptionService, state: string | undefined): { app: string } | null {
  if (!state) return null;
  try {
    const data = JSON.parse(enc.decrypt(state)) as { app?: string; ts?: number };
    if (!data.app || !GOOGLE_APPS.has(data.app)) return null;
    if (typeof data.ts !== "number" || Date.now() - data.ts > STATE_TTL_MS) return null;
    return { app: data.app };
  } catch {
    return null;
  }
}

/* ---- credentials stored in the vault (never returned to the frontend) ---- */
export interface GoogleCredentials {
  access_token: string;
  refresh_token?: string;
  expiry: number;
  scope?: string;
  token_type?: string;
  email?: string;
}
export function tokensToCredentials(
  tokens: OAuth2Tokens,
  email: string | null,
  prev?: Partial<GoogleCredentials>,
): GoogleCredentials {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken ?? prev?.refresh_token,
    expiry: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
    scope: tokens.scope ?? prev?.scope,
    token_type: tokens.tokenType ?? prev?.token_type ?? "Bearer",
    email: email ?? prev?.email,
  };
}

function isExpired(creds: Partial<GoogleCredentials>): boolean {
  return typeof creds.expiry === "number" && creds.expiry < Date.now() + 60_000; // 60s buffer
}

/**
 * A `ctx.getConnection` resolver that transparently refreshes an expired Google
 * access token (and re-stores it) before returning credentials for execution.
 * Non-Google apps pass straight through.
 */
export function makeGoogleGetConnection(
  connections: ConnectionService,
  config: GoogleConfig | null,
): (id: string) => Promise<Record<string, unknown> | null> {
  return async (id: string) => {
    const row = await connections.getRowById(id);
    if (!row) return null;
    const creds = row.credentials as Record<string, unknown> & Partial<GoogleCredentials>;
    if (config && GOOGLE_APPS.has(row.appKey) && creds.refresh_token && isExpired(creds)) {
      try {
        const fresh = await refreshGoogleToken(config, String(creds.refresh_token));
        const updated = tokensToCredentials(fresh, null, creds);
        await connections.updateCredentials(id, updated as unknown as Record<string, unknown>);
        return updated as unknown as Record<string, unknown>;
      } catch {
        return creds; // fall through with the stale token; the API call will surface the auth error
      }
    }
    return creds;
  };
}
