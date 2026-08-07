import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthUrl,
  codeChallengeS256,
  exchangeCode,
  generateCodeVerifier,
  generateState,
  GoogleOAuthError,
  GSC_SCOPE,
  hasSearchConsoleScope,
  listSearchConsoleProperties,
  readGoogleOAuthConfig,
  refreshAccessToken,
  revokeToken,
  stateMatches,
  type FetchLike,
} from "./google-oauth.ts";

const CONFIG = {
  clientId: "marketing-client-id",
  clientSecret: "marketing-secret",
  redirectUri: "https://gengrowth.ai/api/auth/google/callback",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function idToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

describe("PKCE and state", () => {
  it("produces a verifier in the RFC 7636 length range", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("derives a stable S256 challenge", () => {
    const verifier = "test-verifier";
    expect(codeChallengeS256(verifier)).toBe(codeChallengeS256(verifier));
    expect(codeChallengeS256(verifier)).not.toBe(codeChallengeS256("other"));
  });

  it("compares state without leaking length or content by timing", () => {
    const state = generateState();
    expect(stateMatches(state, state)).toBe(true);
    expect(stateMatches(state, generateState())).toBe(false);
    expect(stateMatches("short", state)).toBe(false);
  });
});

describe("buildAuthUrl", () => {
  it("asks for identity only when Search Console is not being requested", () => {
    const url = new URL(
      buildAuthUrl({
        config: CONFIG,
        state: "state-value",
        codeChallenge: "challenge",
        includeSearchConsole: false,
      }),
    );

    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // Sign-in needs no refresh token, so it keeps online access — and with it
    // the near-silent redirect-through for someone who already granted.
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.searchParams.get("prompt")).toBeNull();
  });

  it("adds the read-only Search Console scope when requested", () => {
    const url = new URL(
      buildAuthUrl({
        config: CONFIG,
        state: "state-value",
        codeChallenge: "challenge",
        includeSearchConsole: true,
      }),
    );

    expect(url.searchParams.get("scope")).toContain(GSC_SCOPE);
    expect(url.searchParams.get("scope")).toContain("readonly");
  });

  it("asks for offline access AND re-consent on the Search Console grant", () => {
    const url = new URL(
      buildAuthUrl({
        config: CONFIG,
        state: "state-value",
        codeChallenge: "challenge",
        includeSearchConsole: true,
      }),
    );

    expect(url.searchParams.get("access_type")).toBe("offline");
    // `prompt=consent` is not a nicety. Google issues a refresh token only on a
    // FIRST authorization for a client+user pair, and every current visitor has
    // already authorized through the online flow — so offline access on its own
    // would return no refresh token for exactly the returning visitors this
    // exists for, and every unit test here would still pass.
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });
});

describe("refreshAccessToken", () => {
  it("returns the new access token and its lifetime", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse({
          access_token: "test-access-token-2",
          expires_in: 3_599,
          scope: `openid email profile ${GSC_SCOPE}`,
        }),
      ),
    );

    const result = await refreshAccessToken({
      config: CONFIG,
      refreshToken: "test-refresh-token",
      fetchImpl,
    });

    expect(result).toEqual({
      kind: "refreshed",
      accessToken: "test-access-token-2",
      expiresInSeconds: 3_599,
      grantedScopes: ["openid", "email", "profile", GSC_SCOPE],
    });
  });

  it("sends a refresh grant and never a PKCE verifier", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({ access_token: "test-access-token-2" })),
    );

    await refreshAccessToken({
      config: CONFIG,
      refreshToken: "test-refresh-token",
      fetchImpl,
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const body = String(init?.body);
    expect(url).not.toContain("test-refresh-token");
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=test-refresh-token");
    expect(body).not.toContain("code_verifier");
  });

  it("reports invalid_grant, the one answer that means the grant is gone", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({ error: "invalid_grant" }, 400)),
    );

    await expect(
      refreshAccessToken({
        config: CONFIG,
        refreshToken: "test-refresh-token",
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "invalid_grant" });
  });

  it("treats our own misconfiguration as transient, never as a lost grant", async () => {
    // `invalid_client` is a deployment mistake on our side. Reading it as
    // "revoked" would delete a perfectly good grant from every visitor's
    // browser the moment a secret was rotated wrong.
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({ error: "invalid_client" }, 401)),
    );

    await expect(
      refreshAccessToken({
        config: CONFIG,
        refreshToken: "test-refresh-token",
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "transient" });
  });

  it("treats a server error as transient", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({}, 500)),
    );

    await expect(
      refreshAccessToken({
        config: CONFIG,
        refreshToken: "test-refresh-token",
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "transient" });
  });

  it("treats a network failure as transient", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.reject(new Error("socket hang up")),
    );

    await expect(
      refreshAccessToken({
        config: CONFIG,
        refreshToken: "test-refresh-token",
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "transient" });
  });

  it("treats a success body without a token as transient", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({ expires_in: 3_600 })),
    );

    await expect(
      refreshAccessToken({
        config: CONFIG,
        refreshToken: "test-refresh-token",
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "transient" });
  });
});

describe("revokeToken", () => {
  it("posts the token in the body and reports success", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response("", { status: 200 })),
    );

    await expect(
      revokeToken({ token: "test-refresh-token", fetchImpl }),
    ).resolves.toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).not.toContain("test-refresh-token");
    expect(String(init?.body)).toBe("token=test-refresh-token");
  });

  it("treats an already-invalid token as revoked", async () => {
    // Nothing is left to revoke, which is the state the caller asked for.
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({ error: "invalid_token" }, 400)),
    );

    await expect(
      revokeToken({ token: "test-refresh-token", fetchImpl }),
    ).resolves.toBe(true);
  });

  it("reports a server error as not revoked", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({}, 500)),
    );

    await expect(
      revokeToken({ token: "test-refresh-token", fetchImpl }),
    ).resolves.toBe(false);
  });

  it("reports a network failure as not revoked", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.reject(new Error("socket hang up")),
    );

    await expect(
      revokeToken({ token: "test-refresh-token", fetchImpl }),
    ).resolves.toBe(false);
  });
});

describe("readGoogleOAuthConfig", () => {
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  });

  it("throws a config error when the site is not set up", () => {
    expect(() => readGoogleOAuthConfig()).toThrow(GoogleOAuthError);
  });

  it("reads the variables the gengrowth.ai project already carries", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REDIRECT_URI = "https://gengrowth.ai/cb";

    expect(readGoogleOAuthConfig()).toEqual({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://gengrowth.ai/cb",
    });
  });
});

describe("exchangeCode", () => {
  it("returns the token set with the subject as identity", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse({
          access_token: "at-123",
          expires_in: 3_599,
          scope: `openid email profile ${GSC_SCOPE}`,
          id_token: idToken({ sub: "10769150350006150715", email: "a@b.com" }),
        }),
      ),
    );

    const tokens = await exchangeCode({
      config: CONFIG,
      code: "auth-code",
      codeVerifier: "verifier",
      fetchImpl,
    });

    expect(tokens.accessToken).toBe("at-123");
    // sub, not email: an email can be reassigned, a subject cannot.
    expect(tokens.sub).toBe("10769150350006150715");
    expect(hasSearchConsoleScope(tokens.grantedScopes)).toBe(true);
  });

  it("carries the refresh token when Google issues one, and null when it does not", async () => {
    const withRefresh = await exchangeCode({
      config: CONFIG,
      code: "c",
      codeVerifier: "v",
      fetchImpl: vi.fn<FetchLike>(() =>
        Promise.resolve(
          jsonResponse({
            access_token: "test-access-token",
            refresh_token: "test-refresh-token",
          }),
        ),
      ),
    });
    expect(withRefresh.refreshToken).toBe("test-refresh-token");

    // Google withholds it whenever the user has already granted this client
    // without being re-prompted. Reading the absence as `null` rather than
    // inventing one is what lets the grant degrade to today's behaviour.
    const without = await exchangeCode({
      config: CONFIG,
      code: "c",
      codeVerifier: "v",
      fetchImpl: vi.fn<FetchLike>(() =>
        Promise.resolve(jsonResponse({ access_token: "test-access-token" })),
      ),
    });
    expect(without.refreshToken).toBeNull();
  });

  it("sends the verifier and never puts the code in the URL", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({ access_token: "at" })),
    );

    await exchangeCode({
      config: CONFIG,
      code: "auth-code",
      codeVerifier: "verifier-value",
      fetchImpl,
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).not.toContain("auth-code");
    expect(String(init?.body)).toContain("code_verifier=verifier-value");
  });

  it("reports a rejected code without echoing the provider body", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse({ error: "invalid_grant", client_secret: "leaked" }, 400),
      ),
    );

    const attempt = exchangeCode({
      config: CONFIG,
      code: "bad",
      codeVerifier: "v",
      fetchImpl,
    });

    await expect(attempt).rejects.toMatchObject({ code: "exchange" });
    await expect(attempt).rejects.not.toMatchObject({
      message: expect.stringContaining("leaked"),
    });
  });

  it("detects a grant where the user unchecked Search Console", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse({ access_token: "at", scope: "openid email profile" }),
      ),
    );

    const tokens = await exchangeCode({
      config: CONFIG,
      code: "c",
      codeVerifier: "v",
      fetchImpl,
    });

    expect(hasSearchConsoleScope(tokens.grantedScopes)).toBe(false);
  });
});

describe("listSearchConsoleProperties", () => {
  it("returns the properties the visitor can actually read", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse({
          siteEntry: [
            { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
            {
              siteUrl: "https://blog.example.com/",
              permissionLevel: "siteFullUser",
            },
            {
              siteUrl: "https://nope.example/",
              permissionLevel: "siteUnverifiedUser",
            },
          ],
        }),
      ),
    );

    const properties = await listSearchConsoleProperties({
      accessToken: "at",
      fetchImpl,
    });

    // The unverified property is dropped: offering it would fail later with a
    // confusing error rather than being honestly absent now.
    expect(properties).toEqual([
      "sc-domain:example.com",
      "https://blog.example.com/",
    ]);
  });

  it("returns an empty list when the account has no properties", async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse({})));

    await expect(
      listSearchConsoleProperties({ accessToken: "at", fetchImpl }),
    ).resolves.toEqual([]);
  });

  it("raises a provider error on an HTTP failure", async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({}, 503)),
    );

    await expect(
      listSearchConsoleProperties({ accessToken: "at", fetchImpl }),
    ).rejects.toMatchObject({ code: "provider" });
  });
});
