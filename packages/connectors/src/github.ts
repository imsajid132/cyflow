import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, compact, requireCredential } from "./util";

/** GitHub connector (production). Auth: personal access token (bearer). */

const BASE = "https://api.github.com";
const headers = (token: string) => ({ authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "cyflow" });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "GitHub");

function m(key: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing access token." };
  try {
    const me = await apiJson<{ login?: string }>({ method: "GET", url: `${BASE}/user`, headers: headers(token) });
    return { ok: true, message: `Connected as ${me.login ?? "GitHub user"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const githubApp: App = {
  key: "github",
  name: "GitHub",
  auth: { type: "api_key", fields: [{ key: "token", label: "Personal access token", type: "password", required: true }] },
  modules: {
    get_repo: m("get_repo", "Get a repository", "search", z.object({ owner: z.string(), repo: z.string() }), async (_i, p, ctx) => {
      const q = p as { owner: string; repo: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/repos/${q.owner}/${q.repo}`, headers: headers(tok(ctx)) })];
    }),
    list_issues: m("list_issues", "List issues", "search", z.object({ owner: z.string(), repo: z.string(), state: z.enum(["open", "closed", "all"]).optional(), perPage: z.number().optional(), page: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { owner: string; repo: string; state?: string; perPage?: number; page?: number };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${BASE}/repos/${q.owner}/${q.repo}/issues`, { state: q.state ?? "open", per_page: q.perPage ?? 30, page: q.page }), headers: headers(tok(ctx)) });
      return [{ issues: json, count: Array.isArray(json) ? json.length : 0 } as Bundle];
    }),
    get_issue: m("get_issue", "Get an issue", "search", z.object({ owner: z.string(), repo: z.string(), number: z.number() }), async (_i, p, ctx) => {
      const q = p as { owner: string; repo: string; number: number };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/repos/${q.owner}/${q.repo}/issues/${q.number}`, headers: headers(tok(ctx)) })];
    }),
    create_issue: m("create_issue", "Create an issue", "action", z.object({ owner: z.string(), repo: z.string(), title: z.string(), body: z.string().optional(), labels: z.array(z.string()).optional(), assignees: z.array(z.string()).optional() }), async (_i, p, ctx) => {
      const q = p as { owner: string; repo: string; title: string; body?: string; labels?: string[]; assignees?: string[] };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/repos/${q.owner}/${q.repo}/issues`, headers: headers(tok(ctx)), body: compact({ title: q.title, body: q.body, labels: q.labels, assignees: q.assignees }) })];
    }),
    create_comment: m("create_comment", "Comment on an issue", "action", z.object({ owner: z.string(), repo: z.string(), number: z.number(), body: z.string() }), async (_i, p, ctx) => {
      const q = p as { owner: string; repo: string; number: number; body: string };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/repos/${q.owner}/${q.repo}/issues/${q.number}/comments`, headers: headers(tok(ctx)), body: { body: q.body } })];
    }),
    list_pull_requests: m("list_pull_requests", "List pull requests", "search", z.object({ owner: z.string(), repo: z.string(), state: z.enum(["open", "closed", "all"]).optional(), perPage: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { owner: string; repo: string; state?: string; perPage?: number };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${BASE}/repos/${q.owner}/${q.repo}/pulls`, { state: q.state ?? "open", per_page: q.perPage ?? 30 }), headers: headers(tok(ctx)) });
      return [{ pullRequests: json } as Bundle];
    }),
    list_commits: m("list_commits", "List commits", "search", z.object({ owner: z.string(), repo: z.string(), perPage: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { owner: string; repo: string; perPage?: number };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${BASE}/repos/${q.owner}/${q.repo}/commits`, { per_page: q.perPage ?? 30 }), headers: headers(tok(ctx)) });
      return [{ commits: json } as Bundle];
    }),
    search_issues: m("search_issues", "Search issues & PRs", "search", z.object({ query: z.string(), perPage: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { query: string; perPage?: number };
      const json = await apiJson<{ items?: unknown[]; total_count?: number }>({ method: "GET", url: buildUrl(`${BASE}/search/issues`, { q: q.query, per_page: q.perPage ?? 30 }), headers: headers(tok(ctx)) });
      return [{ items: json.items ?? [], totalCount: json.total_count } as Bundle];
    }),
    create_release: m("create_release", "Create a release", "action", z.object({ owner: z.string(), repo: z.string(), tagName: z.string(), name: z.string().optional(), body: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { owner: string; repo: string; tagName: string; name?: string; body?: string };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/repos/${q.owner}/${q.repo}/releases`, headers: headers(tok(ctx)), body: compact({ tag_name: q.tagName, name: q.name, body: q.body }) })];
    }),
  },
  testConnection,
};
