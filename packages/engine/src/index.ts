/** Public surface of the Cyflow engine. */
export * from "./types";
export { runScenario, resolveParams } from "./engine";
export { buildExecutionSteps } from "./snapshot";
export { Registry, createDefaultRegistry } from "./registry";
export type { RegisteredModule } from "./registry";

// App framework (Phase 2)
export type { App, ModuleDef, AuthSchema, AuthType, AuthField } from "./app";
export { webhookApp, httpApp, coreApp, flowApp, builtInApps } from "./apps";
export { httpRequestParams } from "./apps/http";
export { sleepParams } from "./apps/core";

// Flow control (Phase 5)
export {
  AGGREGATE_INPUT_KEY,
  iterator,
  arrayAggregator,
  textAggregator,
  numericAggregator,
} from "./modules/flow";

// Underlying runners (usable/testable in isolation)
export { customWebhook } from "./modules/webhook";
export { makeRequest } from "./modules/http";
export { sleep, MAX_SLEEP_SECONDS } from "./modules/core";
