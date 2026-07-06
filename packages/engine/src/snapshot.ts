import type {
  Blueprint,
  Bundle,
  ExecutionRecord,
  ModuleNode,
  StoredExecutionStep,
} from "@cyflow/shared";

/**
 * Module ids in execution (pre-order) order, following `next` and — for
 * Routers — every `route.next`. Depth-first so a router's branches appear after
 * it, matching the walker's recursion.
 */
function orderedNodeIds(blueprint: Blueprint): string[] {
  const byId = new Map<string, ModuleNode>(blueprint.modules.map((m) => [m.id, m]));
  const ids: string[] = [];
  const seen = new Set<string>();

  const visit = (id: string | null | undefined): void => {
    if (!id || seen.has(id)) return;
    const mod = byId.get(id);
    if (!mod) return;
    seen.add(id);
    ids.push(id);
    if (mod.routes && mod.routes.length > 0) {
      for (const route of mod.routes) visit(route.next);
    } else {
      visit(mod.next);
    }
  };

  visit(blueprint.modules[0]?.id);
  return ids;
}

/**
 * Turn an ExecutionRecord into per-step snapshots — the persisted
 * `Execution.steps` shape (StoredExecutionStep). The engine records each
 * module's exact `input` (post-filter) and `output` bundles, so iterator
 * fan-out, filtered links, and aggregator collapses are captured faithfully.
 * A record without `input` falls back to "input N = output N-1".
 *
 * Shared by the worker (persistence) and the web UI (Run Once replay) so both
 * use one identical snapshot shape.
 */
export function buildExecutionSteps(
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
      ...(step.routes ? { routes: step.routes } : {}),
      ...(step.errorOutcome ? { errorOutcome: step.errorOutcome } : {}),
    });

    previousOutput = step.bundles;
    order += 1;
  }

  return snapshots;
}
