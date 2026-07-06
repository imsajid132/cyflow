import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** WhatsApp Cloud API connector (production). Auth: Meta access token + phone number ID. */

const GRAPH = "https://graph.facebook.com/v18.0";
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["accessToken", "token"], "WhatsApp");
const phoneId = (ctx: ExecutionContext) => requireCredential(ctx, ["phoneNumberId"], "WhatsApp");
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = credentials.accessToken as string | undefined;
  const id = credentials.phoneNumberId as string | undefined;
  if (!token || !id) return { ok: false, message: "Missing access token or phone number ID." };
  try {
    const json = await apiJson<{ display_phone_number?: string }>({ method: "GET", url: buildUrl(`${GRAPH}/${id}`, { fields: "display_phone_number,verified_name" }), headers: bearer(token) });
    return { ok: true, message: `Connected: ${json.display_phone_number ?? id}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const whatsappApp: App = {
  key: "whatsapp",
  name: "WhatsApp",
  auth: {
    type: "custom",
    fields: [
      { key: "accessToken", label: "Access token", type: "password", required: true },
      { key: "phoneNumberId", label: "Phone number ID", type: "text", required: true },
    ],
  },
  modules: {
    send_message: m("send_message", "Send a text message", "action", z.object({ to: z.string(), body: z.string(), previewUrl: z.boolean().optional() }), async (_i, p, ctx) => {
      const q = p as { to: string; body: string; previewUrl?: boolean };
      const json = await apiJson<{ messages?: { id: string }[] }>({
        method: "POST",
        url: `${GRAPH}/${phoneId(ctx)}/messages`,
        headers: bearer(tok(ctx)),
        body: { messaging_product: "whatsapp", to: q.to, type: "text", text: { body: q.body, preview_url: q.previewUrl ?? false } },
      });
      return [{ messageId: json.messages?.[0]?.id, to: q.to } as Bundle];
    }),
    send_template: m("send_template", "Send a template message", "action", z.object({ to: z.string(), templateName: z.string(), languageCode: z.string().optional(), components: z.array(z.any()).optional() }), async (_i, p, ctx) => {
      const q = p as { to: string; templateName: string; languageCode?: string; components?: unknown[] };
      const template: Record<string, unknown> = { name: q.templateName, language: { code: q.languageCode ?? "en_US" } };
      if (q.components) template.components = q.components;
      const json = await apiJson<{ messages?: { id: string }[] }>({ method: "POST", url: `${GRAPH}/${phoneId(ctx)}/messages`, headers: bearer(tok(ctx)), body: { messaging_product: "whatsapp", to: q.to, type: "template", template } });
      return [{ messageId: json.messages?.[0]?.id, to: q.to } as Bundle];
    }),
    mark_read: m("mark_read", "Mark a message as read", "action", z.object({ messageId: z.string() }), async (_i, p, ctx) => {
      const { messageId } = p as { messageId: string };
      await apiJson({ method: "POST", url: `${GRAPH}/${phoneId(ctx)}/messages`, headers: bearer(tok(ctx)), body: { messaging_product: "whatsapp", status: "read", message_id: messageId } });
      return [{ ok: true, messageId } as Bundle];
    }),
  },
  testConnection,
};
