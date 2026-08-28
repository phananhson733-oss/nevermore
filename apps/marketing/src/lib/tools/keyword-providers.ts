// @input  -- the request's market, language and candidate list
// @output -- typed DataForSEO seams with enriched SERP evidence and booked cost
// @pos    -- the only place provider transport meets the run's cost accumulator
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { SourceError } from "@sf/sources/adapter";
import {
  bulkTrafficEstimation,
  labsLanguageForMarket,
  normalizeTrafficDomain,
  type BulkTrafficEstimationOptions,
  type BulkTrafficEstimationResult,
} from "@sf/sources/dataforseo/labs-traffic";
import {
  createDataForSeoKeywordMetricsClient,
  type DataForSeoKeywordMetricsClient,
} from "@sf/sources/dataforseo/keyword-metrics";
import { dataForSeoMarketLanguages } from "@sf/sources/dataforseo/market-language";
import {
  createDomainRegistrationResolver,
  normalizeRdapDomain,
  type DomainRegistrationEvidence,
} from "@sf/sources/rdap/domain-registration";
import type {
  KeywordOpportunityProviderRow,
  KeywordOpportunitySerpFailureReason,
} from "@sf/public-tools/keyword-opportunity";
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

/**
 * The search languages each offered market can actually be queried in.
 *
 * Derived from the provider catalogue rather than typed here, so the options a
 * picker shows are the options the request resolver will honour. Typed by hand
 * once, they were both too many (four languages the United States has no
 * database for) and too few (`es`, which it does).
 */
export const KEYWORD_MARKET_LANGUAGES: Readonly<
  Record<string, readonly string[]>
> = Object.freeze(
  Object.fromEntries(
    Object.keys(KEYWORD_MARKET_LOCATIONS).map((market) => [
      market,
      dataForSeoMarketLanguages(market),
    ]),
  ),
);


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
          // Above the shape check, not below it: an answer that arrives after
          // the stage stopped waiting must not replace the outcome already
          // published for this keyword — including the empty-handed answer,
          // which would turn "we stopped waiting" into "the provider had
          // nothing", a fact this run never established.
          if (abandoned) return;
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

      // A replenishing pool, not fixed waves. Fixed waves were measured on
      // 2026-08-21 against the live provider: per-call p50 was 5.3s but the
      // slowest of each ten averaged 13.8s, and the wave barrier makes every
      // call wait for that straggler — 15 waves took 207 of the run's 240
      // seconds, which is exactly the partial report production produced that
      // day. A pool pulls the next keyword the moment any worker frees, so
      // throughput follows the average latency instead of the per-ten worst.
      // The waves' fail-fast property is kept in this form: a stage-wide error
      // latches `stageError` and no worker pulls past it. What is NOT bounded
      // is cumulative dispatch before a *delayed* stage-wide error latches —
      // fast successful siblings keep replenishing while a slow call is still
      // on its way to reporting bad credentials, and in the worst case the
      // whole plan is dispatched and then discarded by the rejection. That
      // trade is taken knowingly: a delayed auth error alongside succeeding
      // siblings means the credentials mostly work, the concurrent exposure
      // stays capped at pool width, and the barrier that prevented it cost
      // every clean run half its time budget.
      const dispatched: boolean[] = new Array<boolean>(plan.length).fill(false);
      let nextItem = 0;
      const outOfBudget = (): boolean => {
        if (options.deadlineAt === undefined) return false;
        const remainingMs =
          options.deadlineAt - (options.now?.() ?? new Date()).getTime();
        // Fail closed on a non-finite mark, and do not dispatch a call that
        // cannot plausibly answer in time: it bills for an answer that arrives
        // after the stage has already published this keyword's outcome.
        return !Number.isFinite(remainingMs) || remainingMs <= 0;
      };
      const worker = async (): Promise<void> => {
        for (;;) {
          if (stageError !== null || abandoned || outOfBudget()) return;
          const index = nextItem;
          if (index >= plan.length) return;
          nextItem = index + 1;
          const item = plan[index];
          if (item === undefined) return;
          dispatched[index] = true;
          await runItem(item);
        }
      };
      let expire = (): void => {};
      // Armed before the first dispatch, not after: the workers run
      // synchronously up to their first await, and a deadline read only when
      // they yield would see whatever they already spent — an answer that made
      // it back before the mark must be kept, so the mark has to exist first.
      // The workers' own budget checks stop new dispatches; the race below is
      // what caps the wait on the calls already in flight, which own up to
      // thirty seconds each.
      const stageDeadline = ((): Promise<typeof DEADLINE> | null => {
        const deadlineAt = options.deadlineAt;
        if (deadlineAt === undefined) return null;
        const startRemainingMs =
          deadlineAt - (options.now?.() ?? new Date()).getTime();
        if (!Number.isFinite(startRemainingMs) || startRemainingMs <= 0) {
          abandoned = true;
          return Promise.resolve(DEADLINE);
        }
        return new Promise<typeof DEADLINE>((resolve) => {
          const timer = setTimeout(() => {
            // Latched here, synchronously, rather than after the race resumes
            // below. A provider continuation queued in the same tick as this
            // callback would otherwise run first and write an outcome from
            // after the mark.
            abandoned = true;
            // Ends the calls themselves, not just the wait for them. The
            // transport honors this signal, so up to ten abandoned requests
            // stop spending sockets under the stages that still have budget —
            // and a response that would otherwise land minutes later cannot
            // book its cost after the run's one cost line has been written.
            abortController.abort(
              new SourceError("TIMEOUT", "keyword SERP sampling deadline"),
            );
            resolve(DEADLINE);
          }, startRemainingMs);
          expire = () => {
            clearTimeout(timer);
          };
        });
      })();
      const poolCompletion = Promise.all(
        Array.from(
          { length: Math.min(KEYWORD_SERP_CONCURRENCY, plan.length) },
          () => worker(),
        ),
      );
      // Promise.race keeps its handlers attached after it settles. The extra
      // rejection handler also protects against a future runItem regression:
      // a stubborn worker may reject long after stageFailure won the race.
      void poolCompletion.catch(() => {});
      try {
        await Promise.race(
          stageDeadline === null
            ? [poolCompletion, stageFailure]
            : [poolCompletion, stageFailure, stageDeadline],
        );
      } finally {
        // `stageFailure` rejecting skips straight past a bare cleanup call,
        // leaving a timer alive for the rest of the budget on a warm process.
        expire();
      }
      // Read through a closure on purpose: the latch is written inside
      // `runItem`, which the outer control-flow analysis cannot see, so a
      // direct read here is still narrowed to its initializer and `.code`
      // below would not type-check. Inside a function body the declared type
      // applies.
      const stageFailed = ((): SourceError | null => stageError)();
      if (stageFailed !== null) {
        // The handler never receives the partial array on this path, so the
        // counts have to leave from here or they leave with nobody. Without
        // this line a provider-wide auth outage logs only the generic route
        // failure — no planned, no completed-before-failure, no way to see how
        // much was already spent when the stage died.
        console.error(
          JSON.stringify({
            tool: "keyword_opportunity",
            stage: "serp_sample",
            failureReason: stageFailed.code,
            planned: plan.length,
            dispatched: dispatched.filter(Boolean).length,
            complete: samples.filter((sample) => sample?.status === "complete")
              .length,
          }),
        );
        throw stageFailed;
      }
      // Two different unfinished facts, reported apart. A keyword that was
      // dispatched and has no outcome was asked and never answered before the
      // mark; one that was never dispatched was never asked, and saying the
      // provider failed it would send a reader to a status page for a call
      // that never happened.
      for (const item of plan) {
        samples[item.index] ??= unavailableSerpSample(
          item.keyword,
          dispatched[item.index]
            ? "transport_outcome_unknown"
            : "budget_exhausted",
        );
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
