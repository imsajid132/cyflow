import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** Trello connector (production). Auth: API key + token (query params). */

const BASE = "https://api.trello.com/1";
const key = (ctx: ExecutionContext) => requireCredential(ctx, ["apiKey", "key"], "Trello");
const token = (ctx: ExecutionContext) => requireCredential(ctx, ["token"], "Trello");
const auth = (ctx: ExecutionContext, extra: Record<string, unknown> = {}) => ({ key: key(ctx), token: token(ctx), ...extra });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const k = (credentials.apiKey ?? credentials.key) as string | undefined;
  const t = credentials.token as string | undefined;
  if (!k || !t) return { ok: false, message: "Missing API key or token." };
  try {
    const me = await apiJson<{ username?: string }>({ method: "GET", url: buildUrl(`${BASE}/members/me`, { key: k, token: t }) });
    return { ok: true, message: `Connected as ${me.username ?? "Trello user"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const trelloApp: App = {
  key: "trello",
  name: "Trello",
  auth: {
    type: "custom",
    fields: [
      { key: "apiKey", label: "API key", type: "text", required: true },
      { key: "token", label: "Token", type: "password", required: true },
    ],
  },
  modules: {
    get_board: m("get_board", "Get a board", "search", z.object({ boardId: z.string() }), async (_i, p, ctx) => {
      const { boardId } = p as { boardId: string };
      return [await apiJson<Bundle>({ method: "GET", url: buildUrl(`${BASE}/boards/${boardId}`, auth(ctx)) })];
    }),
    list_lists: m("list_lists", "List lists on a board", "search", z.object({ boardId: z.string() }), async (_i, p, ctx) => {
      const { boardId } = p as { boardId: string };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${BASE}/boards/${boardId}/lists`, auth(ctx)) });
      return [{ lists: json } as Bundle];
    }),
    list_cards: m("list_cards", "List cards in a list", "search", z.object({ listId: z.string() }), async (_i, p, ctx) => {
      const { listId } = p as { listId: string };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${BASE}/lists/${listId}/cards`, auth(ctx)) });
      return [{ cards: json } as Bundle];
    }),
    create_card: m("create_card", "Create a card", "action", z.object({ listId: z.string(), name: z.string(), desc: z.string().optional(), pos: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { listId: string; name: string; desc?: string; pos?: string };
      return [await apiJson<Bundle>({ method: "POST", url: buildUrl(`${BASE}/cards`, auth(ctx, { idList: q.listId, name: q.name, desc: q.desc, pos: q.pos })) })];
    }),
    update_card: m("update_card", "Update a card", "action", z.object({ cardId: z.string(), name: z.string().optional(), desc: z.string().optional(), closed: z.boolean().optional() }), async (_i, p, ctx) => {
      const q = p as { cardId: string; name?: string; desc?: string; closed?: boolean };
      return [await apiJson<Bundle>({ method: "PUT", url: buildUrl(`${BASE}/cards/${q.cardId}`, auth(ctx, { name: q.name, desc: q.desc, closed: q.closed })) })];
    }),
    move_card: m("move_card", "Move a card", "action", z.object({ cardId: z.string(), listId: z.string() }), async (_i, p, ctx) => {
      const q = p as { cardId: string; listId: string };
      return [await apiJson<Bundle>({ method: "PUT", url: buildUrl(`${BASE}/cards/${q.cardId}`, auth(ctx, { idList: q.listId })) })];
    }),
    add_comment: m("add_comment", "Comment on a card", "action", z.object({ cardId: z.string(), text: z.string() }), async (_i, p, ctx) => {
      const q = p as { cardId: string; text: string };
      return [await apiJson<Bundle>({ method: "POST", url: buildUrl(`${BASE}/cards/${q.cardId}/actions/comments`, auth(ctx, { text: q.text })) })];
    }),
  },
  testConnection,
};
