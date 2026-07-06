import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** Calendly connector (production). Auth: personal access token (bearer). */

const BASE = "https://api.calendly.com";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "Calendly");

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing access token." };
  try {
    const json = await apiJson<{ resource?: { name?: string } }>({ method: "GET", url: `${BASE}/users/me`, headers: bearer(token) });
    return { ok: true, message: `Connected as ${json.resource?.name ?? "Calendly user"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const calendlyApp: App = {
  key: "calendly",
  name: "Calendly",
  auth: { type: "api_key", fields: [{ key: "token", label: "Personal access token", type: "password", required: true }] },
  modules: {
    get_current_user: m("get_current_user", "Get current user", "search", z.object({}), async (_i, _p, ctx) => {
      const json = await apiJson<{ resource?: Bundle }>({ method: "GET", url: `${BASE}/users/me`, headers: bearer(tok(ctx)) });
      return [(json.resource ?? {}) as Bundle];
    }),
    list_events: m("list_events", "List scheduled events", "search", z.object({ user: z.string(), status: z.enum(["active", "canceled"]).optional(), count: z.number().optional(), pageToken: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { user: string; status?: string; count?: number; pageToken?: string };
      const json = await apiJson<{ collection?: unknown[]; pagination?: { next_page_token?: string } }>({ method: "GET", url: buildUrl(`${BASE}/scheduled_events`, { user: q.user, status: q.status, count: q.count ?? 20, page_token: q.pageToken }), headers: bearer(tok(ctx)) });
      return [{ events: json.collection ?? [], nextPageToken: json.pagination?.next_page_token } as Bundle];
    }),
    get_event: m("get_event", "Get an event", "search", z.object({ eventUuid: z.string() }), async (_i, p, ctx) => {
      const { eventUuid } = p as { eventUuid: string };
      const json = await apiJson<{ resource?: Bundle }>({ method: "GET", url: `${BASE}/scheduled_events/${eventUuid}`, headers: bearer(tok(ctx)) });
      return [(json.resource ?? {}) as Bundle];
    }),
    list_invitees: m("list_invitees", "List event invitees", "search", z.object({ eventUuid: z.string(), count: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { eventUuid: string; count?: number };
      const json = await apiJson<{ collection?: unknown[] }>({ method: "GET", url: buildUrl(`${BASE}/scheduled_events/${q.eventUuid}/invitees`, { count: q.count ?? 20 }), headers: bearer(tok(ctx)) });
      return [{ invitees: json.collection ?? [] } as Bundle];
    }),
    list_event_types: m("list_event_types", "List event types", "search", z.object({ user: z.string(), count: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { user: string; count?: number };
      const json = await apiJson<{ collection?: unknown[] }>({ method: "GET", url: buildUrl(`${BASE}/event_types`, { user: q.user, count: q.count ?? 20 }), headers: bearer(tok(ctx)) });
      return [{ eventTypes: json.collection ?? [] } as Bundle];
    }),
  },
  testConnection,
};
