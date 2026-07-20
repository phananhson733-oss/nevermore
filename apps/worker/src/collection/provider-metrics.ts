import {
  SourceError,
  type CrawlFetcher,
  type GoogleTokenFetch,
  type SourceErrorCode,
} from "@sf/sources";
import type { CollectionOutcome } from "./persist.ts";

export type ProviderMetricOutcome =
  | "success"
  | "stale_attempt"
  | "retry_scheduled"
  | "retry_exhausted"
  | "transient_failure"
  | "permanent_failure";

const PROVIDER_METRIC_LABELS = new Set([
  "crawl",
  "gsc",
  "ga4",
  "csv",
  "dataforseo",
]);

function metricCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

/** Attempt-scoped counters only; this object never retains URLs, bodies, or errors. */
export class ProviderMetricAccumulator {
  private requestCount = 0;
  private rateLimitCount = 0;
  private quotaCount = 0;
  private rowCount = 0;
  private rowCountAvailable = false;
  private urlCount = 0;
  private urlCountAvailable = false;

  constructor(private readonly rawProvider: string) {}

  wrapGoogleFetch(fetchImpl: GoogleTokenFetch): GoogleTokenFetch {
    return async (input, init) => {
      this.incrementRequestCount();
      const response = await fetchImpl(input, init);
      this.observeResponse(response);
      return response;
    };
  }

  wrapCrawlFetcher(fetcher: CrawlFetcher): CrawlFetcher {
    return {
      fetch: async (url, init) => {
        this.incrementRequestCount();
        const response = await fetcher.fetch(url, init);
        this.observeResponse(response);
        return response;
      },
    };
  }

  recordResult(outcome: CollectionOutcome): void {
    const rows = metricCount(outcome.rowCount);
    if (rows !== null) {
      this.rowCount = rows;
      this.rowCountAvailable = true;
    }
    if (this.rawProvider !== "crawl") return;
    const urls = metricCount(outcome.providerUsage["urlsFetched"]);
    if (urls !== null) {
      this.urlCount = urls;
      this.urlCountAvailable = true;
    }
  }

  recordFailure(error: unknown): void {
    if (!(error instanceof SourceError) || this.requestCount === 0) return;
    if (error.code === "RATE_LIMITED" && this.rateLimitCount === 0) {
      this.rateLimitCount = 1;
    }
    if (error.code === "QUOTA_EXCEEDED" && this.quotaCount === 0) {
      this.quotaCount = 1;
    }
  }

  fields(
    outcome: ProviderMetricOutcome,
    errorCode: SourceErrorCode | "NONE",
  ): Record<string, unknown> {
    return {
      provider: PROVIDER_METRIC_LABELS.has(this.rawProvider)
        ? this.rawProvider
        : "unknown",
      outcome,
      errorCode,
      requestCount: this.requestCount,
      rateLimitCount: this.rateLimitCount,
      quotaCount: this.quotaCount,
      rowCount: this.rowCount,
      rowCountAvailable: this.rowCountAvailable,
      urlCount: this.urlCount,
      urlCountAvailable: this.urlCountAvailable,
    };
  }

  private incrementRequestCount(): void {
    if (this.requestCount < Number.MAX_SAFE_INTEGER) this.requestCount += 1;
  }

  private observeResponse(response: Response): void {
    if (
      response.status === 429 &&
      this.rateLimitCount < Number.MAX_SAFE_INTEGER
    ) {
      this.rateLimitCount += 1;
    }
  }
}
