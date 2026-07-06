import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  ConnectionService,
  InMemoryConnectionStore,
  createEncryptionService,
  makeGoogleGetConnection,
  tokensToCredentials,
} from "@cyflow/connections";
import { createApp, type GoogleRuntime } from "../src/app";
import { InMemoryApiStore } from "../src/store";

const encryption = createEncryptionService("test-secret-key");
const config = { clientId: "cid", clientSecret: "csecret", redirectUri: "https://api.test/oauth/google/callback" };

function runtime(): { rt: GoogleRuntime; connections: ConnectionService } {
  const connections = new ConnectionService(new InMemoryConnectionStore(), encryption);
  return { rt: { config, encryption, connections, userId: "u1" }, connections };
}

/** Mock Google's token + userinfo endpoints. */
function stubGoogle(token: Record<string, unknown>, email = "ada@gmail.com") {
  const mock = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) return { ok: true, status: 200, json: async () => token };
    if (u.includes("userinfo")) return { ok: true, status: 200, json: async () => ({ email }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Google OAuth · start", () => {
  it("returns the real consent URL with the right scopes + offline access", async () => {
    const { rt } = runtime();
    const res = await request(createApp(new InMemoryApiStore(), { google: rt })).get("/oauth/google/start?app=gmail");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    const url = new URL(res.body.authUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
    expect(url.searchParams.get("state")).toBeTruthy();
    // The client secret must NEVER appear in anything sent to the browser.
    expect(res.text).not.toContain("csecret");
  });

  it("uses per-app scopes (drive/calendar/sheets)", async () => {
    const { rt } = runtime();
    const app = createApp(new InMemoryApiStore(), { google: rt });
    for (const [k, needle] of [["drive", "auth/drive"], ["calendar", "auth/calendar"], ["sheets", "spreadsheets"]] as const) {
      const res = await request(app).get(`/oauth/google/start?app=${k}`);
      expect(new URL(res.body.authUrl).searchParams.get("scope")).toContain(needle);
    }
  });

  it("400s an unknown app; reports not-configured when GOOGLE_* is missing", async () => {
    const { connections } = runtime();
    const unconfigured = createApp(new InMemoryApiStore(), { google: { config: null, encryption, connections, userId: "u1" } });
    expect((await request(unconfigured).get("/oauth/google/start?app=nope")).status).toBe(400);
    const res = await request(unconfigured).get("/oauth/google/start?app=gmail");
    expect(res.body.configured).toBe(false);
    expect(res.body.message).toMatch(/not configured/i);
  });
});

describe("Google OAuth · callback", () => {
  it("exchanges the code, stores encrypted tokens, and never leaks them", async () => {
    const { rt, connections } = runtime();
    const app = createApp(new InMemoryApiStore(), { google: rt });
    // Get a valid, freshly-issued state from start.
    const start = await request(app).get("/oauth/google/start?app=gmail");
    const state = new URL(start.body.authUrl).searchParams.get("state")!;

    stubGoogle({ access_token: "ya29.SECRET", refresh_token: "1//REFRESH", expires_in: 3600, token_type: "Bearer", scope: "gmail.modify" });
    const cb = await request(app).get(`/oauth/google/callback?code=AUTH_CODE&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(200);
    expect(cb.body.ok).toBe(true);
    expect(cb.body.app).toBe("gmail");
    // The callback response must not contain any token.
    expect(cb.text).not.toContain("ya29.SECRET");
    expect(cb.text).not.toContain("1//REFRESH");

    // The connection is saved for the user; the list is redacted (no secrets).
    const list = await connections.list("u1");
    expect(list).toHaveLength(1);
    expect(list[0].appKey).toBe("gmail");
    expect(list[0].name).toContain("ada@gmail.com");
    expect(JSON.stringify(list)).not.toContain("ya29.SECRET");
    expect(JSON.stringify(list)).not.toContain("1//REFRESH");

    // The tokens ARE stored (encrypted) — visible only via the vault's decrypt path.
    const row = await connections.getRowById(list[0].id);
    expect(row?.credentials.access_token).toBe("ya29.SECRET");
    expect(row?.credentials.refresh_token).toBe("1//REFRESH");
  });

  it("rejects a tampered/invalid state (CSRF)", async () => {
    const { rt } = runtime();
    const res = await request(createApp(new InMemoryApiStore(), { google: rt })).get("/oauth/google/callback?code=X&state=forged");
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("surfaces a provider error", async () => {
    const { rt } = runtime();
    const res = await request(createApp(new InMemoryApiStore(), { google: rt })).get("/oauth/google/callback?error=access_denied");
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

describe("Google OAuth · refresh before execution", () => {
  it("refreshes an expired access token and re-stores it", async () => {
    const connections = new ConnectionService(new InMemoryConnectionStore(), encryption);
    const expired = tokensToCredentials(
      { accessToken: "ya29.OLD", refreshToken: "1//REFRESH", expiresIn: -10 },
      "ada@gmail.com",
    );
    const summary = await connections.create({ userId: "u1", appKey: "gmail", name: "Gmail", credentials: expired as unknown as Record<string, unknown> });

    stubGoogle({ access_token: "ya29.NEW", expires_in: 3600, token_type: "Bearer" });
    const getConnection = makeGoogleGetConnection(connections, config);
    const creds = await getConnection(summary.id);

    expect(creds?.access_token).toBe("ya29.NEW");
    expect(creds?.refresh_token).toBe("1//REFRESH"); // preserved
    // The refreshed token is persisted for next time.
    const stored = await connections.getRowById(summary.id);
    expect(stored?.credentials.access_token).toBe("ya29.NEW");
  });

  it("does not refresh a still-valid token (no network call)", async () => {
    const connections = new ConnectionService(new InMemoryConnectionStore(), encryption);
    const valid = tokensToCredentials({ accessToken: "ya29.VALID", refreshToken: "1//R", expiresIn: 3600 }, "ada@gmail.com");
    const summary = await connections.create({ userId: "u1", appKey: "gmail", name: "Gmail", credentials: valid as unknown as Record<string, unknown> });
    const mock = stubGoogle({ access_token: "should-not-be-used" });
    const creds = await makeGoogleGetConnection(connections, config)(summary.id);
    expect(creds?.access_token).toBe("ya29.VALID");
    expect(mock).not.toHaveBeenCalled();
  });
});
