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
import { resetPublicToolSlots } from "./public-tool-request.ts";

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
    schemaVersion: "seo_audit.sitewide.v2",
    mode: "public_preview",
    scope: "bounded_same_origin_static_html_audit",
    persistence: "none",
    completedAt: "2026-07-30T09:00:00.000Z",
  },
  result: {
    targetUrl: "https://acme.test/",
    scannedAt: "2026-07-30T09:00:00.000Z",
    coverage: {
      availability: "available",
      pagesInspected: 0,
      maxPages: 25,
      maxDepth: 4,
      maxRequests: 60,
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
    rateLimit: () => ({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    }),
    extractClientIp: () => "203.0.113.9",
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
    expect(response.headers.get("x-ratelimit-remaining")).toBe("4");
    await expect(response.json()).resolves.toEqual({ data: payload });
    expect(deps.scan).toHaveBeenCalledWith("https://acme.test/");
    expect(deps.buildPayload).toHaveBeenCalledWith(raw);
  });

  it("rejects an oversized request before validation, rate limit, or scan", async () => {
    const scan = vi.fn(async () => raw);
    const rateLimit = vi.fn(() => ({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    }));
    const deps = dependencies({ scan, rateLimit });
    const response = await handleSeoAuditRequest(
      request({ url: "x".repeat(5_000) }),
      deps,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it("rejects unknown input fields before rate limiting or scanning", async () => {
    const scan = vi.fn(async () => raw);
    const rateLimit = vi.fn(() => ({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    }));
    const deps = dependencies({ scan, rateLimit });

    const response = await handleSeoAuditRequest(
      request({ url: "acme.test", persist: true }),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it("applies the IP rate gate before any network scan", async () => {
    const scan = vi.fn(async () => raw);
    const deps = dependencies({
      scan,
      rateLimit: () => ({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 42_000,
        retryAfterSeconds: 42,
      }),
    });
    const response = await handleSeoAuditRequest(
      request({ url: "acme.test" }),
      deps,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(scan).not.toHaveBeenCalled();
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
    expect(second.status).toBe(429);
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
