import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Blueprint } from "@cyflow/shared";
import { type App, createDefaultRegistry } from "engine";
import { InMemoryScenarioRepository, InMemoryExecutionRepository } from "../src/memory";
import { runScenarioJob } from "../src/processor";

const probeApp: App = {
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

describe("worker — resolved mapping values are persisted in snapshots", () => {
  it("stores the resolved param output for a mapped scenario", async () => {
    const deps = {
      scenarios: new InMemoryScenarioRepository(),
      executions: new InMemoryExecutionRepository(),
      registry: createDefaultRegistry().registerApp(probeApp),
    };

    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        {
          id: "2",
          app: "probe",
          operation: "echo",
          kind: "action",
          params: { greeting: "Hi {{1.body.name}}", email: "{{1.body.email}}" },
          next: null,
        },
      ],
    };

    const trigger = [{ body: { name: "Ada", email: "ada@b.com" } }];
    const scenario = await deps.scenarios.create({ userId: "u1", name: "Mapped", blueprint });

    const result = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: trigger }, deps);
    expect(result.status).toBe("SUCCESS");

    const persisted = await deps.executions.findById(result.id);
    const probeStep = persisted!.steps.find((s) => s.moduleNodeId === "2")!;
    // Input snapshot is the trigger output; output carries the RESOLVED params.
    expect(probeStep.input).toEqual(trigger);
    expect(probeStep.output).toEqual([
      { params: { greeting: "Hi Ada", email: "ada@b.com" } },
    ]);
  });
});
