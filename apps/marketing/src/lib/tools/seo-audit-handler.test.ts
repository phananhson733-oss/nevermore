import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SeoAuditPayload,
  SeoAuditRaw,
  SeoAuditScanErrorCode,
} from "@sf/public-tools";
import { SeoAuditScanError } from "@sf/public-tools";
import {
  handleSeoAuditRequest,
  type SeoAuditHandlerDependencies,
} from "./seo-audit-handler.ts";
import {
  acquirePublicCrawlSlot,
  resetPublicToolSlots,
} from "./public-tool-request.ts";
import { openCrawlGate } from "./crawl-gate.ts";
import { readCrawlCache } from "./crawl-cache.ts";
import type { SharedQuotaDependencies } from "./shared-rate-limit.ts";

/** An always-allowing quota store, so slot behaviour can be tested in isolation. */
function openQuota(): SharedQuotaDependencies {
  return {
    callQuota: async () => ({
      allowed: true,
      hits: 1,
      reset_at: "2099-01-01T00:00:00.000Z",
    }),
  };
}

function request(body: unknown, contentType = "application/json"): Request {
  return new Request("https://gengrowth.ai/api/tools/seo-audit", {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-real-ip": "203.0.113.9",
    },
    body: JSON.stringify(body),
  });
}

/** Only the browser client asks for the streamed branch. */
function streamingRequest(
  body: unknown,
  init: { readonly signal?: AbortSignal } = {},
): Request {
  return new Request("https://gengrowth.ai/api/tools/seo-audit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/x-ndjson",
      "x-real-ip": "203.0.113.9",
    },
    body: JSON.stringify(body),
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

async function bodyLines(response: Response): Promise<readonly string[]> {
  const text = await response.text();
  return text.split("\n").filter((line) => line.length > 0);
}

const raw = {
  origin: "https://acme.test",
  host: "acme.test",
  pages: [],
  robots: { fetched: true, groups: [], sitemaps: [] },
  sitemap: { fetched: true, urlCount: 0, subjectUrls: [], complete: true },
  availability: "available",
  capturedAt: "2026-07-30T09:00:00.000Z",
  sourceWindow: {
    start: "2026-07-30T09:00:00.000Z",
    end: "2026-07-30T09:00:00.000Z",
  },
  stopReason: null,
  providerUsage: {},
  limitation: "Fixture.",
  requestedUrl: "https://acme.test/",
} satisfies SeoAuditRaw;

const payload = {
  run: {
    tool: "seo_audit",
    schemaVersion: "seo_audit.sitewide.v18",
    mode: "public_preview",
    scope: "discoverable_same_origin_static_html_audit",
    persistence: "none",
    completedAt: "2026-07-30T09:00:00.000Z",
  },
  result: {
    targetUrl: "https://acme.test/",
    siteOrigin: "https://acme.test",
    scannedAt: "2026-07-30T09:00:00.000Z",
    targetInspected: true,
    inspectedTargetUrl: "https://acme.test/",
    targetPageExtract: null,
    coverage: {
      availability: "available",
      pagesInspected: 0,
      linksObserved: 0,
      sitemapUrlsObserved: 0,
      urlsSkipped: 0,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 0,
      stopReason: null,
    },
    siteResources: {
      robotsFetched: true,
      robotsGroupsObserved: 0,
      sitemapReferencesObserved: 0,
      sitemapFetched: true,
      sitemapUrls: [],
      sitemapUrlsComplete: true,
    },
    records: [],
    pages: [],
  },
} satisfies SeoAuditPayload;

function dependencies(
  overrides: Partial<SeoAuditHandlerDependencies> = {},
): SeoAuditHandlerDependencies {
  return {
    normalizeUrl: () => ({ ok: true, url: "https://acme.test/" }),
    scan: vi.fn(async () => raw),
    buildPayload: vi.fn(() => payload),
    extractClientIp: () => "203.0.113.9",
    openGate: (clientIp, normalizedUrl) =>
      openCrawlGate(clientIp, normalizedUrl, {
        quota: openQuota(),
        acquireSlot: acquirePublicCrawlSlot,
      }),
    cachePayload: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  resetPublicToolSlots();
});

describe("handleSeoAuditRequest", () => {
  it("returns the site-wide success envelope without caching", async () => {
    const deps = dependencies();
    const response = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-ratelimit-remaining")).toBeNull();
    await expect(response.json()).resolves.toEqual({ data: payload });
    // The request signal must reach the crawler: without it, a client that
    // disconnects still leaves the full 4,500-request budget running at the
    // target site.
    expect(deps.scan).toHaveBeenCalledWith(
      "https://acme.test/",
      expect.any(AbortSignal),
    );
    expect(deps.buildPayload).toHaveBeenCalledWith(raw);
  });

  /**
   * The same rule as the streamed branch, because it is the same shared cache:
   * a run that was cut off answers the caller who asked for it and nobody else.
   */
  it("does not cache a buffered crawl that reported its own abort", async () => {
    const deps = dependencies({
      scan: async () => ({
        ...raw,
        availability: "partial",
        stopReason: "aborted",
      }),
    });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.cachePayload).not.toHaveBeenCalled();
  });

  /**
   * The other half of the rule above. A gate that cached nothing would send
   * every visitor's crawl back to the target site, which is the traffic the
   * cache exists to remove — and the negative case alone cannot catch that.
   */
  it("caches a buffered crawl that ran to completion", async () => {
    const deps = dependencies();

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.cachePayload).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a same-host cache entry for a different normalized path", async () => {
    const normalizedUrl = "https://acme.test/docs";
    const freshPayload = {
      ...payload,
      result: { ...payload.result, targetUrl: normalizedUrl },
    } satisfies SeoAuditPayload;
    const scan = vi.fn(async () => ({ ...raw, requestedUrl: normalizedUrl }));
    const release = vi.fn();
    const deps = dependencies({
      normalizeUrl: () => ({ ok: true, url: normalizedUrl }),
      scan,
      buildPayload: () => freshPayload,
      openGate: async () => ({
        ok: true,
        kind: "cached",
        payload,
        capturedAt: "2026-07-30T08:00:00.000Z",
        release,
      }),
    });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test/docs" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-crawl-cache")).toBeNull();
    await expect(response.json()).resolves.toEqual({ data: freshPayload });
    expect(scan).toHaveBeenCalledWith(normalizedUrl, expect.any(AbortSignal));
    expect(release).toHaveBeenCalledOnce();
  });

  it("re-crawls rather than serving a cache entry from the previous schema", async () => {
    const normalizedUrl = "https://acme.test/docs";
    const freshPayload = {
      ...payload,
      result: { ...payload.result, targetUrl: normalizedUrl },
    } satisfies SeoAuditPayload;
    // Structurally valid, one schema behind: exactly what the cache holds for
    // up to its TTL after a version bump ships. Serving it would hand the
    // reader fields it was not built for; erroring would take the tool down for
    // an hour. It has to read as a miss.
    const stale = {
      ...freshPayload,
      run: { ...freshPayload.run, schemaVersion: "seo_audit.sitewide.v4" },
    };
    const scan = vi.fn(async () => ({ ...raw, requestedUrl: normalizedUrl }));
    const release = vi.fn();
    const deps = dependencies({
      normalizeUrl: () => ({ ok: true, url: normalizedUrl }),
      scan,
      buildPayload: () => freshPayload,
      openGate: async () => ({
        ok: true,
        kind: "cached",
        payload: stale,
        capturedAt: "2026-07-30T08:00:00.000Z",
        release,
      }),
    });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test/docs" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-crawl-cache")).toBeNull();
    expect(scan).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ data: freshPayload });
  });

  it.each([null, {}, { result: null }, { result: { targetUrl: 42 } }])(
    "safely treats an invalid cached payload as a miss: %j",
    async (cachedPayload) => {
      const scan = vi.fn(async () => raw);
      const deps = dependencies({
        scan,
        openGate: async () => ({
          ok: true,
          kind: "cached",
          payload: cachedPayload,
          capturedAt: "2026-07-30T08:00:00.000Z",
          release: () => {},
        }),
      });

      const response = await handleSeoAuditRequest(
        request({ url: "acme.test" }),
        deps,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-crawl-cache")).toBeNull();
      expect(scan).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [
      "old schema",
      {
        ...payload,
        run: { ...payload.run, schemaVersion: "seo_audit.sitewide.v2" },
      },
    ],
    [
      "wrong scope",
      {
        ...payload,
        run: { ...payload.run, scope: "homepage_only" },
      },
    ],
    [
      "wrong mode",
      {
        ...payload,
        run: { ...payload.run, mode: "authenticated_agent" },
      },
    ],
    [
      "stored persistence",
      {
        ...payload,
        run: { ...payload.run, persistence: "stored" },
      },
    ],
    [
      "non-canonical completion time",
      {
        ...payload,
        run: { ...payload.run, completedAt: "2026-07-30T09:00:00Z" },
      },
    ],
    [
      "malformed coverage",
      {
        ...payload,
        result: {
          ...payload.result,
          coverage: { ...payload.result.coverage, pagesInspected: "zero" },
        },
      },
    ],
    [
      "malformed site resources",
      {
        ...payload,
        result: {
          ...payload.result,
          siteResources: {
            ...payload.result.siteResources,
            robotsFetched: "yes",
          },
        },
      },
    ],
    [
      "malformed record",
      { ...payload, result: { ...payload.result, records: [{}] } },
    ],
    [
      "malformed page",
      { ...payload, result: { ...payload.result, pages: [{}] } },
    ],
  ] as const)(
    "treats an exact-target cache with %s as a miss and crawls fresh",
    async (_label, cachedPayload) => {
      const scan = vi.fn(async () => raw);
      const release = vi.fn();
      const deps = dependencies({
        scan,
        openGate: async () => ({
          ok: true,
          kind: "cached",
          payload: cachedPayload,
          capturedAt: "2026-07-30T08:00:00.000Z",
          release,
        }),
      });

      const response = await handleSeoAuditRequest(
        request({ url: "acme.test" }),
        deps,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-crawl-cache")).toBeNull();
      await expect(response.json()).resolves.toEqual({ data: payload });
      expect(scan).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
    },
  );

  /**
   * The seam this pair of modules failed at in production.
   *
   * Every capture-provenance check here is `new Date(x).toISOString() === x`,
   * and PostgreSQL renders `timestamptz` with microsecond precision and a
   * numeric offset. Each half was independently right and every test on both
   * sides passed, because both sides hand-spelled the provenance in the
   * canonical form. Rows were written and never once read back: the tools
   * re-crawled every caller's site while a fresh answer sat in the table.
   *
   * So this reads the provenance through the real store path rather than
   * writing the expected string, which is the only version of this test that
   * could have failed.
   */
  it("serves a cache hit for provenance read back through the store", async () => {
    const scan = vi.fn(async () => raw);
    const release = vi.fn();
    const cached = await readCrawlCache("seo_audit", "acme.test", {
      read: async () => ({
        payload,
        capturedAt: "2026-07-30T08:00:00.033741+00:00",
      }),
      write: async () => {},
    });
    expect(cached).not.toBeNull();
    const deps = dependencies({
      scan,
      openGate: async () => ({
        ok: true,
        kind: "cached",
        payload: cached?.payload,
        capturedAt: cached?.capturedAt ?? "",
        release,
      }),
    });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-crawl-cache")).toBe("hit");
    expect(response.headers.get("x-crawl-captured-at")).toBe(
      "2026-07-30T08:00:00.033Z",
    );
    expect(scan).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("treats a cache hit with non-canonical capture provenance as a miss", async () => {
    const scan = vi.fn(async () => raw);
    const release = vi.fn();
    const deps = dependencies({
      scan,
      openGate: async () => ({
        ok: true,
        kind: "cached",
        payload,
        capturedAt: "2026-07-30 08:00:00+00",
        release,
      }),
    });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-crawl-cache")).toBeNull();
    expect(response.headers.get("x-crawl-captured-at")).toBeNull();
    expect(scan).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects an oversized request before validation or scan", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({ scan });
    const response = await handleSeoAuditRequest(
      request({ url: "x".repeat(5_000) }),
      deps,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it("accepts the keyword layer's optional fields", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({ scan });

    const response = await handleSeoAuditRequest(
      request({
        url: "acme.test",
        targetQueries: ["birth chart"],
        pageRole: "homepage",
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("still rejects a field outside the allowed set", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({ scan });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test", targetQueries: ["chart"], persist: true }),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it("rejects the whole request past the query limit instead of truncating", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({ scan });

    const response = await handleSeoAuditRequest(
      request({
        url: "acme.test",
        targetQueries: ["a", "b", "c", "d", "e", "f"],
      }),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it("rejects an unknown page role", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({ scan });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test", pageRole: "article" }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(scan).not.toHaveBeenCalled();
  });

  it("rejects unknown input fields before scanning", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({ scan });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test", persist: true }),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(scan).not.toHaveBeenCalled();
  });

  /**
   * Replaces "does not impose a sequential per-IP usage quota", which asserted
   * the defect. Commit 7b315f6 removed RATE_LIMIT_MAX = 5 from this handler and
   * put nothing in its place, and the sibling change's own plan describes the
   * intent as dropping the *normal-use* quota "while preserving high-threshold
   * abuse protection". internal-link-audit kept that protection; seo-audit lost
   * both, and one IP could replay a 240-second, 4,500-request crawl forever.
   *
   * A generous ceiling is still a ceiling. Normal use never reaches it.
   */
  it("admits repeated normal use", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({ scan });

    for (let run = 0; run < 7; run += 1) {
      const response = await handleSeoAuditRequest(
        request({ url: "acme.test" }),
        deps,
      );
      expect(response.status).toBe(200);
    }
    expect(scan).toHaveBeenCalledTimes(7);
  });

  it("refuses once the durable per-IP budget is spent", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({
      scan,
      openGate: (clientIp, normalizedUrl) =>
        openCrawlGate(clientIp, normalizedUrl, {
          quota: {
            callQuota: async () => ({
              allowed: false,
              hits: 13,
              reset_at: "2099-01-01T00:00:00.000Z",
            }),
          },
          acquireSlot: acquirePublicCrawlSlot,
        }),
    });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: { code: "rate_limited" },
    });
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(scan).not.toHaveBeenCalled();
  });

  /**
   * The quota store being unreachable is the state a fresh deploy is in before
   * the migration runs. Serving the crawl anyway would put an unbounded
   * anonymous crawler in front of third-party sites, so the endpoint refuses.
   */
  it("fails closed when the quota store cannot answer", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({
      scan,
      openGate: (clientIp, normalizedUrl) =>
        openCrawlGate(clientIp, normalizedUrl, {
          quota: {
            callQuota: async () => {
              throw new Error("relation does not exist");
            },
          },
          acquireSlot: acquirePublicCrawlSlot,
        }),
    });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "quota_unavailable" },
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it("releases the in-flight slot when the gate refuses", async () => {
    const scan = vi.fn(async () => raw);
    let allow = false;
    const deps = dependencies({
      scan,
      openGate: (clientIp, normalizedUrl) =>
        openCrawlGate(clientIp, normalizedUrl, {
          quota: {
            callQuota: async () => ({
              allowed: allow,
              hits: 1,
              reset_at: "2099-01-01T00:00:00.000Z",
            }),
          },
          acquireSlot: acquirePublicCrawlSlot,
        }),
    });

    const refused = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );
    expect(refused.status).toBe(429);

    // A refusal that leaked the slot would lock this IP out until the isolate
    // recycled, turning a rate limit into a persistent denial of service.
    allow = true;
    const allowed = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );
    expect(allowed.status).toBe(200);
  });

  it("releases the crawl slot after a failed scan", async () => {
    const scan = vi
      .fn<SeoAuditHandlerDependencies["scan"]>()
      .mockRejectedValueOnce(new SeoAuditScanError("scan_failed"))
      .mockResolvedValueOnce(raw);
    const deps = dependencies({ scan });

    const failed = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );
    const retry = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );

    expect(failed.status).toBe(502);
    expect(retry.status).toBe(200);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("allows only one in-flight scan per IP", async () => {
    let resolveScan: ((value: SeoAuditRaw) => void) | undefined;
    const scan = vi.fn(
      () =>
        new Promise<SeoAuditRaw>((resolve) => {
          resolveScan = resolve;
        }),
    );
    const deps = dependencies({ scan });

    const first = handleSeoAuditRequest(request({ url: "acme.test" }), deps);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    const second = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: { code: "scan_in_progress" },
    });

    resolveScan?.(raw);
    await first;
  });

  it.each([
    ["timeout", 504, "scan_timeout"],
    ["blocked", 400, "invalid_url"],
    ["scan_failed", 502, "scan_failed"],
  ] as const)(
    "maps %s to HTTP %s without returning raw transport details",
    async (
      sourceCode: SeoAuditScanErrorCode,
      expectedStatus: number,
      expectedCode: string,
    ) => {
      const deps = dependencies({
        scan: async () => {
          throw new SeoAuditScanError(sourceCode);
        },
      });

      const response = await handleSeoAuditRequest(
        request({ url: "acme.test" }),
        deps,
      );

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toEqual({
        error: { code: expectedCode },
      });
    },
  );
});

/**
 * The streamed branch exists so a 2.5-minute crawl can say what it is doing.
 * It is gated on `Accept: application/x-ndjson` because that gate is the whole
 * contract guarantee: every caller that does not ask for it — including the
 * three shipped Playwright specs — keeps today's bytes and today's statuses.
 */
describe("handleSeoAuditRequest, NDJSON branch", () => {
  const terminalLine = JSON.stringify({ data: payload });
  /** Written the moment the crawl returns, before the report is built. */
  const stageLine = JSON.stringify({ stage: "building_report" });

  // This branch records its failures server-side, because its status code no
  // longer can. Silenced by default so only the test that asserts on the
  // record reads it.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves an unnegotiated request byte-identical to the buffered response", async () => {
    const response = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      dependencies(),
    );

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-public-tool-stream")).toBeNull();
    await expect(response.text()).resolves.toBe(terminalLine);
  });

  it("forces buffered JSON for an internal caller without rewriting its request", async () => {
    const incoming = streamingRequest({ url: "acme.test" });

    const response = await handleSeoAuditRequest(incoming, dependencies(), {
      forceBufferedJson: true,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-public-tool-stream")).toBeNull();
    expect(incoming.headers.get("accept")).toBe("application/x-ndjson");
    await expect(response.text()).resolves.toBe(terminalLine);
  });

  it("streams every observed page and request count, then the unchanged payload", async () => {
    const deps = dependencies({
      scan: async (_url, _signal, onProgress) => {
        onProgress?.({ pagesCrawled: 0, requestsSent: 1 });
        onProgress?.({ pagesCrawled: 0, requestsSent: 2 });
        onProgress?.({ pagesCrawled: 12, requestsSent: 37 });
        return raw;
      },
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-transform",
    );
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("x-public-tool-stream")).toBe("ndjson");

    const lines = await bodyLines(response);
    expect(lines).toEqual([
      '{"progress":{"pagesCrawled":0,"requestsSent":1}}',
      '{"progress":{"pagesCrawled":0,"requestsSent":2}}',
      '{"progress":{"pagesCrawled":12,"requestsSent":37}}',
      stageLine,
      terminalLine,
    ]);
  });

  /**
   * The page figure is the one the report will state as `coverage.pagesInspected`;
   * repeating it on every wire request would say nothing new and cost a line
   * each time. A line goes out when either figure actually moved.
   */
  it("writes nothing when neither figure moved", async () => {
    const deps = dependencies({
      scan: async (_url, _signal, onProgress) => {
        onProgress?.({ pagesCrawled: 1, requestsSent: 4 });
        onProgress?.({ pagesCrawled: 1, requestsSent: 4 });
        onProgress?.({ pagesCrawled: 2, requestsSent: 4 });
        return raw;
      },
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );

    await expect(bodyLines(response)).resolves.toEqual([
      '{"progress":{"pagesCrawled":1,"requestsSent":4}}',
      '{"progress":{"pagesCrawled":2,"requestsSent":4}}',
      stageLine,
      terminalLine,
    ]);
  });

  /**
   * The whole point, and the failure mode every other test here would miss:
   * collecting observations and writing them once the crawl returns produces a
   * change that is green in CI and does nothing in production. The reader must
   * receive the first line while the crawl is still pending, or this hangs.
   *
   * It does not distinguish `void (async …)()` from returning that promise out
   * of `start()`; queued chunks are readable either way. See the constraint
   * comment at that call site.
   */
  it("delivers a progress line while the crawl is still running", async () => {
    let finish: ((value: SeoAuditRaw) => void) | undefined;
    const deps = dependencies({
      scan: (_url, _signal, onProgress) =>
        new Promise<SeoAuditRaw>((resolve) => {
          finish = resolve;
          onProgress?.({ pagesCrawled: 0, requestsSent: 1 });
        }),
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe(
      '{"progress":{"pagesCrawled":0,"requestsSent":1}}\n',
    );
    expect(finish).toBeDefined();

    finish?.(raw);
    const rest: string[] = [];
    for (;;) {
      const next = await reader?.read();
      if (!next || next.done) break;
      rest.push(new TextDecoder().decode(next.value));
    }
    expect(rest.join("").trimEnd()).toBe(`${stageLine}\n${terminalLine}`);
  });

  /**
   * Every number on the wire is one the crawl reported. The handler owns no
   * counter of its own, so a crawl that observes nothing streams nothing.
   */
  it("invents no progress when the crawl reported none", async () => {
    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      dependencies(),
    );

    await expect(bodyLines(response)).resolves.toEqual([
      stageLine,
      terminalLine,
    ]);
  });

  it("writes the cache before the terminal line, so an early close cannot skip it", async () => {
    const order: string[] = [];
    const deps = dependencies({
      cachePayload: async () => {
        order.push("cache");
      },
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );
    await bodyLines(response);
    order.push("closed");

    expect(order).toEqual(["cache", "closed"]);
  });

  /**
   * The crawl ending is not the request ending. Building the report over up to
   * 2,000 pages, serializing it and writing it to the shared cache all happen
   * after `scan` returns, and only this side knows when that boundary was
   * crossed — so the client cannot stop claiming a crawl unless it is told.
   */
  it("says when the crawl is over and the report is being built", async () => {
    const order: string[] = [];
    const deps = dependencies({
      scan: async (_url, _signal, onProgress) => {
        onProgress?.({ pagesCrawled: 3, requestsSent: 9 });
        return raw;
      },
      cachePayload: async () => {
        order.push("cache");
      },
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );

    await expect(bodyLines(response)).resolves.toEqual([
      '{"progress":{"pagesCrawled":3,"requestsSent":9}}',
      // Before the cache write, which is part of the same window.
      '{"stage":"building_report"}',
      terminalLine,
    ]);
    expect(order).toEqual(["cache"]);
  });

  /**
   * A run that failed never reached the report, so nothing may say it did.
   */
  it("does not announce a report for a crawl that failed", async () => {
    const deps = dependencies({
      scan: async () => {
        throw new SeoAuditScanError("scan_failed");
      },
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );

    await expect(bodyLines(response)).resolves.toEqual([
      JSON.stringify({ error: { code: "scan_failed" } }),
    ]);
  });

  /**
   * The cache is shared across visitors and is served for an hour without
   * crawling anything, so a run that was cut off must never populate it: every
   * later reader would be handed a report that silently under-reports the
   * site, with nothing on screen to say a crawl was interrupted.
   */
  it("does not cache a crawl that reported its own abort", async () => {
    const deps = dependencies({
      scan: async () => ({
        ...raw,
        availability: "partial",
        stopReason: "aborted",
      }),
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );
    await bodyLines(response);

    expect(deps.cachePayload).not.toHaveBeenCalled();
  });

  /**
   * The other half of the same question: the reader left, and the crawl
   * happened to return before the engine noticed. The abort state of this
   * request answers it without needing the crawl's own account.
   */
  /**
   * The engine holds the same signal this request does, so a crawl it
   * finished is a whole crawl even when the reader left before the report was
   * built. Only the engine's own stop reason can say a run was cut short.
   */
  it("caches a completed crawl whose reader had already gone", async () => {
    const client = new AbortController();
    const deps = dependencies({
      scan: async () => {
        client.abort();
        return raw;
      },
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }, { signal: client.signal }),
      deps,
    );
    await bodyLines(response).catch(() => {});

    expect(deps.cachePayload).toHaveBeenCalledTimes(1);
  });

  /**
   * A budget stop is not truncation, and refusing to cache one would spend a
   * fresh 4-minute crawl of a large site on every visitor. The ceiling is
   * fixed, the next crawl reaches the same place, and the payload says so.
   */
  it("caches a crawl that stopped at one of its own ceilings", async () => {
    const bounded = {
      ...raw,
      availability: "partial",
      stopReason: "max_urls",
    } satisfies SeoAuditRaw;
    const deps = dependencies({ scan: async () => bounded });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );
    await bodyLines(response);

    expect(deps.cachePayload).toHaveBeenCalledWith(
      "https://acme.test/",
      payload,
    );
  });

  /**
   * Every real browser sends `Accept: application/x-ndjson`, so essentially
   * all traffic answers 200 with the failure in the body. Without a server-side
   * record this endpoint's failure rate is invisible: no status code moves and
   * nothing is logged. `clientGone` keeps a reader who left from reading as a
   * failure of ours.
   */
  it("records a streamed failure server-side, where the status code cannot", async () => {
    const deps = dependencies({
      scan: async () => {
        throw new SeoAuditScanError("scan_failed");
      },
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );
    await bodyLines(response);

    const logged = vi.mocked(console.error).mock.calls;
    expect(logged).toHaveLength(1);
    const [message, detail] = logged[0] ?? [];
    expect(message).toContain("[seo-audit]");
    expect(JSON.parse(String(detail))).toEqual({
      code: "scan_failed",
      targetHost: "acme.test",
      clientGone: false,
      reason: "scan_failed",
    });
    // The host is the whole target of an origin-scoped crawl; the submitted
    // URL itself is never written to the log.
    expect(String(detail)).not.toContain("https://");
  });

  /**
   * A crawl that did not happen must not be narrated. The cached answer is the
   * same plain JSON both branches have always returned, with its own capture
   * timestamp, and it carries no progress at all.
   */
  it("does not pretend to crawl on a cache hit", async () => {
    const deps = dependencies({
      scan: vi.fn(async () => raw),
      openGate: async () => ({
        ok: true,
        kind: "cached",
        payload,
        capturedAt: "2026-07-30T08:00:00.000Z",
        release: () => {},
      }),
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-crawl-cache")).toBe("hit");
    expect(response.headers.get("x-public-tool-stream")).toBeNull();
    const text = await response.text();
    expect(text).not.toContain("progress");
    expect(text).toBe(terminalLine);
    expect(deps.scan).not.toHaveBeenCalled();
  });

  it.each([
    ["rate_limited", 429],
    ["quota_unavailable", 503],
  ] as const)(
    "returns the unstreamed %s refusal with its own status",
    async (code, status) => {
      const deps = dependencies({
        openGate: (clientIp, normalizedUrl) =>
          openCrawlGate(clientIp, normalizedUrl, {
            quota: {
              callQuota:
                code === "rate_limited"
                  ? async () => ({
                      allowed: false,
                      hits: 13,
                      reset_at: "2099-01-01T00:00:00.000Z",
                    })
                  : async () => {
                      throw new Error("relation does not exist");
                    },
            },
            acquireSlot: acquirePublicCrawlSlot,
          }),
      });

      const response = await handleSeoAuditRequest(
        streamingRequest({ url: "acme.test" }),
        deps,
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("x-public-tool-stream")).toBeNull();
      expect(response.headers.get("retry-after")).toBeTruthy();
      await expect(response.json()).resolves.toEqual({ error: { code } });
    },
  );

  /**
   * The honest cost of streaming: once headers are flushed the status is 200,
   * so a late failure has to arrive in the body. The Accept gate keeps this
   * confined to the browser client, whose error handling has always been
   * shape-driven rather than status-driven.
   */
  it.each([
    ["timeout", "scan_timeout"],
    ["blocked", "invalid_url"],
    ["robots_disallowed", "robots_disallowed"],
    ["robots_unreachable", "robots_unreachable"],
    ["scan_failed", "scan_failed"],
  ] as const)(
    "delivers a post-header %s as the terminal error line",
    async (sourceCode: SeoAuditScanErrorCode, expectedCode: string) => {
      const deps = dependencies({
        scan: async (_url, _signal, onProgress) => {
          onProgress?.({ pagesCrawled: 2, requestsSent: 5 });
          throw new SeoAuditScanError(sourceCode);
        },
      });

      const response = await handleSeoAuditRequest(
        streamingRequest({ url: "acme.test" }),
        deps,
      );

      expect(response.status).toBe(200);
      await expect(bodyLines(response)).resolves.toEqual([
        '{"progress":{"pagesCrawled":2,"requestsSent":5}}',
        JSON.stringify({ error: { code: expectedCode } }),
      ]);
    },
  );

  it("maps the same scan failures identically on both branches", async () => {
    for (const [sourceCode, expectedCode] of [
      ["timeout", "scan_timeout"],
      ["blocked", "invalid_url"],
      ["robots_disallowed", "robots_disallowed"],
      ["robots_unreachable", "robots_unreachable"],
      ["scan_failed", "scan_failed"],
    ] as const) {
      const failing = (): SeoAuditHandlerDependencies =>
        dependencies({
          scan: async () => {
            throw new SeoAuditScanError(sourceCode);
          },
        });

      const buffered = await handleSeoAuditRequest(
        request({ url: "acme.test" }),
        failing(),
      );
      const streamed = await handleSeoAuditRequest(
        streamingRequest({ url: "acme.test" }),
        failing(),
      );

      await expect(buffered.json()).resolves.toEqual({
        error: { code: expectedCode },
      });
      await expect(bodyLines(streamed)).resolves.toEqual([
        JSON.stringify({ error: { code: expectedCode } }),
      ]);
    }
  });

  it("aborts the crawl when the client disconnects mid-stream", async () => {
    const client = new AbortController();
    let seen: AbortSignal | undefined;
    const deps = dependencies({
      scan: (_url, signal) =>
        new Promise<SeoAuditRaw>((_resolve, reject) => {
          seen = signal;
          signal?.addEventListener("abort", () => {
            reject(new SeoAuditScanError("timeout"));
          });
        }),
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }, { signal: client.signal }),
      deps,
    );
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen?.aborted).toBe(false);

    client.abort();
    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
    await response.body?.cancel();

    // And the per-IP slot is free again, or this address is locked out until
    // the isolate recycles.
    const next = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      dependencies(),
    );
    expect(next.status).toBe(200);
  });

  /**
   * A write can fail without `cancel()` ever running: the reader can go away
   * between the closed check and the enqueue. Nobody is listening after that,
   * so a crawl left running spends its whole budget at the third-party site
   * and holds this IP's in-flight slot for the duration.
   */
  it("aborts the crawl when a progress write fails", async () => {
    const enqueue = vi
      .spyOn(ReadableStreamDefaultController.prototype, "enqueue")
      .mockImplementation(() => {
        throw new TypeError("reader went away");
      });
    let seen: AbortSignal | undefined;
    const deps = dependencies({
      scan: (_url, signal, onProgress) =>
        new Promise<SeoAuditRaw>((_resolve, reject) => {
          seen = signal;
          signal?.addEventListener("abort", () => {
            reject(new SeoAuditScanError("timeout"));
          });
          onProgress?.({ pagesCrawled: 0, requestsSent: 1 });
        }),
    });

    try {
      await handleSeoAuditRequest(streamingRequest({ url: "acme.test" }), deps);
      await vi.waitFor(() => expect(seen?.aborted).toBe(true));
    } finally {
      enqueue.mockRestore();
    }

    // And the per-IP slot is free again, or this address is locked out until
    // the isolate recycles.
    const next = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      dependencies(),
    );
    expect(next.status).toBe(200);
  });

  it("aborts the crawl and frees the slot when the response stream is cancelled", async () => {
    let seen: AbortSignal | undefined;
    const deps = dependencies({
      scan: (_url, signal) =>
        new Promise<SeoAuditRaw>((_resolve, reject) => {
          seen = signal;
          signal?.addEventListener("abort", () => {
            reject(new SeoAuditScanError("timeout"));
          });
        }),
    });

    const response = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      deps,
    );
    await vi.waitFor(() => expect(seen).toBeDefined());
    await response.body?.cancel();

    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
    const next = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      dependencies(),
    );
    expect(next.status).toBe(200);
  });

  it.each([
    ["a completed crawl", async () => raw],
    [
      "a failed crawl",
      async () => {
        throw new SeoAuditScanError("scan_failed");
      },
    ],
  ] as const)("frees the per-IP slot after %s", async (_label, scan) => {
    const first = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      dependencies({ scan }),
    );
    await bodyLines(first);

    const second = await handleSeoAuditRequest(
      streamingRequest({ url: "acme.test" }),
      dependencies(),
    );
    await expect(bodyLines(second)).resolves.toEqual([stageLine, terminalLine]);
  });
});
