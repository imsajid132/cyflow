import type { ExecutionContext } from "@cyflow/shared";
import type { TestConnectionResult } from "engine";
import { requireCredential } from "./util";

/** Credential field names an OAuth access token may live under. */
export const GTOKEN = ["access_token", "accessToken", "token"];

/** The current module's Google access token (refreshed upstream by the vault). */
export function accessToken(ctx: ExecutionContext, appName: string): string {
  return requireCredential(ctx, GTOKEN, appName);
}

interface GApiOptions {
  method: string;
  url: string;
  token: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Call a Google REST endpoint with a Bearer token; parse JSON, throw on non-2xx. */
export async function gapi<T = Record<string, unknown>>(opts: GApiOptions): Promise<T> {
  const hasBody = opts.body !== undefined;
  const res = await fetch(opts.url, {
    method: opts.method,
    headers: {
      authorization: `Bearer ${opts.token}`,
      ...(hasBody && typeof opts.body !== "string" ? { "content-type": "application/json" } : {}),
      ...opts.headers,
    },
    body: hasBody ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  const text = await res.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  if (!res.ok) {
    const errField = (json as { error?: { message?: string } | string }).error;
    const message = typeof errField === "string" ? errField : errField?.message ?? res.statusText;
    throw new Error(`Google API ${res.status}: ${message}`);
  }
  return json as T;
}

/** Fetch raw bytes (e.g. Drive media) as base64 + content type. */
export async function gapiDownload(url: string, token: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), mimeType: res.headers.get("content-type") ?? "application/octet-stream" };
}

/** Build a URL with query params, omitting undefined/empty values. */
export function withQuery(base: string, query: Record<string, unknown>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** Drop undefined/empty entries from a JSON body. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== "" && v !== null)) as Partial<T>;
}

/** Shared testConnection for every Google app — validates the token via userinfo. */
export async function googleTestConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token =
    (typeof credentials.access_token === "string" && credentials.access_token) ||
    (typeof credentials.accessToken === "string" && credentials.accessToken) ||
    "";
  if (!token) return { ok: false, message: "Not connected — run the Google OAuth flow." };
  try {
    const me = await gapi<{ email?: string }>({ method: "GET", url: "https://www.googleapis.com/oauth2/v2/userinfo", token });
    return { ok: true, message: `Connected as ${me.email ?? "Google account"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}
