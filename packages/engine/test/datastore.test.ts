import { describe, expect, it } from "vitest";
import type { Blueprint } from "@cyflow/shared";
import { createDefaultRegistry } from "../src/registry";
import { InMemoryDataStore } from "../src/modules/datastore";
import { runScenario } from "../src/engine";

const trigger = { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger" as const, params: {}, next: "2" };

function run(modules: Blueprint["modules"], store = new InMemoryDataStore()) {
  return runScenario({ modules }, [{}], createDefaultRegistry(), { dataStore: store });
}

describe("Data store modules", () => {
  it("set then get a record", async () => {
    const record = await run([
      trigger,
      { id: "2", app: "datastore", operation: "set_record", kind: "action", params: { key: "user:1", value: { name: "Ada" } }, next: "3" },
      { id: "3", app: "datastore", operation: "get_record", kind: "search", params: { key: "user:1" }, next: null },
    ]);
    expect(record.status).toBe("SUCCESS");
    expect(record.steps["3"].bundles).toEqual([{ key: "user:1", value: { name: "Ada" }, found: true }]);
  });

  it("increment a numeric value", async () => {
    const record = await run([
      trigger,
      { id: "2", app: "datastore", operation: "set_record", kind: "action", params: { key: "count", value: 10 }, next: "3" },
      { id: "3", app: "datastore", operation: "increment", kind: "action", params: { key: "count", by: 5 }, next: null },
    ]);
    expect(record.steps["3"].bundles).toEqual([{ key: "count", value: 15 }]);
  });

  it("delete a record", async () => {
    const record = await run([
      trigger,
      { id: "2", app: "datastore", operation: "set_record", kind: "action", params: { key: "temp", value: 1 }, next: "3" },
      { id: "3", app: "datastore", operation: "delete_record", kind: "action", params: { key: "temp" }, next: "4" },
      { id: "4", app: "datastore", operation: "get_record", kind: "search", params: { key: "temp" }, next: null },
    ]);
    expect(record.steps["3"].bundles).toEqual([{ key: "temp", deleted: true }]);
    expect(record.steps["4"].bundles).toEqual([{ key: "temp", value: undefined, found: false }]);
  });

  it("lists records (fans out one bundle per record)", async () => {
    const record = await run([
      trigger,
      { id: "2", app: "datastore", operation: "set_record", kind: "action", params: { key: "a", value: 1 }, next: "3" },
      { id: "3", app: "datastore", operation: "set_record", kind: "action", params: { key: "b", value: 2 }, next: "4" },
      { id: "4", app: "datastore", operation: "list_records", kind: "search", params: {}, next: null },
    ]);
    expect(record.steps["4"].bundles).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]);
  });

  it("fails clearly when no data store is wired", async () => {
    const record = await runScenario(
      {
        modules: [
          trigger,
          { id: "2", app: "datastore", operation: "get_record", kind: "search", params: { key: "x" }, next: null },
        ],
      },
      [{}],
      createDefaultRegistry(),
    );
    expect(record.status).toBe("FAILED");
    expect(record.error).toMatch(/requires a data store/);
  });
});
