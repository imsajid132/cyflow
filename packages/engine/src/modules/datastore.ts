import type { Bundle, DataStore, DataStoreRecord, OperationRunner } from "@cyflow/shared";

/** In-memory key-value data store — browser-safe; used for tests / local runs. */
export class InMemoryDataStore implements DataStore {
  private readonly map = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.map.get(key);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async list(prefix?: string): Promise<DataStoreRecord[]> {
    return [...this.map.entries()]
      .filter(([key]) => !prefix || key.startsWith(prefix))
      .map(([key, value]) => ({ key, value }));
  }
  async increment(key: string, by = 1): Promise<number> {
    const current = Number(this.map.get(key) ?? 0);
    const next = current + by;
    this.map.set(key, next);
    return next;
  }
}

function requireStore(ctx: { dataStore?: DataStore }): DataStore {
  if (!ctx.dataStore) {
    throw new Error("datastore module requires a data store (none is wired into this run)");
  }
  return ctx.dataStore;
}

export const getRecord: OperationRunner = async (_input, params, ctx): Promise<Bundle[]> => {
  const key = String((params as { key?: unknown }).key ?? "");
  const value = await requireStore(ctx).get(key);
  return [{ key, value, found: value !== undefined }];
};

export const setRecord: OperationRunner = async (_input, params, ctx): Promise<Bundle[]> => {
  const { key, value } = params as { key?: unknown; value?: unknown };
  const k = String(key ?? "");
  await requireStore(ctx).set(k, value);
  return [{ key: k, value }];
};

export const deleteRecord: OperationRunner = async (_input, params, ctx): Promise<Bundle[]> => {
  const key = String((params as { key?: unknown }).key ?? "");
  const deleted = await requireStore(ctx).delete(key);
  return [{ key, deleted }];
};

/** Search-style: emits one bundle per record so downstream fans out. */
export const listRecords: OperationRunner = async (_input, params, ctx): Promise<Bundle[]> => {
  const prefix = (params as { prefix?: unknown }).prefix;
  const records = await requireStore(ctx).list(prefix === undefined ? undefined : String(prefix));
  return records.map((r) => ({ key: r.key, value: r.value }));
};

export const incrementRecord: OperationRunner = async (_input, params, ctx): Promise<Bundle[]> => {
  const { key, by } = params as { key?: unknown; by?: unknown };
  const k = String(key ?? "");
  const value = await requireStore(ctx).increment(k, by === undefined ? 1 : Number(by));
  return [{ key: k, value }];
};
