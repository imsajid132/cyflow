import { type PrismaClient } from "@prisma/client";
import type { ConnectionRow, ConnectionStore, CreateConnectionRow } from "@cyflow/shared";

type ConnectionDbRow = {
  id: string;
  userId: string;
  appKey: string;
  name: string;
  encryptedData: string;
  createdAt: Date;
};

/** Prisma-backed store of encrypted connection rows (no crypto here). */
export class PrismaConnectionStore implements ConnectionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(row: CreateConnectionRow): Promise<ConnectionRow> {
    const created = await this.prisma.connection.create({
      data: {
        id: row.id,
        userId: row.userId,
        appKey: row.appKey,
        name: row.name,
        encryptedData: row.encryptedData,
      },
    });
    return this.map(created);
  }

  async findById(id: string): Promise<ConnectionRow | null> {
    const row = await this.prisma.connection.findUnique({ where: { id } });
    return row ? this.map(row) : null;
  }

  async update(
    id: string,
    patch: { name?: string; encryptedData?: string },
  ): Promise<ConnectionRow> {
    const row = await this.prisma.connection.update({
      where: { id },
      data: { name: patch.name, encryptedData: patch.encryptedData },
    });
    return this.map(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.connection.delete({ where: { id } });
  }

  async listByUser(userId: string): Promise<ConnectionRow[]> {
    const rows = await this.prisma.connection.findMany({ where: { userId } });
    return rows.map((r) => this.map(r));
  }

  private map(row: ConnectionDbRow): ConnectionRow {
    return {
      id: row.id,
      userId: row.userId,
      appKey: row.appKey,
      name: row.name,
      encryptedData: row.encryptedData,
      createdAt: row.createdAt,
    };
  }
}
