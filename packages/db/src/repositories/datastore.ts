import { Prisma, type PrismaClient } from "@prisma/client";
import type { DataStore, DataStoreRecord } from "@cyflow/shared";

/** Stable id of the store that backs the engine's default keyspace. */
export const DEFAULT_STORE_ID = "default_store";
export const DEFAULT_STORE_NAME = "Default store";

/** A named data store as the management API exposes it (record count, no values). */
export interface DataStoreInfo {
  id: string;
  name: string;
  records: number;
  updatedAt: string;
}

/** One record inside a store, with its update time. */
export interface DataStoreRecordInfo {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Prisma-backed key-value data store (Phase 8), scoped to a single named store.
 * Persists across executions. Defaults to the "Default store" so the engine's
 * flat keyspace is preserved; a different `storeId` scopes records to that store.
 */
export class PrismaDataStore implements DataStore {
  private ensured = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storeId: string = DEFAULT_STORE_ID,
  ) {}

  /** Make sure the store row exists before a write (the default store is seeded
   *  by migration, but `db push` / fresh test DBs may not have it). */
  private async ensureStore(): Promise<void> {
    if (this.ensured) return;
    if (this.storeId === DEFAULT_STORE_ID) {
      await this.prisma.dataStore.upsert({
        where: { id: DEFAULT_STORE_ID },
        create: { id: DEFAULT_STORE_ID, name: DEFAULT_STORE_NAME },
        update: {},
      });
    }
    this.ensured = true;
  }

  async get(key: string): Promise<unknown> {
    const row = await this.prisma.dataStoreRecord.findUnique({
      where: { storeId_key: { storeId: this.storeId, key } },
    });
    return row ? (row.value as unknown) : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.ensureStore();
    const json = (value ?? null) as Prisma.InputJsonValue;
    await this.prisma.dataStoreRecord.upsert({
      where: { storeId_key: { storeId: this.storeId, key } },
      create: { storeId: this.storeId, key, value: json },
      update: { value: json },
    });
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.prisma.dataStoreRecord.deleteMany({ where: { storeId: this.storeId, key } });
    return result.count > 0;
  }

  async list(prefix?: string): Promise<DataStoreRecord[]> {
    const rows = await this.prisma.dataStoreRecord.findMany({
      where: { storeId: this.storeId, ...(prefix ? { key: { startsWith: prefix } } : {}) },
      orderBy: { key: "asc" },
    });
    return rows.map((r) => ({ key: r.key, value: r.value as unknown }));
  }

  async increment(key: string, by = 1): Promise<number> {
    await this.ensureStore();
    // Atomic read-modify-write in a transaction.
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.dataStoreRecord.findUnique({ where: { storeId_key: { storeId: this.storeId, key } } });
      const current = Number((row?.value as unknown) ?? 0);
      const next = current + by;
      await tx.dataStoreRecord.upsert({
        where: { storeId_key: { storeId: this.storeId, key } },
        create: { storeId: this.storeId, key, value: next as Prisma.InputJsonValue },
        update: { value: next as Prisma.InputJsonValue },
      });
      return next;
    });
  }
}

/**
 * Management surface for named data stores + their records — what the REST API
 * uses to let users create stores and edit records in the UI. Reads/writes hit
 * the same tables the engine's `PrismaDataStore` uses, so UI edits and scenario
 * runs share one source of truth.
 */
export class PrismaDataStoreManager {
  constructor(private readonly prisma: PrismaClient) {}

  /** Ensure the default store exists so the UI always has one to write into. */
  async ensureDefaultStore(): Promise<void> {
    await this.prisma.dataStore.upsert({
      where: { id: DEFAULT_STORE_ID },
      create: { id: DEFAULT_STORE_ID, name: DEFAULT_STORE_NAME },
      update: {},
    });
  }

  async listStores(): Promise<DataStoreInfo[]> {
    await this.ensureDefaultStore();
    const rows = await this.prisma.dataStore.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { records: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, records: r._count.records, updatedAt: r.updatedAt.toISOString() }));
  }

  async createStore(name: string, id?: string): Promise<DataStoreInfo> {
    const row = await this.prisma.dataStore.create({
      data: { ...(id ? { id } : {}), name: name.trim() || "New store" },
    });
    return { id: row.id, name: row.name, records: 0, updatedAt: row.updatedAt.toISOString() };
  }

  async deleteStore(id: string): Promise<boolean> {
    // The default store is permanent — it backs the engine keyspace.
    if (id === DEFAULT_STORE_ID) return false;
    const exists = await this.prisma.dataStore.findUnique({ where: { id } });
    if (!exists) return false;
    await this.prisma.dataStore.delete({ where: { id } });
    return true;
  }

  async listRecords(storeId: string): Promise<DataStoreRecordInfo[]> {
    const rows = await this.prisma.dataStoreRecord.findMany({
      where: { storeId },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => ({ key: r.key, value: r.value as unknown, updatedAt: r.updatedAt.toISOString() }));
  }

  async upsertRecord(storeId: string, key: string, value: unknown): Promise<DataStoreRecordInfo> {
    const json = (value ?? null) as Prisma.InputJsonValue;
    const row = await this.prisma.dataStoreRecord.upsert({
      where: { storeId_key: { storeId, key } },
      create: { storeId, key, value: json },
      update: { value: json },
    });
    // Touch the parent store so its "updated" time reflects record edits.
    await this.prisma.dataStore.update({ where: { id: storeId }, data: { updatedAt: new Date() } });
    return { key: row.key, value: row.value as unknown, updatedAt: row.updatedAt.toISOString() };
  }

  async deleteRecord(storeId: string, key: string): Promise<boolean> {
    const result = await this.prisma.dataStoreRecord.deleteMany({ where: { storeId, key } });
    return result.count > 0;
  }
}
