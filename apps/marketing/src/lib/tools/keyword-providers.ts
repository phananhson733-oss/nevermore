// @input  -- the request's market, language and candidate list
// @output -- the three DataForSEO seams the orchestration calls, each booking its own cost
// @pos    -- the only place provider transport meets the run's cost accumulator
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  createDataForSeoKeywordMetricsClient,
  type DataForSeoKeywordMetricsClient,
} from "@sf/sources";
import type { KeywordOpportunityProviderRow } from "@sf/public-tools";
import type { KeywordCostAccumulator } from "./keyword-cost-guard.ts";
import type { KeywordSerpSampleResult } from "./keyword-opportunity-handler.ts";

/**
 * Market codes this tool accepts, mapped to the provider's location ids.
 *
 * An allow-list rather than a passthrough. The provider bills per task and
 * answers a bad location with an error only after the call is made, so an
 * unmapped code would be a paid round trip to learn the visitor typed
 * something wrong. Kept deliberately short — every entry here is a market the
 * copy and the coverage window have actually been reasoned about.
 */
export const KEYWORD_MARKET_LOCATIONS: Readonly<Record<string, number>> = {
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  DE: 2276,
  FR: 2250,
  NL: 2528,
  SE: 2752,
};

export class KeywordMarketError extends Error {
  readonly code = "invalid_input" as const;

  constructor(marketCode: string) {
    super(`Unsupported market: ${marketCode}`);
    this.name = "KeywordMarketError";
  }
}

export function keywordLocationCode(marketCode: string): number {
  const code = KEYWORD_MARKET_LOCATIONS[marketCode.toUpperCase()];
  if (code === undefined) throw new KeywordMarketError(marketCode);
  return code;
}

/**
 * How many domains one sampled page can contribute.
 *
 * Ten organic results, so the rank lookup is bounded by the sample cap rather
 * than by whatever the provider happens to return.
 */
const DOMAINS_PER_SERP = 10;

export interface KeywordProviderSeams {
  readonly validateVolumes: (input: {
    readonly keywords: readonly string[];
    readonly marketCode: string;
    readonly languageCode: string;
  }) => Promise<readonly KeywordOpportunityProviderRow[]>;
  readonly sampleSerp: (input: {
    readonly keywords: readonly string[];
    readonly marketCode: string;
    readonly languageCode: string;
  }) => Promise<readonly KeywordSerpSampleResult[]>;
  readonly resolveDomainRanks: (
    domains: readonly string[],
  ) => Promise<ReadonlyMap<string, number>>;
}

/**
 * Bind the provider client to this run's cost accumulator.
 *
 * Every response's `costUsd` is booked here rather than by the caller, because
 * this is the only layer that sees it: the domain seams return rows, and a
 * cost that is not recorded at the point of the call is a cost nobody can
 * report. The provider gives no per-tool breakdown, so an unbooked call is
 * invisible in the invoice.
 */
export function createKeywordProviderSeams(options: {
  readonly costs: KeywordCostAccumulator;
  /** Offline test seam. */
  readonly client?: DataForSeoKeywordMetricsClient;
  readonly login?: string;
  readonly password?: string;
}): KeywordProviderSeams {
  let cached: DataForSeoKeywordMetricsClient | null = options.client ?? null;
  // Built on first use, not at module load: a route file that constructs its
  // dependency object at import time would otherwise take down every endpoint
  // in the file when the credentials are absent.
  const client = (): DataForSeoKeywordMetricsClient => {
    cached ??= createDataForSeoKeywordMetricsClient({
      login: options.login ?? process.env["DATAFORSEO_LOGIN"] ?? "",
      password: options.password ?? process.env["DATAFORSEO_PASSWORD"] ?? "",
    });
    return cached;
  };

  return {
    validateVolumes: async ({ keywords, marketCode, languageCode }) => {
      const response = await client().keywordOverview({
        keywords,
        locationCode: keywordLocationCode(marketCode),
        languageCode,
      });
      options.costs.record("keyword_overview", response.costUsd);
      // Only the rows that came back are returned. The keywords the provider
      // stayed silent about are resolved to `provider_no_data` by the domain
      // layer's set difference — reconstructing them here as zero-volume rows
      // would erase the distinction this pipeline is built around.
      return response.rows.map((row) => ({
        keyword: row.keyword,
        volume: row.searchVolume,
        difficulty: row.keywordDifficulty,
        intent: row.mainIntent,
        serpFeatures: row.serpItemTypes ?? [],
      }));
    },

    sampleSerp: async ({ keywords, marketCode, languageCode }) => {
      const locationCode = keywordLocationCode(marketCode);
      const samples: KeywordSerpSampleResult[] = [];
      // Sequential. The provider's per-minute limit is the binding constraint
      // at this volume, and a throttled call is indistinguishable downstream
      // from a page one that simply had no weak site on it.
      for (const keyword of keywords) {
        const response = await client().serpOrganic({
          keyword,
          locationCode,
          languageCode,
        });
        options.costs.record("serp_organic", response.costUsd);
        samples.push({
          keyword,
          domains: response.rows
            .slice(0, DOMAINS_PER_SERP)
            .map((row) => row.domain),
        });
      }
      return samples;
    },

    resolveDomainRanks: async (domains) => {
      if (domains.length === 0) return new Map<string, number>();
      const response = await client().bulkRanks({ targets: domains });
      options.costs.record("bulk_ranks", response.costUsd);
      // Unresolved targets are absent from the map rather than present with a
      // zero. The provider conflates "no backlink data" with rank zero, and
      // the winnability judgement reads a missing entry as "unknown authority"
      // — which is the honest reading — while a zero would read as "the
      // weakest possible site already ranks here".
      return new Map(response.rows.map((row) => [row.target, row.rank]));
    },
  };
}
