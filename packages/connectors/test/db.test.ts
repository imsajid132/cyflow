import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@cyflow/shared";
import { postgresApp, mysqlApp, mongodbApp, redisApp } from "../src/index";

const ctx = (connection: Record<string, unknown>): ExecutionContext => ({ connection } as unknown as ExecutionContext);

/* ---- driver mocks (hoisted so vi.mock factories can see them) ---- */
const h = vi.hoisted(() => {
  // pg
  const pgQuery = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ id: 1, name: "Ada" }], rowCount: 1 }));
  const pgConnect = vi.fn(async () => undefined);
  const pgEnd = vi.fn(async () => undefined);
  // mysql2
  const mysqlExecute = vi.fn(async (_sql: string, _values?: unknown[]) => [[{ id: 2 }], []]);
  const mysqlEnd = vi.fn(async () => undefined);
  const createConnection = vi.fn(async () => ({ execute: mysqlExecute, end: mysqlEnd }));
  // mongodb
  const findToArray = vi.fn(async () => [{ _id: "a" }]);
  const insertOne = vi.fn(async () => ({ insertedId: "newid", acknowledged: true }));
  const collection = vi.fn(() => ({
    find: vi.fn(() => ({ sort: vi.fn(() => ({ limit: vi.fn(() => ({ toArray: findToArray })) })) })),
    insertOne,
  }));
  const mongoConnect = vi.fn(async () => undefined);
  const mongoClose = vi.fn(async () => undefined);
  const MongoClient = vi.fn(function () {
    return { connect: mongoConnect, close: mongoClose, db: () => ({ collection }) };
  });
  // ioredis
  const redisGet = vi.fn(async () => "hello");
  const redisSet = vi.fn(async () => "OK");
  const redisConnect = vi.fn(async () => undefined);
  const redisDisconnect = vi.fn(() => undefined);
  const Redis = vi.fn(function () {
    return { connect: redisConnect, disconnect: redisDisconnect, get: redisGet, set: redisSet };
  });
  return { pgQuery, pgConnect, pgEnd, createConnection, mysqlExecute, findToArray, insertOne, collection, MongoClient, redisGet, redisSet, Redis };
});

vi.mock("pg", () => ({ Client: vi.fn(function () { return { connect: h.pgConnect, query: h.pgQuery, end: h.pgEnd }; }) }));
vi.mock("mysql2/promise", () => ({ createConnection: h.createConnection, default: { createConnection: h.createConnection } }));
vi.mock("mongodb", () => ({ MongoClient: h.MongoClient }));
vi.mock("ioredis", () => ({ default: h.Redis }));

describe("PostgreSQL (mocked driver)", () => {
  it("query runs SQL with values + closes the connection", async () => {
    const out = await postgresApp.modules.query.run({}, { sql: "SELECT * FROM users WHERE id=$1", values: [1] }, ctx({ connectionString: "postgres://x" }));
    expect(h.pgQuery).toHaveBeenCalledWith("SELECT * FROM users WHERE id=$1", [1]);
    expect(h.pgEnd).toHaveBeenCalled();
    expect(out[0]).toMatchObject({ rows: [{ id: 1, name: "Ada" }], rowCount: 1 });
  });
  it("insert builds a parameterised INSERT ... RETURNING", async () => {
    await postgresApp.modules.insert.run({}, { table: "users", row: { name: "Ada", age: 30 } }, ctx({ connectionString: "postgres://x" }));
    const [sql, values] = h.pgQuery.mock.calls.at(-1)!;
    expect(sql).toContain('INSERT INTO users ("name", "age") VALUES ($1, $2) RETURNING *');
    expect(values).toEqual(["Ada", 30]);
  });
});

describe("MySQL (mocked driver)", () => {
  it("query executes SQL + closes", async () => {
    await mysqlApp.modules.query.run({}, { sql: "SELECT 1", values: [] }, ctx({ connectionString: "mysql://x" }));
    expect(h.mysqlExecute).toHaveBeenCalledWith("SELECT 1", []);
  });
  it("insert builds a backtick-quoted INSERT", async () => {
    await mysqlApp.modules.insert.run({}, { table: "users", row: { name: "Ada" } }, ctx({ connectionString: "mysql://x" }));
    const [sql, values] = h.mysqlExecute.mock.calls.at(-1)!;
    expect(sql).toBe("INSERT INTO `users` (`name`) VALUES (?)");
    expect(values).toEqual(["Ada"]);
  });
});

describe("MongoDB (mocked driver)", () => {
  it("find returns documents + count", async () => {
    const out = await mongodbApp.modules.find.run({}, { collection: "users", filter: { active: true } }, ctx({ uri: "mongodb://x", database: "app" }));
    expect(h.collection).toHaveBeenCalledWith("users");
    expect(out[0]).toMatchObject({ documents: [{ _id: "a" }], count: 1 });
  });
  it("insert_one inserts a document", async () => {
    const out = await mongodbApp.modules.insert_one.run({}, { collection: "users", document: { name: "Ada" } }, ctx({ uri: "mongodb://x", database: "app" }));
    expect(h.insertOne).toHaveBeenCalledWith({ name: "Ada" });
    expect(out[0]).toMatchObject({ insertedId: "newid", acknowledged: true });
  });
});

describe("Redis (mocked driver)", () => {
  it("get returns the value", async () => {
    const out = await redisApp.modules.get.run({}, { key: "greeting" }, ctx({ connectionString: "redis://x" }));
    expect(h.redisGet).toHaveBeenCalledWith("greeting");
    expect(out[0]).toMatchObject({ key: "greeting", value: "hello" });
  });
  it("set with a TTL uses EX", async () => {
    await redisApp.modules.set.run({}, { key: "k", value: "v", ttlSeconds: 60 }, ctx({ connectionString: "redis://x" }));
    expect(h.redisSet).toHaveBeenCalledWith("k", "v", "EX", 60);
  });
});
