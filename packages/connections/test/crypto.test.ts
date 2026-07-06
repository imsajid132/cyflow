import { describe, expect, it } from "vitest";
import { createEncryptionService, encryptionFromEnv } from "../src/crypto";

describe("EncryptionService (AES-256-GCM)", () => {
  it("round-trips plaintext", () => {
    const svc = createEncryptionService("test-secret-key");
    const secret = JSON.stringify({ token: "super-secret-value", scope: "read write" });
    const cipher = svc.encrypt(secret);

    expect(cipher).not.toContain("super-secret-value"); // not stored in the clear
    expect(svc.decrypt(cipher)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV) but decrypts the same", () => {
    const svc = createEncryptionService("k");
    const a = svc.encrypt("hello");
    const b = svc.encrypt("hello");
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe("hello");
    expect(svc.decrypt(b)).toBe("hello");
  });

  it("fails to decrypt with the wrong key", () => {
    const cipher = createEncryptionService("right-key").encrypt("classified");
    const wrong = createEncryptionService("wrong-key");
    expect(() => wrong.decrypt(cipher)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const svc = createEncryptionService("k");
    const cipher = svc.encrypt("data");
    const [iv, tag, data] = cipher.split(":");
    const tampered = [iv, tag, Buffer.from("evil").toString("base64")].join(":");
    void data;
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it("encryptionFromEnv throws when CYFLOW_ENCRYPTION_KEY is unset", () => {
    expect(() => encryptionFromEnv({})).toThrow(/CYFLOW_ENCRYPTION_KEY/);
    const svc = encryptionFromEnv({ CYFLOW_ENCRYPTION_KEY: "from-env" });
    expect(svc.decrypt(svc.encrypt("ok"))).toBe("ok");
  });
});
