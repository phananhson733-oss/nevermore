import { describe, expect, it } from "vitest";
import type { CollectionContext } from "../adapter.ts";
import { createCanonicalUrlGuard } from "../url-safety/index.ts";
import { crawlSite } from "./engine.ts";
import { CRAWL_BUDGET } from "./types.ts";
import type { CrawlFetcher } from "./types.ts";

const PARAMS = { origin: "https://example.com", host: "example.com" } as const;
const CONFIG = { userAgent: "SignalFrameBot/0.2" } as const;
const CTX: CollectionContext = {
  workspaceId: "ws",
  projectId: "pr",
  siteId: "site",
  runId: "run",
};

/** A guard that resolves the fixture host to a public IP and blocks everything else via real classification. */
const GUARD = createCanonicalUrlGuard({
  lookup: async (hostname: string) => {
    if (hostname === "example.com" || hostname === "www.example.com") return ["93.184.216.34"];
    throw new Error(`unexpected DNS lookup: ${hostname}`);
  },
});

const FAST_BUDGET = { ...CRAWL_BUDGET, minHostDelayMs: 0 } as const;

type Route = () => Response;

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
}

function text(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

function makeFetcher(routes: Record<string, Route>): { fetcher: CrawlFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: CrawlFetcher = {
    async fetch(url) {
      calls.push(url);
      const route = routes[url];
      if (!route) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
      return route();
    },
  };
  return { fetcher, calls };
}

const ROBOTS_TXT = [
  "User-agent: *",
  "Disallow: /admin/",
  "User-agent: GPTBot",
  "Disallow: /",
  "User-agent: ClaudeBot",
  "Disallow: /private/",
  "Sitemap: https://example.com/sitemap.xml",
].join("\n");

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>`;

const HOME_HTML = `<!doctype html><html lang="en"><head>
  <title>Example Home</title>
  <meta name="description" content="The example homepage.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://example.com/">
  <script type="application/ld+json">{"@type":"Organization","name":"Example"}</script>
</head><body>
  <h1>Welcome</h1>
  <p>We build delightful widgets.</p>
  <a href="/about" rel="nofollow">About</a>
</body></html>`;

const ABOUT_HTML = `<html><head><title>About</title></head><body><h1>About</h1><p>Since 2020.</p></body></html>`;

describe("crawlSite", () => {
  it("crawls a normal site into pages, robots, and sitemap", async () => {
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(ROBOTS_TXT),
      "https://example.com/sitemap.xml": () => xml(SITEMAP_XML),
      "https://example.com/": () => html(HOME_HTML),
      "https://example.com/about": () => html(ABOUT_HTML),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, { guard: GUARD, budget: FAST_BUDGET });

    expect(raw.availability).toBe("available");
    expect(raw.stopReason).toBeNull();
    expect(raw.limitation.length).toBeGreaterThan(0);
    expect(raw.pages.map((page) => page.subjectUrl)).toEqual([
      "https://example.com/",
      "https://example.com/about",
    ]);

    const home = raw.pages[0]?.projection;
    expect(home?.title).toBe("Example Home");
    expect(home?.h1).toEqual(["Welcome"]);
    expect(home?.robotsIndexable).toBe(true);
    expect(home?.sitemapMember).toBe(true);
    expect(home?.jsonLd.types).toContain("Organization");
    expect(home?.internalOutlinks.map((link) => link.targetSubjectUrl)).toContain("https://example.com/about");

    expect(raw.robots.fetched).toBe(true);
    expect(raw.robots.sitemaps).toContain("https://example.com/sitemap.xml");
    const robotUas = raw.robots.groups.map((group) => group.userAgent.toLowerCase());
    for (const bot of ["oai-searchbot", "chatgpt-user", "perplexitybot", "claudebot"]) {
      expect(robotUas).toContain(bot);
    }

    expect(raw.sitemap.fetched).toBe(true);
    expect(raw.sitemap.urlCount).toBe(2);
    expect(raw.sitemap.subjectUrls).toContain("https://example.com/about");
    expect(raw.providerUsage.pagesCollected).toBe(2);
  });

  it("returns partial with a stopReason and keeps collected pages when a budget is hit", async () => {
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(ROBOTS_TXT),
      "https://example.com/sitemap.xml": () => xml(SITEMAP_XML),
      "https://example.com/": () => html(HOME_HTML),
      "https://example.com/about": () => html(ABOUT_HTML),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...CRAWL_BUDGET, maxUrls: 1, perHostConcurrency: 1, minHostDelayMs: 0 },
    });

    expect(raw.availability).toBe("partial");
    expect(raw.stopReason).toBe("max_urls");
    expect(raw.pages).toHaveLength(1);
    expect(raw.pages[0]?.subjectUrl).toBe("https://example.com/");
  });

  it("blocks a redirect to a private address and never fetches it", async () => {
    const homeWithRedirect = `<html><head><title>Home</title></head><body>
      <h1>Home</h1><a href="/go">internal redirect</a></body></html>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () => text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () => new Response("nope", { status: 404 }),
      "https://example.com/": () => html(homeWithRedirect),
      "https://example.com/go": () => redirect("http://169.254.169.254/latest/meta-data"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, { guard: GUARD, budget: FAST_BUDGET });

    expect(calls.some((url) => url.includes("169.254.169.254"))).toBe(false);
    expect(raw.pages.some((page) => page.subjectUrl.includes("169.254.169.254"))).toBe(false);
    expect(raw.providerUsage.urlsBlocked).toBeGreaterThanOrEqual(1);
    expect(raw.pages.map((page) => page.subjectUrl)).toContain("https://example.com/");
  });

  it("skips a non-HTML content type without recording a page", async () => {
    const homeWithPdf = `<html><head><title>Home</title></head><body>
      <h1>Home</h1><a href="/doc.pdf">the doc</a></body></html>`;
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () => new Response("nope", { status: 404 }),
      "https://example.com/": () => html(homeWithPdf),
      "https://example.com/doc.pdf": () =>
        new Response("%PDF-1.4 binary", { status: 200, headers: { "content-type": "application/pdf" } }),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, { guard: GUARD, budget: FAST_BUDGET });

    expect(raw.pages.some((page) => page.subjectUrl.endsWith("doc.pdf"))).toBe(false);
    expect(raw.pages.map((page) => page.subjectUrl)).toContain("https://example.com/");
    expect(raw.providerUsage.urlsSkipped).toBeGreaterThanOrEqual(1);
  });
});
