import type {
  Bundle,
  ScenarioRepository,
  StoredExecution,
  StoredExecutionStep,
} from "@cyflow/shared";
import {
  PrismaConnectionStore,
  PrismaDataStore,
  PrismaExecutionRepository,
  PrismaScenarioRepository,
  prisma,
} from "@cyflow/db";
import { ConnectionService, encryptionFromEnv } from "@cyflow/connections";
import { connectorApps } from "@cyflow/connectors";
import { createDefaultRegistry } from "engine";
import { runScenarioJob, type WorkerDeps } from "@cyflow/worker";
import type {
  ConnectionSummary,
  CreateScenarioBody,
  DataStoreDTO,
  ExecutionEntryDTO,
  RunOnceBody,
  RunOnceResult,
  ScenarioDTO,
  ScenarioStatusDTO,
  ScheduleDTO,
  UpdateScenarioBody,
} from "./types";
import { DEFAULT_TRIGGER, type ApiStore } from "./store";

const DEMO_EMAIL = "demo@cyflow.dev";

type ExecRow = {
  id: string;
  scenarioId: string;
  status: string;
  operations: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  steps: {
    moduleNodeId: string;
    status: string;
    operations: number;
    input: unknown;
    output: unknown;
    error: string | null;
    ms: number;
    order: number;
    routes: unknown;
    errorOutcome: unknown;
  }[];
};

function mapExecution(row: ExecRow): StoredExecution {
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    status: row.status as StoredExecution["status"],
    operations: row.operations,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    steps: row.steps.map(
      (s): StoredExecutionStep => ({
        moduleNodeId: s.moduleNodeId,
        status: s.status === "error" ? "error" : "success",
        operations: s.operations,
        input: (s.input as Bundle[]) ?? [],
        output: (s.output as Bundle[]) ?? [],
        error: s.error ?? undefined,
        ms: s.ms,
        order: s.order,
        ...(s.routes ? { routes: s.routes as StoredExecutionStep["routes"] } : {}),
        ...(s.errorOutcome ? { errorOutcome: s.errorOutcome as StoredExecutionStep["errorOutcome"] } : {}),
      }),
    ),
  };
}

function toScenarioDTO(row: {
  id: string;
  name: string;
  status: string;
  schedule: unknown;
  blueprint: unknown;
  updatedAt: Date;
}): ScenarioDTO {
  return {
    id: row.id,
    name: row.name,
    status: row.status as ScenarioStatusDTO,
    schedule: (row.schedule as ScheduleDTO) ?? { type: "manual" },
    blueprint: (row.blueprint as ScenarioDTO["blueprint"]) ?? { modules: [] },
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Postgres-backed ApiStore. Reads/writes scenarios via Prisma and runs
 * "run once" through the existing worker path (`runScenarioJob`) with the same
 * engine + connectors + connection vault the BullMQ worker uses.
 */
export class PrismaApiStore implements ApiStore {
  private userId = "demo-user";
  private readonly scenarios = new PrismaScenarioRepository(prisma);
  private readonly executions = new PrismaExecutionRepository(prisma);
  private connections: ConnectionService | null = null;
  private readonly deps: WorkerDeps;

  constructor() {
    const registry = createDefaultRegistry();
    for (const app of connectorApps) registry.registerApp(app);

    let getConnection: WorkerDeps["getConnection"];
    try {
      this.connections = new ConnectionService(new PrismaConnectionStore(prisma), encryptionFromEnv());
      getConnection = this.connections.toGetConnection();
    } catch {
      // No CYFLOW_ENCRYPTION_KEY configured — the vault is simply unavailable.
      console.warn("[api] CYFLOW_ENCRYPTION_KEY not set — connections disabled");
      getConnection = async () => null;
    }

    this.deps = {
      scenarios: this.scenarios,
      executions: this.executions,
      registry,
      getConnection,
      dataStore: new PrismaDataStore(prisma),
    };
  }

  /** Ensure the single demo workspace user exists; cache its id. */
  async init(): Promise<void> {
    const user = await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      update: {},
      create: { email: DEMO_EMAIL, passwordHash: "-" },
    });
    this.userId = user.id;
  }

  async listScenarios(): Promise<ScenarioDTO[]> {
    const rows = await prisma.scenario.findMany({ where: { userId: this.userId }, orderBy: { updatedAt: "desc" } });
    return rows.map(toScenarioDTO);
  }

  async getScenario(id: string): Promise<ScenarioDTO | null> {
    const row = await prisma.scenario.findUnique({ where: { id } });
    return row ? toScenarioDTO(row) : null;
  }

  async createScenario(body: CreateScenarioBody): Promise<ScenarioDTO> {
    const created = await this.scenarios.create({
      id: body.id,
      userId: this.userId,
      name: body.name ?? "Untitled scenario",
      status: body.status ?? "DRAFT",
      schedule: body.schedule ?? { type: "manual" },
      blueprint: body.blueprint ?? { modules: [] },
    });
    return {
      id: created.id,
      name: created.name,
      status: (created.status as ScenarioStatusDTO) ?? "DRAFT",
      schedule: (created.schedule as ScheduleDTO) ?? { type: "manual" },
      blueprint: created.blueprint,
      updatedAt: new Date().toISOString(),
    };
  }

  async updateScenario(id: string, patch: UpdateScenarioBody): Promise<ScenarioDTO | null> {
    const exists = await prisma.scenario.findUnique({ where: { id } });
    if (!exists) return null;
    const row = await prisma.scenario.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.schedule !== undefined ? { schedule: patch.schedule as object } : {}),
        ...(patch.blueprint !== undefined ? { blueprint: patch.blueprint as object } : {}),
      },
    });
    return toScenarioDTO(row);
  }

  async deleteScenario(id: string): Promise<boolean> {
    const exists = await prisma.scenario.findUnique({ where: { id } });
    if (!exists) return false;
    await prisma.scenario.delete({ where: { id } });
    return true;
  }

  async runOnce(id: string, body: RunOnceBody): Promise<RunOnceResult | null> {
    const existing = await this.scenarios.findById(id);
    if (!existing) return null;
    const blueprint = body.blueprint ?? existing.blueprint;

    // Run the caller's current blueprint without mutating stored state, by
    // overriding only the scenario-load dep the worker path uses.
    const scenariosForRun: ScenarioRepository = {
      findById: async (sid: string) => (sid === id ? { ...existing, blueprint } : this.scenarios.findById(sid)),
      create: (input) => this.scenarios.create(input),
    };
    const trigger: Bundle[] = body.trigger ?? DEFAULT_TRIGGER;

    const execution = await runScenarioJob(
      { scenarioId: id, triggerBundles: trigger },
      { ...this.deps, scenarios: scenariosForRun },
    );
    return { executionId: execution.id, status: execution.status, execution };
  }

  async listExecutions(): Promise<ExecutionEntryDTO[]> {
    const rows = await prisma.execution.findMany({
      where: { scenario: { userId: this.userId } },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { scenario: { select: { name: true } }, steps: { orderBy: { order: "asc" } } },
    });
    return rows.map((row) => ({
      scenarioId: row.scenarioId,
      scenarioName: row.scenario?.name ?? "Scenario",
      ranAt: row.startedAt.toISOString(),
      execution: mapExecution(row as unknown as ExecRow),
    }));
  }

  async getExecution(id: string): Promise<StoredExecution | null> {
    return this.executions.findById(id);
  }

  async listConnections(): Promise<ConnectionSummary[]> {
    if (!this.connections) return [];
    return this.connections.list(this.userId);
  }

  async listDataStores(): Promise<DataStoreDTO[]> {
    const records = await prisma.dataStoreRecord.count();
    return [{ id: "default", name: "Default store", records }];
  }
}
