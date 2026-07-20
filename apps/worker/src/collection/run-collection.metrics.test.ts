import { describe, expect, it, vi } from "vitest";
import { SourceError, type CrawlFetcher, type GoogleTokenFetch } from "@sf/sources";
import type { CollectionOutcome } from "./persist.ts";
import { ProviderMetricAccumulator } from "./provider-metrics.ts";

function outcome(
  rowCount: number,
  providerUsage: Record<string, number> = {},
): CollectionOutcome {
  return {
    availability: "available",
    capturedAt: "2026-07-20T00:00:00.000Z",
    sourceWindow: { start: null, end: null },
    rowCount,
    stopReason: null,
    providerUsage,
    limitation: "",
    raw: {},
  };
}

describe("provider technical metric accumulator (spec §15.2)", () => {
  it("counts Google API and OAuth fetch attempts exactly without retaining request or response data", async () => {
    const metrics = new ProviderMetricAccumulator("gsc");
    const fetchImpl = vi.fn<GoogleTokenFetch>(async () =>
      new Response('{"customer":"provider-response-secret"}', {
        status: 403,
      }),
    );
    const counted = metrics.wrapGoogleFetch(fetchImpl);

    await counted("https://provider.example/customer-path?query=secret", {
      headers: { authorization: "Bearer customer-token-secret" },
    });
    metrics.recordFailure(
      new SourceError(
        "QUOTA_EXCEEDED",
        "provider raw error containing customer-error-secret",
      ),
    );

    const fields = metrics.fields("permanent_failure", "QUOTA_EXCEEDED");
    expect(fields).toEqual({
      provider: "gsc",
      outcome: "permanent_failure",
      errorCode: "QUOTA_EXCEEDED",
      requestCount: 1,
      rateLimitCount: 0,
      quotaCount: 1,
      rowCount: 0,
      rowCountAvailable: false,
      urlCount: 0,
      urlCountAvailable: false,
    });
    expect(JSON.stringify(fields)).not.toMatch(
      /customer-path|query|secret|authorization|token|provider raw/i,
    );
  });

  it("counts every crawl transport attempt, including a failed attempt, and reports URL coverage separately", async () => {
    const metrics = new ProviderMetricAccumulator("crawl");
    const responses = [
      new Response("ok", { status: 200 }),
      new Response("limited", { status: 429 }),
    ];
    const fetcher: CrawlFetcher = {
      fetch: vi.fn(async () => {
        const response = responses.shift();
        if (!response) throw new Error("network customer-error-secret");
        return response;
      }),
    };
    const counted = metrics.wrapCrawlFetcher(fetcher);
    const signal = new AbortController().signal;

    await counted.fetch("https://customer.example/robots.txt", { signal });
    await counted.fetch("https://customer.example/sitemap.xml", { signal });
    await expect(
      counted.fetch("https://customer.example/private-page", { signal }),
    ).rejects.toThrow("network customer-error-secret");
    metrics.recordResult(outcome(4, { urlsFetched: 2 }));

    const fields = metrics.fields("success", "NONE");
    expect(fields).toMatchObject({
      provider: "crawl",
      requestCount: 3,
      rateLimitCount: 1,
      quotaCount: 0,
      rowCount: 4,
      rowCountAvailable: true,
      urlCount: 2,
      urlCountAvailable: true,
    });
    expect(JSON.stringify(fields)).not.toMatch(
      /customer\.example|robots|sitemap|private-page|customer-error/i,
    );
  });

  it("does not double-count a stable RATE_LIMITED error after observing its 429 response", async () => {
    const metrics = new ProviderMetricAccumulator("ga4");
    const counted = metrics.wrapGoogleFetch(
      vi.fn<GoogleTokenFetch>(async () => new Response(null, { status: 429 })),
    );

    await counted("https://analyticsdata.googleapis.com/fixed-endpoint");
    metrics.recordFailure(new SourceError("RATE_LIMITED", "provider prose"));

    expect(metrics.fields("retry_scheduled", "RATE_LIMITED")).toMatchObject({
      requestCount: 1,
      rateLimitCount: 1,
      quotaCount: 0,
    });
  });

  it("uses explicit availability flags instead of presenting unsupported counts as observed zero", () => {
    const csv = new ProviderMetricAccumulator("csv");
    csv.recordResult(outcome(2));
    expect(csv.fields("success", "NONE")).toMatchObject({
      provider: "csv",
      requestCount: 0,
      rowCount: 2,
      rowCountAvailable: true,
      urlCount: 0,
      urlCountAvailable: false,
    });

    const invalid = new ProviderMetricAccumulator("untrusted-provider-label");
    invalid.recordResult(outcome(Number.NaN, { urlsFetched: -1 }));
    expect(invalid.fields("permanent_failure", "INVALID_RESPONSE")).toMatchObject({
      provider: "unknown",
      rowCount: 0,
      rowCountAvailable: false,
      urlCount: 0,
      urlCountAvailable: false,
    });
  });
});
