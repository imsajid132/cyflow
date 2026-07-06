import type {
  Blueprint,
  Bundle,
  ExecutionContext,
  ExecutionRecord,
  ModuleNode,
  ModuleResult,
  RouteSummary,
} from "@cyflow/shared";
import { evaluateFilter, resolveParamsTree, type Filter, type MappingScope } from "functions";
import type { Registry } from "./registry";
import { AGGREGATE_INPUT_KEY } from "./modules/flow";

/** Thrown to unwind the walk when the scenario must stop (error / break / commit). */
class StopSignal extends Error {
  constructor(
    readonly outcome: "SUCCESS" | "FAILED",
    message: string,
  ) {
    super(message);
    this.name = "StopSignal";
  }
}

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

/** Build a mapping scope keyed by module id from prior outputs. */
function buildScope(ctx: ExecutionContext): MappingScope {
  const scope: MappingScope = {};
  for (const [id, step] of Object.entries(ctx.steps)) {
    scope[id] = step.bundles.length > 0 ? step.bundles[0] : {};
  }
  return scope;
}

/**
 * Apply a link filter to a module's output bundles: keep only those whose
 * condition passes. The source module's output for the current bundle is the
 * bundle itself, so `{{source.field}}` addresses it. A malformed filter throws
 * → the module errors → the run FAILS.
 */
function applyFilter(
  bundles: Bundle[],
  filter: unknown,
  ctx: ExecutionContext,
  sourceModuleId: string,
): Bundle[] {
  return bundles.filter((bundle) => {
    const scope = buildScope(ctx);
    scope[sourceModuleId] = bundle;
    return evaluateFilter(filter as Filter, scope);
  });
}

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
export interface RunScenarioOptions {
  scenarioId?: string;
  executionId?: string;
  /** Resolves a module's connectionId → decrypted credentials (Phase 7). */
  getConnection?: ExecutionContext["getConnection"];
  /** Built-in data store for datastore modules (Phase 8). */
  dataStore?: ExecutionContext["dataStore"];
}

/**
 * Runs a scenario on the bundle model.
 *
 * - The first module MUST be a trigger; `triggerBundles` are its output.
 * - The walk is a recursion following `next` (a single link) or `routes` (a
 *   Router's many links, each with its own filter — a bundle may take several).
 * - Each module runs ONCE PER INPUT BUNDLE (aggregators once over all), and
 *   `operations` increments per run (Router/flow control is free, like filters).
 * - Error handlers (resume/ignore/break/rollback/commit) decide what happens
 *   when a module throws; without one, the first throw stops the run FAILED.
 */
export async function runScenario(
  blueprint: Blueprint,
  triggerBundles: Bundle[],
  registry: Registry,
  options: RunScenarioOptions = {},
): Promise<ExecutionRecord> {
  const byId = new Map<string, ModuleNode>();
  for (const mod of blueprint.modules) byId.set(mod.id, mod);

  const ctx: ExecutionContext = {
    scenarioId: options.scenarioId ?? "phase1-scenario",
    executionId: options.executionId ?? "phase1-execution",
    operations: 0,
    steps: {},
    trigger: triggerBundles,
    getConnection: options.getConnection,
    connection: null,
    dataStore: options.dataStore,
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
    input: triggerBundles,
    bundles: triggerBundles,
    ms: Math.round(nowMs() - triggerStart),
  };

  const visited = new Set<string>();

  const recordError = (
    mod: ModuleNode,
    input: Bundle[],
    outputs: Bundle[],
    ran: number,
    start: number,
    message: string,
    errorOutcome?: ModuleResult["errorOutcome"],
  ): void => {
    ctx.steps[mod.id] = {
      status: "error",
      operations: ran,
      input,
      bundles: outputs,
      error: message,
      ms: Math.round(nowMs() - start),
      ...(errorOutcome ? { errorOutcome } : {}),
    };
  };

  /**
   * Apply the module's error handler after a bundle threw. Resume/ignore are
   * handled inline (mutating `outputs`) and return undefined; break/rollback/
   * commit return a StopSignal that unwinds the walk.
   */
  const handleError = (mod: ModuleNode, err: unknown, outputs: Bundle[]): StopSignal | undefined => {
    const handler = mod.errorHandler!;
    switch (handler.type) {
      case "ignore":
        return undefined; // drop the failed bundle
      case "resume": {
        const fb = handler.fallback;
        outputs.push(...(fb === undefined ? [{}] : Array.isArray(fb) ? fb : [fb]));
        return undefined;
      }
      case "break":
        return new StopSignal("FAILED", `Break at "${mod.id}": ${errorMessage(err)}`);
      case "rollback":
        return new StopSignal("FAILED", `Rollback at "${mod.id}": ${errorMessage(err)}`);
      case "commit":
        return new StopSignal("SUCCESS", `Commit at "${mod.id}": ${errorMessage(err)}`);
      default:
        return new StopSignal("FAILED", errorMessage(err));
    }
  };

  const processModule = async (
    mod: ModuleNode,
    inputBundles: Bundle[],
    previousModuleId: string,
  ): Promise<void> => {
    if (visited.has(mod.id)) return; // each module runs once per cycle (guards cycles)
    visited.add(mod.id);

    const start = nowMs();
    const inputForStep = inputBundles;
    const outputs: Bundle[] = [];
    const counts = mod.kind !== "router"; // Router is free flow-control
    let ran = 0;
    let handled = 0;

    let registered;
    try {
      registered = registry.get(mod.app, mod.operation);
    } catch (err) {
      recordError(mod, inputForStep, outputs, 0, start, errorMessage(err));
      throw new StopSignal("FAILED", errorMessage(err));
    }

    // Resolve this module's connection credentials (Phase 7).
    ctx.connection =
      mod.connectionId && ctx.getConnection ? await ctx.getConnection(mod.connectionId) : null;

    if (mod.kind === "aggregator") {
      // Aggregators break the per-bundle recursion: one run over ALL bundles.
      ran = 1;
      if (counts) ctx.operations += 1;
      try {
        const resolved = resolveParams(mod.params, {}, ctx);
        outputs.push(...(await registered.run({ [AGGREGATE_INPUT_KEY]: inputBundles }, resolved, ctx)));
      } catch (err) {
        if (!mod.errorHandler) {
          recordError(mod, inputForStep, outputs, ran, start, errorMessage(err));
          throw new StopSignal("FAILED", errorMessage(err));
        }
        const stop = handleError(mod, err, outputs);
        handled += 1;
        if (stop) {
          recordError(mod, inputForStep, outputs, ran, start, errorMessage(err), {
            type: mod.errorHandler.type,
            handled,
          });
          throw stop;
        }
      }
    } else {
      // Run once per input bundle — the heart of bundle multiplexing.
      for (const inputBundle of inputBundles) {
        ran += 1;
        if (counts) ctx.operations += 1;
        try {
          const resolved = resolveParams(mod.params, inputBundle, ctx, previousModuleId);
          outputs.push(...(await registered.run(inputBundle, resolved, ctx)));
        } catch (err) {
          if (!mod.errorHandler) {
            recordError(mod, inputForStep, outputs, ran, start, errorMessage(err));
            throw new StopSignal("FAILED", errorMessage(err));
          }
          const stop = handleError(mod, err, outputs);
          handled += 1;
          if (stop) {
            recordError(mod, inputForStep, outputs, ran, start, errorMessage(err), {
              type: mod.errorHandler.type,
              handled,
            });
            throw stop;
          }
          // ignore / resume → continue with remaining bundles
        }
      }
    }

    const result: ModuleResult = {
      status: "success",
      operations: counts ? ran : 0,
      input: inputForStep,
      bundles: outputs,
      ms: Math.round(nowMs() - start),
    };
    if (handled > 0 && mod.errorHandler) {
      result.errorOutcome = { type: mod.errorHandler.type, handled };
    }

    // Determine downstream branches: routes (Router) or a single `next`.
    const branches: Array<{ next: string | null; bundles: Bundle[] }> = [];
    if (mod.routes && mod.routes.length > 0) {
      const summaries: RouteSummary[] = [];
      for (const route of mod.routes) {
        const bundles = route.filter ? applyFilter(outputs, route.filter, ctx, mod.id) : outputs;
        summaries.push({ label: route.label, next: route.next, bundles: bundles.length });
        branches.push({ next: route.next, bundles });
      }
      result.routes = summaries;
    } else if (mod.next) {
      const bundles = mod.filter ? applyFilter(outputs, mod.filter, ctx, mod.id) : outputs;
      branches.push({ next: mod.next, bundles });
    }

    ctx.steps[mod.id] = result;

    for (const branch of branches) {
      if (!branch.next) continue;
      const nextMod = byId.get(branch.next);
      if (nextMod) await processModule(nextMod, branch.bundles, mod.id);
    }
  };

  try {
    if (first.next) {
      const nextMod = byId.get(first.next);
      if (nextMod) await processModule(nextMod, triggerBundles, first.id);
    }
    return { status: "SUCCESS", operations: ctx.operations, steps: ctx.steps };
  } catch (err) {
    if (err instanceof StopSignal) {
      return {
        status: err.outcome,
        operations: ctx.operations,
        steps: ctx.steps,
        ...(err.outcome === "FAILED" ? { error: err.message } : {}),
      };
    }
    const message = errorMessage(err);
    return { status: "FAILED", operations: ctx.operations, steps: ctx.steps, error: message };
  }
}
