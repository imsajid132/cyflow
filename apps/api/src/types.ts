import type { AuthSchema, AuthType, Blueprint, ConnectionSummary, StoredExecution } from "@cyflow/shared";

/** Schedule config — mirrors the frontend's Schedule union (stored as JSON). */
export type ScheduleDTO =
  | { type: "manual" }
  | { type: "interval"; minutes: number }
  | { type: "hourly" }
  | { type: "daily"; time: string }
  | { type: "cron"; expression: string };

export type ScenarioStatusDTO = "DRAFT" | "ACTIVE" | "PAUSED";

/** A scenario as the frontend consumes it (blueprint canonical). */
export interface ScenarioDTO {
  id: string;
  name: string;
  status: ScenarioStatusDTO;
  schedule: ScheduleDTO;
  blueprint: Blueprint;
  updatedAt: string;
}

export interface CreateScenarioBody {
  id?: string;
  name?: string;
  status?: ScenarioStatusDTO;
  schedule?: ScheduleDTO;
  blueprint?: Blueprint;
}

export type UpdateScenarioBody = Partial<Omit<ScenarioDTO, "id" | "updatedAt">>;

/** One executions-list row: matches the frontend ExecutionEntry shape. */
export interface ExecutionEntryDTO {
  scenarioId: string;
  scenarioName: string;
  ranAt: string;
  execution: StoredExecution;
}

export interface RunOnceBody {
  blueprint?: Blueprint;
  trigger?: Record<string, unknown>[];
}

export interface RunOnceResult {
  executionId: string;
  status: string;
  execution: StoredExecution;
}

export interface DataStoreDTO {
  id: string;
  name: string;
  /** Number of records currently in the store. */
  records: number;
  updatedAt?: string;
}

/** One key-value record inside a data store. */
export interface DataStoreRecordDTO {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface CreateDataStoreBody {
  id?: string;
  name?: string;
}

export interface UpsertRecordBody {
  key: string;
  value?: unknown;
}

/* ---- connections + apps + oauth (Phase 7 UI wiring) ---- */

export interface CreateConnectionBody {
  appKey: string;
  name: string;
  /** Plaintext credentials — encrypted server-side, never returned. */
  credentials?: Record<string, unknown>;
}

export interface UpdateConnectionBody {
  name?: string;
  credentials?: Record<string, unknown>;
}

/** App directory entry (drives the connection create flow). */
export interface AppSummary {
  key: string;
  name: string;
  auth: AuthType;
  hasAuth: boolean;
}

/** An app's auth requirement + the fields a Connection collects. */
export interface AppAuthDTO {
  key: string;
  name: string;
  auth: AuthSchema;
}

/** Result of starting an OAuth2 flow (scaffold). */
export interface OAuthStartDTO {
  provider: string;
  configured: boolean;
  message: string;
  authUrl?: string;
  state?: string;
}

export interface OAuthCallbackResult {
  ok: boolean;
  message: string;
}

export type { AuthSchema, AuthType, ConnectionSummary };
