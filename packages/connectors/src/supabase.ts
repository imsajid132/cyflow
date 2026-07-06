import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** Supabase connector (production). Auth: project URL + service role key (PostgREST). */

const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["serviceKey", "service_key", "apiKey", "token"], "Supabase");
const projectUrl = (ctx: ExecutionContext) => requireCredential(ctx, ["projectUrl", "project_url", "url"], "Supabase").replace(/\/$/, "");
const headers = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, authorization: `Bearer ${key}`, ...extra });

function m(key: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key, name, kind, params, run };
}

/** Append a raw PostgREST filter string (e.g. "id=eq.5&status=eq.open") to a URL. */
function withFilter(url: string, filter?: string): string {
  if (!filter) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${filter}`;
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const key = (typeof credentials.serviceKey === "string" && credentials.serviceKey) || (typeof credentials.apiKey === "string" && credentials.apiKey) || "";
  const url = ((typeof credentials.projectUrl === "string" && credentials.projectUrl) || (typeof credentials.url === "string" && credentials.url) || "").replace(/\/$/, "");
  if (!key || !url) return { ok: false, message: "Missing project URL or service key." };
  try {
    await apiJson({ method: "GET", url: `${url}/rest/v1/`, headers: headers(key) });
    return { ok: true, message: "Connected to Supabase project" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const supabaseApp: App = {
  key: "supabase",
  name: "Supabase",
  auth: {
    type: "custom",
    fields: [
      { key: "projectUrl", label: "Project URL", type: "text", required: true },
      { key: "serviceKey", label: "Service role key", type: "password", required: true },
    ],
  },
  modules: {
    select: m("select", "Select rows", "search", z.object({ table: z.string(), select: z.string().optional(), filter: z.string().optional(), order: z.string().optional(), limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { table: string; select?: string; filter?: string; order?: string; limit?: number };
      const base = buildUrl(`${projectUrl(ctx)}/rest/v1/${encodeURIComponent(q.table)}`, { select: q.select ?? "*", order: q.order, limit: q.limit });
      const rows = await apiJson<unknown[]>({ method: "GET", url: withFilter(base, q.filter), headers: headers(tok(ctx)) });
      return [{ rows, count: Array.isArray(rows) ? rows.length : 0 } as Bundle];
    }),
    insert: m("insert", "Insert rows", "action", z.object({ table: z.string(), rows: z.any() }), async (_i, p, ctx) => {
      const q = p as { table: string; rows: unknown };
      const out = await apiJson<unknown[]>({ method: "POST", url: `${projectUrl(ctx)}/rest/v1/${encodeURIComponent(q.table)}`, headers: headers(tok(ctx), { prefer: "return=representation" }), body: q.rows });
      return [{ inserted: out } as Bundle];
    }),
    update: m("update", "Update rows", "action", z.object({ table: z.string(), filter: z.string(), values: z.any() }), async (_i, p, ctx) => {
      const q = p as { table: string; filter: string; values: unknown };
      const out = await apiJson<unknown[]>({ method: "PATCH", url: withFilter(`${projectUrl(ctx)}/rest/v1/${encodeURIComponent(q.table)}`, q.filter), headers: headers(tok(ctx), { prefer: "return=representation" }), body: q.values });
      return [{ updated: out } as Bundle];
    }),
    delete_rows: m("delete_rows", "Delete rows", "action", z.object({ table: z.string(), filter: z.string() }), async (_i, p, ctx) => {
      const q = p as { table: string; filter: string };
      const out = await apiJson<unknown[]>({ method: "DELETE", url: withFilter(`${projectUrl(ctx)}/rest/v1/${encodeURIComponent(q.table)}`, q.filter), headers: headers(tok(ctx), { prefer: "return=representation" }) });
      return [{ deleted: out } as Bundle];
    }),
    rpc: m("rpc", "Call a database function", "action", z.object({ fn: z.string(), args: z.any().optional() }), async (_i, p, ctx) => {
      const q = p as { fn: string; args?: unknown };
      const out = await apiJson<unknown>({ method: "POST", url: `${projectUrl(ctx)}/rest/v1/rpc/${encodeURIComponent(q.fn)}`, headers: headers(tok(ctx)), body: q.args ?? {} });
      return [{ result: out } as Bundle];
    }),
  },
  testConnection,
};
