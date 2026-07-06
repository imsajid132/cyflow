import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { requireCredential } from "./util";

/** MongoDB connector (production). Auth: URI + database. Driver: mongodb (lazy). */

const uri = (ctx: ExecutionContext) => requireCredential(ctx, ["uri", "connectionString"], "MongoDB");
const database = (ctx: ExecutionContext) => requireCredential(ctx, ["database", "db"], "MongoDB");

/** Open a client, run one operation against a collection, always close. */
async function withCollection<T>(connUri: string, dbName: string, collection: string, fn: (col: import("mongodb").Collection) => Promise<T>): Promise<T> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(connUri);
  await client.connect();
  try {
    return await fn(client.db(dbName).collection(collection));
  } finally {
    await client.close();
  }
}

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const u = (credentials.uri ?? credentials.connectionString) as string | undefined;
  const d = (credentials.database ?? credentials.db) as string | undefined;
  if (!u || !d) return { ok: false, message: "Missing URI or database." };
  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(u);
    await client.connect();
    try {
      await client.db(d).command({ ping: 1 });
    } finally {
      await client.close();
    }
    return { ok: true, message: "Connected to MongoDB" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const mongodbApp: App = {
  key: "mongodb",
  name: "MongoDB",
  auth: {
    type: "custom",
    fields: [
      { key: "uri", label: "Connection URI", type: "password", required: true },
      { key: "database", label: "Database", type: "text", required: true },
    ],
  },
  modules: {
    find: m("find", "Find documents", "search", z.object({ collection: z.string(), filter: z.any().optional(), limit: z.number().optional(), sort: z.any().optional() }), async (_i, p, ctx) => {
      const q = p as { collection: string; filter?: Record<string, unknown>; limit?: number; sort?: Record<string, 1 | -1> };
      const docs = await withCollection(uri(ctx), database(ctx), q.collection, (col) => col.find(q.filter ?? {}).sort(q.sort ?? {}).limit(q.limit ?? 100).toArray());
      return [{ documents: docs, count: docs.length } as Bundle];
    }),
    insert_one: m("insert_one", "Insert a document", "action", z.object({ collection: z.string(), document: z.any() }), async (_i, p, ctx) => {
      const q = p as { collection: string; document: Record<string, unknown> };
      const res = await withCollection(uri(ctx), database(ctx), q.collection, (col) => col.insertOne(q.document));
      return [{ insertedId: String(res.insertedId), acknowledged: res.acknowledged } as Bundle];
    }),
    update_one: m("update_one", "Update a document", "action", z.object({ collection: z.string(), filter: z.any(), update: z.any() }), async (_i, p, ctx) => {
      const q = p as { collection: string; filter: Record<string, unknown>; update: Record<string, unknown> };
      const res = await withCollection(uri(ctx), database(ctx), q.collection, (col) => col.updateOne(q.filter, q.update));
      return [{ matchedCount: res.matchedCount, modifiedCount: res.modifiedCount } as Bundle];
    }),
    delete_one: m("delete_one", "Delete a document", "action", z.object({ collection: z.string(), filter: z.any() }), async (_i, p, ctx) => {
      const q = p as { collection: string; filter: Record<string, unknown> };
      const res = await withCollection(uri(ctx), database(ctx), q.collection, (col) => col.deleteOne(q.filter));
      return [{ deletedCount: res.deletedCount } as Bundle];
    }),
    aggregate: m("aggregate", "Run an aggregation", "search", z.object({ collection: z.string(), pipeline: z.array(z.any()) }), async (_i, p, ctx) => {
      const q = p as { collection: string; pipeline: Record<string, unknown>[] };
      const docs = await withCollection(uri(ctx), database(ctx), q.collection, (col) => col.aggregate(q.pipeline).toArray());
      return [{ documents: docs, count: docs.length } as Bundle];
    }),
  },
  testConnection,
};
