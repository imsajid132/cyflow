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
