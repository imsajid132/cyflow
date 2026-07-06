import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, compact, requireCredential } from "./util";

/** Cloudflare connector (production). Auth: API token (bearer). */

const BASE = "https://api.cloudflare.com/client/v4";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "Cloudflare");

interface CfEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
}

function m(key: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing API token." };
  try {
    const json = await apiJson<CfEnvelope<{ status?: string }>>({ method: "GET", url: `${BASE}/user/tokens/verify`, headers: bearer(token) });
    return { ok: json.result?.status === "active", message: json.result?.status === "active" ? "Token is active" : "Token is not active" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const cloudflareApp: App = {
  key: "cloudflare",
  name: "Cloudflare",
  auth: { type: "api_key", fields: [{ key: "token", label: "API token", type: "password", required: true }] },
  modules: {
    list_zones: m("list_zones", "List zones", "search", z.object({ name: z.string().optional(), perPage: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { name?: string; perPage?: number };
      const json = await apiJson<CfEnvelope<unknown[]>>({ method: "GET", url: buildUrl(`${BASE}/zones`, { name: q.name, per_page: q.perPage ?? 50 }), headers: bearer(tok(ctx)) });
      return [{ zones: json.result ?? [] } as Bundle];
    }),
    list_dns_records: m("list_dns_records", "List DNS records", "search", z.object({ zoneId: z.string(), type: z.string().optional(), name: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { zoneId: string; type?: string; name?: string };
      const json = await apiJson<CfEnvelope<unknown[]>>({ method: "GET", url: buildUrl(`${BASE}/zones/${q.zoneId}/dns_records`, { type: q.type, name: q.name }), headers: bearer(tok(ctx)) });
      return [{ records: json.result ?? [] } as Bundle];
    }),
    create_dns_record: m("create_dns_record", "Create a DNS record", "action", z.object({ zoneId: z.string(), type: z.string(), name: z.string(), content: z.string(), ttl: z.number().optional(), proxied: z.boolean().optional() }), async (_i, p, ctx) => {
      const q = p as { zoneId: string; type: string; name: string; content: string; ttl?: number; proxied?: boolean };
      const json = await apiJson<CfEnvelope<Bundle>>({ method: "POST", url: `${BASE}/zones/${q.zoneId}/dns_records`, headers: bearer(tok(ctx)), body: compact({ type: q.type, name: q.name, content: q.content, ttl: q.ttl ?? 1, proxied: q.proxied }) });
      return [(json.result ?? {}) as Bundle];
    }),
    update_dns_record: m("update_dns_record", "Update a DNS record", "action", z.object({ zoneId: z.string(), recordId: z.string(), type: z.string(), name: z.string(), content: z.string(), ttl: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { zoneId: string; recordId: string; type: string; name: string; content: string; ttl?: number };
      const json = await apiJson<CfEnvelope<Bundle>>({ method: "PUT", url: `${BASE}/zones/${q.zoneId}/dns_records/${q.recordId}`, headers: bearer(tok(ctx)), body: compact({ type: q.type, name: q.name, content: q.content, ttl: q.ttl ?? 1 }) });
      return [(json.result ?? {}) as Bundle];
    }),
    delete_dns_record: m("delete_dns_record", "Delete a DNS record", "action", z.object({ zoneId: z.string(), recordId: z.string() }), async (_i, p, ctx) => {
      const q = p as { zoneId: string; recordId: string };
      const json = await apiJson<CfEnvelope<{ id?: string }>>({ method: "DELETE", url: `${BASE}/zones/${q.zoneId}/dns_records/${q.recordId}`, headers: bearer(tok(ctx)) });
      return [{ deleted: true, id: json.result?.id ?? q.recordId } as Bundle];
    }),
    purge_cache: m("purge_cache", "Purge cache", "action", z.object({ zoneId: z.string(), files: z.array(z.string()).optional() }), async (_i, p, ctx) => {
      const q = p as { zoneId: string; files?: string[] };
      const body = q.files && q.files.length ? { files: q.files } : { purge_everything: true };
      const json = await apiJson<CfEnvelope<{ id?: string }>>({ method: "POST", url: `${BASE}/zones/${q.zoneId}/purge_cache`, headers: bearer(tok(ctx)), body });
      return [{ purged: true, id: json.result?.id } as Bundle];
    }),
  },
  testConnection,
};
