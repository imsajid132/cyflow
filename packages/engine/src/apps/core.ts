import { z } from "zod";
import type { App } from "../app";
import { sleep, MAX_SLEEP_SECONDS } from "../modules/core";

/** Param schema for core.sleep. */
export const sleepParams = z.object({
  seconds: z.number().min(0).max(MAX_SLEEP_SECONDS).optional().default(0),
});

/** Core app — built-in flow utilities that need no connection. */
export const coreApp: App = {
  key: "core",
  name: "Core",
  auth: { type: "none" },
  modules: {
    sleep: {
      key: "sleep",
      name: "Sleep",
      kind: "action",
      params: sleepParams,
      run: sleep,
    },
  },
};
