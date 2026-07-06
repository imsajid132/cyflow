import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, compact, requireCredential } from "./util";

/** Discord connector (production). Auth: bot token (api_key). */

const BASE = "https://discord.com/api/v10";
const headers = (token: string) => ({ authorization: `Bot ${token}` });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token"], "Discord");

function m(key: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing bot token." };
  try {
    const me = await apiJson<{ username?: string }>({ method: "GET", url: `${BASE}/users/@me`, headers: headers(token) });
    return { ok: true, message: `Connected as ${me.username ?? "bot"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const discordApp: App = {
  key: "discord",
  name: "Discord",
  auth: { type: "api_key", fields: [{ key: "token", label: "Bot token", type: "password", required: true }] },
  modules: {
    send_message: m("send_message", "Send a message", "action", z.object({ channelId: z.string(), content: z.string() }), async (_i, p, ctx) => {
      const { channelId, content } = p as { channelId: string; content: string };
      const json = await apiJson<Bundle>({ method: "POST", url: `${BASE}/channels/${channelId}/messages`, headers: headers(tok(ctx)), body: { content } });
      return [json];
    }),
    edit_message: m("edit_message", "Edit a message", "action", z.object({ channelId: z.string(), messageId: z.string(), content: z.string() }), async (_i, p, ctx) => {
      const { channelId, messageId, content } = p as { channelId: string; messageId: string; content: string };
      const json = await apiJson<Bundle>({ method: "PATCH", url: `${BASE}/channels/${channelId}/messages/${messageId}`, headers: headers(tok(ctx)), body: { content } });
      return [json];
    }),
    delete_message: m("delete_message", "Delete a message", "action", z.object({ channelId: z.string(), messageId: z.string() }), async (_i, p, ctx) => {
      const { channelId, messageId } = p as { channelId: string; messageId: string };
      await apiJson({ method: "DELETE", url: `${BASE}/channels/${channelId}/messages/${messageId}`, headers: headers(tok(ctx)) });
      return [{ deleted: true, messageId }];
    }),
    get_channel: m("get_channel", "Get a channel", "search", z.object({ channelId: z.string() }), async (_i, p, ctx) => {
      const { channelId } = p as { channelId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/channels/${channelId}`, headers: headers(tok(ctx)) })];
    }),
    list_messages: m("list_messages", "List messages", "search", z.object({ channelId: z.string(), limit: z.number().optional() }), async (_i, p, ctx) => {
      const { channelId, limit } = p as { channelId: string; limit?: number };
      const json = await apiJson<Bundle[]>({ method: "GET", url: buildUrl(`${BASE}/channels/${channelId}/messages`, { limit: limit ?? 50 }), headers: headers(tok(ctx)) });
      return [{ messages: json } as Bundle];
    }),
    create_channel: m("create_channel", "Create a channel", "action", z.object({ guildId: z.string(), name: z.string(), type: z.number().optional() }), async (_i, p, ctx) => {
      const { guildId, name, type } = p as { guildId: string; name: string; type?: number };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/guilds/${guildId}/channels`, headers: headers(tok(ctx)), body: compact({ name, type: type ?? 0 }) })];
    }),
    add_reaction: m("add_reaction", "Add a reaction", "action", z.object({ channelId: z.string(), messageId: z.string(), emoji: z.string() }), async (_i, p, ctx) => {
      const { channelId, messageId, emoji } = p as { channelId: string; messageId: string; emoji: string };
      await apiJson({ method: "PUT", url: `${BASE}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, headers: headers(tok(ctx)) });
      return [{ ok: true }];
    }),
  },
  testConnection,
};
