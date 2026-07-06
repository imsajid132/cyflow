import type {
  Bundle,
  ExecutionRecord,
  ExecutionRepository,
  ScenarioRepository,
  StoredExecution,
} from "@cyflow/shared";
import { redactSecrets } from "@cyflow/shared";
import { buildExecutionSteps, runScenario, type Registry } from "engine";

/** The persisted `Execution.steps` snapshot builder (lives in the engine). */
export const toStepSnapshots = buildExecutionSteps;

/** The payload of a queued execution job. */
export interface RunJob {
  scenarioId: string;
  triggerBundles: Bundle[];
}

/** Everything the processor needs, injected so it stays DB/transport-agnostic. */
export interface WorkerDeps {
  scenarios: ScenarioRepository;
  executions: ExecutionRepository;
  registry: Registry;
  /** Resolves a module's connectionId → decrypted credentials (Phase 7). */
  getConnection?: (connectionId: string) => Promise<Record<string, unknown> | null>;
  /** Built-in key-value data store for datastore modules (Phase 8). */
  dataStore?: import("@cyflow/shared").DataStore;
}

/**
 * Run one queued scenario job through the existing bundle engine and persist the
 * result. This is the ONLY business logic in the worker (ARCHITECTURE §9): the
 * BullMQ worker simply calls this with `job.data`.
 */
export async function runScenarioJob(job: RunJob, deps: WorkerDeps): Promise<StoredExecution> {
  const scenario = await deps.scenarios.findById(job.scenarioId);
  if (!scenario) {
    throw new Error(`Scenario not found: ${job.scenarioId}`);
  }

  // Mark RUNNING before invoking the engine.
  const execution = await deps.executions.start(scenario.id);

  const record: ExecutionRecord = await runScenario(
    scenario.blueprint,
    job.triggerBundles,
    deps.registry,
    {
      scenarioId: scenario.id,
      executionId: execution.id,
      getConnection: deps.getConnection,
      dataStore: deps.dataStore,
    },
  );

  // Redact any secret-keyed values before the snapshots are persisted.
  const steps = toStepSnapshots(record, scenario.blueprint, job.triggerBundles).map((s) => ({
    ...s,
    input: redactSecrets(s.input),
    output: redactSecrets(s.output),
  }));

  return deps.executions.complete(execution.id, {
    status: record.status,
    operations: record.operations,
    error: record.error,
    steps,
  });
}
