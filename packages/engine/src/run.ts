/**
 * Tiny CLI sanity runner (no web server this phase).
 *
 *   pnpm --filter engine start
 *
 * Loads the sample blueprint + a sample trigger bundle, runs the engine, and
 * prints the bundle-level execution record and the total operation count. The
 * HTTP step hits httpbin, so this needs network; the automated tests do not.
 */
import type { Blueprint, Bundle } from "@cyflow/shared";
import { runScenario } from "./engine";
import { createDefaultRegistry } from "./registry";

const blueprint: Blueprint = {
  modules: [
    { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
    {
      id: "2",
      app: "http",
      operation: "make_request",
      kind: "action",
      params: { method: "GET", url: "https://httpbin.org/get" },
      next: "3",
    },
    { id: "3", app: "core", operation: "sleep", kind: "action", params: { seconds: 1 }, next: null },
  ],
};

const triggerBundles: Bundle[] = [{ body: { email: "test@cyfrow.com" } }];

async function main(): Promise<void> {
  const registry = createDefaultRegistry();
  const record = await runScenario(blueprint, triggerBundles, registry);

  console.log(JSON.stringify(record, null, 2));
  console.log(`\nStatus: ${record.status} · total operations: ${record.operations}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
