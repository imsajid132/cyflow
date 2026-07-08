import type { Blueprint, Bundle, StoredExecution } from "@cyflow/shared";
import { buildExecutionSteps, createDefaultRegistry, InMemoryDataStore, manualTriggerBundles, runScenario, type TestConnectionResult } from "engine";
import type {
  AppAuthDTO,
  AppSummary,
  ConnectionSummary,
  CreateConnectionBody,
  CreateScenarioBody,
  DataStoreDTO,
  DataStoreRecordDTO,
  ExecutionEntryDTO,
  OAuthCallbackResult,
  OAuthStartDTO,
  RunOnceBody,
  RunOnceResult,
  ScenarioDTO,
  UpdateConnectionBody,
  UpdateScenarioBody,
} from "./types";
import { appAuthDTO, appSummaries, testAppConnection } from "./apps";
import { oauthCallback, oauthStart } from "./oauth";

/** Default sample trigger bundle used by run-once when the caller sends none. */
export const DEFAULT_TRIGGER: Bundle[] = [
  {
    body: {
      name: "Test User",
      email: "test@example.com",
      items: [1, 2, 3],
      leads: [{ email: "lead@acme.dev" }],
    },
  },
];

/**
 * Everything the HTTP layer needs, abstracted so routes can run against Postgres
 * in production or an in-memory fake in tests. Keeps the Express app pure.
 */
export interface ApiStore {
  listScenarios(): Promise<ScenarioDTO[]>;
  getScenario(id: string): Promise<ScenarioDTO | null>;
  createScenario(body: CreateScenarioBody): Promise<ScenarioDTO>;
  updateScenario(id: string, patch: UpdateScenarioBody): Promise<ScenarioDTO | null>;
  deleteScenario(id: string): Promise<boolean>;
  runOnce(id: string, body: RunOnceBody): Promise<RunOnceResult | null>;
  listExecutions(): Promise<ExecutionEntryDTO[]>;
  getExecution(id: string): Promise<StoredExecution | null>;
  listConnections(): Promise<ConnectionSummary[]>;
  createConnection(body: CreateConnectionBody): Promise<ConnectionSummary>;
  updateConnection(id: string, patch: UpdateConnectionBody): Promise<ConnectionSummary | null>;
  deleteConnection(id: string): Promise<boolean>;
  testConnection(appKey: string, credentials: Record<string, unknown> | undefined): Promise<TestConnectionResult>;
  listApps(): Promise<AppSummary[]>;
  getAppAuth(key: string): Promise<AppAuthDTO | null>;
  oauthStart(provider: string): Promise<OAuthStartDTO>;
  oauthCallback(provider: string, query: Record<string, unknown>): Promise<OAuthCallbackResult>;
  listDataStores(): Promise<DataStoreDTO[]>;
  createDataStore(name: string, id?: string): Promise<DataStoreDTO>;
  deleteDataStore(id: string): Promise<boolean>;
  listDataStoreRecords(storeId: string): Promise<DataStoreRecordDTO[] | null>;
  upsertDataStoreRecord(storeId: string, key: string, value: unknown): Promise<DataStoreRecordDTO | null>;
  deleteDataStoreRecord(storeId: string, key: string): Promise<boolean>;
}

let seq = 0;
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq += 1).toString(36)}`;

function seedScenario(): ScenarioDTO {
  return {
    id: "scn_demo",
    name: "Webhook → Delay (demo)",
    status: "ACTIVE",
    schedule: { type: "manual" },
    blueprint: {
      modules: [
        { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
        { id: "2", app: "core", operation: "sleep", kind: "action", params: { seconds: 0 }, next: null },
      ],
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * In-memory ApiStore for tests and offline dev. Run-once uses the REAL engine
 * (built-in modules only) so the run path is exercised without a DB or network.
 */
export class InMemoryApiStore implements ApiStore {
  private scenarios: ScenarioDTO[];
  private executions: ExecutionEntryDTO[] = [];
  private connectionSummaries: ConnectionSummary[] = [];
  /** Credentials are kept here and NEVER returned from any read method. */
  private readonly secrets = new Map<string, Record<string, unknown>>();
  private readonly registry = createDefaultRegistry();
  private readonly dataStore = new InMemoryDataStore();
  /** Named stores for the management API. The default store's data is the same
   *  `dataStore` the run-once engine uses, so UI edits and runs share state. */
  private readonly stores = new Map<string, { id: string; name: string; updatedAt: string; data: InMemoryDataStore }>();

  constructor(seed: ScenarioDTO[] = [seedScenario()]) {
    this.scenarios = seed;
    this.stores.set("default", { id: "default", name: "Default store", updatedAt: new Date().toISOString(), data: this.dataStore });
  }

  async listScenarios(): Promise<ScenarioDTO[]> {
    return this.scenarios.map((s) => ({ ...s }));
  }

  async getScenario(id: string): Promise<ScenarioDTO | null> {
    const s = this.scenarios.find((x) => x.id === id);
    return s ? { ...s } : null;
  }

  async createScenario(body: CreateScenarioBody): Promise<ScenarioDTO> {
    const scenario: ScenarioDTO = {
      id: body.id ?? uid("scn"),
      name: body.name ?? "Untitled scenario",
      status: body.status ?? "DRAFT",
      schedule: body.schedule ?? { type: "manual" },
      blueprint: body.blueprint ?? { modules: [] },
      updatedAt: new Date().toISOString(),
    };
    this.scenarios = [scenario, ...this.scenarios.filter((s) => s.id !== scenario.id)];
    return { ...scenario };
  }

  async updateScenario(id: string, patch: UpdateScenarioBody): Promise<ScenarioDTO | null> {
    const idx = this.scenarios.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const updated = { ...this.scenarios[idx], ...patch, updatedAt: new Date().toISOString() };
    this.scenarios[idx] = updated;
    return { ...updated };
  }

  async deleteScenario(id: string): Promise<boolean> {
    const before = this.scenarios.length;
    this.scenarios = this.scenarios.filter((s) => s.id !== id);
    return this.scenarios.length < before;
  }

  async runOnce(id: string, body: RunOnceBody): Promise<RunOnceResult | null> {
    const scenario = this.scenarios.find((s) => s.id === id);
    if (!scenario) return null;
    const blueprint: Blueprint = body.blueprint ?? scenario.blueprint;
    const trigger = body.trigger ?? manualTriggerBundles(blueprint, DEFAULT_TRIGGER);
    const executionId = uid("exec");
    const startedAt = new Date();

    const record = await runScenario(blueprint, trigger, this.registry, {
      scenarioId: id,
      executionId,
      dataStore: this.dataStore,
    });
    const steps = buildExecutionSteps(record, blueprint, trigger);
    const execution: StoredExecution = {
      id: executionId,
      scenarioId: id,
      status: record.status,
      operations: record.operations,
      error: record.error,
      startedAt,
      finishedAt: new Date(),
      steps,
    };

    this.executions = [
      { scenarioId: id, scenarioName: scenario.name, ranAt: startedAt.toISOString(), execution },
      ...this.executions,
    ].slice(0, 50);

    return { executionId, status: execution.status, execution };
  }

  async listExecutions(): Promise<ExecutionEntryDTO[]> {
    return this.executions.map((e) => ({ ...e }));
  }

  async getExecution(id: string): Promise<StoredExecution | null> {
    return this.executions.find((e) => e.execution.id === id)?.execution ?? null;
  }

  async listConnections(): Promise<ConnectionSummary[]> {
    return this.connectionSummaries.map((c) => ({ ...c }));
  }

  async createConnection(body: CreateConnectionBody): Promise<ConnectionSummary> {
    const summary: ConnectionSummary = {
      id: uid("conn"),
      appKey: body.appKey,
      name: body.name,
      createdAt: new Date(),
    };
    this.secrets.set(summary.id, body.credentials ?? {});
    this.connectionSummaries = [summary, ...this.connectionSummaries];
    return { ...summary };
  }

  async updateConnection(id: string, patch: UpdateConnectionBody): Promise<ConnectionSummary | null> {
    const idx = this.connectionSummaries.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    if (patch.name !== undefined) this.connectionSummaries[idx] = { ...this.connectionSummaries[idx], name: patch.name };
    if (patch.credentials !== undefined) this.secrets.set(id, patch.credentials);
    return { ...this.connectionSummaries[idx] };
  }

  async deleteConnection(id: string): Promise<boolean> {
    const before = this.connectionSummaries.length;
    this.connectionSummaries = this.connectionSummaries.filter((c) => c.id !== id);
    this.secrets.delete(id);
    return this.connectionSummaries.length < before;
  }

  async testConnection(appKey: string, credentials: Record<string, unknown> | undefined): Promise<TestConnectionResult> {
    return testAppConnection(appKey, credentials);
  }

  async listApps(): Promise<AppSummary[]> {
    return appSummaries();
  }

  async getAppAuth(key: string): Promise<AppAuthDTO | null> {
    return appAuthDTO(key);
  }

  async oauthStart(provider: string): Promise<OAuthStartDTO> {
    return oauthStart(provider);
  }

  async oauthCallback(provider: string, query: Record<string, unknown>): Promise<OAuthCallbackResult> {
    return oauthCallback(provider, query);
  }

  async listDataStores(): Promise<DataStoreDTO[]> {
    const out: DataStoreDTO[] = [];
    for (const s of this.stores.values()) {
      const records = await s.data.list();
      out.push({ id: s.id, name: s.name, records: records.length, updatedAt: s.updatedAt });
    }
    return out;
  }

  async createDataStore(name: string, id?: string): Promise<DataStoreDTO> {
    const storeId = id ?? uid("ds");
    const store = { id: storeId, name: name.trim() || "New store", updatedAt: new Date().toISOString(), data: new InMemoryDataStore() };
    this.stores.set(storeId, store);
    return { id: store.id, name: store.name, records: 0, updatedAt: store.updatedAt };
  }

  async deleteDataStore(id: string): Promise<boolean> {
    if (id === "default") return false;
    return this.stores.delete(id);
  }

  async listDataStoreRecords(storeId: string): Promise<DataStoreRecordDTO[] | null> {
    const store = this.stores.get(storeId);
    if (!store) return null;
    const records = await store.data.list();
    return records.map((r) => ({ key: r.key, value: r.value, updatedAt: store.updatedAt }));
  }

  async upsertDataStoreRecord(storeId: string, key: string, value: unknown): Promise<DataStoreRecordDTO | null> {
    const store = this.stores.get(storeId);
    if (!store) return null;
    await store.data.set(key, value);
    store.updatedAt = new Date().toISOString();
    return { key, value, updatedAt: store.updatedAt };
  }

  async deleteDataStoreRecord(storeId: string, key: string): Promise<boolean> {
    const store = this.stores.get(storeId);
    if (!store) return false;
    const ok = await store.data.delete(key);
    if (ok) store.updatedAt = new Date().toISOString();
    return ok;
  }
}
