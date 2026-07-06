/**
 * Thin Cyflow API client. When VITE_CYFLOW_API_URL is set, the store talks to a
 * real backend; when it is unset, `apiEnabled` is false and the app stays in
 * local demo mode (mock engine, seed data) — nothing here runs.
 */
import type { Blueprint, StoredExecution } from "@cyflow/shared";
import type { Connection, ExecutionEntry, Scenario } from "./types";

const RAW = import.meta.env.VITE_CYFLOW_API_URL;
const BASE = RAW ? RAW.replace(/\/$/, "") : undefined;

export const apiEnabled = Boolean(BASE);

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`Cyflow API ${res.status} on ${path}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface RunOnceResponse {
  executionId: string;
  status: string;
  execution: StoredExecution;
}

export type ScenarioInput = Partial<
  Pick<Scenario, "id" | "name" | "status" | "schedule" | "blueprint">
>;

export const api = {
  listScenarios: () => req<Scenario[]>("/scenarios"),
  createScenario: (input: ScenarioInput) =>
    req<Scenario>("/scenarios", { method: "POST", body: JSON.stringify(input) }),
  updateScenario: (id: string, patch: ScenarioInput) =>
    req<Scenario>(`/scenarios/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteScenario: (id: string) => req<void>(`/scenarios/${id}`, { method: "DELETE" }),
  runOnce: (id: string, body: { blueprint?: Blueprint; trigger?: Record<string, unknown>[] }) =>
    req<RunOnceResponse>(`/scenarios/${id}/run-once`, { method: "POST", body: JSON.stringify(body) }),
  listExecutions: () => req<ExecutionEntry[]>("/executions"),
  listConnections: () => req<Connection[]>("/connections"),
};

/** Execution JSON arrives with ISO date strings; restore Date fields. */
export function normalizeExecution(execution: StoredExecution): StoredExecution {
  return {
    ...execution,
    startedAt: new Date(execution.startedAt as unknown as string),
    finishedAt: execution.finishedAt ? new Date(execution.finishedAt as unknown as string) : null,
  };
}
