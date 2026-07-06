import type { Bundle, OperationRunner } from "@cyflow/shared";

interface HttpParams {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
}

/**
 * Build auth headers from a decrypted connection's credentials (Phase 7).
 * The credentials self-describe their `type`. Operates on plain values only —
 * no crypto here — so it is browser-safe. Returns {} when no connection.
 */
export function buildAuthHeaders(
  connection: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (!connection) return {};
  const type = connection.type;

  if (type === "bearer_token" && typeof connection.token === "string") {
    return { authorization: `Bearer ${connection.token}` };
  }
  if (type === "api_key" && typeof connection.key === "string") {
    const header = typeof connection.header === "string" ? connection.header : "x-api-key";
    return { [header]: connection.key };
  }
  if (
    type === "basic_auth" &&
    typeof connection.username === "string" &&
    typeof connection.password === "string"
  ) {
    return { authorization: `Basic ${btoa(`${connection.username}:${connection.password}`)}` };
  }
  return {};
}

/**
 * http.make_request — perform an HTTP call, return a single bundle
 * `{ statusCode, headers, data }`.
 *
 * Make semantics: a non-2xx response is NOT an error (the status is returned for
 * the user to branch on). Only network-level failures (DNS, refused, timeout)
 * and body-parse failures throw → the module errors and the run stops.
 */
export const makeRequest: OperationRunner = async (_inputBundle, params, ctx): Promise<Bundle[]> => {
  const { method = "GET", url, headers, body, query } = params as HttpParams;

  if (!url || typeof url !== "string") {
    throw new Error('http.make_request requires a string "url" param');
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error(`http.make_request received an invalid url: ${url}`);
  }

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    }
  }

  const upperMethod = method.toUpperCase();
  // Explicit headers first, then auth from the module's connection (Phase 7).
  const requestHeaders: Record<string, string> = {
    ...(headers ?? {}),
    ...buildAuthHeaders(ctx.connection),
  };
  const init: RequestInit = { method: upperMethod, headers: requestHeaders };

  if (body !== undefined && upperMethod !== "GET" && upperMethod !== "HEAD") {
    if (typeof body === "string") {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      const hasContentType = Object.keys(requestHeaders).some(
        (k) => k.toLowerCase() === "content-type",
      );
      if (!hasContentType) requestHeaders["content-type"] = "application/json";
    }
  }

  let response: Response;
  try {
    response = await fetch(target, init);
  } catch (err) {
    throw new Error(
      `http.make_request network error for ${target.href}: ${(err as Error).message}`,
    );
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const contentType = response.headers.get("content-type") ?? "";
  let data: unknown;
  try {
    data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
  } catch (err) {
    throw new Error(
      `http.make_request could not parse response body: ${(err as Error).message}`,
    );
  }

  return [{ statusCode: response.status, headers: responseHeaders, data }];
};
