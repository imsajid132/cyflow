import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, compact, requireCredential } from "./util";

/** Notion connector (production). Auth: internal integration token (bearer). */

const BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const headers = (token: string) => ({ authorization: `Bearer ${token}`, "notion-version": NOTION_VERSION });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "Notion");

function m(key: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = typeof credentials.token === "string" ? credentials.token : "";
  if (!token) return { ok: false, message: "Missing integration token." };
  try {
    const me = await apiJson<{ name?: string; bot?: { owner?: unknown } }>({ method: "GET", url: `${BASE}/users/me`, headers: headers(token) });
    return { ok: true, message: `Connected as ${me.name ?? "Notion integration"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const notionApp: App = {
  key: "notion",
  name: "Notion",
  auth: { type: "api_key", fields: [{ key: "token", label: "Integration token", type: "password", required: true }] },
  modules: {
    query_database: m("query_database", "Query a database", "search", z.object({ databaseId: z.string(), filter: z.any().optional(), sorts: z.array(z.any()).optional(), pageSize: z.number().optional(), startCursor: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { databaseId: string; filter?: unknown; sorts?: unknown[]; pageSize?: number; startCursor?: string };
      const json = await apiJson<{ results?: unknown[]; next_cursor?: string; has_more?: boolean }>({
        method: "POST",
        url: `${BASE}/databases/${q.databaseId}/query`,
        headers: headers(tok(ctx)),
        body: compact({ filter: q.filter, sorts: q.sorts, page_size: q.pageSize ?? 100, start_cursor: q.startCursor }),
      });
      return [{ results: json.results ?? [], nextCursor: json.next_cursor, hasMore: json.has_more ?? false } as Bundle];
    }),
    get_page: m("get_page", "Get a page", "search", z.object({ pageId: z.string() }), async (_i, p, ctx) => {
      const { pageId } = p as { pageId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/pages/${pageId}`, headers: headers(tok(ctx)) })];
    }),
    create_page: m("create_page", "Create a page", "action", z.object({ databaseId: z.string(), properties: z.any(), children: z.array(z.any()).optional() }), async (_i, p, ctx) => {
      const q = p as { databaseId: string; properties: unknown; children?: unknown[] };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/pages`, headers: headers(tok(ctx)), body: compact({ parent: { database_id: q.databaseId }, properties: q.properties, children: q.children }) })];
    }),
    update_page: m("update_page", "Update a page", "action", z.object({ pageId: z.string(), properties: z.any(), archived: z.boolean().optional() }), async (_i, p, ctx) => {
      const q = p as { pageId: string; properties: unknown; archived?: boolean };
      return [await apiJson<Bundle>({ method: "PATCH", url: `${BASE}/pages/${q.pageId}`, headers: headers(tok(ctx)), body: compact({ properties: q.properties, archived: q.archived }) })];
    }),
    search: m("search", "Search", "search", z.object({ query: z.string().optional(), pageSize: z.number().optional(), startCursor: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { query?: string; pageSize?: number; startCursor?: string };
      const json = await apiJson<{ results?: unknown[]; next_cursor?: string }>({ method: "POST", url: `${BASE}/search`, headers: headers(tok(ctx)), body: compact({ query: q.query, page_size: q.pageSize ?? 100, start_cursor: q.startCursor }) });
      return [{ results: json.results ?? [], nextCursor: json.next_cursor } as Bundle];
    }),
    get_block_children: m("get_block_children", "Get block children", "search", z.object({ blockId: z.string(), pageSize: z.number().optional(), startCursor: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { blockId: string; pageSize?: number; startCursor?: string };
      const json = await apiJson<{ results?: unknown[]; next_cursor?: string }>({ method: "GET", url: buildUrl(`${BASE}/blocks/${q.blockId}/children`, { page_size: q.pageSize ?? 100, start_cursor: q.startCursor }), headers: headers(tok(ctx)) });
      return [{ results: json.results ?? [], nextCursor: json.next_cursor } as Bundle];
    }),
  },
  testConnection,
};
