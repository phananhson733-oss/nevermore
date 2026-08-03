/**
 * A public crawler that anonymous strangers can aim at any site has two duties
 * beyond "does the parser work": obey what the site asked for, and never report
 * a site as audited when it was not.
 *
 * Each test here pins one behaviour that was wrong in the shipped crawler.
 */
import { describe, expect, it } from "vitest";
import type { CollectionContext } from "../adapter.ts";
import { createCanonicalUrlGuard } from "../url-safety/index.ts";
import { crawlSite } from "./engine.ts";
import { parseRobots, robotsCrawlDelaySeconds } from "./robots.ts";
import { CRAWL_BUDGET } from "./types.ts";
import type { CrawlFetcher, CrawlParams } from "./types.ts";

const PARAMS: CrawlParams = {
  origin: "https://example.com",
  host: "example.com",
  seedUrl: "https://example.com/",
};
const CONFIG = { userAgent: "GenGrowth-Public-Tools-Crawler/1.0" } as const;
const CTX: CollectionContext = {
  workspaceId: "ws",
  projectId: "pr",
  siteId: "site",
  runId: "run",
};

const GUARD = createCanonicalUrlGuard({
  lookup: async (hostname: string) => {
    if (hostname === "example.com" || hostname === "www.example.com") {
      return ["93.184.216.34"];
    }
    throw new Error(`unexpected DNS lookup: ${hostname}`);
  },
});

const FAST_BUDGET = { ...CRAWL_BUDGET, minHostDelayMs: 0 } as const;

const HOME_HTML =
  '<!doctype html><html lang="en"><head><title>Home</title></head><body><a href="/a">A</a></body></html>';

function res(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

type Route = () => Response;

function makeFetcher(routes: Record<string, Route>): {
  readonly fetcher: CrawlFetcher;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fetcher: CrawlFetcher = {
    async fetch(url: string) {
      calls.push(url);
      const route = routes[url];
      if (!route) {
        return new Response("not found", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      }
      return route();
    },
  };
  return { fetcher, calls };
}

function crawl(routes: Record<string, Route>, calls?: { current: string[] }) {
  const made = makeFetcher(routes);
  if (calls) calls.current = made.calls;
  return crawlSite(PARAMS, CONFIG, CTX, made.fetcher, {
    guard: GUARD,
    budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
  });
}

describe("robots.txt is unreadable", () => {
  /**
   * RFC 9309 §2.3.1.4: a crawler that gets a 5xx for robots.txt "MUST assume
   * complete disallow". The engine used to substitute an empty ruleset on any
   * non-2xx, which meant a site returning 503 for /robots.txt — a common state
   * for an overloaded site, which is exactly when you should back off — had
   * every one of its Disallow rules silently dropped and got crawled in full.
   */
  it("fetches no page when robots.txt returns 5xx", async () => {
    const calls = { current: [] as string[] };
    const raw = await crawl(
      {
        "https://example.com/robots.txt": () =>
          res("server exploded", "text/plain", 503),
        "https://example.com/": () => res(HOME_HTML, "text/html"),
      },
      calls,
    );

    expect(raw.pages).toEqual([]);
    expect(raw.stopReason).toBe("robots_unreachable");
    expect(raw.availability).toBe("unavailable");
    expect(calls.current).not.toContain("https://example.com/");
    expect(raw.limitation).toContain("could not be read");
  });

  /**
   * The opposite half of the same rule. §2.3.1.3: an "unavailable" robots.txt —
   * 404, 410 — means no restrictions. Failing closed on a 404 would make the
   * tool useless on the majority of small sites, which have no robots.txt.
   */
  it("crawls normally when robots.txt is a 404", async () => {
    const raw = await crawl({
      "https://example.com/robots.txt": () => res("nope", "text/plain", 404),
      "https://example.com/": () => res(HOME_HTML, "text/html"),
    });

    expect(raw.stopReason).not.toBe("robots_unreachable");
    expect(raw.pages.length).toBeGreaterThan(0);
  });
});

describe("robots.txt forbids the crawler", () => {
  /**
   * The reported defect: `reachedNothing` required `usage.urlsFetched === 0`,
   * but robots.txt and sitemap.xml increment that counter before any page is
   * considered. A site answering `Disallow: /` therefore came back
   * `availability: "available"` with `stopReason: null`, and both public tools
   * rendered it as a completed audit with no findings — a clean bill of health
   * for a site nobody looked at.
   */
  it("does not report a site-wide Disallow as a clean audit", async () => {
    const raw = await crawl({
      "https://example.com/robots.txt": () =>
        res("User-agent: *\nDisallow: /\n", "text/plain"),
      "https://example.com/": () => res(HOME_HTML, "text/html"),
    });

    expect(raw.pages).toEqual([]);
    expect(raw.availability).not.toBe("available");
    expect(raw.availability).toBe("unavailable");
    expect(raw.stopReason).toBe("robots_disallowed");
    // The reader must be able to tell "the site said no" from "the site broke".
    expect(raw.limitation).toContain("forbids");
    expect(raw.limitation).toContain("not a finding");
  });
});

describe("Crawl-delay", () => {
  it("parses a group-scoped Crawl-delay", () => {
    const { groups } = parseRobots(
      "User-agent: *\nCrawl-delay: 10\nDisallow:\n",
      "https://example.com",
      true,
    );
    expect(robotsCrawlDelaySeconds(groups, CONFIG.userAgent)).toBe(10);
  });

  it("prefers a group naming our product token over the wildcard", () => {
    const { groups } = parseRobots(
      [
        "User-agent: *",
        "Crawl-delay: 30",
        "",
        "User-agent: GenGrowth-Public-Tools-Crawler",
        "Crawl-delay: 5",
      ].join("\n"),
      "https://example.com",
      true,
    );
    expect(robotsCrawlDelaySeconds(groups, CONFIG.userAgent)).toBe(5);
  });

  it("reports 0 when the site states none", () => {
    const { groups } = parseRobots(
      "User-agent: *\nDisallow: /admin\n",
      "https://example.com",
      true,
    );
    expect(robotsCrawlDelaySeconds(groups, CONFIG.userAgent)).toBe(0);
  });

  /**
   * A hostile or typo'd file must not be able to stall a synchronous run that
   * holds a serverless invocation open. Honour the request, but not past a
   * point where the run would be spent waiting.
   */
  it("caps an absurd delay rather than honouring it", () => {
    const { groups } = parseRobots(
      "User-agent: *\nCrawl-delay: 86400\n",
      "https://example.com",
      true,
    );
    expect(robotsCrawlDelaySeconds(groups, CONFIG.userAgent)).toBe(30);
  });

  it("ignores a non-numeric or negative delay", () => {
    for (const value of ["soon", "-5", "0", ""]) {
      const { groups } = parseRobots(
        `User-agent: *\nCrawl-delay: ${value}\n`,
        "https://example.com",
        true,
      );
      expect(robotsCrawlDelaySeconds(groups, CONFIG.userAgent)).toBe(0);
    }
  });

  /**
   * Parsing it is only half the fix — the pacer has to use it. Before this
   * change `acquireHostSlot` advanced by a hardcoded `budget.minHostDelayMs`,
   * so a site asking for one request every 10 seconds was crawled at 4/s
   * regardless.
   */
  it("paces the crawl by the site's stated delay, not just our floor", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const made = makeFetcher({
      "https://example.com/robots.txt": () =>
        res("User-agent: *\nCrawl-delay: 2\nDisallow:\n", "text/plain"),
      "https://example.com/": () => res(HOME_HTML, "text/html"),
      "https://example.com/a": () => res(HOME_HTML, "text/html"),
    });

    await crawlSite(PARAMS, CONFIG, CTX, made.fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, minHostDelayMs: 250, perHostConcurrency: 1 },
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    // robots.txt itself is paced at our own floor: a Crawl-delay cannot be
    // honoured before the file stating it has been read. Every launch after
    // that waits the site's figure.
    expect(sleeps.some((ms) => ms === 2_000)).toBe(true);
    const afterRobots = sleeps.filter((ms) => ms > 0 && ms !== 250);
    expect(afterRobots.length).toBeGreaterThan(0);
    expect(afterRobots.every((ms) => ms >= 2_000)).toBe(true);
  });

  it("never speeds up below our own floor on the site's say-so", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const made = makeFetcher({
      "https://example.com/robots.txt": () =>
        res("User-agent: *\nCrawl-delay: 0.1\nDisallow:\n", "text/plain"),
      "https://example.com/": () => res(HOME_HTML, "text/html"),
      "https://example.com/a": () => res(HOME_HTML, "text/html"),
    });

    await crawlSite(PARAMS, CONFIG, CTX, made.fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, minHostDelayMs: 250, perHostConcurrency: 1 },
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    expect(sleeps.every((ms) => ms === 0 || ms >= 250)).toBe(true);
  });
});

describe("a run that ends while robots.txt is in flight", () => {
  /**
   * `guardedFetch` answers `aborted` for two different events: the whole run's
   * wall clock or abort signal fired, and this one request timed out. Only the
   * second is "we could not read robots.txt".
   *
   * Conflating them relabelled an ordinary timeout as `robots_unreachable`,
   * hiding why the crawl actually stopped. It surfaced as a flake — the abort
   * that ends the fetch and the deadline that ends the run land in either
   * order, and only a loaded machine reliably picks the losing one — so this
   * test drives the clock instead of racing it.
   */
  it("keeps max_duration when the deadline is what ended the fetch", async () => {
    // A clock that advances a little on every read, like a real one. The bug
    // needed exactly this: `deadlineHit()` is false in the abort branch and
    // true a few reads later, so a fixed clock cannot express it.
    let ticks = 0;
    const now = () => {
      ticks += 1;
      return ticks * 12;
    };
    const fetcher: CrawlFetcher = {
      async fetch(url: string) {
        if (url.endsWith("/robots.txt")) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        return res(HOME_HTML, "text/html");
      },
    };

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, maxWallClockMs: 50, perHostConcurrency: 1 },
      now,
      sleep: async () => {},
    });

    expect(raw.stopReason).toBe("max_duration");
    expect(raw.stopReason).not.toBe("robots_unreachable");
  });

  /**
   * The other half: when the run still has time, an aborted robots.txt fetch
   * really is an unreadable robots.txt and must still fail closed.
   */
  it("still fails closed when only the robots request timed out", async () => {
    const clock = 0;
    const fetcher: CrawlFetcher = {
      async fetch(url: string) {
        if (url.endsWith("/robots.txt")) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        return res(HOME_HTML, "text/html");
      },
    };

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      // Plenty of wall clock left, so the abort is about this request alone.
      budget: { ...FAST_BUDGET, maxWallClockMs: 600_000, perHostConcurrency: 1 },
      now: () => clock,
      sleep: async () => {},
    });

    expect(raw.stopReason).toBe("robots_unreachable");
    expect(raw.pages).toEqual([]);
  });
});

describe("pacing covers every wire request, not every queue entry", () => {
  /**
   * `acquireHostSlot` used to be called once per queue entry, immediately
   * before `guardedFetch`. But one queue entry is not one request: the redirect
   * loop inside `guardedFetch` issues up to `maxRedirects` further requests,
   * and robots.txt and every sitemap document are fetched outside the queue
   * entirely. All of those went out unpaced.
   *
   * That is what makes the advertised rate untrue at the target. With the
   * shipped 250 ms floor and 5 redirect hops, a page could cost 6 requests in
   * the window budgeted for 1 — six times the rate the site was told to expect.
   */
  it("paces each redirect hop, not just the entry that started them", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const fetcher: CrawlFetcher = {
      async fetch(url: string) {
        if (url.endsWith("/robots.txt")) {
          return res("User-agent: *\nDisallow:\n", "text/plain");
        }
        if (url.endsWith("/sitemap.xml")) {
          return res("nope", "text/plain", 404);
        }
        // A three-hop chain on the seed: /  ->  /a  ->  /b  ->  200
        if (url === "https://example.com/") {
          return new Response(null, {
            status: 301,
            headers: { location: "https://example.com/a" },
          });
        }
        if (url === "https://example.com/a") {
          return new Response(null, {
            status: 301,
            headers: { location: "https://example.com/b" },
          });
        }
        return res(HOME_HTML, "text/html");
      },
    };

    await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, minHostDelayMs: 250, perHostConcurrency: 1 },
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    // Seed + two redirect hops + robots + sitemap. Before this change the two
    // hops and the two out-of-queue documents were free, so the count could not
    // reach four paced waits.
    const paced = sleeps.filter((ms) => ms > 0);
    expect(paced.length).toBeGreaterThanOrEqual(4);
    expect(paced.every((ms) => ms === 250)).toBe(true);
  });
});

describe("frontier bookkeeping", () => {
  /**
   * Re-prioritisation used to scan the whole pending frontier per discovered
   * link. The behaviour it implements has to survive being made O(1): a URL
   * first seen deep and later reached shallower keeps its place in visit order
   * and is crawled once, at the shallower depth.
   */
  it("re-prioritises a queued URL in place without duplicating it", async () => {
    const seen: string[] = [];
    const fetcher: CrawlFetcher = {
      async fetch(url: string) {
        if (url.endsWith("/robots.txt")) {
          return res(
            "User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml\n",
            "text/plain",
          );
        }
        if (url.endsWith("/sitemap.xml")) {
          // Seeds /deep at sitemap depth before the homepage links to it.
          return res(
            "<urlset><url><loc>https://example.com/deep</loc></url></urlset>",
            "application/xml",
          );
        }
        seen.push(url);
        if (url === "https://example.com/") {
          return res(
            '<!doctype html><html><head><title>H</title></head><body><a href="/deep">D</a></body></html>',
            "text/html",
          );
        }
        return res(HOME_HTML, "text/html");
      },
    };

    const raw = await crawlSite(PARAMS, CONFIG, CTX, fetcher, {
      guard: GUARD,
      budget: { ...FAST_BUDGET, perHostConcurrency: 1 },
    });

    const deepFetches = seen.filter((url) => url.endsWith("/deep"));
    expect(deepFetches).toHaveLength(1);
    const deep = raw.pages.find((page) => page.subjectUrl.endsWith("/deep"));
    expect(deep).toBeDefined();
    // Reached from the homepage link, not left at the sitemap's depth.
    expect(deep?.depth).toBe(1);
  });
});
