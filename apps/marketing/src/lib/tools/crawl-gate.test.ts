import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CRAWL_IP_MAX,
  CRAWL_TARGET_MAX,
  openCrawlGate,
  type CrawlGateDependencies,
} from "./crawl-gate.ts";
import {
  acquirePublicCrawlSlot,
  resetPublicToolSlots,
} from "./public-tool-request.ts";

/**
 * An in-memory stand-in for the Postgres function, keyed exactly as the real
 * one is. It lets these tests assert which *bucket* a request lands in, which
 * is the property the shipped code got wrong.
 */
function fakeStore() {
  const hits = new Map<string, number>();
  return {
    hits,
    deps(): CrawlGateDependencies {
      return {
        acquireSlot: acquirePublicCrawlSlot,
        quota: {
          callQuota: async (bucketKey, max) => {
            const next = (hits.get(bucketKey) ?? 0) + 1;
            hits.set(bucketKey, next);
            return {
              allowed: next <= max,
              hits: next,
              reset_at: "2099-01-01T00:00:00.000Z",
            };
          },
        },
      };
    },
  };
}

beforeEach(() => {
  resetPublicToolSlots();
});

describe("openCrawlGate", () => {
  it("admits a first request and hands back a release", async () => {
    const result = await openCrawlGate(
      "203.0.113.9",
      "https://acme.com/",
      fakeStore().deps(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) result.release();
  });

  /**
   * The reported bypass. internal-link-audit had a 30-per-10-minute fuse and
   * seo-audit had none, but even if both had been limited, per-tool keys would
   * let a caller spend one budget and continue on the other endpoint — which
   * runs the identical crawl, against the identical target, for the identical
   * cost. One IP, one budget, both tools.
   */
  it("spends one budget no matter which of the two tools is called", async () => {
    const store = fakeStore();
    const deps = store.deps();

    for (let call = 0; call < CRAWL_IP_MAX; call += 1) {
      // Alternate targets so the per-target cap is not what stops us.
      const result = await openCrawlGate(
        "203.0.113.9",
        `https://site-${call}.com/`,
        deps,
      );
      expect(result.ok).toBe(true);
      if (result.ok) result.release();
    }

    const overflow = await openCrawlGate(
      "203.0.113.9",
      "https://another.com/",
      deps,
    );
    expect(overflow.ok).toBe(false);

    // Exactly one IP bucket was ever touched, and it carries no tool name.
    const ipBuckets = [...store.hits.keys()].filter((key) =>
      key.startsWith("public-crawl:ip:"),
    );
    expect(ipBuckets).toEqual(["public-crawl:ip:203.0.113.9"]);
  });

  /**
   * The anti-relay control. One 50-byte POST buys up to 4,500 requests and
   * 128 MB pulled from a third party, and those bytes are paid for by that
   * third party. Different attackers, or one attacker rotating source IPs,
   * must still not be able to aim the tool at one victim repeatedly.
   */
  it("caps crawls per target across different callers", async () => {
    const store = fakeStore();
    const deps = store.deps();

    for (let call = 0; call < CRAWL_TARGET_MAX; call += 1) {
      const result = await openCrawlGate(
        `198.51.100.${call}`,
        "https://victim.example/",
        deps,
      );
      expect(result.ok).toBe(true);
      if (result.ok) result.release();
    }

    const refused = await openCrawlGate(
      "198.51.100.200",
      "https://victim.example/",
      deps,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.response.status).toBe(429);
      await expect(refused.response.json()).resolves.toEqual({
        error: { code: "target_busy" },
      });
    }
  });

  it("treats www and apex of the same submission by exact host", async () => {
    const store = fakeStore();
    const deps = store.deps();
    const first = await openCrawlGate("203.0.113.1", "https://ACME.com/", deps);
    if (first.ok) first.release();
    const second = await openCrawlGate(
      "203.0.113.2",
      "https://acme.com/",
      deps,
    );
    if (second.ok) second.release();

    expect(store.hits.get("public-crawl:target:acme.com")).toBe(2);
  });

  /**
   * Fail closed. This is the state a deploy is in before the migration runs,
   * and serving the crawl anyway would put an unbounded anonymous crawler in
   * front of third-party sites.
   */
  it("refuses when the quota store cannot answer", async () => {
    const result = await openCrawlGate("203.0.113.9", "https://acme.com/", {
      acquireSlot: acquirePublicCrawlSlot,
      quota: {
        callQuota: async () => {
          throw new Error('relation "public_tool_rate_limits" does not exist');
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      const body = await result.response.text();
      expect(JSON.parse(body)).toEqual({
        error: { code: "quota_unavailable" },
      });
      // Must not echo the store's error text to an anonymous caller: it names
      // our table and would confirm the outage.
      expect(body).not.toContain("relation");
      expect(body).not.toContain("public_tool_rate_limits");
    }
  });

  /**
   * A refusal that kept the in-flight slot would lock the caller out until the
   * isolate recycled, turning a rate limit into a lasting denial of service for
   * everyone sharing that extracted IP.
   */
  it("releases the in-flight slot on every refusal path", async () => {
    let allowed = false;
    const deps: CrawlGateDependencies = {
      acquireSlot: acquirePublicCrawlSlot,
      quota: {
        callQuota: async () => ({
          allowed,
          hits: 1,
          reset_at: "2099-01-01T00:00:00.000Z",
        }),
      },
    };

    const refused = await openCrawlGate(
      "203.0.113.9",
      "https://acme.com/",
      deps,
    );
    expect(refused.ok).toBe(false);

    allowed = true;
    const retry = await openCrawlGate("203.0.113.9", "https://acme.com/", deps);
    expect(retry.ok).toBe(true);
    if (retry.ok) retry.release();
  });

  it("rejects a second concurrent crawl from the same IP", async () => {
    const deps = fakeStore().deps();
    const first = await openCrawlGate("203.0.113.9", "https://acme.com/", deps);
    expect(first.ok).toBe(true);

    const second = await openCrawlGate(
      "203.0.113.9",
      "https://other.com/",
      deps,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.response.status).toBe(409);
    }
    if (first.ok) first.release();
  });

  it("does not consume budget for an unparseable target", async () => {
    const store = fakeStore();
    const callQuota = vi.fn(store.deps().quota.callQuota);
    const result = await openCrawlGate("203.0.113.9", "not a url", {
      acquireSlot: acquirePublicCrawlSlot,
      quota: { callQuota },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
    expect(callQuota).not.toHaveBeenCalled();
  });
});
