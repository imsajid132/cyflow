import { z } from "zod";
import type { OperationRunner } from "@cyflow/shared";
import type { App } from "../app";

/**
 * Manual trigger — the scenario is started by hand ("Run once"). Like every
 * trigger, the walker special-cases it: its output IS the trigger bundle. The
 * bundle for a manual run comes from the module's `sample` param (see
 * `manualTriggerBundles`), so this runner is a straight passthrough.
 */
const manualTrigger: OperationRunner = async (inputBundle) => [inputBundle];

export const manualApp: App = {
  key: "manual",
  name: "Manual",
  auth: { type: "none" },
  modules: {
    manual: {
      key: "manual",
      name: "Manual trigger",
      kind: "trigger",
      triggerKind: "manual",
      params: z.object({ sample: z.string().optional() }).passthrough(),
      run: manualTrigger,
    },
  },
};
