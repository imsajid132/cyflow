import type { ModuleKind, OperationRunner } from "@cyflow/shared";
import { customWebhook } from "./modules/webhook";
import { makeRequest } from "./modules/http";
import { sleep } from "./modules/core";

/** A module implementation keyed by (app, operation). */
export interface RegisteredModule {
  app: string;
  operation: string;
  kind: ModuleKind;
  run: OperationRunner;
}

/**
 * Maps `(app, operation)` → runner. In Phase 1 the three built-ins are
 * registered directly here; Phase 2's App framework replaces this hand-built
 * registry with one populated from `App.modules` — the engine only ever calls
 * `registry.get(app, operation)`, so that swap is the single seam.
 */
export class Registry {
  private readonly modules = new Map<string, RegisteredModule>();

  private keyOf(app: string, operation: string): string {
    return `${app}:${operation}`;
  }

  register(mod: RegisteredModule): this {
    this.modules.set(this.keyOf(mod.app, mod.operation), mod);
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

  list(): RegisteredModule[] {
    return [...this.modules.values()];
  }
}

/** The Phase 1 registry: webhook (trigger), http, core.sleep. */
export function createDefaultRegistry(): Registry {
  return new Registry()
    .register({ app: "webhook", operation: "custom_webhook", kind: "trigger", run: customWebhook })
    .register({ app: "http", operation: "make_request", kind: "action", run: makeRequest })
    .register({ app: "core", operation: "sleep", kind: "action", run: sleep });
}
