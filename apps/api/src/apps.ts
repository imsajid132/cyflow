/**
 * App directory for the connection UI. Combines the engine's built-in apps with
 * the connectors, exposing their auth requirements (never their credentials).
 */
import type { App } from "engine";
import { builtInApps } from "engine";
import { connectorApps } from "@cyflow/connectors";
import { validateCredentials } from "@cyflow/connections";
import type { AuthSchema, AuthType } from "@cyflow/shared";
import type { AppAuthDTO, AppSummary } from "./types";

const ALL_APPS: App[] = [...builtInApps, ...connectorApps];

export function appSummaries(): AppSummary[] {
  return ALL_APPS.map((a) => ({
    key: a.key,
    name: a.name,
    auth: (a.auth?.type ?? "none") as AuthType,
    hasAuth: Boolean(a.auth && a.auth.type !== "none"),
  }));
}

export function appAuthDTO(key: string): AppAuthDTO | null {
  const app = ALL_APPS.find((a) => a.key === key);
  if (!app) return null;
  return { key: app.key, name: app.name, auth: app.auth ?? { type: "none" } };
}

export function appAuthSchema(key: string): AuthSchema | undefined {
  return ALL_APPS.find((a) => a.key === key)?.auth;
}

/**
 * Validate a connection's credentials against its app's auth schema. Returns an
 * error message (400-worthy) or null when valid. OAuth2/none skip field checks
 * (tokens arrive via the OAuth flow, not a form).
 */
export function validateConnectionCredentials(
  appKey: string,
  credentials: Record<string, unknown> | undefined,
): string | null {
  const schema = appAuthSchema(appKey);
  if (!schema || schema.type === "none" || schema.type === "oauth2") return null;
  const result = validateCredentials(schema, credentials ?? {});
  return result.success ? null : result.error.issues[0]?.message ?? "invalid credentials";
}
