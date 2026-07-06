import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, compact, requireCredential } from "./util";

/** Asana connector (production). Auth: personal access token (bearer). */

const BASE = "https://app.asana.com/api/1.0";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "Asana");

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing access token." };
  try {
    const json = await apiJson<{ data?: { name?: string } }>({ method: "GET", url: `${BASE}/users/me`, headers: bearer(token) });
    return { ok: true, message: `Connected as ${json.data?.name ?? "Asana user"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const asanaApp: App = {
  key: "asana",
  name: "Asana",
  auth: { type: "api_key", fields: [{ key: "token", label: "Personal access token", type: "password", required: true }] },
  modules: {
    list_workspaces: m("list_workspaces", "List workspaces", "search", z.object({}), async (_i, _p, ctx) => {
      const json = await apiJson<{ data?: unknown[] }>({ method: "GET", url: `${BASE}/workspaces`, headers: bearer(tok(ctx)) });
      return [{ workspaces: json.data ?? [] } as Bundle];
    }),
    list_projects: m("list_projects", "List projects", "search", z.object({ workspace: z.string() }), async (_i, p, ctx) => {
      const { workspace } = p as { workspace: string };
      const json = await apiJson<{ data?: unknown[] }>({ method: "GET", url: buildUrl(`${BASE}/projects`, { workspace }), headers: bearer(tok(ctx)) });
      return [{ projects: json.data ?? [] } as Bundle];
    }),
    list_tasks: m("list_tasks", "List tasks in a project", "search", z.object({ project: z.string() }), async (_i, p, ctx) => {
      const { project } = p as { project: string };
      const json = await apiJson<{ data?: unknown[] }>({ method: "GET", url: buildUrl(`${BASE}/tasks`, { project }), headers: bearer(tok(ctx)) });
      return [{ tasks: json.data ?? [] } as Bundle];
    }),
    get_task: m("get_task", "Get a task", "search", z.object({ taskGid: z.string() }), async (_i, p, ctx) => {
      const { taskGid } = p as { taskGid: string };
      const json = await apiJson<{ data?: Bundle }>({ method: "GET", url: `${BASE}/tasks/${taskGid}`, headers: bearer(tok(ctx)) });
      return [(json.data ?? {}) as Bundle];
    }),
    create_task: m("create_task", "Create a task", "action", z.object({ name: z.string(), projects: z.array(z.string()).optional(), notes: z.string().optional(), assignee: z.string().optional(), workspace: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { name: string; projects?: string[]; notes?: string; assignee?: string; workspace?: string };
      const json = await apiJson<{ data?: Bundle }>({ method: "POST", url: `${BASE}/tasks`, headers: bearer(tok(ctx)), body: { data: compact({ name: q.name, projects: q.projects, notes: q.notes, assignee: q.assignee, workspace: q.workspace }) } });
      return [(json.data ?? {}) as Bundle];
    }),
    update_task: m("update_task", "Update a task", "action", z.object({ taskGid: z.string(), name: z.string().optional(), notes: z.string().optional(), completed: z.boolean().optional() }), async (_i, p, ctx) => {
      const q = p as { taskGid: string; name?: string; notes?: string; completed?: boolean };
      const json = await apiJson<{ data?: Bundle }>({ method: "PUT", url: `${BASE}/tasks/${q.taskGid}`, headers: bearer(tok(ctx)), body: { data: compact({ name: q.name, notes: q.notes, completed: q.completed }) } });
      return [(json.data ?? {}) as Bundle];
    }),
    add_comment: m("add_comment", "Comment on a task", "action", z.object({ taskGid: z.string(), text: z.string() }), async (_i, p, ctx) => {
      const q = p as { taskGid: string; text: string };
      const json = await apiJson<{ data?: Bundle }>({ method: "POST", url: `${BASE}/tasks/${q.taskGid}/stories`, headers: bearer(tok(ctx)), body: { data: { text: q.text } } });
      return [(json.data ?? {}) as Bundle];
    }),
  },
  testConnection,
};
