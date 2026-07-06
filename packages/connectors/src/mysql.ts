import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { requireCredential } from "./util";

/** MySQL connector (production). Auth: connection string (mysql://). Driver: mysql2 (lazy). */

const conn = (ctx: ExecutionContext) => requireCredential(ctx, ["connectionString", "url"], "MySQL");

async function mysqlQuery(uri: string, sql: string, values?: unknown[]): Promise<unknown> {
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection(uri);
  try {
    const [rows] = await connection.execute(sql, (values ?? []) as never);
    return rows;
  } finally {
    await connection.end();
  }
}

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const cs = (credentials.connectionString ?? credentials.url) as string | undefined;
  if (!cs) return { ok: false, message: "Missing connection string." };
  try {
    await mysqlQuery(cs, "SELECT 1");
    return { ok: true, message: "Connected to MySQL" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const mysqlApp: App = {
  key: "mysql",
  name: "MySQL",
  auth: { type: "custom", fields: [{ key: "connectionString", label: "Connection string", type: "password", required: true }] },
  modules: {
    query: m("query", "Run a query", "search", z.object({ sql: z.string(), values: z.array(z.any()).optional() }), async (_i, p, ctx) => {
      const q = p as { sql: string; values?: unknown[] };
      const rows = await mysqlQuery(conn(ctx), q.sql, q.values);
      return [{ rows: Array.isArray(rows) ? rows : rows, rowCount: Array.isArray(rows) ? rows.length : undefined } as Bundle];
    }),
    insert: m("insert", "Insert a row", "action", z.object({ table: z.string(), row: z.any() }), async (_i, p, ctx) => {
      const q = p as { table: string; row: Record<string, unknown> };
      const cols = Object.keys(q.row);
      const sql = `INSERT INTO \`${q.table}\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      const res = (await mysqlQuery(conn(ctx), sql, Object.values(q.row))) as { insertId?: number; affectedRows?: number };
      return [{ insertId: res.insertId, affectedRows: res.affectedRows } as Bundle];
    }),
  },
  testConnection,
};
