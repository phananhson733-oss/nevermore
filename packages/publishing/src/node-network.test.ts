import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  createBoundedJsonTransport,
  type ResolvedEndpoint,
} from "./http";
import {
  createNodeHostnameResolver,
  createNodeHostnameResolverForTesting,
  createNodePinnedFetch,
  createNodePinnedFetchForTesting,
  createNodePublishingTransport,
} from "./node-network";
import {
  createNodeHostnameResolver as exportedCreateNodeHostnameResolver,
  createNodePinnedFetch as exportedCreateNodePinnedFetch,
  createNodePublishingTransport as exportedCreateNodePublishingTransport,
} from "./index";

const PUBLIC_IPV4 = "1.1.1.1";
const PUBLIC_IPV6 = "2606:4700:4700::1111";

interface RequestHarness {
  readonly request: typeof httpsRequest;
  readonly options: unknown[];
  readonly bodies: unknown[];
  readonly requests: ClientRequest[];
}

function incomingResponse(
  statusCode: number,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): IncomingMessage {
  const response = Readable.from(
    body.length === 0 ? [] : [Buffer.from(body, "utf8")],
  ) as IncomingMessage;
  response.statusCode = statusCode;
  response.statusMessage = statusCode === 200 ? "OK" : "Found";
  response.headers = { ...headers };
  response.rawHeaders = Object.entries(headers).flatMap(([name, value]) => [
    name,
    value,
  ]);
  return response;
}

function createRequestHarness(
  responses: readonly IncomingMessage[] = [],
): RequestHarness {
  const options: unknown[] = [];
  const bodies: unknown[] = [];
  const requests: ClientRequest[] = [];
  let responseIndex = 0;

  const request = ((
    requestOptions: unknown,
    onResponse: (response: IncomingMessage) => void,
  ) => {
    options.push(requestOptions);
    const emitter = new EventEmitter();
    const clientRequest = emitter as ClientRequest;
    clientRequest.destroyed = false;
    clientRequest.end = ((body?: unknown) => {
      bodies.push(body);
      const response = responses[responseIndex];
      responseIndex += 1;
      if (response !== undefined) {
        queueMicrotask(() => onResponse(response));
      }
      return clientRequest;
    }) as ClientRequest["end"];
    clientRequest.destroy = ((error?: Error) => {
      clientRequest.destroyed = true;
      queueMicrotask(() => {
        emitter.emit(
          "error",
          error ?? new DOMException("aborted", "AbortError"),
        );
      });
      return clientRequest;
    }) as ClientRequest["destroy"];
    requests.push(clientRequest);
    return clientRequest;
  }) as unknown as typeof httpsRequest;

  return { request, options, bodies, requests };
}

function endpoint(
  hostname = "api.example.com",
  addresses: readonly string[] = [PUBLIC_IPV4],
) {
  return {
    origin: `https://${hostname}`,
    hostname,
    addresses,
  } as const;
}

describe("Node publishing network", () => {
  it("exports only explicit production constructors through the package entrypoint", () => {
    expect(exportedCreateNodeHostnameResolver).toBe(
      createNodeHostnameResolver,
    );
    expect(exportedCreateNodePinnedFetch).toBe(createNodePinnedFetch);
    expect(exportedCreateNodePublishingTransport).toBe(
      createNodePublishingTransport,
    );

    const transport = createNodePublishingTransport({
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
    });
    expect(transport.request).toBeTypeOf("function");
    expect(transport.requestText).toBeTypeOf("function");
    expect(createNodePublishingTransport().request).toBeTypeOf(
      "function",
    );
  });

  it("resolves every A/AAAA answer once, preserves order, and deduplicates it", async () => {
    const lookup = vi.fn(async () => [
      { address: PUBLIC_IPV6, family: 6 as const },
      { address: PUBLIC_IPV4, family: 4 as const },
      { address: PUBLIC_IPV6, family: 6 as const },
    ]);
    const resolver = createNodeHostnameResolverForTesting(lookup);

    await expect(
      resolver("api.example.com", new AbortController().signal),
    ).resolves.toEqual([PUBLIC_IPV6, PUBLIC_IPV4]);
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith("api.example.com", {
      all: true,
      verbatim: true,
    });
  });

  it.each([
    ["loopback IPv4", "127.0.0.1"],
    ["private IPv4", "10.20.30.40"],
    ["link-local IPv4", "169.254.169.254"],
    ["loopback IPv6", "::1"],
    ["link-local IPv6", "fe80::1"],
    ["unique-local IPv6", "fd00::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["hex IPv4-mapped loopback", "::ffff:7f00:1"],
  ])("rejects a DNS set containing %s (%s)", async (_label, address) => {
    const resolver = createNodeHostnameResolverForTesting(async () => [
      { address: PUBLIC_IPV4, family: 4 },
      { address, family: address.includes(":") ? 6 : 4 },
    ]);

    await expect(
      resolver("rebind.example", new AbortController().signal),
    ).rejects.toThrow("non-public");
  });

  it("accepts a public IPv4-mapped IPv6 answer without treating it as private", async () => {
    const resolver = createNodeHostnameResolverForTesting(async () => [
      { address: "::ffff:8.8.8.8", family: 6 },
    ]);

    await expect(
      resolver("dns.example", new AbortController().signal),
    ).resolves.toEqual(["::ffff:8.8.8.8"]);
  });

  it("aborts an unresolved DNS lookup without waiting for the OS resolver", async () => {
    const lookup = vi.fn(
      async () =>
        await new Promise<readonly { address: string; family: number }[]>(
          () => undefined,
        ),
    );
    const resolver = createNodeHostnameResolverForTesting(lookup);
    const controller = new AbortController();

    const pending = resolver("slow.example", controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps a non-public production DNS answer classified as UNSAFE_ENDPOINT", async () => {
    const resolver = createNodeHostnameResolverForTesting(async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    const transport = createBoundedJsonTransport({
      fetch: async () => new Response("{}"),
      resolveHostname: resolver,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
    });

    await expect(
      transport.request({
        provider: "wordpress",
        operation: "probe_site",
        method: "GET",
        url: "https://rebind.example/wp-json/",
        allowedOrigins: ["https://rebind.example"],
        retry: "never",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_ENDPOINT" });
  });

  it("pins every retry to the first validated answer and never resolves again", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([
        { address: PUBLIC_IPV4, family: 4 },
        { address: PUBLIC_IPV6, family: 6 },
      ])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const resolver = createNodeHostnameResolverForTesting(lookup);
    const harness = createRequestHarness([
      incomingResponse(503, JSON.stringify({ retry: true }), {
        "content-type": "application/json",
      }),
      incomingResponse(200, JSON.stringify({ ok: true }), {
        "content-type": "application/json",
      }),
    ]);
    const pinnedFetch = createNodePinnedFetchForTesting(harness.request);
    const transport = createBoundedJsonTransport({
      fetch: pinnedFetch,
      resolveHostname: resolver,
      now: () => new Date("2026-07-27T08:00:00.000Z"),
      sleep: async () => undefined,
      maxAttempts: 2,
      retryBackoffMs: [0],
    });

    await expect(
      transport.request({
        provider: "github",
        operation: "probe_repository",
        method: "GET",
        url: "https://api.example.com/repositories/1",
        allowedOrigins: ["https://api.example.com"],
        headers: { authorization: "Bearer short-lived" },
        secrets: ["short-lived"],
        retry: "safe_read",
      }),
    ).resolves.toMatchObject({ body: { ok: true } });

    expect(lookup).toHaveBeenCalledOnce();
    expect(harness.options).toHaveLength(2);
    expect(harness.options).toEqual([
      expect.objectContaining({ hostname: PUBLIC_IPV4 }),
      expect.objectContaining({ hostname: PUBLIC_IPV4 }),
    ]);
  });

  it("connects to the pinned IP while retaining Host, TLS SNI, and certificate checks", async () => {
    const harness = createRequestHarness([
      incomingResponse(200, "{}", { "content-type": "application/json" }),
    ]);
    const pinnedFetch = createNodePinnedFetchForTesting(harness.request);

    await pinnedFetch(
      "https://api.example.com/v1/publish?draft=1",
      {
        method: "POST",
        headers: {
          authorization: "Bearer short-lived",
          "content-type": "application/json",
          host: "attacker.example",
        },
        body: "{}",
        redirect: "follow",
      },
      endpoint("api.example.com", [PUBLIC_IPV6, PUBLIC_IPV4]),
    );

    expect(harness.options[0]).toMatchObject({
      protocol: "https:",
      hostname: PUBLIC_IPV6,
      port: 443,
      method: "POST",
      path: "/v1/publish?draft=1",
      agent: false,
      servername: "api.example.com",
      rejectUnauthorized: true,
      headers: expect.objectContaining({
        authorization: "Bearer short-lived",
        host: "api.example.com",
      }),
    });
    const verifyCertificate = Reflect.get(
      harness.options[0] as object,
      "checkServerIdentity",
    ) as (hostname: string, certificate: unknown) => Error | undefined;
    expect(verifyCertificate).toBeTypeOf("function");
    expect(
      verifyCertificate("attacker.example", {
        subjectaltname: "DNS:api.example.com",
      }),
    ).toBeUndefined();
    expect(harness.bodies).toEqual([expect.any(Uint8Array)]);
  });

  it("snapshots the validated endpoint before awaiting request-body bytes", async () => {
    const harness = createRequestHarness([
      incomingResponse(200, "{}", { "content-type": "application/json" }),
    ]);
    const pinnedFetch = createNodePinnedFetchForTesting(harness.request);
    const mutableEndpoint = {
      origin: "https://api.example.com",
      hostname: "api.example.com",
      addresses: [PUBLIC_IPV4],
    };

    const pending = pinnedFetch(
      "https://api.example.com/publish",
      { method: "POST", body: "{}" },
      mutableEndpoint,
    );
    mutableEndpoint.origin = "https://attacker.example";
    mutableEndpoint.hostname = "attacker.example";
    mutableEndpoint.addresses[0] = "8.8.8.8";

    await pending;
    expect(harness.options[0]).toMatchObject({
      hostname: PUBLIC_IPV4,
      servername: "api.example.com",
      headers: expect.objectContaining({ host: "api.example.com" }),
    });
  });

  it("omits SNI for a public IP-literal origin while checking that IP identity", async () => {
    const harness = createRequestHarness([
      incomingResponse(204, ""),
    ]);
    const pinnedFetch = createNodePinnedFetchForTesting(harness.request);

    const response = await pinnedFetch(
      `https://[${PUBLIC_IPV6}]/probe`,
      undefined,
      {
        origin: `https://[${PUBLIC_IPV6}]`,
        hostname: PUBLIC_IPV6,
        addresses: [PUBLIC_IPV6],
      },
    );

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(harness.options[0]).toMatchObject({
      hostname: PUBLIC_IPV6,
      headers: expect.objectContaining({ host: `[${PUBLIC_IPV6}]` }),
    });
    expect(
      Reflect.has(harness.options[0] as object, "servername"),
    ).toBe(false);
  });

  it("returns a redirect response without following it or forwarding credentials", async () => {
    const harness = createRequestHarness([
      incomingResponse(302, "", {
        location: "https://attacker.example/collect",
      }),
    ]);
    const pinnedFetch = createNodePinnedFetchForTesting(harness.request);

    const response = await pinnedFetch(
      "https://api.example.com/publish",
      {
        headers: { authorization: "Bearer do-not-forward" },
        redirect: "follow",
      },
      endpoint(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://attacker.example/collect",
    );
    expect(harness.options).toHaveLength(1);
    expect(harness.options[0]).toMatchObject({
      headers: expect.objectContaining({
        authorization: "Bearer do-not-forward",
        host: "api.example.com",
      }),
    });
  });

  it("rejects an origin mismatch before a credential-bearing socket is opened", async () => {
    const harness = createRequestHarness();
    const pinnedFetch = createNodePinnedFetchForTesting(harness.request);

    await expect(
      pinnedFetch(
        "https://attacker.example/collect",
        { headers: { authorization: "Bearer do-not-forward" } },
        endpoint(),
      ),
    ).rejects.toThrow("validated endpoint");
    expect(harness.options).toHaveLength(0);
  });

  it("rejects a forged or non-public resolved endpoint before opening a socket", async () => {
    const harness = createRequestHarness();
    const pinnedFetch = createNodePinnedFetchForTesting(harness.request);
    const unsafeEndpoints: readonly ResolvedEndpoint[] = [
      endpoint("api.example.com", [PUBLIC_IPV4, "169.254.169.254"]),
      {
        origin: "https://api.example.com",
        hostname: "other.example.com",
        addresses: [PUBLIC_IPV4],
      },
    ];

    for (const unsafeEndpoint of unsafeEndpoints) {
      await expect(
        pinnedFetch(
          "https://api.example.com/publish",
          { headers: { authorization: "Bearer do-not-forward" } },
          unsafeEndpoint,
        ),
      ).rejects.toThrow("validated endpoint");
    }
    expect(harness.options).toHaveLength(0);
  });

  it("propagates AbortSignal to an in-flight pinned socket", async () => {
    const harness = createRequestHarness();
    const pinnedFetch = createNodePinnedFetchForTesting(harness.request);
    const controller = new AbortController();

    const pending = pinnedFetch(
      "https://api.example.com/slow",
      { signal: controller.signal },
      endpoint(),
    );
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.requests[0]?.destroyed).toBe(true);
  });

  it("fails before opening a socket when the caller is already aborted", async () => {
    const harness = createRequestHarness();
    const pinnedFetch = createNodePinnedFetchForTesting(harness.request);
    const signal = AbortSignal.abort();

    await expect(
      pinnedFetch(
        "https://api.example.com/slow",
        { signal },
        endpoint(),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.requests).toHaveLength(0);
  });

  it("rejects synchronous HTTPS request construction failures", async () => {
    const failure = new Error("socket construction failed");
    const request = vi.fn(() => {
      throw failure;
    }) as unknown as typeof httpsRequest;
    const pinnedFetch = createNodePinnedFetchForTesting(request);

    await expect(
      pinnedFetch(
        "https://api.example.com/probe",
        undefined,
        endpoint(),
      ),
    ).rejects.toBe(failure);
  });
});
