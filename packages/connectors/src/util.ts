import type { ExecutionContext } from "@cyflow/shared";

/**
 * Read a required string credential from the current module's connection
 * (decrypted by the vault, exposed on `ctx.connection`). Accepts several field
 * names so OAuth apps can use `access_token`/`accessToken`/`token`.
 */
export function requireCredential(
  ctx: ExecutionContext,
  fields: string[],
  appName: string,
): string {
  const conn = ctx.connection;
  if (conn) {
    for (const field of fields) {
      const value = conn[field];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  throw new Error(
    `${appName} requires a connection with a ${fields.map((f) => `"${f}"`).join(" or ")}`,
  );
}

/** POST JSON and parse the JSON response; throws on a non-2xx unless allowed. */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

/** Build a URL with query params, omitting undefined/null/empty values. */
export function buildUrl(base: string, query: Record<string, unknown> = {}): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** Drop undefined/null/empty entries from an object (for request bodies). */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;
}

interface ApiOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Generic authenticated JSON call for REST connectors: sends JSON when `body`
 * is set, parses the JSON response, and throws a descriptive error on non-2xx
 * (tries common error shapes: `message`, `error`, `error.message`, `errors[0]`).
 */
export async function apiJson<T = Record<string, unknown>>(opts: ApiOptions): Promise<T> {
  const hasBody = opts.body !== undefined;
  const res = await fetch(opts.url, {
    method: opts.method,
    headers: {
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
    const j = json as { message?: string; error?: string | { message?: string }; errors?: Array<{ message?: string }> };
    const msg =
      j.message ??
      (typeof j.error === "string" ? j.error : j.error?.message) ??
      j.errors?.[0]?.message ??
      res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return json as T;
}
