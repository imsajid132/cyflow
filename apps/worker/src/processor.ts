import type {
  Blueprint,
  Bundle,
  ExecutionRecord,
  ExecutionRepository,
  ModuleNode,
  ScenarioRepository,
  StoredExecution,
  StoredExecutionStep,
} from "@cyflow/shared";
import { runScenario, type Registry } from "engine";

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

/** Module ids in execution order, following the linear `next` pointer. */
function orderedNodeIds(blueprint: Blueprint): string[] {
  const byId = new Map(blueprint.modules.map((m) => [m.id, m]));
  const ids: string[] = [];
  const seen = new Set<string>();
  let current: ModuleNode | undefined = blueprint.modules[0];
  while (current && !seen.has(current.id)) {
    ids.push(current.id);
    seen.add(current.id);
    current = current.next ? byId.get(current.next) : undefined;
  }
  return ids;
}

/**
 * Turn an ExecutionRecord into per-step snapshots.
 *
 * The engine records each module's exact `input` (post-filter) and `output`
 * bundles, so iterator fan-out, filtered links, and aggregator collapses are
 * captured faithfully. A pre-Phase-5 record without `input` falls back to
 * "input N = output N-1" reconstruction.
 */
export function toStepSnapshots(
  record: ExecutionRecord,
  blueprint: Blueprint,
  triggerBundles: Bundle[],
): StoredExecutionStep[] {
  const snapshots: StoredExecutionStep[] = [];
  let previousOutput: Bundle[] = triggerBundles;
  let order = 0;

  for (const nodeId of orderedNodeIds(blueprint)) {
    const step = record.steps[nodeId];
    if (!step) break; // the walk stopped here (error) or reached the end

    const input = step.input ?? (order === 0 ? triggerBundles : previousOutput);
    snapshots.push({
      moduleNodeId: nodeId,
      status: step.status,
      operations: step.operations,
      input,
      output: step.bundles,
      error: step.error,
      ms: step.ms,
      order,
    });

    previousOutput = step.bundles;
    order += 1;
  }

  return snapshots;
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
