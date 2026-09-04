import { beforeEach, describe, expect, it, vi } from "vitest";

type CachedCrawl = {
  readonly payload: unknown;
  readonly capturedAt: string;
};

type CacheProbe = (targetHost: string) => Promise<CachedCrawl | null>;

type OpenCrawlGateMock = (
  clientIp: string,
  normalizedUrl: string,
  dependencies: unknown,
  cacheProbe?: CacheProbe,
) => Promise<
  | { readonly ok: true; readonly kind: "crawl"; readonly release: () => void }
  | {
      readonly ok: true;
      readonly kind: "cached";
      readonly payload: unknown;
      readonly capturedAt: string;
      readonly release: () => void;
    }
>;

const mocks = vi.hoisted(() => ({
  internalPayload: { tool: "internal-link-fixture" },
  seoPayload: { tool: "seo-fixture" },
  isSeoAuditPayload: vi.fn<(value: unknown) => boolean>(() => true),
  openCrawlGate: vi.fn<OpenCrawlGateMock>(async () => ({
    ok: true,
    kind: "crawl",
    release: vi.fn(),
  })),
  readCrawlCache: vi.fn<
    (tool: string, targetHost: string) => Promise<CachedCrawl | null>
  >(async () => null),
  writeCrawlCache: vi.fn<
    (tool: string, targetHost: string, payload: unknown) => Promise<void>
  >(async () => undefined),
  scanInternalLinkAuditSite: vi.fn(async () => ({ stopReason: null })),
  scanSeoAuditSite: vi.fn(async () => ({ stopReason: null })),
}));

vi.mock("@sf/public-tools/seo-audit/contract", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@sf/public-tools/seo-audit/contract")
    >();
  return { ...actual, isSeoAuditPayload: mocks.isSeoAuditPayload };
});

vi.mock("@sf/public-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/public-tools")>();
  return {
    ...actual,
    scanInternalLinkAuditSite: mocks.scanInternalLinkAuditSite,
    buildInternalLinkAuditPayload: () => mocks.internalPayload,
    scanSeoAuditSite: mocks.scanSeoAuditSite,
    buildSeoAuditPayload: () => mocks.seoPayload,
  };
});

vi.mock("./crawl-gate.ts", () => ({
  DEFAULT_CRAWL_GATE_DEPENDENCIES: {},
  openCrawlGate: mocks.openCrawlGate,
}));

vi.mock("./crawl-cache.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./crawl-cache.ts")>();
  return {
    ...actual,
    readCrawlCache: mocks.readCrawlCache,
    writeCrawlCache: mocks.writeCrawlCache,
  };
});

import { handleInternalLinkAuditRequest } from "./internal-link-audit-handler.ts";
import { handleSeoAuditRequest } from "./seo-audit-handler.ts";

function request(
  path: string,
  body: Readonly<Record<string, unknown>> = { url: "WWW.AcMe.com" },
): Request {
  return new Request(`https://gengrowth.ai${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.9",
    },
    body: JSON.stringify(body),
  });
}

function cachedSeoPayload(targetInspected: boolean): unknown {
  return {
    result: {
      targetUrl: "https://www.acme.com/",
      targetInspected,
    },
  };
}

function useCacheProbeGate(): void {
  mocks.openCrawlGate.mockImplementation(
    async (_clientIp, _normalizedUrl, _dependencies, cacheProbe) => {
      const cached = (await cacheProbe?.("www.acme.com")) ?? null;
      return cached === null
        ? { ok: true, kind: "crawl", release: vi.fn() }
        : {
            ok: true,
            kind: "cached",
            payload: cached.payload,
            capturedAt: cached.capturedAt,
            release: vi.fn(),
          };
    },
  );
}

beforeEach(() => {
  mocks.isSeoAuditPayload.mockReset().mockReturnValue(true);
  mocks.openCrawlGate.mockReset().mockResolvedValue({
    ok: true,
    kind: "crawl",
    release: vi.fn(),
  });
  mocks.readCrawlCache.mockReset().mockResolvedValue(null);
  mocks.writeCrawlCache.mockClear();
  mocks.scanInternalLinkAuditSite.mockClear();
  mocks.scanSeoAuditSite.mockClear();
});

describe("default public crawl cache wiring", () => {
  it("writes an Internal Link Audit result under the exact target host", async () => {
    const response = await handleInternalLinkAuditRequest(
      request("/api/tools/internal-link-audit"),
    );

    expect(response.status).toBe(200);
    expect(mocks.writeCrawlCache).toHaveBeenCalledWith(
      "internal_link_audit.v3",
      "www.acme.com",
      mocks.internalPayload,
    );
  });

  it("writes a default SEO Audit result under the full-site namespace", async () => {
    const response = await handleSeoAuditRequest(request("/api/tools/seo-audit"));

    expect(response.status).toBe(200);
    expect(mocks.writeCrawlCache).toHaveBeenCalledWith(
      "seo_audit:full-site",
      "www.acme.com",
      mocks.seoPayload,
    );
  });

  it("writes an explicit key-pages result under its own namespace", async () => {
    const response = await handleSeoAuditRequest(
      request("/api/tools/seo-audit", {
        url: "WWW.AcMe.com",
        tier: "key-pages",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.writeCrawlCache).toHaveBeenCalledWith(
      "seo_audit:key-pages",
      "www.acme.com",
      mocks.seoPayload,
    );
  });

  it("hits for the same reordered manual set and misses for a different set", async () => {
    const stored = new Map<string, CachedCrawl>();
    useCacheProbeGate();
    mocks.readCrawlCache.mockImplementation(async (namespace, host) =>
      stored.get(`${namespace}:${host}`) ?? null,
    );
    mocks.writeCrawlCache.mockImplementation(
      async (namespace: string, host: string) => {
        stored.set(`${namespace}:${host}`, {
          payload: cachedSeoPayload(false),
          capturedAt: "2026-08-26T10:00:00.000Z",
        });
      },
    );
    const firstSet = [
      "https://www.acme.com/b",
      "https://www.acme.com/a",
    ];
    const reorderedSet = firstSet.toReversed();
    const differentSet = [
      "https://www.acme.com/a",
      "https://www.acme.com/c",
    ];

    const first = await handleSeoAuditRequest(
      request("/api/tools/seo-audit", {
        url: "WWW.AcMe.com",
        tier: "key-pages",
        extraKeyPages: firstSet,
      }),
    );
    const reordered = await handleSeoAuditRequest(
      request("/api/tools/seo-audit", {
        url: "WWW.AcMe.com",
        tier: "key-pages",
        extraKeyPages: reorderedSet,
      }),
    );
    const different = await handleSeoAuditRequest(
      request("/api/tools/seo-audit", {
        url: "WWW.AcMe.com",
        tier: "key-pages",
        extraKeyPages: differentSet,
      }),
    );

    expect(first.headers.get("x-crawl-cache")).toBeNull();
    expect(reordered.headers.get("x-crawl-cache")).toBe("hit");
    expect(different.headers.get("x-crawl-cache")).toBeNull();
    expect(mocks.scanSeoAuditSite).toHaveBeenCalledTimes(2);
    const namespaces = mocks.readCrawlCache.mock.calls.map(([namespace]) =>
      namespace,
    );
    expect(namespaces[0]).toBe(namespaces[1]);
    expect(namespaces[2]).not.toBe(namespaces[0]);
    expect(namespaces.every((namespace) => !namespace.includes("https://"))).toBe(
      true,
    );
  });

  it("reuses a same-host cache entry only when the tier matches", async () => {
    useCacheProbeGate();
    const cached = cachedSeoPayload(false);
    mocks.readCrawlCache.mockImplementation(async (namespace) =>
      namespace === "seo_audit:key-pages"
        ? {
            payload: cached,
            capturedAt: "2026-08-26T10:00:00.000Z",
          }
        : null,
    );

    const response = await handleSeoAuditRequest(
      request("/api/tools/seo-audit", {
        url: "WWW.AcMe.com",
        tier: "key-pages",
      }),
    );

    expect(response.headers.get("x-crawl-cache")).toBe("hit");
    expect(mocks.readCrawlCache).toHaveBeenCalledWith(
      "seo_audit:key-pages",
      "www.acme.com",
    );
    expect(mocks.scanSeoAuditSite).not.toHaveBeenCalled();
  });

  it("does not let a key-pages row satisfy a full-site request", async () => {
    useCacheProbeGate();
    mocks.readCrawlCache.mockImplementation(async (namespace) =>
      namespace === "seo_audit:key-pages"
        ? {
            payload: cachedSeoPayload(false),
            capturedAt: "2026-08-26T10:00:00.000Z",
          }
        : null,
    );

    const response = await handleSeoAuditRequest(
      request("/api/tools/seo-audit", {
        url: "WWW.AcMe.com",
        tier: "full-site",
      }),
    );

    expect(response.headers.get("x-crawl-cache")).toBeNull();
    expect(mocks.readCrawlCache).toHaveBeenCalledWith(
      "seo_audit:full-site",
      "www.acme.com",
    );
    expect(mocks.scanSeoAuditSite).toHaveBeenCalledOnce();
  });

  it("does not read the legacy unpartitioned SEO Audit namespace", async () => {
    useCacheProbeGate();
    mocks.readCrawlCache.mockImplementation(async (namespace) =>
      namespace === "seo_audit"
        ? {
            payload: cachedSeoPayload(false),
            capturedAt: "2026-08-26T10:00:00.000Z",
          }
        : null,
    );

    const response = await handleSeoAuditRequest(
      request("/api/tools/seo-audit"),
    );

    expect(response.headers.get("x-crawl-cache")).toBeNull();
    expect(mocks.readCrawlCache).toHaveBeenCalledWith(
      "seo_audit:full-site",
      "www.acme.com",
    );
    expect(mocks.scanSeoAuditSite).toHaveBeenCalledOnce();
  });

  it("treats a non-inspected strict target cache as a miss and scans", async () => {
    useCacheProbeGate();
    mocks.readCrawlCache.mockResolvedValue({
      payload: cachedSeoPayload(false),
      capturedAt: "2026-08-26T10:00:00.000Z",
    });

    const response = await handleSeoAuditRequest(
      request("/api/tools/on-page-seo-check"),
      undefined,
      { requireSameEntrySubject: true },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-crawl-cache")).toBeNull();
    expect(mocks.readCrawlCache).toHaveBeenCalledWith(
      "seo_audit:full-site",
      "www.acme.com",
    );
    expect(mocks.scanSeoAuditSite).toHaveBeenCalledOnce();
  });

  it("reuses an inspected strict target cache", async () => {
    useCacheProbeGate();
    const cached = cachedSeoPayload(true);
    mocks.readCrawlCache.mockResolvedValue({
      payload: cached,
      capturedAt: "2026-08-26T10:00:00.000Z",
    });

    const response = await handleSeoAuditRequest(
      request("/api/tools/on-page-seo-check"),
      undefined,
      { requireSameEntrySubject: true },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-crawl-cache")).toBe("hit");
    await expect(response.json()).resolves.toEqual({ data: cached });
    expect(mocks.scanSeoAuditSite).not.toHaveBeenCalled();
  });

  it("preserves non-strict reuse of a non-inspected cache", async () => {
    useCacheProbeGate();
    const cached = cachedSeoPayload(false);
    mocks.readCrawlCache.mockResolvedValue({
      payload: cached,
      capturedAt: "2026-08-26T10:00:00.000Z",
    });

    const response = await handleSeoAuditRequest(
      request("/api/tools/seo-audit"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-crawl-cache")).toBe("hit");
    await expect(response.json()).resolves.toEqual({ data: cached });
    expect(mocks.scanSeoAuditSite).not.toHaveBeenCalled();
  });
});
