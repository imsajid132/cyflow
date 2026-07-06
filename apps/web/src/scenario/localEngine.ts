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
import { CATALOG } from "../data/catalog";

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

/**
 * Offline mock for network connectors (real calls only run server-side). Echoes
 * the params so mappings resolve; the shape is a stand-in, not the real API.
 */
const mockConnector: OperationRunner = async (_input, params) => [
  { ok: true, mock: true, ...(params as Record<string, unknown>) },
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

// Built-in engine apps (real runners) + apps with dedicated demo mocks below.
const BUILTIN_APPS = new Set(["webhook", "http", "core", "flow", "datastore", "utils"]);
const SPECIFIC_MOCKS = new Set(["http.make_request", "telegram.send_message", "slack.send_message", "openai.create_completion"]);

function createBrowserRegistry(): Registry {
  const registry = createDefaultRegistry();
  registry.register({ app: "http", operation: "make_request", kind: "action", run: mockHttp });
  registry.register({ app: "telegram", operation: "send_message", kind: "action", run: mockTelegram });
  registry.register({ app: "slack", operation: "send_message", kind: "action", run: mockSlack });
  registry.register({ app: "openai", operation: "create_completion", kind: "action", run: mockOpenAi });
  for (const [op, run] of Object.entries(utilRunners)) registry.register({ app: "utils", operation: op, kind: "action", run });
  // Every other connector module in the catalog gets a generic offline mock, so
  // "Run once" works for any connector in the browser without a network call.
  for (const app of CATALOG) {
    if (BUILTIN_APPS.has(app.key)) continue;
    for (const mod of app.modules) {
      if (SPECIFIC_MOCKS.has(`${app.key}.${mod.operation}`)) continue;
      registry.register({ app: app.key, operation: mod.operation, kind: mod.kind, run: mockConnector });
    }
  }
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
