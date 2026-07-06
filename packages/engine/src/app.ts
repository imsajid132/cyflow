import type { ModuleKind, OperationRunner } from "@cyflow/shared";
import type { ZodTypeAny } from "zod";

/**
 * The App framework (ARCHITECTURE.md §5). Every integration is an **App** that
 * exposes one or more **modules** (a trigger / action / search / ...). This is
 * the "sacred" connector interface — once defined, every connector conforms to
 * it, and the engine only ever reaches modules through the registry seam
 * `registry.get(app, operation).run(...)`.
 *
 * Phase 2 defines the shape and ports the three built-ins onto it. Auth is a
 * declared-but-inert placeholder here; Phase 7 gives it teeth (encrypted
 * Connections, OAuth2 refresh, etc.).
 */

/** How a user connects their own account for this app (Phase 7). */
export type AuthType = "none" | "api_key" | "oauth2" | "basic" | "custom";

/** One field a Connection collects (for api_key / basic / custom auth). */
export interface AuthField {
  key: string;
  label: string;
  type?: "text" | "password";
  required?: boolean;
}

/** Declares what a Connection for this app needs. Inert until Phase 7. */
export interface AuthSchema {
  type: AuthType;
  fields?: AuthField[];
}

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
  triggerKind?: "webhook" | "polling" | "schedule";
  /** The bundle-based implementation the engine invokes. */
  run: OperationRunner;
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
}
