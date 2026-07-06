import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { requireCredential } from "./util";

/** Redis connector (production). Auth: connection string (redis://). Driver: ioredis (lazy). */

const conn = (ctx: ExecutionContext) => requireCredential(ctx, ["connectionString", "url"], "Redis");

/** Open a client, run one operation, always disconnect. */
async function withRedis<T>(connectionString: string, fn: (client: import("ioredis").Redis) => Promise<T>): Promise<T> {
  const { default: Redis } = await import("ioredis");
  const client = new Redis(connectionString, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const cs = (credentials.connectionString ?? credentials.url) as string | undefined;
  if (!cs) return { ok: false, message: "Missing connection string." };
  try {
    const pong = await withRedis(cs, (c) => c.ping());
    return { ok: pong === "PONG", message: pong === "PONG" ? "Connected to Redis" : "Unexpected ping reply" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const redisApp: App = {
  key: "redis",
  name: "Redis",
  auth: { type: "custom", fields: [{ key: "connectionString", label: "Connection string", type: "password", required: true }] },
  modules: {
    get: m("get", "Get a key", "search", z.object({ key: z.string() }), async (_i, p, ctx) => {
      const { key } = p as { key: string };
      const value = await withRedis(conn(ctx), (c) => c.get(key));
      return [{ key, value } as Bundle];
    }),
    set: m("set", "Set a key", "action", z.object({ key: z.string(), value: z.string(), ttlSeconds: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { key: string; value: string; ttlSeconds?: number };
      const res = await withRedis(conn(ctx), (c) => (q.ttlSeconds ? c.set(q.key, q.value, "EX", q.ttlSeconds) : c.set(q.key, q.value)));
      return [{ key: q.key, result: res } as Bundle];
    }),
    del: m("del", "Delete a key", "action", z.object({ key: z.string() }), async (_i, p, ctx) => {
      const { key } = p as { key: string };
      const removed = await withRedis(conn(ctx), (c) => c.del(key));
      return [{ key, removed } as Bundle];
    }),
    incr: m("incr", "Increment a key", "action", z.object({ key: z.string() }), async (_i, p, ctx) => {
      const { key } = p as { key: string };
      const value = await withRedis(conn(ctx), (c) => c.incr(key));
      return [{ key, value } as Bundle];
    }),
    expire: m("expire", "Set a key TTL", "action", z.object({ key: z.string(), seconds: z.number() }), async (_i, p, ctx) => {
      const q = p as { key: string; seconds: number };
      const set = await withRedis(conn(ctx), (c) => c.expire(q.key, q.seconds));
      return [{ key: q.key, set: set === 1 } as Bundle];
    }),
    keys: m("keys", "Find keys by pattern", "search", z.object({ pattern: z.string() }), async (_i, p, ctx) => {
      const { pattern } = p as { pattern: string };
      const keys = await withRedis(conn(ctx), (c) => c.keys(pattern));
      return [{ keys, count: keys.length } as Bundle];
    }),
  },
  testConnection,
};
