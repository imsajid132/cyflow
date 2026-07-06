import { Prisma, type PrismaClient } from "@prisma/client";
import type { DataStore, DataStoreRecord } from "@cyflow/shared";

/** Prisma-backed key-value data store (Phase 8). Persists across executions. */
export class PrismaDataStore implements DataStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(key: string): Promise<unknown> {
    const row = await this.prisma.dataStoreRecord.findUnique({ where: { key } });
    return row ? (row.value as unknown) : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const json = (value ?? null) as Prisma.InputJsonValue;
    await this.prisma.dataStoreRecord.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.prisma.dataStoreRecord.deleteMany({ where: { key } });
    return result.count > 0;
  }

  async list(prefix?: string): Promise<DataStoreRecord[]> {
    const rows = await this.prisma.dataStoreRecord.findMany({
      where: prefix ? { key: { startsWith: prefix } } : undefined,
      orderBy: { key: "asc" },
    });
    return rows.map((r) => ({ key: r.key, value: r.value as unknown }));
  }

  async increment(key: string, by = 1): Promise<number> {
    // Atomic read-modify-write in a transaction.
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.dataStoreRecord.findUnique({ where: { key } });
      const current = Number((row?.value as unknown) ?? 0);
      const next = current + by;
      await tx.dataStoreRecord.upsert({
        where: { key },
        create: { key, value: next as Prisma.InputJsonValue },
        update: { value: next as Prisma.InputJsonValue },
      });
      return next;
    });
  }
}
