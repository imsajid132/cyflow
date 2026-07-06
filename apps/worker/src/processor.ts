import type {
  Bundle,
  ExecutionRecord,
  ExecutionRepository,
  ScenarioRepository,
  StoredExecution,
} from "@cyflow/shared";
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
  );

  const steps = toStepSnapshots(record, scenario.blueprint, job.triggerBundles);

  return deps.executions.complete(execution.id, {
    status: record.status,
    operations: record.operations,
    error: record.error,
    steps,
  });
}
