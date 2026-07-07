/** Public surface of the Cyflow engine. */
export * from "./types";
export { runScenario, resolveParams } from "./engine";
export type { RunScenarioOptions } from "./engine";
export { buildExecutionSteps } from "./snapshot";
export { Registry, createDefaultRegistry } from "./registry";
export type { RegisteredModule } from "./registry";

// App framework (Phase 2)
export type { App, ModuleDef, AuthSchema, AuthType, AuthField, TestConnectionResult } from "./app";
export { webhookApp, manualApp, httpApp, coreApp, flowApp, dataStoreApp, builtInApps } from "./apps";
export { manualTriggerBundles } from "./manual-trigger";
export { httpRequestParams } from "./apps/http";
export { sleepParams } from "./apps/core";

// Flow control (Phase 5 + Phase 8 router)
export {
  AGGREGATE_INPUT_KEY,
  router,
  iterator,
  arrayAggregator,
  textAggregator,
  numericAggregator,
} from "./modules/flow";

// Data store (Phase 8)
export { InMemoryDataStore } from "./modules/datastore";

// Underlying runners (usable/testable in isolation)
export { customWebhook } from "./modules/webhook";
export { makeRequest, buildAuthHeaders } from "./modules/http";
export { sleep, MAX_SLEEP_SECONDS } from "./modules/core";
