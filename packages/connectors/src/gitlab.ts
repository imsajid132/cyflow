import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, compact, requireCredential } from "./util";

/** GitLab connector (production). Auth: personal access token (PRIVATE-TOKEN). */

const BASE = "https://gitlab.com/api/v4";
const headers = (token: string) => ({ "private-token": token });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "GitLab");
const pid = (id: string) => encodeURIComponent(id);

function m(key: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing access token." };
  try {
    const me = await apiJson<{ username?: string }>({ method: "GET", url: `${BASE}/user`, headers: headers(token) });
    return { ok: true, message: `Connected as ${me.username ?? "GitLab user"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const gitlabApp: App = {
  key: "gitlab",
  name: "GitLab",
  auth: { type: "api_key", fields: [{ key: "token", label: "Personal access token", type: "password", required: true }] },
  modules: {
    get_project: m("get_project", "Get a project", "search", z.object({ projectId: z.string() }), async (_i, p, ctx) => {
      const { projectId } = p as { projectId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/projects/${pid(projectId)}`, headers: headers(tok(ctx)) })];
    }),
    list_issues: m("list_issues", "List issues", "search", z.object({ projectId: z.string(), state: z.enum(["opened", "closed"]).optional(), perPage: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { projectId: string; state?: string; perPage?: number };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${BASE}/projects/${pid(q.projectId)}/issues`, { state: q.state, per_page: q.perPage ?? 30 }), headers: headers(tok(ctx)) });
      return [{ issues: json, count: Array.isArray(json) ? json.length : 0 } as Bundle];
    }),
    create_issue: m("create_issue", "Create an issue", "action", z.object({ projectId: z.string(), title: z.string(), description: z.string().optional(), labels: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { projectId: string; title: string; description?: string; labels?: string };
      return [await apiJson<Bundle>({ method: "POST", url: buildUrl(`${BASE}/projects/${pid(q.projectId)}/issues`, compact({ title: q.title, description: q.description, labels: q.labels })), headers: headers(tok(ctx)) })];
    }),
    create_note: m("create_note", "Comment on an issue", "action", z.object({ projectId: z.string(), issueIid: z.number(), body: z.string() }), async (_i, p, ctx) => {
      const q = p as { projectId: string; issueIid: number; body: string };
      return [await apiJson<Bundle>({ method: "POST", url: buildUrl(`${BASE}/projects/${pid(q.projectId)}/issues/${q.issueIid}/notes`, { body: q.body }), headers: headers(tok(ctx)) })];
    }),
    list_merge_requests: m("list_merge_requests", "List merge requests", "search", z.object({ projectId: z.string(), state: z.enum(["opened", "closed", "merged", "all"]).optional() }), async (_i, p, ctx) => {
      const q = p as { projectId: string; state?: string };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${BASE}/projects/${pid(q.projectId)}/merge_requests`, { state: q.state ?? "opened" }), headers: headers(tok(ctx)) });
      return [{ mergeRequests: json } as Bundle];
    }),
    list_pipelines: m("list_pipelines", "List pipelines", "search", z.object({ projectId: z.string() }), async (_i, p, ctx) => {
      const { projectId } = p as { projectId: string };
      const json = await apiJson<unknown[]>({ method: "GET", url: `${BASE}/projects/${pid(projectId)}/pipelines`, headers: headers(tok(ctx)) });
      return [{ pipelines: json } as Bundle];
    }),
  },
  testConnection,
};
