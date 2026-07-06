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

/** Offline mock for the rest of the Telegram Bot API surface (demo mode). */
const mockTelegramGeneric: OperationRunner = async (_input, params) => [
  { ok: true, message_id: 1001, mock: true, ...(params as Record<string, unknown>) },
];

/** Every Telegram operation the catalog exposes (kept in sync with the connector). */
const TELEGRAM_OPS: { op: string; kind: "action" | "search" }[] = [
  { op: "send_photo", kind: "action" },
  { op: "send_document", kind: "action" },
  { op: "send_video", kind: "action" },
  { op: "send_animation", kind: "action" },
  { op: "send_audio", kind: "action" },
  { op: "send_voice", kind: "action" },
  { op: "send_location", kind: "action" },
  { op: "send_contact", kind: "action" },
  { op: "send_poll", kind: "action" },
  { op: "send_media_group", kind: "action" },
  { op: "edit_message_text", kind: "action" },
  { op: "delete_message", kind: "action" },
  { op: "forward_message", kind: "action" },
  { op: "copy_message", kind: "action" },
  { op: "answer_callback_query", kind: "action" },
  { op: "pin_message", kind: "action" },
  { op: "unpin_message", kind: "action" },
  { op: "create_invite_link", kind: "action" },
  { op: "set_my_commands", kind: "action" },
  { op: "get_chat", kind: "search" },
  { op: "get_chat_member", kind: "search" },
  { op: "get_file", kind: "search" },
  { op: "get_updates", kind: "search" },
  { op: "set_webhook", kind: "action" },
  { op: "delete_webhook", kind: "action" },
  { op: "get_webhook_info", kind: "search" },
];

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
  for (const { op, kind } of TELEGRAM_OPS) registry.register({ app: "telegram", operation: op, kind, run: mockTelegramGeneric });
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
