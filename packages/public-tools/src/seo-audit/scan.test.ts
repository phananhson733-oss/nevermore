import { describe, expect, it, vi } from "vitest";
import type { CrawlRaw } from "@sf/sources";
import { PublicPreviewTargetRedirectError } from "@sf/sources/crawl-public-preview";
import {
  crawlProgressReporter,
  scanSeoAuditSite,
  SeoAuditScanError,
  type SeoAuditCrawler,
  type SeoAuditProgress,
} from "./scan.ts";

const fixture = {
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
} satisfies CrawlRaw;

describe("scanSeoAuditSite", () => {
  it("delegates to the fixed public crawler", async () => {
    const crawl = vi.fn(async () => fixture) satisfies SeoAuditCrawler;
    await expect(
      scanSeoAuditSite("https://acme.test/path", undefined, { crawl }),
    ).resolves.toEqual({
      ...fixture,
      requestedUrl: "https://acme.test/path",
    });
    expect(crawl).toHaveBeenCalledWith(
      "https://acme.test/path",
      undefined,
      undefined,
    );
  });

  it("preserves a partial crawl for an honest bounded result", async () => {
    const partial: CrawlRaw = {
      ...fixture,
      availability: "partial",
      stopReason: "max_urls",
    };
    await expect(
      scanSeoAuditSite("https://acme.test", undefined, {
        crawl: async () => partial,
      }),
    ).resolves.toEqual({
      ...partial,
      requestedUrl: "https://acme.test",
    });
  });

  it("rejects an unavailable crawl", async () => {
    const unavailable: CrawlRaw = {
      ...fixture,
      availability: "unavailable",
    };
    await expect(
      scanSeoAuditSite("https://acme.test", undefined, {
        crawl: async () => unavailable,
      }),
    ).rejects.toMatchObject({
      code: "scan_failed",
    });
  });

  it.each([
    ["robots_disallowed", "robots_disallowed"],
    ["robots_unreachable", "robots_unreachable"],
  ] as const)(
    "reports %s as its own answer rather than a generic failure",
    async (stopReason, expected) => {
      await expect(
        scanSeoAuditSite("https://acme.test", undefined, {
          crawl: async () => ({
            ...fixture,
            availability: "unavailable",
            stopReason,
          }),
        }),
      ).rejects.toMatchObject({ code: expected });
    },
  );

  it("maps timeout-like crawler failures without exposing transport details", async () => {
    await expect(
      scanSeoAuditSite("https://acme.test", undefined, {
        crawl: async () => {
          throw new Error("max_duration at private upstream");
        },
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("preserves a replaced entry target as a typed scan outcome", async () => {
    const redirectTarget = "https://www.acme.test/";
    const crawl = vi.fn(async () => {
      throw new PublicPreviewTargetRedirectError(redirectTarget);
    }) satisfies SeoAuditCrawler;

    const failure: unknown = await scanSeoAuditSite(
      "https://acme.test/replaced",
      undefined,
      { crawl, requireSameEntrySubject: true },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SeoAuditScanError);
    expect(failure).toMatchObject({
      code: "target_redirected",
      redirectTarget,
    });
    expect(crawl).toHaveBeenCalledWith(
      "https://acme.test/replaced",
      undefined,
      undefined,
    );
  });

  it("forwards a progress listener to the crawler unchanged", async () => {
    const seen: SeoAuditProgress[] = [];
    const crawl: SeoAuditCrawler = async (_url, _signal, onProgress) => {
      onProgress?.({ pagesCrawled: 0, requestsSent: 1 });
      onProgress?.({ pagesCrawled: 2, requestsSent: 7 });
      return fixture;
    };

    await scanSeoAuditSite("https://acme.test", undefined, {
      crawl,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen).toEqual([
      { pagesCrawled: 0, requestsSent: 1 },
      { pagesCrawled: 2, requestsSent: 7 },
    ]);
  });

  it("passes the strict entry option only through the production crawler", async () => {
    const crawlPublicSitePreview = vi.fn(async () => fixture);
    vi.resetModules();
    vi.doMock(
      "@sf/sources/crawl-public-preview",
      async (importOriginal) => ({
        ...(await importOriginal<
          typeof import("@sf/sources/crawl-public-preview")
        >()),
        crawlPublicSitePreview,
      }),
    );

    try {
      const { scanSeoAuditSite: scanWithMockedProductionCrawler } = await import(
        "./scan.ts"
      );
      await scanWithMockedProductionCrawler(
        "https://acme.test/replaced",
        undefined,
        { requireSameEntrySubject: true },
      );

      expect(crawlPublicSitePreview).toHaveBeenCalledWith(
        "https://acme.test/replaced",
        undefined,
        { requireSameEntrySubject: true },
      );
    } finally {
      vi.doUnmock("@sf/sources/crawl-public-preview");
      vi.resetModules();
    }
  });
});

/**
 * Two seams describe one crawl: the transport counts wire requests, the engine
 * counts collected pages. They are merged here so every observation carries
 * both, and so the page figure is the engine's own — the number the finished
 * report states as `coverage.pagesInspected`.
 */
describe("crawlProgressReporter", () => {
  it("carries both figures on every observation", () => {
    const seen: SeoAuditProgress[] = [];
    const reporter = crawlProgressReporter((progress) => seen.push(progress));

    reporter.onRequest(1);
    reporter.onRequest(2);
    reporter.onPageProgress({ pagesCollected: 1 });
    reporter.onRequest(3);
    reporter.onPageProgress({ pagesCollected: 2 });

    expect(seen).toEqual([
      { pagesCrawled: 0, requestsSent: 1 },
      { pagesCrawled: 0, requestsSent: 2 },
      { pagesCrawled: 1, requestsSent: 2 },
      { pagesCrawled: 1, requestsSent: 3 },
      { pagesCrawled: 2, requestsSent: 3 },
    ]);
  });

  /**
   * robots.txt and the sitemap documents are requests that collect no page, so
   * a reader must never be shown a page count they produced.
   */
  it("reports no page until the engine has collected one", () => {
    const seen: SeoAuditProgress[] = [];
    const reporter = crawlProgressReporter((progress) => seen.push(progress));

    reporter.onRequest(1);
    reporter.onRequest(2);

    expect(seen.every((progress) => progress.pagesCrawled === 0)).toBe(true);
  });

  it("keeps its own state when the listener throws", () => {
    const seen: SeoAuditProgress[] = [];
    const reporter = crawlProgressReporter((progress) => {
      seen.push(progress);
      if (seen.length === 1) throw new Error("observer exploded");
    });

    expect(() => reporter.onRequest(1)).toThrow();
    reporter.onPageProgress({ pagesCollected: 1 });

    expect(seen.at(-1)).toEqual({ pagesCrawled: 1, requestsSent: 1 });
  });
});
