import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Blueprint } from "@cyflow/shared";
import { createDefaultRegistry } from "../src/registry";
import type { App } from "../src/app";
import { runScenario } from "../src/engine";

/** A probe app whose module echoes its (already-resolved) params into a bundle. */
function probeApp(): App {
  return {
    key: "probe",
    name: "Probe",
    modules: {
      echo: {
        key: "echo",
        name: "Echo params",
        kind: "action",
        params: z.object({}).passthrough(),
        run: async (_input, params) => [{ params }],
      },
    },
  };
}

describe("mapping integration — resolution happens before the runner", () => {
  it("resolves {{1.body.email}} in params before the module runs", async () => {
    const registry = createDefaultRegistry().registerApp(probeApp());
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "probe",
          operation: "echo",
          kind: "action",
          params: {
            to: "{{1.body.email}}",
            greeting: "Hi {{1.body.name}}!",
            shout: "{{upper(1.body.name)}}",
          },
          next: null,
        },
      ],
    };

    const record = await runScenario(
      blueprint,
      [{ body: { email: "ada@b.com", name: "Ada" } }],
      registry,
    );

    expect(record.status).toBe("SUCCESS");
    expect(record.steps["2"].bundles[0]).toEqual({
      params: { to: "ada@b.com", greeting: "Hi Ada!", shout: "ADA" },
    });
  });

  it("resolves per-bundle across a fan-out (multi-bundle runs)", async () => {
    const listApp: App = {
      key: "list",
      name: "List",
      modules: {
        three: {
          key: "three",
          name: "List three",
          kind: "search",
          params: z.object({}),
          run: async () => [{ n: 1 }, { n: 2 }, { n: 3 }],
        },
      },
    };
    const registry = createDefaultRegistry().registerApp(listApp).registerApp(probeApp());
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "list", operation: "three", kind: "search", params: {}, next: "3" },
        {
          id: "3",
          app: "probe",
          operation: "echo",
          kind: "action",
          // {{2.n}} references the predecessor (module 2) — the CURRENT bundle.
          params: { value: "{{2.n}}", doubled: "{{multiply(2.n; 2)}}" },
          next: null,
        },
      ],
    };

    const record = await runScenario(blueprint, [{ seed: true }], registry);

    expect(record.status).toBe("SUCCESS");
    expect(record.steps["3"].operations).toBe(3);
    expect(record.steps["3"].bundles).toEqual([
      { params: { value: 1, doubled: 2 } },
      { params: { value: 2, doubled: 4 } },
      { params: { value: 3, doubled: 6 } },
    ]);
  });

  it("leaves plain params (no braces) untouched", async () => {
    const registry = createDefaultRegistry().registerApp(probeApp());
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "probe",
          operation: "echo",
          kind: "action",
          params: { url: "https://api.test/x", n: 42, on: true },
          next: null,
        },
      ],
    };
    const record = await runScenario(blueprint, [{}], registry);
    expect(record.steps["2"].bundles[0]).toEqual({
      params: { url: "https://api.test/x", n: 42, on: true },
    });
  });

  it("fails the execution when an expression is invalid", async () => {
    const registry = createDefaultRegistry().registerApp(probeApp());
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "probe",
          operation: "echo",
          kind: "action",
          params: { bad: "{{nope(1.body.email)}}" },
          next: null,
        },
      ],
    };

    const record = await runScenario(blueprint, [{ body: { email: "a@b.com" } }], registry);

    expect(record.status).toBe("FAILED");
    expect(record.error).toMatch(/Unknown function/);
    expect(record.steps["2"].status).toBe("error");
  });
});
