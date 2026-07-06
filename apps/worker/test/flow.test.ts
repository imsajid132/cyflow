import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Blueprint, Bundle } from "@cyflow/shared";
import { type App, createDefaultRegistry } from "engine";
import { InMemoryScenarioRepository, InMemoryExecutionRepository } from "../src/memory";
import { runScenarioJob } from "../src/processor";

function emitApp(key: string, bundles: Bundle[]): App {
  return {
    key,
    name: key,
    modules: {
      go: { key: "go", name: "go", kind: "search", params: z.object({}), run: async () => bundles },
    },
  };
}

const probeApp: App = {
  key: "probe",
  name: "Probe",
  modules: {
    echo: {
      key: "echo",
      name: "echo",
      kind: "action",
      params: z.object({}).passthrough(),
      run: async (_input, params) => [{ params }],
    },
  },
};

function makeDeps(registry = createDefaultRegistry()) {
  return {
    scenarios: new InMemoryScenarioRepository(),
    executions: new InMemoryExecutionRepository(),
    registry,
  };
}

describe("worker persistence — iterator fan-out", () => {
  it("persists the iterator's 3 outputs and the downstream 3 runs with exact snapshots", async () => {
    const deps = makeDeps(createDefaultRegistry().registerApp(probeApp));
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "flow",
          operation: "iterator",
          kind: "iterator",
          params: { array: "{{1.items}}" },
          next: "3",
        },
        {
          id: "3",
          app: "probe",
          operation: "echo",
          kind: "action",
          params: { v: "{{2.value}}" },
          next: null,
        },
      ],
    };
    const scenario = await deps.scenarios.create({ userId: "u1", name: "Iter", blueprint });

    const result = await runScenarioJob(
      { scenarioId: scenario.id, triggerBundles: [{ items: ["a", "b", "c"] }] },
      deps,
    );

    expect(result.status).toBe("SUCCESS");
    const persisted = await deps.executions.findById(result.id);
    const iterStep = persisted!.steps.find((s) => s.moduleNodeId === "2")!;
    const probeStep = persisted!.steps.find((s) => s.moduleNodeId === "3")!;

    expect(iterStep.output).toHaveLength(3);
    expect(probeStep.operations).toBe(3);
    // The probe's INPUT snapshot is exactly the iterator's 3 output bundles.
    expect(probeStep.input).toEqual(iterStep.output);
    expect(probeStep.output).toEqual([
      { params: { v: "a" } },
      { params: { v: "b" } },
      { params: { v: "c" } },
    ]);
  });
});

describe("worker persistence — filter + aggregator", () => {
  it("stores the filtered input the aggregator consumed and its collapsed output", async () => {
    const deps = makeDeps(
      createDefaultRegistry().registerApp(emitApp("list", [{ n: 1 }, { n: 2 }, { n: 3 }])),
    );
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "list",
          operation: "go",
          kind: "search",
          params: {},
          filter: { left: "{{2.n}}", operator: "greater", right: "1" },
          next: "3",
        },
        {
          id: "3",
          app: "flow",
          operation: "array_aggregator",
          kind: "aggregator",
          params: { field: "n" },
          next: null,
        },
      ],
    };
    const scenario = await deps.scenarios.create({ userId: "u1", name: "FilterAgg", blueprint });

    const result = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: [{}] }, deps);

    expect(result.status).toBe("SUCCESS");
    const persisted = await deps.executions.findById(result.id);
    const aggStep = persisted!.steps.find((s) => s.moduleNodeId === "3")!;

    // The aggregator consumed only the filtered bundles (n=2, n=3)...
    expect(aggStep.input).toEqual([{ n: 2 }, { n: 3 }]);
    // ...and collapsed them into one bundle.
    expect(aggStep.output).toEqual([{ array: [2, 3] }]);
    expect(aggStep.operations).toBe(1);
    // ops: trigger 1 + search 1 + aggregator 1
    expect(persisted!.operations).toBe(3);
  });
});
