import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** Airtable connector (production). Auth: personal access token (bearer). */

const BASE = "https://api.airtable.com/v0";
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "Airtable");

function m(key: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing access token." };
  try {
    const me = await apiJson<{ id?: string; email?: string }>({ method: "GET", url: `${BASE}/meta/whoami`, headers: headers(token) });
    return { ok: true, message: `Connected${me.email ? ` as ${me.email}` : ` (${me.id})`}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const airtableApp: App = {
  key: "airtable",
  name: "Airtable",
  auth: { type: "api_key", fields: [{ key: "token", label: "Personal access token", type: "password", required: true }] },
  modules: {
    list_records: m("list_records", "List records", "search", z.object({ baseId: z.string(), tableId: z.string(), view: z.string().optional(), maxRecords: z.number().optional(), filterByFormula: z.string().optional(), offset: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { baseId: string; tableId: string; view?: string; maxRecords?: number; filterByFormula?: string; offset?: string };
      const json = await apiJson<{ records?: unknown[]; offset?: string }>({
        method: "GET",
        url: buildUrl(`${BASE}/${q.baseId}/${encodeURIComponent(q.tableId)}`, { view: q.view, maxRecords: q.maxRecords, filterByFormula: q.filterByFormula, offset: q.offset }),
        headers: headers(tok(ctx)),
      });
      return [{ records: json.records ?? [], offset: json.offset } as Bundle];
    }),
    get_record: m("get_record", "Get a record", "search", z.object({ baseId: z.string(), tableId: z.string(), recordId: z.string() }), async (_i, p, ctx) => {
      const q = p as { baseId: string; tableId: string; recordId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/${q.baseId}/${encodeURIComponent(q.tableId)}/${q.recordId}`, headers: headers(tok(ctx)) })];
    }),
    create_record: m("create_record", "Create a record", "action", z.object({ baseId: z.string(), tableId: z.string(), fields: z.any() }), async (_i, p, ctx) => {
      const q = p as { baseId: string; tableId: string; fields: unknown };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/${q.baseId}/${encodeURIComponent(q.tableId)}`, headers: headers(tok(ctx)), body: { fields: q.fields } })];
    }),
    update_record: m("update_record", "Update a record", "action", z.object({ baseId: z.string(), tableId: z.string(), recordId: z.string(), fields: z.any() }), async (_i, p, ctx) => {
      const q = p as { baseId: string; tableId: string; recordId: string; fields: unknown };
      return [await apiJson<Bundle>({ method: "PATCH", url: `${BASE}/${q.baseId}/${encodeURIComponent(q.tableId)}/${q.recordId}`, headers: headers(tok(ctx)), body: { fields: q.fields } })];
    }),
    delete_record: m("delete_record", "Delete a record", "action", z.object({ baseId: z.string(), tableId: z.string(), recordId: z.string() }), async (_i, p, ctx) => {
      const q = p as { baseId: string; tableId: string; recordId: string };
      return [await apiJson<Bundle>({ method: "DELETE", url: `${BASE}/${q.baseId}/${encodeURIComponent(q.tableId)}/${q.recordId}`, headers: headers(tok(ctx)) })];
    }),
  },
  testConnection,
};
