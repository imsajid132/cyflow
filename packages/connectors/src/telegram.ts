import { z } from "zod";
import type { App } from "engine";
import type { OperationRunner } from "@cyflow/shared";
import { requireCredential, postJson } from "./util";

/** Telegram Bot API — Send a message. Auth: api_key (bot token). */
const sendMessage: OperationRunner = async (_input, params, ctx) => {
  const token = requireCredential(ctx, ["token"], "Telegram");
  const p = params as { chatId?: unknown; text?: unknown; parseMode?: unknown };

  const { ok, status, json } = await postJson(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: p.chatId, text: p.text, parse_mode: p.parseMode },
  );
  if (!ok || json.ok === false) {
    throw new Error(`Telegram error: ${String(json.description ?? status)}`);
  }
  const result = json.result as { message_id?: number } | undefined;
  return [{ ok: true, messageId: result?.message_id, chatId: p.chatId, text: p.text }];
};

export const telegramApp: App = {
  key: "telegram",
  name: "Telegram",
  auth: {
    type: "api_key",
    fields: [{ key: "token", label: "Bot token", type: "password", required: true }],
  },
  modules: {
    send_message: {
      key: "send_message",
      name: "Send a message",
      kind: "action",
      params: z.object({
        chatId: z.union([z.string(), z.number()]),
        text: z.string(),
        parseMode: z.enum(["Markdown", "HTML"]).optional(),
      }),
      run: sendMessage,
    },
  },
};
