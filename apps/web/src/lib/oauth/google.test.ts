import { describe, expect, it, vi } from "vitest";
import {
  buildAuthUrl,
  codeChallengeS256,
  generateCodeVerifier,
  generateState,
  googleRedirectUri,
  hashState,
  HttpGoogleOAuthClient,
  stateMatchesHash,
} from "./google.ts";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function oversizedJson(body: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ ...body, oversizedFixture: "oauth-body-secret".repeat(128) }),
    { headers: { "content-type": "application/json" } },
  );
}

const WAIT_MARKER = Symbol("still waiting for a bounded Google response");

describe("Google OAuth PKCE and authorization URL", () => {
  it("generates high-entropy URL-safe verifier/state values and a deterministic challenge", () => {
    const verifier = generateCodeVerifier();
    const state = generateState();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeChallengeS256("known-verifier")).toBe(
      "GZgROX6_AnvkowfutuOh_RiBDjJoEWf1Zz8BUNStfzM",
    );
  });

  it("compares only equal-length state hashes in constant time", () => {
    const stored = hashState("state-1");
    expect(stateMatchesHash("state-1", stored)).toBe(true);
    expect(stateMatchesHash("state-2", stored)).toBe(false);
    expect(stateMatchesHash("state-1", stored.subarray(0, 16))).toBe(false);
  });

  it.each([
    ["gsc", "https://www.googleapis.com/auth/webmasters.readonly"],
    ["ga4", "https://www.googleapis.com/auth/analytics.readonly"],
  ] as const)("builds a strict %s consent URL", (provider, scope) => {
    const url = new URL(
      buildAuthUrl({
        provider,
        clientId: "client-id",
        redirectUri: "https://app.example/oauth/callback",
        state: "opaque-state",
        codeChallenge: "challenge",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-id",
      redirect_uri: "https://app.example/oauth/callback",
      response_type: "code",
      scope,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state: "opaque-state",
      code_challenge: "challenge",
      code_challenge_method: "S256",
    });
  });

  it("derives the exact same-origin callback URI", () => {
    expect(googleRedirectUri("https://app.example/base")).toBe(
      "https://app.example/api/mvp/oauth/google/callback",
    );
  });
});

describe("HttpGoogleOAuthClient token exchange and GSC properties", () => {
  it.each(["non-2xx", "declared-oversize"] as const)(
    "best-effort cancels a %s response body without reading or leaking cancellation errors",
    async (scenario) => {
      const cancel = vi.fn(() => {
        throw new Error("cancel failed near response-body-secret");
      });
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("provider-body-secret"));
        },
        cancel,
      });
      const response = new Response(body, {
        status: scenario === "non-2xx" ? 503 : 200,
        ...(scenario === "declared-oversize"
          ? { headers: { "content-length": "513" } }
          : {}),
      });
      const client = new HttpGoogleOAuthClient({
        clientId: "client",
        clientSecret: "secret",
        fetchImpl: async () => response,
        maxResponseBytes: 512,
      });

      const error = await client
        .exchangeCode({
          code: "code",
          codeVerifier: "verifier",
          redirectUri: "https://app.example/callback",
        })
        .catch((value: unknown) => value);

      expect(error).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(String((error as Error).message)).not.toContain("response-body-secret");
      expect(String((error as Error).message)).not.toContain("provider-body-secret");
    },
  );

  it.each(["token", "gsc", "ga4-summary", "ga4-property"] as const)(
    "bounds the %s HTTP call with an AbortSignal and maps timeout without leaking transport details",
    async (target) => {
      const signals: AbortSignal[] = [];
      const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        const isTarget =
          target === "token"
            ? url.pathname.endsWith("/token")
            : target === "gsc"
              ? url.pathname.endsWith("/sites")
              : target === "ga4-summary"
                ? url.pathname.endsWith("/accountSummaries")
                : url.pathname.endsWith("/properties/9");
        if (!isTarget) {
          return json({
            accountSummaries: [
              { propertySummaries: [{ property: "properties/9" }] },
            ],
          });
        }
        if (!init?.signal) {
          throw new Error("missing signal near oauth-timeout-secret");
        }
        signals.push(init.signal);
        return new Promise<Response>((_resolve, reject) => {
          const rejectFromSignal = (): void => reject(init.signal?.reason);
          if (init.signal?.aborted) rejectFromSignal();
          else init.signal?.addEventListener("abort", rejectFromSignal, { once: true });
        });
      });
      const client = new HttpGoogleOAuthClient({
        clientId: "client",
        clientSecret: "secret",
        fetchImpl,
        timeoutMs: 1,
      });

      const operation =
        target === "token"
          ? client.exchangeCode({
              code: "code",
              codeVerifier: "verifier",
              redirectUri: "https://app.example/callback",
            })
          : client.listProperties(target === "gsc" ? "gsc" : "ga4", "access");
      const error = await operation.catch((value: unknown) => value);

      expect(error).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 });
      expect(String((error as Error).message)).toContain("timed out");
      expect(String((error as Error).message)).not.toContain("oauth-timeout-secret");
      expect(signals).toHaveLength(1);
    },
  );

  it.each(["token", "gsc", "ga4-summary", "ga4-property"] as const)(
    "still times out when the %s response returns headers but its body never yields",
    async (target) => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      const stalledReader = {
        read: vi.fn(() => new Promise<never>(() => undefined)),
        cancel,
        releaseLock: vi.fn(),
      };
      const stalledResponse = {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { getReader: () => stalledReader },
      } as unknown as Response;
      const fetchImpl = vi.fn(async (input: string) => {
        const url = new URL(input);
        const isTarget =
          target === "token"
            ? url.pathname.endsWith("/token")
            : target === "gsc"
              ? url.pathname.endsWith("/sites")
              : target === "ga4-summary"
                ? url.pathname.endsWith("/accountSummaries")
                : url.pathname.endsWith("/properties/9");
        if (isTarget) return stalledResponse;
        return json({
          accountSummaries: [
            { propertySummaries: [{ property: "properties/9" }] },
          ],
        });
      });
      const client = new HttpGoogleOAuthClient({
        clientId: "client",
        clientSecret: "secret",
        fetchImpl,
        timeoutMs: 1,
        operationTimeoutMs: 10,
      });

      const operation = (
        target === "token"
          ? client.exchangeCode({
              code: "code",
              codeVerifier: "verifier",
              redirectUri: "https://app.example/callback",
            })
          : client.listProperties(target === "gsc" ? "gsc" : "ga4", "access")
      ).catch((value: unknown) => value);
      const outcome = await Promise.race([
        operation,
        new Promise<typeof WAIT_MARKER>((resolve) => {
          setTimeout(() => resolve(WAIT_MARKER), 50);
        }),
      ]);

      expect(outcome).not.toBe(WAIT_MARKER);
      expect(outcome).toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        status: 503,
      });
      expect(String((outcome as Error).message)).toContain("timed out");
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["token", "gsc", "ga4-summary", "ga4-property"] as const)(
    "rejects an oversized %s JSON response without exposing its body",
    async (target) => {
      const fetchImpl = vi.fn(async (input: string) => {
        const url = new URL(input);
        if (target === "token") {
          return oversizedJson({ access_token: "access", expires_in: 3600 });
        }
        if (target === "gsc") {
          return oversizedJson({
            siteEntry: [
              { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
            ],
          });
        }
        if (url.pathname.endsWith("/accountSummaries")) {
          const summary = {
            accountSummaries: [
              { propertySummaries: [{ property: "properties/9" }] },
            ],
          };
          return target === "ga4-summary" ? oversizedJson(summary) : json(summary);
        }
        return oversizedJson({ timeZone: "UTC" });
      });
      const client = new HttpGoogleOAuthClient({
        clientId: "client",
        clientSecret: "secret",
        fetchImpl,
        maxResponseBytes: 512,
      });

      const operation =
        target === "token"
          ? client.exchangeCode({
              code: "code",
              codeVerifier: "verifier",
              redirectUri: "https://app.example/callback",
            })
          : client.listProperties(target === "gsc" ? "gsc" : "ga4", "access");
      const error = await operation.catch((value: unknown) => value);

      expect(error).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 });
      expect(String((error as Error).message)).toContain("response exceeded");
      expect(String((error as Error).message)).not.toContain("oauth-body-secret");
    },
  );

  it("exchanges a code using PKCE without leaking the client secret into the URL", async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) =>
      json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "readonly",
      }),
    );
    const client = new HttpGoogleOAuthClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl,
    });
    await expect(
      client.exchangeCode({
        code: "authorization-code",
        codeVerifier: "verifier",
        redirectUri: "https://app.example/callback",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      scope: "readonly",
      expiresAt: expect.any(String),
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(url).not.toContain("client-secret");
    expect(init).toMatchObject({ method: "POST" });
    const form = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: "authorization_code",
      client_id: "client-id",
      client_secret: "client-secret",
      code_verifier: "verifier",
    });
  });

  it("normalizes optional refresh token and scope fields", async () => {
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async () => json({ access_token: "access", expires_in: 10 }),
    });
    await expect(
      client.exchangeCode({ code: "code", codeVerifier: "v", redirectUri: "https://app" }),
    ).resolves.toMatchObject({ refreshToken: null, scope: "" });
  });

  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "OAUTH_PROPERTY_INVALID"],
    [429, "RATE_LIMITED"],
    [500, "DEPENDENCY_UNAVAILABLE"],
  ])("maps token endpoint status %i to %s", async (status, code) => {
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async () => json({ provider: "secret prose" }, status),
    });
    await expect(
      client.exchangeCode({ code: "code", codeVerifier: "v", redirectUri: "https://app" }),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    { access_token: undefined, expires_in: 10 },
    { access_token: "access", expires_in: "3600" },
  ])("rejects malformed token payload %#", async (payload) => {
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async () => json(payload),
    });
    await expect(
      client.exchangeCode({ code: "code", codeVerifier: "v", redirectUri: "https://app" }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("filters unverified or malformed GSC entries", async () => {
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async () =>
        json({
          siteEntry: [
            { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
            { siteUrl: "https://unverified.example", permissionLevel: "siteUnverifiedUser" },
            { permissionLevel: "siteOwner" },
          ],
        }),
    });
    await expect(client.listProperties("gsc", "access")).resolves.toEqual([
      {
        externalPropertyId: "sc-domain:example.com",
        displayName: "sc-domain:example.com",
      },
    ]);
  });

  it("treats an omitted GSC list as empty and maps provider errors", async () => {
    const empty = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async () => json({}),
    });
    await expect(empty.listProperties("gsc", "access")).resolves.toEqual([]);

    const denied = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async () => json({}, 403),
    });
    await expect(
      denied.listProperties("gsc", "access"),
    ).rejects.toMatchObject({ code: "OAUTH_PROPERTY_INVALID" });
  });

  it("rejects more than 500 verified GSC candidates instead of persisting an unbounded picker", async () => {
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async () =>
        json({
          siteEntry: Array.from({ length: 501 }, (_, index) => ({
            siteUrl: `sc-domain:site-${index}.example`,
            permissionLevel: "siteOwner",
          })),
        }),
    });

    const error = await client
      .listProperties("gsc", "access")
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 });
    expect(String((error as Error).message)).toContain("candidate limit");
  });
});

describe("HttpGoogleOAuthClient GA4 property metadata", () => {
  it("rejects more than 500 GA4 candidates before issuing metadata fan-out", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input);
      return url.pathname.endsWith("/accountSummaries")
        ? json({
            accountSummaries: [
              {
                propertySummaries: Array.from({ length: 501 }, (_, index) => ({
                  property: `properties/${index + 1}`,
                })),
              },
            ],
          })
        : json({ timeZone: "UTC" });
    });
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl,
    });

    const error = await client
      .listProperties("ga4", "access")
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 });
    expect(String((error as Error).message)).toContain("candidate limit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies one overall deadline across GA4 summaries and metadata requests", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/accountSummaries")) {
        return json({
          accountSummaries: [
            { propertySummaries: [{ property: "properties/1" }] },
          ],
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        const fallback = setTimeout(
          () => reject(new Error("overall deadline missing near provider-secret")),
          20,
        );
        const rejectFromSignal = (): void => {
          clearTimeout(fallback);
          reject(init?.signal?.reason);
        };
        if (init?.signal?.aborted) rejectFromSignal();
        else init?.signal?.addEventListener("abort", rejectFromSignal, { once: true });
      });
    });
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl,
      timeoutMs: 1_000,
      operationTimeoutMs: 1,
    });

    const error = await client
      .listProperties("ga4", "access")
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 });
    expect(String((error as Error).message)).toContain("timed out");
    expect(String((error as Error).message)).not.toContain("provider-secret");
  });

  it("loads GA4 metadata with bounded concurrency instead of a 500-request serial tail", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/accountSummaries")) {
        return json({
          accountSummaries: [
            {
              propertySummaries: Array.from({ length: 12 }, (_, index) => ({
                property: `properties/${index + 1}`,
              })),
            },
          ],
        });
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return json({ timeZone: "UTC" });
    });
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl,
    });

    await expect(client.listProperties("ga4", "access")).resolves.toHaveLength(12);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(8);
  });

  it("paginates account summaries and loads each property's real timezone", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      calls.push(input);
      const url = new URL(input);
      if (url.pathname.endsWith("/accountSummaries")) {
        if (url.searchParams.get("pageToken") === "page-2") {
          return json({
            accountSummaries: [
              {
                propertySummaries: [
                  { property: "properties/2", displayName: "Shop" },
                ],
              },
            ],
          });
        }
        return json({
          accountSummaries: [
            {
              propertySummaries: [
                { property: "properties/1", displayName: "SaaS" },
              ],
            },
          ],
          nextPageToken: "page-2",
        });
      }
      if (url.pathname.endsWith("/properties/1")) {
        return json({ name: "properties/1", timeZone: "Europe/Berlin" });
      }
      if (url.pathname.endsWith("/properties/2")) {
        return json({ name: "properties/2", timeZone: "Asia/Shanghai" });
      }
      return json({}, 404);
    });
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl,
    });

    await expect(client.listProperties("ga4", "access-token")).resolves.toEqual([
      {
        externalPropertyId: "1",
        displayName: "SaaS",
        propertyTimeZone: "Europe/Berlin",
      },
      {
        externalPropertyId: "2",
        displayName: "Shop",
        propertyTimeZone: "Asia/Shanghai",
      },
    ]);
    expect(calls.filter((url) => url.includes("accountSummaries"))).toHaveLength(2);
    expect(calls).toContain(
      "https://analyticsadmin.googleapis.com/v1beta/properties/1",
    );
    expect(calls).toContain(
      "https://analyticsadmin.googleapis.com/v1beta/properties/2",
    );
  });

  it.each([undefined, "Not/A_Timezone"])(
    "rejects a GA4 property whose timezone is missing or invalid (%s)",
    async (propertyTimeZone) => {
      const fetchImpl = vi.fn(async (input: string) => {
        const url = new URL(input);
        return url.pathname.endsWith("/accountSummaries")
          ? json({
              accountSummaries: [
                {
                  propertySummaries: [
                    { property: "properties/1", displayName: "Broken" },
                  ],
                },
              ],
            })
          : json({ name: "properties/1", timeZone: propertyTimeZone });
      });
      const client = new HttpGoogleOAuthClient({
        clientId: "client",
        clientSecret: "secret",
        fetchImpl,
      });

      await expect(
        client.listProperties("ga4", "access-token"),
      ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    },
  );

  it("uses the resource name as display fallback and skips empty summaries", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input);
      return url.pathname.endsWith("/accountSummaries")
        ? json({
            accountSummaries: [
              {},
              {
                propertySummaries: [
                  {},
                  { property: "properties/7" },
                ],
              },
            ],
          })
        : json({ timeZone: "UTC" });
    });
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl,
    });
    await expect(client.listProperties("ga4", "access")).resolves.toEqual([
      {
        externalPropertyId: "7",
        displayName: "properties/7",
        propertyTimeZone: "UTC",
      },
    ]);
  });

  it("rejects malformed property resource names", async () => {
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async () =>
        json({
          accountSummaries: [
            { propertySummaries: [{ property: "accounts/1/property/7" }] },
          ],
        }),
    });
    await expect(client.listProperties("ga4", "access")).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });

  it("rejects repeated pagination tokens instead of looping forever", async () => {
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async () => json({ nextPageToken: "same-token" }),
    });
    await expect(client.listProperties("ga4", "access")).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });

  it.each([
    ["accountSummaries", 429, "RATE_LIMITED"],
    ["properties/9", 401, "AUTH_REQUIRED"],
  ])("maps a failed GA4 %s request", async (target, status, code) => {
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith(target)) return json({}, status);
      return json({
        accountSummaries: [
          { propertySummaries: [{ property: "properties/9" }] },
        ],
      });
    });
    const client = new HttpGoogleOAuthClient({
      clientId: "client",
      clientSecret: "secret",
      fetchImpl,
    });
    await expect(client.listProperties("ga4", "access")).rejects.toMatchObject({
      code,
    });
  });
});
