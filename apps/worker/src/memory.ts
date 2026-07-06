import type {
  CompleteExecutionInput,
  CreateScenarioInput,
  ExecutionRepository,
  ScenarioRepository,
  StoredExecution,
  StoredScenario,
} from "@cyflow/shared";

let counter = 0;
const genId = (prefix: string): string => `${prefix}_${(++counter).toString(36).padStart(4, "0")}`;

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory scenario store — used by tests and local dev (no Postgres). */
export class InMemoryScenarioRepository implements ScenarioRepository {
  private readonly store = new Map<string, StoredScenario>();

  async create(input: CreateScenarioInput): Promise<StoredScenario> {
    const id = input.id ?? genId("scn");
    const scenario: StoredScenario = {
      id,
      userId: input.userId ?? null,
      name: input.name,
      status: input.status ?? "DRAFT",
      schedule: input.schedule,
      blueprint: clone(input.blueprint),
    };
    this.store.set(id, scenario);
    return clone(scenario);
  }

  async findById(id: string): Promise<StoredScenario | null> {
    const found = this.store.get(id);
    return found ? clone(found) : null;
  }
}

/** In-memory execution store — used by tests and local dev (no Postgres). */
export class InMemoryExecutionRepository implements ExecutionRepository {
  private readonly store = new Map<string, StoredExecution>();

  async start(scenarioId: string): Promise<StoredExecution> {
    const id = genId("exec");
    const execution: StoredExecution = {
      id,
      scenarioId,
      status: "RUNNING",
      operations: 0,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
      steps: [],
    };
    this.store.set(id, execution);
    return clone(execution);
  }

  async complete(executionId: string, input: CompleteExecutionInput): Promise<StoredExecution> {
    const execution = this.store.get(executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    execution.status = input.status;
    execution.operations = input.operations;
    execution.error = input.error ?? null;
    execution.finishedAt = new Date();
    execution.steps = clone(input.steps);
    return clone(execution);
  }

  async findById(id: string): Promise<StoredExecution | null> {
    const found = this.store.get(id);
    return found ? clone(found) : null;
  }
}
