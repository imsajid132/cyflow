import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric credential encryption (AES-256-GCM). Ciphertext is authenticated,
 * so tampering or a wrong key is detected on decrypt. Format:
 *   base64(iv) : base64(authTag) : base64(ciphertext)
 *
 * Secrets are only ever handled here and in ConnectionService — never logged.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export class EncryptionService {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error("EncryptionService requires a 32-byte key");
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(":");
    if (!ivB64 || !tagB64 || dataB64 === undefined) {
      throw new Error("Invalid ciphertext format");
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    // `final()` throws if the auth tag / key is wrong.
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
}

/** Derive a stable 32-byte key from any-length secret (SHA-256). */
export function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function createEncryptionService(secret: string): EncryptionService {
  return new EncryptionService(keyFromSecret(secret));
}

/** Build the service from CYFLOW_ENCRYPTION_KEY. Throws if unset. */
export function encryptionFromEnv(env: NodeJS.ProcessEnv = process.env): EncryptionService {
  const secret = env.CYFLOW_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("CYFLOW_ENCRYPTION_KEY is not set");
  }
  return createEncryptionService(secret);
}
