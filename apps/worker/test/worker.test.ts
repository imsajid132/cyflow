import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Blueprint, Bundle } from "@cyflow/shared";
import { type App, createDefaultRegistry, type Registry } from "engine";
import { InMemoryScenarioRepository, InMemoryExecutionRepository } from "../src/memory";
import { runScenarioJob } from "../src/processor";

function deps(registry: Registry = createDefaultRegistry()) {
  return {
    scenarios: new InMemoryScenarioRepository(),
    executions: new InMemoryExecutionRepository(),
    registry,
  };
}

/** webhook -> http -> sleep, the canonical Phase 1 chain. */
function sampleBlueprint(): Blueprint {
  return {
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
}

function mockJsonFetch() {
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
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persistence — scenarios", () => {
  it("saves and loads a scenario as a blueprint", async () => {
    const scenarios = new InMemoryScenarioRepository();
    const blueprint = sampleBlueprint();

    const saved = await scenarios.create({ userId: "u1", name: "Lead alert", blueprint });
    expect(saved.id).toBeTruthy();

    const loaded = await scenarios.findById(saved.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("Lead alert");
    expect(loaded!.blueprint).toEqual(blueprint);
    // Stored copy is independent of the caller's object.
    expect(loaded!.blueprint).not.toBe(blueprint);
  });

  it("returns null for an unknown scenario id", async () => {
    const scenarios = new InMemoryScenarioRepository();
    expect(await scenarios.findById("missing")).toBeNull();
  });
});

describe("worker — a queued job runs through the engine and persists the result", () => {
  it("runs webhook -> http -> sleep and persists a SUCCESS execution", async () => {
    mockJsonFetch();
    const d = deps();
    const scenario = await d.scenarios.create({ userId: "u1", name: "Chain", blueprint: sampleBlueprint() });

    const result = await runScenarioJob(
      { scenarioId: scenario.id, triggerBundles: [{ body: { email: "a@b.com" } }] },
      d,
    );

    // Returned + persisted state agree.
    expect(result.status).toBe("SUCCESS");
    expect(result.operations).toBe(3);

    const persisted = await d.executions.findById(result.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe("SUCCESS");
    expect(persisted!.scenarioId).toBe(scenario.id);
    expect(persisted!.operations).toBe(3);
    expect(persisted!.startedAt).toBeInstanceOf(Date);
    expect(persisted!.finishedAt).toBeInstanceOf(Date);
    expect(persisted!.finishedAt!.getTime()).toBeGreaterThanOrEqual(persisted!.startedAt.getTime());
  });

  it("persists per-step input/output snapshots (input N = output N-1)", async () => {
    mockJsonFetch();
    const d = deps();
    const trigger: Bundle[] = [{ body: { email: "a@b.com" } }];
    const scenario = await d.scenarios.create({ userId: "u1", name: "Chain", blueprint: sampleBlueprint() });

    const result = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: trigger }, d);

    const steps = result.steps;
    expect(steps.map((s) => s.moduleNodeId)).toEqual(["1", "2", "3"]);

    // Trigger step: input == output == the trigger bundles.
    expect(steps[0].input).toEqual(trigger);
    expect(steps[0].output).toEqual(trigger);
    // http step: input is the trigger's output; output carries the response.
    expect(steps[1].input).toEqual(steps[0].output);
    expect(steps[1].output[0]).toMatchObject({ statusCode: 200 });
    // sleep step: input is the http output.
    expect(steps[2].input).toEqual(steps[1].output);
    expect(steps[2].output).toEqual([{}]);
  });
});

describe("worker — failure state is persisted", () => {
  it("marks the failing module error, stops the walk, and persists FAILED", async () => {
    const boomApp: App = {
      key: "boom",
      name: "Boom",
      modules: {
        explode: {
          key: "explode",
          name: "Explode",
          kind: "action",
          params: z.object({}),
          run: async () => {
            throw new Error("kaboom");
          },
        },
      },
    };
    const d = deps(createDefaultRegistry().registerApp(boomApp));
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "boom", operation: "explode", kind: "action", params: {}, next: "3" },
        { id: "3", app: "core", operation: "sleep", kind: "action", params: { seconds: 0.02 }, next: null },
      ],
    };
    const scenario = await d.scenarios.create({ userId: "u1", name: "Faulty", blueprint });

    const result = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: [{ x: 1 }] }, d);

    expect(result.status).toBe("FAILED");
    expect(result.error).toMatch(/kaboom/);
    expect(result.finishedAt).toBeInstanceOf(Date);

    const persisted = await d.executions.findById(result.id);
    expect(persisted!.status).toBe("FAILED");
    // Steps: trigger success + boom error; sleep never ran.
    expect(persisted!.steps.map((s) => s.moduleNodeId)).toEqual(["1", "2"]);
    expect(persisted!.steps[0].status).toBe("success");
    expect(persisted!.steps[1].status).toBe("error");
    expect(persisted!.steps[1].error).toMatch(/kaboom/);
  });

  it("throws when the scenario does not exist", async () => {
    const d = deps();
    await expect(
      runScenarioJob({ scenarioId: "nope", triggerBundles: [] }, d),
    ).rejects.toThrow(/Scenario not found/);
  });
});

describe("worker — bundle fan-out survives persistence", () => {
  it("persists 3 downstream operations when a search emits 3 bundles", async () => {
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
    const echoApp: App = {
      key: "echo",
      name: "Echo",
      modules: {
        it: { key: "it", name: "Echo it", kind: "action", params: z.object({}), run: async (b) => [b] },
      },
    };
    const d = deps(createDefaultRegistry().registerApp(listApp).registerApp(echoApp));
    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "list", operation: "three", kind: "search", params: {}, next: "3" },
        { id: "3", app: "echo", operation: "it", kind: "action", params: {}, next: null },
      ],
    };
    const scenario = await d.scenarios.create({ userId: "u1", name: "Fan", blueprint });

    const result = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: [{ seed: true }] }, d);

    expect(result.status).toBe("SUCCESS");
    const echoStep = result.steps.find((s) => s.moduleNodeId === "3");
    expect(echoStep!.operations).toBe(3);
    expect(echoStep!.output).toHaveLength(3);
    expect(result.operations).toBe(1 + 1 + 3);
  });
});
