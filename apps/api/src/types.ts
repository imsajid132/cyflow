import type { Blueprint, ConnectionSummary, StoredExecution } from "@cyflow/shared";

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
  records: number;
}

export type { ConnectionSummary };
