import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Blueprint, Bundle } from "@cyflow/shared";
import type { Filter } from "functions";
import { createDefaultRegistry } from "../src/registry";
import type { App } from "../src/app";
import { runScenario } from "../src/engine";

/** Emits a fixed list of bundles from one input (a search/list stub). */
function emitApp(key: string, bundles: Bundle[]): App {
  return {
    key,
    name: key,
    modules: {
      go: { key: "go", name: "go", kind: "search", params: z.object({}), run: async () => bundles },
    },
  };
}

/** Echoes its resolved params into a bundle. */
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

const trigger = (id: string): Blueprint["modules"][number] => ({
  id,
  app: "webhook",
  operation: "custom_webhook",
  kind: "trigger",
  params: {},
  next: null,
});

describe("Iterator", () => {
  it("emits one bundle per array item, causing the downstream module to run 3×", async () => {
    const registry = createDefaultRegistry().registerApp(probeApp);
    const blueprint: Blueprint = {
      modules: [
        { ...trigger("1"), next: "2" },
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
          params: { name: "{{2.value.name}}", index: "{{2.index}}" },
          next: null,
        },
      ],
    };

    const record = await runScenario(
      blueprint,
      [{ items: [{ name: "a" }, { name: "b" }, { name: "c" }] }],
      registry,
    );

    expect(record.status).toBe("SUCCESS");
    expect(record.steps["2"].bundles).toHaveLength(3);
    expect(record.steps["2"].bundles[0]).toMatchObject({ index: 0, total: 3, value: { name: "a" } });
    // downstream ran once per item
    expect(record.steps["3"].operations).toBe(3);
    expect(record.steps["3"].bundles).toEqual([
      { params: { name: "a", index: 0 } },
      { params: { name: "b", index: 1 } },
      { params: { name: "c", index: 2 } },
    ]);
    // ops: trigger 1 + iterator 1 + downstream 3
    expect(record.operations).toBe(5);
  });
});

describe("Aggregators", () => {
  it("array aggregator collapses 3 bundles into 1", async () => {
    const registry = createDefaultRegistry().registerApp(
      emitApp("list", [{ v: 1 }, { v: 2 }, { v: 3 }]),
    );
    const blueprint: Blueprint = {
      modules: [
        { ...trigger("1"), next: "2" },
        { id: "2", app: "list", operation: "go", kind: "search", params: {}, next: "3" },
        {
          id: "3",
          app: "flow",
          operation: "array_aggregator",
          kind: "aggregator",
          params: {},
          next: null,
        },
      ],
    };

    const record = await runScenario(blueprint, [{}], registry);

    expect(record.status).toBe("SUCCESS");
    expect(record.steps["3"].operations).toBe(1);
    expect(record.steps["3"].bundles).toEqual([{ array: [{ v: 1 }, { v: 2 }, { v: 3 }] }]);
    // trigger 1 + search 1 + aggregator 1
    expect(record.operations).toBe(3);
  });

  it("array aggregator can collect a single field", async () => {
    const registry = createDefaultRegistry().registerApp(
      emitApp("list", [{ v: 1 }, { v: 2 }, { v: 3 }]),
    );
    const blueprint: Blueprint = {
      modules: [
        { ...trigger("1"), next: "2" },
        { id: "2", app: "list", operation: "go", kind: "search", params: {}, next: "3" },
        {
          id: "3",
          app: "flow",
          operation: "array_aggregator",
          kind: "aggregator",
          params: { field: "v" },
          next: null,
        },
      ],
    };
    const record = await runScenario(blueprint, [{}], registry);
    expect(record.steps["3"].bundles).toEqual([{ array: [1, 2, 3] }]);
  });

  it("text aggregator joins mapped values with a separator", async () => {
    const registry = createDefaultRegistry().registerApp(
      emitApp("list", [{ name: "Ada" }, { name: "Grace" }, { name: "Kay" }]),
    );
    const blueprint: Blueprint = {
      modules: [
        { ...trigger("1"), next: "2" },
        { id: "2", app: "list", operation: "go", kind: "search", params: {}, next: "3" },
        {
          id: "3",
          app: "flow",
          operation: "text_aggregator",
          kind: "aggregator",
          params: { value: "name", separator: ", " },
          next: null,
        },
      ],
    };
    const record = await runScenario(blueprint, [{}], registry);
    expect(record.steps["3"].bundles).toEqual([{ text: "Ada, Grace, Kay" }]);
  });

  it("numeric aggregator supports sum / count / average / min / max", async () => {
    const emit = emitApp("list", [{ amount: 10 }, { amount: 20 }, { amount: 30 }]);
    const runWith = async (params: Record<string, unknown>) => {
      const registry = createDefaultRegistry().registerApp(emit);
      const blueprint: Blueprint = {
        modules: [
          { ...trigger("1"), next: "2" },
          { id: "2", app: "list", operation: "go", kind: "search", params: {}, next: "3" },
          {
            id: "3",
            app: "flow",
            operation: "numeric_aggregator",
            kind: "aggregator",
            params,
            next: null,
          },
        ],
      };
      const record = await runScenario(blueprint, [{}], registry);
      return record.steps["3"].bundles[0];
    };

    expect(await runWith({ value: "amount", operation: "sum" })).toEqual({ result: 60 });
    expect(await runWith({ operation: "count" })).toEqual({ result: 3 });
    expect(await runWith({ value: "amount", operation: "average" })).toEqual({ result: 20 });
    expect(await runWith({ value: "amount", operation: "min" })).toEqual({ result: 10 });
    expect(await runWith({ value: "amount", operation: "max" })).toEqual({ result: 30 });
  });
});

describe("Filters", () => {
  function filteredBlueprint(filter: Filter): Blueprint {
    return {
      modules: [
        { ...trigger("1"), next: "2" },
        {
          id: "2",
          app: "list",
          operation: "go",
          kind: "search",
          params: {},
          filter,
          next: "3",
        },
        { id: "3", app: "probe", operation: "echo", kind: "action", params: { n: "{{2.n}}" }, next: null },
      ],
    };
  }

  function registry() {
    return createDefaultRegistry()
      .registerApp(emitApp("list", [{ n: 1 }, { n: 2 }, { n: 3 }]))
      .registerApp(probeApp);
  }

  it("allows matching bundles and blocks the rest", async () => {
    const record = await runScenario(
      filteredBlueprint({ left: "{{2.n}}", operator: "greater", right: "1" }),
      [{}],
      registry(),
    );
    expect(record.status).toBe("SUCCESS");
    // only n=2 and n=3 pass → downstream runs twice
    expect(record.steps["3"].operations).toBe(2);
    expect(record.steps["3"].bundles).toEqual([{ params: { n: 2 } }, { params: { n: 3 } }]);
    // ops: trigger 1 + search 1 + downstream 2
    expect(record.operations).toBe(4);
  });

  it("blocks everything when nothing matches", async () => {
    const record = await runScenario(
      filteredBlueprint({ left: "{{2.n}}", operator: "greater", right: "100" }),
      [{}],
      registry(),
    );
    expect(record.status).toBe("SUCCESS");
    expect(record.steps["3"].operations).toBe(0);
    expect(record.steps["3"].bundles).toEqual([]);
  });

  it("supports equals and an AND group", async () => {
    const eq = await runScenario(
      filteredBlueprint({ left: "{{2.n}}", operator: "equals", right: "2" }),
      [{}],
      registry(),
    );
    expect(eq.steps["3"].bundles).toEqual([{ params: { n: 2 } }]);

    const group: Filter = {
      combinator: "and",
      conditions: [
        { left: "{{2.n}}", operator: "greater", right: "1" },
        { left: "{{2.n}}", operator: "less", right: "3" },
      ],
    };
    const grouped = await runScenario(filteredBlueprint(group), [{}], registry());
    expect(grouped.steps["3"].bundles).toEqual([{ params: { n: 2 } }]);
  });
});

describe("full flow-control pipeline + operations accuracy", () => {
  it("iterator → action → array aggregator → final", async () => {
    const registry = createDefaultRegistry().registerApp(probeApp);
    const blueprint: Blueprint = {
      modules: [
        { ...trigger("1"), next: "2" },
        {
          id: "2",
          app: "flow",
          operation: "iterator",
          kind: "iterator",
          params: { array: "{{1.nums}}" },
          next: "3",
        },
        {
          id: "3",
          app: "probe",
          operation: "echo",
          kind: "action",
          params: { doubled: "{{multiply(2.value; 2)}}" },
          next: "4",
        },
        {
          id: "4",
          app: "flow",
          operation: "array_aggregator",
          kind: "aggregator",
          params: { field: "params.doubled" },
          next: null,
        },
      ],
    };

    const record = await runScenario(blueprint, [{ nums: [1, 2, 3] }], registry);

    expect(record.status).toBe("SUCCESS");
    expect(record.steps["4"].bundles).toEqual([{ array: [2, 4, 6] }]);
    // ops: trigger 1 + iterator 1 + action 3 + aggregator 1 = 6
    expect(record.operations).toBe(6);
  });
});
