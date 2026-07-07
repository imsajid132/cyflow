import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  ConnectionService,
  InMemoryConnectionStore,
  createEncryptionService,
  makeCloudGetConnection,
  tokensToCredentials,
} from "@cyflow/connections";
import { createApp, type MicrosoftRuntime } from "../src/app";
import { InMemoryApiStore } from "../src/store";

const encryption = createEncryptionService("test-secret-key");
const config = { clientId: "cid", clientSecret: "csecret", redirectUri: "https://api.test/oauth/microsoft/callback" };

function runtime(): { rt: MicrosoftRuntime; connections: ConnectionService } {
  const connections = new ConnectionService(new InMemoryConnectionStore(), encryption);
  return { rt: { config, encryption, connections, userId: "u1" }, connections };
}

function stubMs(token: Record<string, unknown>, email = "ada@contoso.com") {
  const mock = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/oauth2/v2.0/token")) return { ok: true, status: 200, json: async () => token };
    if (u.includes("graph.microsoft.com/v1.0/me")) return { ok: true, status: 200, json: async () => ({ mail: email }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Microsoft OAuth · start", () => {
  it("returns the consent URL with Graph scopes + offline_access", async () => {
    const { rt } = runtime();
    const res = await request(createApp(new InMemoryApiStore(), { microsoft: rt })).get("/oauth/microsoft/start?app=outlook");
    expect(res.status).toBe(200);
    const url = new URL(res.body.authUrl);
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(res.text).not.toContain("csecret");
  });
  it("400s an unknown app; onedrive uses Files scope", async () => {
    const { rt } = runtime();
    const app = createApp(new InMemoryApiStore(), { microsoft: rt });
    expect((await request(app).get("/oauth/microsoft/start?app=nope")).status).toBe(400);
    const res = await request(app).get("/oauth/microsoft/start?app=onedrive");
    expect(new URL(res.body.authUrl).searchParams.get("scope")).toContain("Files.ReadWrite.All");
  });
});

describe("Microsoft OAuth · callback", () => {
  it("exchanges the code, stores encrypted tokens, never leaks them", async () => {
    const { rt, connections } = runtime();
    const app = createApp(new InMemoryApiStore(), { microsoft: rt });
    const start = await request(app).get("/oauth/microsoft/start?app=outlook");
    const state = new URL(start.body.authUrl).searchParams.get("state")!;

    stubMs({ access_token: "ms.SECRET", refresh_token: "ms.REFRESH", expires_in: 3600, token_type: "Bearer" });
    const cb = await request(app).get(`/oauth/microsoft/callback?code=CODE&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(200);
    expect(cb.body).toMatchObject({ ok: true, app: "outlook" });
    expect(cb.text).not.toContain("ms.SECRET");

    const list = await connections.list("u1");
    expect(list).toHaveLength(1);
    expect(list[0].name).toContain("ada@contoso.com");
    expect(JSON.stringify(list)).not.toContain("ms.SECRET");
    const row = await connections.getRowById(list[0].id);
    expect(row?.credentials.access_token).toBe("ms.SECRET");
  });
  it("rejects an invalid state", async () => {
    const { rt } = runtime();
    const res = await request(createApp(new InMemoryApiStore(), { microsoft: rt })).get("/oauth/microsoft/callback?code=X&state=forged");
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

describe("makeCloudGetConnection · refresh", () => {
  it("refreshes an expired Microsoft token", async () => {
    const connections = new ConnectionService(new InMemoryConnectionStore(), encryption);
    const expired = tokensToCredentials({ accessToken: "ms.OLD", refreshToken: "ms.R", expiresIn: -10 }, "ada@contoso.com");
    const s = await connections.create({ userId: "u1", appKey: "outlook", name: "Outlook", credentials: expired as unknown as Record<string, unknown> });
    stubMs({ access_token: "ms.NEW", expires_in: 3600, token_type: "Bearer" });
    const creds = await makeCloudGetConnection(connections, null, config)(s.id);
    expect(creds?.access_token).toBe("ms.NEW");
    expect(creds?.refresh_token).toBe("ms.R");
  });
  it("leaves a non-cloud app's credentials untouched", async () => {
    const connections = new ConnectionService(new InMemoryConnectionStore(), encryption);
    const s = await connections.create({ userId: "u1", appKey: "github", name: "GH", credentials: { token: "ghp" } });
    const creds = await makeCloudGetConnection(connections, config as never, config)(s.id);
    expect(creds).toEqual({ token: "ghp" });
  });
});
