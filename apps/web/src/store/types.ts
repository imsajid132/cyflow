import type { Blueprint, StoredExecution } from "@cyflow/shared";

export type ScenarioStatus = "DRAFT" | "ACTIVE" | "PAUSED";

export type Schedule =
  | { type: "manual" }
  | { type: "interval"; minutes: number }
  | { type: "hourly" }
  | { type: "daily"; time: string }
  | { type: "cron"; expression: string };

/** A saved scenario — mirrors the persisted shape (blueprint is the shared type). */
export interface Scenario {
  id: string;
  name: string;
  status: ScenarioStatus;
  schedule: Schedule;
  blueprint: Blueprint;
  /** ISO timestamp of the last run, if any. */
  lastRunAt?: string;
  lastStatus?: "SUCCESS" | "FAILED";
  operations?: number;
  updatedAt: string;
}

/** A connection summary (no secrets) — matches @cyflow/shared ConnectionSummary. */
export interface Connection {
  id: string;
  appKey: string;
  name: string;
  createdAt: string;
}

/** One key-value record in a data store. */
export interface DataRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * A data store (collection of key-value records). Shaped to mirror a future API
 * (list/get/set/delete/increment on records) — the local adapter fills it now.
 */
export interface DataStoreDef {
  id: string;
  name: string;
  records: DataRecord[];
  updatedAt: string;
}

/** An execution the user ran in this session (browser engine). */
export interface ExecutionEntry {
  execution: StoredExecution;
  scenarioId: string;
  scenarioName: string;
  ranAt: string;
  /** Blueprint snapshot at run time (local runs) — lets the replay render even
   *  if the scenario was later edited or deleted. */
  blueprint?: Blueprint;
}

export type ViewName =
  | "dashboard"
  | "scenarios"
  | "templates"
  | "connections"
  | "executions"
  | "datastores"
  | "settings"
  | "builder"
  | "replay";
