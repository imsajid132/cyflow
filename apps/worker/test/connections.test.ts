import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Blueprint } from "@cyflow/shared";
import { type App, createDefaultRegistry } from "engine";
import { InMemoryScenarioRepository, InMemoryExecutionRepository } from "../src/memory";
import { runScenarioJob } from "../src/processor";

/**
 * A module that reports whether it received credentials (without echoing the
 * value) and also emits some secret-keyed fields to exercise redaction.
 */
const authProbe: App = {
  key: "authprobe",
  name: "Auth probe",
  modules: {
    run: {
      key: "run",
      name: "run",
      kind: "action",
      params: z.object({}).passthrough(),
      run: async (_input, _params, ctx) => {
        const conn = ctx.connection as { type?: string; token?: string } | null;
        return [
          {
            hadToken: Boolean(conn?.token),
            connectionType: conn?.type ?? null,
            token: "leaked-secret",
            password: "pw-secret",
          },
        ];
      },
    },
  },
};

function deps(getConnection?: (id: string) => Promise<Record<string, unknown> | null>) {
  return {
    scenarios: new InMemoryScenarioRepository(),
    executions: new InMemoryExecutionRepository(),
    registry: createDefaultRegistry().registerApp(authProbe),
    getConnection,
  };
}

const blueprint: Blueprint = {
  modules: [
    { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
    { id: "2", app: "authprobe", operation: "run", kind: "action", params: {}, connectionId: "c1", next: null },
  ],
};

describe("worker — connection credentials + snapshot redaction", () => {
  it("passes decrypted credentials into execution via getConnection", async () => {
    const d = deps(async (id) => (id === "c1" ? { type: "bearer_token", token: "top-secret" } : null));
    const scenario = await d.scenarios.create({ userId: "u1", name: "Auth", blueprint });

    const result = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: [{}] }, d);

    expect(result.status).toBe("SUCCESS");
    const step = result.steps.find((s) => s.moduleNodeId === "2")!;
    const out = step.output[0] as { hadToken?: boolean; connectionType?: string };
    expect(out.hadToken).toBe(true);
    expect(out.connectionType).toBe("bearer_token");
  });

  it("redacts secret-keyed fields in persisted snapshots (no secret leaks)", async () => {
    const d = deps(async () => ({ type: "bearer_token", token: "top-secret" }));
    const scenario = await d.scenarios.create({ userId: "u1", name: "Auth", blueprint });

    const result = await runScenarioJob({ scenarioId: scenario.id, triggerBundles: [{}] }, d);
    const persisted = await d.executions.findById(result.id);

    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("leaked-secret");
    expect(serialized).not.toContain("pw-secret");
    expect(serialized).not.toContain("top-secret"); // never echoed into a bundle
    expect(serialized).toContain("[REDACTED]");
  });
});
