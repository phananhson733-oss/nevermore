import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheCompletedCrawl,
  readCrawlCache,
  targetHostOf,
  writeCrawlCache,
  cachedPayloadBytes,
  type CrawlCacheDependencies,
} from "./crawl-cache.ts";
import { openCrawlGate } from "./crawl-gate.ts";
import {
  acquirePublicCrawlSlot,
  resetPublicToolSlots,
} from "./public-tool-request.ts";
import type { SharedQuotaDependencies } from "./shared-rate-limit.ts";

function cacheDeps(
  overrides: Partial<CrawlCacheDependencies> = {},
): CrawlCacheDependencies {
  return {
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  resetPublicToolSlots();
});

describe("readCrawlCache", () => {
  it("returns a stored entry", async () => {
    const entry = {
      payload: { hello: "world" },
      capturedAt: "2026-08-03T10:00:00Z",
    };
    const result = await readCrawlCache(
      "seo_audit",
      "acme.com",
      cacheDeps({ read: async () => entry }),
    );
    expect(result).toEqual({
      payload: { hello: "world" },
      // Canonicalised on the way out — see the PostgreSQL case below for why
      // this boundary cannot pass a store's own spelling through.
      capturedAt: "2026-08-03T10:00:00.000Z",
    });
  });

  /**
   * PostgreSQL renders `timestamptz` with microsecond precision and a numeric
   * UTC offset — `2026-08-18T06:50:55.033741+00:00` — while every reader here
   * checks the value against `new Date(x).toISOString()`, which is
   * millisecond precision and `Z`. Passing the store's spelling through means
   * a row that was written successfully can never be recognised on the way
   * back, so the cache fills up and every caller still pays for a full crawl.
   * Both stores fail silently, so nothing says so.
   */
  it("canonicalises a PostgreSQL timestamptz into the form its readers check", async () => {
    const result = await readCrawlCache(
      "seo_audit",
      "acme.com",
      cacheDeps({
        read: async () => ({
          payload: { hello: "world" },
          capturedAt: "2026-08-18T06:50:55.033741+00:00",
        }),
      }),
    );

    expect(result?.capturedAt).toBe("2026-08-18T06:50:55.033Z");
    expect(
      new Date(Date.parse(result?.capturedAt ?? "")).toISOString(),
    ).toBe(result?.capturedAt);
  });

  it("treats a row whose timestamp cannot be read as no cache at all", async () => {
    const result = await readCrawlCache(
      "seo_audit",
      "acme.com",
      cacheDeps({
        read: async () => ({ payload: { hello: "world" }, capturedAt: "later" }),
      }),
    );

    expect(result).toBeNull();
  });

  /**
   * The cache fails soft and the quota fails closed, and the asymmetry is
   * deliberate. A cache that cannot be read means we crawl, which is the
   * behaviour that shipped. A quota that cannot be read means an unbounded
   * anonymous crawler aimed at third parties.
   */
  it("returns null rather than throwing when the store is unavailable", async () => {
    const result = await readCrawlCache(
      "seo_audit",
      "acme.com",
      cacheDeps({
        read: async () => {
          throw new Error("relation does not exist");
        },
      }),
    );
    expect(result).toBeNull();
  });
});

describe("writeCrawlCache", () => {
  it("stores a bounded payload", async () => {
    const write = vi.fn(async () => {});
    await writeCrawlCache(
      "seo_audit",
      "acme.com",
      { a: 1 },
      cacheDeps({ write }),
    );
    expect(write).toHaveBeenCalledWith("seo_audit", "acme.com", { a: 1 });
  });

  it("skips a payload too large to be worth storing", async () => {
    const write = vi.fn(async () => {});
    const huge = {
      pages: Array.from(
        { length: 100_000 },
        (_, i) => `${"x".repeat(120)}-${i}`,
      ),
    };
    expect(cachedPayloadBytes(huge)).toBeGreaterThan(8_000_000);
    await writeCrawlCache("seo_audit", "acme.com", huge, cacheDeps({ write }));
    expect(write).not.toHaveBeenCalled();
  });

  it("stores the large sites the cache exists for", async () => {
    // A 1,400-page report serialises to about 1.65 MB, which the old 1.5 MB
    // ceiling refused — so every site past roughly 1,250 pages was re-crawled
    // in full every time, and those are the crawls that take four minutes.
    const write = vi.fn(async () => {});
    const bigSite = {
      pages: Array.from({ length: 1_400 }, (_, i) => ({
        url: `https://acme.com/some/reasonably-long/path/page-${i}`,
        title: "x".repeat(70),
        metaDescription: "y".repeat(160),
        canonicalTarget: `https://acme.com/some/reasonably-long/path/page-${i}`,
        finalUrl: `https://acme.com/some/reasonably-long/path/page-${i}`,
        subjectUrl: `https://acme.com/some/reasonably-long/path/page-${i}`,
        jsonLdTypes: ["WebPage", "BreadcrumbList"],
        h1Count: 1,
        headingsCount: 12,
        wordCount: 900,
        inboundLinks: 8,
        outboundLinks: 40,
      })),
      // A real report is pages *and* the observation rows the rules produced,
      // which is what pushed the measured payload past the old ceiling.
      records: Array.from({ length: 10 }, (_, rule) => ({
        id: `rule_${rule}`,
        observations: Array.from({ length: 700 }, (_, i) => ({
          url: `https://acme.com/some/reasonably-long/path/page-${i}`,
          values: [
            { label: "title_display_width", value: 71 },
            { label: "reviewed_range", value: "15-60" },
          ],
        })),
      })),
    };
    expect(cachedPayloadBytes(bigSite)).toBeGreaterThan(1_500_000);

    await writeCrawlCache("seo_audit", "acme.com", bigSite, cacheDeps({ write }));
    expect(write).toHaveBeenCalledOnce();
  });

  it("measures bytes rather than code units", () => {
    // `String#length` counts UTF-16 units, so a Chinese payload was measured at
    // about a third of what it actually weighs on the wire.
    const chinese = { text: "星".repeat(1_000) };
    expect(JSON.stringify(chinese).length).toBeLessThan(1_100);
    expect(cachedPayloadBytes(chinese)).toBeGreaterThan(3_000);
  });

  /** A cache write must never turn a crawl that succeeded into an error. */
  it("swallows a write failure", async () => {
    await expect(
      writeCrawlCache(
        "seo_audit",
        "acme.com",
        { a: 1 },
        cacheDeps({
          write: async () => {
            throw new Error("disk full");
          },
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

/**
 * The admission rule for the shared cache, in one place because both crawl
 * tools write to the same table with the same crawler behind them. A copy of
 * it per handler is a copy that can be forgotten — which is exactly what
 * happened to internal-link-audit the first time this gate was added.
 */
describe("cacheCompletedCrawl", () => {
  function gate(raw: { readonly stopReason: string | null }) {
    const cachePayload = vi.fn(async () => {});
    return {
      cachePayload,
      run: () =>
        cacheCompletedCrawl({
          raw,
          payload: { pages: 25 },
          normalizedUrl: "https://acme.com/",
          cachePayload,
        }),
    };
  }

  it("refuses a run the crawl engine reported as aborted", async () => {
    const { cachePayload, run } = gate({ stopReason: "aborted" });
    await run();
    expect(cachePayload).not.toHaveBeenCalled();
  });

  /**
   * The engine holds the same signal the request does, so a run it finished
   * is a whole run even if the reader has since left. Rejecting it here would
   * only send the next visitor's crawl back to the target site.
   */
  it("stores a completed run even though the reader has already left", async () => {
    const { cachePayload, run } = gate({ stopReason: null });
    await run();
    expect(cachePayload).toHaveBeenCalledWith("https://acme.com/", {
      pages: 25,
    });
  });

  /**
   * The regression this guards: a gate that cached nothing would send every
   * visitor's crawl to the target site again, which is the traffic the cache
   * exists to remove.
   */
  it.each([null, "max_urls", "max_duration"] as const)(
    "stores a run that stopped for %s",
    async (stopReason) => {
      const { cachePayload, run } = gate({ stopReason });
      await run();
      expect(cachePayload).toHaveBeenCalledWith("https://acme.com/", {
        pages: 25,
      });
    },
  );
});

describe("targetHostOf", () => {
  it("lowercases the host", () => {
    expect(targetHostOf("https://ACME.com/path")).toBe("acme.com");
  });

  it("returns null for an unparseable value", () => {
    expect(targetHostOf("not a url")).toBeNull();
  });
});

describe("cache and the per-target budget together", () => {
  /**
   * The cache is what makes the per-target cap humane. Without it the fifth
   * caller in an hour gets `target_busy`; with it they get the recent result.
   * So a hit must be consulted *before* the target budget is spent — and must
   * not spend it, because a hit sends no traffic to the target at all.
   */
  it("serves a hit without consuming target budget", async () => {
    const buckets: string[] = [];
    const quota: SharedQuotaDependencies = {
      callQuota: async (bucketKey) => {
        buckets.push(bucketKey);
        return { allowed: true, hits: 1, reset_at: "2099-01-01T00:00:00.000Z" };
      },
    };

    const result = await openCrawlGate(
      "203.0.113.9",
      "https://acme.com/",
      { quota, acquireSlot: acquirePublicCrawlSlot },
      async () => ({
        payload: { cached: true },
        capturedAt: "2026-08-03T10:00:00Z",
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "cached") {
      expect(result.payload).toEqual({ cached: true });
      expect(result.capturedAt).toBe("2026-08-03T10:00:00Z");
      result.release();
    } else {
      throw new Error("expected a cached result");
    }

    // The IP budget is still spent — a cached answer is still a request we
    // served — but the target's is untouched.
    expect(buckets).toEqual(["public-crawl:ip:203.0.113.9"]);
    expect(buckets.some((key) => key.startsWith("public-crawl:target:"))).toBe(
      false,
    );
  });

  it("falls through to a crawl on a miss and spends target budget then", async () => {
    const buckets: string[] = [];
    const quota: SharedQuotaDependencies = {
      callQuota: async (bucketKey) => {
        buckets.push(bucketKey);
        return { allowed: true, hits: 1, reset_at: "2099-01-01T00:00:00.000Z" };
      },
    };

    const result = await openCrawlGate(
      "203.0.113.9",
      "https://acme.com/",
      { quota, acquireSlot: acquirePublicCrawlSlot },
      async () => null,
    );

    expect(result.ok && result.kind).toBe("crawl");
    if (result.ok) result.release();
    expect(buckets).toEqual([
      "public-crawl:ip:203.0.113.9",
      "public-crawl:target:acme.com",
    ]);
  });
});
