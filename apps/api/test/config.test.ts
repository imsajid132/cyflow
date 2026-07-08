import { describe, expect, it } from "vitest";
import request from "supertest";
import { readConfigStatus, validateConfig } from "../src/config";
import { createApp } from "../src/app";
import { InMemoryApiStore } from "../src/store";

describe("readConfigStatus", () => {
  it("reports a fully-configured production environment", () => {
    const env = {
      DATABASE_URL: "postgres://x",
      REDIS_URL: "redis://x",
      CYFLOW_ENCRYPTION_KEY: "k".repeat(40),
      ADMIN_TOKEN: "secret",
      PUBLIC_API_URL: "https://api.cyflow.app/",
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "gs",
      GOOGLE_REDIRECT_URI: "https://api/cb",
      MICROSOFT_CLIENT_ID: "m",
      MICROSOFT_CLIENT_SECRET: "ms",
      MICROSOFT_REDIRECT_URI: "https://api/cb",
    } as unknown as NodeJS.ProcessEnv;
    expect(readConfigStatus(env)).toEqual({
      persistence: "postgres",
      database: true,
      redis: true,
      vault: true,
      oauth: { google: true, microsoft: true },
      oauthEnv: {
        google: { clientId: true, clientSecret: true, redirectUri: true },
        microsoft: { clientId: true, clientSecret: true, redirectUri: true },
        webAppUrl: false,
        keysPresent: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_REDIRECT_URI",
          "MICROSOFT_CLIENT_ID",
          "MICROSOFT_CLIENT_SECRET",
          "MICROSOFT_REDIRECT_URI",
        ],
      },
      webhookBaseUrl: "https://api.cyflow.app/hooks",
      adminProtected: true,
    });
    // Booleans only: the actual secret VALUES never appear in the status.
    const json = JSON.stringify(readConfigStatus({ ...env, GOOGLE_CLIENT_SECRET: "S3CR3T-VALUE-XYZ" }));
    expect(json).not.toContain("S3CR3T-VALUE-XYZ");
  });

  it("reports an empty (demo) environment without leaking anything", () => {
    const s = readConfigStatus({} as NodeJS.ProcessEnv);
    expect(s).toMatchObject({ persistence: "in-memory", database: false, vault: false, adminProtected: false, webhookBaseUrl: null });
    expect(s.oauth).toEqual({ google: false, microsoft: false });
    // Per-var OAuth diagnostic is booleans only (never values).
    expect(s.oauthEnv.google).toEqual({ clientId: false, clientSecret: false, redirectUri: false });
  });
});

describe("validateConfig", () => {
  it("errors when a database is set but the encryption key is missing", () => {
    const { errors } = validateConfig({ DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv);
    expect(errors.join(" ")).toMatch(/CYFLOW_ENCRYPTION_KEY/);
  });

  it("warns about in-memory persistence + open admin + partial OAuth", () => {
    const { warnings } = validateConfig({ GOOGLE_CLIENT_ID: "g" } as NodeJS.ProcessEnv);
    const text = warnings.join(" ");
    expect(text).toMatch(/DATABASE_URL not set/);
    expect(text).toMatch(/No ADMIN_TOKEN/);
    expect(text).toMatch(/Partial Google OAuth/);
    expect(text).toMatch(/WEB_APP_URL not set/);
  });

  it("is clean for a complete production env", () => {
    const env = {
      DATABASE_URL: "postgres://x",
      CYFLOW_ENCRYPTION_KEY: "k".repeat(40),
      ADMIN_TOKEN: "s",
      WEB_APP_URL: "https://cyflow.app",
    } as unknown as NodeJS.ProcessEnv;
    expect(validateConfig(env)).toEqual({ errors: [], warnings: [] });
  });
});

describe("GET /health", () => {
  const status = readConfigStatus({ DATABASE_URL: "postgres://x", CYFLOW_ENCRYPTION_KEY: "k", ADMIN_TOKEN: "s", PUBLIC_API_URL: "https://api.x" } as NodeJS.ProcessEnv);

  it("stays public (no admin token) and reports config status", async () => {
    const app = createApp(new InMemoryApiStore(), { adminToken: "s", health: { status, checkDatabase: async () => true } });
    const res = await request(app).get("/health"); // no Authorization header
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "cyflow-api", auth: true });
    expect(res.body.config).toMatchObject({ persistence: "postgres", vault: true, database: true, webhookBaseUrl: "https://api.x/hooks" });
  });

  it("reports database:false when the live ping fails", async () => {
    const app = createApp(new InMemoryApiStore(), { health: { status, checkDatabase: async () => false } });
    const res = await request(app).get("/health");
    expect(res.body.config.database).toBe(false);
  });

  it("never exposes any secret value in the health payload", async () => {
    const app = createApp(new InMemoryApiStore(), { adminToken: "super-secret-token", health: { status } });
    const res = await request(app).get("/health");
    expect(JSON.stringify(res.body)).not.toContain("super-secret-token");
  });
});
