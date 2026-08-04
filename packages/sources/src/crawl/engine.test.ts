import { describe, expect, it } from "vitest";
import type { CollectionContext } from "../adapter.ts";
import { createCanonicalUrlGuard } from "../url-safety/index.ts";
import { crawlSite } from "./engine.ts";
import {
  CRAWL_BUDGET,
  CRAWL_ENGINE_WALL_CLOCK_BUDGET_MS,
  CRAWL_FINALIZATION_HEADROOM_MS,
  CRAWL_JOB_WALL_CLOCK_CAP_MS,
  CRAWL_PROJECTION_LIMITS,
} from "./types.ts";
import type { CrawlFetcher, CrawlParams } from "./types.ts";

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
    if (hostname === "example.com" || hostname === "www.example.com")
      return ["93.184.216.34"];
    throw new Error(`unexpected DNS lookup: ${hostname}`);
  },
});

const FAST_BUDGET = { ...CRAWL_BUDGET, minHostDelayMs: 0 } as const;
const byteLength = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

type Route = () => Response;

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function xml(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/xml" },
  });
}

function text(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

function textOnlyHtml(body: string): Response {
  const response = new Response(null, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  Object.defineProperty(response, "text", {
    value: async () => body,
  });
  return response;
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<
  { readonly kind: "settled"; readonly value: T } | { readonly kind: "timeout" }
> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ kind: "settled", value });
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function stalledBodyResponse(
  onCancel: () => void | PromiseLike<void>,
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        return onCancel();
      },
    }),
    { headers: { "content-type": "text/plain" } },
  );
}

function redirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

function makeFetcher(routes: Record<string, Route>): {
  fetcher: CrawlFetcher;
  calls: string[];
} {
  const calls: string[] = [];
  const fetcher: CrawlFetcher = {
    async fetch(url) {
      calls.push(url);
      const route = routes[url];
      if (!route)
        return new Response("not found", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      return route();
    },
  };
  return { fetcher, calls };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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
  it("keeps the frozen crawl cap while reserving finalization headroom", () => {
    expect(CRAWL_JOB_WALL_CLOCK_CAP_MS).toBe(15 * 60 * 1_000);
    expect(CRAWL_FINALIZATION_HEADROOM_MS).toBe(60 * 1_000);
    expect(CRAWL_ENGINE_WALL_CLOCK_BUDGET_MS).toBe(
      CRAWL_JOB_WALL_CLOCK_CAP_MS - CRAWL_FINALIZATION_HEADROOM_MS,
    );
    expect(CRAWL_BUDGET).toMatchObject({
      maxUrls: 2_000,
      maxWallClockMs: CRAWL_ENGINE_WALL_CLOCK_BUDGET_MS,
      maxBodyBytes: 5 * 1_024 * 1_024,
      maxTotalBytes: 128 * 1_024 * 1_024,
    });
  });

  it("stops before transport when no decoded-byte budget remains", async () => {
    const { fetcher, calls } = makeFetcher({});

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxTotalBytes: 0,
        perHostConcurrency: 1,
      },
    });

    expect(raw.stopReason).toBe("max_total_bytes");
    expect(raw.availability).toBe("partial");
    expect(raw.providerUsage.bytesFetched).toBe(0);
    expect(calls).toEqual([]);
  });

  it("re-pins every same-origin redirect hop to its validated IP", async () => {
    const transportCalls: Array<{
      url: string;
      pinnedIp: unknown;
      dispatcher: unknown;
    }> = [];
    const fetcher: CrawlFetcher = {
      async fetch(url, init) {
        transportCalls.push({
          url,
          pinnedIp: Reflect.get(init, "pinnedIp"),
          dispatcher: Reflect.get(init, "dispatcher"),
        });
        if (url === "https://example.com/robots.txt") {
          return redirect("https://example.com/robots-v2.txt");
        }
        if (url === "https://example.com/robots-v2.txt") {
          return text("User-agent: *\nDisallow:\n");
        }
        if (url === "https://example.com/sitemap.xml") {
          return new Response("not found", { status: 404 });
        }
        if (url === "https://example.com/") return html(HOME_HTML);
        if (url === "https://example.com/about") return html(ABOUT_HTML);
        return new Response("not found", { status: 404 });
      },
    };
    const guard = createCanonicalUrlGuard({
      lookup: async (hostname) => {
        if (hostname === "example.com") return ["93.184.216.34"];
        throw new Error(`unexpected DNS lookup: ${hostname}`);
      },
    });

    await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard,
      budget: FAST_BUDGET,
    });

    expect(transportCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/robots.txt",
          pinnedIp: "93.184.216.34",
        }),
        expect.objectContaining({
          url: "https://example.com/robots-v2.txt",
          pinnedIp: "93.184.216.34",
        }),
      ]),
    );
    const redirectHops = transportCalls.filter((call) =>
      call.url.includes("/robots"),
    );
    expect(redirectHops).toHaveLength(2);
    expect(redirectHops[0]?.dispatcher).toBeTruthy();
    expect(redirectHops[1]?.dispatcher).toBeTruthy();
    expect(redirectHops[0]?.dispatcher).not.toBe(redirectHops[1]?.dispatcher);
    expect(
      redirectHops.every(
        (hop) =>
          typeof hop.dispatcher === "object" &&
          hop.dispatcher !== null &&
          Reflect.get(hop.dispatcher, "closed") === true,
      ),
    ).toBe(true);
  });

  it("keeps a discovered page's trailing slash for transport while folding only its aggregation identity", async () => {
    const home = `<html><head><title>Home</title></head><body>
      <a href="/pricing/">Pricing</a></body></html>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("not found", { status: 404 }),
      "https://example.com/": () => html(home),
      "https://example.com/pricing/": () =>
        html("<html><head><title>Pricing</title></head></html>"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls).toContain("https://example.com/pricing/");
    expect(calls).not.toContain("https://example.com/pricing");
    expect(raw.pages).toContainEqual(
      expect.objectContaining({
        subjectUrl: "https://example.com/pricing",
        projection: expect.objectContaining({
          fetchUrl: "https://example.com/pricing/",
        }),
      }),
    );
    expect(JSON.stringify(raw)).not.toContain("internalFetchTargets");
    expect(JSON.stringify(raw)).not.toContain("canonicalFetchTarget");
  });

  it("preserves exact slash paths across an /a/ to /b/ redirect journey", async () => {
    const home = `<html><head><title>Home</title></head><body>
      <a href="/a/">Redirecting page</a></body></html>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("not found", { status: 404 }),
      "https://example.com/": () => html(home),
      "https://example.com/a/": () => redirect("/b/"),
      "https://example.com/b/": () =>
        html("<html><head><title>B</title></head></html>"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls).toContain("https://example.com/a/");
    expect(calls).toContain("https://example.com/b/");
    expect(calls).not.toContain("https://example.com/a");
    expect(calls).not.toContain("https://example.com/b");
    expect(raw.pages).toContainEqual(
      expect.objectContaining({
        subjectUrl: "https://example.com/a",
        projection: expect.objectContaining({
          fetchUrl: "https://example.com/a/",
          status: 301,
          finalStatus: 200,
          redirectChain: ["https://example.com/b/"],
        }),
      }),
    );
  });

  it("uses an exact sitemap member fetch URL while persisting only its aggregation subject", async () => {
    const sitemapBody = `<urlset>
      <url><loc>https://example.com/docs/</loc></url>
    </urlset>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text(
          "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml",
        ),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () => html(HOME_HTML),
      "https://example.com/docs/": () =>
        html(
          '<html><head><title>Docs</title><link rel="canonical" href="/docs/"></head></html>',
        ),
      "https://example.com/about": () => html(ABOUT_HTML),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls).toContain("https://example.com/docs/");
    expect(calls).not.toContain("https://example.com/docs");
    expect(raw.sitemap.subjectUrls).toContain("https://example.com/docs");
    expect(raw.pages).toContainEqual(
      expect.objectContaining({
        subjectUrl: "https://example.com/docs",
        projection: expect.objectContaining({
          fetchUrl: "https://example.com/docs/",
          canonicalTarget: "https://example.com/docs/",
          sitemapMember: true,
        }),
      }),
    );
  });

  it.each([
    ["/a", "/a/", "/b"],
    ["/b", "/a/", "/a"],
  ])(
    "allocates a tight URL budget to distinct sitemap subjects before extra exact variants: %j",
    async (...members) => {
      const urls = members.map((path) => `https://example.com${path}`);
      const sitemapBody = `<urlset>${urls
        .map((url) => `<url><loc>${url}</loc></url>`)
        .join("")}</urlset>`;
      const { fetcher, calls } = makeFetcher({
        "https://example.com/robots.txt": () =>
          text(
            "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml",
          ),
        "https://example.com/sitemap.xml": () => xml(sitemapBody),
        "https://example.com/": () =>
          html("<html><head><title>Home</title></head></html>"),
        "https://example.com/a": () =>
          html("<html><head><title>A</title></head></html>"),
        "https://example.com/a/": () =>
          html("<html><head><title>A slash</title></head></html>"),
        "https://example.com/b": () =>
          html("<html><head><title>B</title></head></html>"),
      });

      const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
        guard: GUARD,
        budget: {
          ...FAST_BUDGET,
          maxUrls: 3,
          perHostConcurrency: 1,
        },
      });

      expect(raw.stopReason).toBe("max_urls");
      expect(calls).toEqual([
        "https://example.com/robots.txt",
        "https://example.com/sitemap.xml",
        "https://example.com/",
        "https://example.com/a",
        "https://example.com/b",
      ]);
      expect(raw.pages.map((page) => page.projection.fetchUrl)).toEqual([
        "https://example.com/",
        "https://example.com/a",
        "https://example.com/b",
      ]);
    },
  );

  it("seeds root then the exact deep URL before fairly allocated sitemap targets", async () => {
    const seedUrl = "https://example.com/products/widget/";
    const sitemapBody = `<urlset>
      <url><loc>https://example.com/a</loc></url>
      <url><loc>https://example.com/a/</loc></url>
      <url><loc>https://example.com/b</loc></url>
    </urlset>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text(
          "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml",
        ),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () =>
        html("<html><head><title>Home</title></head></html>"),
      [seedUrl]: () => html("<html><head><title>Widget</title></head></html>"),
      "https://example.com/a": () =>
        html("<html><head><title>A</title></head></html>"),
      "https://example.com/a/": () =>
        html("<html><head><title>A slash</title></head></html>"),
      "https://example.com/b": () =>
        html("<html><head><title>B</title></head></html>"),
    });
    const params = { ...PARAMS, seedUrl } satisfies CrawlParams;

    const raw = await crawlSite(params, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxUrls: 4,
        perHostConcurrency: 1,
      },
    });

    expect(calls).toEqual([
      "https://example.com/robots.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/",
      seedUrl,
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(raw.stopReason).toBe("max_urls");
    expect(raw.pages).toContainEqual(
      expect.objectContaining({
        subjectUrl: "https://example.com/products/widget",
        depth: 0,
        projection: expect.objectContaining({
          fetchUrl: seedUrl,
          sitemapMember: false,
        }),
      }),
    );
  });

  it("keeps slash and non-slash seeds as distinct exact fetch identities", async () => {
    const seedUrl = "https://example.com/pricing/";
    const sitemapUrl = "https://example.com/pricing";
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text(
          "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml",
        ),
      "https://example.com/sitemap.xml": () =>
        xml(`<urlset><url><loc>${sitemapUrl}</loc></url></urlset>`),
      "https://example.com/": () =>
        html("<html><head><title>Home</title></head></html>"),
      [seedUrl]: () =>
        html("<html><head><title>Pricing slash</title></head></html>"),
      [sitemapUrl]: () =>
        html("<html><head><title>Pricing</title></head></html>"),
    });

    const raw = await crawlSite({ ...PARAMS, seedUrl }, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls.slice(2)).toEqual([
      "https://example.com/",
      seedUrl,
      sitemapUrl,
    ]);
    expect(
      raw.pages
        .filter((page) => page.subjectUrl === "https://example.com/pricing")
        .map((page) => page.projection.fetchUrl),
    ).toEqual([sitemapUrl, seedUrl]);
  });

  it("fetches a deep seed even when no sitemap or root outlink discovers it", async () => {
    const seedUrl = "https://example.com/products/standalone";
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("not found", { status: 404 }),
      "https://example.com/": () =>
        html("<html><head><title>Home</title></head></html>"),
      [seedUrl]: () =>
        html("<html><head><title>Standalone</title></head></html>"),
    });

    const raw = await crawlSite({ ...PARAMS, seedUrl }, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls).toEqual([
      "https://example.com/robots.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/",
      seedUrl,
    ]);
    expect(raw.pages).toContainEqual(
      expect.objectContaining({
        subjectUrl: seedUrl,
        depth: 0,
        projection: expect.objectContaining({ fetchUrl: seedUrl }),
      }),
    );
  });

  it("deduplicates a seed whose exact identity is the crawl root", async () => {
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("not found", { status: 404 }),
      "https://example.com/": () =>
        html("<html><head><title>Home</title></head></html>"),
    });

    const raw = await crawlSite(
      { ...PARAMS, seedUrl: "https://example.com" },
      CONFIG,
      CTX,
      fetcher,
      {
        guard: GUARD,
        budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
      },
    );

    expect(calls.filter((url) => url === "https://example.com/")).toHaveLength(
      1,
    );
    expect(raw.pages).toHaveLength(1);
    expect(raw.pages[0]?.depth).toBe(0);
  });

  it.each([
    ["cross-origin", "https://outside.example/product"],
    ["malformed", "not a URL"],
    ["credentials", "https://user:secret@example.com/product"],
    ["fragment", "https://example.com/product#details"],
    [
      "overlong",
      `https://example.com/${"x".repeat(CRAWL_PROJECTION_LIMITS.maxUrlChars)}`,
    ],
  ])(
    "ignores an invalid %s seed before guard and transport",
    async (_case, seedUrl) => {
      const guardedUrls: string[] = [];
      const guard = async (url: string) => {
        guardedUrls.push(url);
        return GUARD(url);
      };
      const { fetcher, calls } = makeFetcher({
        "https://example.com/robots.txt": () =>
          text("User-agent: *\nDisallow:\n"),
        "https://example.com/sitemap.xml": () =>
          new Response("not found", { status: 404 }),
        "https://example.com/": () =>
          html("<html><head><title>Home</title></head></html>"),
      });

      const raw = await crawlSite(
        { ...PARAMS, seedUrl },
        CONFIG,
        CTX,
        fetcher,
        {
          guard,
          budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
        },
      );

      expect(calls).toEqual([
        "https://example.com/robots.txt",
        "https://example.com/sitemap.xml",
        "https://example.com/",
      ]);
      expect(guardedUrls).toEqual(calls);
      expect(raw.pages.map((page) => page.projection.fetchUrl)).toEqual([
        "https://example.com/",
      ]);
    },
  );

  it("applies robots rules to a deep seed before its transport", async () => {
    const seedUrl = "https://example.com/private/product";
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow: /private/\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("not found", { status: 404 }),
      "https://example.com/": () =>
        html("<html><head><title>Home</title></head></html>"),
      [seedUrl]: () => html("<html><head><title>Private</title></head></html>"),
    });

    const raw = await crawlSite({ ...PARAMS, seedUrl }, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls).not.toContain(seedUrl);
    expect(raw.providerUsage.urlsDisallowed).toBe(1);
    expect(raw.pages.map((page) => page.projection.fetchUrl)).toEqual([
      "https://example.com/",
    ]);
  });

  it("keeps redirect request and directly fetched terminal identities as separate factual records", async () => {
    const oldUrl = "https://example.com/old";
    const targetUrl = "https://example.com/target";
    const targetHtml = `<html><head><title>Terminal target</title></head>
      <body><a href="child">Child</a></body></html>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text(
          "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml",
        ),
      "https://example.com/sitemap.xml": () =>
        xml(`<urlset>
          <url><loc>${oldUrl}</loc></url>
          <url><loc>${targetUrl}</loc></url>
        </urlset>`),
      "https://example.com/": () =>
        html("<html><head><title>Home</title></head></html>"),
      [oldUrl]: () => redirect(targetUrl),
      [targetUrl]: () => html(targetHtml),
      "https://example.com/child": () =>
        html("<html><head><title>Child</title></head></html>"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });
    const oldPage = raw.pages.find(
      (page) => page.projection.fetchUrl === oldUrl,
    );
    const targetPage = raw.pages.find(
      (page) => page.projection.fetchUrl === targetUrl,
    );

    expect(calls.filter((url) => url === targetUrl)).toHaveLength(2);
    expect(oldPage).toMatchObject({
      subjectUrl: oldUrl,
      projection: {
        fetchUrl: oldUrl,
        status: 301,
        finalStatus: 200,
        redirectChain: [targetUrl],
        title: "Terminal target",
        sitemapMember: true,
      },
    });
    expect(targetPage).toMatchObject({
      subjectUrl: targetUrl,
      projection: {
        fetchUrl: targetUrl,
        status: 200,
        finalStatus: 200,
        redirectChain: [],
        title: "Terminal target",
        sitemapMember: true,
      },
    });
    expect(
      oldPage?.projection.internalOutlinks.map((link) => link.targetSubjectUrl),
    ).toContain("https://example.com/child");
  });

  it("marks only the exact fetch URL declared by the sitemap as a member", async () => {
    const landing = "https://example.com/landing";
    const landingSlash = "https://example.com/landing/";
    const home = `<html><head><title>Home</title></head><body>
      <a href="${landingSlash}">Landing slash variant</a></body></html>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text(
          "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml",
        ),
      "https://example.com/sitemap.xml": () =>
        xml(`<urlset><url><loc>${landing}</loc></url></urlset>`),
      "https://example.com/": () => html(home),
      [landing]: () => html("<html><head><title>Landing</title></head></html>"),
      [landingSlash]: () =>
        html("<html><head><title>Landing slash</title></head></html>"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls).toEqual(expect.arrayContaining([landing, landingSlash]));
    expect(raw.sitemap.subjectUrls).toContain(landing);
    const pagesByFetchUrl = new Map(
      raw.pages.map((page) => [page.projection.fetchUrl, page] as const),
    );
    expect(pagesByFetchUrl.get(landing)).toMatchObject({
      subjectUrl: landing,
      projection: { fetchUrl: landing, sitemapMember: true },
    });
    expect(pagesByFetchUrl.get(landingSlash)).toMatchObject({
      subjectUrl: landing,
      projection: { fetchUrl: landingSlash, sitemapMember: false },
    });
  });

  it("keeps a frontier target for every bounded sitemap subject when slash variants repeat", async () => {
    const repeatedVariants = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxSitemapUrls / 2 },
      (_unused, index) => {
        const suffix = String(index).padStart(4, "0");
        return `<url><loc>https://example.com/z-${suffix}</loc></url>
          <url><loc>https://example.com/z-${suffix}/</loc></url>`;
      },
    ).join("");
    const sitemapBody = `<urlset>${repeatedVariants}
      <url><loc>https://example.com/a-target/</loc></url>
    </urlset>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text(
          "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml",
        ),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () => html(HOME_HTML),
      "https://example.com/a-target/": () =>
        html("<html><head><title>Target</title></head></html>"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxUrls: 2,
        perHostConcurrency: 1,
      },
    });

    expect(raw.sitemap.subjectUrls).toContain("https://example.com/a-target");
    expect(calls).toContain("https://example.com/a-target/");
    expect(calls).not.toContain("https://example.com/a-target");
  });

  it("discovers links from every successful exact fetch regardless of slash-variant completion order", async () => {
    const landing = "https://example.com/landing";
    const landingSlash = "https://example.com/landing/";
    const uniqueTargets = [
      "https://example.com/canonical-from-no-slash",
      "https://example.com/link-from-no-slash",
      "https://example.com/canonical-from-slash",
      "https://example.com/link-from-slash",
    ] as const;

    const crawlWithFirstCompletion = async (
      first: "no-slash" | "slash",
    ): Promise<{
      readonly calls: readonly string[];
      readonly raw: Awaited<ReturnType<typeof crawlSite>>;
    }> => {
      const noSlashResponse = deferred<Response>();
      const slashResponse = deferred<Response>();
      const noSlashStarted = deferred<void>();
      const slashStarted = deferred<void>();
      const firstTargetStarted = deferred<void>();
      const calls: string[] = [];
      const fetcher: CrawlFetcher = {
        async fetch(url) {
          calls.push(url);
          if (url === "https://example.com/robots.txt") {
            return text("User-agent: *\nDisallow:\n");
          }
          if (url === "https://example.com/sitemap.xml") {
            return xml(
              `<urlset><url><loc>${landing}</loc></url><url><loc>${landingSlash}</loc></url></urlset>`,
            );
          }
          if (url === "https://example.com/") {
            return html("<html><head><title>Home</title></head></html>");
          }
          if (url === landing) {
            noSlashStarted.resolve();
            return noSlashResponse.promise;
          }
          if (url === landingSlash) {
            slashStarted.resolve();
            return slashResponse.promise;
          }
          if (uniqueTargets.includes(url as (typeof uniqueTargets)[number])) {
            const targetForFirstPage =
              first === "no-slash"
                ? url.includes("from-no-slash")
                : url.includes("from-slash");
            if (targetForFirstPage) firstTargetStarted.resolve();
            return html(`<html><head><title>${url}</title></head></html>`);
          }
          return new Response("not found", { status: 404 });
        },
      };

      const pending = crawlSite(PARAMS, CONFIG, CTX, fetcher, {
        guard: GUARD,
        budget: {
          ...FAST_BUDGET,
          maxUrls: 12,
          perHostConcurrency: 3,
        },
      });
      await Promise.all([noSlashStarted.promise, slashStarted.promise]);

      if (first === "no-slash") {
        noSlashResponse.resolve(
          html(
            `<html><head><title>No slash</title><link rel="canonical" href="/canonical-from-no-slash"></head><body><a href="/link-from-no-slash">Link</a></body></html>`,
          ),
        );
      } else {
        slashResponse.resolve(
          html(
            `<html><head><title>Slash</title><link rel="canonical" href="/canonical-from-slash"></head><body><a href="/link-from-slash">Link</a></body></html>`,
          ),
        );
      }
      // Do not release the other representation until the first one has been
      // accepted and its frontier work has begun. This makes both completion
      // orders deterministic instead of relying on timers or scheduler luck.
      await firstTargetStarted.promise;

      if (first === "no-slash") {
        slashResponse.resolve(
          html(
            `<html><head><title>Slash</title><link rel="canonical" href="/canonical-from-slash"></head><body><a href="/link-from-slash">Link</a></body></html>`,
          ),
        );
      } else {
        noSlashResponse.resolve(
          html(
            `<html><head><title>No slash</title><link rel="canonical" href="/canonical-from-no-slash"></head><body><a href="/link-from-no-slash">Link</a></body></html>`,
          ),
        );
      }

      return { calls, raw: await pending };
    };

    const noSlashFirst = await crawlWithFirstCompletion("no-slash");
    const slashFirst = await crawlWithFirstCompletion("slash");

    for (const result of [noSlashFirst, slashFirst]) {
      expect(result.calls).toEqual(expect.arrayContaining([...uniqueTargets]));
      expect(
        result.raw.pages
          .filter((page) => page.subjectUrl === landing)
          .map((page) => page.projection.fetchUrl),
      ).toEqual([landing, landingSlash]);
    }
    const stablePages = (pages: typeof noSlashFirst.raw.pages) =>
      pages.map((page) => ({
        ...page,
        projection: { ...page.projection, responseMs: null },
      }));
    expect(stablePages(noSlashFirst.raw.pages)).toEqual(
      stablePages(slashFirst.raw.pages),
    );
    expect([...noSlashFirst.calls].sort()).toEqual(
      [...slashFirst.calls].sort(),
    );
  });

  it.each([
    "https://example.com:8443/internal",
    "http://example.com:2375/internal",
  ])(
    "blocks redirect transport to a non-standard port: %s",
    async (redirectTarget) => {
      const home = `<html><head><title>Home</title></head><body>
        <a href="/go">Go</a></body></html>`;
      const { fetcher, calls } = makeFetcher({
        "https://example.com/robots.txt": () =>
          text("User-agent: *\nDisallow:\n"),
        "https://example.com/sitemap.xml": () =>
          new Response("not found", { status: 404 }),
        "https://example.com/": () => html(home),
        "https://example.com/go": () => redirect(redirectTarget),
        [redirectTarget]: () =>
          html("<html><title>Must not be fetched</title></html>"),
      });

      const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
        guard: GUARD,
        budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
      });

      expect(calls).toContain("https://example.com/go");
      expect(calls).not.toContain(redirectTarget);
      expect(raw.providerUsage.urlsBlocked).toBeGreaterThanOrEqual(1);
    },
  );

  it("crawls a normal site into pages, robots, and sitemap", async () => {
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(ROBOTS_TXT),
      "https://example.com/sitemap.xml": () => xml(SITEMAP_XML),
      "https://example.com/": () => html(HOME_HTML),
      "https://example.com/about": () => html(ABOUT_HTML),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: FAST_BUDGET,
    });

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
    expect(
      home?.internalOutlinks.map((link) => link.targetSubjectUrl),
    ).toContain("https://example.com/about");

    expect(raw.robots.fetched).toBe(true);
    expect(raw.robots.sitemaps).toContain("https://example.com/sitemap.xml");
    const robotUas = raw.robots.groups.map((group) =>
      group.userAgent.toLowerCase(),
    );
    for (const bot of [
      "oai-searchbot",
      "chatgpt-user",
      "perplexitybot",
      "claudebot",
    ]) {
      expect(robotUas).toContain(bot);
    }

    expect(raw.sitemap.fetched).toBe(true);
    expect(raw.sitemap.urlCount).toBe(2);
    expect(raw.sitemap.subjectUrls).toContain("https://example.com/about");
    expect(raw.providerUsage.pagesCollected).toBe(2);
    expect(raw.providerUsage.bytesFetched).toBe(
      byteLength(ROBOTS_TXT) +
        byteLength(SITEMAP_XML) +
        byteLength(HOME_HTML) +
        byteLength(ABOUT_HTML),
    );
  });

  it.each([
    {
      boundary: "robots",
      maxTotalBytes: byteLength(ROBOTS_TXT),
      expectedCalls: 1,
      expectedPages: 0,
    },
    {
      boundary: "sitemap",
      maxTotalBytes: byteLength(ROBOTS_TXT) + byteLength(SITEMAP_XML),
      expectedCalls: 2,
      expectedPages: 0,
    },
    {
      boundary: "page",
      maxTotalBytes:
        byteLength(ROBOTS_TXT) +
        byteLength(SITEMAP_XML) +
        byteLength(HOME_HTML),
      expectedCalls: 3,
      expectedPages: 1,
    },
  ])(
    "counts decoded $boundary bytes toward the run cap and keeps completed pages",
    async ({ maxTotalBytes, expectedCalls, expectedPages }) => {
      const { fetcher, calls } = makeFetcher({
        "https://example.com/robots.txt": () => text(ROBOTS_TXT),
        "https://example.com/sitemap.xml": () => xml(SITEMAP_XML),
        "https://example.com/": () => html(HOME_HTML),
        "https://example.com/about": () => html(ABOUT_HTML),
      });

      const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
        guard: GUARD,
        budget: {
          ...FAST_BUDGET,
          maxTotalBytes,
          perHostConcurrency: 1,
        },
      });

      expect(raw.availability).toBe("partial");
      expect(raw.stopReason).toBe("max_total_bytes");
      expect(raw.pages).toHaveLength(expectedPages);
      expect(calls).toHaveLength(expectedCalls);
      expect(raw.providerUsage.bytesFetched).toBe(maxTotalBytes);
      expect(raw.limitation).toContain("max_total_bytes");
    },
  );

  it("counts rejected bodies and returns partial before any page succeeds", async () => {
    const rejectedBody = "not found";
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        new Response(rejectedBody, { status: 404 }),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxTotalBytes: byteLength(rejectedBody),
        perHostConcurrency: 1,
      },
    });

    expect(raw.availability).toBe("partial");
    expect(raw.stopReason).toBe("max_total_bytes");
    expect(raw.providerUsage.urlsFetched).toBe(1);
    expect(raw.providerUsage.bytesFetched).toBe(byteLength(rejectedBody));
    expect(calls).toEqual(["https://example.com/robots.txt"]);
  });

  it("shares one strict total-byte reservation across concurrent responses", async () => {
    const concurrency = 3;
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody = `<urlset>${[
      "https://example.com/",
      "https://example.com/p1",
      "https://example.com/p2",
      "https://example.com/p3",
      "https://example.com/p4",
    ]
      .map((url) => `<url><loc>${url}</loc></url>`)
      .join("")}</urlset>`;
    const pageBody = `<html><head><title>Page</title></head><body>${"x".repeat(
      430,
    )}</body></html>`;
    const maxBodyBytes = Math.max(
      byteLength(robotsBody),
      byteLength(sitemapBody),
      byteLength(pageBody),
    );
    const preflightBytes = byteLength(robotsBody) + byteLength(sitemapBody);
    const maxTotalBytes = preflightBytes + byteLength(pageBody);
    const pageBytes = new TextEncoder().encode(pageBody);
    const calls: string[] = [];
    const firstWave: Array<(response: Response) => void> = [];
    let pageCalls = 0;
    let abortedPageRequests = 0;
    let cancelledBodyReaders = 0;
    let pullCount = 0;
    let releaseWinningBody: (() => void) | null = null;
    const concurrentPageResponse = (index: number): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            if (index === 0) {
              releaseWinningBody = () => {
                controller.enqueue(pageBytes);
                controller.close();
              };
            }
          },
          pull() {
            pullCount += 1;
            if (pullCount === concurrency) releaseWinningBody?.();
          },
          cancel() {
            cancelledBodyReaders += 1;
          },
        }),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    const fetcher: CrawlFetcher = {
      async fetch(url, init) {
        calls.push(url);
        if (url.endsWith("/robots.txt")) return text(robotsBody);
        if (url.endsWith("/sitemap.xml")) return xml(sitemapBody);
        pageCalls += 1;
        init.signal?.addEventListener(
          "abort",
          () => {
            abortedPageRequests += 1;
          },
          { once: true },
        );
        if (pageCalls > concurrency) return html(pageBody);
        return new Promise<Response>((resolve) => {
          firstWave.push(resolve);
          if (firstWave.length === concurrency) {
            for (const [index, release] of firstWave.entries()) {
              release(concurrentPageResponse(index));
            }
          }
        });
      },
    };

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxBodyBytes,
        maxTotalBytes,
        perHostConcurrency: concurrency,
      },
    });

    expect(raw.stopReason).toBe("max_total_bytes");
    expect(raw.availability).toBe("partial");
    expect(pageCalls).toBe(concurrency);
    expect(abortedPageRequests).toBe(concurrency - 1);
    expect(cancelledBodyReaders).toBe(concurrency - 1);
    expect(raw.pages).toHaveLength(1);
    expect(raw.providerUsage.bytesFetched).toBe(maxTotalBytes);
    expect(raw.providerUsage.bytesFetched).toBeLessThanOrEqual(maxTotalBytes);
    expect(calls).toHaveLength(2 + concurrency);
  });

  it("drops a page when its next decoded chunk cannot fit the remaining run budget", async () => {
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody =
      "<urlset><url><loc>https://example.com/</loc></url></urlset>";
    const pageBody = `<html><head><title>Too large for remainder</title></head><body>${"x".repeat(
      100,
    )}</body></html>`;
    const preflightBytes = byteLength(robotsBody) + byteLength(sitemapBody);
    const maxTotalBytes = preflightBytes + 10;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () => html(pageBody),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxTotalBytes,
        perHostConcurrency: 1,
      },
    });

    expect(raw.stopReason).toBe("max_total_bytes");
    expect(raw.availability).toBe("partial");
    expect(raw.pages).toEqual([]);
    expect(raw.providerUsage.bytesFetched).toBe(maxTotalBytes);
    expect(raw.providerUsage.bytesFetched).toBeLessThanOrEqual(maxTotalBytes);
    expect(calls).toEqual([
      "https://example.com/robots.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/",
    ]);
  });

  it("drops a multi-chunk page when more data arrives after the cap is exactly reserved", async () => {
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody =
      "<urlset><url><loc>https://example.com/</loc></url></urlset>";
    const firstChunk = new TextEncoder().encode("<html><body>first");
    const secondChunk = new TextEncoder().encode("-second</body></html>");
    const preflightBytes = byteLength(robotsBody) + byteLength(sitemapBody);
    const maxTotalBytes = preflightBytes + firstChunk.byteLength;
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(firstChunk);
              controller.enqueue(secondChunk);
              controller.close();
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxTotalBytes,
        perHostConcurrency: 1,
      },
    });

    expect(raw.stopReason).toBe("max_total_bytes");
    expect(raw.pages).toEqual([]);
    expect(raw.providerUsage.bytesFetched).toBe(maxTotalBytes);
  });

  it("preserves a small page when the response exposes only text()", async () => {
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody =
      "<urlset><url><loc>https://example.com/</loc></url></urlset>";
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () => textOnlyHtml(HOME_HTML),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(
      raw.pages.find((page) => page.subjectUrl === "https://example.com/")
        ?.projection.title,
    ).toBe("Example Home");
    expect(raw.stopReason).toBeNull();
  });

  it("applies the strict remaining-byte reservation to text()-only responses", async () => {
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody =
      "<urlset><url><loc>https://example.com/</loc></url></urlset>";
    const preflightBytes = byteLength(robotsBody) + byteLength(sitemapBody);
    const maxTotalBytes = preflightBytes + 10;
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () => textOnlyHtml(HOME_HTML),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxTotalBytes,
        perHostConcurrency: 1,
      },
    });

    expect(raw.stopReason).toBe("max_total_bytes");
    expect(raw.pages).toEqual([]);
    expect(raw.providerUsage.bytesFetched).toBe(maxTotalBytes);
  });

  it("caps persisted HTTP header projections independently of response size", async () => {
    const longDirective = "d".repeat(
      CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars + 100,
    );
    const xRobotsTag = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxRobotsDirectives + 5 },
      (_unused, index) => `${index}-${longDirective}`,
    ).join(",");
    const contentType = `text/html; profile=${"c".repeat(
      CRAWL_PROJECTION_LIMITS.maxContentTypeChars + 100,
    )}`;
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("not found", { status: 404 }),
      "https://example.com/": () =>
        new Response(HOME_HTML, {
          status: 200,
          headers: {
            "content-type": contentType,
            "x-robots-tag": xRobotsTag,
          },
        }),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: FAST_BUDGET,
    });
    const projection = raw.pages[0]?.projection;

    expect(projection?.contentType).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxContentTypeChars,
    );
    expect(projection?.robotsDirectives).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxRobotsDirectives,
    );
    expect(
      projection?.robotsDirectives.every(
        (value) =>
          value.length <= CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars,
      ),
    ).toBe(true);
  });

  it("caps persisted robots groups, rules, agents, and sitemap declarations", async () => {
    const longRule = `/${"r".repeat(
      CRAWL_PROJECTION_LIMITS.maxRobotsRuleChars + 100,
    )}`;
    const wildcardRules = ["User-agent: *"];
    for (
      let index = 0;
      index < CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup + 5;
      index += 1
    ) {
      wildcardRules.push(`Allow: ${longRule}-${index}`);
      wildcardRules.push(`Disallow: ${longRule}-private-${index}`);
    }
    const extraGroups = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxRobotsGroups + 5 },
      (_unused, index) =>
        `User-agent: agent-${index}-${"u".repeat(
          CRAWL_PROJECTION_LIMITS.maxUserAgentChars + 50,
        )}\nAllow: /group-${index}`,
    );
    const sitemapLines = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxSitemaps + 5 },
      (_unused, index) => `Sitemap: https://example.com/sitemap-${index}.xml`,
    );
    const robotsBody = [...wildcardRules, ...extraGroups, ...sitemapLines].join(
      "\n",
    );
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxTotalBytes: byteLength(robotsBody),
        perHostConcurrency: 1,
      },
    });

    expect(raw.robots.groups).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxRobotsGroups,
    );
    expect(raw.robots.sitemaps).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxSitemaps,
    );
    expect(
      raw.robots.groups.every(
        (group) =>
          group.userAgent.length <= CRAWL_PROJECTION_LIMITS.maxUserAgentChars &&
          group.allow.length <=
            CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup &&
          group.disallow.length <=
            CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup &&
          [...group.allow, ...group.disallow].every(
            (rule) => rule.length <= CRAWL_PROJECTION_LIMITS.maxRobotsRuleChars,
          ),
      ),
    ).toBe(true);
    for (const bot of [
      "oai-searchbot",
      "chatgpt-user",
      "perplexitybot",
      "claudebot",
    ]) {
      expect(
        raw.robots.groups.some(
          (group) => group.userAgent.toLowerCase() === bot,
        ),
      ).toBe(true);
    }
  });

  it("caps persisted sitemap membership at the crawl URL budget", async () => {
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody = `<urlset>${Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxSitemapUrls + 5 },
      (_unused, index) =>
        `<url><loc>https://example.com/page-${index}</loc></url>`,
    ).join("")}</urlset>`;
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        ...FAST_BUDGET,
        maxTotalBytes: byteLength(robotsBody) + byteLength(sitemapBody),
        perHostConcurrency: 1,
      },
    });

    expect(raw.sitemap.subjectUrls).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxSitemapUrls,
    );
    expect(raw.sitemap.urlCount).toBe(raw.sitemap.subjectUrls.length);
    expect(
      raw.sitemap.subjectUrls.every(
        (url) => url.length <= CRAWL_PROJECTION_LIMITS.maxUrlChars,
      ),
    ).toBe(true);
    expect(raw.stopReason).toBe("max_total_bytes");
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
      budget: {
        ...CRAWL_BUDGET,
        maxUrls: 1,
        perHostConcurrency: 1,
        minHostDelayMs: 0,
      },
    });

    expect(raw.availability).toBe("partial");
    expect(raw.stopReason).toBe("max_urls");
    expect(raw.pages).toHaveLength(1);
    expect(raw.pages[0]?.subjectUrl).toBe("https://example.com/");
  });

  it("counts robots, sitemap documents, and page fetches in the trusted request cap", async () => {
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () => text(ROBOTS_TXT),
      "https://example.com/sitemap.xml": () => xml(SITEMAP_XML),
      "https://example.com/": () => html(HOME_HTML),
    });
    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
      maxRequests: 2,
    });

    expect(calls).toEqual([
      "https://example.com/robots.txt",
      "https://example.com/sitemap.xml",
    ]);
    expect(raw.stopReason).toBe("max_requests");
    expect(raw.availability).toBe("partial");
  });

  it("keeps request identity while using the final redirect URL as the relative-link base", async () => {
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody = `<urlset>
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/dir/page</loc></url>
    </urlset>`;
    const redirectedPage = `<html><head><title>Redirect target</title></head>
      <body><a href="child">Child</a></body></html>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () => redirect("/dir/page"),
      "https://example.com/dir/page": () => html(redirectedPage),
      "https://example.com/dir/child": () =>
        html("<html><head><title>Child</title></head></html>"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });
    const rootPage = raw.pages.find(
      (page) => page.projection.fetchUrl === "https://example.com/",
    );
    const targetPage = raw.pages.find(
      (page) => page.projection.fetchUrl === "https://example.com/dir/page",
    );

    expect(rootPage).toMatchObject({
      subjectUrl: "https://example.com/",
      projection: {
        fetchUrl: "https://example.com/",
        status: 301,
        finalStatus: 200,
        redirectChain: ["https://example.com/dir/page"],
        sitemapMember: true,
      },
    });
    expect(rootPage?.projection.internalOutlinks).toContainEqual(
      expect.objectContaining({
        targetSubjectUrl: "https://example.com/dir/child",
      }),
    );
    expect(targetPage?.projection).toMatchObject({
      fetchUrl: "https://example.com/dir/page",
      status: 200,
      finalStatus: 200,
      redirectChain: [],
      sitemapMember: true,
    });
    expect(targetPage?.projection.internalOutlinks).toContainEqual(
      expect.objectContaining({
        targetSubjectUrl: "https://example.com/dir/child",
      }),
    );
    expect(
      raw.pages.some(
        (page) => page.subjectUrl === "https://example.com/dir/child",
      ),
    ).toBe(true);
    expect(
      calls.filter((url) => url === "https://example.com/dir/page"),
    ).toHaveLength(2);
    expect(calls).not.toContain("https://example.com/child");
  });

  it("keeps concurrent direct and alias journeys as deterministic separate records", async () => {
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody = `<urlset>
      <url><loc>https://example.com/alias-b</loc></url>
      <url><loc>https://example.com/alias-a</loc></url>
      <url><loc>https://example.com/dir/page</loc></url>
    </urlset>`;
    const finalBody = `<html><head><title>Final</title></head>
      <body><a href="child">Child</a></body></html>`;
    let aliasAResolve: ((response: Response) => void) | null = null;
    let aliasBResolve: ((response: Response) => void) | null = null;
    let directResolve: ((response: Response) => void) | null = null;
    let finalCalls = 0;
    let released = false;
    const releaseRace = (): void => {
      if (released || !aliasAResolve || !aliasBResolve || !directResolve)
        return;
      released = true;
      directResolve(html(finalBody));
      aliasBResolve(
        new Response(null, {
          status: 302,
          headers: { location: "/dir/page" },
        }),
      );
      aliasAResolve(redirect("/dir/page"));
    };
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        if (url === "https://example.com/robots.txt") return text(robotsBody);
        if (url === "https://example.com/sitemap.xml") return xml(sitemapBody);
        if (url === "https://example.com/") {
          return html("<html><head><title>Root</title></head></html>");
        }
        if (url === "https://example.com/alias-a") {
          return new Promise<Response>((resolve) => {
            aliasAResolve = resolve;
            releaseRace();
          });
        }
        if (url === "https://example.com/alias-b") {
          return new Promise<Response>((resolve) => {
            aliasBResolve = resolve;
            releaseRace();
          });
        }
        if (url === "https://example.com/dir/page") {
          finalCalls += 1;
          if (finalCalls > 1) return html(finalBody);
          return new Promise<Response>((resolve) => {
            directResolve = resolve;
            releaseRace();
          });
        }
        if (url === "https://example.com/dir/child") {
          return html("<html><head><title>Child</title></head></html>");
        }
        return new Response("not found", { status: 404 });
      },
    };

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 3 },
    });
    const finalPages = raw.pages.filter(
      (page) => page.subjectUrl === "https://example.com/dir/page",
    );
    const aliasAPage = raw.pages.find(
      (page) => page.projection.fetchUrl === "https://example.com/alias-a",
    );
    const aliasBPage = raw.pages.find(
      (page) => page.projection.fetchUrl === "https://example.com/alias-b",
    );
    const child = raw.pages.find(
      (page) => page.subjectUrl === "https://example.com/dir/child",
    );

    expect(finalCalls).toBe(3);
    expect(finalPages).toHaveLength(1);
    expect(finalPages[0]?.projection.status).toBe(200);
    expect(finalPages[0]?.projection.finalStatus).toBe(200);
    expect(finalPages[0]?.projection.fetchUrl).toBe(
      "https://example.com/dir/page",
    );
    expect(aliasAPage).toMatchObject({
      subjectUrl: "https://example.com/alias-a",
      projection: {
        fetchUrl: "https://example.com/alias-a",
        status: 301,
        finalStatus: 200,
        redirectChain: ["https://example.com/dir/page"],
      },
    });
    expect(aliasBPage).toMatchObject({
      subjectUrl: "https://example.com/alias-b",
      projection: {
        fetchUrl: "https://example.com/alias-b",
        status: 302,
        finalStatus: 200,
        redirectChain: ["https://example.com/dir/page"],
      },
    });
    expect(child?.depth).toBe(2);
    expect(new Set(raw.pages.map((page) => page.subjectUrl)).size).toBe(
      raw.pages.length,
    );
    expect(raw.providerUsage.pagesCollected).toBe(raw.pages.length);
  });

  it("applies robots rules before transport on every page redirect hop", async () => {
    const home = `<html><head><title>Home</title></head><body>
      <a href="/public">Public</a></body></html>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow: /private"),
      "https://example.com/sitemap.xml": () =>
        new Response("not found", { status: 404 }),
      "https://example.com/": () => html(home),
      "https://example.com/public": () => redirect("/private/secret"),
      "https://example.com/private/secret": () =>
        html("<html><title>Must not be fetched</title></html>"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls).toContain("https://example.com/public");
    expect(calls).not.toContain("https://example.com/private/secret");
    expect(raw.providerUsage.urlsDisallowed).toBe(1);
    expect(raw.pages.some((page) => page.subjectUrl.includes("/private"))).toBe(
      false,
    );
  });

  it("fails closed before guard or transport on a cross-origin redirect", async () => {
    const home = `<html><head><title>Home</title></head><body>
      <a href="/offsite">Offsite</a></body></html>`;
    const guardedUrls: string[] = [];
    const guard = async (url: string) => {
      guardedUrls.push(url);
      return GUARD(url);
    };
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("not found", { status: 404 }),
      "https://example.com/": () => html(home),
      "https://example.com/offsite": () =>
        redirect("https://outside.example/path"),
      "https://outside.example/path": () =>
        html("<html><title>Outside</title></html>"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls).not.toContain("https://outside.example/path");
    expect(guardedUrls).not.toContain("https://outside.example/path");
    expect(raw.providerUsage.urlsBlocked).toBeGreaterThanOrEqual(1);
    expect(
      raw.pages.some((page) => page.subjectUrl.includes("outside.example")),
    ).toBe(false);
  });

  it("rejects a guard result that normalizes a same-origin URL across origin", async () => {
    const { fetcher, calls } = makeFetcher({});
    const lyingGuard = async () => ({
      safe: true,
      normalizedUrl: "https://outside.example/path",
      pinnedIp: "93.184.216.34",
      reason: null,
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: lyingGuard,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(calls).toEqual([]);
    expect(raw.providerUsage.urlsBlocked).toBeGreaterThan(0);
    expect(raw.pages).toEqual([]);
  });

  it("never evaluates or exposes an unsafe guard's dynamic reason", async () => {
    const secret = "customer-content-secret-guard";
    let reasonReads = 0;
    const unsafeResult = {
      safe: false as const,
      normalizedUrl: null,
      pinnedIp: null,
      get reason(): null {
        reasonReads += 1;
        throw new Error(secret);
      },
    };
    const { fetcher } = makeFetcher({});

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: async () => unsafeResult,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });
    const serialized = JSON.stringify(raw);

    expect(reasonReads).toBe(0);
    expect(serialized).not.toContain(secret);
    expect(raw.limitation).not.toContain(secret);
    expect(raw.providerUsage.urlsBlocked).toBeGreaterThan(0);
  });

  it("never evaluates or exposes a fetch error's dynamic message", async () => {
    const secret = "customer-content-secret-fetch";
    let messageReads = 0;
    const hostileError = new Error("placeholder");
    Object.defineProperty(hostileError, "message", {
      get() {
        messageReads += 1;
        throw new Error(secret);
      },
    });
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        if (url === "https://example.com/robots.txt") throw hostileError;
        return new Response("not found", { status: 404 });
      },
    };

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });
    const serialized = JSON.stringify(raw);

    expect(messageReads).toBe(0);
    expect(serialized).not.toContain(secret);
    expect(raw.limitation).not.toContain(secret);
  });

  it("observes an external abort that races completion of the URL guard", async () => {
    const controller = new AbortController();
    let firstGuard = true;
    const guard = async (url: string) => {
      if (firstGuard) {
        firstGuard = false;
        await new Promise<void>((resolve) => {
          controller.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
      }
      return GUARD(url);
    };
    const { fetcher, calls } = makeFetcher({});
    const abortTimer = setTimeout(
      () => controller.abort(new Error("guard race abort")),
      10,
    );

    const outcome = await settleWithin(
      crawlSite(
        PARAMS,
        CONFIG,
        { ...CTX, signal: controller.signal },
        fetcher,
        { guard, budget: FAST_BUDGET },
      ),
      500,
    );
    clearTimeout(abortTimer);

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.value.stopReason).toBe("aborted");
    expect(outcome.value.availability).toBe("partial");
    expect(calls).toEqual([]);
  });

  it("converges on external abort while the URL guard remains pending", async () => {
    const controller = new AbortController();
    const { fetcher, calls } = makeFetcher({});
    const abortTimer = setTimeout(() => controller.abort(), 10);

    const outcome = await settleWithin(
      crawlSite(
        PARAMS,
        CONFIG,
        { ...CTX, signal: controller.signal },
        fetcher,
        {
          guard: () => new Promise<never>(() => undefined),
          budget: FAST_BUDGET,
        },
      ),
      500,
    );
    clearTimeout(abortTimer);

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.value.stopReason).toBe("aborted");
    expect(outcome.value.availability).toBe("partial");
    expect(calls).toEqual([]);
  });

  it("blocks a redirect to a private address and never fetches it", async () => {
    const homeWithRedirect = `<html><head><title>Home</title></head><body>
      <h1>Home</h1><a href="/go">internal redirect</a></body></html>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("nope", { status: 404 }),
      "https://example.com/": () => html(homeWithRedirect),
      "https://example.com/go": () =>
        redirect("http://169.254.169.254/latest/meta-data"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: FAST_BUDGET,
    });

    expect(calls.some((url) => url.includes("169.254.169.254"))).toBe(false);
    expect(
      raw.pages.some((page) => page.subjectUrl.includes("169.254.169.254")),
    ).toBe(false);
    expect(raw.providerUsage.urlsBlocked).toBeGreaterThanOrEqual(1);
    expect(raw.pages.map((page) => page.subjectUrl)).toContain(
      "https://example.com/",
    );
  });

  it("fails closed when a guard marks a URL safe without a normalized URL or pin", async () => {
    const { fetcher, calls } = makeFetcher({});
    const incompleteGuard = async () => ({
      safe: true,
      normalizedUrl: null,
      pinnedIp: null,
      reason: null,
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: incompleteGuard,
      budget: FAST_BUDGET,
    });

    expect(calls).toEqual([]);
    expect(raw.availability).toBe("unavailable");
    expect(raw.providerUsage.urlsBlocked).toBeGreaterThan(0);
  });

  it("blocks a redirect that downgrades outside HTTP(S)", async () => {
    const homeWithRedirect = `<html><head><title>Home</title></head><body>
      <h1>Home</h1><a href="/go">invalid redirect</a></body></html>`;
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("nope", { status: 404 }),
      "https://example.com/": () => html(homeWithRedirect),
      "https://example.com/go": () => redirect("file:///etc/passwd"),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: FAST_BUDGET,
    });

    expect(calls.every((url) => url.startsWith("https://"))).toBe(true);
    expect(raw.providerUsage.urlsBlocked).toBeGreaterThanOrEqual(1);
  });

  it("applies the body cap to decompressed response bytes", async () => {
    const decompressed = new TextEncoder().encode(
      `<h1>${"x".repeat(128)}</h1>`,
    );
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("nope", { status: 404 }),
      "https://example.com/": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(decompressed.subarray(0, 32));
              controller.enqueue(decompressed.subarray(32));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/html",
              "content-encoding": "gzip",
              // The transport exposes a decompressed stream while this header
              // can still describe a much smaller compressed representation.
              "content-length": "16",
            },
          },
        ),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, maxBodyBytes: 64 },
    });

    expect(
      raw.pages.some((page) => page.subjectUrl === "https://example.com/"),
    ).toBe(false);
    expect(raw.providerUsage.urlsSkipped).toBeGreaterThanOrEqual(1);
  });

  it("skips a non-HTML content type without recording a page", async () => {
    const homeWithPdf = `<html><head><title>Home</title></head><body>
      <h1>Home</h1><a href="/doc.pdf">the doc</a></body></html>`;
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () =>
        text("User-agent: *\nDisallow:\n"),
      "https://example.com/sitemap.xml": () =>
        new Response("nope", { status: 404 }),
      "https://example.com/": () => html(homeWithPdf),
      "https://example.com/doc.pdf": () =>
        new Response("%PDF-1.4 binary", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: FAST_BUDGET,
    });

    expect(raw.pages.some((page) => page.subjectUrl.endsWith("doc.pdf"))).toBe(
      false,
    );
    expect(raw.pages.map((page) => page.subjectUrl)).toContain(
      "https://example.com/",
    );
    expect(raw.providerUsage.urlsSkipped).toBeGreaterThanOrEqual(1);
  });

  it("handles a rejecting text()-only page as a bounded crawl error", async () => {
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody =
      "<urlset><url><loc>https://example.com/</loc></url></urlset>";
    const response = new Response(null, {
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(response, "text", {
      value: () => Promise.reject(new Error("text decode failed")),
    });
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () => response,
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    expect(raw.pages).toEqual([]);
    expect(raw.providerUsage.urlsErrored).toBe(1);
  });

  it("applies the per-response cap to a text()-only body", async () => {
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody =
      "<urlset><url><loc>https://example.com/</loc></url></urlset>";
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () => textOnlyHtml(HOME_HTML),
    });

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: {
        // Large enough for the 64-byte robots.txt and 59-byte sitemap, small
        // enough that HOME_HTML overruns it. A cap that also starves robots.txt
        // would exercise the fail-closed path instead of the page body cap this
        // test is about.
        ...FAST_BUDGET,
        maxBodyBytes: 128,
        perHostConcurrency: 1,
      },
    });

    expect(raw.pages).toEqual([]);
    expect(raw.providerUsage.urlsSkipped).toBeGreaterThanOrEqual(1);
  });

  it("does not await a pending body cancel after a reader error", async () => {
    let bodyCancelAttempts = 0;
    const reader = {
      read: () => Promise.reject(new Error("reader failed")),
      cancel: () => Promise.resolve(),
      releaseLock: () => undefined,
    };
    const response = {
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: {
        getReader: () => reader,
        cancel: () => {
          bodyCancelAttempts += 1;
          return new Promise<void>(() => undefined);
        },
      },
      text: () => Promise.resolve(""),
    } as unknown as Response;
    const robotsBody =
      "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml";
    const sitemapBody =
      "<urlset><url><loc>https://example.com/</loc></url></urlset>";
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => text(robotsBody),
      "https://example.com/sitemap.xml": () => xml(sitemapBody),
      "https://example.com/": () => response,
    });

    const outcome = await settleWithin(
      crawlSite(PARAMS, CONFIG, CTX, fetcher, {
        guard: GUARD,
        budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
      }),
      100,
    );

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.value.providerUsage.urlsErrored).toBe(1);
    expect(bodyCancelAttempts).toBe(1);
  });

  it("converges at a 50ms wall-clock deadline when a body read and cancel never settle", async () => {
    let cancelAttempts = 0;
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () =>
        stalledBodyResponse(() => {
          cancelAttempts += 1;
          return new Promise<void>(() => undefined);
        }),
    });

    const outcome = await settleWithin(
      crawlSite(PARAMS, CONFIG, CTX, fetcher, {
        guard: GUARD,
        budget: {
          ...FAST_BUDGET,
          maxWallClockMs: 50,
          perHostConcurrency: 1,
        },
      }),
      500,
    );

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.value.stopReason).toBe("max_duration");
    expect(outcome.value.availability).toBe("partial");
    expect(cancelAttempts).toBe(1);
  });

  it("blames the clock, not the site, when the deadline timer beats the clock reading", async () => {
    /**
     * The deterministic form of the flake above.
     *
     * That test asks a real 50ms timer to race a real `Date.now()`, and on this
     * machine the clock always wins, so it passed locally every time while
     * failing roughly one CI run in ten with
     * `expected 'robots_unreachable' to be 'max_duration'`.
     *
     * The losing interleaving is not exotic: `Date.now()` has millisecond
     * resolution and is not monotonic, so the timer armed FOR the deadline can
     * fire while a fresh reading still sits a fraction below it. Here the clock
     * is pinned one millisecond short of the deadline forever, which is that
     * interleaving held open rather than hoped for. The request timer still
     * fires on real time.
     *
     * What must not happen is the run reporting `robots_unreachable` — a claim
     * about the visitor's site, and the one that sends them to check a file
     * that was never the problem — because OUR clock was coarse.
     */
    const FROZEN = 1_000_000;
    let readings = 0;
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () =>
        stalledBodyResponse(() => new Promise<void>(() => undefined)),
    });

    const outcome = await settleWithin(
      crawlSite(PARAMS, CONFIG, CTX, fetcher, {
        guard: GUARD,
        budget: {
          ...FAST_BUDGET,
          maxWallClockMs: 50,
          perHostConcurrency: 1,
        },
        // First reading is the run's start stamp; every later one reports 49ms
        // elapsed against a 50ms budget, so the deadline is never observed to
        // have passed no matter how long the run actually takes.
        now: () => (readings++ === 0 ? FROZEN : FROZEN + 49),
      }),
      2_000,
    );

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.value.stopReason).toBe("max_duration");
    expect(outcome.value.stopReason).not.toBe("robots_unreachable");
    expect(outcome.value.availability).toBe("partial");
  });

  it("converges on external abort while text() remains permanently pending", async () => {
    const controller = new AbortController();
    const response = new Response(null, {
      headers: { "content-type": "text/plain" },
    });
    Object.defineProperty(response, "text", {
      value: () => new Promise<string>(() => undefined),
    });
    const { fetcher, calls } = makeFetcher({
      "https://example.com/robots.txt": () => response,
    });
    const abortTimer = setTimeout(
      () => controller.abort(new Error("fixture abort")),
      10,
    );

    const outcome = await settleWithin(
      crawlSite(
        PARAMS,
        CONFIG,
        { ...CTX, signal: controller.signal },
        fetcher,
        { guard: GUARD, budget: FAST_BUDGET },
      ),
      500,
    );
    clearTimeout(abortTimer);

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.value.stopReason).toBe("aborted");
    expect(outcome.value.availability).toBe("partial");
    expect(calls).toEqual(["https://example.com/robots.txt"]);
  });

  it("never stringifies or exposes a hostile external abort reason", async () => {
    const secret = "customer-content-secret-abort";
    let toStringCalls = 0;
    const hostileReason = {
      toString() {
        toStringCalls += 1;
        throw new Error(secret);
      },
    };
    const controller = new AbortController();
    const response = new Response(null, {
      headers: { "content-type": "text/plain" },
    });
    Object.defineProperty(response, "text", {
      value: () => new Promise<string>(() => undefined),
    });
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => response,
    });
    const abortTimer = setTimeout(() => controller.abort(hostileReason), 10);

    const outcome = await settleWithin(
      crawlSite(
        PARAMS,
        CONFIG,
        { ...CTX, signal: controller.signal },
        fetcher,
        { guard: GUARD, budget: FAST_BUDGET },
      ),
      500,
    );
    clearTimeout(abortTimer);

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    const serialized = JSON.stringify(outcome.value);
    expect(toStringCalls).toBe(0);
    expect(serialized).not.toContain(secret);
    expect(outcome.value.stopReason).toBe("aborted");
    expect(outcome.value.limitation).not.toContain(secret);
  });

  it("consumes late read rejection when abort races hostile cancel and release", async () => {
    const controller = new AbortController();
    let cancelAttempts = 0;
    let releaseAttempts = 0;
    const lateRead = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("late hostile read rejection")), 40);
    });
    const reader = {
      read: () => lateRead,
      cancel: () => {
        cancelAttempts += 1;
        return Promise.reject(new Error("hostile cancel rejection"));
      },
      releaseLock: () => {
        releaseAttempts += 1;
        throw new Error("hostile release failure");
      },
    };
    const response = {
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      body: {
        getReader: () => reader,
        cancel: () => new Promise<void>(() => undefined),
      },
      text: () => new Promise<string>(() => undefined),
    } as unknown as Response;
    const { fetcher } = makeFetcher({
      "https://example.com/robots.txt": () => response,
    });
    const abortTimer = setTimeout(
      () => controller.abort(new Error("reader race abort")),
      10,
    );

    const outcome = await settleWithin(
      crawlSite(
        PARAMS,
        CONFIG,
        { ...CTX, signal: controller.signal },
        fetcher,
        { guard: GUARD, budget: FAST_BUDGET },
      ),
      500,
    );
    clearTimeout(abortTimer);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.value.stopReason).toBe("aborted");
    expect(outcome.value.availability).toBe("partial");
    expect(cancelAttempts).toBe(1);
    expect(releaseAttempts).toBe(1);
  });
});
