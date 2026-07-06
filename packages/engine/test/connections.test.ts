import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Blueprint } from "@cyflow/shared";
import { buildAuthHeaders } from "../src/modules/http";
import { createDefaultRegistry } from "../src/registry";
import type { App } from "../src/app";
import { runScenario } from "../src/engine";

afterEach(() => vi.unstubAllGlobals());

describe("buildAuthHeaders", () => {
  it("builds bearer / api_key / basic headers, and nothing without a connection", () => {
    expect(buildAuthHeaders({ type: "bearer_token", token: "abc" })).toEqual({
      authorization: "Bearer abc",
    });
    expect(buildAuthHeaders({ type: "api_key", key: "k1", header: "X-Api-Key" })).toEqual({
      "X-Api-Key": "k1",
    });
    expect(buildAuthHeaders({ type: "api_key", key: "k1" })).toEqual({ "x-api-key": "k1" });
    expect(buildAuthHeaders({ type: "basic_auth", username: "u", password: "p" })).toEqual({
      authorization: `Basic ${btoa("u:p")}`,
    });
    expect(buildAuthHeaders(null)).toEqual({});
    expect(buildAuthHeaders(undefined)).toEqual({});
  });
});

describe("HTTP module applies the connection's auth header", () => {
  it("adds Authorization: Bearer from ctx.connection", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => {
      const headers = new Headers({ "content-type": "application/json" });
      return { status: 200, headers, json: async () => ({ ok: true }), text: async () => "" } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "http",
          operation: "make_request",
          kind: "action",
          params: { method: "GET", url: "https://api.test/data" },
          connectionId: "conn-1",
          next: null,
        },
      ],
    };

    const record = await runScenario(blueprint, [{}], createDefaultRegistry(), {
      getConnection: async (id) =>
        id === "conn-1" ? { type: "bearer_token", token: "s3cr3t" } : null,
    });

    expect(record.status).toBe("SUCCESS");
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBe("Bearer s3cr3t");
  });

  it("keeps working with no connection (no auth header)", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => {
      const headers = new Headers({ "content-type": "application/json" });
      return { status: 200, headers, json: async () => ({ ok: true }), text: async () => "" } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "http", operation: "make_request", kind: "action", params: { url: "https://api.test" }, next: null },
      ],
    };
    const record = await runScenario(blueprint, [{}], createDefaultRegistry());
    expect(record.status).toBe("SUCCESS");
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBeUndefined();
  });
});

describe("execution receives decrypted credentials via ctx.getConnection", () => {
  it("exposes ctx.connection to the running module", async () => {
    let seen: unknown = "not-set";
    const probeApp: App = {
      key: "probe",
      name: "Probe",
      modules: {
        whoami: {
          key: "whoami",
          name: "whoami",
          kind: "action",
          params: z.object({}),
          run: async (_input, _params, ctx) => {
            seen = ctx.connection;
            return [{ ok: true }];
          },
        },
      },
    };
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "probe", operation: "whoami", kind: "action", params: {}, connectionId: "c9", next: null },
      ],
    };

    const record = await runScenario(blueprint, [{}], createDefaultRegistry().registerApp(probeApp), {
      getConnection: async (id) => (id === "c9" ? { type: "api_key", key: "resolved-key" } : null),
    });

    expect(record.status).toBe("SUCCESS");
    expect(seen).toEqual({ type: "api_key", key: "resolved-key" });
  });
});
