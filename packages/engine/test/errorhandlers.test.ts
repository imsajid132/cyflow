import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Blueprint, ErrorHandler } from "@cyflow/shared";
import { createDefaultRegistry } from "../src/registry";
import type { App } from "../src/app";
import { runScenario } from "../src/engine";

/** Emits fixed bundles; a "flaky" action throws on bundles with `fail: true`. */
const emit: App = {
  key: "emit",
  name: "emit",
  modules: {
    three: {
      key: "three",
      name: "three",
      kind: "search",
      params: z.object({}),
      run: async () => [{ ok: 1 }, { fail: true }, { ok: 3 }],
    },
  },
};
const flaky: App = {
  key: "flaky",
  name: "flaky",
  modules: {
    act: {
      key: "act",
      name: "act",
      kind: "action",
      params: z.object({}).passthrough(),
      run: async (input) => {
        if ((input as { fail?: boolean }).fail) throw new Error("boom");
        return [input];
      },
    },
  },
};

function blueprint(errorHandler?: ErrorHandler): Blueprint {
  return {
    modules: [
      { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
      { id: "2", app: "emit", operation: "three", kind: "search", params: {}, next: "3" },
      { id: "3", app: "flaky", operation: "act", kind: "action", params: {}, errorHandler, next: "4" },
      { id: "4", app: "flaky", operation: "act", kind: "action", params: {}, next: null },
    ],
  };
}

const registry = () => createDefaultRegistry().registerApp(emit).registerApp(flaky);

describe("Error handlers", () => {
  it("without a handler, the first throw stops the run FAILED", async () => {
    const record = await runScenario(blueprint(), [{}], registry());
    expect(record.status).toBe("FAILED");
    expect(record.error).toMatch(/boom/);
    expect(record.steps["3"].status).toBe("error");
    expect(record.steps["4"]).toBeUndefined();
  });

  it("resume substitutes a fallback bundle and continues", async () => {
    const record = await runScenario(
      blueprint({ type: "resume", fallback: { recovered: true } }),
      [{}],
      registry(),
    );
    expect(record.status).toBe("SUCCESS");
    expect(record.steps["3"].bundles).toEqual([{ ok: 1 }, { recovered: true }, { ok: 3 }]);
    expect(record.steps["3"].errorOutcome).toEqual({ type: "resume", handled: 1 });
    // Module 3 still processed 3 bundles → 3 ops; downstream got all 3.
    expect(record.steps["3"].operations).toBe(3);
    expect(record.steps["4"].operations).toBe(3);
    // trigger 1 + emit 1 + m3 3 + m4 3
    expect(record.operations).toBe(8);
  });

  it("ignore skips the failed bundle and continues", async () => {
    const record = await runScenario(blueprint({ type: "ignore" }), [{}], registry());
    expect(record.status).toBe("SUCCESS");
    expect(record.steps["3"].bundles).toEqual([{ ok: 1 }, { ok: 3 }]);
    expect(record.steps["3"].errorOutcome).toEqual({ type: "ignore", handled: 1 });
    expect(record.steps["4"].operations).toBe(2); // only the 2 survivors continue
  });

  it("break stops the scenario safely", async () => {
    const record = await runScenario(blueprint({ type: "break" }), [{}], registry());
    expect(record.status).toBe("FAILED");
    expect(record.error).toMatch(/Break at "3"/);
    expect(record.steps["3"].status).toBe("error");
    expect(record.steps["4"]).toBeUndefined();
  });

  it("commit stops the walk but reports SUCCESS", async () => {
    const record = await runScenario(blueprint({ type: "commit" }), [{}], registry());
    expect(record.status).toBe("SUCCESS");
    expect(record.error).toBeUndefined();
    expect(record.steps["3"].status).toBe("error");
    expect(record.steps["3"].errorOutcome).toEqual({ type: "commit", handled: 1 });
    expect(record.steps["4"]).toBeUndefined();
  });

  it("rollback stops the scenario FAILED (placeholder)", async () => {
    const record = await runScenario(blueprint({ type: "rollback" }), [{}], registry());
    expect(record.status).toBe("FAILED");
    expect(record.error).toMatch(/Rollback at "3"/);
    expect(record.steps["4"]).toBeUndefined();
  });
});
