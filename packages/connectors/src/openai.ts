import { z } from "zod";
import type { App, TestConnectionResult } from "engine";
import type { Bundle, OperationRunner } from "@cyflow/shared";
import { requireCredential, postJson } from "./util";

/** Validate an OpenAI API key with a cheap GET /models call. */
async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing API key." };
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) return { ok: true, message: "API key valid" };
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, message: json.error?.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

/** OpenAI — Create a chat completion. Auth: bearer_token (API key). */
const createCompletion: OperationRunner = async (_input, params, ctx) => {
  const token = requireCredential(ctx, ["token", "apiKey"], "OpenAI");
  const p = params as { model?: unknown; prompt?: unknown; messages?: unknown };

  const messages = Array.isArray(p.messages)
    ? (p.messages as unknown[])
    : [{ role: "user", content: String(p.prompt ?? "") }];

  const { ok, status, json } = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { model: p.model ?? "gpt-4o-mini", messages },
    { authorization: `Bearer ${token}` },
  );
  if (!ok) {
    const error = json.error as { message?: string } | undefined;
    throw new Error(`OpenAI error: ${error?.message ?? status}`);
  }
  const choices = json.choices as Array<{ message?: { content?: string } }> | undefined;
  return [
    {
      content: choices?.[0]?.message?.content ?? "",
      model: json.model,
      usage: json.usage,
    } satisfies Bundle,
  ];
};

export const openaiApp: App = {
  key: "openai",
  name: "OpenAI",
  auth: {
    type: "bearer_token",
    fields: [{ key: "token", label: "API key", type: "password", required: true }],
  },
  modules: {
    create_completion: {
      key: "create_completion",
      name: "Create a chat completion",
      kind: "action",
      params: z.object({
        model: z.string().optional(),
        prompt: z.string().optional(),
        messages: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
      }),
      run: createCompletion,
    },
  },
  testConnection,
};
