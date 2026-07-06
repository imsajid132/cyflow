import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { accessToken, gapi, googleTestConnection, withQuery } from "./google-common";

/** Gmail connector (production). Auth: Google OAuth2 (Phase B). */

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function base64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

interface MimeInput {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}
function buildMime(p: MimeInput): string {
  const lines = [`To: ${p.to}`];
  if (p.cc) lines.push(`Cc: ${p.cc}`);
  if (p.bcc) lines.push(`Bcc: ${p.bcc}`);
  lines.push(`Subject: ${p.subject}`);
  if (p.inReplyTo) lines.push(`In-Reply-To: ${p.inReplyTo}`);
  if (p.references) lines.push(`References: ${p.references}`);
  lines.push("Content-Type: text/plain; charset=UTF-8", "", p.body ?? "");
  return base64Url(lines.join("\r\n"));
}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPayload {
  headers?: GmailHeader[];
  body?: { data?: string };
  parts?: GmailPayload[];
  mimeType?: string;
}
function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}
function extractBody(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  if (Array.isArray(payload.parts)) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeB64Url(plain.body.data);
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return "";
}

const search: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Gmail");
  const p = params as { query?: string; maxResults?: number; pageToken?: string };
  const json = await gapi<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>({
    method: "GET",
    url: withQuery(`${BASE}/messages`, { q: p.query, maxResults: p.maxResults ?? 20, pageToken: p.pageToken }),
    token,
  });
  return [{ messages: json.messages ?? [], nextPageToken: json.nextPageToken, count: (json.messages ?? []).length } as Bundle];
};

const read: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Gmail");
  const p = params as { messageId: string };
  const msg = await gapi<{ id: string; threadId: string; labelIds?: string[]; snippet?: string; payload?: GmailPayload }>({
    method: "GET",
    url: withQuery(`${BASE}/messages/${encodeURIComponent(p.messageId)}`, { format: "full" }),
    token,
  });
  const h = msg.payload?.headers;
  return [
    {
      id: msg.id,
      threadId: msg.threadId,
      labelIds: msg.labelIds ?? [],
      from: headerValue(h, "From"),
      to: headerValue(h, "To"),
      subject: headerValue(h, "Subject"),
      date: headerValue(h, "Date"),
      messageIdHeader: headerValue(h, "Message-Id"),
      snippet: msg.snippet ?? "",
      body: extractBody(msg.payload),
    } as Bundle,
  ];
};

const send: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Gmail");
  const p = params as unknown as MimeInput;
  const json = await gapi<{ id: string; threadId: string }>({
    method: "POST",
    url: `${BASE}/messages/send`,
    token,
    body: { raw: buildMime(p) },
  });
  return [{ id: json.id, threadId: json.threadId, to: p.to, subject: p.subject } as Bundle];
};

const reply: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Gmail");
  const p = params as unknown as MimeInput & { threadId: string };
  const json = await gapi<{ id: string; threadId: string }>({
    method: "POST",
    url: `${BASE}/messages/send`,
    token,
    body: { raw: buildMime(p), threadId: p.threadId },
  });
  return [{ id: json.id, threadId: json.threadId } as Bundle];
};

const createDraft: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Gmail");
  const p = params as unknown as MimeInput;
  const json = await gapi<{ id: string; message?: { id: string } }>({
    method: "POST",
    url: `${BASE}/drafts`,
    token,
    body: { message: { raw: buildMime(p) } },
  });
  return [{ draftId: json.id, messageId: json.message?.id } as Bundle];
};

const listLabels: ModuleDef["run"] = async (_i, _params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Gmail");
  const json = await gapi<{ labels?: { id: string; name: string }[] }>({ method: "GET", url: `${BASE}/labels`, token });
  return [{ labels: json.labels ?? [] } as Bundle];
};

const modifyLabels =
  (add: boolean): ModuleDef["run"] =>
  async (_i, params, ctx: ExecutionContext) => {
    const token = accessToken(ctx, "Gmail");
    const p = params as { messageId: string; labelId: string };
    const json = await gapi<{ id: string; labelIds?: string[] }>({
      method: "POST",
      url: `${BASE}/messages/${encodeURIComponent(p.messageId)}/modify`,
      token,
      body: add ? { addLabelIds: [p.labelId] } : { removeLabelIds: [p.labelId] },
    });
    return [{ id: json.id, labelIds: json.labelIds ?? [] } as Bundle];
  };

const mimeParams = {
  to: z.string(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string(),
  body: z.string(),
};

export const gmailApp: App = {
  key: "gmail",
  name: "Gmail",
  auth: { type: "oauth2" },
  modules: {
    search_emails: { key: "search_emails", name: "Search emails", kind: "search", params: z.object({ query: z.string().optional(), maxResults: z.number().optional(), pageToken: z.string().optional() }), run: search },
    read_email: { key: "read_email", name: "Read an email", kind: "search", params: z.object({ messageId: z.string() }), run: read },
    send_email: { key: "send_email", name: "Send an email", kind: "action", params: z.object(mimeParams), run: send },
    reply_email: { key: "reply_email", name: "Reply to an email", kind: "action", params: z.object({ ...mimeParams, threadId: z.string(), inReplyTo: z.string().optional(), references: z.string().optional() }), run: reply },
    create_draft: { key: "create_draft", name: "Create a draft", kind: "action", params: z.object(mimeParams), run: createDraft },
    list_labels: { key: "list_labels", name: "List labels", kind: "search", params: z.object({}), run: listLabels },
    add_label: { key: "add_label", name: "Add a label", kind: "action", params: z.object({ messageId: z.string(), labelId: z.string() }), run: modifyLabels(true) },
    remove_label: { key: "remove_label", name: "Remove a label", kind: "action", params: z.object({ messageId: z.string(), labelId: z.string() }), run: modifyLabels(false) },
  },
  testConnection: googleTestConnection,
};
