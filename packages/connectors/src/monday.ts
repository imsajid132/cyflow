import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { requireCredential } from "./util";

/** Monday.com connector (production, GraphQL). Auth: API token (Authorization header). */

const BASE = "https://api.monday.com/v2";
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "apiKey"], "Monday");

/** Run a GraphQL operation; monday.com returns { data, errors }. */
async function gql(token: string, query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { authorization: token, "content-type": "application/json", "api-version": "2024-01" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: { message?: string }[]; error_message?: string };
  if (json.errors?.length) throw new Error(`Monday error: ${json.errors[0].message}`);
  if (!res.ok) throw new Error(`Monday ${res.status}: ${json.error_message ?? res.statusText}`);
  return json.data ?? {};
}

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = (credentials.token ?? credentials.apiKey) as string | undefined;
  if (!token) return { ok: false, message: "Missing API token." };
  try {
    const data = await gql(token, "{ me { name email } }");
    const me = data.me as { name?: string } | undefined;
    return { ok: true, message: `Connected as ${me?.name ?? "Monday user"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const mondayApp: App = {
  key: "monday",
  name: "monday.com",
  auth: { type: "api_key", fields: [{ key: "token", label: "API token", type: "password", required: true }] },
  modules: {
    run_graphql: m("run_graphql", "Run a GraphQL query", "action", z.object({ query: z.string(), variables: z.any().optional() }), async (_i, p, ctx) => {
      const q = p as { query: string; variables?: Record<string, unknown> };
      return [(await gql(tok(ctx), q.query, q.variables)) as Bundle];
    }),
    list_boards: m("list_boards", "List boards", "search", z.object({ limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { limit?: number };
      const data = await gql(tok(ctx), "query ($limit: Int) { boards(limit: $limit) { id name state board_kind } }", { limit: q.limit ?? 25 });
      return [{ boards: data.boards ?? [] } as Bundle];
    }),
    get_board_items: m("get_board_items", "Get items on a board", "search", z.object({ boardId: z.string(), limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { boardId: string; limit?: number };
      const data = await gql(tok(ctx), "query ($boardId: [ID!], $limit: Int) { boards(ids: $boardId) { items_page(limit: $limit) { items { id name column_values { id text value } } } } }", { boardId: [q.boardId], limit: q.limit ?? 25 });
      const boards = (data.boards as { items_page?: { items?: unknown[] } }[] | undefined) ?? [];
      return [{ items: boards[0]?.items_page?.items ?? [] } as Bundle];
    }),
    create_item: m("create_item", "Create an item", "action", z.object({ boardId: z.string(), itemName: z.string(), columnValues: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { boardId: string; itemName: string; columnValues?: string };
      const data = await gql(tok(ctx), "mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON) { create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id name } }", { boardId: q.boardId, itemName: q.itemName, columnValues: q.columnValues });
      return [(data.create_item ?? {}) as Bundle];
    }),
    create_update: m("create_update", "Post an update", "action", z.object({ itemId: z.string(), body: z.string() }), async (_i, p, ctx) => {
      const q = p as { itemId: string; body: string };
      const data = await gql(tok(ctx), "mutation ($itemId: ID!, $body: String!) { create_update(item_id: $itemId, body: $body) { id } }", { itemId: q.itemId, body: q.body });
      return [(data.create_update ?? {}) as Bundle];
    }),
    change_column_value: m("change_column_value", "Change a column value", "action", z.object({ boardId: z.string(), itemId: z.string(), columnId: z.string(), value: z.string() }), async (_i, p, ctx) => {
      const q = p as { boardId: string; itemId: string; columnId: string; value: string };
      const data = await gql(tok(ctx), "mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) { change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id } }", { boardId: q.boardId, itemId: q.itemId, columnId: q.columnId, value: q.value });
      return [(data.change_column_value ?? {}) as Bundle];
    }),
  },
  testConnection,
};
