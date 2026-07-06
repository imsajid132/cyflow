import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { customWebhook } from "../src/modules/webhook";
import { makeRequest } from "../src/modules/http";
import { sleep } from "../src/modules/core";

function makeCtx(trigger: Bundle[] = []): ExecutionContext {
  return {
    scenarioId: "s",
    executionId: "e",
    operations: 0,
    steps: {},
    trigger,
  };
}

/** Minimal fetch Response stub. */
function fakeResponse(opts: {
  status?: number;
  contentType?: string;
  json?: unknown;
  text?: string;
}): Response {
  const headers = new Headers();
  if (opts.contentType) headers.set("content-type", opts.contentType);
  return {
    status: opts.status ?? 200,
    headers,
    json: async () => opts.json,
    text: async () => opts.text ?? "",
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webhook.custom_webhook", () => {
  it("passes its input bundle straight through", async () => {
    const bundle = { body: { email: "a@b.com" } };
    const out = await customWebhook(bundle, {}, makeCtx());
    expect(out).toEqual([bundle]);
  });
});

describe("http.make_request", () => {
  it("returns one bundle with statusCode, headers, and parsed JSON data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({ status: 200, contentType: "application/json", json: { ok: true } }),
      ),
    );
    const out = await makeRequest({}, { method: "GET", url: "https://x.test/get" }, makeCtx());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ statusCode: 200, data: { ok: true } });
    expect((out[0].headers as Record<string, string>)["content-type"]).toContain(
      "application/json",
    );
  });

  it("reads a non-JSON body as text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ contentType: "text/plain", text: "pong" })),
    );
    const out = await makeRequest({}, { url: "https://x.test/ping" }, makeCtx());
    expect(out[0].data).toBe("pong");
  });

  it("treats a non-2xx response as a value, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ status: 404, text: "nope" })));
    const out = await makeRequest({}, { url: "https://x.test/missing" }, makeCtx());
    expect(out[0].statusCode).toBe(404);
  });

  it("appends query params to the url", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) =>
      fakeResponse({ status: 200, text: "" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await makeRequest({}, { url: "https://x.test/s", query: { q: "hi", n: 2 } }, makeCtx());
    const calledWith = fetchMock.mock.calls[0][0] as URL;
    expect(calledWith.searchParams.get("q")).toBe("hi");
    expect(calledWith.searchParams.get("n")).toBe("2");
  });

  it("throws when the url is missing", async () => {
    await expect(makeRequest({}, {}, makeCtx())).rejects.toThrow(/url/);
  });

  it("throws on a network-level failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(makeRequest({}, { url: "https://x.test" }, makeCtx())).rejects.toThrow(
      /network error/,
    );
  });
});

describe("core.sleep", () => {
  it("waits roughly params.seconds, then returns one empty bundle", async () => {
    const start = performance.now();
    const out = await sleep({}, { seconds: 0.15 }, makeCtx());
    const elapsed = performance.now() - start;
    expect(out).toEqual([{}]);
    expect(elapsed).toBeGreaterThanOrEqual(120);
    expect(elapsed).toBeLessThan(2000);
  });

  it("clamps invalid or negative durations to zero (no hang)", async () => {
    const start = performance.now();
    await sleep({}, { seconds: -5 }, makeCtx());
    await sleep({}, { seconds: "oops" as unknown as number }, makeCtx());
    expect(performance.now() - start).toBeLessThan(500);
  });
});
