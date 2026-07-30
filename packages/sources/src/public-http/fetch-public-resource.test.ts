import { describe, expect, it, vi } from "vitest";
import type { Dispatcher } from "undici";
import {
  fetchPublicResource,
  type PublicResourceFetchDependencies,
} from "./fetch-public-resource.ts";
import type { UrlGuardResult } from "../url-safety/index.ts";

function guardResult(url: string): UrlGuardResult {
  return {
    safe: true,
    normalizedUrl: url,
    pinnedIp: "93.184.216.34",
    reason: null,
  };
}

function harness(
  responses: readonly Response[],
  guard: PublicResourceFetchDependencies["guard"] = async (url) =>
    guardResult(url),
) {
  const guarded: string[] = [];
  const requested: {
    readonly url: string;
    readonly dispatcher: Dispatcher;
    readonly redirect: string;
  }[] = [];
  const closed: ReturnType<typeof vi.fn>[] = [];
  let responseIndex = 0;

  const dependencies: PublicResourceFetchDependencies = {
    guard: async (url) => {
      guarded.push(url);
      return guard(url);
    },
    createDispatcher: () => {
      const close = vi.fn(async () => undefined);
      closed.push(close);
      return { close } as unknown as Dispatcher & {
        close(): Promise<void>;
      };
    },
    fetch: async (url, init) => {
      requested.push({
        url,
        dispatcher: init.dispatcher,
        redirect: init.redirect,
      });
      const response = responses[responseIndex];
      responseIndex += 1;
      if (!response) throw new Error("fixture exhausted");
      return response;
    },
  };
  return { dependencies, guarded, requested, closed };
}

describe("fetchPublicResource", () => {
  it("revalidates and connection-pins every redirect hop", async () => {
    const fixture = harness([
      new Response(null, {
        status: 301,
        headers: { location: "https://www.acme.test/" },
      }),
      new Response("<html><title>Acme</title></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    ]);

    const result = await fetchPublicResource(
      "https://acme.test/",
      { maxBodyBytes: 1_024 },
      fixture.dependencies,
    );

    expect(result).toMatchObject({
      kind: "ok",
      requestedUrl: "https://acme.test/",
      finalUrl: "https://www.acme.test/",
      firstStatus: 301,
      finalStatus: 200,
      redirectChain: ["https://www.acme.test/"],
      bodyComplete: true,
    });
    expect(fixture.guarded).toEqual([
      "https://acme.test/",
      "https://www.acme.test/",
    ]);
    expect(fixture.requested).toHaveLength(2);
    expect(fixture.requested[0]?.dispatcher).not.toBe(
      fixture.requested[1]?.dispatcher,
    );
    expect(fixture.requested.map((request) => request.redirect)).toEqual([
      "manual",
      "manual",
    ]);
    expect(fixture.closed).toHaveLength(2);
    expect(fixture.closed.every((close) => close.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it("blocks a redirect before a second network request", async () => {
    const unsafeGuard: PublicResourceFetchDependencies["guard"] = async (
      url,
    ) =>
      url.includes("internal")
        ? {
            safe: false,
            normalizedUrl: null,
            pinnedIp: null,
            reason: "private",
          }
        : guardResult(url);
    const fixture = harness(
      [
        new Response(null, {
          status: 302,
          headers: { location: "http://internal.test/admin" },
        }),
      ],
      unsafeGuard,
    );

    const result = await fetchPublicResource(
      "https://acme.test/",
      {},
      fixture.dependencies,
    );

    expect(result).toEqual({ kind: "error", code: "blocked" });
    expect(fixture.requested).toHaveLength(1);
    expect(fixture.guarded).toEqual(["https://acme.test/"]);
  });

  it("keeps same-origin resource probes from redirecting elsewhere", async () => {
    const fixture = harness([
      new Response(null, {
        status: 302,
        headers: { location: "https://cdn.acme.test/robots.txt" },
      }),
    ]);

    const result = await fetchPublicResource(
      "https://acme.test/robots.txt",
      { allowedOrigin: "https://acme.test" },
      fixture.dependencies,
    );

    expect(result).toEqual({ kind: "error", code: "cross_origin" });
    expect(fixture.requested).toHaveLength(1);
    expect(fixture.guarded).toEqual(["https://acme.test/robots.txt"]);
  });

  it("preserves the submitted path, query order, and trailing slash when fetching", async () => {
    const guard: PublicResourceFetchDependencies["guard"] = async () =>
      guardResult("https://acme.test/page?b=2&a=1");
    const fixture = harness(
      [new Response("<html></html>", { status: 200 })],
      guard,
    );

    const result = await fetchPublicResource(
      "https://acme.test/page/?b=2&a=1#section",
      {},
      fixture.dependencies,
    );

    expect(result).toMatchObject({
      kind: "ok",
      finalUrl: "https://acme.test/page/?b=2&a=1",
    });
    expect(fixture.requested.map((request) => request.url)).toEqual([
      "https://acme.test/page/?b=2&a=1",
    ]);
  });

  it.each([
    ["an HTTPS downgrade", "http://www.acme.test/"],
    ["a non-standard port", "https://www.acme.test:8443/"],
    ["a public IP literal", "https://93.184.216.34/"],
  ])("blocks %s redirect before the next guard or request", async (_label, location) => {
    const fixture = harness([
      new Response(null, {
        status: 302,
        headers: { location },
      }),
    ]);

    const result = await fetchPublicResource(
      "https://acme.test/",
      {},
      fixture.dependencies,
    );

    expect(result).toEqual({ kind: "error", code: "blocked" });
    expect(fixture.guarded).toEqual(["https://acme.test/"]);
    expect(fixture.requested).toHaveLength(1);
  });

  it("returns a bounded prefix and marks incomplete evidence", async () => {
    const fixture = harness([
      new Response("0123456789", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ]);

    const result = await fetchPublicResource(
      "https://acme.test/",
      { maxBodyBytes: 5 },
      fixture.dependencies,
    );

    expect(result).toMatchObject({
      kind: "ok",
      body: "01234",
      bytes: 5,
      bodyComplete: false,
    });
    expect(fixture.closed[0]).toHaveBeenCalledOnce();
  });

  it("maps an aborted request to a stable timeout code", async () => {
    vi.useFakeTimers();
    try {
      const close = vi.fn(async () => undefined);
      const dependencies: PublicResourceFetchDependencies = {
        guard: async (url) => guardResult(url),
        createDispatcher: () =>
          ({ close }) as unknown as Dispatcher & { close(): Promise<void> },
        fetch: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener(
              "abort",
              () =>
                reject(
                  Object.assign(new Error("aborted"), { name: "AbortError" }),
                ),
              { once: true },
            );
          }),
      };

      const pending = fetchPublicResource(
        "https://acme.test/",
        { timeoutMs: 25 },
        dependencies,
      );
      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toEqual({
        kind: "error",
        code: "timeout",
      });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces the total timeout while a redirect-hop guard is pending", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        async () => new Response("<html></html>", { status: 200 }),
      );
      const dependencies: PublicResourceFetchDependencies = {
        guard: async (url) =>
          new Promise<UrlGuardResult>((resolve) => {
            setTimeout(() => resolve(guardResult(url)), 100);
          }),
        createDispatcher: () =>
          ({ close: async () => undefined }) as unknown as Dispatcher & {
            close(): Promise<void>;
          },
        fetch,
      };

      const pending = fetchPublicResource(
        "https://acme.test/",
        { timeoutMs: 25 },
        dependencies,
      );
      await vi.advanceTimersByTimeAsync(30);

      await expect(pending).resolves.toEqual({
        kind: "error",
        code: "timeout",
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
