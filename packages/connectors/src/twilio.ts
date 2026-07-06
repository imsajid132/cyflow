import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, basicAuth, buildUrl, compact, requireCredential, toForm } from "./util";

/** Twilio connector (production). Auth: Account SID + Auth Token (HTTP Basic). */

const BASE = "https://api.twilio.com/2010-04-01/Accounts";
const FORM = "application/x-www-form-urlencoded";
const sid = (ctx: ExecutionContext) => requireCredential(ctx, ["accountSid", "sid"], "Twilio");
const authTok = (ctx: ExecutionContext) => requireCredential(ctx, ["authToken", "token"], "Twilio");
const headers = (ctx: ExecutionContext) => ({ authorization: basicAuth(sid(ctx), authTok(ctx)) });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const s = (credentials.accountSid ?? credentials.sid) as string | undefined;
  const t = (credentials.authToken ?? credentials.token) as string | undefined;
  if (!s || !t) return { ok: false, message: "Missing Account SID or Auth Token." };
  try {
    const acc = await apiJson<{ friendly_name?: string }>({ method: "GET", url: `${BASE}/${s}.json`, headers: { authorization: basicAuth(s, t) } });
    return { ok: true, message: `Connected: ${acc.friendly_name ?? s}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const twilioApp: App = {
  key: "twilio",
  name: "Twilio",
  auth: {
    type: "custom",
    fields: [
      { key: "accountSid", label: "Account SID", type: "text", required: true },
      { key: "authToken", label: "Auth Token", type: "password", required: true },
    ],
  },
  modules: {
    send_sms: m("send_sms", "Send an SMS", "action", z.object({ from: z.string(), to: z.string(), body: z.string() }), async (_i, p, ctx) => {
      const q = p as { from: string; to: string; body: string };
      const json = await apiJson<{ sid?: string; status?: string }>({ method: "POST", url: `${BASE}/${sid(ctx)}/Messages.json`, headers: { ...headers(ctx), "content-type": FORM }, body: toForm({ From: q.from, To: q.to, Body: q.body }) });
      return [{ sid: json.sid, status: json.status } as Bundle];
    }),
    list_messages: m("list_messages", "List messages", "search", z.object({ to: z.string().optional(), from: z.string().optional(), pageSize: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { to?: string; from?: string; pageSize?: number };
      const json = await apiJson<{ messages?: unknown[] }>({ method: "GET", url: buildUrl(`${BASE}/${sid(ctx)}/Messages.json`, compact({ To: q.to, From: q.from, PageSize: q.pageSize ?? 20 })), headers: headers(ctx) });
      return [{ messages: json.messages ?? [] } as Bundle];
    }),
    get_message: m("get_message", "Get a message", "search", z.object({ messageSid: z.string() }), async (_i, p, ctx) => {
      const { messageSid } = p as { messageSid: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/${sid(ctx)}/Messages/${messageSid}.json`, headers: headers(ctx) })];
    }),
    make_call: m("make_call", "Make a call", "action", z.object({ from: z.string(), to: z.string(), url: z.string() }), async (_i, p, ctx) => {
      const q = p as { from: string; to: string; url: string };
      const json = await apiJson<{ sid?: string; status?: string }>({ method: "POST", url: `${BASE}/${sid(ctx)}/Calls.json`, headers: { ...headers(ctx), "content-type": FORM }, body: toForm({ From: q.from, To: q.to, Url: q.url }) });
      return [{ sid: json.sid, status: json.status } as Bundle];
    }),
  },
  testConnection,
};
