import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** HubSpot connector (production). Auth: private app token (bearer). */

const BASE = "https://api.hubapi.com";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "HubSpot");

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing access token." };
  try {
    await apiJson({ method: "GET", url: buildUrl(`${BASE}/crm/v3/objects/contacts`, { limit: 1 }), headers: bearer(token) });
    return { ok: true, message: "Connected to HubSpot" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const hubspotApp: App = {
  key: "hubspot",
  name: "HubSpot",
  auth: { type: "api_key", fields: [{ key: "token", label: "Private app token", type: "password", required: true }] },
  modules: {
    list_contacts: m("list_contacts", "List contacts", "search", z.object({ limit: z.number().optional(), after: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { limit?: number; after?: string };
      const json = await apiJson<{ results?: unknown[]; paging?: { next?: { after?: string } } }>({ method: "GET", url: buildUrl(`${BASE}/crm/v3/objects/contacts`, { limit: q.limit ?? 20, after: q.after }), headers: bearer(tok(ctx)) });
      return [{ results: json.results ?? [], after: json.paging?.next?.after } as Bundle];
    }),
    get_contact: m("get_contact", "Get a contact", "search", z.object({ contactId: z.string() }), async (_i, p, ctx) => {
      const { contactId } = p as { contactId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/crm/v3/objects/contacts/${contactId}`, headers: bearer(tok(ctx)) })];
    }),
    create_contact: m("create_contact", "Create a contact", "action", z.object({ properties: z.any() }), async (_i, p, ctx) => {
      const { properties } = p as { properties: unknown };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/crm/v3/objects/contacts`, headers: bearer(tok(ctx)), body: { properties } })];
    }),
    update_contact: m("update_contact", "Update a contact", "action", z.object({ contactId: z.string(), properties: z.any() }), async (_i, p, ctx) => {
      const q = p as { contactId: string; properties: unknown };
      return [await apiJson<Bundle>({ method: "PATCH", url: `${BASE}/crm/v3/objects/contacts/${q.contactId}`, headers: bearer(tok(ctx)), body: { properties: q.properties } })];
    }),
    search_contacts: m("search_contacts", "Search contacts", "search", z.object({ filterGroups: z.any().optional(), query: z.string().optional(), limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { filterGroups?: unknown; query?: string; limit?: number };
      const body: Record<string, unknown> = { limit: q.limit ?? 20 };
      if (q.filterGroups) body.filterGroups = q.filterGroups;
      if (q.query) body.query = q.query;
      const json = await apiJson<{ results?: unknown[]; total?: number }>({ method: "POST", url: `${BASE}/crm/v3/objects/contacts/search`, headers: bearer(tok(ctx)), body });
      return [{ results: json.results ?? [], total: json.total } as Bundle];
    }),
    create_deal: m("create_deal", "Create a deal", "action", z.object({ properties: z.any() }), async (_i, p, ctx) => {
      const { properties } = p as { properties: unknown };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/crm/v3/objects/deals`, headers: bearer(tok(ctx)), body: { properties } })];
    }),
    create_company: m("create_company", "Create a company", "action", z.object({ properties: z.any() }), async (_i, p, ctx) => {
      const { properties } = p as { properties: unknown };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/crm/v3/objects/companies`, headers: bearer(tok(ctx)), body: { properties } })];
    }),
  },
  testConnection,
};
