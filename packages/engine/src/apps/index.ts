import type { App } from "../app";
import { webhookApp } from "./webhook";
import { httpApp } from "./http";
import { coreApp } from "./core";
import { flowApp } from "./flow";
import { dataStoreApp } from "./datastore";

export { webhookApp } from "./webhook";
export { httpApp } from "./http";
export { coreApp } from "./core";
export { flowApp } from "./flow";
export { dataStoreApp } from "./datastore";

/** Every built-in app the default registry loads. Add new connectors here. */
export const builtInApps: App[] = [webhookApp, httpApp, coreApp, flowApp, dataStoreApp];
