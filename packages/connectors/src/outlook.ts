import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** Outlook connector (production, Microsoft Graph). Auth: Microsoft OAuth2. */

const BASE = "https://graph.microsoft.com/v1.0/me";
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["access_token", "accessToken", "token"], "Outlook");
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

export const outlookApp: App = {
  key: "outlook",
  name: "Outlook",
  auth: { type: "oauth2" },
  modules: {
    list_messages: m("list_messages", "List messages", "search", z.object({ folder: z.string().optional(), search: z.string().optional(), top: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { folder?: string; search?: string; top?: number };
      const path = q.folder ? `${BASE}/mailFolders/${q.folder}/messages` : `${BASE}/messages`;
      const json = await apiJson<{ value?: unknown[]; "@odata.nextLink"?: string }>({ method: "GET", url: buildUrl(path, { $search: q.search ? `"${q.search}"` : undefined, $top: q.top ?? 25 }), headers: bearer(tok(ctx)) });
      return [{ messages: json.value ?? [], nextLink: json["@odata.nextLink"] } as Bundle];
    }),
    get_message: m("get_message", "Get a message", "search", z.object({ messageId: z.string() }), async (_i, p, ctx) => {
      const { messageId } = p as { messageId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/messages/${messageId}`, headers: bearer(tok(ctx)) })];
    }),
    send_mail: m("send_mail", "Send an email", "action", z.object({ to: z.string(), subject: z.string(), body: z.string(), cc: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { to: string; subject: string; body: string; cc?: string };
      const toRecipients = q.to.split(",").map((a) => ({ emailAddress: { address: a.trim() } }));
      const ccRecipients = q.cc ? q.cc.split(",").map((a) => ({ emailAddress: { address: a.trim() } })) : undefined;
      await apiJson({ method: "POST", url: `${BASE}/sendMail`, headers: bearer(tok(ctx)), body: { message: { subject: q.subject, body: { contentType: "Text", content: q.body }, toRecipients, ccRecipients } } });
      return [{ sent: true, to: q.to, subject: q.subject } as Bundle];
    }),
    create_draft: m("create_draft", "Create a draft", "action", z.object({ to: z.string(), subject: z.string(), body: z.string() }), async (_i, p, ctx) => {
      const q = p as { to: string; subject: string; body: string };
      const json = await apiJson<{ id?: string }>({ method: "POST", url: `${BASE}/messages`, headers: bearer(tok(ctx)), body: { subject: q.subject, body: { contentType: "Text", content: q.body }, toRecipients: q.to.split(",").map((a) => ({ emailAddress: { address: a.trim() } })) } });
      return [{ draftId: json.id } as Bundle];
    }),
    list_events: m("list_events", "List calendar events", "search", z.object({ top: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { top?: number };
      const json = await apiJson<{ value?: unknown[] }>({ method: "GET", url: buildUrl(`${BASE}/events`, { $top: q.top ?? 25, $orderby: "start/dateTime" }), headers: bearer(tok(ctx)) });
      return [{ events: json.value ?? [] } as Bundle];
    }),
    create_event: m("create_event", "Create a calendar event", "action", z.object({ subject: z.string(), start: z.any(), end: z.any(), body: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { subject: string; start: unknown; end: unknown; body?: string };
      const json = await apiJson<{ id?: string; webLink?: string }>({ method: "POST", url: `${BASE}/events`, headers: bearer(tok(ctx)), body: { subject: q.subject, start: q.start, end: q.end, body: q.body ? { contentType: "Text", content: q.body } : undefined } });
      return [{ id: json.id, webLink: json.webLink } as Bundle];
    }),
  },
};
