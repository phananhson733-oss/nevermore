import { describe, expect, it } from "vitest";
import {
  crawlPublicSitePreview,
  PUBLIC_PREVIEW_CRAWL_BUDGET,
  PUBLIC_PREVIEW_MAX_REQUESTS,
  PUBLIC_PREVIEW_CRAWL_USER_AGENT,
} from "./public-preview.ts";
import type { CrawlFetcher } from "./types.ts";

describe("public preview crawl profile", () => {
  it("keeps anonymous crawl resources below the full product profile", () => {
    expect(PUBLIC_PREVIEW_CRAWL_BUDGET).toEqual({
      maxUrls: 25,
      maxDepth: 4,
      maxWallClockMs: 40_000,
      maxRedirects: 5,
      maxBodyBytes: 1 * 1024 * 1024,
      maxTotalBytes: 12 * 1024 * 1024,
      perHostConcurrency: 2,
      minHostDelayMs: 300,
    });
    expect(PUBLIC_PREVIEW_CRAWL_USER_AGENT).toContain(
      "GenGrowth-Public-Tools-Crawler",
    );
    expect(PUBLIC_PREVIEW_MAX_REQUESTS).toBe(60);
  });

  it("keeps a submitted same-origin path as an additional crawl seed", async () => {
    const requested: string[] = [];
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        requested.push(url);
        if (new URL(url).pathname === "/robots.txt") {
          return new Response("", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        if (new URL(url).pathname === "/sitemap.xml") {
          return new Response("", {
            status: 404,
            headers: { "content-type": "application/xml" },
          });
        }
        return new Response("<html><title>Fixture</title><body>Body</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    };

    const result = await crawlPublicSitePreview(
      "https://acme.test/docs?section=seo#ignored",
      undefined,
      {
        fetcher,
        engineOptions: {
          guard: async (url) => ({
            safe: true,
            normalizedUrl: url,
            pinnedIp: "93.184.216.34",
            reason: null,
          }),
        },
      },
    );

    expect(
      result.pages.some(
        (page) =>
          page.projection.fetchUrl ===
          "https://acme.test/docs?section=seo",
      ),
    ).toBe(true);
    expect(
      requested.some((url) => url === "https://acme.test/docs?section=seo"),
    ).toBe(true);
  });
});
