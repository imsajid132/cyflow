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
import { api, apiEnabled, normalizeExecution } from "./api";
import type { Connection, ExecutionEntry, Scenario, Schedule, ViewName } from "./types";

const iso = (offsetMinutes = 0) => new Date(Date.now() - offsetMinutes * 60_000).toISOString();
let counter = 100;
const uid = (prefix: string) => `${prefix}_${(counter += 1).toString(36)}`;

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

function seedExecutions(): ExecutionEntry[] {
  return [
    { scenarioId: "scn_leads", scenarioName: "Enrich leads → Telegram digest", ranAt: iso(6), execution: emptyExecution("scn_leads", "SUCCESS", 7) },
    { scenarioId: "scn_signup", scenarioName: "New signup → Slack alert", ranAt: iso(48), execution: emptyExecution("scn_signup", "SUCCESS", 2) },
    { scenarioId: "scn_sales", scenarioName: "Daily sales summary", ranAt: iso(1440), execution: emptyExecution("scn_sales", "FAILED", 3) },
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
  view: ViewName;
  selectedScenarioId: string | null;
  search: string;
  scenarios: Scenario[];
  connections: Connection[];
  executions: ExecutionEntry[];
  setSearch: (s: string) => void;
  navigate: (view: ViewName, scenarioId?: string | null) => void;
  createScenario: () => string;
  updateScenario: (id: string, patch: Partial<Scenario>) => void;
  duplicateScenario: (id: string) => void;
  deleteScenario: (id: string) => void;
  recordExecution: (scenarioId: string, execution: StoredExecution) => void;
  runOnce: (scenarioId: string, blueprint: Blueprint) => Promise<StoredExecution>;
  scenarioById: (id: string | null) => Scenario | undefined;
}

const Ctx = createContext<AppStore | null>(null);

function parseHash(): { view: ViewName; id: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "scenario" && parts[1]) return { view: "builder", id: parts[1] };
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
  const [search, setSearch] = useState("");

  // API mode: hydrate real state on mount. On failure, fall back silently to
  // whatever local state we have (never blocks the UI).
  useEffect(() => {
    if (!apiEnabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const [scn, conns, execs] = await Promise.all([
          api.listScenarios(),
          api.listConnections(),
          api.listExecutions(),
        ]);
        if (cancelled) return;
        const normExecs = execs.map((e) => ({ ...e, execution: normalizeExecution(e.execution) }));
        setConnections(conns);
        setExecutions(normExecs);
        setScenarios(enrichLastRun(scn, normExecs));
      } catch (err) {
        console.error("[cyflow] API unreachable — staying in local mode", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const initial = parseHash();
  const [view, setView] = useState<ViewName>(initial.view);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(initial.id);

  const navigate = useCallback((next: ViewName, scenarioId: string | null = null) => {
    setView(next);
    setSelectedScenarioId(scenarioId);
    const hash = next === "builder" && scenarioId ? `#/scenario/${scenarioId}` : `#/${next}`;
    if (window.location.hash !== hash) window.location.hash = hash;
  }, []);

  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash();
      setView(parsed.view);
      setSelectedScenarioId(parsed.id);
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
    (scenarioId: string, execution: StoredExecution) => {
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
          { scenarioId, scenarioName: name, ranAt: new Date().toISOString(), execution },
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
      recordExecution(scenarioId, execution);
      return execution;
    },
    [recordExecution],
  );

  const scenarioById = useCallback(
    (id: string | null) => scenarios.find((s) => s.id === id),
    [scenarios],
  );

  const value = useMemo<AppStore>(
    () => ({
      workspace: "Cyflow Team",
      mode: apiEnabled ? "api" : "local",
      view,
      selectedScenarioId,
      search,
      scenarios,
      connections,
      executions,
      setSearch,
      navigate,
      createScenario,
      updateScenario,
      duplicateScenario,
      deleteScenario,
      recordExecution,
      runOnce,
      scenarioById,
    }),
    [
      view,
      selectedScenarioId,
      search,
      scenarios,
      connections,
      executions,
      navigate,
      createScenario,
      updateScenario,
      duplicateScenario,
      deleteScenario,
      recordExecution,
      runOnce,
      scenarioById,
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
