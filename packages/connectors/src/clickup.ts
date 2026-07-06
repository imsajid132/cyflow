import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, compact, requireCredential } from "./util";

/** ClickUp connector (production). Auth: API token (Authorization header, no Bearer). */

const BASE = "https://api.clickup.com/api/v2";
const headers = (token: string) => ({ authorization: token });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "ClickUp");

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing API token." };
  try {
    const json = await apiJson<{ user?: { username?: string } }>({ method: "GET", url: `${BASE}/user`, headers: headers(token) });
    return { ok: true, message: `Connected as ${json.user?.username ?? "ClickUp user"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const clickupApp: App = {
  key: "clickup",
  name: "ClickUp",
  auth: { type: "api_key", fields: [{ key: "token", label: "API token", type: "password", required: true }] },
  modules: {
    list_spaces: m("list_spaces", "List spaces", "search", z.object({ teamId: z.string() }), async (_i, p, ctx) => {
      const { teamId } = p as { teamId: string };
      const json = await apiJson<{ spaces?: unknown[] }>({ method: "GET", url: `${BASE}/team/${teamId}/space`, headers: headers(tok(ctx)) });
      return [{ spaces: json.spaces ?? [] } as Bundle];
    }),
    list_tasks: m("list_tasks", "List tasks in a list", "search", z.object({ listId: z.string() }), async (_i, p, ctx) => {
      const { listId } = p as { listId: string };
      const json = await apiJson<{ tasks?: unknown[] }>({ method: "GET", url: `${BASE}/list/${listId}/task`, headers: headers(tok(ctx)) });
      return [{ tasks: json.tasks ?? [] } as Bundle];
    }),
    get_task: m("get_task", "Get a task", "search", z.object({ taskId: z.string() }), async (_i, p, ctx) => {
      const { taskId } = p as { taskId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/task/${taskId}`, headers: headers(tok(ctx)) })];
    }),
    create_task: m("create_task", "Create a task", "action", z.object({ listId: z.string(), name: z.string(), description: z.string().optional(), status: z.string().optional(), priority: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { listId: string; name: string; description?: string; status?: string; priority?: number };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/list/${q.listId}/task`, headers: headers(tok(ctx)), body: compact({ name: q.name, description: q.description, status: q.status, priority: q.priority }) })];
    }),
    update_task: m("update_task", "Update a task", "action", z.object({ taskId: z.string(), name: z.string().optional(), description: z.string().optional(), status: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { taskId: string; name?: string; description?: string; status?: string };
      return [await apiJson<Bundle>({ method: "PUT", url: `${BASE}/task/${q.taskId}`, headers: headers(tok(ctx)), body: compact({ name: q.name, description: q.description, status: q.status }) })];
    }),
    create_comment: m("create_comment", "Comment on a task", "action", z.object({ taskId: z.string(), commentText: z.string() }), async (_i, p, ctx) => {
      const q = p as { taskId: string; commentText: string };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/task/${q.taskId}/comment`, headers: headers(tok(ctx)), body: { comment_text: q.commentText } })];
    }),
  },
  testConnection,
};
