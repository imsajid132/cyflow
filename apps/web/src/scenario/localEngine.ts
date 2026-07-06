import type {
  Blueprint,
  Bundle,
  OperationRunner,
  StoredExecution,
} from "@cyflow/shared";
import {
  buildExecutionSteps,
  createDefaultRegistry,
  InMemoryDataStore,
  runScenario,
  type Registry,
} from "engine";

/**
 * Local "Run Once" adapter. Runs the REAL Cyflow engine in the browser — real
 * walker, bundle multiplexing, operations counting, iterator, aggregator,
 * router, error handlers, mapping — with network-facing connectors replaced by
 * deterministic mocks so scenarios run offline on the deployed frontend. The
 * result is shaped exactly like a persisted Execution (Phase 3/5).
 */

function titleCase(input: string): string {
  return input
    .split(/[.\-_@]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const mockHttp: OperationRunner = async (_input, params) => {
  const p = params as { url?: unknown; method?: unknown; query?: Record<string, unknown> };
  const email = String(p.query?.email ?? "");
  return [
    {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      data: email
        ? { email, name: titleCase(email.split("@")[0]) }
        : { ok: true, url: p.url, method: p.method ?? "GET" },
    },
  ];
};

const mockTelegram: OperationRunner = async (_input, params) => {
  const p = params as { chatId?: unknown; text?: unknown };
  return [{ ok: true, messageId: 1001, chatId: p.chatId, sent: p.text }];
};

const mockSlack: OperationRunner = async (_input, params) => {
  const p = params as { channel?: unknown; text?: unknown };
  return [{ ok: true, channel: p.channel, ts: "1700000000.0001", text: p.text }];
};

const mockOpenAi: OperationRunner = async (_input, params) => {
  const p = params as { model?: unknown; prompt?: unknown };
  return [
    {
      content: `Mocked completion for: ${String(p.prompt ?? "").slice(0, 60)}`,
      model: p.model ?? "gpt-4o-mini",
    },
  ];
};

const mockGmail: OperationRunner = async (_input, params) => {
  const p = params as { to?: unknown; subject?: unknown };
  return [{ id: "m_mock", threadId: "t_mock", to: p.to, subject: p.subject }];
};

const mockSheets: OperationRunner = async (_input, params) => {
  const p = params as { range?: unknown };
  return [{ updatedRange: `${String(p.range ?? "Sheet1!A1")}`, updatedRows: 1 }];
};

// A single data store instance so datastore modules persist across runs.
const dataStore = new InMemoryDataStore();

function createBrowserRegistry(): Registry {
  const registry = createDefaultRegistry();
  registry.register({ app: "http", operation: "make_request", kind: "action", run: mockHttp });
  registry.register({ app: "telegram", operation: "send_message", kind: "action", run: mockTelegram });
  registry.register({ app: "slack", operation: "send_message", kind: "action", run: mockSlack });
  registry.register({ app: "openai", operation: "create_completion", kind: "action", run: mockOpenAi });
  registry.register({ app: "gmail", operation: "send_email", kind: "action", run: mockGmail });
  registry.register({ app: "sheets", operation: "append_row", kind: "action", run: mockSheets });
  return registry;
}

/** A generic sample payload so common mappings resolve on "Run once". */
export const DEFAULT_TRIGGER: Bundle[] = [
  {
    body: {
      name: "Ada Lovelace",
      email: "ada@lovelace.dev",
      leads: [
        { email: "ada@lovelace.dev" },
        { email: "grace@hopper.dev" },
        { email: "kay@johnson.dev" },
      ],
      items: [1, 2, 3],
    },
  },
];

let runCounter = 0;

export async function runOnce(
  blueprint: Blueprint,
  triggerBundles: Bundle[] = DEFAULT_TRIGGER,
): Promise<StoredExecution> {
  const record = await runScenario(blueprint, triggerBundles, createBrowserRegistry(), { dataStore });
  const steps = buildExecutionSteps(record, blueprint, triggerBundles);
  const now = new Date();
  runCounter += 1;
  return {
    id: `exec_${runCounter}`,
    scenarioId: "local",
    status: record.status,
    operations: record.operations,
    error: record.error ?? null,
    startedAt: now,
    finishedAt: now,
    steps,
  };
}
