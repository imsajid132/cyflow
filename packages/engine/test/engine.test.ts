import { afterEach, describe, expect, it, vi } from "vitest";
import type { Blueprint, Bundle, OperationRunner } from "@cyflow/shared";
import { runScenario } from "../src/engine";
import { Registry, createDefaultRegistry } from "../src/registry";
import { customWebhook } from "../src/modules/webhook";

/** Register the webhook trigger + arbitrary stubs for a focused test. */
function registryWith(...stubs: { app: string; operation: string; run: OperationRunner }[]): Registry {
  const registry = new Registry().register({
    app: "webhook",
    operation: "custom_webhook",
    kind: "trigger",
    run: customWebhook,
  });
  for (const s of stubs) {
    registry.register({ app: s.app, operation: s.operation, kind: "action", run: s.run });
  }
  return registry;
}

function fakeJsonResponse(status = 200, json: unknown = { ok: true }): Response {
  const headers = new Headers({ "content-type": "application/json" });
  return { status, headers, json: async () => json, text: async () => "" } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runScenario — happy path (webhook → http → sleep)", () => {
  it("returns SUCCESS with ordered steps and correct operation count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeJsonResponse(200, { url: "ok" })));

    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "http",
          operation: "make_request",
          kind: "action",
          params: { method: "GET", url: "https://httpbin.test/get" },
          next: "3",
        },
        { id: "3", app: "core", operation: "sleep", kind: "action", params: { seconds: 0.02 }, next: null },
      ],
    };
    const trigger: Bundle[] = [{ body: { email: "test@cyfrow.com" } }];

    const record = await runScenario(blueprint, trigger, createDefaultRegistry());

    expect(record.status).toBe("SUCCESS");
    expect(Object.keys(record.steps)).toEqual(["1", "2", "3"]);
    expect(record.steps["1"].status).toBe("success");
    expect(record.steps["2"].bundles[0]).toMatchObject({ statusCode: 200 });
    expect(record.steps["3"].bundles).toEqual([{}]);
    // 1 (trigger) + 1 (http) + 1 (sleep)
    expect(record.operations).toBe(3);
  });

  it("makes the trigger bundles available as module 1's output", async () => {
    const trigger: Bundle[] = [{ body: { email: "a@b.com" } }];
    const blueprint: Blueprint = {
      modules: [{ id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: null }],
    };

    const record = await runScenario(blueprint, trigger, createDefaultRegistry());

    expect(record.status).toBe("SUCCESS");
    expect(record.steps["1"].bundles).toEqual(trigger);
    expect(record.steps["1"].operations).toBe(1);
  });
});

describe("runScenario — bundle multiplexing (fan-out)", () => {
  it("runs the downstream module once per bundle when a module outputs 3", async () => {
    let downstreamRuns = 0;
    const registry = registryWith(
      { app: "test", operation: "search3", run: async () => [{ i: 1 }, { i: 2 }, { i: 3 }] },
      {
        app: "test",
        operation: "echo",
        run: async (input) => {
          downstreamRuns += 1;
          return [input];
        },
      },
    );

    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "test", operation: "search3", kind: "search", params: {}, next: "3" },
        { id: "3", app: "test", operation: "echo", kind: "action", params: {}, next: null },
      ],
    };

    const record = await runScenario(blueprint, [{ seed: true }], registry);

    expect(record.status).toBe("SUCCESS");
    // Module 2 emitted 3 bundles → module 3 ran exactly 3 times.
    expect(downstreamRuns).toBe(3);
    expect(record.steps["2"].bundles).toHaveLength(3);
    expect(record.steps["2"].operations).toBe(1);
    expect(record.steps["3"].operations).toBe(3);
    expect(record.steps["3"].bundles).toHaveLength(3);
    // operations reflect ACTUAL executions: trigger 1 + search 1 + echo 3 = 5
    expect(record.operations).toBe(5);
  });

  it("multiplexes multiple trigger bundles across the downstream module", async () => {
    let runs = 0;
    const registry = registryWith({
      app: "test",
      operation: "echo",
      run: async (input) => {
        runs += 1;
        return [input];
      },
    });

    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "test", operation: "echo", kind: "action", params: {}, next: null },
      ],
    };

    const record = await runScenario(blueprint, [{ a: 1 }, { a: 2 }], registry);

    expect(record.status).toBe("SUCCESS");
    expect(record.steps["1"].operations).toBe(2); // two trigger bundles
    expect(runs).toBe(2);
    expect(record.steps["2"].operations).toBe(2);
    expect(record.operations).toBe(4);
  });
});

describe("runScenario — error handling (stop on first error)", () => {
  it("marks the http step error and stops when the host is unreachable", async () => {
    // .invalid is guaranteed non-resolvable (RFC 6761) → real network failure.
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "http",
          operation: "make_request",
          kind: "action",
          params: { method: "GET", url: "http://cyflow.invalid/" },
          next: "3",
        },
        { id: "3", app: "core", operation: "sleep", kind: "action", params: { seconds: 0.02 }, next: null },
      ],
    };

    const record = await runScenario(blueprint, [{ x: 1 }], createDefaultRegistry());

    expect(record.status).toBe("FAILED");
    expect(record.error).toBeTruthy();
    expect(record.steps["1"].status).toBe("success");
    expect(record.steps["2"].status).toBe("error");
    expect(record.steps["2"].error).toMatch(/network error/);
    expect(record.steps["3"]).toBeUndefined(); // walk stopped before sleep
  });

  it("fails with a clear message on an unknown app/operation", async () => {
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "nope", operation: "missing", kind: "action", params: {}, next: "3" },
        { id: "3", app: "core", operation: "sleep", kind: "action", params: { seconds: 0.02 }, next: null },
      ],
    };

    const record = await runScenario(blueprint, [{ x: 1 }], createDefaultRegistry());

    expect(record.status).toBe("FAILED");
    expect(record.error).toMatch(/Unknown module/);
    expect(record.steps["2"].status).toBe("error");
    expect(record.steps["3"]).toBeUndefined();
  });

  it("fails when the first module is not a trigger", async () => {
    const blueprint: Blueprint = {
      modules: [{ id: "1", app: "core", operation: "sleep", kind: "action", params: {}, next: null }],
    };
    const record = await runScenario(blueprint, [{ x: 1 }], createDefaultRegistry());
    expect(record.status).toBe("FAILED");
    expect(record.error).toMatch(/must be a trigger/);
  });
});

describe("runScenario — operation timing", () => {
  it("records elapsed ms around a module's bundle runs", async () => {
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "core", operation: "sleep", kind: "action", params: { seconds: 0.15 }, next: null },
      ],
    };
    const record = await runScenario(blueprint, [{}], createDefaultRegistry());
    expect(record.status).toBe("SUCCESS");
    expect(record.steps["2"].ms).toBeGreaterThanOrEqual(120);
  });
});
