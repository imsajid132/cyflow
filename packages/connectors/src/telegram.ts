import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext, ModuleKind } from "@cyflow/shared";
import { requireCredential } from "./util";

/**
 * Telegram Bot API connector (production). Auth is a bot token (api_key); every
 * module below makes a real call to `https://api.telegram.org/bot<token>/<method>`.
 *
 * Triggers: point your bot's webhook at a Cyflow scenario's webhook URL
 * (Milestone 1) with `set_webhook` — Telegram then POSTs every update (messages,
 * commands, callback queries, channel posts, edited messages, polls, chat
 * members) to the scenario. `get_updates` covers manual polling.
 */

const API = "https://api.telegram.org";

/** Call a Bot API method and return `result`, throwing a clear error otherwise. */
async function callTelegram(token: string, method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(`Telegram ${method} failed: ${json.description ?? `HTTP ${res.status}`}`);
  }
  return json.result;
}

/** Drop undefined/empty params so we only send what the user set. */
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ""));
}

/** Build a module that maps params → a Bot API method and returns `[result]`. */
function method(
  key: string,
  name: string,
  params: z.ZodTypeAny,
  apiMethod: string,
  build: (p: Record<string, unknown>) => Record<string, unknown>,
  kind: ModuleKind = "action",
): ModuleDef {
  return {
    key,
    name,
    kind,
    params,
    run: async (_input, rawParams, ctx: ExecutionContext) => {
      const token = requireCredential(ctx, ["token"], "Telegram");
      const result = await callTelegram(token, apiMethod, clean(build(rawParams as Record<string, unknown>)));
      return [(result ?? { ok: true }) as Bundle];
    },
  };
}

const chatId = z.union([z.string(), z.number()]);
const parseMode = z.enum(["Markdown", "MarkdownV2", "HTML"]).optional();

const modules: Record<string, ModuleDef> = {
  send_message: method(
    "send_message",
    "Send a message",
    z.object({ chatId, text: z.string(), parseMode, replyToMessageId: z.number().optional(), disableNotification: z.boolean().optional() }),
    "sendMessage",
    (p) => ({ chat_id: p.chatId, text: p.text, parse_mode: p.parseMode, reply_to_message_id: p.replyToMessageId, disable_notification: p.disableNotification }),
  ),
  send_photo: method(
    "send_photo",
    "Send a photo",
    z.object({ chatId, photo: z.string(), caption: z.string().optional(), parseMode }),
    "sendPhoto",
    (p) => ({ chat_id: p.chatId, photo: p.photo, caption: p.caption, parse_mode: p.parseMode }),
  ),
  send_document: method(
    "send_document",
    "Send a document",
    z.object({ chatId, document: z.string(), caption: z.string().optional() }),
    "sendDocument",
    (p) => ({ chat_id: p.chatId, document: p.document, caption: p.caption }),
  ),
  send_video: method(
    "send_video",
    "Send a video",
    z.object({ chatId, video: z.string(), caption: z.string().optional() }),
    "sendVideo",
    (p) => ({ chat_id: p.chatId, video: p.video, caption: p.caption }),
  ),
  send_animation: method(
    "send_animation",
    "Send an animation",
    z.object({ chatId, animation: z.string(), caption: z.string().optional() }),
    "sendAnimation",
    (p) => ({ chat_id: p.chatId, animation: p.animation, caption: p.caption }),
  ),
  send_audio: method(
    "send_audio",
    "Send audio",
    z.object({ chatId, audio: z.string(), caption: z.string().optional() }),
    "sendAudio",
    (p) => ({ chat_id: p.chatId, audio: p.audio, caption: p.caption }),
  ),
  send_voice: method(
    "send_voice",
    "Send a voice message",
    z.object({ chatId, voice: z.string(), caption: z.string().optional() }),
    "sendVoice",
    (p) => ({ chat_id: p.chatId, voice: p.voice, caption: p.caption }),
  ),
  send_location: method(
    "send_location",
    "Send a location",
    z.object({ chatId, latitude: z.number(), longitude: z.number() }),
    "sendLocation",
    (p) => ({ chat_id: p.chatId, latitude: p.latitude, longitude: p.longitude }),
  ),
  send_contact: method(
    "send_contact",
    "Send a contact",
    z.object({ chatId, phoneNumber: z.string(), firstName: z.string(), lastName: z.string().optional() }),
    "sendContact",
    (p) => ({ chat_id: p.chatId, phone_number: p.phoneNumber, first_name: p.firstName, last_name: p.lastName }),
  ),
  send_poll: method(
    "send_poll",
    "Send a poll",
    z.object({ chatId, question: z.string(), options: z.array(z.string()), isAnonymous: z.boolean().optional() }),
    "sendPoll",
    (p) => ({ chat_id: p.chatId, question: p.question, options: p.options, is_anonymous: p.isAnonymous }),
  ),
  send_media_group: method(
    "send_media_group",
    "Send a media group",
    z.object({ chatId, media: z.array(z.any()) }),
    "sendMediaGroup",
    (p) => ({ chat_id: p.chatId, media: p.media }),
  ),
  edit_message_text: method(
    "edit_message_text",
    "Edit a message",
    z.object({ chatId, messageId: z.number(), text: z.string(), parseMode }),
    "editMessageText",
    (p) => ({ chat_id: p.chatId, message_id: p.messageId, text: p.text, parse_mode: p.parseMode }),
  ),
  delete_message: method(
    "delete_message",
    "Delete a message",
    z.object({ chatId, messageId: z.number() }),
    "deleteMessage",
    (p) => ({ chat_id: p.chatId, message_id: p.messageId }),
  ),
  forward_message: method(
    "forward_message",
    "Forward a message",
    z.object({ chatId, fromChatId: chatId, messageId: z.number() }),
    "forwardMessage",
    (p) => ({ chat_id: p.chatId, from_chat_id: p.fromChatId, message_id: p.messageId }),
  ),
  copy_message: method(
    "copy_message",
    "Copy a message",
    z.object({ chatId, fromChatId: chatId, messageId: z.number() }),
    "copyMessage",
    (p) => ({ chat_id: p.chatId, from_chat_id: p.fromChatId, message_id: p.messageId }),
  ),
  answer_callback_query: method(
    "answer_callback_query",
    "Answer a callback query",
    z.object({ callbackQueryId: z.string(), text: z.string().optional(), showAlert: z.boolean().optional() }),
    "answerCallbackQuery",
    (p) => ({ callback_query_id: p.callbackQueryId, text: p.text, show_alert: p.showAlert }),
  ),
  pin_message: method(
    "pin_message",
    "Pin a message",
    z.object({ chatId, messageId: z.number(), disableNotification: z.boolean().optional() }),
    "pinChatMessage",
    (p) => ({ chat_id: p.chatId, message_id: p.messageId, disable_notification: p.disableNotification }),
  ),
  unpin_message: method(
    "unpin_message",
    "Unpin a message",
    z.object({ chatId, messageId: z.number().optional() }),
    "unpinChatMessage",
    (p) => ({ chat_id: p.chatId, message_id: p.messageId }),
  ),
  create_invite_link: method(
    "create_invite_link",
    "Create an invite link",
    z.object({ chatId, expireDate: z.number().optional(), memberLimit: z.number().optional() }),
    "createChatInviteLink",
    (p) => ({ chat_id: p.chatId, expire_date: p.expireDate, member_limit: p.memberLimit }),
  ),
  set_my_commands: method(
    "set_my_commands",
    "Set bot commands",
    z.object({ commands: z.array(z.object({ command: z.string(), description: z.string() })) }),
    "setMyCommands",
    (p) => ({ commands: p.commands }),
  ),
  // ---- searches (reads) ----
  get_chat: method("get_chat", "Get a chat", z.object({ chatId }), "getChat", (p) => ({ chat_id: p.chatId }), "search"),
  get_chat_member: method(
    "get_chat_member",
    "Get a chat member",
    z.object({ chatId, userId: z.number() }),
    "getChatMember",
    (p) => ({ chat_id: p.chatId, user_id: p.userId }),
    "search",
  ),
  get_file: method("get_file", "Get a file (download link)", z.object({ fileId: z.string() }), "getFile", (p) => ({ file_id: p.fileId }), "search"),
  get_updates: method(
    "get_updates",
    "Get updates (polling)",
    z.object({ offset: z.number().optional(), limit: z.number().optional(), timeout: z.number().optional() }),
    "getUpdates",
    (p) => ({ offset: p.offset, limit: p.limit, timeout: p.timeout }),
    "search",
  ),
  // ---- webhook management ----
  set_webhook: method(
    "set_webhook",
    "Set webhook",
    z.object({ url: z.string(), secretToken: z.string().optional(), allowedUpdates: z.array(z.string()).optional() }),
    "setWebhook",
    (p) => ({ url: p.url, secret_token: p.secretToken, allowed_updates: p.allowedUpdates }),
  ),
  delete_webhook: method(
    "delete_webhook",
    "Delete webhook",
    z.object({ dropPendingUpdates: z.boolean().optional() }),
    "deleteWebhook",
    (p) => ({ drop_pending_updates: p.dropPendingUpdates }),
  ),
  get_webhook_info: method("get_webhook_info", "Get webhook info", z.object({}), "getWebhookInfo", () => ({}), "search"),
};

// getFile returns a file_path; enrich it into a ready-to-use download URL.
const rawGetFile = modules.get_file.run;
modules.get_file.run = async (input, params, ctx) => {
  const token = requireCredential(ctx, ["token"], "Telegram");
  const out = await rawGetFile(input, params, ctx);
  const file = out[0] as { file_path?: string; downloadUrl?: string };
  if (file?.file_path) file.downloadUrl = `${API}/file/bot${token}/${file.file_path}`;
  return out;
};

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing bot token." };
  try {
    const me = (await callTelegram(token, "getMe", {})) as { username?: string; first_name?: string };
    return { ok: true, message: `Connected as @${me.username ?? me.first_name ?? "bot"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const telegramApp: App = {
  key: "telegram",
  name: "Telegram",
  auth: {
    type: "api_key",
    fields: [{ key: "token", label: "Bot token", type: "password", required: true }],
  },
  modules,
  testConnection,
};
