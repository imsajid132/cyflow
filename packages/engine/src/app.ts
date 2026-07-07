import type { AuthSchema, ModuleKind, OperationRunner } from "@cyflow/shared";
import type { ZodTypeAny } from "zod";

/**
 * The App framework (ARCHITECTURE.md §5). Every integration is an **App** that
 * exposes one or more **modules** (a trigger / action / search / ...). This is
 * the "sacred" connector interface — once defined, every connector conforms to
 * it, and the engine only ever reaches modules through the registry seam
 * `registry.get(app, operation).run(...)`.
 *
 * Auth (`App.auth`) is declared here and given teeth in Phase 7 (encrypted
 * Connections, OAuth2). The auth type definitions live in @cyflow/shared and
 * are re-exported for convenience.
 */
export type { AuthType, AuthField, AuthSchema } from "@cyflow/shared";

/** One module (operation) an app exposes. */
export interface ModuleDef {
  /** Stable key within the app, e.g. "make_request". */
  key: string;
  /** Human label, e.g. "Make a request". */
  name: string;
  kind: ModuleKind;
  /** Validates params + drives the UI form (Phase 6). Not run by the walker. */
  params: ZodTypeAny;
  /** For triggers: how it fires (Phase 3). */
  triggerKind?: "webhook" | "polling" | "schedule" | "manual";
  /** The bundle-based implementation the engine invokes. */
  run: OperationRunner;
}

/** Result of validating a connection's credentials against the live API. */
export interface TestConnectionResult {
  ok: boolean;
  /** Human message — the account/bot name on success, or the API error. */
  message: string;
}

/** A connector: a keyed bundle of modules plus its auth requirements. */
export interface App {
  /** Stable app key, e.g. "http". Matches `ModuleNode.app` in a blueprint. */
  key: string;
  /** Human label, e.g. "HTTP". */
  name: string;
  auth?: AuthSchema;
  /** Modules keyed by their `ModuleDef.key`. */
  modules: Record<string, ModuleDef>;
  /**
   * Validate decrypted credentials against the live API (a cheap identity call).
   * Server-side only — powers "Test connection" and expired-token detection.
   */
  testConnection?: (credentials: Record<string, unknown>) => Promise<TestConnectionResult>;
}
