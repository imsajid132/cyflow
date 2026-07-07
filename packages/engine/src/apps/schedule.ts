import { z } from "zod";
import type { OperationRunner } from "@cyflow/shared";
import type { App } from "../app";

/**
 * Schedule trigger — the scenario runs on an interval (set via the scenario's
 * schedule; the worker scheduler enqueues it). Like every trigger the walker
 * special-cases it: its output IS the trigger bundle (the worker supplies
 * `{ trigger: "schedule", at }`), so this runner is a passthrough.
 */
const scheduleTrigger: OperationRunner = async (inputBundle) => [inputBundle];

export const scheduleApp: App = {
  key: "schedule",
  name: "Schedule",
  auth: { type: "none" },
  modules: {
    schedule: {
      key: "schedule",
      name: "Schedule trigger",
      kind: "trigger",
      triggerKind: "schedule",
      params: z.object({}).passthrough(),
      run: scheduleTrigger,
    },
  },
};
