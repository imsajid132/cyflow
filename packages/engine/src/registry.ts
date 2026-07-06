import type { ModuleKind, OperationRunner } from "@cyflow/shared";
import type { ZodTypeAny } from "zod";
import type { App } from "./app";
import { builtInApps } from "./apps";

/**
 * A single module implementation, flattened to the `(app, operation)` key the
 * engine looks up. Phase 2 adds optional metadata (carried over from the App /
 * ModuleDef it came from); the walker still only ever reads `.run`, so
 * `engine.ts` is unchanged.
 */
export interface RegisteredModule {
  app: string;
  operation: string;
  kind: ModuleKind;
  run: OperationRunner;
  /** Metadata, present when registered via an App (absent for ad-hoc register). */
  appName?: string;
  name?: string;
  params?: ZodTypeAny;
  triggerKind?: "webhook" | "polling" | "schedule";
}

/**
 * Maps `(app, operation)` → runner, and keeps the owning `App` objects for
 * app-level introspection.
 *
 * The engine's ONLY coupling is `registry.get(app, operation).run(...)`. In
 * Phase 1 modules were registered one-by-one; Phase 2 registers whole Apps via
 * `registerApp`, which expands each `App.modules` into the same flat map. That
 * is the seam where the connector framework replaces the hand-built list — with
 * no change to the walker.
 */
export class Registry {
  private readonly modules = new Map<string, RegisteredModule>();
  private readonly appsByKey = new Map<string, App>();

  private keyOf(app: string, operation: string): string {
    return `${app}:${operation}`;
  }

  /** Register a single module implementation (ad-hoc / test use). */
  register(mod: RegisteredModule): this {
    this.modules.set(this.keyOf(mod.app, mod.operation), mod);
    return this;
  }

  /** Register a whole App — expands every `App.modules` entry into the map. */
  registerApp(app: App): this {
    for (const def of Object.values(app.modules)) {
      this.register({
        app: app.key,
        operation: def.key,
        kind: def.kind,
        run: def.run,
        appName: app.name,
        name: def.name,
        params: def.params,
        triggerKind: def.triggerKind,
      });
    }
    this.appsByKey.set(app.key, app);
    return this;
  }

  has(app: string, operation: string): boolean {
    return this.modules.has(this.keyOf(app, operation));
  }

  /** Look up a runner; throws a clear error on a miss (→ module error → FAILED). */
  get(app: string, operation: string): RegisteredModule {
    const found = this.modules.get(this.keyOf(app, operation));
    if (!found) {
      throw new Error(`Unknown module: no runner registered for "${app}.${operation}"`);
    }
    return found;
  }

  /** The registered App, if it was registered via `registerApp`. */
  getApp(appKey: string): App | undefined {
    return this.appsByKey.get(appKey);
  }

  listApps(): App[] {
    return [...this.appsByKey.values()];
  }

  list(): RegisteredModule[] {
    return [...this.modules.values()];
  }
}

/**
 * The Phase 2 default registry: every built-in App (webhook, http, core)
 * registered through the App framework. Replaces Phase 1's hand-built,
 * per-module `createDefaultRegistry`.
 */
export function createDefaultRegistry(): Registry {
  const registry = new Registry();
  for (const app of builtInApps) registry.registerApp(app);
  return registry;
}
