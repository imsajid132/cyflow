import type { Bundle, OperationRunner } from "@cyflow/shared";

interface HttpParams {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
}

/**
 * http.make_request — perform an HTTP call, return a single bundle
 * `{ statusCode, headers, data }`.
 *
 * Make semantics: a non-2xx response is NOT an error (the status is returned for
 * the user to branch on). Only network-level failures (DNS, refused, timeout)
 * and body-parse failures throw → the module errors and the run stops.
 */
export const makeRequest: OperationRunner = async (_inputBundle, params): Promise<Bundle[]> => {
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
  const requestHeaders: Record<string, string> = { ...(headers ?? {}) };
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
