import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { requireCredential } from "./util";

/** PostgreSQL connector (production). Auth: connection string. Driver: pg (lazy). */

const conn = (ctx: ExecutionContext) => requireCredential(ctx, ["connectionString", "url"], "PostgreSQL");

/** Open a connection, run one query, always close. */
async function pgQuery(connectionString: string, sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const res = await client.query(sql, values as never);
    return { rows: res.rows ?? [], rowCount: res.rowCount ?? 0 };
  } finally {
    await client.end();
  }
}

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const cs = (credentials.connectionString ?? credentials.url) as string | undefined;
  if (!cs) return { ok: false, message: "Missing connection string." };
  try {
    await pgQuery(cs, "SELECT 1");
    return { ok: true, message: "Connected to PostgreSQL" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const postgresApp: App = {
  key: "postgres",
  name: "PostgreSQL",
  auth: { type: "custom", fields: [{ key: "connectionString", label: "Connection string", type: "password", required: true }] },
  modules: {
    query: m("query", "Run a query", "search", z.object({ sql: z.string(), values: z.array(z.any()).optional() }), async (_i, p, ctx) => {
      const q = p as { sql: string; values?: unknown[] };
      const { rows, rowCount } = await pgQuery(conn(ctx), q.sql, q.values);
      return [{ rows, rowCount } as Bundle];
    }),
    insert: m("insert", "Insert a row", "action", z.object({ table: z.string(), row: z.any() }), async (_i, p, ctx) => {
      const q = p as { table: string; row: Record<string, unknown> };
      const cols = Object.keys(q.row);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO ${q.table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders}) RETURNING *`;
      const { rows } = await pgQuery(conn(ctx), sql, Object.values(q.row));
      return [(rows[0] ?? {}) as Bundle];
    }),
  },
  testConnection,
};
