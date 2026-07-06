import type { Blueprint, Bundle, StoredExecution } from "@cyflow/shared";
import { buildExecutionSteps, createDefaultRegistry, InMemoryDataStore, runScenario } from "engine";
import type {
  ConnectionSummary,
  CreateScenarioBody,
  DataStoreDTO,
  ExecutionEntryDTO,
  RunOnceBody,
  RunOnceResult,
  ScenarioDTO,
  UpdateScenarioBody,
} from "./types";

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
  listDataStores(): Promise<DataStoreDTO[]>;
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
  private readonly registry = createDefaultRegistry();
  private readonly dataStore = new InMemoryDataStore();

  constructor(seed: ScenarioDTO[] = [seedScenario()]) {
    this.scenarios = seed;
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
    const trigger = body.trigger ?? DEFAULT_TRIGGER;
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
    return [];
  }

  async listDataStores(): Promise<DataStoreDTO[]> {
    const records = await this.dataStore.list();
    return [{ id: "default", name: "Default store", records: records.length }];
  }
}
