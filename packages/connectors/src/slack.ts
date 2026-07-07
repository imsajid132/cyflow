import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { requireCredential, postJson } from "./util";

/** Slack connector (production). Auth: bot token (bearer). */

const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token"], "Slack");

/** POST a Slack Web API method; Slack signals failure via { ok:false, error }. */
async function slackCall(token: string, method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { json } = await postJson(`https://slack.com/api/${method}`, body, { authorization: `Bearer ${token}` });
  if (json.ok !== true) throw new Error(`Slack error: ${String(json.error ?? "unknown")}`);
  return json;
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing token." };
  try {
    const { json } = await postJson("https://slack.com/api/auth.test", {}, { authorization: `Bearer ${token}` });
    if (json.ok === true) return { ok: true, message: `Connected to ${String(json.team ?? "Slack")} as ${String(json.user ?? "bot")}` };
    return { ok: false, message: String(json.error ?? "invalid token") };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

export const slackApp: App = {
  key: "slack",
  name: "Slack",
  auth: { type: "bearer_token", fields: [{ key: "token", label: "Bot token", type: "password", required: true }] },
  modules: {
    send_message: m("send_message", "Send a message", "action", z.object({ channel: z.string(), text: z.string() }), async (_i, p, ctx) => {
      const q = p as { channel: string; text: string };
      const json = await slackCall(tok(ctx), "chat.postMessage", { channel: q.channel, text: q.text });
      return [{ ok: true, channel: json.channel, ts: json.ts, text: q.text } as Bundle];
    }),
    update_message: m("update_message", "Update a message", "action", z.object({ channel: z.string(), ts: z.string(), text: z.string() }), async (_i, p, ctx) => {
      const q = p as { channel: string; ts: string; text: string };
      const json = await slackCall(tok(ctx), "chat.update", { channel: q.channel, ts: q.ts, text: q.text });
      return [{ ok: true, channel: json.channel, ts: json.ts } as Bundle];
    }),
    delete_message: m("delete_message", "Delete a message", "action", z.object({ channel: z.string(), ts: z.string() }), async (_i, p, ctx) => {
      const q = p as { channel: string; ts: string };
      const json = await slackCall(tok(ctx), "chat.delete", { channel: q.channel, ts: q.ts });
      return [{ ok: true, channel: json.channel, ts: json.ts } as Bundle];
    }),
    list_channels: m("list_channels", "List channels", "search", z.object({ types: z.string().optional(), limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { types?: string; limit?: number };
      const json = await slackCall(tok(ctx), "conversations.list", { types: q.types ?? "public_channel", limit: q.limit ?? 100 });
      return [{ channels: json.channels ?? [] } as Bundle];
    }),
    get_channel_info: m("get_channel_info", "Get channel info", "search", z.object({ channel: z.string() }), async (_i, p, ctx) => {
      const { channel } = p as { channel: string };
      const json = await slackCall(tok(ctx), "conversations.info", { channel });
      return [{ channel: json.channel } as Bundle];
    }),
    list_users: m("list_users", "List users", "search", z.object({ limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { limit?: number };
      const json = await slackCall(tok(ctx), "users.list", { limit: q.limit ?? 100 });
      return [{ members: json.members ?? [] } as Bundle];
    }),
    get_user_info: m("get_user_info", "Get user info", "search", z.object({ user: z.string() }), async (_i, p, ctx) => {
      const { user } = p as { user: string };
      const json = await slackCall(tok(ctx), "users.info", { user });
      return [{ user: json.user } as Bundle];
    }),
    add_reaction: m("add_reaction", "Add a reaction", "action", z.object({ channel: z.string(), timestamp: z.string(), name: z.string() }), async (_i, p, ctx) => {
      const q = p as { channel: string; timestamp: string; name: string };
      await slackCall(tok(ctx), "reactions.add", { channel: q.channel, timestamp: q.timestamp, name: q.name });
      return [{ ok: true } as Bundle];
    }),
    get_thread_replies: m("get_thread_replies", "Get thread replies", "search", z.object({ channel: z.string(), ts: z.string(), limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { channel: string; ts: string; limit?: number };
      const json = await slackCall(tok(ctx), "conversations.replies", { channel: q.channel, ts: q.ts, limit: q.limit ?? 100 });
      return [{ messages: json.messages ?? [] } as Bundle];
    }),
    schedule_message: m("schedule_message", "Schedule a message", "action", z.object({ channel: z.string(), text: z.string(), postAt: z.number() }), async (_i, p, ctx) => {
      const q = p as { channel: string; text: string; postAt: number };
      const json = await slackCall(tok(ctx), "chat.scheduleMessage", { channel: q.channel, text: q.text, post_at: q.postAt });
      return [{ ok: true, channel: json.channel, scheduledMessageId: json.scheduled_message_id, postAt: json.post_at } as Bundle];
    }),
    set_channel_topic: m("set_channel_topic", "Set channel topic", "action", z.object({ channel: z.string(), topic: z.string() }), async (_i, p, ctx) => {
      const q = p as { channel: string; topic: string };
      const json = await slackCall(tok(ctx), "conversations.setTopic", { channel: q.channel, topic: q.topic });
      return [{ ok: true, topic: json.topic } as Bundle];
    }),
    join_channel: m("join_channel", "Join a channel", "action", z.object({ channel: z.string() }), async (_i, p, ctx) => {
      const { channel } = p as { channel: string };
      const json = await slackCall(tok(ctx), "conversations.join", { channel });
      return [{ ok: true, channel: json.channel } as Bundle];
    }),
  },
  testConnection,
};
