import { describe, expect, it, vi } from "vitest";
import {
  countingCrawlFetcher,
  crawlPublicSitePreview,
  isAllowedPublicToolEntryRedirect,
  PUBLIC_PREVIEW_CRAWL_USER_AGENT,
  PublicPreviewTargetRedirectError,
  PUBLIC_TOOL_SYNC_CRAWL_BUDGET,
  PUBLIC_TOOL_SYNC_MAX_REQUESTS,
} from "./public-preview.ts";
import type { PublicResourceResult } from "../public-http/index.ts";
import type { CrawlFetcher } from "./types.ts";

describe("public preview crawl profile", () => {
  it("uses a synchronous safety profile rather than the former 25-page product quota", () => {
    expect(PUBLIC_TOOL_SYNC_CRAWL_BUDGET).toEqual({
      maxUrls: 2_000,
      maxDepth: 6,
      maxWallClockMs: 240_000,
      maxRedirects: 5,
      maxBodyBytes: 2 * 1024 * 1024,
      maxTotalBytes: 128 * 1024 * 1024,
      perHostConcurrency: 5,
      minHostDelayMs: 250,
    });
    expect(PUBLIC_PREVIEW_CRAWL_USER_AGENT).toContain(
      "GenGrowth-Public-Tools-Crawler",
    );
    expect(PUBLIC_TOOL_SYNC_MAX_REQUESTS).toBe(4_500);
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
        return new Response(
          "<html><title>Fixture</title><body>Body</body></html>",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        );
      },
    };

    const result = await crawlPublicSitePreview(
      "https://acme.test/docs?section=seo#ignored",
      undefined,
      {
        fetcher,
        entryResolver: async (url) => entryResult(url),
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
          page.projection.fetchUrl === "https://acme.test/docs?section=seo",
      ),
    ).toBe(true);
    expect(
      requested.some((url) => url === "https://acme.test/docs?section=seo"),
    ).toBe(true);
  });

  it("rejects a replaced entry page before the crawl transport runs", async () => {
    const fetch = vi.fn(async (url: string) => previewFixtureResponse(url));
    const fetcher: CrawlFetcher = { fetch };
    const submittedUrl = "https://acme.test/old";

    const redirectError = await crawlPublicSitePreview(
      submittedUrl,
      undefined,
      {
        fetcher,
        entryResolver: async () =>
          entryResult(
            submittedUrl,
            "https://acme.test/?utm_source=test",
          ),
        requireSameEntrySubject: true,
        engineOptions: {
          guard: async (url) => ({
            safe: true,
            normalizedUrl: url,
            pinnedIp: "93.184.216.34",
            reason: null,
          }),
        },
      },
    ).catch((error: unknown) => error);

    expect(redirectError).toBeInstanceOf(PublicPreviewTargetRedirectError);
    expect(redirectError).toMatchObject({
      name: "PublicPreviewTargetRedirectError",
      targetUrl: "https://acme.test/",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a strict entry whose non-tracking query changes", async () => {
    const fetch = vi.fn(async (url: string) => previewFixtureResponse(url));
    const fetcher: CrawlFetcher = { fetch };
    const submittedUrl = "https://acme.test/docs?a=1";

    const redirectError = await crawlPublicSitePreview(
      submittedUrl,
      undefined,
      {
        fetcher,
        entryResolver: async () =>
          entryResult(submittedUrl, "https://acme.test/docs?a=2"),
        requireSameEntrySubject: true,
        engineOptions: {
          guard: async (url) => ({
            safe: true,
            normalizedUrl: url,
            pinnedIp: "93.184.216.34",
            reason: null,
          }),
        },
      },
    ).catch((error: unknown) => error);

    expect(redirectError).toBeInstanceOf(PublicPreviewTargetRedirectError);
    expect(redirectError).toMatchObject({
      name: "PublicPreviewTargetRedirectError",
      targetUrl: "https://acme.test/docs?a=2",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP upgrade", "http://acme.test/docs", "https://acme.test/docs"],
    [
      "apex to www",
      "https://acme.test/docs",
      "https://www.acme.test/docs",
    ],
    [
      "www to apex",
      "https://www.acme.test/docs",
      "https://acme.test/docs",
    ],
    [
      "trailing slash normalization",
      "https://acme.test/docs",
      "https://acme.test/docs/",
    ],
    [
      "tracking-only query removal",
      "https://acme.test/docs?utm_source=test",
      "https://acme.test/docs",
    ],
  ])(
    "keeps crawling after a strict %s entry redirect",
    async (_label, submittedUrl, finalUrl) => {
      const fetch = vi.fn(async (url: string) => previewFixtureResponse(url));
      const fetcher: CrawlFetcher = { fetch };

      await expect(
        crawlPublicSitePreview(submittedUrl, undefined, {
          fetcher,
          entryResolver: async () => entryResult(submittedUrl, finalUrl),
          requireSameEntrySubject: true,
          engineOptions: {
            guard: async (url) => ({
              safe: true,
              normalizedUrl: url,
              pinnedIp: "93.184.216.34",
              reason: null,
            }),
          },
        }),
      ).resolves.toMatchObject({ origin: new URL(finalUrl).origin });
      expect(fetch).toHaveBeenCalled();
    },
  );

  it("keeps path-changing redirects crawlable unless strict entry matching is requested", async () => {
    const fetch = vi.fn(async (url: string) => previewFixtureResponse(url));
    const fetcher: CrawlFetcher = { fetch };
    const submittedUrl = "https://acme.test/old";

    await expect(
      crawlPublicSitePreview(submittedUrl, undefined, {
        fetcher,
        entryResolver: async () =>
          entryResult(submittedUrl, "https://acme.test/"),
        engineOptions: {
          guard: async (url) => ({
            safe: true,
            normalizedUrl: url,
            pinnedIp: "93.184.216.34",
            reason: null,
          }),
        },
      }),
    ).resolves.toMatchObject({ origin: "https://acme.test" });
    expect(fetch).toHaveBeenCalled();
  });

  it.each([
    ["same-host path", "https://acme.test/a", "https://acme.test/b"],
    ["HTTP upgrade", "http://acme.test/", "https://acme.test/"],
    ["apex to www", "https://acme.test/", "https://www.acme.test/"],
    ["www to apex", "https://www.acme.test/", "https://acme.test/"],
    ["HTTP apex to HTTPS www", "http://acme.test/", "https://www.acme.test/"],
  ])("allows the %s canonical entry transition", (_label, from, to) => {
    expect(isAllowedPublicToolEntryRedirect(from, to)).toBe(true);
  });

  it.each([
    ["HTTPS downgrade", "https://acme.test/", "http://acme.test/"],
    [
      "arbitrary sibling subdomain",
      "https://acme.test/",
      "https://blog.acme.test/",
    ],
    [
      "look-alike suffix domain",
      "https://acme.test/",
      "https://acme.test.evil.test/",
    ],
    [
      "different registrable domain",
      "https://acme.test/",
      "https://other.test/",
    ],
  ])("rejects the %s entry transition", (_label, from, to) => {
    expect(isAllowedPublicToolEntryRedirect(from, to)).toBe(false);
  });

  it("resolves an apex entry to its www canonical origin before crawling", async () => {
    const requested: string[] = [];
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        requested.push(url);
        const path = new URL(url).pathname;
        if (path === "/robots.txt") {
          return new Response("", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        if (path === "/sitemap.xml") {
          return new Response("", {
            status: 404,
            headers: { "content-type": "application/xml" },
          });
        }
        return new Response("<html><title>Canonical host</title></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    };

    const result = await crawlPublicSitePreview(
      "https://acme.test/",
      undefined,
      {
        fetcher,
        entryResolver: async () =>
          entryResult("https://acme.test/", "https://www.acme.test/"),
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

    expect(result.origin).toBe("https://www.acme.test");
    expect(result.pages[0]?.projection.fetchUrl).toBe("https://www.acme.test/");
    expect(
      requested.every((url) => new URL(url).hostname === "www.acme.test"),
    ).toBe(true);
  });

  it("collects more than 25 discoverable pages when synchronous capacity allows", async () => {
    let nowMs = 0;
    const sitemapUrls = Array.from(
      { length: 30 },
      (_, index) => `https://acme.test/page-${index + 1}`,
    );
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        const path = new URL(url).pathname;
        if (path === "/robots.txt") {
          return new Response(
            "User-agent: *\nSitemap: https://acme.test/sitemap.xml",
            {
              status: 200,
              headers: { "content-type": "text/plain" },
            },
          );
        }
        if (path === "/sitemap.xml") {
          return new Response(
            `<?xml version="1.0"?><urlset>${sitemapUrls
              .map((pageUrl) => `<url><loc>${pageUrl}</loc></url>`)
              .join("")}</urlset>`,
            {
              status: 200,
              headers: { "content-type": "application/xml" },
            },
          );
        }
        return new Response("<html><title>Fixture page</title></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    };

    const result = await crawlPublicSitePreview(
      "https://acme.test/",
      undefined,
      {
        fetcher,
        entryResolver: async (url) => entryResult(url),
        engineOptions: {
          now: () => {
            nowMs += 250;
            return nowMs;
          },
          guard: async (url) => ({
            safe: true,
            normalizedUrl: url,
            pinnedIp: "93.184.216.34",
            reason: null,
          }),
        },
      },
    );

    expect(result.pages.length).toBeGreaterThan(25);
    expect(result.stopReason).not.toBe("max_urls");
  });

  /**
   * The public tools may only ever state a page figure the finished report can
   * confirm, so the live seam has to be the engine's collected-page count and
   * not a transport counter. `engineOptions` is an offline test seam that API
   * callers cannot reach, so the listener needs its own production-safe door.
   */
  it("reports the collected page count while the crawl runs", async () => {
    const seen: number[] = [];
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        const path = new URL(url).pathname;
        if (path === "/robots.txt") {
          return new Response("User-agent: *\n", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        if (path === "/sitemap.xml") {
          return new Response(
            '<?xml version="1.0"?><urlset><url><loc>https://acme.test/about</loc></url></urlset>',
            { status: 200, headers: { "content-type": "application/xml" } },
          );
        }
        return new Response("<html><title>Fixture page</title></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    };

    const result = await crawlPublicSitePreview(
      "https://acme.test/",
      undefined,
      {
        fetcher,
        entryResolver: async (url) => entryResult(url),
        onPageProgress: ({ pagesCollected }) => seen.push(pagesCollected),
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

    expect(result.pages.length).toBe(2);
    expect(seen.at(-1)).toBe(result.pages.length);
  });

  /**
   * The wire-request count needs a door of its own for exactly the reason the
   * page count does. Reading it by injecting a transport through `fetcher`
   * would put production on the seam this file documents as offline-only, and
   * the whole guarantee of that seam is that the shipped crawl uses the
   * guarded default transport.
   */
  it("counts wire requests through its own door rather than a transport injection", async () => {
    const sent: number[] = [];
    const requested: string[] = [];
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        requested.push(url);
        const path = new URL(url).pathname;
        if (path === "/robots.txt") {
          return new Response("User-agent: *\n", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        if (path === "/sitemap.xml") {
          return new Response(
            '<?xml version="1.0"?><urlset><url><loc>https://acme.test/about</loc></url></urlset>',
            { status: 200, headers: { "content-type": "application/xml" } },
          );
        }
        return new Response("<html><title>Fixture page</title></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    };

    await crawlPublicSitePreview("https://acme.test/", undefined, {
      fetcher,
      entryResolver: async (url) => entryResult(url),
      onRequestSent: (requestsSent) => sent.push(requestsSent),
      engineOptions: {
        guard: async (url) => ({
          safe: true,
          normalizedUrl: url,
          pinnedIp: "93.184.216.34",
          reason: null,
        }),
      },
    });

    // One reading per wire request, in issue order: robots.txt and every
    // sitemap document count, which is why this runs ahead of the page count.
    expect(sent).toEqual(requested.map((_url, index) => index + 1));
    expect(sent.length).toBeGreaterThan(2);
  });
});

/**
 * The wrapper behind `onRequestSent`. It is tested directly because its whole
 * job is to add a count without touching the request: the engine builds the
 * SSRF-pinned dispatcher and passes it on `init`, so a wrapper that rebuilds
 * that object strips the pinned transport and every fetch fails closed.
 */
describe("countingCrawlFetcher", () => {
  function innerFetcher(): CrawlFetcher {
    return { fetch: vi.fn(async () => new Response("ok")) };
  }

  it("reports the running wire-request count before each request goes out", async () => {
    const inner = innerFetcher();
    const seen: number[] = [];
    const fetcher = countingCrawlFetcher(inner, (count) => seen.push(count));
    const signal = new AbortController().signal;

    await fetcher.fetch("https://acme.test/robots.txt", { signal });
    await fetcher.fetch("https://acme.test/", { signal });
    await fetcher.fetch("https://acme.test/about", { signal });

    expect(seen).toEqual([1, 2, 3]);
  });

  it("hands the transport init through untouched so the pinned dispatcher survives", async () => {
    const inner = innerFetcher();
    const fetcher = countingCrawlFetcher(inner, () => {});
    const signal = new AbortController().signal;
    const init = { signal, pinnedIp: "203.0.113.7", dispatcher: {} };

    await fetcher.fetch("https://acme.test/", init);

    expect(inner.fetch).toHaveBeenCalledWith("https://acme.test/", init);
  });

  it("never lets an observation failure end a crawl", async () => {
    const inner = innerFetcher();
    const fetcher = countingCrawlFetcher(inner, () => {
      throw new Error("observer exploded");
    });

    await expect(
      fetcher.fetch("https://acme.test/", {
        signal: new AbortController().signal,
      }),
    ).resolves.toBeInstanceOf(Response);
    expect(inner.fetch).toHaveBeenCalledOnce();
  });
});

function entryResult(
  requestedUrl: string,
  finalUrl = requestedUrl,
): Extract<PublicResourceResult, { readonly kind: "ok" }> {
  return {
    kind: "ok",
    requestedUrl,
    finalUrl,
    firstStatus: requestedUrl === finalUrl ? 200 : 307,
    finalStatus: 200,
    redirectChain: requestedUrl === finalUrl ? [] : [finalUrl],
    contentType: "text/html",
    xRobotsTag: null,
    body: "<",
    bytes: 1,
    bodyComplete: false,
  };
}

function previewFixtureResponse(url: string): Response {
  const path = new URL(url).pathname;
  if (path === "/robots.txt") {
    return new Response("User-agent: *\n", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  if (path === "/sitemap.xml") {
    return new Response("", {
      status: 404,
      headers: { "content-type": "application/xml" },
    });
  }
  return new Response("<html><title>Fixture page</title></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}
