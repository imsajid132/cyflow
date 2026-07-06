import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Blueprint } from "@cyflow/shared";
import type { App } from "../src/app";
import { runScenario } from "../src/engine";
import { Registry, createDefaultRegistry } from "../src/registry";
import { httpRequestParams } from "../src/apps/http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App framework — built-in apps register through the framework", () => {
  it("exposes the three built-in apps and their modules via the registry seam", () => {
    const registry = createDefaultRegistry();

    expect(registry.listApps().map((a) => a.key).sort()).toEqual([
      "core",
      "flow",
      "http",
      "webhook",
    ]);

    const http = registry.get("http", "make_request");
    expect(http.run).toBeTypeOf("function");
    expect(http.kind).toBe("action");
    expect(http.appName).toBe("HTTP");
    expect(http.name).toBe("Make a request");
    expect(http.params).toBeDefined();

    expect(registry.get("webhook", "custom_webhook").kind).toBe("trigger");
    expect(registry.get("core", "sleep").kind).toBe("action");
    expect(registry.getApp("http")?.modules.make_request.key).toBe("make_request");
  });

  it("validates module params via their Zod schema (http requires a url)", () => {
    expect(httpRequestParams.safeParse({ url: "https://x.test" }).success).toBe(true);
    expect(httpRequestParams.safeParse({}).success).toBe(false);
    expect(httpRequestParams.safeParse({ url: "not-a-url" }).success).toBe(false);
  });

  it("registerApp expands every module in the app", () => {
    const multi: App = {
      key: "multi",
      name: "Multi",
      modules: {
        a: { key: "a", name: "A", kind: "action", params: z.object({}), run: async (b) => [b] },
        b: { key: "b", name: "B", kind: "action", params: z.object({}), run: async (b) => [b] },
      },
    };
    const registry = new Registry().registerApp(multi);
    expect(registry.has("multi", "a")).toBe(true);
    expect(registry.has("multi", "b")).toBe(true);
    expect(registry.list().filter((m) => m.app === "multi")).toHaveLength(2);
  });
});

describe("App framework — Phase 1 scenarios still pass through it", () => {
  it("runs webhook → http → sleep with SUCCESS and operations = 3", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const headers = new Headers({ "content-type": "application/json" });
        return {
          status: 200,
          headers,
          json: async () => ({ ok: true }),
          text: async () => "",
        } as unknown as Response;
      }),
    );

    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "http",
          operation: "make_request",
          kind: "action",
          params: { method: "GET", url: "https://x.test/get" },
          next: "3",
        },
        { id: "3", app: "core", operation: "sleep", kind: "action", params: { seconds: 0.02 }, next: null },
      ],
    };

    const record = await runScenario(blueprint, [{ body: { email: "a@b.com" } }], createDefaultRegistry());

    expect(record.status).toBe("SUCCESS");
    expect(Object.keys(record.steps)).toEqual(["1", "2", "3"]);
    expect(record.operations).toBe(3);
  });
});

describe("App framework — a new app extends the system without touching engine.ts", () => {
  it("registers a brand-new app's module and runs it through the unmodified walker", async () => {
    const doubleRun = vi.fn(async (input: Record<string, unknown>) => [
      { result: Number(input.n) * 2 },
    ]);
    const mathApp: App = {
      key: "math",
      name: "Math",
      auth: { type: "none" },
      modules: {
        double: { key: "double", name: "Double", kind: "action", params: z.object({}), run: doubleRun },
      },
    };

    const registry = createDefaultRegistry().registerApp(mathApp);

    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "math", operation: "double", kind: "action", params: {}, next: null },
      ],
    };

    const record = await runScenario(blueprint, [{ n: 21 }], registry);

    expect(record.status).toBe("SUCCESS");
    expect(record.steps["2"].bundles).toEqual([{ result: 42 }]);
    expect(doubleRun).toHaveBeenCalledTimes(1);
    expect(registry.getApp("math")?.name).toBe("Math");
  });

  it("a new app's search module fans out through the same bundle model", async () => {
    const listApp: App = {
      key: "list",
      name: "List",
      modules: {
        three: {
          key: "three",
          name: "List three",
          kind: "search",
          params: z.object({}),
          run: async () => [{ i: 1 }, { i: 2 }, { i: 3 }],
        },
      },
    };
    let echoRuns = 0;
    const echoApp: App = {
      key: "echo",
      name: "Echo",
      modules: {
        it: {
          key: "it",
          name: "Echo it",
          kind: "action",
          params: z.object({}),
          run: async (b) => {
            echoRuns += 1;
            return [b];
          },
        },
      },
    };

    const registry = createDefaultRegistry().registerApp(listApp).registerApp(echoApp);

    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "list", operation: "three", kind: "search", params: {}, next: "3" },
        { id: "3", app: "echo", operation: "it", kind: "action", params: {}, next: null },
      ],
    };

    const record = await runScenario(blueprint, [{ seed: true }], registry);

    expect(record.status).toBe("SUCCESS");
    expect(echoRuns).toBe(3);
    expect(record.steps["3"].operations).toBe(3);
    expect(record.operations).toBe(1 + 1 + 3);
  });
});
