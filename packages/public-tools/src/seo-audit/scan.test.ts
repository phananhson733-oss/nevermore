import { describe, expect, it, vi } from "vitest";
import type { CrawlRaw } from "@sf/sources";
import {
  scanSeoAuditSite,
  type SeoAuditCrawler,
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
      scanSeoAuditSite("https://acme.test/path", undefined, crawl),
    ).resolves.toEqual({
      ...fixture,
      requestedUrl: "https://acme.test/path",
    });
    expect(crawl).toHaveBeenCalledWith("https://acme.test/path", undefined);
  });

  it("preserves a partial crawl for an honest bounded result", async () => {
    const partial: CrawlRaw = {
      ...fixture,
      availability: "partial",
      stopReason: "max_urls",
    };
    await expect(
      scanSeoAuditSite("https://acme.test", undefined, async () => partial),
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
      scanSeoAuditSite("https://acme.test", undefined, async () => unavailable),
    ).rejects.toMatchObject({
      code: "scan_failed",
    });
  });

  it("maps timeout-like crawler failures without exposing transport details", async () => {
    await expect(
      scanSeoAuditSite("https://acme.test", undefined, async () => {
        throw new Error("max_duration at private upstream");
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
