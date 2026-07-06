import { describe, expect, it } from "vitest";
import { createEncryptionService } from "../src/crypto";
import { ConnectionService, InMemoryConnectionStore } from "../src/service";

function service() {
  return new ConnectionService(new InMemoryConnectionStore(), createEncryptionService("unit-key"));
}

describe("ConnectionService (vault)", () => {
  it("creates a connection and stores credentials encrypted", async () => {
    const store = new InMemoryConnectionStore();
    const svc = new ConnectionService(store, createEncryptionService("unit-key"));

    const summary = await svc.create({
      userId: "u1",
      appKey: "http",
      name: "Prod API",
      credentials: { type: "bearer_token", token: "secret-token" },
    });

    expect(summary).toEqual({
      id: expect.any(String),
      appKey: "http",
      name: "Prod API",
      createdAt: expect.any(Date),
    });
    // The raw stored row holds ciphertext, not the token.
    const row = await store.findById(summary.id);
    expect(row!.encryptedData).not.toContain("secret-token");
  });

  it("list() redacts secrets (no encryptedData, no credentials)", async () => {
    const svc = service();
    await svc.create({ userId: "u1", appKey: "http", name: "A", credentials: { token: "t1" } });
    await svc.create({ userId: "u1", appKey: "http", name: "B", credentials: { token: "t2" } });

    const list = await svc.list("u1");
    expect(list).toHaveLength(2);
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain("t1");
    expect(serialized).not.toContain("t2");
    expect(serialized).not.toContain("encryptedData");
    expect(list.every((c) => Object.keys(c).sort().join(",") === "appKey,createdAt,id,name")).toBe(
      true,
    );
  });

  it("getDecrypted returns the original credentials for execution", async () => {
    const svc = service();
    const created = await svc.create({
      userId: "u1",
      appKey: "http",
      name: "A",
      credentials: { type: "api_key", key: "k-123", header: "X-Api-Key" },
    });
    expect(await svc.getDecrypted(created.id)).toEqual({
      type: "api_key",
      key: "k-123",
      header: "X-Api-Key",
    });
    expect(await svc.getDecrypted("missing")).toBeNull();
  });

  it("update re-encrypts credentials; delete removes it", async () => {
    const svc = service();
    const created = await svc.create({
      userId: "u1",
      appKey: "http",
      name: "A",
      credentials: { token: "old" },
    });
    await svc.update(created.id, { name: "Renamed", credentials: { token: "new" } });
    expect(await svc.getDecrypted(created.id)).toEqual({ token: "new" });
    expect((await svc.list("u1"))[0].name).toBe("Renamed");

    await svc.delete(created.id);
    expect(await svc.getDecrypted(created.id)).toBeNull();
  });

  it("toGetConnection() resolves like ctx.getConnection", async () => {
    const svc = service();
    const created = await svc.create({
      userId: "u1",
      appKey: "http",
      name: "A",
      credentials: { type: "bearer_token", token: "abc" },
    });
    const getConnection = svc.toGetConnection();
    expect(await getConnection(created.id)).toMatchObject({ token: "abc" });
  });
});
