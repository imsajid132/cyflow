import { describe, expect, it } from "vitest";
import type { Blueprint, Bundle, OperationRunner } from "@cyflow/shared";
import { runScenario } from "../src/engine";
import { createDefaultRegistry } from "../src/registry";
import { manualTriggerBundles } from "../src/manual-trigger";

const DEFAULT: Bundle[] = [{ body: { fallback: true } }];

function manualBlueprint(sample?: string): Blueprint {
  return {
    modules: [
      { id: "1", app: "manual", operation: "manual", kind: "trigger", params: sample === undefined ? {} : { sample }, next: "2" },
      { id: "2", app: "core", operation: "sleep", kind: "action", params: { seconds: 0 }, next: null },
    ],
  };
}

describe("manualTriggerBundles", () => {
  it("parses a JSON object sample into a single bundle", () => {
    const out = manualTriggerBundles(manualBlueprint('{"name":"Ada","n":42}'), DEFAULT);
    expect(out).toEqual([{ name: "Ada", n: 42 }]);
  });

  it("parses a JSON array sample into many bundles", () => {
    const out = manualTriggerBundles(manualBlueprint('[{"i":1},{"i":2}]'), DEFAULT);
    expect(out).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it("returns an empty bundle when the sample is blank", () => {
    expect(manualTriggerBundles(manualBlueprint(""), DEFAULT)).toEqual([{}]);
    expect(manualTriggerBundles(manualBlueprint(), DEFAULT)).toEqual([{}]);
  });

  it("wraps invalid JSON as a { sample } bundle rather than throwing", () => {
    expect(manualTriggerBundles(manualBlueprint("not json"), DEFAULT)).toEqual([{ sample: "not json" }]);
  });

  it("falls back for a non-manual trigger (webhook)", () => {
    const bp: Blueprint = { modules: [{ id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: null }] };
    expect(manualTriggerBundles(bp, DEFAULT)).toBe(DEFAULT);
  });
});

describe("Manual trigger — end to end", () => {
  it("its sample bundle flows to the next module", async () => {
    const seen: Bundle[] = [];
    const registry = createDefaultRegistry();
    const capture: OperationRunner = async (input) => {
      seen.push(input);
      return [input];
    };
    registry.register({ app: "test", operation: "capture", kind: "action", run: capture });

    const blueprint: Blueprint = {
      modules: [
        { id: "1", app: "manual", operation: "manual", kind: "trigger", params: { sample: '{"hello":"world"}' }, next: "2" },
        { id: "2", app: "test", operation: "capture", kind: "action", params: {}, next: null },
      ],
    };
    const bundles = manualTriggerBundles(blueprint, DEFAULT);
    const record = await runScenario(blueprint, bundles, registry);

    expect(record.status).toBe("SUCCESS");
    expect(seen).toEqual([{ hello: "world" }]);
  });
});
