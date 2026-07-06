import { z } from "zod";
import type { App, TestConnectionResult } from "engine";
import type { OperationRunner } from "@cyflow/shared";
import { requireCredential, postJson } from "./util";

/** Validate a Slack token with auth.test. */
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

/** Slack (scaffold) — Post a message to a channel. Auth: bearer_token. */
const sendMessage: OperationRunner = async (_input, params, ctx) => {
  const token = requireCredential(ctx, ["token"], "Slack");
  const p = params as { channel?: unknown; text?: unknown };

  const { json } = await postJson(
    "https://slack.com/api/chat.postMessage",
    { channel: p.channel, text: p.text },
    { authorization: `Bearer ${token}` },
  );
  if (json.ok !== true) {
    throw new Error(`Slack error: ${String(json.error ?? "unknown")}`);
  }
  return [{ ok: true, channel: json.channel, ts: json.ts, text: p.text }];
};

export const slackApp: App = {
  key: "slack",
  name: "Slack",
  auth: {
    type: "bearer_token",
    fields: [{ key: "token", label: "Bot token", type: "password", required: true }],
  },
  modules: {
    send_message: {
      key: "send_message",
      name: "Send a message",
      kind: "action",
      params: z.object({ channel: z.string(), text: z.string() }),
      run: sendMessage,
    },
  },
  testConnection,
};
