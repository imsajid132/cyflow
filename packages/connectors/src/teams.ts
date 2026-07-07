import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** Microsoft Teams connector (production, Graph). Auth: Microsoft OAuth2. */

const GRAPH = "https://graph.microsoft.com/v1.0";
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["access_token", "accessToken", "token"], "Microsoft Teams");
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

export const teamsApp: App = {
  key: "teams",
  name: "Microsoft Teams",
  auth: { type: "oauth2" },
  modules: {
    list_teams: m("list_teams", "List my teams", "search", z.object({}), async (_i, _p, ctx) => {
      const json = await apiJson<{ value?: unknown[] }>({ method: "GET", url: `${GRAPH}/me/joinedTeams`, headers: bearer(tok(ctx)) });
      return [{ teams: json.value ?? [] } as Bundle];
    }),
    list_channels: m("list_channels", "List channels", "search", z.object({ teamId: z.string() }), async (_i, p, ctx) => {
      const { teamId } = p as { teamId: string };
      const json = await apiJson<{ value?: unknown[] }>({ method: "GET", url: `${GRAPH}/teams/${teamId}/channels`, headers: bearer(tok(ctx)) });
      return [{ channels: json.value ?? [] } as Bundle];
    }),
    send_channel_message: m("send_channel_message", "Send a channel message", "action", z.object({ teamId: z.string(), channelId: z.string(), content: z.string(), contentType: z.enum(["text", "html"]).optional() }), async (_i, p, ctx) => {
      const q = p as { teamId: string; channelId: string; content: string; contentType?: string };
      const json = await apiJson<{ id?: string; webUrl?: string }>({
        method: "POST",
        url: `${GRAPH}/teams/${q.teamId}/channels/${q.channelId}/messages`,
        headers: bearer(tok(ctx)),
        body: { body: { contentType: q.contentType ?? "text", content: q.content } },
      });
      return [{ id: json.id, webUrl: json.webUrl } as Bundle];
    }),
    list_channel_messages: m("list_channel_messages", "List channel messages", "search", z.object({ teamId: z.string(), channelId: z.string(), top: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { teamId: string; channelId: string; top?: number };
      const json = await apiJson<{ value?: unknown[]; "@odata.nextLink"?: string }>({ method: "GET", url: buildUrl(`${GRAPH}/teams/${q.teamId}/channels/${q.channelId}/messages`, { $top: q.top ?? 20 }), headers: bearer(tok(ctx)) });
      return [{ messages: json.value ?? [], nextLink: json["@odata.nextLink"] } as Bundle];
    }),
    list_chats: m("list_chats", "List my chats", "search", z.object({ top: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { top?: number };
      const json = await apiJson<{ value?: unknown[] }>({ method: "GET", url: buildUrl(`${GRAPH}/me/chats`, { $top: q.top ?? 20 }), headers: bearer(tok(ctx)) });
      return [{ chats: json.value ?? [] } as Bundle];
    }),
    send_chat_message: m("send_chat_message", "Send a chat message", "action", z.object({ chatId: z.string(), content: z.string(), contentType: z.enum(["text", "html"]).optional() }), async (_i, p, ctx) => {
      const q = p as { chatId: string; content: string; contentType?: string };
      const json = await apiJson<{ id?: string }>({ method: "POST", url: `${GRAPH}/chats/${q.chatId}/messages`, headers: bearer(tok(ctx)), body: { body: { contentType: q.contentType ?? "text", content: q.content } } });
      return [{ id: json.id } as Bundle];
    }),
  },
};
