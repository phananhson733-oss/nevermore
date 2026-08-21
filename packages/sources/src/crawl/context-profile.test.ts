import { describe, expect, it } from "vitest";
import {
  crawlSiteContextProfile,
  CONTEXT_PROFILE_CRAWL_BUDGET,
  CONTEXT_PROFILE_MAX_TEXT_CHARS,
  CONTEXT_PROFILE_MIN_PAGES,
  CONTEXT_PROFILE_SITEMAP_LIMITS,
  CONTEXT_PROFILE_SITEMAP_TRUNCATION_REASONS,
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
  type Route,
} from "./__tests__/context-profile-fake-site.ts";

describe("context profile budget", () => {
  it("states the Tranche 2 profile rather than the 240-second audit profile", () => {
    expect(CONTEXT_PROFILE_CRAWL_BUDGET).toMatchObject({
      maxUrls: 20,
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
    expect(CONTEXT_PROFILE_SITEMAP_TRUNCATION_REASONS).toEqual([
      "seed_cap",
      "child_document_cap",
      "url_cap",
      "nested_index_skipped",
      "off_origin_filtered",
      "budget_stopped",
      "document_unavailable",
      "document_body_truncated",
      "malformed_document",
      "malformed_url_filtered",
      "token_budget",
    ]);
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
      "/features",
      "/solutions/teams",
      "/pricing",
    ]);
    expect(result.productPagesFetched).toBe(3);
    expect(result.pagesFetched).toBe(4);
    expect(result.contextSufficient).toBe(true);
    expect(result.stopReason).toBeNull();
    expect(site.requested).not.toContain(`${ORIGIN}/blog/why-we-built-it`);
    expect(site.requested).not.toContain(`${ORIGIN}/careers`);
  });

  it("orders navigation, product, pricing, content lists, then shallow fallbacks", async () => {
    const sitemap = [
      "/sitemap-fallback",
      "/pricing",
      "/resources",
      "/features",
      "/about",
    ]
      .map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`)
      .join("");
    const site = fakeSite({
      "/robots.txt": { body: "" },
      "/sitemap.xml": { body: `<urlset>${sitemap}</urlset>` },
      "/": {
        body: `<html><body>
          <header><a href="/nav-unknown">Navigation</a></header>
          <main><a href="/features">Features</a></main>
          <footer><a href="/about">About</a></footer>
        </body></html>`,
      },
      "/nav-unknown": { body: page("Navigation") },
      "/features": { body: page("Features") },
      "/pricing": { body: page("Pricing") },
      "/resources": { body: page("Resources") },
      "/sitemap-fallback": { body: page("Fallback") },
      "/about": { body: page("About") },
    });

    const result = await run(site);

    expect(result.pages.map((entry) => entry.path)).toEqual([
      "/",
      "/nav-unknown",
      "/features",
      "/pricing",
      "/resources",
      "/sitemap-fallback",
    ]);
    expect(result.sitemapInventory?.urls).toContain(`${ORIGIN}/about`);
    expect(site.requested).not.toContain(`${ORIGIN}/about`);
    expect(result.selection).toEqual({
      eligibleCandidates: 5,
      excludedCandidates: 1,
      attemptedCandidates: 5,
      truncatedCandidates: 0,
    });
  });

  it("hard-excludes utility, auth, content-detail, and pagination URLs before requests", async () => {
    const excluded = [
      "/about",
      "/contact-us",
      "/privacy-policy",
      "/sign-in",
      "/blog/article",
      "/resources/article",
      "/pricing?page=2",
      "/resources/page/2",
    ];
    const sitemap = [...excluded, "/pricing"]
      .map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`)
      .join("");
    const routes: Record<string, Route> = {
      "/robots.txt": { body: "" },
      "/sitemap.xml": { body: `<urlset>${sitemap}</urlset>` },
      "/": { body: page("Acme", excluded) },
      "/pricing": { body: page("Pricing") },
    };
    for (const path of excluded) {
      routes[new URL(path, ORIGIN).pathname] = { body: page(path) };
    }
    const site = fakeSite(routes);

    const result = await run(site);

    expect(result.pages.map((entry) => entry.path)).toEqual(["/", "/pricing"]);
    for (const path of excluded) {
      expect(site.requested).not.toContain(`${ORIGIN}${path}`);
    }
    expect(result.sitemapInventory?.urls).toEqual(
      expect.arrayContaining(excluded.map((path) => `${ORIGIN}${path}`)),
    );
    expect(result.selection).toMatchObject({
      eligibleCandidates: 1,
      excludedCandidates: excluded.length,
      attemptedCandidates: 1,
      truncatedCandidates: 0,
    });
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

  it("excludes pages from a non-target locale", async () => {
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
    ]);
    expect(site.requested).not.toContain(`${ORIGIN}/en/pricing`);
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

    expect(result.pagesFetched).toBe(4);
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
  it("reports an unavailable inventory when no sitemap can be fetched", async () => {
    const result = await run(fakeSite(marketingSite()));

    expect(result.sitemapInventory).toEqual({
      urls: [],
      fetched: false,
      complete: false,
      documentsRead: 0,
      truncationReasons: ["document_unavailable"],
    });
  });

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
      "/features",
      "/pricing",
    ]);
    expect(result.sitemapInventory).toEqual({
      urls: [
        "https://acme.test/pricing",
        "https://acme.test/features",
      ],
      fetched: true,
      complete: true,
      documentsRead: 1,
      truncationReasons: [],
    });
  });

  it("marks the bounded inventory incomplete when robots declares more than one seed", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/robots.txt": {
          body:
            "User-agent: *\n" +
            "Sitemap: https://acme.test/first.xml\n" +
            "Sitemap: https://acme.test/second.xml\n",
        },
        "/first.xml": {
          body: "<urlset><url><loc>https://acme.test/pricing</loc></url></urlset>",
        },
        "/second.xml": {
          body: "<urlset><url><loc>https://acme.test/features</loc></url></urlset>",
        },
      }),
    );
    const result = await run(site);

    expect(site.requested).toContain(`${ORIGIN}/first.xml`);
    expect(site.requested).not.toContain(`${ORIGIN}/second.xml`);
    expect(result.sitemapInventory).toEqual({
      urls: [`${ORIGIN}/pricing`],
      fetched: true,
      complete: false,
      documentsRead: 1,
      truncationReasons: ["seed_cap"],
    });
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
      "/faq",
      "/pricing",
    ]);
    expect(result.sitemapInventory).toEqual({
      urls: [
        `${ORIGIN}/about`,
        `${ORIGIN}/pricing`,
        `${ORIGIN}/faq`,
      ],
      fetched: true,
      complete: false,
      documentsRead: 4,
      truncationReasons: ["child_document_cap"],
    });
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

    expect(result.pagesFetched).toBe(4);
    expect(result.sitemapInventory).toEqual({
      urls: [],
      fetched: true,
      complete: false,
      documentsRead: 1,
      truncationReasons: ["malformed_document"],
    });
  });

  it("rejects a soft-error HTML document that only mentions a urlset tag", async () => {
    const site = fakeSite(
      marketingSite({
        "/sitemap.xml": {
          body:
            '<html><body><script>const example = "<urlset></urlset>";</script></body></html>',
        },
      }),
    );
    const result = await run(site);

    expect(result.sitemapInventory).toEqual({
      urls: [],
      fetched: true,
      complete: false,
      documentsRead: 1,
      truncationReasons: ["malformed_document"],
    });
  });

  it("accepts a genuinely empty urlset as a complete bounded inventory", async () => {
    const site = fakeSite(
      marketingSite({
        "/sitemap.xml": {
          body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
        },
      }),
    );
    const result = await run(site);

    expect(result.sitemapInventory).toEqual({
      urls: [],
      fetched: true,
      complete: true,
      documentsRead: 1,
      truncationReasons: [],
    });
  });

  it("does not call a response complete when the transport hit its body cap", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/sitemap.xml": {
          body: "<urlset><url><loc>https://acme.test/pricing</loc></url></urlset>",
        },
      }),
    );
    const result = await run(site, {
      fetch: async (url, options) => {
        const response = await site.fetch(url, options);
        if (
          new URL(url).pathname === "/sitemap.xml" &&
          response.kind === "ok"
        ) {
          return { ...response, bodyComplete: false };
        }
        return response;
      },
    });

    expect(result.sitemapInventory).toEqual({
      urls: [`${ORIGIN}/pricing`],
      fetched: true,
      complete: false,
      documentsRead: 1,
      truncationReasons: ["document_body_truncated"],
    });
  });

  it("skips a nested sitemap index and records why its URLs are absent", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/sitemap.xml": {
          body:
            "<sitemapindex><sitemap><loc>https://acme.test/nested.xml</loc></sitemap></sitemapindex>",
        },
        "/nested.xml": {
          body:
            "<sitemapindex><sitemap><loc>https://acme.test/pages.xml</loc></sitemap></sitemapindex>",
        },
        "/pages.xml": {
          body: "<urlset><url><loc>https://acme.test/pricing</loc></url></urlset>",
        },
      }),
    );
    const result = await run(site);

    expect(site.requested).toContain(`${ORIGIN}/nested.xml`);
    expect(site.requested).not.toContain(`${ORIGIN}/pages.xml`);
    expect(result.sitemapInventory).toEqual({
      urls: [],
      fetched: true,
      complete: false,
      documentsRead: 2,
      truncationReasons: ["nested_index_skipped"],
    });
  });

  it("filters a malformed member URL and records the incomplete inventory", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/sitemap.xml": {
          body:
            "<urlset>" +
            "<url><loc>::::</loc></url>" +
            "<url><loc>https://user:secret@acme.test/private</loc></url>" +
            "<url><loc>https://acme.test/%E0%A4%A</loc></url>" +
            "<url><loc>https://acme.test/pricing</loc></url>" +
            "</urlset>",
        },
      }),
    );
    const result = await run(site);

    expect(result.sitemapInventory).toEqual({
      urls: [`${ORIGIN}/pricing`],
      fetched: true,
      complete: false,
      documentsRead: 1,
      truncationReasons: ["malformed_url_filtered"],
    });
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
  it("counts only eligible URLs left unattempted by the successful-page cap as truncated", async () => {
    const links = Array.from(
      { length: 22 },
      (_unused, index) => `/tools/t${index.toString().padStart(2, "0")}`,
    );
    const routes: Record<string, Route> = {
      "/robots.txt": { body: "" },
      "/sitemap.xml": { status: 404 },
      "/": { body: page("Acme", links) },
    };
    for (const path of links) routes[path] = { body: page(path) };
    routes["/tools/t00"] = { status: 404 };
    routes["/tools/t01"] = { status: 500 };

    const result = await run(fakeSite(routes));

    expect(result.pagesFetched).toBe(CONTEXT_PROFILE_CRAWL_BUDGET.maxUrls);
    expect(result.stopReason).toBe("max_urls");
    expect(result.selection).toEqual({
      eligibleCandidates: 22,
      excludedCandidates: 0,
      attemptedCandidates: 21,
      truncatedCandidates: 1,
    });
  });

  it("replenishes failed candidates until all 20 page slots succeed", async () => {
    const tail = Array.from(
      { length: 19 },
      (_unused, index) => `/tools/t${index.toString().padStart(2, "0")}`,
    );
    const routes: Record<string, Route> = {
      "/robots.txt": { body: "" },
      "/sitemap.xml": { status: 404 },
      "/": {
        body: page("Acme", [
          "/pricing",
          "/features",
          "/product",
          "/about",
          "/customers",
          ...tail,
        ]),
      },
      "/pricing": { status: 404 },
      "/features": { status: 500 },
      "/product": { error: { kind: "error", code: "timeout" } },
      "/about": { status: 403 },
      "/customers": { status: 429 },
    };
    for (const path of tail) routes[path] = { body: page(path) };
    const site = fakeSite(routes);
    const result = await run(site);

    expect(result.pagesFetched).toBe(20);
    expect(result.pages.at(-1)?.path).toBe("/tools/t18");
    expect(result.stopReason).toBe("max_urls");
    expect(result.selection?.truncatedCandidates).toBe(1);
    expect(result.botProtectionResponses).toBe(0);
    expect(result.rateLimitedResponses).toBe(1);
    expect(site.requested).toContain(`${ORIGIN}/tools/t12`);
  });

  it("fills the page budget from custom depth-two product paths in a 34-URL sitemap", async () => {
    const customPaths = Array.from(
      { length: 31 },
      (_unused, index) =>
        `/story-generators/custom-${index.toString().padStart(2, "0")}`,
    );
    const sitemapPaths = ["/pricing", "/features", "/product", ...customPaths];
    const sitemap = sitemapPaths
      .map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`)
      .join("");
    const routes: Record<string, Route> = {
      "/robots.txt": { body: "" },
      "/sitemap.xml": { body: `<urlset>${sitemap}</urlset>` },
      "/": { body: page("AI Story Generator") },
      "/pricing": { status: 404 },
      "/features": { status: 500 },
      "/product": { error: { kind: "error", code: "timeout" } },
    };
    for (const path of customPaths) routes[path] = { body: page(path) };
    const site = fakeSite(routes);
    const result = await run(site);

    expect(sitemapPaths).toHaveLength(34);
    expect(result.pagesFetched).toBe(CONTEXT_PROFILE_CRAWL_BUDGET.maxUrls);
    expect(
      result.pages.filter((entry) => entry.path.startsWith("/story-generators/")),
    ).toHaveLength(CONTEXT_PROFILE_CRAWL_BUDGET.maxUrls - 1);
    expect(result.stopReason).toBe("max_urls");
  });

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
    expect(result.sitemapInventory).toEqual({
      urls: [`${ORIGIN}/pricing`],
      fetched: true,
      complete: false,
      documentsRead: 2,
      truncationReasons: ["off_origin_filtered"],
    });
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
    expect(result.sitemapInventory).toBeDefined();
    expect(result.sitemapInventory?.urls).toHaveLength(
      CONTEXT_PROFILE_SITEMAP_LIMITS.maxUrls,
    );
    expect(result.sitemapInventory).toMatchObject({
      fetched: true,
      complete: false,
      documentsRead: 2,
      truncationReasons: ["url_cap"],
    });
  });

  it("marks a sitemap inventory incomplete when the crawl budget stops a child read", async () => {
    const site = fakeSite(
      marketingSite({
        "/": { body: page("Acme") },
        "/sitemap.xml": {
          body:
            "<sitemapindex><sitemap><loc>https://acme.test/pages.xml</loc></sitemap></sitemapindex>",
        },
        "/pages.xml": {
          body: "<urlset><url><loc>https://acme.test/pricing</loc></url></urlset>",
        },
      }),
      {
        onRequest: (url, current) => {
          if (new URL(url).pathname === "/sitemap.xml") {
            current.advance(CONTEXT_PROFILE_CRAWL_BUDGET.maxWallClockMs);
          }
        },
      },
    );
    const result = await run(site);

    expect(site.requested).not.toContain(`${ORIGIN}/pages.xml`);
    expect(result.sitemapInventory).toEqual({
      urls: [],
      fetched: true,
      complete: false,
      documentsRead: 1,
      truncationReasons: ["budget_stopped"],
    });
  });
});
