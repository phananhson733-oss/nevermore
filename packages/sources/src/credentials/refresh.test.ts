import { describe, expect, it, vi } from "vitest";
import { SourceError } from "../adapter.ts";
import type { OAuthCredentialEnvelope } from "./envelope.ts";
import {
  GOOGLE_OAUTH_TOKEN_ENDPOINT,
  GOOGLE_TOKEN_REFRESH_SKEW_MS,
  HttpGoogleTokenRefresher,
  shouldRefreshCredential,
} from "./refresh.ts";

const NOW = new Date("2026-07-18T08:00:00.000Z");

function credential(
  overrides: Partial<OAuthCredentialEnvelope> = {},
): OAuthCredentialEnvelope {
  return {
    accessToken: "access-before-refresh",
    refreshToken: "refresh-fixture-before",
    expiresAt: "2026-07-18T09:00:00.000Z",
    scope: "scope.one scope.two",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function trackedStreamResponse(input: {
  readonly body: string;
  readonly status?: number;
  readonly contentLength?: number;
}): { readonly response: Response; wasCancelled(): boolean } {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(input.body));
    },
    cancel() {
      cancelled = true;
    },
  });
  const headers = new Headers({ "content-type": "application/json" });
  if (input.contentLength !== undefined) {
    headers.set("content-length", String(input.contentLength));
  }
  return {
    response: new Response(stream, { status: input.status ?? 200, headers }),
    wasCancelled: () => cancelled,
  };
}

function delayedBodyFailureResponse(secret: string): Response {
  let safetyTimer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      safetyTimer = setTimeout(() => controller.error(new Error(secret)), 50);
    },
    cancel() {
      if (safetyTimer) clearTimeout(safetyTimer);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/json" },
  });
}

describe("shouldRefreshCredential", () => {
  it("refreshes inside the pre-expiry safety window, including its boundary", () => {
    const atBoundary = credential({
      expiresAt: new Date(
        NOW.getTime() + GOOGLE_TOKEN_REFRESH_SKEW_MS,
      ).toISOString(),
    });
    const outsideWindow = credential({
      expiresAt: new Date(
        NOW.getTime() + GOOGLE_TOKEN_REFRESH_SKEW_MS + 1,
      ).toISOString(),
    });

    expect(shouldRefreshCredential(atBoundary, NOW)).toBe(true);
    expect(shouldRefreshCredential(outsideWindow, NOW)).toBe(false);
  });

  it("does not invent an expiry when it is missing or malformed", () => {
    expect(shouldRefreshCredential(credential({ expiresAt: null }), NOW)).toBe(
      false,
    );
    expect(
      shouldRefreshCredential(credential({ expiresAt: "not-a-date" }), NOW),
    ).toBe(false);
  });
});

describe("HttpGoogleTokenRefresher", () => {
  it("posts the refresh grant and preserves refresh token and scope when Google omits them", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        access_token: "access-after-refresh",
        expires_in: 3_600,
      }),
    );
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: fetchMock,
      now: () => NOW,
    });

    const refreshed = await refresher.refresh(credential());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(String(input)).toBe(GOOGLE_OAUTH_TOKEN_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-fixture-before",
      client_id: "client-id-fixture",
      client_secret: "client-secret-fixture",
    });
    expect(refreshed).toEqual({
      accessToken: "access-after-refresh",
      refreshToken: "refresh-fixture-before",
      expiresAt: "2026-07-18T09:00:00.000Z",
      scope: "scope.one scope.two",
    });
  });

  it("persists rotated refresh token and scope when Google returns them", async () => {
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () =>
        jsonResponse({
          access_token: "access-after-refresh",
          refresh_token: "refresh-fixture-rotated",
          expires_in: 900,
          scope: "scope.two scope.three",
        }),
      now: () => NOW,
    });

    await expect(refresher.refresh(credential())).resolves.toEqual({
      accessToken: "access-after-refresh",
      refreshToken: "refresh-fixture-rotated",
      expiresAt: "2026-07-18T08:15:00.000Z",
      scope: "scope.two scope.three",
    });
  });

  it("maps invalid_grant to AUTH_REQUIRED without reflecting provider prose or tokens", async () => {
    const leakedDescription = "revoked refresh-fixture-before";
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () =>
        jsonResponse(
          { error: "invalid_grant", error_description: leakedDescription },
          400,
        ),
      now: () => NOW,
    });

    const error = await refresher.refresh(credential()).catch((value: unknown) =>
      value,
    );

    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(String((error as Error).message)).not.toContain(leakedDescription);
    expect(String((error as Error).message)).not.toContain(
      "refresh-fixture-before",
    );
  });

  it.each(["invalid_client", "unauthorized_client"])(
    "maps token-endpoint %s to INVALID_CONFIGURATION instead of blaming user consent",
    async (providerCode) => {
      const refresher = new HttpGoogleTokenRefresher({
        clientId: "client-id-fixture",
        clientSecret: "client-secret-fixture",
        fetch: async () => jsonResponse({ error: providerCode }, 401),
      });

      await expect(refresher.refresh(credential())).rejects.toMatchObject({
        code: "INVALID_CONFIGURATION",
      });
    },
  );

  it.each([
    [408, "TIMEOUT"],
    [429, "RATE_LIMITED"],
    [500, "NETWORK_ERROR"],
    [503, "NETWORK_ERROR"],
  ] as const)("maps HTTP %i to retry/error code %s", async (status, code) => {
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () => jsonResponse({ error: "provider-failure" }, status),
      now: () => NOW,
    });

    await expect(refresher.refresh(credential())).rejects.toMatchObject({
      code,
    });
  });

  it("treats OAuth temporarily_unavailable as transient even when returned with HTTP 400", async () => {
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () =>
        jsonResponse({ error: "temporarily_unavailable" }, 400),
    });

    await expect(refresher.refresh(credential())).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("maps transport and abort failures without leaking their messages", async () => {
    const transport = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () => {
        throw new Error("socket failed near refresh-fixture-before");
      },
    });
    const aborted = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () => {
        throw new DOMException("refresh-fixture-before", "AbortError");
      },
    });
    const crossRealmTimeout = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () => {
        throw { name: "TimeoutError", message: "refresh-fixture-before" };
      },
    });

    const transportError = await transport
      .refresh(credential())
      .catch((value: unknown) => value);
    const abortError = await aborted
      .refresh(credential())
      .catch((value: unknown) => value);
    const timeoutError = await crossRealmTimeout
      .refresh(credential())
      .catch((value: unknown) => value);

    expect(transportError).toMatchObject({ code: "NETWORK_ERROR" });
    expect(abortError).toMatchObject({ code: "TIMEOUT" });
    expect(timeoutError).toMatchObject({ code: "TIMEOUT" });
    expect((transportError as Error).message).not.toContain(
      "refresh-fixture-before",
    );
    expect((abortError as Error).message).not.toContain(
      "refresh-fixture-before",
    );
    expect((timeoutError as Error).message).not.toContain(
      "refresh-fixture-before",
    );
  });

  it("bounds a hung token request and maps the abort to retryable TIMEOUT", async () => {
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      timeoutMs: 1,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing timeout signal"));
            return;
          }
          const rejectFromSignal = (): void => reject(signal.reason);
          if (signal.aborted) rejectFromSignal();
          else signal.addEventListener("abort", rejectFromSignal, { once: true });
        }),
    });

    await expect(refresher.refresh(credential())).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("times out after headers when the token response body never completes", async () => {
    const leakedStreamError = "token body stream refresh-fixture-before";
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () => delayedBodyFailureResponse(leakedStreamError),
      timeoutMs: 5,
    });

    const error = await refresher.refresh(credential()).catch(
      (value: unknown) => value,
    );

    expect(error).toMatchObject({ code: "TIMEOUT" });
    expect((error as Error).message).not.toContain(leakedStreamError);
    expect((error as Error).message).not.toContain("refresh-fixture-before");
  });

  it("rejects and cancels an oversized successful token response", async () => {
    const tracked = trackedStreamResponse({
      body: JSON.stringify({
        access_token: "access-after-refresh",
        expires_in: 3_600,
        padding: "x".repeat(256),
      }),
      contentLength: 1,
    });
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () => tracked.response,
      maxResponseBytes: 64,
    });

    await expect(refresher.refresh(credential())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(tracked.wasCancelled()).toBe(true);
  });

  it("bounds an OAuth 400 error body without reflecting its provider prose", async () => {
    const leakedDescription = `revoked refresh-fixture-before ${"x".repeat(256)}`;
    const tracked = trackedStreamResponse({
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: leakedDescription,
      }),
      contentLength: 1,
      status: 400,
    });
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () => tracked.response,
      maxResponseBytes: 64,
    });

    const error = await refresher.refresh(credential()).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
    expect((error as Error).message).not.toContain("refresh-fixture-before");
    expect(tracked.wasCancelled()).toBe(true);
  });

  it("maps an error-body stream failure without leaking its message", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("stream failed near refresh-fixture-before"));
      },
    });
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () =>
        new Response(stream, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    });

    const error = await refresher.refresh(credential()).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    expect((error as Error).message).not.toContain("refresh-fixture-before");
  });

  it("cancels an unread non-400 error body before status mapping", async () => {
    const tracked = trackedStreamResponse({
      body: JSON.stringify({ error: "provider prose" }),
      status: 429,
    });
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () => tracked.response,
    });

    await expect(refresher.refresh(credential())).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(tracked.wasCancelled()).toBe(true);
  });

  it("requires a stored refresh token before making an HTTP request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: fetchMock,
    });

    await expect(
      refresher.refresh(credential({ refreshToken: null })),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed success payloads instead of fabricating credential fields", async () => {
    const refresher = new HttpGoogleTokenRefresher({
      clientId: "client-id-fixture",
      clientSecret: "client-secret-fixture",
      fetch: async () => jsonResponse({ access_token: "" }),
    });

    await expect(refresher.refresh(credential())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
