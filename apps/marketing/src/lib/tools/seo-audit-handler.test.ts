import { beforeEach, describe, expect, it, vi } from "vitest";
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

const raw = {
  origin: "https://acme.test",
  host: "acme.test",
  pages: [],
  robots: { fetched: true, groups: [], sitemaps: [] },
  sitemap: { fetched: true, urlCount: 0, subjectUrls: [] },
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
    schemaVersion: "seo_audit.sitewide.v3",
    mode: "public_preview",
    scope: "discoverable_same_origin_static_html_audit",
    persistence: "none",
    completedAt: "2026-07-30T09:00:00.000Z",
  },
  result: {
    targetUrl: "https://acme.test/",
    siteOrigin: "https://acme.test",
    scannedAt: "2026-07-30T09:00:00.000Z",
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
