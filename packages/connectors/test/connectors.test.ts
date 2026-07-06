import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@cyflow/shared";
import { createDefaultRegistry } from "engine";
import { connectorApps, telegramApp, openaiApp, gmailApp, sheetsApp, driveApp, calendarApp, slackApp, discordApp, notionApp, airtableApp, githubApp, gitlabApp, dropboxApp, cloudflareApp, supabaseApp, trelloApp, asanaApp, hubspotApp, clickupApp, calendlyApp, twilioApp, stripeApp, shopifyApp, woocommerceApp, rssApp, whatsappApp, twitterApp, googleContactsApp, googleTasksApp, youtubeApp, parseFeed, utilsApp, parseCsv, toCsv } from "../src/index";

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

  // (Gmail send + Sheets append are covered in depth by the "Gmail/Sheets (mocked)"
  // suites below, which exercise the real OAuth2 connectors + response parsing.)
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

/** A URL/method-aware fetch stub for Google (gapi uses res.text()). */
function stubGoogle(handler: (url: string, init: { method?: string; body?: string }) => { ok?: boolean; status?: number; body?: unknown; text?: string }) {
  const mock = vi.fn(async (url: unknown, init?: unknown) => {
    const r = handler(String(url), (init ?? {}) as { method?: string; body?: string });
    const text = r.text ?? (r.body !== undefined ? JSON.stringify(r.body) : "");
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: "OK",
      text: async () => text,
      json: async () => (text ? JSON.parse(text) : {}),
      arrayBuffer: async () => Buffer.from(text, "utf8"),
      headers: { get: () => "text/plain" },
    };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const gctx = () => makeCtx({ access_token: "ya29.token" });

describe("Gmail (mocked)", () => {
  it("search_emails calls messages?q and returns the list", async () => {
    const m = stubGoogle(() => ({ body: { messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "np" } }));
    const out = await gmailApp.modules.search_emails.run({}, { query: "from:ada is:unread", maxResults: 5 }, gctx());
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.pathname).toContain("/messages");
    expect(url.searchParams.get("q")).toBe("from:ada is:unread");
    expect(out[0]).toMatchObject({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "np", count: 1 });
  });

  it("read_email parses headers + body", async () => {
    stubGoogle(() => ({
      body: { id: "m1", threadId: "t1", labelIds: ["INBOX"], snippet: "Hi", payload: { headers: [{ name: "From", value: "a@b.com" }, { name: "Subject", value: "Hey" }], body: { data: b64url("Hello world") } } },
    }));
    const out = await gmailApp.modules.read_email.run({}, { messageId: "m1" }, gctx());
    expect(out[0]).toMatchObject({ from: "a@b.com", subject: "Hey", body: "Hello world", labelIds: ["INBOX"] });
  });

  it("send_email posts a base64url MIME with the right headers", async () => {
    const m = stubGoogle(() => ({ body: { id: "m9", threadId: "t9" } }));
    const out = await gmailApp.modules.send_email.run({}, { to: "x@y.com", subject: "Hi", body: "Body", cc: "c@y.com" }, gctx());
    expect(m.mock.calls[0][0]).toContain("/messages/send");
    const raw = (JSON.parse((m.mock.calls[0][1] as { body: string }).body) as { raw: string }).raw;
    const mime = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(mime).toContain("To: x@y.com");
    expect(mime).toContain("Cc: c@y.com");
    expect(mime).toContain("Subject: Hi");
    expect(out[0]).toMatchObject({ id: "m9", threadId: "t9" });
  });

  it("add_label posts modify with addLabelIds", async () => {
    const m = stubGoogle(() => ({ body: { id: "m1", labelIds: ["INBOX", "STARRED"] } }));
    await gmailApp.modules.add_label.run({}, { messageId: "m1", labelId: "STARRED" }, gctx());
    expect(m.mock.calls[0][0]).toContain("/messages/m1/modify");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ addLabelIds: ["STARRED"] });
  });

  it("surfaces Google API errors", async () => {
    stubGoogle(() => ({ ok: false, status: 403, body: { error: { message: "insufficientPermissions" } } }));
    await expect(gmailApp.modules.list_labels.run({}, {}, gctx())).rejects.toThrow(/insufficientPermissions/);
  });
});

describe("Google Sheets (mocked)", () => {
  it("read_range fetches values", async () => {
    const m = stubGoogle(() => ({ body: { range: "Sheet1!A1:B2", values: [["a", "b"], ["c", "d"]] } }));
    const out = await sheetsApp.modules.read_range.run({}, { spreadsheetId: "SS", range: "Sheet1!A1:B2" }, gctx());
    expect(m.mock.calls[0][0]).toContain("/spreadsheets/SS/values/");
    expect(out[0]).toMatchObject({ rowCount: 2, values: [["a", "b"], ["c", "d"]] });
  });

  it("append_row wraps the values in a single row + USER_ENTERED", async () => {
    const m = stubGoogle(() => ({ body: { updates: { updatedRange: "Sheet1!A3", updatedRows: 1 } } }));
    await sheetsApp.modules.append_row.run({}, { spreadsheetId: "SS", range: "Sheet1!A1", values: ["Ada", 42] }, gctx());
    expect(m.mock.calls[0][0]).toContain(":append");
    expect(m.mock.calls[0][0]).toContain("USER_ENTERED");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ values: [["Ada", 42]] });
  });

  it("search_rows filters by a column value", async () => {
    stubGoogle(() => ({ body: { values: [["Ada", "London"], ["Grace", "NYC"], ["Kay", "London"]] } }));
    const out = await sheetsApp.modules.search_rows.run({}, { spreadsheetId: "SS", range: "A:B", column: 1, value: "London" }, gctx());
    expect(out[0]).toMatchObject({ count: 2 });
    expect((out[0] as { matches: { index: number }[] }).matches.map((x) => x.index)).toEqual([0, 2]);
  });
});

describe("Google Drive (mocked)", () => {
  it("search_files passes q + pagination fields", async () => {
    const m = stubGoogle(() => ({ body: { files: [{ id: "f1", name: "doc" }], nextPageToken: "n2" } }));
    const out = await driveApp.modules.search_files.run({}, { query: "name contains 'report'", pageSize: 10 }, gctx());
    expect(new URL(m.mock.calls[0][0] as string).searchParams.get("q")).toBe("name contains 'report'");
    expect(out[0]).toMatchObject({ files: [{ id: "f1", name: "doc" }], nextPageToken: "n2" });
  });

  it("upload_file sends a multipart/related body", async () => {
    const m = stubGoogle(() => ({ body: { id: "f2", name: "note.txt" } }));
    await driveApp.modules.upload_file.run({}, { name: "note.txt", content: "hello", mimeType: "text/plain" }, gctx());
    expect(m.mock.calls[0][0]).toContain("uploadType=multipart");
    const init = m.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers["content-type"]).toContain("multipart/related");
    expect(init.body).toContain('"name":"note.txt"');
    expect(init.body).toContain("hello");
  });

  it("move_file reads current parents then re-parents", async () => {
    const m = stubGoogle((url, init) => (init.method === "GET" ? { body: { parents: ["oldFolder"] } } : { body: { id: "f1", parents: ["newFolder"] } }));
    await driveApp.modules.move_file.run({}, { fileId: "f1", destinationFolderId: "newFolder" }, gctx());
    const patchUrl = m.mock.calls[1][0] as string;
    expect(patchUrl).toContain("addParents=newFolder");
    expect(patchUrl).toContain("removeParents=oldFolder");
  });

  it("delete_file issues a DELETE", async () => {
    const m = stubGoogle(() => ({ status: 204, text: "" }));
    const out = await driveApp.modules.delete_file.run({}, { fileId: "f1" }, gctx());
    expect((m.mock.calls[0][1] as { method: string }).method).toBe("DELETE");
    expect(out[0]).toEqual({ deleted: true, fileId: "f1" });
  });
});

describe("Google Calendar (mocked)", () => {
  it("create_event maps attendee emails + posts to the calendar", async () => {
    const m = stubGoogle(() => ({ body: { id: "e1", htmlLink: "http://cal/e1", status: "confirmed" } }));
    await calendarApp.modules.create_event.run(
      {},
      { summary: "Sync", start: { dateTime: "2026-07-08T10:00:00Z" }, end: { dateTime: "2026-07-08T10:30:00Z" }, attendees: ["a@b.com", "c@d.com"] },
      gctx(),
    );
    expect(m.mock.calls[0][0]).toContain("/calendars/primary/events");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body).attendees).toEqual([{ email: "a@b.com" }, { email: "c@d.com" }]);
  });

  it("list_events requests singleEvents + orderBy", async () => {
    const m = stubGoogle(() => ({ body: { items: [{ id: "e1" }] } }));
    const out = await calendarApp.modules.list_events.run({}, { timeMin: "2026-07-01T00:00:00Z" }, gctx());
    expect(m.mock.calls[0][0]).toContain("singleEvents=true");
    expect(out[0]).toMatchObject({ events: [{ id: "e1" }] });
  });

  it("delete_event issues a DELETE", async () => {
    const m = stubGoogle(() => ({ status: 204, text: "" }));
    await calendarApp.modules.delete_event.run({}, { eventId: "e1" }, gctx());
    expect((m.mock.calls[0][1] as { method: string }).method).toBe("DELETE");
  });
});

describe("Google testConnection", () => {
  it("validates the token via userinfo", async () => {
    stubGoogle(() => ({ body: { email: "ada@gmail.com" } }));
    for (const app of [gmailApp, sheetsApp, driveApp, calendarApp]) {
      const r = await app.testConnection!({ access_token: "ya29.x" });
      expect(r).toEqual({ ok: true, message: "Connected as ada@gmail.com" });
    }
  });
});

describe("Discord (mocked)", () => {
  const ctx = () => makeCtx({ token: "BOT" });
  it("send_message posts to the channel with a Bot token", async () => {
    const m = stubGoogle(() => ({ body: { id: "1", content: "hi" } }));
    await discordApp.modules.send_message.run({}, { channelId: "C1", content: "hi" }, ctx());
    expect(m.mock.calls[0][0]).toContain("/channels/C1/messages");
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers.authorization).toBe("Bot BOT");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ content: "hi" });
  });
  it("delete_message issues a DELETE", async () => {
    const m = stubGoogle(() => ({ status: 204, text: "" }));
    const out = await discordApp.modules.delete_message.run({}, { channelId: "C1", messageId: "M1" }, ctx());
    expect((m.mock.calls[0][1] as { method: string }).method).toBe("DELETE");
    expect(out[0]).toEqual({ deleted: true, messageId: "M1" });
  });
  it("testConnection uses users/@me", async () => {
    stubGoogle(() => ({ body: { username: "cyflowbot" } }));
    expect(await discordApp.testConnection!({ token: "BOT" })).toEqual({ ok: true, message: "Connected as cyflowbot" });
  });
});

describe("Notion (mocked)", () => {
  const ctx = () => makeCtx({ token: "secret_x" });
  it("query_database posts with the notion-version header", async () => {
    const m = stubGoogle(() => ({ body: { results: [{ id: "p1" }], next_cursor: "c2", has_more: true } }));
    const out = await notionApp.modules.query_database.run({}, { databaseId: "DB1", pageSize: 10 }, ctx());
    expect(m.mock.calls[0][0]).toContain("/databases/DB1/query");
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers["notion-version"]).toBe("2022-06-28");
    expect(out[0]).toMatchObject({ results: [{ id: "p1" }], nextCursor: "c2", hasMore: true });
  });
  it("create_page nests parent.database_id", async () => {
    const m = stubGoogle(() => ({ body: { id: "page1" } }));
    await notionApp.modules.create_page.run({}, { databaseId: "DB1", properties: { Name: { title: [] } } }, ctx());
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body).parent).toEqual({ database_id: "DB1" });
  });
  it("testConnection uses users/me", async () => {
    stubGoogle(() => ({ body: { name: "Cyflow" } }));
    expect((await notionApp.testConnection!({ token: "x" })).message).toContain("Cyflow");
  });
});

describe("Airtable (mocked)", () => {
  const ctx = () => makeCtx({ token: "pat_x" });
  it("list_records builds the query URL", async () => {
    const m = stubGoogle(() => ({ body: { records: [{ id: "rec1" }], offset: "off2" } }));
    const out = await airtableApp.modules.list_records.run({}, { baseId: "app1", tableId: "Table 1", maxRecords: 5 }, ctx());
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.pathname).toContain("/app1/Table%201");
    expect(url.searchParams.get("maxRecords")).toBe("5");
    expect(out[0]).toMatchObject({ records: [{ id: "rec1" }], offset: "off2" });
  });
  it("create_record wraps fields", async () => {
    const m = stubGoogle(() => ({ body: { id: "rec9" } }));
    await airtableApp.modules.create_record.run({}, { baseId: "app1", tableId: "T", fields: { Name: "Ada" } }, ctx());
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ fields: { Name: "Ada" } });
  });
});

describe("GitHub (mocked)", () => {
  const ctx = () => makeCtx({ token: "ghp_x" });
  it("create_issue posts a title/body with a Bearer token", async () => {
    const m = stubGoogle(() => ({ body: { number: 5, html_url: "http://gh/5" } }));
    await githubApp.modules.create_issue.run({}, { owner: "o", repo: "r", title: "Bug", body: "desc", labels: ["bug"] }, ctx());
    expect(m.mock.calls[0][0]).toContain("/repos/o/r/issues");
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers.authorization).toBe("Bearer ghp_x");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toMatchObject({ title: "Bug", body: "desc", labels: ["bug"] });
  });
  it("list_issues defaults to open + returns a count", async () => {
    const m = stubGoogle(() => ({ body: [{ id: 1 }, { id: 2 }] }));
    const out = await githubApp.modules.list_issues.run({}, { owner: "o", repo: "r" }, ctx());
    expect(new URL(m.mock.calls[0][0] as string).searchParams.get("state")).toBe("open");
    expect(out[0]).toMatchObject({ count: 2 });
  });
  it("surfaces GitHub errors", async () => {
    stubGoogle(() => ({ ok: false, status: 404, body: { message: "Not Found" } }));
    await expect(githubApp.modules.get_repo.run({}, { owner: "o", repo: "nope" }, ctx())).rejects.toThrow(/Not Found/);
  });
  it("testConnection reports the login", async () => {
    stubGoogle(() => ({ body: { login: "ada" } }));
    expect((await githubApp.testConnection!({ token: "x" })).message).toContain("ada");
  });
});

describe("GitLab (mocked)", () => {
  const ctx = () => makeCtx({ token: "glpat" });
  it("create_issue uses PRIVATE-TOKEN + query body", async () => {
    const m = stubGoogle(() => ({ body: { iid: 3, web_url: "http://gl/3" } }));
    await gitlabApp.modules.create_issue.run({}, { projectId: "group/app", title: "Bug" }, ctx());
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.pathname).toContain("/projects/group%2Fapp/issues");
    expect(url.searchParams.get("title")).toBe("Bug");
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers["private-token"]).toBe("glpat");
  });
  it("testConnection reports the username", async () => {
    stubGoogle(() => ({ body: { username: "ada" } }));
    expect((await gitlabApp.testConnection!({ token: "x" })).message).toContain("ada");
  });
});

describe("Dropbox (mocked)", () => {
  const ctx = () => makeCtx({ token: "dbx" });
  it("list_folder normalises the root path", async () => {
    const m = stubGoogle(() => ({ body: { entries: [{ name: "a" }], cursor: "c", has_more: false } }));
    const out = await dropboxApp.modules.list_folder.run({}, { path: "/" }, ctx());
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ path: "" });
    expect(out[0]).toMatchObject({ entries: [{ name: "a" }], hasMore: false });
  });
  it("upload_file sends octet-stream + Dropbox-API-Arg", async () => {
    const m = stubGoogle(() => ({ body: { id: "id1", name: "n.txt" } }));
    await dropboxApp.modules.upload_file.run({}, { path: "/n.txt", content: "hello" }, ctx());
    const init = m.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers["content-type"]).toBe("application/octet-stream");
    expect(JSON.parse(init.headers["dropbox-api-arg"]).path).toBe("/n.txt");
    expect(init.body).toBe("hello");
  });
});

describe("Cloudflare (mocked)", () => {
  const ctx = () => makeCtx({ token: "cf" });
  it("create_dns_record unwraps result + defaults ttl", async () => {
    const m = stubGoogle(() => ({ body: { success: true, result: { id: "rec1", name: "a.example.com" } } }));
    const out = await cloudflareApp.modules.create_dns_record.run({}, { zoneId: "Z1", type: "A", name: "a.example.com", content: "1.2.3.4" }, ctx());
    expect(m.mock.calls[0][0]).toContain("/zones/Z1/dns_records");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toMatchObject({ type: "A", content: "1.2.3.4", ttl: 1 });
    expect(out[0]).toEqual({ id: "rec1", name: "a.example.com" });
  });
  it("purge_cache purges everything when no files given", async () => {
    const m = stubGoogle(() => ({ body: { success: true, result: { id: "p1" } } }));
    await cloudflareApp.modules.purge_cache.run({}, { zoneId: "Z1" }, ctx());
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ purge_everything: true });
  });
  it("surfaces Cloudflare errors[]", async () => {
    stubGoogle(() => ({ ok: false, status: 400, body: { success: false, errors: [{ code: 1004, message: "DNS Validation Error" }] } }));
    await expect(cloudflareApp.modules.list_zones.run({}, {}, ctx())).rejects.toThrow(/DNS Validation Error/);
  });
});

describe("Supabase (mocked)", () => {
  const ctx = () => makeCtx({ projectUrl: "https://abc.supabase.co", serviceKey: "svc" });
  it("select builds a PostgREST URL with apikey + Bearer", async () => {
    const m = stubGoogle(() => ({ body: [{ id: 1 }, { id: 2 }] }));
    const out = await supabaseApp.modules.select.run({}, { table: "users", select: "id,name", filter: "status=eq.active", limit: 10 }, ctx());
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.origin).toBe("https://abc.supabase.co");
    expect(url.pathname).toBe("/rest/v1/users");
    expect(url.searchParams.get("select")).toBe("id,name");
    expect(url.searchParams.get("status")).toBe("eq.active");
    const headers = (m.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers.apikey).toBe("svc");
    expect(headers.authorization).toBe("Bearer svc");
    expect(out[0]).toMatchObject({ count: 2 });
  });
  it("insert sends Prefer: return=representation", async () => {
    const m = stubGoogle(() => ({ body: [{ id: 9 }] }));
    await supabaseApp.modules.insert.run({}, { table: "users", rows: { name: "Ada" } }, ctx());
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers.prefer).toBe("return=representation");
  });
});

describe("Trello (mocked)", () => {
  const ctx = () => makeCtx({ apiKey: "K", token: "T" });
  it("create_card passes key+token+idList as query", async () => {
    const m = stubGoogle(() => ({ body: { id: "c1", name: "Do" } }));
    await trelloApp.modules.create_card.run({}, { listId: "L1", name: "Do" }, ctx());
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.searchParams.get("key")).toBe("K");
    expect(url.searchParams.get("token")).toBe("T");
    expect(url.searchParams.get("idList")).toBe("L1");
    expect(url.searchParams.get("name")).toBe("Do");
  });
  it("testConnection reports the username", async () => {
    stubGoogle(() => ({ body: { username: "ada" } }));
    expect((await trelloApp.testConnection!({ apiKey: "K", token: "T" })).message).toContain("ada");
  });
});

describe("Asana (mocked)", () => {
  const ctx = () => makeCtx({ token: "asa" });
  it("create_task wraps the body in { data } and unwraps the response", async () => {
    const m = stubGoogle(() => ({ body: { data: { gid: "9", name: "Task" } } }));
    const out = await asanaApp.modules.create_task.run({}, { name: "Task", projects: ["p1"] }, ctx());
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ data: { name: "Task", projects: ["p1"] } });
    expect(out[0]).toEqual({ gid: "9", name: "Task" });
  });
});

describe("HubSpot (mocked)", () => {
  const ctx = () => makeCtx({ token: "hub" });
  it("create_contact posts properties with a Bearer token", async () => {
    const m = stubGoogle(() => ({ body: { id: "1", properties: { email: "a@b.com" } } }));
    await hubspotApp.modules.create_contact.run({}, { properties: { email: "a@b.com" } }, ctx());
    expect(m.mock.calls[0][0]).toContain("/crm/v3/objects/contacts");
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers.authorization).toBe("Bearer hub");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ properties: { email: "a@b.com" } });
  });
  it("search_contacts posts to the search endpoint", async () => {
    const m = stubGoogle(() => ({ body: { results: [{ id: "1" }], total: 1 } }));
    const out = await hubspotApp.modules.search_contacts.run({}, { query: "ada" }, ctx());
    expect(m.mock.calls[0][0]).toContain("/contacts/search");
    expect(out[0]).toMatchObject({ total: 1 });
  });
});

describe("ClickUp (mocked)", () => {
  const ctx = () => makeCtx({ token: "pk_123" });
  it("create_task uses the raw Authorization header (no Bearer)", async () => {
    const m = stubGoogle(() => ({ body: { id: "t1", name: "Do" } }));
    await clickupApp.modules.create_task.run({}, { listId: "L1", name: "Do" }, ctx());
    expect(m.mock.calls[0][0]).toContain("/list/L1/task");
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers.authorization).toBe("pk_123");
  });
  it("testConnection reports the username", async () => {
    stubGoogle(() => ({ body: { user: { username: "ada" } } }));
    expect((await clickupApp.testConnection!({ token: "x" })).message).toContain("ada");
  });
});

describe("Calendly (mocked)", () => {
  const ctx = () => makeCtx({ token: "cal" });
  it("list_events passes the user + count and unwraps the collection", async () => {
    const m = stubGoogle(() => ({ body: { collection: [{ uri: "e1" }], pagination: { next_page_token: "n2" } } }));
    const out = await calendlyApp.modules.list_events.run({}, { user: "https://api.calendly.com/users/ME" }, ctx());
    expect(new URL(m.mock.calls[0][0] as string).searchParams.get("user")).toBe("https://api.calendly.com/users/ME");
    expect(out[0]).toMatchObject({ events: [{ uri: "e1" }], nextPageToken: "n2" });
  });
});

describe("Twilio (mocked)", () => {
  const ctx = () => makeCtx({ accountSid: "ACxxx", authToken: "tok" });
  it("send_sms posts form-encoded with Basic auth", async () => {
    const m = stubGoogle(() => ({ body: { sid: "SM1", status: "queued" } }));
    const out = await twilioApp.modules.send_sms.run({}, { from: "+1", to: "+2", body: "hi" }, ctx());
    expect(m.mock.calls[0][0]).toContain("/Accounts/ACxxx/Messages.json");
    const init = m.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from("ACxxx:tok").toString("base64")}`);
    expect(new URLSearchParams(init.body).get("Body")).toBe("hi");
    expect(out[0]).toEqual({ sid: "SM1", status: "queued" });
  });
});

describe("Stripe (mocked)", () => {
  const ctx = () => makeCtx({ token: "sk_test" });
  it("create_customer posts form-encoded with a Bearer key", async () => {
    const m = stubGoogle(() => ({ body: { id: "cus_1", email: "a@b.com" } }));
    await stripeApp.modules.create_customer.run({}, { email: "a@b.com", name: "Ada" }, ctx());
    const init = m.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers.authorization).toBe("Bearer sk_test");
    expect(init.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(init.body).get("email")).toBe("a@b.com");
  });
  it("create_payment_intent sends amount + currency", async () => {
    const m = stubGoogle(() => ({ body: { id: "pi_1" } }));
    await stripeApp.modules.create_payment_intent.run({}, { amount: 1500, currency: "usd" }, ctx());
    const form = new URLSearchParams((m.mock.calls[0][1] as { body: string }).body);
    expect(form.get("amount")).toBe("1500");
    expect(form.get("currency")).toBe("usd");
  });
});

describe("Shopify (mocked)", () => {
  it("normalises the shop domain + sends the access token header", async () => {
    const m = stubGoogle(() => ({ body: { products: [{ id: 1 }] } }));
    const out = await shopifyApp.modules.list_products.run({}, { limit: 10 }, makeCtx({ shop: "mystore", accessToken: "shpat_x" }));
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.host).toBe("mystore.myshopify.com");
    expect(url.pathname).toBe("/admin/api/2024-01/products.json");
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers["x-shopify-access-token"]).toBe("shpat_x");
    expect(out[0]).toMatchObject({ products: [{ id: 1 }] });
  });
});

describe("WooCommerce (mocked)", () => {
  it("list_products uses the store URL + Basic auth", async () => {
    const m = stubGoogle(() => ({ body: [{ id: 1 }, { id: 2 }] }));
    const out = await woocommerceApp.modules.list_products.run({}, { perPage: 5 }, makeCtx({ storeUrl: "https://shop.example", consumerKey: "ck", consumerSecret: "cs" }));
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://shop.example/wp-json/wc/v3/products");
    expect(url.searchParams.get("per_page")).toBe("5");
    expect((m.mock.calls[0][1] as { headers: Record<string, string> }).headers.authorization).toBe(`Basic ${Buffer.from("ck:cs").toString("base64")}`);
    expect(out[0]).toMatchObject({ products: [{ id: 1 }, { id: 2 }] });
  });
});

describe("RSS", () => {
  const SAMPLE = `<?xml version="1.0"?><rss><channel><title>My Feed</title>
    <item><title><![CDATA[First & Best]]></title><link>https://ex.com/1</link><description>Hello</description><pubDate>Mon, 06 Jul 2026</pubDate><guid>g1</guid></item>
    <item><title>Second</title><link>https://ex.com/2</link></item>
  </channel></rss>`;
  it("parseFeed extracts channel title + items (CDATA + entities)", () => {
    const feed = parseFeed(SAMPLE);
    expect(feed.title).toBe("My Feed");
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({ title: "First & Best", link: "https://ex.com/1", guid: "g1" });
  });
  it("parses Atom <entry> with href links", () => {
    const atom = `<feed><title>Atom</title><entry><title>A</title><link href="https://a.com/x"/><summary>S</summary><id>id1</id></entry></feed>`;
    const feed = parseFeed(atom);
    expect(feed.items[0]).toMatchObject({ title: "A", link: "https://a.com/x", description: "S", guid: "id1" });
  });
  it("read_feed fetches + honours the limit", async () => {
    stubGoogle(() => ({ text: SAMPLE }));
    const out = await rssApp.modules.read_feed.run({}, { url: "https://ex.com/feed", limit: 1 }, makeCtx({}));
    expect(out[0]).toMatchObject({ title: "My Feed", count: 1 });
  });
});

describe("WhatsApp Cloud API (mocked)", () => {
  const ctx = () => makeCtx({ accessToken: "EAAG", phoneNumberId: "PID" });
  it("send_message posts a text payload to the phone number ID", async () => {
    const m = stubGoogle(() => ({ body: { messages: [{ id: "wamid.1" }] } }));
    const out = await whatsappApp.modules.send_message.run({}, { to: "1555", body: "hi" }, ctx());
    expect(m.mock.calls[0][0]).toContain("/PID/messages");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toMatchObject({ messaging_product: "whatsapp", to: "1555", type: "text", text: { body: "hi" } });
    expect(out[0]).toMatchObject({ messageId: "wamid.1", to: "1555" });
  });
});

describe("X / Twitter (mocked)", () => {
  const ctx = () => makeCtx({ token: "bearer" });
  it("post_tweet posts text and unwraps data", async () => {
    const m = stubGoogle(() => ({ body: { data: { id: "t1", text: "gm" } } }));
    const out = await twitterApp.modules.post_tweet.run({}, { text: "gm" }, ctx());
    expect(m.mock.calls[0][0]).toContain("/2/tweets");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toEqual({ text: "gm" });
    expect(out[0]).toEqual({ id: "t1", text: "gm" });
  });
  it("search_recent passes the query + max_results", async () => {
    const m = stubGoogle(() => ({ body: { data: [{ id: "1" }], meta: { result_count: 1 } } }));
    const out = await twitterApp.modules.search_recent.run({}, { query: "#cyflow", maxResults: 25 }, ctx());
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.searchParams.get("query")).toBe("#cyflow");
    expect(url.searchParams.get("max_results")).toBe("25");
    expect(out[0]).toMatchObject({ resultCount: 1 });
  });
});

describe("Google Contacts (mocked)", () => {
  it("list_contacts requests personFields + unwraps connections", async () => {
    const m = stubGoogle(() => ({ body: { connections: [{ resourceName: "people/1" }], nextPageToken: "n", totalPeople: 1 } }));
    const out = await googleContactsApp.modules.list_contacts.run({}, {}, gctx());
    expect(new URL(m.mock.calls[0][0] as string).searchParams.get("personFields")).toContain("emailAddresses");
    expect(out[0]).toMatchObject({ contacts: [{ resourceName: "people/1" }], total: 1 });
  });
  it("create_contact builds names/emails/phones", async () => {
    const m = stubGoogle(() => ({ body: { resourceName: "people/9" } }));
    await googleContactsApp.modules.create_contact.run({}, { givenName: "Ada", email: "a@b.com" }, gctx());
    const body = JSON.parse((m.mock.calls[0][1] as { body: string }).body);
    expect(body.names[0].givenName).toBe("Ada");
    expect(body.emailAddresses[0].value).toBe("a@b.com");
  });
});

describe("Google Tasks (mocked)", () => {
  it("create_task posts to the list", async () => {
    const m = stubGoogle(() => ({ body: { id: "t1", title: "Do" } }));
    await googleTasksApp.modules.create_task.run({}, { tasklist: "L1", title: "Do", due: "2026-07-08T00:00:00Z" }, gctx());
    expect(m.mock.calls[0][0]).toContain("/lists/L1/tasks");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body)).toMatchObject({ title: "Do", due: "2026-07-08T00:00:00Z" });
  });
});

describe("YouTube (mocked)", () => {
  it("search requests part=snippet + query", async () => {
    const m = stubGoogle(() => ({ body: { items: [{ id: { videoId: "v1" } }], nextPageToken: "n" } }));
    const out = await youtubeApp.modules.search.run({}, { query: "cyflow demo", maxResults: 5 }, gctx());
    const url = new URL(m.mock.calls[0][0] as string);
    expect(url.searchParams.get("part")).toBe("snippet");
    expect(url.searchParams.get("q")).toBe("cyflow demo");
    expect(url.searchParams.get("type")).toBe("video");
    expect(out[0]).toMatchObject({ items: [{ id: { videoId: "v1" } }], nextPageToken: "n" });
  });
});

describe("OpenAI expansion (mocked)", () => {
  const ctx = () => makeCtx({ token: "sk" });
  it("create_embedding returns the first vector", async () => {
    const m = stubGoogle(() => ({ body: { data: [{ embedding: [0.1, 0.2] }], model: "text-embedding-3-small" } }));
    const out = await openaiApp.modules.create_embedding.run({}, { input: "hi" }, ctx());
    expect(m.mock.calls[0][0]).toContain("/embeddings");
    expect(out[0]).toMatchObject({ embedding: [0.1, 0.2] });
  });
  it("generate_image posts a prompt", async () => {
    const m = stubGoogle(() => ({ body: { data: [{ url: "http://img/1" }] } }));
    const out = await openaiApp.modules.generate_image.run({}, { prompt: "a cat" }, ctx());
    expect(m.mock.calls[0][0]).toContain("/images/generations");
    expect(JSON.parse((m.mock.calls[0][1] as { body: string }).body).prompt).toBe("a cat");
    expect(out[0]).toMatchObject({ images: [{ url: "http://img/1" }] });
  });
  it("list_models lists models", async () => {
    stubGoogle(() => ({ body: { data: [{ id: "gpt-4o" }] } }));
    const out = await openaiApp.modules.list_models.run({}, {}, ctx());
    expect(out[0]).toMatchObject({ models: [{ id: "gpt-4o" }] });
  });
});

describe("Slack expansion (mocked)", () => {
  const ctx = () => makeCtx({ token: "xoxb" });
  it("list_channels calls conversations.list", async () => {
    const m = stubGoogle(() => ({ body: { ok: true, channels: [{ id: "C1" }] } }));
    const out = await slackApp.modules.list_channels.run({}, {}, ctx());
    expect(m.mock.calls[0][0]).toContain("conversations.list");
    expect(out[0]).toMatchObject({ channels: [{ id: "C1" }] });
  });
  it("delete_message calls chat.delete", async () => {
    const m = stubGoogle(() => ({ body: { ok: true, channel: "C1", ts: "1.2" } }));
    await slackApp.modules.delete_message.run({}, { channel: "C1", ts: "1.2" }, ctx());
    expect(m.mock.calls[0][0]).toContain("chat.delete");
  });
  it("throws on a Slack { ok:false } response", async () => {
    stubGoogle(() => ({ body: { ok: false, error: "channel_not_found" } }));
    await expect(slackApp.modules.get_channel_info.run({}, { channel: "bad" }, ctx())).rejects.toThrow(/channel_not_found/);
  });
});

describe("JSON / CSV utilities (pure)", () => {
  const ctx = makeCtx(null);

  it("parse_json parses text into a value", async () => {
    const out = await utilsApp.modules.parse_json.run({}, { text: '{"a":1,"b":[2,3]}' }, ctx);
    expect(out).toEqual([{ value: { a: 1, b: [2, 3] } }]);
  });

  it("parse_json throws a clear error on invalid JSON", async () => {
    await expect(utilsApp.modules.parse_json.run({}, { text: "{oops" }, ctx)).rejects.toThrow(/Parse JSON failed/);
  });

  it("to_json stringifies (compact + pretty)", async () => {
    expect((await utilsApp.modules.to_json.run({}, { value: { a: 1 } }, ctx))[0]).toEqual({ text: '{"a":1}' });
    expect((await utilsApp.modules.to_json.run({}, { value: { a: 1 }, pretty: true }, ctx))[0]).toEqual({ text: '{\n  "a": 1\n}' });
  });

  it("parseCsv handles quotes, escaped quotes and embedded delimiters", () => {
    expect(parseCsv('a,b\n"x,y","he said ""hi"""')).toEqual([["a", "b"], ["x,y", 'he said "hi"']]);
  });

  it("parse_csv with header returns objects", async () => {
    const out = await utilsApp.modules.parse_csv.run({}, { text: "name,score\nAda,42\nGrace,7", header: true }, ctx);
    expect(out[0]).toEqual({ rows: [{ name: "Ada", score: "42" }, { name: "Grace", score: "7" }], count: 2 });
  });

  it("to_csv serializes objects with a header row and quoting", () => {
    expect(toCsv([{ a: "1", b: "x,y" }, { a: "2", b: "z" }])).toBe('a,b\n1,"x,y"\n2,z');
  });

  it("round-trips CSV → rows → CSV", async () => {
    const csv = "name,city\nAda,London\nGrace,NYC";
    const parsed = await utilsApp.modules.parse_csv.run({}, { text: csv, header: true }, ctx);
    const back = await utilsApp.modules.to_csv.run({}, { rows: (parsed[0] as { rows: unknown[] }).rows }, ctx);
    expect((back[0] as { text: string }).text).toBe(csv);
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
