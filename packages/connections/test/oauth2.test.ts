import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuth2ProviderConfig } from "../src/oauth2";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
} from "../src/oauth2";
import { validateCredentials } from "../src/auth";

const config: OAuth2ProviderConfig = {
  authorizationUrl: "https://provider.test/oauth/authorize",
  tokenUrl: "https://provider.test/oauth/token",
  clientId: "client-123",
  clientSecret: "secret-xyz",
  redirectUri: "https://cyflow.test/oauth/callback",
  scopes: ["read", "write"],
};

afterEach(() => vi.unstubAllGlobals());

describe("OAuth2 scaffold", () => {
  it("builds the authorization URL for the code flow", () => {
    const url = new URL(buildAuthorizationUrl(config, { state: "st-1" }));
    expect(url.origin + url.pathname).toBe("https://provider.test/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://cyflow.test/oauth/callback");
    expect(url.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("scope")).toBe("read write");
  });

  it("exchanges a code for tokens (mocked token endpoint)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "at-1",
          refresh_token: "rt-1",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      })),
    );
    const tokens = await exchangeCodeForToken(config, "code-1");
    expect(tokens).toEqual({
      accessToken: "at-1",
      refreshToken: "rt-1",
      tokenType: "Bearer",
      expiresIn: 3600,
      scope: undefined,
    });
  });

  it("refreshes an access token (mocked)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: "at-2" }) })),
    );
    expect(await refreshAccessToken(config, "rt-1")).toMatchObject({ accessToken: "at-2" });
  });
});

describe("credential validation", () => {
  it("requires the declared fields", () => {
    const auth = {
      type: "basic_auth" as const,
      fields: [
        { key: "username", label: "Username" },
        { key: "password", label: "Password", type: "password" as const },
      ],
    };
    expect(validateCredentials(auth, { username: "u", password: "p" }).success).toBe(true);
    expect(validateCredentials(auth, { username: "u" }).success).toBe(false);
  });
});
