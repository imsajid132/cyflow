import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Blueprint, StoredExecution } from "@cyflow/shared";
import { sampleBlueprint } from "../scenario/sampleScenario";
import { runOnce as localRunOnce } from "../scenario/localEngine";
import { api, apiEnabled, AuthError, normalizeExecution, setAdminToken } from "./api";

/** API connection state (only meaningful when apiEnabled). */
export type ApiStatus = "local" | "connecting" | "connected" | "auth-required" | "offline";
import type { Connection, DataStoreDef, ExecutionEntry, Scenario, Schedule, ViewName } from "./types";

const iso = (offsetMinutes = 0) => new Date(Date.now() - offsetMinutes * 60_000).toISOString();
let counter = 100;
// Globally unique across page loads/sessions — a session-local counter alone
// collides (e.g. every fresh load's first id is the same), which the server
// rejects with a unique-constraint error.
const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(counter += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const slackAlert: Blueprint = {
  modules: [
    { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: { name: "New signup" }, next: "2" },
    { id: "2", app: "slack", operation: "send_message", kind: "action", params: { channel: "#signups", text: "New signup: {{1.body.email}}" }, connectionId: "conn_slack", next: null },
  ],
};

const salesSummary: Blueprint = {
  modules: [
    { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: { name: "Daily tick" }, next: "2" },
    { id: "2", app: "http", operation: "make_request", kind: "action", params: { method: "GET", url: "https://api.example.com/sales" }, next: "3" },
    { id: "3", app: "openai", operation: "create_completion", kind: "action", params: { model: "gpt-4o-mini", prompt: "Summarise: {{2.data}}" }, connectionId: "conn_openai", next: null },
  ],
};

const ticketRouter: Blueprint = {
  modules: [
    { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: { name: "New ticket" }, next: "2" },
    {
      id: "2",
      app: "flow",
      operation: "router",
      kind: "router",
      params: {},
      routes: [
        { label: "urgent", filter: { left: "{{1.body.priority}}", operator: "equals", right: "high" }, next: "3" },
        { label: "normal", next: "4" },
      ],
      next: null,
    },
    { id: "3", app: "slack", operation: "send_message", kind: "action", params: { channel: "#urgent", text: "Urgent: {{1.body.subject}}" }, connectionId: "conn_slack", next: null },
    { id: "4", app: "gmail", operation: "send_email", kind: "action", params: { to: "support@acme.dev", subject: "Ticket", body: "{{1.body.subject}}" }, next: null },
  ],
};

const cacheScores: Blueprint = {
  modules: [
    { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: { name: "Lead scored" }, next: "2" },
    { id: "2", app: "datastore", operation: "set_record", kind: "action", params: { store: "Default store", key: "lead:{{1.body.email}}", value: "{{1.body.score}}" }, next: null },
  ],
};

function seedScenarios(): Scenario[] {
  return [
    {
      id: "scn_router",
      name: "Support ticket router",
      status: "ACTIVE",
      schedule: { type: "manual" },
      blueprint: ticketRouter,
      lastRunAt: iso(20),
      lastStatus: "SUCCESS",
      operations: 4,
      updatedAt: iso(20),
    },
    {
      id: "scn_cache",
      name: "Cache lead scores",
      status: "ACTIVE",
      schedule: { type: "manual" },
      blueprint: cacheScores,
      lastRunAt: iso(90),
      lastStatus: "SUCCESS",
      operations: 2,
      updatedAt: iso(90),
    },
    {
      id: "scn_leads",
      name: "Enrich leads → Telegram digest",
      status: "ACTIVE",
      schedule: { type: "interval", minutes: 15 },
      blueprint: sampleBlueprint,
      lastRunAt: iso(6),
      lastStatus: "SUCCESS",
      operations: 7,
      updatedAt: iso(6),
    },
    {
      id: "scn_signup",
      name: "New signup → Slack alert",
      status: "ACTIVE",
      schedule: { type: "manual" },
      blueprint: slackAlert,
      lastRunAt: iso(48),
      lastStatus: "SUCCESS",
      operations: 2,
      updatedAt: iso(120),
    },
    {
      id: "scn_sales",
      name: "Daily sales summary",
      status: "PAUSED",
      schedule: { type: "daily", time: "08:00" },
      blueprint: salesSummary,
      lastRunAt: iso(1440),
      lastStatus: "FAILED",
      operations: 3,
      updatedAt: iso(1500),
    },
  ];
}

function seedConnections(): Connection[] {
  return [
    { id: "conn_telegram", appKey: "telegram", name: "Cyflow Bot", createdAt: iso(4000) },
    { id: "conn_slack", appKey: "slack", name: "Acme Workspace", createdAt: iso(6000) },
    { id: "conn_openai", appKey: "openai", name: "OpenAI · production", createdAt: iso(9000) },
  ];
}

function seedDataStores(): DataStoreDef[] {
  return [
    {
      id: "ds_default",
      name: "Default store",
      updatedAt: iso(15),
      records: [
        { key: "lead:ada@lovelace.dev", value: { score: 42, tags: ["vip"], enriched: true }, updatedAt: iso(15) },
        { key: "counter:signups", value: 128, updatedAt: iso(30) },
        { key: "flag:maintenance", value: false, updatedAt: iso(240) },
        { key: "config:webhook", value: { url: "https://hooks.example.com/x", active: true }, updatedAt: iso(600) },
      ],
    },
  ];
}

function emptyExecution(scenarioId: string, status: "SUCCESS" | "FAILED", operations: number): StoredExecution {
  return {
    id: uid("exec"),
    scenarioId,
    status,
    operations,
    error: status === "FAILED" ? "http.make_request network error" : null,
    startedAt: new Date(),
    finishedAt: new Date(),
    steps: [],
  };
}

/** A fully-populated demo execution (so the replay is usable on first load). */
function leadsExecution(): StoredExecution {
  const started = new Date(Date.now() - 6 * 60_000);
  const trigger = { body: { leads: [{ email: "ada@lovelace.dev" }, { email: "grace@hopper.dev" }, { email: "kay@johnson.dev" }] } };
  const iter = [0, 1, 2].map((i) => ({ value: { email: trigger.body.leads[i].email }, index: i, total: 3 }));
  const http = iter.map((b) => ({
    statusCode: 200,
    headers: { "content-type": "application/json", "x-request-id": "req_8f2a", "cache-control": "no-store" },
    data: { name: b.value.email.split("@")[0], score: 42 },
  }));
  return {
    id: "exec_demo",
    scenarioId: "scn_leads",
    status: "SUCCESS",
    operations: 9,
    error: null,
    startedAt: started,
    finishedAt: new Date(started.getTime() + 247),
    steps: [
      { moduleNodeId: "1", status: "success", operations: 1, input: [trigger], output: [trigger], ms: 2, order: 0 },
      { moduleNodeId: "2", status: "success", operations: 1, input: [trigger], output: iter, ms: 5, order: 1 },
      { moduleNodeId: "3", status: "success", operations: 3, input: iter, output: http, ms: 186, order: 2 },
      { moduleNodeId: "4", status: "success", operations: 3, input: http, output: [{ array: http.map((h) => h.data.name) }], ms: 3, order: 3 },
      { moduleNodeId: "5", status: "success", operations: 1, input: [{ array: http.map((h) => h.data.name) }], output: [{ ok: true, messageId: 1024 }], ms: 51, order: 4 },
    ],
  };
}

/** A failed demo execution: the HTTP module errors, OpenAI never runs. */
function salesFailedExecution(): StoredExecution {
  const started = new Date(Date.now() - 1440 * 60_000);
  const trigger = { body: { date: "2026-07-06", source: "cron" } };
  return {
    id: "exec_sales_fail",
    scenarioId: "scn_sales",
    status: "FAILED",
    operations: 2,
    error: "http.make_request network error",
    startedAt: started,
    finishedAt: new Date(started.getTime() + 132),
    steps: [
      { moduleNodeId: "1", status: "success", operations: 1, input: [trigger], output: [trigger], ms: 2, order: 0 },
      {
        moduleNodeId: "2",
        status: "error",
        operations: 1,
        input: [trigger],
        output: [],
        error: "make_request failed: connect ECONNREFUSED api.example.com:443",
        ms: 118,
        order: 1,
      },
    ],
  };
}

function seedExecutions(): ExecutionEntry[] {
  return [
    { scenarioId: "scn_leads", scenarioName: "Enrich leads → Telegram digest", ranAt: iso(6), execution: leadsExecution(), blueprint: sampleBlueprint },
    { scenarioId: "scn_signup", scenarioName: "New signup → Slack alert", ranAt: iso(48), execution: emptyExecution("scn_signup", "SUCCESS", 2) },
    { scenarioId: "scn_sales", scenarioName: "Daily sales summary", ranAt: iso(1440), execution: salesFailedExecution(), blueprint: salesSummary },
  ];
}

/** Fold each scenario's latest execution into its dashboard summary fields. */
function enrichLastRun(scenarios: Scenario[], execs: ExecutionEntry[]): Scenario[] {
  return scenarios.map((s) => {
    const latest = execs.find((e) => e.scenarioId === s.id);
    if (!latest) return s;
    return {
      ...s,
      lastRunAt: latest.ranAt,
      lastStatus: latest.execution.status === "FAILED" ? "FAILED" : "SUCCESS",
      operations: latest.execution.operations,
    };
  });
}

interface AppStore {
  workspace: string;
  mode: "api" | "local";
  apiStatus: ApiStatus;
  connectApi: (token: string) => Promise<ApiStatus>;
  view: ViewName;
  selectedScenarioId: string | null;
  selectedExecutionId: string | null;
  search: string;
  scenarios: Scenario[];
  connections: Connection[];
  executions: ExecutionEntry[];
  setSearch: (s: string) => void;
  navigate: (view: ViewName, id?: string | null) => void;
  openExecution: (executionId: string) => void;
  createScenario: () => string;
  updateScenario: (id: string, patch: Partial<Scenario>) => void;
  duplicateScenario: (id: string) => void;
  deleteScenario: (id: string) => void;
  recordExecution: (scenarioId: string, execution: StoredExecution, blueprint?: Blueprint) => void;
  runOnce: (scenarioId: string, blueprint: Blueprint) => Promise<StoredExecution>;
  createConnection: (input: { appKey: string; name: string; credentials?: Record<string, unknown> }) => Promise<Connection>;
  reloadConnections: () => Promise<Connection[]>;
  updateConnection: (id: string, patch: { name?: string; credentials?: Record<string, unknown> }) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  dataStores: DataStoreDef[];
  dataStoreById: (id: string | null) => DataStoreDef | undefined;
  createDataStore: (name: string) => string;
  deleteDataStore: (id: string) => void;
  upsertRecord: (storeId: string, key: string, value: unknown) => void;
  deleteRecord: (storeId: string, key: string) => void;
  scenarioById: (id: string | null) => Scenario | undefined;
  executionById: (id: string | null) => ExecutionEntry | undefined;
}

const Ctx = createContext<AppStore | null>(null);

function parseHash(): { view: ViewName; id: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "scenario" && parts[1]) return { view: "builder", id: parts[1] };
  if (parts[0] === "execution" && parts[1]) return { view: "replay", id: parts[1] };
  const views: ViewName[] = [
    "dashboard",
    "scenarios",
    "templates",
    "connections",
    "executions",
    "datastores",
    "settings",
  ];
  const v = views.find((x) => x === parts[0]);
  return { view: v ?? "dashboard", id: null };
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [scenarios, setScenarios] = useState<Scenario[]>(() => (apiEnabled ? [] : seedScenarios()));
  const [connections, setConnections] = useState<Connection[]>(() => (apiEnabled ? [] : seedConnections()));
  const [executions, setExecutions] = useState<ExecutionEntry[]>(() => (apiEnabled ? [] : seedExecutions()));
  // Data-store records live in a local adapter (no API record endpoints yet),
  // seeded in both modes so the feature works on the deployed demo.
  const [dataStores, setDataStores] = useState<DataStoreDef[]>(seedDataStores);
  const [search, setSearch] = useState("");
  const [apiStatus, setApiStatus] = useState<ApiStatus>(apiEnabled ? "connecting" : "local");

  // Load real state from the API. Distinguishes auth-required (401) from
  // unreachable so the UI can show an admin-token gate.
  const loadFromApi = useCallback(async (): Promise<ApiStatus> => {
    if (!apiEnabled) return "local";
    try {
      const [scn, conns, execs] = await Promise.all([
        api.listScenarios(),
        api.listConnections(),
        api.listExecutions(),
      ]);
      const normExecs = execs.map((e) => ({ ...e, execution: normalizeExecution(e.execution) }));
      setConnections(conns);
      setExecutions(normExecs);
      setScenarios(enrichLastRun(scn, normExecs));
      setApiStatus("connected");
      return "connected";
    } catch (err) {
      if (err instanceof AuthError) {
        setApiStatus("auth-required");
        return "auth-required";
      }
      console.error("[cyflow] API unreachable — staying in local mode", err);
      setApiStatus("offline");
      return "offline";
    }
  }, []);

  useEffect(() => {
    void loadFromApi();
  }, [loadFromApi]);

  /** Save an admin token, then retry the API load. Returns the new status. */
  const connectApi = useCallback(
    async (token: string): Promise<ApiStatus> => {
      setAdminToken(token);
      setApiStatus("connecting");
      return loadFromApi();
    },
    [loadFromApi],
  );

  const initial = parseHash();
  const [view, setView] = useState<ViewName>(initial.view);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(
    initial.view === "replay" ? null : initial.id,
  );
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    initial.view === "replay" ? initial.id : null,
  );

  const navigate = useCallback((next: ViewName, id: string | null = null) => {
    setView(next);
    if (next === "builder") {
      setSelectedScenarioId(id);
    } else if (next === "replay") {
      setSelectedExecutionId(id);
    } else {
      setSelectedScenarioId(id);
    }
    const hash =
      next === "builder" && id ? `#/scenario/${id}` : next === "replay" && id ? `#/execution/${id}` : `#/${next}`;
    if (window.location.hash !== hash) window.location.hash = hash;
  }, []);

  const openExecution = useCallback((executionId: string) => navigate("replay", executionId), [navigate]);

  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash();
      setView(parsed.view);
      if (parsed.view === "replay") setSelectedExecutionId(parsed.id);
      else setSelectedScenarioId(parsed.id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const createScenario = useCallback((): string => {
    const id = uid("scn");
    const scenario: Scenario = {
      id,
      name: "Untitled scenario",
      status: "DRAFT",
      schedule: { type: "manual" },
      blueprint: { modules: [] },
      updatedAt: new Date().toISOString(),
    };
    setScenarios((prev) => [scenario, ...prev]);
    if (apiEnabled) api.createScenario(scenario).catch((e) => console.error("[cyflow] create failed", e));
    navigate("builder", id);
    return id;
  }, [navigate]);

  const updateScenario = useCallback((id: string, patch: Partial<Scenario>) => {
    setScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s)),
    );
    if (apiEnabled) api.updateScenario(id, patch).catch((e) => console.error("[cyflow] update failed", e));
  }, []);

  const duplicateScenario = useCallback(
    (id: string) => {
      const src = scenarios.find((s) => s.id === id);
      if (!src) return;
      const copy: Scenario = {
        ...src,
        id: uid("scn"),
        name: `${src.name} (copy)`,
        status: "DRAFT",
        lastRunAt: undefined,
        lastStatus: undefined,
        operations: undefined,
        updatedAt: new Date().toISOString(),
        blueprint: JSON.parse(JSON.stringify(src.blueprint)) as Scenario["blueprint"],
      };
      setScenarios((prev) => [copy, ...prev]);
      if (apiEnabled) api.createScenario(copy).catch((e) => console.error("[cyflow] duplicate failed", e));
    },
    [scenarios],
  );

  const deleteScenario = useCallback((id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    if (apiEnabled) api.deleteScenario(id).catch((e) => console.error("[cyflow] delete failed", e));
  }, []);

  const recordExecution = useCallback(
    (scenarioId: string, execution: StoredExecution, blueprint?: Blueprint) => {
      setScenarios((prev) =>
        prev.map((s) =>
          s.id === scenarioId
            ? {
                ...s,
                lastRunAt: new Date().toISOString(),
                lastStatus: execution.status === "FAILED" ? "FAILED" : "SUCCESS",
                operations: execution.operations,
              }
            : s,
        ),
      );
      setExecutions((prev) => {
        const known = prev.find((e) => e.scenarioId === scenarioId)?.scenarioName;
        const name = known ?? scenarios.find((s) => s.id === scenarioId)?.name ?? "Scenario";
        return [
          { scenarioId, scenarioName: name, ranAt: new Date().toISOString(), execution, blueprint },
          ...prev,
        ].slice(0, 50);
      });
    },
    [scenarios],
  );

  // Run once: real API when configured, else the in-browser mock engine. Either
  // way returns a snapshot compatible with the builder replay + inspector.
  const runOnce = useCallback(
    async (scenarioId: string, blueprint: Blueprint): Promise<StoredExecution> => {
      let execution: StoredExecution;
      if (apiEnabled) {
        const res = await api.runOnce(scenarioId, { blueprint });
        execution = normalizeExecution(res.execution);
      } else {
        execution = await localRunOnce(blueprint);
      }
      recordExecution(scenarioId, execution, blueprint);
      return execution;
    },
    [recordExecution],
  );

  // Connections: create/update send credentials to the API (never kept in the
  // browser beyond the request); reads are redacted summaries. In local demo
  // mode only a summary is tracked — no credentials are stored anywhere.
  const createConnection = useCallback(
    async (input: { appKey: string; name: string; credentials?: Record<string, unknown> }): Promise<Connection> => {
      if (apiEnabled) {
        const summary = await api.createConnection(input);
        setConnections((prev) => [summary, ...prev.filter((c) => c.id !== summary.id)]);
        return summary;
      }
      const summary: Connection = { id: uid("conn"), appKey: input.appKey, name: input.name, createdAt: new Date().toISOString() };
      setConnections((prev) => [summary, ...prev]);
      return summary;
    },
    [],
  );

  /** Re-fetch the connection list (e.g. after an OAuth popup created one server-side). */
  const reloadConnections = useCallback(async (): Promise<Connection[]> => {
    if (!apiEnabled) return [];
    const conns = await api.listConnections();
    setConnections(conns);
    return conns;
  }, []);

  const updateConnection = useCallback(
    async (id: string, patch: { name?: string; credentials?: Record<string, unknown> }): Promise<void> => {
      if (apiEnabled) {
        const summary = await api.updateConnection(id, patch);
        setConnections((prev) => prev.map((c) => (c.id === id ? summary : c)));
        return;
      }
      if (patch.name !== undefined) {
        setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, name: patch.name! } : c)));
      }
    },
    [],
  );

  const deleteConnection = useCallback(async (id: string): Promise<void> => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
    if (apiEnabled) await api.deleteConnection(id).catch((e) => console.error("[cyflow] delete connection failed", e));
  }, []);

  const scenarioById = useCallback(
    (id: string | null) => scenarios.find((s) => s.id === id),
    [scenarios],
  );

  const executionById = useCallback(
    (id: string | null) => executions.find((e) => e.execution.id === id),
    [executions],
  );

  // ---- data stores (local adapter) ----
  const dataStoreById = useCallback((id: string | null) => dataStores.find((d) => d.id === id), [dataStores]);

  const createDataStore = useCallback((name: string): string => {
    const id = uid("ds");
    setDataStores((prev) => [...prev, { id, name: name.trim() || "New store", records: [], updatedAt: new Date().toISOString() }]);
    return id;
  }, []);

  const deleteDataStore = useCallback((id: string) => {
    setDataStores((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const upsertRecord = useCallback((storeId: string, key: string, value: unknown) => {
    const now = new Date().toISOString();
    setDataStores((prev) =>
      prev.map((d) => {
        if (d.id !== storeId) return d;
        const exists = d.records.some((r) => r.key === key);
        const records = exists
          ? d.records.map((r) => (r.key === key ? { key, value, updatedAt: now } : r))
          : [{ key, value, updatedAt: now }, ...d.records];
        return { ...d, records, updatedAt: now };
      }),
    );
  }, []);

  const deleteRecord = useCallback((storeId: string, key: string) => {
    const now = new Date().toISOString();
    setDataStores((prev) =>
      prev.map((d) => (d.id === storeId ? { ...d, records: d.records.filter((r) => r.key !== key), updatedAt: now } : d)),
    );
  }, []);

  const value = useMemo<AppStore>(
    () => ({
      workspace: "Cyflow Team",
      mode: apiEnabled ? "api" : "local",
      apiStatus,
      connectApi,
      view,
      selectedScenarioId,
      selectedExecutionId,
      search,
      scenarios,
      connections,
      executions,
      setSearch,
      navigate,
      openExecution,
      createScenario,
      updateScenario,
      duplicateScenario,
      deleteScenario,
      recordExecution,
      runOnce,
      createConnection,
      reloadConnections,
      updateConnection,
      deleteConnection,
      dataStores,
      dataStoreById,
      createDataStore,
      deleteDataStore,
      upsertRecord,
      deleteRecord,
      scenarioById,
      executionById,
    }),
    [
      apiStatus,
      connectApi,
      view,
      selectedScenarioId,
      selectedExecutionId,
      search,
      scenarios,
      connections,
      executions,
      navigate,
      openExecution,
      createScenario,
      updateScenario,
      duplicateScenario,
      deleteScenario,
      recordExecution,
      runOnce,
      createConnection,
      reloadConnections,
      updateConnection,
      deleteConnection,
      dataStores,
      dataStoreById,
      createDataStore,
      deleteDataStore,
      upsertRecord,
      deleteRecord,
      scenarioById,
      executionById,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): AppStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within AppStoreProvider");
  return ctx;
}

export type { Schedule };
