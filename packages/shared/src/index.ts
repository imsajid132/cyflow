/**
 * @cyflow/shared — the framework-agnostic contracts shared across the engine,
 * worker, and (later) the web UI. Pure types only: zero runtime, zero deps.
 *
 * The execution model is Make's: a module operation takes ONE input bundle and
 * returns an ARRAY of output bundles. The engine multiplexes — N output bundles
 * means the next module runs N times. See ARCHITECTURE.md §2.
 */

/** One packet of data flowing between modules — THE core unit. */
export type Bundle = Record<string, unknown>;

/**
 * Module types. Phase 1 exercises `trigger | action | search`; the rest are
 * declared now so blueprints and the walker don't need reshaping in Phases 5/8.
 */
export type ModuleKind =
  | "trigger"
  | "action"
  | "search"
  | "iterator"
  | "aggregator"
  | "router";

/** Bundle-level record of one module processing its input bundles. */
export interface ModuleResult {
  status: "success" | "error";
  /** How many bundles this module processed (= operations for this module). */
  operations: number;
  bundles: Bundle[];
  error?: string;
  /** Wall-clock milliseconds around all of this module's bundle runs. */
  ms: number;
}

/** Carried through a single execution; the engine mutates `operations`/`steps`. */
export interface ExecutionContext {
  scenarioId: string;
  executionId: string;
  /** Running total of operations across the run (Make's billing unit). */
  operations: number;
  /** Outputs already produced, keyed by module id. */
  steps: Record<string, ModuleResult>;
  /** The trigger bundles that started this run. */
  trigger: Bundle[];
  /** Resolves a Connection's decrypted credentials (Phase 7; stubbed earlier). */
  getConnection?: (connectionId: string) => Promise<Record<string, unknown> | null>;
}

/**
 * Every module operation implements this. Takes ONE input bundle, returns an
 * ARRAY of output bundles.
 * - action:          usually returns `[oneBundle]`
 * - search/iterator: returns `[b1..bN]` → downstream runs N times
 */
export type OperationRunner = (
  inputBundle: Bundle,
  params: Record<string, unknown>,
  ctx: ExecutionContext,
) => Promise<Bundle[]>;

/** One node in a scenario blueprint. Phase 1 uses a linear `next` pointer. */
export interface ModuleNode {
  id: string;
  app: string;
  operation: string;
  kind: ModuleKind;
  params: Record<string, unknown>;
  /** Which stored Connection to use (Phase 7). */
  connectionId?: string | null;
  /** Condition on the link INTO `next` (Phase 5). */
  filter?: unknown | null;
  /** Next module id, or null to end the chain. */
  next: string | null;
}

/** The scenario chain stored as structured data. */
export interface Blueprint {
  modules: ModuleNode[];
}

/** The result of running a scenario once. */
export interface ExecutionRecord {
  status: "SUCCESS" | "FAILED";
  /** Total operations across the whole run. */
  operations: number;
  steps: Record<string, ModuleResult>;
  error?: string;
}

/* ============================================================
   Phase 3 persistence contracts (framework-agnostic).
   The worker depends only on these interfaces; @cyflow/db provides the Prisma
   implementation and tests provide in-memory ones. This keeps the engine and
   worker decoupled from Postgres.
   ============================================================ */

/** A scenario as stored, with its canonical blueprint. */
export interface StoredScenario {
  id: string;
  userId?: string | null;
  name: string;
  status?: string;
  schedule?: unknown;
  blueprint: Blueprint;
}

export interface CreateScenarioInput {
  id?: string;
  userId?: string | null;
  name: string;
  blueprint: Blueprint;
  status?: string;
  schedule?: unknown;
}

/** Persists and loads scenarios. */
export interface ScenarioRepository {
  create(input: CreateScenarioInput): Promise<StoredScenario>;
  findById(id: string): Promise<StoredScenario | null>;
}

export type ExecutionStatus = "RUNNING" | "SUCCESS" | "FAILED";

/** One persisted execution step — the bundle-level snapshot for a module. */
export interface StoredExecutionStep {
  moduleNodeId: string;
  status: "success" | "error";
  operations: number;
  /** Bundles this module received. */
  input: Bundle[];
  /** Bundles this module produced. */
  output: Bundle[];
  error?: string;
  ms: number;
  order: number;
}

export interface StoredExecution {
  id: string;
  scenarioId: string;
  status: ExecutionStatus;
  operations: number;
  error?: string | null;
  startedAt: Date;
  finishedAt?: Date | null;
  steps: StoredExecutionStep[];
}

export interface CompleteExecutionInput {
  status: "SUCCESS" | "FAILED";
  operations: number;
  error?: string;
  steps: StoredExecutionStep[];
}

/** Persists execution lifecycle: start RUNNING, then complete with steps. */
export interface ExecutionRepository {
  /** Create a RUNNING execution (startedAt now). */
  start(scenarioId: string): Promise<StoredExecution>;
  /** Finalise: set status/operations/error, finishedAt now, persist steps. */
  complete(executionId: string, input: CompleteExecutionInput): Promise<StoredExecution>;
  findById(id: string): Promise<StoredExecution | null>;
}
