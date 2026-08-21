// @input  -- the request's market, language and candidate list
// @output -- typed DataForSEO seams with enriched SERP evidence and booked cost
// @pos    -- the only place provider transport meets the run's cost accumulator
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  bulkTrafficEstimation,
  createDomainRegistrationResolver,
  createDataForSeoKeywordMetricsClient,
  labsLanguageForMarket,
  normalizeRdapDomain,
  normalizeTrafficDomain,
  SourceError,
  type BulkTrafficEstimationOptions,
  type BulkTrafficEstimationResult,
  type DataForSeoKeywordMetricsClient,
  type DomainRegistrationEvidence,
} from "@sf/sources";
import type {
  KeywordOpportunityProviderRow,
  KeywordOpportunitySerpFailureReason,
} from "@sf/public-tools";
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

/** Maximum simultaneous page-one reads inside one keyword request. */
export const KEYWORD_SERP_CONCURRENCY = 10;

/** Race winner meaning the run's clock ran out, not that a wave finished. */
const DEADLINE = Symbol("keyword-serp-deadline");

/** Maximum simultaneous registry reads inside one keyword request. */
export const MAX_KEYWORD_RDAP_CONCURRENCY = 10;

const STAGE_WIDE_SERP_ERROR_CODES: ReadonlySet<SourceError["code"]> = new Set([
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "INVALID_CONFIGURATION",
]);

function isStageWideSerpError(error: unknown): error is SourceError {
  return (
    error instanceof SourceError && STAGE_WIDE_SERP_ERROR_CODES.has(error.code)
  );
}

function serpFailureReason(
  error: unknown,
): KeywordOpportunitySerpFailureReason {
  return error instanceof SourceError && error.code === "TIMEOUT"
    ? "transport_outcome_unknown"
    : "provider_unavailable";
}

function unavailableSerpSample(
  keyword: string,
  failureReason: KeywordOpportunitySerpFailureReason,
): KeywordSerpSampleResult {
  return {
    keyword,
    status: "unavailable",
    failureReason,
    observedAt: null,
    results: [],
    pageItemTypes: null,
    aiOverview: null,
    communityItems: null,
  };
}

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
  readonly resolveDomainTraffic: (input: {
    readonly domains: readonly string[];
    readonly marketCode: string;
  }) => Promise<ReadonlyMap<string, number | null> | null>;
  readonly resolveDomainRegistrations: (
    domains: readonly string[],
  ) => Promise<ReadonlyMap<string, DomainRegistrationEvidence>>;
}

type TrafficEstimator = (
  options: BulkTrafficEstimationOptions,
) => Promise<BulkTrafficEstimationResult | null>;

interface DomainInput {
  /** Stable map/cache identity: normalized when valid, raw when invalid. */
  readonly key: string;
  /** Value passed to the source adapter. */
  readonly lookup: string;
  readonly valid: boolean;
}

function distinctDomainInputs(
  domains: readonly string[],
  normalize: (domain: string) => string | null,
): readonly DomainInput[] {
  const seen = new Set<string>();
  const distinct: DomainInput[] = [];
  for (const domain of domains) {
    const normalized = normalize(domain);
    const valid = normalized !== null;
    const key = normalized ?? domain;
    const dedupeKey = `${valid ? "valid" : "invalid"}:${key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    distinct.push({ key, lookup: key, valid });
  }
  return distinct;
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
  readonly estimateTraffic?: TrafficEstimator;
  readonly resolveRegistration?: (
    domain: string,
  ) => Promise<DomainRegistrationEvidence>;
  readonly now?: () => Date;
  /**
   * Absolute epoch-ms mark past which page-one sampling stops.
   *
   * Set by the route, which is the only layer that knows when the request
   * started. Sampling is the stage whose call count scales with the candidate
   * cap and whose waves are serial: 150 keywords is fifteen waves, each one as
   * slow as the slowest of its ten calls, each call allowed thirty seconds. A
   * timeout is per-keyword rather than stage-wide, so one straggler per wave
   * produces the full 450-second path instead of failing fast — more than the
   * whole route budget, before any later stage gets to consult a clock.
   * Omitted callers sample unbounded, as before.
   */
  readonly deadlineAt?: number;
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
  const registrationResolver = createDomainRegistrationResolver(
    options.now === undefined ? {} : { now: options.now },
  );
  const registrationPromises = new Map<
    string,
    Promise<DomainRegistrationEvidence>
  >();
  const resolveRegistration = (
    domain: string,
  ): Promise<DomainRegistrationEvidence> => {
    let pending = registrationPromises.get(domain);
    if (pending === undefined) {
      pending = Promise.resolve().then(
        () =>
          options.resolveRegistration?.(domain) ??
          registrationResolver.resolve(domain),
      );
      registrationPromises.set(domain, pending);
      void pending.catch(() => {
        if (registrationPromises.get(domain) === pending) {
          registrationPromises.delete(domain);
        }
      });
    }
    return pending;
  };

  const unavailableRegistration = (
    domain: string,
  ): DomainRegistrationEvidence => ({
    domain: normalizeRdapDomain(domain),
    availability: "unavailable",
    registeredAt: null,
    observedAt: (options.now?.() ?? new Date()).toISOString(),
    sourceHost: null,
    reason: "registry_unavailable",
  });

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
      const plan = Object.freeze(
        keywords.map((keyword, index) => Object.freeze({ index, keyword })),
      );
      const samples: KeywordSerpSampleResult[] = new Array(plan.length);
      const abortController = new AbortController();
      // Latched when the deadline ends the stage. Calls still in flight keep
      // running — nothing here can cancel the provider — but their outcomes
      // are no longer this stage's answer, and must not overwrite the one it
      // already wrote for that keyword.
      let abandoned = false;
      let stageError: SourceError | null = null;
      let rejectStageFailure!: (error: SourceError) => void;
      const stageFailure = new Promise<never>((_resolve, reject) => {
        rejectStageFailure = reject;
      });
      // The promise can reject while the current wave is still constructing.
      // Attach a handler immediately; each wave also races the original promise
      // so the caller still receives the exact first stage-wide error.
      void stageFailure.catch(() => {});

      const runItem = async (item: (typeof plan)[number]): Promise<void> => {
        try {
          const response = await client().serpOrganic(
            {
              keyword: item.keyword,
              locationCode,
              languageCode,
              loadAsyncAiOverview: true,
            },
            abortController.signal,
          );
          // A resolved provider call is billable even when it reports no
          // usable SERP. Thrown calls have no response cost to book here.
          options.costs.record("serp_organic", response.costUsd);
          // A provider that ignores abort may still answer after the run has
          // already failed. Its real cost remains booked, but its late evidence
          // must not mutate an outcome the caller can no longer receive.
          if (stageError !== null) return;
          const hasUsableShape =
            response.rows.length > 0 ||
            response.itemTypes !== null ||
            response.aiOverview !== null ||
            response.communityItems !== null;
          if (!hasUsableShape) {
            samples[item.index] = unavailableSerpSample(
              item.keyword,
              "provider_no_data",
            );
            return;
          }
          // Position and item types travel with the domains. Both are already
          // parsed by the provider client and cost nothing extra.
          if (abandoned) return;
          samples[item.index] = {
            keyword: item.keyword,
            status: "complete",
            failureReason: null,
            observedAt: (options.now?.() ?? new Date()).toISOString(),
            results: response.rows.slice(0, DOMAINS_PER_SERP).map((row) => ({
              domain: row.domain,
              position: row.rankGroup,
              title: row.title,
              url: row.url,
            })),
            pageItemTypes: response.itemTypes,
            aiOverview: response.aiOverview,
            communityItems: response.communityItems,
          };
        } catch (error) {
          if (isStageWideSerpError(error)) {
            if (stageError === null) {
              stageError = error;
              abortController.abort(error);
              rejectStageFailure(error);
            }
            return;
          }
          // A sibling's stage-wide failure owns the final outcome. Its abort
          // commonly arrives here as TIMEOUT and must not be mistaken for a
          // query-specific result.
          if (stageError !== null || abortController.signal.aborted) return;
          // Same reasoning for the deadline: once the stage has stopped waiting
          // and written this keyword's outcome, a late arrival must not
          // overwrite it with a different one.
          if (abandoned) return;
          samples[item.index] = unavailableSerpSample(
            item.keyword,
            serpFailureReason(error),
          );
        }
      };

      // A fixed wave is the fail-fast boundary. Replenishing a worker as soon
      // as one query succeeds can dispatch keyword 11 while a slower sibling
      // is about to report bad credentials. No next wave starts until every
      // call in the current one has settled and its stage-wide status is known.
      /** Keywords the run never asked about, as opposed to ones it asked and lost. */
      const strandUnasked = (from: number): void => {
        for (const item of plan.slice(from)) {
          samples[item.index] = unavailableSerpSample(
            item.keyword,
            "budget_exhausted",
          );
        }
      };

      for (
        let waveStart = 0;
        waveStart < plan.length;
        waveStart += KEYWORD_SERP_CONCURRENCY
      ) {
        const remainingMs =
          options.deadlineAt === undefined
            ? null
            : options.deadlineAt - (options.now?.() ?? new Date()).getTime();
        // Checked before dispatching rather than only after: a wave started
        // with nothing left to spend still bills for ten provider calls whose
        // answers arrive after the route has been killed.
        if (
          remainingMs !== null &&
          (!Number.isFinite(remainingMs) || remainingMs <= 0)
        ) {
          strandUnasked(waveStart);
          break;
        }
        const wave = plan.slice(
          waveStart,
          waveStart + KEYWORD_SERP_CONCURRENCY,
        );
        const waveCompletion = Promise.all(wave.map(runItem));
        // Promise.race keeps its handlers attached after it settles. The extra
        // rejection handler also protects against a future runItem regression:
        // a stubborn sibling may reject long after stageFailure won the race.
        void waveCompletion.catch(() => {});
        let expire = (): void => {};
        // Declining the next wave is not enough on its own: this one owns up to
        // thirty seconds of the budget it was admitted with, and one straggler
        // holds the other nine.
        const waveDeadline: Promise<typeof DEADLINE> | null =
          remainingMs === null
            ? null
            : new Promise<typeof DEADLINE>((resolve) => {
                const timer = setTimeout(() => {
                  resolve(DEADLINE);
                }, remainingMs);
                expire = () => {
                  clearTimeout(timer);
                };
              });
        const outcome = await Promise.race(
          waveDeadline === null
            ? [waveCompletion, stageFailure]
            : [waveCompletion, stageFailure, waveDeadline],
        );
        expire();
        if (stageError !== null) throw stageError;
        if (outcome === DEADLINE) {
          abandoned = true;
          // This wave was asked and its answer never arrived, which is not the
          // same fact as never asking. Whatever landed before the mark stays.
          for (const item of wave) {
            samples[item.index] ??= unavailableSerpSample(
              item.keyword,
              "transport_outcome_unknown",
            );
          }
          strandUnasked(waveStart + KEYWORD_SERP_CONCURRENCY);
          break;
        }
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

    resolveDomainTraffic: async ({ domains, marketCode }) => {
      const inputs = distinctDomainInputs(domains, normalizeTrafficDomain);
      if (inputs.some((input) => !input.valid)) return null;
      const distinct = inputs.map((input) => input.lookup);
      if (distinct.length === 0) return new Map<string, number | null>();
      const languageCode = labsLanguageForMarket(marketCode);
      if (languageCode === null) return null;
      const response = await (options.estimateTraffic ?? bulkTrafficEstimation)(
        {
          login: options.login ?? process.env["DATAFORSEO_LOGIN"] ?? "",
          password:
            options.password ?? process.env["DATAFORSEO_PASSWORD"] ?? "",
          targets: distinct,
          marketCode: marketCode.trim().toUpperCase(),
          locationCode: keywordLocationCode(marketCode),
          languageCode,
          onCost: (costUsd) => options.costs.record("bulk_traffic", costUsd),
        },
      );
      if (response === null) return null;
      const traffic = new Map(
        response.rows.map((row) => [row.normalizedTarget, row.organicEtv]),
      );
      return new Map(
        distinct.map((domain) => [domain, traffic.get(domain) ?? null]),
      );
    },

    resolveDomainRegistrations: async (domains) => {
      const distinct = distinctDomainInputs(domains, normalizeRdapDomain);
      const entries: (readonly [string, DomainRegistrationEvidence])[] =
        new Array(distinct.length);
      let nextIndex = 0;
      const worker = async (): Promise<void> => {
        while (nextIndex < distinct.length) {
          const index = nextIndex;
          nextIndex += 1;
          const input = distinct[index];
          if (input === undefined) return;
          let evidence: DomainRegistrationEvidence;
          try {
            evidence = await resolveRegistration(input.lookup);
          } catch {
            evidence = unavailableRegistration(input.lookup);
          }
          entries[index] = [input.key, evidence];
        }
      };
      await Promise.all(
        Array.from(
          {
            length: Math.min(MAX_KEYWORD_RDAP_CONCURRENCY, distinct.length),
          },
          worker,
        ),
      );
      return new Map(entries);
    },
  };
}
