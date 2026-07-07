import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, basicAuth, buildUrl, compact, requireCredential } from "./util";

/**
 * Zoom connector (production). Auth: Server-to-Server OAuth (account_credentials
 * grant) — no user consent / app review needed. Each run exchanges the client
 * id/secret + account id for a short-lived access token, then calls the API.
 */

const OAUTH = "https://zoom.us/oauth/token";
const API = "https://api.zoom.us/v2";

async function zoomToken(clientId: string, clientSecret: string, accountId: string): Promise<string> {
  const json = await apiJson<{ access_token?: string }>({
    method: "POST",
    url: buildUrl(OAUTH, { grant_type: "account_credentials", account_id: accountId }),
    headers: { authorization: basicAuth(clientId, clientSecret) },
  });
  if (!json.access_token) throw new Error("Zoom did not return an access token");
  return json.access_token;
}

async function tokenFor(ctx: ExecutionContext): Promise<string> {
  return zoomToken(
    requireCredential(ctx, ["clientId"], "Zoom"),
    requireCredential(ctx, ["clientSecret"], "Zoom"),
    requireCredential(ctx, ["accountId"], "Zoom"),
  );
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const clientId = credentials.clientId as string | undefined;
  const clientSecret = credentials.clientSecret as string | undefined;
  const accountId = credentials.accountId as string | undefined;
  if (!clientId || !clientSecret || !accountId) return { ok: false, message: "Missing client ID, client secret, or account ID." };
  try {
    const token = await zoomToken(clientId, clientSecret, accountId);
    const me = await apiJson<{ email?: string }>({ method: "GET", url: `${API}/users/me`, headers: bearer(token) });
    return { ok: true, message: `Connected as ${me.email ?? "Zoom account"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const zoomApp: App = {
  key: "zoom",
  name: "Zoom",
  auth: {
    type: "custom",
    fields: [
      { key: "accountId", label: "Account ID", type: "text", required: true },
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client secret", type: "password", required: true },
    ],
  },
  modules: {
    list_meetings: m("list_meetings", "List meetings", "search", z.object({ type: z.string().optional(), pageSize: z.number().optional(), nextPageToken: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { type?: string; pageSize?: number; nextPageToken?: string };
      const token = await tokenFor(ctx);
      const json = await apiJson<{ meetings?: unknown[]; next_page_token?: string }>({ method: "GET", url: buildUrl(`${API}/users/me/meetings`, { type: q.type ?? "scheduled", page_size: q.pageSize ?? 30, next_page_token: q.nextPageToken }), headers: bearer(token) });
      return [{ meetings: json.meetings ?? [], nextPageToken: json.next_page_token } as Bundle];
    }),
    get_meeting: m("get_meeting", "Get a meeting", "search", z.object({ meetingId: z.string() }), async (_i, p, ctx) => {
      const { meetingId } = p as { meetingId: string };
      const token = await tokenFor(ctx);
      return [await apiJson<Bundle>({ method: "GET", url: `${API}/meetings/${meetingId}`, headers: bearer(token) })];
    }),
    create_meeting: m("create_meeting", "Create a meeting", "action", z.object({ topic: z.string(), type: z.number().optional(), startTime: z.string().optional(), duration: z.number().optional(), timezone: z.string().optional(), agenda: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { topic: string; type?: number; startTime?: string; duration?: number; timezone?: string; agenda?: string };
      const token = await tokenFor(ctx);
      const json = await apiJson<{ id?: number; join_url?: string; start_url?: string }>({ method: "POST", url: `${API}/users/me/meetings`, headers: bearer(token), body: compact({ topic: q.topic, type: q.type ?? 2, start_time: q.startTime, duration: q.duration, timezone: q.timezone, agenda: q.agenda }) });
      return [{ id: json.id, joinUrl: json.join_url, startUrl: json.start_url } as Bundle];
    }),
    update_meeting: m("update_meeting", "Update a meeting", "action", z.object({ meetingId: z.string(), topic: z.string().optional(), startTime: z.string().optional(), duration: z.number().optional(), agenda: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { meetingId: string; topic?: string; startTime?: string; duration?: number; agenda?: string };
      const token = await tokenFor(ctx);
      await apiJson({ method: "PATCH", url: `${API}/meetings/${q.meetingId}`, headers: bearer(token), body: compact({ topic: q.topic, start_time: q.startTime, duration: q.duration, agenda: q.agenda }) });
      return [{ updated: true, meetingId: q.meetingId } as Bundle];
    }),
    delete_meeting: m("delete_meeting", "Delete a meeting", "action", z.object({ meetingId: z.string() }), async (_i, p, ctx) => {
      const { meetingId } = p as { meetingId: string };
      const token = await tokenFor(ctx);
      await apiJson({ method: "DELETE", url: `${API}/meetings/${meetingId}`, headers: bearer(token) });
      return [{ deleted: true, meetingId } as Bundle];
    }),
    list_recordings: m("list_recordings", "List cloud recordings", "search", z.object({ from: z.string().optional(), to: z.string().optional(), pageSize: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { from?: string; to?: string; pageSize?: number };
      const token = await tokenFor(ctx);
      const json = await apiJson<{ meetings?: unknown[] }>({ method: "GET", url: buildUrl(`${API}/users/me/recordings`, { from: q.from, to: q.to, page_size: q.pageSize ?? 30 }), headers: bearer(token) });
      return [{ recordings: json.meetings ?? [] } as Bundle];
    }),
    list_users: m("list_users", "List users", "search", z.object({ status: z.string().optional(), pageSize: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { status?: string; pageSize?: number };
      const token = await tokenFor(ctx);
      const json = await apiJson<{ users?: unknown[] }>({ method: "GET", url: buildUrl(`${API}/users`, { status: q.status ?? "active", page_size: q.pageSize ?? 30 }), headers: bearer(token) });
      return [{ users: json.users ?? [] } as Bundle];
    }),
  },
  testConnection,
};
