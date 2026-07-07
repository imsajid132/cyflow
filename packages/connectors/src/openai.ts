import { z } from "zod";
import type { App, TestConnectionResult } from "engine";
import type { Bundle, OperationRunner } from "@cyflow/shared";
import { requireCredential, postJson, apiJson, compact } from "./util";

const OA = "https://api.openai.com/v1";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const oaKey = (ctx: Parameters<OperationRunner>[2]) => requireCredential(ctx, ["token", "apiKey"], "OpenAI");

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
    create_embedding: {
      key: "create_embedding",
      name: "Create an embedding",
      kind: "action",
      params: z.object({ input: z.string(), model: z.string().optional() }),
      run: async (_i, params, ctx) => {
        const p = params as { input: string; model?: string };
        const json = await apiJson<{ data?: { embedding: number[] }[]; model?: string; usage?: unknown }>({ method: "POST", url: `${OA}/embeddings`, headers: bearer(oaKey(ctx)), body: { model: p.model ?? "text-embedding-3-small", input: p.input } });
        return [{ embedding: json.data?.[0]?.embedding ?? [], model: json.model, usage: json.usage } as Bundle];
      },
    },
    generate_image: {
      key: "generate_image",
      name: "Generate an image",
      kind: "action",
      params: z.object({ prompt: z.string(), model: z.string().optional(), size: z.string().optional(), n: z.number().optional() }),
      run: async (_i, params, ctx) => {
        const p = params as { prompt: string; model?: string; size?: string; n?: number };
        const json = await apiJson<{ data?: { url?: string; b64_json?: string }[] }>({ method: "POST", url: `${OA}/images/generations`, headers: bearer(oaKey(ctx)), body: compact({ model: p.model ?? "dall-e-3", prompt: p.prompt, size: p.size ?? "1024x1024", n: p.n ?? 1 }) });
        return [{ images: json.data ?? [] } as Bundle];
      },
    },
    moderation: {
      key: "moderation",
      name: "Moderate content",
      kind: "action",
      params: z.object({ input: z.string(), model: z.string().optional() }),
      run: async (_i, params, ctx) => {
        const p = params as { input: string; model?: string };
        const json = await apiJson<{ results?: { flagged?: boolean }[] }>({ method: "POST", url: `${OA}/moderations`, headers: bearer(oaKey(ctx)), body: compact({ model: p.model, input: p.input }) });
        return [{ results: json.results ?? [], flagged: json.results?.[0]?.flagged ?? false } as Bundle];
      },
    },
    list_models: {
      key: "list_models",
      name: "List models",
      kind: "search",
      params: z.object({}),
      run: async (_i, _p, ctx) => {
        const json = await apiJson<{ data?: unknown[] }>({ method: "GET", url: `${OA}/models`, headers: bearer(oaKey(ctx)) });
        return [{ models: json.data ?? [] } as Bundle];
      },
    },
    transcribe_audio: {
      key: "transcribe_audio",
      name: "Transcribe audio (Whisper)",
      kind: "action",
      params: z.object({ base64: z.string(), filename: z.string().optional(), model: z.string().optional(), language: z.string().optional() }),
      run: async (_i, params, ctx) => {
        const p = params as { base64: string; filename?: string; model?: string; language?: string };
        const form = new FormData();
        form.append("file", new Blob([Buffer.from(p.base64, "base64")]), p.filename ?? "audio.mp3");
        form.append("model", p.model ?? "whisper-1");
        if (p.language) form.append("language", p.language);
        const res = await fetch(`${OA}/audio/transcriptions`, { method: "POST", headers: bearer(oaKey(ctx)), body: form });
        const json = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
        if (!res.ok) throw new Error(`OpenAI error: ${json.error?.message ?? res.status}`);
        return [{ text: json.text ?? "" } as Bundle];
      },
    },
    text_to_speech: {
      key: "text_to_speech",
      name: "Text to speech",
      kind: "action",
      params: z.object({ input: z.string(), voice: z.string().optional(), model: z.string().optional(), format: z.string().optional() }),
      run: async (_i, params, ctx) => {
        const p = params as { input: string; voice?: string; model?: string; format?: string };
        const format = p.format ?? "mp3";
        const res = await fetch(`${OA}/audio/speech`, {
          method: "POST",
          headers: { ...bearer(oaKey(ctx)), "content-type": "application/json" },
          body: JSON.stringify(compact({ model: p.model ?? "tts-1", voice: p.voice ?? "alloy", input: p.input, response_format: format })),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(`OpenAI error: ${j.error?.message ?? res.status}`);
        }
        const audioBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");
        return [{ audioBase64, format } as Bundle];
      },
    },
  },
  testConnection,
};
