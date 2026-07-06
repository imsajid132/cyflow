import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@cyflow/shared";
import { createDefaultRegistry } from "engine";
import { connectorApps, telegramApp, openaiApp, gmailApp, sheetsApp, slackApp } from "../src/index";

function makeCtx(connection: Record<string, unknown> | null): ExecutionContext {
  return {
    scenarioId: "s",
    executionId: "e",
    operations: 0,
    steps: {},
    trigger: [],
    connection,
  };
}

/** Mock fetch that captures the last call and returns a JSON body. */
function stubFetch(body: unknown, ok = true, status = 200) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown) => ({
    ok,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("connector registration", () => {
  it("registers every connector through the App framework", () => {
    const registry = createDefaultRegistry();
    for (const app of connectorApps) registry.registerApp(app);

    expect(registry.get("telegram", "send_message").run).toBeTypeOf("function");
    expect(registry.get("openai", "create_completion").kind).toBe("action");
    expect(registry.get("gmail", "send_email").appName).toBe("Gmail");
    expect(registry.get("sheets", "append_row").run).toBeTypeOf("function");
    expect(registry.get("slack", "send_message").run).toBeTypeOf("function");
    expect(registry.getApp("openai")?.name).toBe("OpenAI");
  });
});

describe("connector auth schemas", () => {
  it("declares the expected auth types + fields", () => {
    expect(telegramApp.auth).toMatchObject({ type: "api_key" });
    expect(telegramApp.auth?.fields?.[0]).toMatchObject({ key: "token", type: "password" });
    expect(openaiApp.auth?.type).toBe("bearer_token");
    expect(slackApp.auth?.type).toBe("bearer_token");
    expect(gmailApp.auth?.type).toBe("oauth2");
    expect(sheetsApp.auth?.type).toBe("oauth2");
  });
});

describe("connector execution (mocked)", () => {
  it("Telegram sends a message with the bot token and returns the message id", async () => {
    const fetchMock = stubFetch({ ok: true, result: { message_id: 42 } });
    const out = await telegramApp.modules.send_message.run(
      {},
      { chatId: "-100", text: "hi" },
      makeCtx({ token: "BOT123" }),
    );
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/botBOT123/sendMessage");
    const init = fetchMock.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: "-100", text: "hi" });
    // Production Telegram returns the raw Bot API `result` (the Message object).
    expect(out).toEqual([{ message_id: 42 }]);
  });

  it("Telegram throws without a connection", async () => {
    await expect(
      telegramApp.modules.send_message.run({}, { chatId: "1", text: "x" }, makeCtx(null)),
    ).rejects.toThrow(/Telegram requires a connection/);
  });

  it("OpenAI sends a Bearer key and returns the completion content", async () => {
    const fetchMock = stubFetch({ model: "gpt-4o-mini", choices: [{ message: { content: "Hello!" } }] });
    const out = await openaiApp.modules.create_completion.run(
      {},
      { prompt: "hi", model: "gpt-4o-mini" },
      makeCtx({ token: "sk-abc" }),
    );
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers.authorization).toBe("Bearer sk-abc");
    expect(JSON.parse(init.body).messages).toEqual([{ role: "user", content: "hi" }]);
    expect(out[0]).toMatchObject({ content: "Hello!", model: "gpt-4o-mini" });
  });

  it("Slack posts to a channel with a Bearer token", async () => {
    const fetchMock = stubFetch({ ok: true, channel: "C1", ts: "123.45" });
    const out = await slackApp.modules.send_message.run(
      {},
      { channel: "C1", text: "hey" },
      makeCtx({ token: "xoxb-1" }),
    );
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBe("Bearer xoxb-1");
    expect(out).toEqual([{ ok: true, channel: "C1", ts: "123.45", text: "hey" }]);
  });

  it("Gmail sends a base64url raw message via OAuth2 access token", async () => {
    const fetchMock = stubFetch({ id: "m1", threadId: "t1" });
    const out = await gmailApp.modules.send_email.run(
      {},
      { to: "a@b.com", subject: "Hi", body: "Body" },
      makeCtx({ access_token: "ya29.token" }),
    );
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers.authorization).toBe("Bearer ya29.token");
    expect(typeof JSON.parse(init.body).raw).toBe("string");
    expect(out).toEqual([{ id: "m1", threadId: "t1", to: "a@b.com", subject: "Hi" }]);
  });

  it("Google Sheets appends a row via OAuth2 access token", async () => {
    const fetchMock = stubFetch({ updates: { updatedRange: "Sheet1!A1:B1", updatedRows: 1 } });
    const out = await sheetsApp.modules.append_row.run(
      {},
      { spreadsheetId: "SS1", range: "Sheet1!A1", values: ["Ada", "Lovelace"] },
      makeCtx({ access_token: "ya29.token" }),
    );
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/spreadsheets/SS1/values/");
    expect(url).toContain(":append?valueInputOption=USER_ENTERED");
    expect(out).toEqual([{ updatedRange: "Sheet1!A1:B1", updatedRows: 1 }]);
  });
});

describe("Telegram Bot API (production)", () => {
  const call = (m: ReturnType<typeof stubFetch>, i = 0) => ({
    url: m.mock.calls[i][0] as string,
    body: JSON.parse((m.mock.calls[i][1] as { body: string }).body) as Record<string, unknown>,
  });

  it("exposes a broad set of real modules", () => {
    for (const k of ["send_photo", "edit_message_text", "delete_message", "forward_message", "answer_callback_query", "get_chat", "get_file", "set_webhook", "get_updates"]) {
      expect(telegramApp.modules[k]?.run).toBeTypeOf("function");
    }
    expect(telegramApp.modules.get_chat.kind).toBe("search");
    expect(telegramApp.modules.send_photo.kind).toBe("action");
  });

  it("send_photo maps params to sendPhoto and omits empty fields", async () => {
    const m = stubFetch({ ok: true, result: { message_id: 7 } });
    const out = await telegramApp.modules.send_photo.run({}, { chatId: "1", photo: "https://x/y.png", caption: "hi" }, makeCtx({ token: "T" }));
    const { url, body } = call(m);
    expect(url).toContain("/botT/sendPhoto");
    expect(body).toMatchObject({ chat_id: "1", photo: "https://x/y.png", caption: "hi" });
    expect(body).not.toHaveProperty("parse_mode");
    expect(out[0]).toMatchObject({ message_id: 7 });
  });

  it("edit_message_text and delete_message hit the right methods", async () => {
    const m1 = stubFetch({ ok: true, result: { message_id: 5 } });
    await telegramApp.modules.edit_message_text.run({}, { chatId: "1", messageId: 5, text: "new" }, makeCtx({ token: "T" }));
    expect(call(m1).url).toContain("/editMessageText");
    expect(call(m1).body).toMatchObject({ chat_id: "1", message_id: 5, text: "new" });

    const m2 = stubFetch({ ok: true, result: true });
    await telegramApp.modules.delete_message.run({}, { chatId: "1", messageId: 5 }, makeCtx({ token: "T" }));
    expect(call(m2).url).toContain("/deleteMessage");
  });

  it("get_file enriches the result with a ready download URL", async () => {
    stubFetch({ ok: true, result: { file_id: "F", file_path: "photos/a.jpg" } });
    const out = await telegramApp.modules.get_file.run({}, { fileId: "F" }, makeCtx({ token: "T" }));
    expect(out[0]).toMatchObject({ file_path: "photos/a.jpg", downloadUrl: "https://api.telegram.org/file/botT/photos/a.jpg" });
  });

  it("set_webhook posts the URL (webhook management)", async () => {
    const m = stubFetch({ ok: true, result: true });
    await telegramApp.modules.set_webhook.run({}, { url: "https://api.cyflow.dev/hooks/scn_1" }, makeCtx({ token: "T" }));
    expect(call(m).url).toContain("/setWebhook");
    expect(call(m).body).toMatchObject({ url: "https://api.cyflow.dev/hooks/scn_1" });
  });

  it("throws a descriptive error on an API failure", async () => {
    stubFetch({ ok: false, description: "chat not found" }, false, 400);
    await expect(telegramApp.modules.send_message.run({}, { chatId: "x", text: "hi" }, makeCtx({ token: "T" }))).rejects.toThrow(/chat not found/);
  });
});

describe("Test connection", () => {
  it("Telegram testConnection reports the bot username", async () => {
    stubFetch({ ok: true, result: { username: "cyflow_bot" } });
    const r = await telegramApp.testConnection!({ token: "T" });
    expect(r).toEqual({ ok: true, message: "Connected as @cyflow_bot" });
  });

  it("Telegram testConnection reports an invalid token", async () => {
    stubFetch({ ok: false, description: "Unauthorized" }, false, 401);
    const r = await telegramApp.testConnection!({ token: "bad" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Unauthorized/);
  });

  it("OpenAI testConnection validates via /models", async () => {
    const m = stubFetch({}, true, 200);
    const r = await openaiApp.testConnection!({ token: "sk-1" });
    expect(r.ok).toBe(true);
    expect(m.mock.calls[0][0]).toContain("/v1/models");
  });

  it("Slack testConnection uses auth.test", async () => {
    const m = stubFetch({ ok: true, team: "Acme", user: "botty" });
    const r = await slackApp.testConnection!({ token: "xoxb" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Acme");
    expect(m.mock.calls[0][0]).toContain("auth.test");
  });
});
