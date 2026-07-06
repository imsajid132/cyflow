import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Blueprint } from "@cyflow/shared";
import { type App, createDefaultRegistry, InMemoryDataStore } from "engine";
import { InMemoryScenarioRepository, InMemoryExecutionRepository } from "../src/memory";
import { runScenarioJob } from "../src/processor";

const passthrough: App = {
  key: "pass",
  name: "pass",
  modules: {
    a: { key: "a", name: "a", kind: "action", params: z.object({}).passthrough(), run: async (b) => [b] },
    b: { key: "b", name: "b", kind: "action", params: z.object({}).passthrough(), run: async (b) => [b] },
  },
};

function makeDeps(extra?: Partial<{ dataStore: InMemoryDataStore }>) {
  return {
    scenarios: new InMemoryScenarioRepository(),
    executions: new InMemoryExecutionRepository(),
    registry: createDefaultRegistry().registerApp(passthrough),
    ...extra,
  };
}

describe("worker persists Phase 8 snapshots", () => {
  it("persists router branch summaries and both branch steps", async () => {
    const deps = makeDeps();
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "flow",
          operation: "router",
          kind: "router",
          params: {},
          routes: [
            { label: "left", next: "a" },
            { label: "right", next: "b" },
          ],
          next: null,
        },
        { id: "a", app: "pass", operation: "a", kind: "action", params: {}, next: null },
        { id: "b", app: "pass", operation: "b", kind: "action", params: {}, next: null },
      ],
    };
    const scenario = await deps.scenarios.create({ userId: "u1", name: "Router", blueprint });

    const result = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: [{ x: 1 }] }, deps);
    const persisted = await deps.executions.findById(result.id);

    expect(persisted!.status).toBe("SUCCESS");
    const routerStep = persisted!.steps.find((s) => s.moduleNodeId === "2")!;
    expect(routerStep.routes).toEqual([
      { label: "left", next: "a", bundles: 1 },
      { label: "right", next: "b", bundles: 1 },
    ]);
    expect(persisted!.steps.map((s) => s.moduleNodeId).sort()).toEqual(["1", "2", "a", "b"]);
  });

  it("persists error-handler outcome", async () => {
    const flaky: App = {
      key: "flaky",
      name: "flaky",
      modules: {
        act: {
          key: "act",
          name: "act",
          kind: "action",
          params: z.object({}).passthrough(),
          run: async () => {
            throw new Error("nope");
          },
        },
      },
    };
    const deps = makeDeps();
    deps.registry.registerApp(flaky);
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "flaky",
          operation: "act",
          kind: "action",
          params: {},
          errorHandler: { type: "resume", fallback: { recovered: true } },
          next: null,
        },
      ],
    };
    const scenario = await deps.scenarios.create({ userId: "u1", name: "Resume", blueprint });

    const result = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: [{}] }, deps);
    const persisted = await deps.executions.findById(result.id);

    expect(persisted!.status).toBe("SUCCESS");
    const step = persisted!.steps.find((s) => s.moduleNodeId === "2")!;
    expect(step.errorOutcome).toEqual({ type: "resume", handled: 1 });
    expect(step.output).toEqual([{ recovered: true }]);
  });

  it("persists data store operations", async () => {
    const deps = makeDeps({ dataStore: new InMemoryDataStore() });
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "datastore", operation: "increment", kind: "action", params: { key: "runs", by: 1 }, next: null },
      ],
    };
    const scenario = await deps.scenarios.create({ userId: "u1", name: "DS", blueprint });

    const first = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: [{}] }, deps);
    const second = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: [{}] }, deps);

    const step1 = (await deps.executions.findById(first.id))!.steps.find((s) => s.moduleNodeId === "2")!;
    const step2 = (await deps.executions.findById(second.id))!.steps.find((s) => s.moduleNodeId === "2")!;
    // The store persists across runs (same in-memory instance).
    expect(step1.output).toEqual([{ key: "runs", value: 1 }]);
    expect(step2.output).toEqual([{ key: "runs", value: 2 }]);
  });
});
