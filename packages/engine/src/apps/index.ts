import type { App } from "../app";
import { webhookApp } from "./webhook";
import { httpApp } from "./http";
import { coreApp } from "./core";

export { webhookApp } from "./webhook";
export { httpApp } from "./http";
export { coreApp } from "./core";

/** Every built-in app the default registry loads. Add new connectors here. */
export const builtInApps: App[] = [webhookApp, httpApp, coreApp];
