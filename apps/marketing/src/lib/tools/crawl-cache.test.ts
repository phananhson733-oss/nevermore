import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readCrawlCache,
  targetHostOf,
  writeCrawlCache,
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
    const entry = { payload: { hello: "world" }, capturedAt: "2026-08-03T10:00:00Z" };
    const result = await readCrawlCache(
      "seo_audit",
      "acme.com",
      cacheDeps({ read: async () => entry }),
    );
    expect(result).toEqual(entry);
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
    await writeCrawlCache("seo_audit", "acme.com", { a: 1 }, cacheDeps({ write }));
    expect(write).toHaveBeenCalledWith("seo_audit", "acme.com", { a: 1 });
  });

  it("skips a payload too large to be worth storing", async () => {
    const write = vi.fn(async () => {});
    // Comfortably past the 1.5 MB ceiling.
    const huge = {
      pages: Array.from({ length: 20_000 }, (_, i) => `${"x".repeat(120)}-${i}`),
    };
    await writeCrawlCache("seo_audit", "acme.com", huge, cacheDeps({ write }));
    expect(write).not.toHaveBeenCalled();
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
      async () => ({ payload: { cached: true }, capturedAt: "2026-08-03T10:00:00Z" }),
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
