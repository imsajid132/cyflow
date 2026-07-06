import type {
  Blueprint,
  Bundle,
  ExecutionContext,
  ExecutionRecord,
  ModuleNode,
  ModuleResult,
} from "@cyflow/shared";
import type { Registry } from "./registry";

/**
 * Resolve a module's params against the current bundle + context.
 *
 * Phase 1 stub: params are used literally. Phase 4 replaces this with the
 * `{{...}}` mapping / function engine — `runScenario` calls it once per bundle,
 * so that upgrade is drop-in.
 */
export function resolveParams(
  params: Record<string, unknown>,
  _inputBundle: Bundle,
  _ctx: ExecutionContext,
): Record<string, unknown> {
  return params;
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
        const resolved = resolveParams(mod.params, inputBundle, ctx);
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
