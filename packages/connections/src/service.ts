import type {
  ConnectionRow,
  ConnectionStore,
  ConnectionSummary,
  CreateConnectionRow,
} from "@cyflow/shared";
import type { EncryptionService } from "./crypto";

export interface CreateConnectionInput {
  userId: string;
  appKey: string;
  name: string;
  /** Plaintext credentials — encrypted before they ever hit the store. */
  credentials: Record<string, unknown>;
}

export interface UpdateConnectionInput {
  name?: string;
  credentials?: Record<string, unknown>;
}

/**
 * The credential vault. Encrypts on create/update, decrypts ONLY for execution
 * (`getDecrypted` / `toGetConnection`), and never returns secrets from `list`.
 * It never logs credentials.
 */
export class ConnectionService {
  constructor(
    private readonly store: ConnectionStore,
    private readonly encryption: EncryptionService,
  ) {}

  async create(input: CreateConnectionInput): Promise<ConnectionSummary> {
    const encryptedData = this.encryption.encrypt(JSON.stringify(input.credentials));
    const row = await this.store.create({
      userId: input.userId,
      appKey: input.appKey,
      name: input.name,
      encryptedData,
    } satisfies CreateConnectionRow);
    return toSummary(row);
  }

  async update(id: string, patch: UpdateConnectionInput): Promise<ConnectionSummary> {
    const data: { name?: string; encryptedData?: string } = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.credentials !== undefined) {
      data.encryptedData = this.encryption.encrypt(JSON.stringify(patch.credentials));
    }
    const row = await this.store.update(id, data);
    return toSummary(row);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  /** List a user's connections with secrets redacted (never decrypts). */
  async list(userId: string): Promise<ConnectionSummary[]> {
    const rows = await this.store.listByUser(userId);
    return rows.map(toSummary);
  }

  /** Decrypt a connection's credentials — for execution use only. */
  async getDecrypted(id: string): Promise<Record<string, unknown> | null> {
    const row = await this.store.findById(id);
    if (!row) return null;
    return JSON.parse(this.encryption.decrypt(row.encryptedData)) as Record<string, unknown>;
  }

  /** Row identity + decrypted credentials — for the OAuth refresh layer only. */
  async getRowById(
    id: string,
  ): Promise<{ id: string; appKey: string; credentials: Record<string, unknown> } | null> {
    const row = await this.store.findById(id);
    if (!row) return null;
    return {
      id: row.id,
      appKey: row.appKey,
      credentials: JSON.parse(this.encryption.decrypt(row.encryptedData)) as Record<string, unknown>,
    };
  }

  /** Re-encrypt and store new credentials (used when refreshing OAuth tokens). */
  async updateCredentials(id: string, credentials: Record<string, unknown>): Promise<void> {
    await this.store.update(id, { encryptedData: this.encryption.encrypt(JSON.stringify(credentials)) });
  }

  /** A `ctx.getConnection` resolver bound to this service. */
  toGetConnection(): (id: string) => Promise<Record<string, unknown> | null> {
    return (id: string) => this.getDecrypted(id);
  }
}

function toSummary(row: ConnectionRow): ConnectionSummary {
  return { id: row.id, appKey: row.appKey, name: row.name, createdAt: row.createdAt };
}

/** A simple in-memory ConnectionStore for tests / local dev. */
export class InMemoryConnectionStore implements ConnectionStore {
  private readonly rows = new Map<string, ConnectionRow>();
  private counter = 0;

  async create(row: CreateConnectionRow): Promise<ConnectionRow> {
    const id = row.id ?? `conn_${(++this.counter).toString(36)}`;
    const created: ConnectionRow = {
      id,
      userId: row.userId,
      appKey: row.appKey,
      name: row.name,
      encryptedData: row.encryptedData,
      createdAt: new Date(),
    };
    this.rows.set(id, created);
    return { ...created };
  }

  async findById(id: string): Promise<ConnectionRow | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async update(id: string, patch: { name?: string; encryptedData?: string }): Promise<ConnectionRow> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`Connection not found: ${id}`);
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.encryptedData !== undefined) row.encryptedData = patch.encryptedData;
    return { ...row };
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async listByUser(userId: string): Promise<ConnectionRow[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId).map((r) => ({ ...r }));
  }
}
