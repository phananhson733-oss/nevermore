import { describe, expect, it, vi } from "vitest";

import { PublishingProviderError } from "./errors";
import {
  createBoundedJsonTransport,
  type FetchLike,
  type ResolvedEndpoint,
  type ResolveHostname,
} from "./http";

const PUBLIC_RESOLVER: ResolveHostname = async () => ["93.184.216.34"];

function jsonResponse(
  body: unknown,
  init: {
    status?: number;
    headers?: Record<string, string>;
  } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

describe("bounded provider HTTP transport", () => {
  it("passes the validated DNS addresses to the pinned fetch seam", async () => {
    let endpoint: ResolvedEndpoint | null = null;
    const fetchImpl: FetchLike = async (_input, _init, resolvedEndpoint) => {
      endpoint = resolvedEndpoint;
      return jsonResponse({ ok: true });
    };
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: async () => [
        "93.184.216.34",
        "2606:2800:220:1:248:1893:25c8:1946",
      ],
    });

    await transport.request({
      provider: "wordpress",
      operation: "probe_site",
      method: "GET",
      url: "https://content.example.com/wp-json/",
      allowedOrigins: ["https://content.example.com"],
      retry: "safe_read",
    });

    expect(endpoint).toEqual({
      origin: "https://content.example.com",
      hostname: "content.example.com",
      addresses: [
        "93.184.216.34",
        "2606:2800:220:1:248:1893:25c8:1946",
      ],
    });
  });

  it("retries only a bounded safe read and returns provider request metadata", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "temporarily unavailable" },
          {
            status: 503,
            headers: { "x-github-request-id": "gh-request-1" },
          },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { id: 991 },
          { headers: { "x-github-request-id": "gh-request-2" } },
        ),
      );
    const sleeps: number[] = [];
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      resolveHostname: PUBLIC_RESOLVER,
      maxAttempts: 2,
      retryBackoffMs: [100],
    });

    const result = await transport.request<{ id: number }>({
      provider: "github",
      operation: "probe_repository",
      method: "GET",
      url: "https://api.github.com/repos/relayops/website",
      allowedOrigins: ["https://api.github.com"],
      headers: { authorization: "Bearer short-lived-token" },
      secrets: ["short-lived-token"],
      retry: "safe_read",
    });

    expect(result).toMatchObject({
      status: 200,
      body: { id: 991 },
      providerRequestId: "gh-request-2",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([100]);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
    });
  });

  it("never retries an ambiguous external write and redacts provider prose and secrets", async () => {
    const secret = "wordpress-application-password";
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(
      new Error(`socket failed while using ${secret}`),
    );
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      maxAttempts: 3,
    });

    const error = await transport
      .request({
        provider: "wordpress",
        operation: "create_post",
        method: "POST",
        url: "https://content.example.com/wp-json/wp/v2/posts",
        allowedOrigins: ["https://content.example.com"],
        headers: { authorization: `Basic ${secret}` },
        secrets: [secret],
        body: { title: "Draft" },
        retry: "never",
      })
      .catch((cause: unknown) => cause);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(PublishingProviderError);
    expect(error).toMatchObject({
      code: "REMOTE_UNAVAILABLE",
      provider: "wordpress",
      operation: "create_post",
      retryable: true,
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain("socket failed");
  });

  it("aborts a hung request at the configured timeout", async () => {
    const fetchImpl: FetchLike = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      requestTimeoutMs: 5,
      maxAttempts: 1,
    });

    await expect(
      transport.request({
        provider: "github",
        operation: "probe_repository",
        method: "GET",
        url: "https://api.github.com/repos/relayops/website",
        allowedOrigins: ["https://api.github.com"],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      provider: "github",
      operation: "probe_repository",
    });
  });

  it(
    "bounds a response body reader that never yields",
    async () => {
      const response = jsonResponse({ ignored: true });
      Object.defineProperty(response, "body", {
        configurable: true,
        value: {
          cancel: async () => undefined,
          getReader: () => ({
            cancel: async () => undefined,
            read: async () =>
              await new Promise<
                Awaited<
                  ReturnType<
                    ReadableStreamDefaultReader<Uint8Array>["read"]
                  >
                >
              >(() => undefined),
            releaseLock: () => undefined,
          }),
        },
      });
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(response);
      const transport = createBoundedJsonTransport({
        fetch: fetchImpl,
        now: () => new Date("2026-07-27T08:00:00.000Z"),
        sleep: async () => undefined,
        resolveHostname: PUBLIC_RESOLVER,
        requestTimeoutMs: 5,
        maxAttempts: 1,
      });

      await expect(
        transport.request({
          provider: "github",
          operation: "read_repository",
          method: "GET",
          url: "https://api.github.com/repos/relayops/website",
          allowedOrigins: ["https://api.github.com"],
          retry: "safe_read",
        }),
      ).rejects.toMatchObject({
        code: "TIMEOUT",
      });
    },
    250,
  );

  it("cancels the response reader when caller aborts between chunks", async () => {
    const caller = new AbortController();
    const cancel = vi.fn(async () => undefined);
    let reads = 0;
    const response = jsonResponse({ ignored: true });
    Object.defineProperty(response, "body", {
      configurable: true,
      value: {
        cancel,
        getReader: () => ({
          cancel,
          read: async () => {
            reads += 1;
            if (reads === 1) {
              const value = {
                get byteLength() {
                  caller.abort();
                  return 1;
                },
              } as Uint8Array;
              return {
                done: false as const,
                value,
              };
            }
            return await new Promise<
              Awaited<
                ReturnType<
                  ReadableStreamDefaultReader<Uint8Array>["read"]
                >
              >
            >(() => undefined);
          },
          releaseLock: () => undefined,
        }),
      },
    });
    const transport = createBoundedJsonTransport({
      fetch: vi.fn<FetchLike>().mockResolvedValue(response),
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      requestTimeoutMs: 25,
      maxAttempts: 1,
    });

    await expect(
      transport.request({
        provider: "github",
        operation: "read_repository",
        method: "GET",
        url: "https://api.github.com/repos/relayops/website",
        allowedOrigins: ["https://api.github.com"],
        retry: "safe_read",
        signal: caller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("honors an already-aborted caller signal", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetchImpl: FetchLike = async (_input, init) => {
      if (init?.signal?.aborted === true) {
        throw new DOMException("aborted", "AbortError");
      }
      return jsonResponse({ shouldNotComplete: true });
    };
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      maxAttempts: 1,
    });

    await expect(
      transport.request({
        provider: "github",
        operation: "read_repository",
        method: "GET",
        url: "https://api.github.com/repos/relayops/website",
        allowedOrigins: ["https://api.github.com"],
        retry: "safe_read",
        signal: caller.signal,
      }),
    ).rejects.toMatchObject({
      code: "CANCELLED",
      retryable: false,
    });
  });

  it("rejects oversized responses before reading the body", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(
        { ignored: true },
        {
          headers: {
            "content-length": "4097",
            "x-request-id": "wp-request-oversize",
          },
        },
      ),
    );
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      maxResponseBytes: 4096,
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "probe_site",
        method: "GET",
        url: "https://content.example.com/wp-json/",
        allowedOrigins: ["https://content.example.com"],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
      providerRequestId: "wp-request-oversize",
    });
  });

  it("stops an undeclared oversized response stream at the byte boundary", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(3_000));
            controller.enqueue(new Uint8Array(2_000));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "stream-oversize-1",
          },
        },
      ),
    );
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      maxResponseBytes: 4_096,
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "probe_site",
        method: "GET",
        url: "https://content.example.com/wp-json/",
        allowedOrigins: ["https://content.example.com"],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
      providerRequestId: "stream-oversize-1",
    });
  });

  it("blocks redirects and private-network targets before following or fetching them", async () => {
    const redirectFetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/internal" },
      }),
    );
    const transport = createBoundedJsonTransport({
      fetch: redirectFetch,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "probe_site",
        method: "GET",
        url: "https://content.example.com/wp-json/",
        allowedOrigins: ["https://content.example.com"],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({
      code: "REDIRECT_BLOCKED",
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "probe_site",
        method: "GET",
        url: "https://127.0.0.1/wp-json/",
        allowedOrigins: ["https://127.0.0.1"],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({
      code: "UNSAFE_ENDPOINT",
    });
    expect(redirectFetch).toHaveBeenCalledTimes(1);
  });

  it("blocks a public-looking hostname when DNS resolves to a private address", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: async () => ["10.20.30.40"],
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "probe_site",
        method: "GET",
        url: "https://content.example.com/wp-json/",
        allowedOrigins: ["https://content.example.com"],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({
      code: "UNSAFE_ENDPOINT",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "[::1]",
    "[fc00::1]",
    "[fe80::1]",
    "[2001:2::1]",
    "[2001:db8::1]",
    "[2002::1]",
    "[3fff::1]",
  ])("rejects non-public literal address %s", async (host) => {
    const fetchImpl = vi.fn<FetchLike>();
    const url = `https://${host}/wp-json/`;
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "literal_address",
        method: "GET",
        url,
        allowedOrigins: [new URL(url).origin],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_ENDPOINT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [403, "SCOPE_DENIED"],
    [404, "SCOPE_REVOKED"],
    [409, "REMOTE_STALE"],
    [412, "REMOTE_STALE"],
    [418, "REMOTE_UNAVAILABLE"],
  ] as const)("maps HTTP %i to %s without provider prose", async (status, code) => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(
        { message: "arbitrary provider prose" },
        {
          status,
          headers: { "x-request-id": `status-${status}` },
        },
      ),
    );
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      maxAttempts: 1,
    });

    const error = await transport
      .request({
        provider: "wordpress",
        operation: "provider_status",
        method: "GET",
        url: "https://content.example.com/wp-json/",
        allowedOrigins: ["https://content.example.com"],
        retry: "safe_read",
      })
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code,
      providerRequestId: `status-${status}`,
    });
    expect(JSON.stringify(error)).not.toContain("arbitrary provider prose");
  });

  it("rejects invalid JSON and accepts an empty successful body deterministically", async () => {
    const invalid = createBoundedJsonTransport({
      fetch: vi
        .fn<FetchLike>()
        .mockResolvedValue(
          new Response("{", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      maxAttempts: 1,
    });
    await expect(
      invalid.request({
        provider: "github",
        operation: "invalid_json",
        method: "GET",
        url: "https://api.github.com/example",
        allowedOrigins: ["https://api.github.com"],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const empty = createBoundedJsonTransport({
      fetch: vi
        .fn<FetchLike>()
        .mockResolvedValue(new Response(null, { status: 204 })),
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      maxAttempts: 1,
    });
    await expect(
      empty.request({
        provider: "github",
        operation: "empty_success",
        method: "DELETE",
        url: "https://api.github.com/example",
        allowedOrigins: ["https://api.github.com"],
        retry: "never",
      }),
    ).resolves.toMatchObject({ body: null, status: 204 });
  });

  it.each([
    "http://content.example.com/wp-json/",
    "https://user:pass@content.example.com/wp-json/",
    "https://content.example.com:8443/wp-json/",
    "https://content.example.com/wp-json/#fragment",
    "https://localhost/wp-json/",
    "https://service.local/wp-json/",
  ])("rejects unsafe endpoint form %s", async (url) => {
    const fetchImpl = vi.fn<FetchLike>();
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "unsafe_form",
        method: "GET",
        url,
        allowedOrigins: [new URL(url).origin],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_ENDPOINT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a structured unavailable error when safe DNS resolution fails", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: async () => {
        throw new Error("resolver internals");
      },
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "resolve_site",
        method: "GET",
        url: "https://content.example.com/wp-json/",
        allowedOrigins: ["https://content.example.com"],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_UNAVAILABLE",
      operation: "resolve_site",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds DNS resolution with the same configured timeout", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    let resolverSignal: AbortSignal | undefined;
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: async (_hostname, signal) => {
        resolverSignal = signal;
        return await new Promise<readonly string[]>(() => undefined);
      },
      requestTimeoutMs: 5,
      maxAttempts: 1,
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "resolve_site",
        method: "GET",
        url: "https://content.example.com/wp-json/",
        allowedOrigins: ["https://content.example.com"],
        retry: "safe_read",
      }),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      operation: "resolve_site",
    });
    expect(resolverSignal?.aborted).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("distinguishes caller cancellation while DNS resolution is pending", async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn<FetchLike>();
    let resolverSignal: AbortSignal | undefined;
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: async (_hostname, signal) => {
        resolverSignal = signal;
        return await new Promise<readonly string[]>(() => undefined);
      },
      requestTimeoutMs: 100,
      maxAttempts: 1,
    });
    queueMicrotask(() => caller.abort());

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "resolve_site",
        method: "GET",
        url: "https://content.example.com/wp-json/",
        allowedOrigins: ["https://content.example.com"],
        retry: "safe_read",
        signal: caller.signal,
      }),
    ).rejects.toMatchObject({
      code: "CANCELLED",
      retryable: false,
    });
    expect(resolverSignal?.aborted).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized outbound provider body before fetch", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const transport = createBoundedJsonTransport({
      fetch: fetchImpl,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
      maxRequestBytes: 32,
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "create_post",
        method: "POST",
        url: "https://content.example.com/wp-json/wp/v2/posts",
        allowedOrigins: ["https://content.example.com"],
        body: { content: "x".repeat(100) },
        retry: "never",
      }),
    ).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      safeDetails: { maxRequestBytes: 32 },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects invalid transport bounds at construction", () => {
    const base = {
      fetch: vi.fn<FetchLike>(),
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      resolveHostname: PUBLIC_RESOLVER,
    };
    expect(() =>
      createBoundedJsonTransport({ ...base, requestTimeoutMs: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      createBoundedJsonTransport({ ...base, maxResponseBytes: -1 }),
    ).toThrow(TypeError);
    expect(() =>
      createBoundedJsonTransport({ ...base, maxAttempts: 1.5 }),
    ).toThrow(TypeError);
    expect(() =>
      createBoundedJsonTransport({ ...base, requestTimeoutMs: 30_001 }),
    ).toThrow(TypeError);
    expect(() =>
      createBoundedJsonTransport({
        ...base,
        maxResponseBytes: 32 * 1024 * 1024 + 1,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createBoundedJsonTransport({ ...base, maxAttempts: 4 }),
    ).toThrow(TypeError);
    expect(() =>
      createBoundedJsonTransport({ ...base, retryBackoffMs: [5_001] }),
    ).toThrow(TypeError);
  });
});
