import type {
  Blueprint,
  Bundle,
  ExecutionContext,
  ExecutionRecord,
  ModuleNode,
  ModuleResult,
} from "@cyflow/shared";
import { resolveParamsTree, type MappingScope } from "functions";
import type { Registry } from "./registry";

/**
 * Resolve a module's `{{...}}` mapping expressions against prior module outputs
 * (Phase 4). Builds a scope keyed by module id from `ctx.steps` — each module's
 * representative output bundle — then overrides the immediate predecessor with
 * the exact `inputBundle` for THIS run, so `{{prev.field}}` is correct per
 * bundle when a module fanned out. Plain params (no `{{ }}`) pass through
 * unchanged. A malformed/failed expression throws → the walker marks the module
 * error → the execution FAILS.
 */
export function resolveParams(
  params: Record<string, unknown>,
  inputBundle: Bundle,
  ctx: ExecutionContext,
  predecessorModuleId?: string,
): Record<string, unknown> {
  const scope: MappingScope = {};
  for (const [id, step] of Object.entries(ctx.steps)) {
    scope[id] = step.bundles.length > 0 ? step.bundles[0] : {};
  }
  if (predecessorModuleId !== undefined) scope[predecessorModuleId] = inputBundle;
  return resolveParamsTree(params, scope);
}

const nowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Runs a scenario on the bundle model.
 *
 * - The first module MUST be a trigger; `triggerBundles` are its output (it is
 *   not invoked like an action).
 * - Then it follows `next`, running each module ONCE PER INPUT BUNDLE and
 *   concatenating the returned arrays to feed the next module. This is the
 *   multiplexing that makes fan-out (search / iterator) additive later.
 * - `operations` increments per module run (Make's billing unit).
 * - Stop-on-error: the first throw marks that module `error`, sets the run
 *   `FAILED`, and returns immediately with the results gathered so far.
 */
export async function runScenario(
  blueprint: Blueprint,
  triggerBundles: Bundle[],
  registry: Registry,
): Promise<ExecutionRecord> {
  const byId = new Map<string, ModuleNode>();
  for (const mod of blueprint.modules) byId.set(mod.id, mod);

  const ctx: ExecutionContext = {
    scenarioId: "phase1-scenario",
    executionId: "phase1-execution",
    operations: 0,
    steps: {},
    trigger: triggerBundles,
  };

  const first = blueprint.modules[0];
  if (!first) {
    return { status: "FAILED", operations: 0, steps: {}, error: "Blueprint has no modules" };
  }
  if (first.kind !== "trigger") {
    return {
      status: "FAILED",
      operations: 0,
      steps: {},
      error: `First module "${first.id}" must be a trigger (got "${first.kind}")`,
    };
  }

  // Trigger: its output IS the trigger bundles. One operation per bundle.
  const triggerStart = nowMs();
  ctx.operations += triggerBundles.length;
  ctx.steps[first.id] = {
    status: "success",
    operations: triggerBundles.length,
    bundles: triggerBundles,
    ms: Math.round(nowMs() - triggerStart),
  };

  let inputBundles: Bundle[] = triggerBundles;
  // The predecessor of the first action is the trigger; used so `{{prev.field}}`
  // maps to the exact current bundle.
  let previousModuleId: string = first.id;
  let current: ModuleNode | undefined = first.next ? byId.get(first.next) : undefined;

  while (current) {
    const mod = current;
    const start = nowMs();
    const outputs: Bundle[] = [];
    let ran = 0;

    try {
      const registered = registry.get(mod.app, mod.operation); // throws on miss
      // Run once per input bundle — the heart of bundle multiplexing.
      for (const inputBundle of inputBundles) {
        ran += 1;
        ctx.operations += 1;
        const resolved = resolveParams(mod.params, inputBundle, ctx, previousModuleId);
        const produced = await registered.run(inputBundle, resolved, ctx);
        outputs.push(...produced);
      }

      const result: ModuleResult = {
        status: "success",
        operations: ran,
        bundles: outputs,
        ms: Math.round(nowMs() - start),
      };
      ctx.steps[mod.id] = result;
      inputBundles = outputs;
      previousModuleId = mod.id;
      current = mod.next ? byId.get(mod.next) : undefined;
    } catch (err) {
      const message = errorMessage(err);
      ctx.steps[mod.id] = {
        status: "error",
        operations: ran,
        bundles: outputs,
        error: message,
        ms: Math.round(nowMs() - start),
      };
      return { status: "FAILED", operations: ctx.operations, steps: ctx.steps, error: message };
    }
  }

  return { status: "SUCCESS", operations: ctx.operations, steps: ctx.steps };
}
