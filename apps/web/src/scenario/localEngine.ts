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

/** Offline mock for the Google connectors (real calls only run server-side). */
const mockGoogle: OperationRunner = async (_input, params) => [
  { ok: true, mock: true, ...(params as Record<string, unknown>) },
];

const GOOGLE_OPS: { app: string; op: string; kind: "action" | "search" }[] = [
  ...["search_emails", "read_email", "list_labels"].map((op) => ({ app: "gmail", op, kind: "search" as const })),
  ...["send_email", "reply_email", "create_draft", "add_label", "remove_label"].map((op) => ({ app: "gmail", op, kind: "action" as const })),
  ...["list_spreadsheets", "list_sheets", "read_range", "search_rows"].map((op) => ({ app: "sheets", op, kind: "search" as const })),
  ...["append_row", "update_range"].map((op) => ({ app: "sheets", op, kind: "action" as const })),
  ...["search_files", "get_file", "download_file"].map((op) => ({ app: "drive", op, kind: "search" as const })),
  ...["upload_file", "create_folder", "move_file", "copy_file", "delete_file"].map((op) => ({ app: "drive", op, kind: "action" as const })),
  ...["list_calendars", "list_events"].map((op) => ({ app: "calendar", op, kind: "search" as const })),
  ...["create_event", "update_event", "delete_event"].map((op) => ({ app: "calendar", op, kind: "action" as const })),
];

// JSON / CSV utilities are pure transforms — run the real logic offline too.
function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
function toCsv(rows: unknown[], delimiter = ","): string {
  if (rows.length === 0) return "";
  const q = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /["\n\r]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const first = rows[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const headers = Object.keys(first as Record<string, unknown>);
    return [headers.map(q).join(delimiter), ...(rows as Record<string, unknown>[]).map((r) => headers.map((h) => q(r[h])).join(delimiter))].join("\n");
  }
  return (rows as unknown[][]).map((r) => (Array.isArray(r) ? r : [r]).map(q).join(delimiter)).join("\n");
}

const utilRunners: Record<string, OperationRunner> = {
  parse_json: async (_i, p) => {
    const t = (p as { text?: unknown }).text;
    return [{ value: typeof t === "string" ? JSON.parse(t) : t }];
  },
  to_json: async (_i, p) => {
    const q = p as { value?: unknown; pretty?: unknown };
    return [{ text: JSON.stringify(q.value ?? null, null, q.pretty ? 2 : 0) }];
  },
  parse_csv: async (_i, p) => {
    const q = p as { text?: unknown; delimiter?: unknown; header?: unknown };
    const grid = parseCsv(String(q.text ?? ""), typeof q.delimiter === "string" && q.delimiter ? q.delimiter : ",");
    if (q.header) {
      const [head, ...body] = grid;
      const keys = head ?? [];
      const objects = body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
      return [{ rows: objects, count: objects.length }];
    }
    return [{ rows: grid, count: grid.length }];
  },
  to_csv: async (_i, p) => {
    const q = p as { rows?: unknown; delimiter?: unknown };
    const rows = Array.isArray(q.rows) ? (q.rows as unknown[]) : [];
    return [{ text: toCsv(rows, typeof q.delimiter === "string" && q.delimiter ? q.delimiter : ",") }];
  },
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
  for (const { app, op, kind } of GOOGLE_OPS) registry.register({ app, operation: op, kind, run: mockGoogle });
  for (const [op, run] of Object.entries(utilRunners)) registry.register({ app: "utils", operation: op, kind: "action", run });
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
