// @input  -- a granted property, confirmed brand inputs, and one request's access token
// @output -- the finished Daily Search Briefing envelope for that property
// @pos    -- binds the pure daily-briefing plan to one request-scoped Search Console token

import {
  runDailyBriefing,
  type DailyBriefingEnvelope,
} from "@sf/public-tools";
import {
  createSearchAnalyticsClient,
  type SearchAnalyticsClientOptions,
} from "@sf/sources";

/** Per-call deadline for a single Search Console request. */
const READ_TIMEOUT_MS = 15_000;

/**
 * Whole-request budget, measured from the handler's start.
 *
 * Freshness discovery, optional analysis attachments and exact-subject
 * verification share this budget. Later reads stop once it is spent.
 */
export const REQUEST_BUDGET_MS = 45_000;

export interface DailyBriefingReadInput {
  readonly property: string;
  readonly brandTerms: readonly string[];
  readonly brandTermsConfirmed: boolean;
  readonly remainingMs: () => number;
}

/**
 * Build the reader for one visitor's request.
 *
 * The access token is captured per call and never stored at module scope.
 */
export function createDailyBriefingReader(options: {
  readonly accessToken: string;
  readonly now?: () => Date;
  /** Injected only for transport tests; production uses the global fetch. */
  readonly fetchImpl?: SearchAnalyticsClientOptions["fetchImpl"];
}): (input: DailyBriefingReadInput) => Promise<DailyBriefingEnvelope> {
  const now = options.now ?? (() => new Date());

  return async ({ property, brandTerms, brandTermsConfirmed, remainingMs }) => {
    const abort = new AbortController();
    const client = createSearchAnalyticsClient({
      siteUrl: property,
      accessToken: options.accessToken,
      requestTimeoutMs: READ_TIMEOUT_MS,
      remainingMs,
      signal: abort.signal,
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
    });

    try {
      return await runDailyBriefing({
        client,
        now: now(),
        brandTerms,
        brandTermsConfirmed,
        budget: { isExpired: () => remainingMs() <= 0 },
      });
    } finally {
      // Idempotent. It closes sibling transport on failure and marks the
      // request scope unusable once the report has finished successfully.
      abort.abort();
    }
  };
}
