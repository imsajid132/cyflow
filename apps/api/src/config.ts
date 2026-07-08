/**
 * Runtime configuration for the API / worker. Reads the environment, reports a
 * redacted status for GET /health, and validates the setup at startup — clear
 * errors/warnings, never leaking secret values.
 */

export interface ConfigStatus {
  /** Persistence backend in use. */
  persistence: "postgres" | "in-memory";
  /** DATABASE_URL is set. */
  database: boolean;
  /** REDIS_URL is set (used by the worker queue + scheduler). */
  redis: boolean;
  /** CYFLOW_ENCRYPTION_KEY is set — required for the connection vault. */
  vault: boolean;
  /** OAuth providers with all three of their vars configured. */
  oauth: { google: boolean; microsoft: boolean };
  /**
   * Per-variable presence (booleans only — never values) so a misconfigured
   * OAuth setup is diagnosable from /health: it shows exactly which env var the
   * running process is missing (e.g. a typo'd key or a value that didn't apply).
   */
  oauthEnv: {
    google: { clientId: boolean; clientSecret: boolean; redirectUri: boolean };
    microsoft: { clientId: boolean; clientSecret: boolean; redirectUri: boolean };
    webAppUrl: boolean;
  };
  /** Public base for webhook URLs (from PUBLIC_API_URL), or null. */
  webhookBaseUrl: string | null;
  /** An admin token is required to reach protected routes. */
  adminProtected: boolean;
}

function allSet(...vals: (string | undefined)[]): boolean {
  return vals.every((v) => Boolean(v && v.length > 0));
}
function someButNotAll(...vals: (string | undefined)[]): boolean {
  const set = vals.filter((v) => Boolean(v && v.length > 0)).length;
  return set > 0 && set < vals.length;
}

/** Redacted config status (booleans + the public webhook base only — no secrets). */
export function readConfigStatus(env: NodeJS.ProcessEnv = process.env): ConfigStatus {
  // PUBLIC_API_URL wins; on Render the platform sets RENDER_EXTERNAL_URL for us.
  const publicUrl = (env.PUBLIC_API_URL ?? env.RENDER_EXTERNAL_URL)?.replace(/\/$/, "");
  return {
    persistence: env.DATABASE_URL ? "postgres" : "in-memory",
    database: Boolean(env.DATABASE_URL),
    redis: Boolean(env.REDIS_URL),
    vault: Boolean(env.CYFLOW_ENCRYPTION_KEY),
    oauth: {
      google: allSet(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI),
      microsoft: allSet(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET, env.MICROSOFT_REDIRECT_URI),
    },
    oauthEnv: {
      google: {
        clientId: Boolean(env.GOOGLE_CLIENT_ID),
        clientSecret: Boolean(env.GOOGLE_CLIENT_SECRET),
        redirectUri: Boolean(env.GOOGLE_REDIRECT_URI),
      },
      microsoft: {
        clientId: Boolean(env.MICROSOFT_CLIENT_ID),
        clientSecret: Boolean(env.MICROSOFT_CLIENT_SECRET),
        redirectUri: Boolean(env.MICROSOFT_REDIRECT_URI),
      },
      webAppUrl: Boolean(env.WEB_APP_URL),
    },
    webhookBaseUrl: publicUrl ? `${publicUrl}/hooks` : null,
    adminProtected: Boolean(env.ADMIN_TOKEN || env.CYFLOW_ADMIN_TOKEN),
  };
}

/**
 * Validate the environment. `errors` are misconfigurations that will break real
 * usage; `warnings` are things you probably want in production. The process does
 * NOT exit on these — it keeps serving /health so the setup can be diagnosed.
 */
export function validateConfig(env: NodeJS.ProcessEnv = process.env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!env.DATABASE_URL) {
    warnings.push("DATABASE_URL not set — running in-memory. Data is NOT persisted and the connection vault is disabled. Set it for production.");
  }
  if (env.DATABASE_URL && !env.CYFLOW_ENCRYPTION_KEY) {
    errors.push("CYFLOW_ENCRYPTION_KEY is required to encrypt connection secrets. Set a 32+ character random value — without it, connections cannot be saved.");
  }
  if (!env.ADMIN_TOKEN && !env.CYFLOW_ADMIN_TOKEN) {
    warnings.push("No ADMIN_TOKEN set — the API is OPEN to anyone. Set ADMIN_TOKEN for production.");
  }
  if ((env.GOOGLE_CLIENT_ID || env.MICROSOFT_CLIENT_ID) && !env.WEB_APP_URL) {
    warnings.push("WEB_APP_URL not set — OAuth callbacks cannot redirect back to the frontend. Set it to your Vercel URL.");
  }
  if (someButNotAll(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI)) {
    warnings.push("Partial Google OAuth config — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI together, or none.");
  }
  if (someButNotAll(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET, env.MICROSOFT_REDIRECT_URI)) {
    warnings.push("Partial Microsoft OAuth config — set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_REDIRECT_URI together, or none.");
  }
  return { errors, warnings };
}

/** Print the validation result at startup (clear, no secret values). */
export function logConfig(env: NodeJS.ProcessEnv = process.env): void {
  const { errors, warnings } = validateConfig(env);
  const status = readConfigStatus(env);
  console.log(`[api] config: persistence=${status.persistence} vault=${status.vault} redis=${status.redis} adminProtected=${status.adminProtected} oauth={google:${status.oauth.google},microsoft:${status.oauth.microsoft}}`);
  for (const w of warnings) console.warn(`[api] ⚠ ${w}`);
  for (const e of errors) console.error(`[api] ✖ ${e}`);
}
