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
/** Public base URL of the API (for building webhook URLs). */
export const apiBaseUrl = BASE;

const TOKEN_KEY = "cyflow_admin_token";

export function getAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setAdminToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore storage errors */
  }
}

/** Thrown when the API rejects the request for a missing/invalid admin token. */
export class AuthError extends Error {
  constructor() {
    super("admin token required");
    this.name = "AuthError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) throw new Error(`Cyflow API ${res.status} on ${path}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Probe the API for reachability + whether it demands a token. */
export async function pingApi(): Promise<{ ok: boolean; auth: boolean }> {
  const res = await fetch(`${BASE}/health`);
  const body = (await res.json()) as { auth?: boolean };
  return { ok: res.ok, auth: Boolean(body.auth) };
}

export interface RunOnceResponse {
  executionId: string;
  status: string;
  execution: StoredExecution;
}

export interface AuthFieldDTO {
  key: string;
  label: string;
  type?: "text" | "password";
  required?: boolean;
}
export interface AppAuthDTO {
  key: string;
  name: string;
  auth: { type: string; fields?: AuthFieldDTO[] };
}
export interface AppSummaryDTO {
  key: string;
  name: string;
  auth: string;
  hasAuth: boolean;
}
export interface OAuthStartDTO {
  provider: string;
  configured: boolean;
  message: string;
  authUrl?: string;
  state?: string;
}
export interface ConnectionInput {
  appKey: string;
  name: string;
  credentials?: Record<string, unknown>;
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
  createConnection: (input: ConnectionInput) =>
    req<Connection>("/connections", { method: "POST", body: JSON.stringify(input) }),
  updateConnection: (id: string, patch: { name?: string; credentials?: Record<string, unknown> }) =>
    req<Connection>(`/connections/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteConnection: (id: string) => req<void>(`/connections/${id}`, { method: "DELETE" }),
  listApps: () => req<AppSummaryDTO[]>("/apps"),
  getAppAuth: (key: string) => req<AppAuthDTO>(`/apps/${key}/auth`),
  oauthStart: (provider: string) => req<OAuthStartDTO>(`/oauth/${provider}/start`),
};

/** Execution JSON arrives with ISO date strings; restore Date fields. */
export function normalizeExecution(execution: StoredExecution): StoredExecution {
  return {
    ...execution,
    startedAt: new Date(execution.startedAt as unknown as string),
    finishedAt: execution.finishedAt ? new Date(execution.finishedAt as unknown as string) : null,
  };
}
