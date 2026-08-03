import { describe, expect, it, vi } from "vitest";
import {
  consumePublicToolQuota,
  crawlIpBucket,
  crawlTargetBucket,
  type SharedQuotaDependencies,
} from "./shared-rate-limit.ts";

const NOW = Date.parse("2026-08-03T12:00:00.000Z");
const now = () => NOW;

function deps(row: unknown, throws?: Error): SharedQuotaDependencies {
  return {
    callQuota: vi.fn(async () => {
      if (throws) throw throws;
      return row as never;
    }),
  };
}

describe("consumePublicToolQuota", () => {
  it("allows a request that fits the window", async () => {
    const outcome = await consumePublicToolQuota(
      "k",
      10,
      600,
      deps({ allowed: true, hits: 3, reset_at: "2026-08-03T12:10:00.000Z" }),
      now,
    );
    expect(outcome).toEqual({ kind: "allowed", hits: 3 });
  });

  it("reports the wait when the window is spent", async () => {
    const outcome = await consumePublicToolQuota(
      "k",
      10,
      600,
      deps({ allowed: false, hits: 11, reset_at: "2026-08-03T12:02:30.000Z" }),
      now,
    );
    expect(outcome).toEqual({ kind: "limited", retryAfterSeconds: 150 });
  });

  it("never reports a zero or negative wait", async () => {
    const outcome = await consumePublicToolQuota(
      "k",
      10,
      600,
      deps({ allowed: false, hits: 11, reset_at: "2026-08-03T11:59:00.000Z" }),
      now,
    );
    expect(outcome).toEqual({ kind: "limited", retryAfterSeconds: 1 });
  });

  /**
   * The store being down must be distinguishable from the store saying yes.
   * Callers on the crawl paths turn `unavailable` into a refusal, because an
   * unbounded anonymous crawler is worse than a tool that is briefly offline —
   * and because "the quota store is missing" is precisely the state a fresh
   * deploy is in before the migration is applied.
   */
  it("returns unavailable rather than allowed when the store errors", async () => {
    const outcome = await consumePublicToolQuota(
      "k",
      10,
      600,
      deps(null, new Error("relation does not exist")),
      now,
    );
    expect(outcome.kind).toBe("unavailable");
  });

  it("returns unavailable when the function answers with no row", async () => {
    const outcome = await consumePublicToolQuota("k", 10, 600, deps(null), now);
    expect(outcome.kind).toBe("unavailable");
  });

  it("does not leak the store's error text to the outcome kind", async () => {
    const outcome = await consumePublicToolQuota(
      "k",
      10,
      600,
      deps(null, new Error("password authentication failed for user postgres")),
      now,
    );
    // The reason is available for server logs, but `kind` is all a caller maps
    // to a response body.
    expect(outcome.kind).toBe("unavailable");
    expect(Object.keys(outcome)).toEqual(["kind", "reason"]);
  });
});

describe("bucket keys", () => {
  /**
   * The shipped code gave internal-link-audit a 30-per-10-minute fuse and
   * seo-audit nothing at all. Even had both been limited, per-endpoint keys
   * would let a caller exhaust one and continue on the other — the two run the
   * identical crawl against the identical target for the identical cost.
   */
  it("puts both crawl tools in one per-IP bucket", () => {
    expect(crawlIpBucket("203.0.113.9")).toBe("public-crawl:ip:203.0.113.9");
    // No tool name appears in the key.
    expect(crawlIpBucket("203.0.113.9")).not.toContain("seo-audit");
    expect(crawlIpBucket("203.0.113.9")).not.toContain("internal-link-audit");
  });

  it("keys the target bucket on the host, case-insensitively", () => {
    expect(crawlTargetBucket("Victim.EXAMPLE")).toBe(
      crawlTargetBucket("victim.example"),
    );
  });

  it("keeps the IP and target namespaces apart", () => {
    expect(crawlIpBucket("acme.com")).not.toBe(crawlTargetBucket("acme.com"));
  });
});
