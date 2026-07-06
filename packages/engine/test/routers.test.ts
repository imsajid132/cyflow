import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Blueprint, Bundle } from "@cyflow/shared";
import { createDefaultRegistry } from "../src/registry";
import type { App } from "../src/app";
import { runScenario } from "../src/engine";

/** Records into which route each bundle went. */
function collectorApp(sink: Record<string, Bundle[]>): App {
  const make = (name: string) => ({
    key: name,
    name,
    kind: "action" as const,
    params: z.object({}).passthrough(),
    run: async (input: Bundle) => {
      (sink[name] ??= []).push(input);
      return [input];
    },
  });
  return { key: "collect", name: "collect", modules: { a: make("a"), b: make("b"), c: make("c") } };
}

const trigger = { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger" as const, params: {}, next: "2" };

describe("Router", () => {
  it("sends one bundle to multiple branches (no route filters)", async () => {
    const sink: Record<string, Bundle[]> = {};
    const registry = createDefaultRegistry().registerApp(collectorApp(sink));
    const blueprint: Blueprint = {
      modules: [
        trigger,
        {
          id: "2",
          app: "flow",
          operation: "router",
          kind: "router",
          params: {},
          routes: [{ next: "a" }, { next: "b" }],
          next: null,
        },
        { id: "a", app: "collect", operation: "a", kind: "action", params: {}, next: null },
        { id: "b", app: "collect", operation: "b", kind: "action", params: {}, next: null },
      ],
    };

    const record = await runScenario(blueprint, [{ x: 1 }], registry);

    expect(record.status).toBe("SUCCESS");
    expect(sink.a).toEqual([{ x: 1 }]);
    expect(sink.b).toEqual([{ x: 1 }]);
    // Router is free flow-control (0 ops): trigger 1 + a 1 + b 1 = 3.
    expect(record.operations).toBe(3);
    expect(record.steps["2"].operations).toBe(0);
    // Branch info preserved on the router step.
    expect(record.steps["2"].routes).toEqual([
      { next: "a", bundles: 1 },
      { next: "b", bundles: 1 },
    ]);
  });

  it("applies each route's filter independently", async () => {
    const sink: Record<string, Bundle[]> = {};
    // Emit 3 bundles via a stub search, then route by value.
    const emit: App = {
      key: "emit",
      name: "emit",
      modules: {
        three: {
          key: "three",
          name: "three",
          kind: "search",
          params: z.object({}),
          run: async () => [{ n: 1 }, { n: 2 }, { n: 3 }],
        },
      },
    };
    const bp: Blueprint = {
      modules: [
        { ...trigger, next: "2" },
        { id: "2", app: "emit", operation: "three", kind: "search", params: {}, next: "3" },
        {
          id: "3",
          app: "flow",
          operation: "router",
          kind: "router",
          params: {},
          routes: [
            { label: "low", filter: { left: "{{3.n}}", operator: "less", right: "3" }, next: "a" },
            { label: "high", filter: { left: "{{3.n}}", operator: "greater", right: "1" }, next: "b" },
          ],
          next: null,
        },
        { id: "a", app: "collect", operation: "a", kind: "action", params: {}, next: null },
        { id: "b", app: "collect", operation: "b", kind: "action", params: {}, next: null },
      ],
    };

    const record = await runScenario(
      bp,
      [{}],
      createDefaultRegistry().registerApp(emit).registerApp(collectorApp(sink)),
    );

    expect(record.status).toBe("SUCCESS");
    // low: n<3 → {1},{2}; high: n>1 → {2},{3}; n=2 goes to BOTH routes.
    expect(sink.a).toEqual([{ n: 1 }, { n: 2 }]);
    expect(sink.b).toEqual([{ n: 2 }, { n: 3 }]);
    // ops: trigger 1 + emit 1 + a 2 + b 2 = 6 (router free)
    expect(record.operations).toBe(6);
    expect(record.steps["3"].routes).toEqual([
      { label: "low", next: "a", bundles: 2 },
      { label: "high", next: "b", bundles: 2 },
    ]);
  });
});
