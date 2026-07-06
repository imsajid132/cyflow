import type {
  Blueprint,
  Bundle,
  OperationRunner,
  StoredExecution,
} from "@cyflow/shared";
import { buildExecutionSteps, createDefaultRegistry, runScenario, type Registry } from "engine";

/**
 * Local "Run Once" adapter. It runs the REAL Cyflow engine in the browser —
 * real walker, bundle multiplexing, operations counting, iterator, aggregator,
 * mapping — but replaces the two network-facing leaf modules (HTTP, Telegram)
 * with deterministic mocks so a demo run works offline. The result is shaped
 * exactly like a persisted `Execution` (Phase 3/5), via the same
 * `buildExecutionSteps` the worker uses.
 */

function titleCase(input: string): string {
  return input
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Mock HTTP: derive a name from the enrich query's email. */
const mockHttp: OperationRunner = async (_input, params) => {
  const p = params as { query?: Record<string, unknown> };
  const email = String(p.query?.email ?? "");
  const name = email ? titleCase(email.split("@")[0]) : "Unknown";
  return [
    {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      data: { email, name },
    },
  ];
};

/** Mock Telegram: acknowledge the message that would have been sent. */
const mockTelegram: OperationRunner = async (_input, params) => {
  const p = params as { chatId?: string; text?: string };
  return [{ ok: true, messageId: 1001, chatId: p.chatId, sent: p.text }];
};

/** The default registry with network leaves swapped for mocks. */
function createBrowserRegistry(): Registry {
  const registry = createDefaultRegistry();
  // `register` overwrites by (app, operation) key.
  registry.register({ app: "http", operation: "make_request", kind: "action", run: mockHttp });
  registry.register({ app: "telegram", operation: "send_message", kind: "action", run: mockTelegram });
  return registry;
}

let runCounter = 0;

/** Run the blueprint through the real engine and shape the result as an Execution. */
export async function runOnce(
  blueprint: Blueprint,
  triggerBundles: Bundle[],
): Promise<StoredExecution> {
  const record = await runScenario(blueprint, triggerBundles, createBrowserRegistry());
  const steps = buildExecutionSteps(record, blueprint, triggerBundles);
  const now = new Date();
  runCounter += 1;
  return {
    id: `exec_${runCounter}`,
    scenarioId: "sample",
    status: record.status,
    operations: record.operations,
    error: record.error ?? null,
    startedAt: now,
    finishedAt: now,
    steps,
  };
}
