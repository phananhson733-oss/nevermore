import { describe, expect, it } from "vitest";
import {
  crawlSiteContextProfile,
  CONTEXT_PROFILE_CRAWL_BUDGET,
  CONTEXT_PROFILE_MAX_TEXT_CHARS,
  CONTEXT_PROFILE_MIN_PAGES,
  CONTEXT_PROFILE_SITEMAP_LIMITS,
  CONTEXT_PROFILE_USER_AGENT,
} from "./context-profile.ts";
import type { PublicResourceFetchOptions } from "../public-http/index.ts";
import {
  codeOf,
  fakeSite,
  marketingSite,
  page,
  run,
  ORIGIN,
} from "./__tests__/context-profile-fake-site.ts";

describe("context profile budget", () => {
  it("states the Tranche 2 profile rather than the 240-second audit profile", () => {
    expect(CONTEXT_PROFILE_CRAWL_BUDGET).toMatchObject({
      maxUrls: 14,
      maxDepth: 3,
      maxWallClockMs: 60_000,
      maxBodyBytes: 2 * 1024 * 1024,
      maxTotalBytes: 24 * 1024 * 1024,
      perHostConcurrency: 5,
      minHostDelayMs: 250,
      maxRequests: 120,
    });
    expect(CONTEXT_PROFILE_SITEMAP_LIMITS).toEqual({
      maxChildDocuments: 3,
      maxUrls: 500,
    });
    expect(CONTEXT_PROFILE_MIN_PAGES).toBe(3);
    expect(CONTEXT_PROFILE_USER_AGENT).toContain("GenGrowth-Context-Profiler");
  });
});

describe("page-value ordering", () => {
  it("fetches product pages and leaves the blog and careers pages alone", async () => {
    const site = fakeSite(marketingSite());
    const result = await run(site);

    expect(result.pages.map((entry) => entry.path)).toEqual([
      "/",
      "/pricing",
      "/features",
      "/about",
      "/solutions/teams",
    ]);
    expect(result.productPagesFetched).toBe(4);
    expect(result.pagesFetched).toBe(5);
    expect(result.contextSufficient).toBe(true);
    expect(result.stopReason).toBeNull();
    expect(site.requested).not.toContain(`${ORIGIN}/blog/why-we-built-it`);
    expect(site.requested).not.toContain(`${ORIGIN}/careers`);
  });

  it("projects title, description, split headings, and bounded text", async () => {
    const site = fakeSite(marketingSite());
    const result = await run(site);
    const pricing = result.pages.find((entry) => entry.path === "/pricing");

    expect(pricing).toMatchObject({
      url: `${ORIGIN}/pricing`,
      score: 9,
      title: "Pricing",
      metaDescription: "Pricing description",
      headings: { h1: ["Pricing"], h2: ["Second"], h3: ["Third"] },
      text: "Pricing Second Third Pricing body copy.",
      textTruncated: false,
    });
  });

  it("reports null, not an empty string, when a page declares no metadata", async () => {
    const site = fakeSite(
      marketingSite({ "/pricing": { body: "<html><body></body></html>" } }),
    );
    const result = await run(site);
    const pricing = result.pages.find((entry) => entry.path === "/pricing");

    expect(pricing?.title).toBeNull();
    expect(pricing?.metaDescription).toBeNull();
    expect(pricing?.text).toBeNull();
    expect(pricing?.headings).toEqual({ h1: [], h2: [], h3: [] });
  });

  it("marks text that was cut at the projection bound", async () => {
    const long = "x".repeat(CONTEXT_PROFILE_MAX_TEXT_CHARS + 50);
    const site = fakeSite(
      marketingSite({
        "/pricing": { body: `<html><body><p>${long}</p></body></html>` },
      }),
    );
    const result = await run(site);
    const pricing = result.pages.find((entry) => entry.path === "/pricing");

    expect(pricing?.textTruncated).toBe(true);
    expect(pricing?.text).toHaveLength(CONTEXT_PROFILE_MAX_TEXT_CHARS);
  });

  it("decodes entities in headings", async () => {
    const site = fakeSite(
      marketingSite({
        "/pricing": {
          body: "<html><body><h1>Pl&auml;ne &amp; <b>Preise</b></h1></body></html>",
        },
      }),
    );
    const result = await run(site);

    expect(
      result.pages.find((entry) => entry.path === "/pricing")?.headings.h1,
    ).toEqual(["Pläne & Preise"]);
  });

  it("refuses candidates deeper than the depth budget", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme", ["/a/b/c/d", "/pricing"]) },
        "/a/b/c/d": { body: page("Deep") },
      }),
    );
    await run(site);

    expect(site.requested).not.toContain(`${ORIGIN}/a/b/c/d`);
  });

  it("prefers the target market's locale pages", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme", ["/en/pricing", "/de/preise"]) },
        "/en/pricing": { body: page("Pricing EN") },
        "/de/preise": { body: page("Preise DE") },
      }),
    );
    const result = await run(site, { targetLanguage: "de" });

    expect(result.pages.map((entry) => entry.path)).toEqual([
      "/",
      "/de/preise",
      "/en/pricing",
    ]);
  });
});

describe("robots.txt citizenship", () => {
  it("does not request a disallowed path", async () => {
    const site = fakeSite(
      marketingSite({
        "/robots.txt": { body: "User-agent: *\nDisallow: /pricing\n" },
      }),
    );
    const result = await run(site);

    expect(site.requested).not.toContain(`${ORIGIN}/pricing`);
    expect(result.pages.map((entry) => entry.path)).not.toContain("/pricing");
  });

  it("stops with its own code when the site disallows the root", async () => {
    const site = fakeSite(
      marketingSite({
        "/robots.txt": { body: "User-agent: *\nDisallow: /\n" },
      }),
    );

    await expect(codeOf(run(site))).resolves.toBe("robots_disallowed");
  });

  it("treats a 404 robots.txt as no restrictions (RFC 9309 §2.3.1.3)", async () => {
    const site = fakeSite(marketingSite({ "/robots.txt": { status: 404 } }));
    const result = await run(site);

    expect(result.pagesFetched).toBe(5);
  });

  it("fails closed when robots.txt is unreadable (RFC 9309 §2.3.1.4)", async () => {
    const site = fakeSite(marketingSite({ "/robots.txt": { status: 503 } }));

    await expect(codeOf(run(site))).resolves.toBe("robots_unreachable");
  });

  it("fails closed when robots.txt cannot be fetched at all", async () => {
    const site = fakeSite(
      marketingSite({
        "/robots.txt": { error: { kind: "error", code: "network" } },
      }),
    );

    await expect(codeOf(run(site))).resolves.toBe("robots_unreachable");
  });

  it("waits the site's own Crawl-delay instead of the floor", async () => {
    const site = fakeSite(
      marketingSite({
        "/robots.txt": { body: "User-agent: *\nCrawl-delay: 2\n" },
      }),
    );
    await run(site);

    expect(Math.max(...site.slept)).toBe(2_000);
  });

  it("never paces faster than its own floor", async () => {
    const site = fakeSite(
      marketingSite({
        "/robots.txt": { body: "User-agent: *\nCrawl-delay: 0.01\n" },
      }),
    );
    await run(site);

    expect(Math.max(...site.slept)).toBe(
      CONTEXT_PROFILE_CRAWL_BUDGET.minHostDelayMs,
    );
  });
});

describe("sitemap", () => {
  it("reads a flat sitemap for candidates the homepage does not link", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/sitemap.xml": {
          body:
            "<urlset><url><loc>https://acme.test/pricing</loc></url>" +
            "<url><loc>https://acme.test/features</loc></url></urlset>",
        },
      }),
    );
    const result = await run(site);

    expect(result.pages.map((entry) => entry.path)).toEqual([
      "/",
      "/pricing",
      "/features",
    ]);
  });

  it("prefers non-article children of a sitemap index and reads at most three", async () => {
    const child = (name: string, loc: string): string =>
      `<sitemap><loc>https://acme.test/${name}.xml</loc></sitemap>${loc}`;
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/sitemap.xml": {
          body:
            "<sitemapindex>" +
            child("sitemap-blog", "") +
            child("sitemap-news", "") +
            child("sitemap-pages", "") +
            child("sitemap-product", "") +
            child("sitemap-support", "") +
            "</sitemapindex>",
        },
        "/sitemap-pages.xml": {
          body: "<urlset><url><loc>https://acme.test/about</loc></url></urlset>",
        },
        "/sitemap-product.xml": {
          body: "<urlset><url><loc>https://acme.test/pricing</loc></url></urlset>",
        },
        "/sitemap-support.xml": {
          body: "<urlset><url><loc>https://acme.test/faq</loc></url></urlset>",
        },
        "/faq": { body: page("FAQ") },
      }),
    );
    const result = await run(site);

    expect(site.requested).toContain(`${ORIGIN}/sitemap-pages.xml`);
    expect(site.requested).toContain(`${ORIGIN}/sitemap-product.xml`);
    expect(site.requested).toContain(`${ORIGIN}/sitemap-support.xml`);
    expect(site.requested).not.toContain(`${ORIGIN}/sitemap-blog.xml`);
    expect(site.requested).not.toContain(`${ORIGIN}/sitemap-news.xml`);
    expect(result.pages.map((entry) => entry.path)).toEqual([
      "/",
      "/pricing",
      "/about",
      "/faq",
    ]);
  });

  it("uses the sitemap robots.txt declares rather than the standard path", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/robots.txt": {
          body: "User-agent: *\nSitemap: https://acme.test/sitemap-index.xml\n",
        },
        "/sitemap-index.xml": {
          body: "<urlset><url><loc>https://acme.test/pricing</loc></url></urlset>",
        },
      }),
    );
    const result = await run(site);

    expect(site.requested).toContain(`${ORIGIN}/sitemap-index.xml`);
    expect(site.requested).not.toContain(`${ORIGIN}/sitemap.xml`);
    expect(result.pages.map((entry) => entry.path)).toEqual(["/", "/pricing"]);
  });

  it("ignores a sitemap entry pointing off-origin", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/robots.txt": {
          body: "User-agent: *\nSitemap: https://cdn.other.test/sitemap.xml\n",
        },
      }),
    );
    const result = await run(site);

    expect(site.requested).not.toContain("https://cdn.other.test/sitemap.xml");
    expect(result.pagesFetched).toBe(1);
  });

  it("survives a sitemap that is not XML at all", async () => {
    const site = fakeSite(
      marketingSite({ "/sitemap.xml": { body: "not xml" } }),
    );
    const result = await run(site);

    expect(result.pagesFetched).toBe(5);
  });
});

describe("transport wiring", () => {
  it("sends the profiler user agent and the fixed per-request limits", async () => {
    const seen: PublicResourceFetchOptions[] = [];
    const site = fakeSite(marketingSite());
    await run(site, {
      fetch: async (url, options) => {
        seen.push(options);
        return site.fetch(url, options);
      },
    });

    expect(seen[0]).toMatchObject({
      userAgent: CONTEXT_PROFILE_USER_AGENT,
      maxRedirects: CONTEXT_PROFILE_CRAWL_BUDGET.maxRedirects,
      timeoutMs: CONTEXT_PROFILE_CRAWL_BUDGET.requestTimeoutMs,
    });
    // The entry probe reads a single byte: it exists only to resolve the origin.
    expect(seen[0]?.maxBodyBytes).toBe(1);
    expect(seen[1]?.maxBodyBytes).toBe(
      CONTEXT_PROFILE_CRAWL_BUDGET.maxBodyBytes,
    );
    expect(seen.every((options) => options.allowRedirect !== undefined)).toBe(
      true,
    );
  });

  it("paces on a real timer when no clock seam is supplied", async () => {
    const site = fakeSite({
      "/robots.txt": { body: "" },
      "/sitemap.xml": { status: 404 },
      "/": { body: page("Acme") },
    });
    const before = Date.now();
    const result = await crawlSiteContextProfile(`${ORIGIN}/`, {
      fetch: site.fetch,
    });

    // Three paced gaps at the 250 ms floor across four requests.
    expect(Date.now() - before).toBeGreaterThanOrEqual(500);
    expect(result.pagesFetched).toBe(1);
    expect(new Date(result.capturedAt).getFullYear()).toBeGreaterThan(2000);
  });
});

describe("frontier edge cases", () => {
  it("breaks a score tie by URL so two runs rank the same", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme", ["/product", "/features"]) },
        "/product": { body: page("Product") },
      }),
    );
    const result = await run(site);

    expect(result.pages.map((entry) => entry.path)).toEqual([
      "/",
      "/features",
      "/product",
    ]);
  });

  it("does not re-fetch the homepage under a query string", async () => {
    const site = fakeSite(
      marketingSite({ "/": { body: page("Acme", ["/?ref=nav", "/pricing"]) } }),
    );
    const result = await run(site);

    expect(result.pages.map((entry) => entry.path)).toEqual(["/", "/pricing"]);
  });

  it("skips a candidate that answers a non-success status", async () => {
    const site = fakeSite(
      marketingSite({ "/pricing": { status: 404 }, "/about": { status: 500 } }),
    );
    const result = await run(site);

    expect(result.pages.map((entry) => entry.path)).toEqual([
      "/",
      "/features",
      "/solutions/teams",
    ]);
    expect(result.botProtectionResponses).toBe(0);
    expect(result.rateLimitedResponses).toBe(0);
  });

  it("refuses an entry whose final URL left the submitted site", async () => {
    const site = fakeSite(
      marketingSite({ "/": { finalUrl: "https://evil.test/" } }),
    );

    await expect(codeOf(run(site))).resolves.toBe("entry_unreachable");
  });

  it("names the downgrade when only the site root refuses HTTPS", async () => {
    const site = fakeSite(
      marketingSite({
        "/docs": { body: page("Docs") },
        "/": { redirectTo: "http://acme.test/" },
      }),
    );

    await expect(
      codeOf(
        crawlSiteContextProfile(`${ORIGIN}/docs`, {
          fetch: site.fetch,
          now: site.now,
          sleep: site.sleep,
        }),
      ),
    ).resolves.toBe("protocol_downgrade_rejected");
  });

  it("ignores an off-origin child of a sitemap index", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/sitemap.xml": {
          body:
            "<sitemapindex>" +
            "<sitemap><loc>https://cdn.other.test/pages.xml</loc></sitemap>" +
            "<sitemap><loc>https://acme.test/pages.xml</loc></sitemap>" +
            "</sitemapindex>",
        },
        "/pages.xml": {
          body: "<urlset><url><loc>https://acme.test/pricing</loc></url></urlset>",
        },
      }),
    );
    const result = await run(site);

    expect(site.requested).not.toContain("https://cdn.other.test/pages.xml");
    expect(result.pages.map((entry) => entry.path)).toEqual(["/", "/pricing"]);
  });

  it("stops reading sitemap children once the URL cap is reached", async () => {
    const locs = Array.from(
      { length: CONTEXT_PROFILE_SITEMAP_LIMITS.maxUrls },
      (_unused, index) => `<url><loc>https://acme.test/p${index}</loc></url>`,
    ).join("");
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/sitemap.xml": {
          body:
            "<sitemapindex>" +
            "<sitemap><loc>https://acme.test/bulk.xml</loc></sitemap>" +
            "<sitemap><loc>https://acme.test/more.xml</loc></sitemap>" +
            "</sitemapindex>",
        },
        "/bulk.xml": { body: `<urlset>${locs}</urlset>` },
        "/more.xml": {
          body: "<urlset><url><loc>https://acme.test/pricing</loc></url></urlset>",
        },
      }),
    );
    const result = await run(site);

    expect(site.requested).toContain(`${ORIGIN}/bulk.xml`);
    expect(site.requested).not.toContain(`${ORIGIN}/more.xml`);
    expect(result.pages.map((entry) => entry.path)).not.toContain("/pricing");
  });
});
