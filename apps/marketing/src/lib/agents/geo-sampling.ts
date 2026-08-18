// @input  -- confirmed questions, the target site, competitor domains, and a clock
// @output -- three classified samples per question with a recomputed aggregate
// @pos    -- the only place a provider answer becomes a reportable observation

import {
  geoQuestionVerdict,
  normalizeReportHost,
  GEO_ADMISSIBLE_SAMPLE_STATES,
  GEO_MAX_CITED_HOSTS_PER_SAMPLE,
  GEO_SAMPLES_PER_QUESTION,
  type GeoQuestionObservation,
  type GeoSampleLimitation,
  type GeoSample,
  type GeoSampleState,
} from "./geo-report-contract.ts";

import {
  GeoProviderError,
  type GeoProviderClient,
  type GeoProviderObservation,
} from "./geo-provider.ts";

const ADMISSIBLE_STATES = new Set<GeoSampleState>(GEO_ADMISSIBLE_SAMPLE_STATES);

/**
 * How many provider calls may be in flight at once.
 *
 * Eight was measured, not guessed: a calibration that issued eight concurrent
 * calls finished in 28.5s, equal to its own slowest single call, with no sign
 * of throttling. Higher concurrency was never tested, and the failure mode of
 * guessing high is a 429 on a run the visitor has already paid for.
 */
export const GEO_MAX_CONCURRENCY = 8;

/** Shortest brand label worth matching; below this it collides with real words. */
const MIN_BRAND_TOKEN_LENGTH = 3;

/**
 * Reduce text to lowercase words separated by single spaces.
 *
 * Punctuation becomes a separator rather than being deleted, so "Acme's" still
 * matches the token "acme" while "AcmeCorp" does not: deleting punctuation
 * instead would collapse both into one word and make every brand a substring
 * match of every longer name containing it.
 */
function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether the answer named the brand.
 *
 * Whole-word only. A brand is "mentioned" when a reader would see its name,
 * and a substring buried inside an unrelated word is not that.
 */
export function mentionsBrand(
  answerText: string,
  brandTokens: readonly string[],
): boolean {
  const haystack = ` ${normalizeForMatch(answerText)} `;
  return brandTokens.some((token) => {
    const needle = normalizeForMatch(token);
    return (
      needle.length >= MIN_BRAND_TOKEN_LENGTH &&
      haystack.includes(` ${needle} `)
    );
  });
}

/**
 * Reduce a citation URL to the host the report compares on.
 *
 * Delegates to the contract's own normalizer rather than repeating it: a
 * second copy here is what made a doubled `www.` or a trailing root dot
 * produce a host the guard then refused, turning 24 billed answers into a 502.
 */
export { normalizeReportHost as normalizeCitedHost } from "./geo-report-contract.ts";

export interface GeoSamplingContext {
  /** Normalized host of the site under test. */
  readonly targetHost: string;
  /** Names the answer might use for the site; matched whole-word. */
  readonly brandTokens: readonly string[];
  /** Normalized competitor hosts, used only to label what was cited. */
  readonly competitorHosts: readonly string[];
}

/**
 * Turn one provider answer into one reportable sample.
 *
 * The order of these branches is the report's definition of its own states:
 * a run that searched and cited the site is `cited` whether or not the prose
 * also named it, because a citation is the stronger claim.
 */
export function classifyObservation(
  sampleIndex: number,
  observation: GeoProviderObservation,
  context: GeoSamplingContext,
): GeoSample {
  // Truncated to the number the guard accepts. Without this an unusually wide
  // answer — calibration saw one cite 14 hosts — makes the guard refuse the
  // whole envelope, and 24 already-billed answers are discarded over a length.
  const citedHosts = [
    ...new Set(
      observation.citedUrls
        .map((url) => normalizeReportHost(url))
        .filter((host): host is string => host !== null),
    ),
  ].slice(0, GEO_MAX_CITED_HOSTS_PER_SAMPLE);
  const competitors = new Set(context.competitorHosts);
  const competitorHosts = citedHosts.filter((host) => competitors.has(host));

  const state = ((): GeoSampleState => {
    if (!observation.webSearchPerformed) return "search_not_performed";
    if (citedHosts.length === 0) return "answer_had_no_citations";
    if (citedHosts.includes(context.targetHost)) return "cited";
    return mentionsBrand(observation.answerText, context.brandTokens)
      ? "mentioned"
      : "cited_others_only";
  })();

  // A sample that did not search carries no citation claim, so its host lists
  // are dropped rather than reported as an observation about citations.
  const searched = state !== "search_not_performed";
  return {
    sampleIndex,
    state,
    observedAt: observation.observedAt,
    webSearchPerformed: observation.webSearchPerformed,
    citedHosts: searched ? citedHosts : [],
    competitorHosts: searched ? competitorHosts : [],
    limitation: null,
  };
}

/** The sample recorded when a call never produced an answer. */
export function unavailableSample(
  sampleIndex: number,
  limitation: GeoSampleLimitation,
): GeoSample {
  return {
    sampleIndex,
    state: "unavailable",
    observedAt: null,
    webSearchPerformed: false,
    citedHosts: [],
    competitorHosts: [],
    limitation,
  };
}

/**
 * Recompute a question's aggregate from its samples.
 *
 * Never accepts counts from elsewhere: the contract guard recomputes the same
 * numbers, and two places deriving them independently is how they drift.
 */
export function aggregateSamples(
  questionId: string,
  question: string,
  samples: readonly GeoSample[],
): GeoQuestionObservation {
  const ordered = [...samples].sort((a, b) => a.sampleIndex - b.sampleIndex);
  // The contract's own allowlist, not a local "everything except these two"
  // rule. A denylist written here would silently admit any state added later,
  // and the guard — which uses the allowlist — would then reject the run.
  const admissibleSamples = ordered.filter((sample) =>
    ADMISSIBLE_STATES.has(sample.state),
  ).length;
  const targetCitedIn = ordered.filter(
    (sample) => sample.state === "cited",
  ).length;
  return {
    questionId,
    question,
    samples: ordered,
    aggregate: {
      admissibleSamples,
      targetCitedIn,
      targetMentionedIn: ordered.filter((s) => s.state === "mentioned").length,
      verdict: geoQuestionVerdict({
        totalSamples: ordered.length,
        admissibleSamples,
        targetCitedIn,
        searchNotPerformed: ordered.filter(
          (sample) => sample.state === "search_not_performed",
        ).length,
      }),
    },
  };
}

export interface GeoQuestionInput {
  readonly questionId: string;
  readonly question: string;
}

export interface GeoCollectionDependencies {
  readonly provider: GeoProviderClient;
  readonly model: string;
  readonly marketCode: string;
  /** Milliseconds left for provider work; consulted before each call. */
  readonly remainingMs: () => number;
  /**
   * Reserve spend for one call, or refuse it.
   *
   * Reserved before the call rather than checked after it, because these run
   * concurrently: a check against settled spend alone would admit every
   * in-flight call while the total still read zero.
   */
  readonly admitCall: () => boolean;
  /** Settle the reservation with what the call actually cost. */
  readonly settleCall: (costUsd: number | null) => void;
}

/**
 * Least time that must remain before another paid call is started.
 *
 * A call begun with less than this cannot finish inside the budget, so issuing
 * it would spend money on an answer the response has no room to carry.
 */
export const GEO_MIN_BUDGET_FOR_CALL_MS = 45_000;

interface PendingCall {
  readonly questionIndex: number;
  readonly sampleIndex: number;
}

/**
 * Run every question's samples and return one observation per question.
 *
 * Calls are drawn from a single shared queue rather than issued in per-question
 * batches: measured latency ranged from 24s to 44s, and batching would make
 * every batch cost its slowest member.
 */
export async function collectGeoSamples(
  questions: readonly GeoQuestionInput[],
  context: GeoSamplingContext,
  dependencies: GeoCollectionDependencies,
): Promise<readonly GeoQuestionObservation[]> {
  const pending: PendingCall[] = [];
  for (let q = 0; q < questions.length; q += 1) {
    for (let s = 1; s <= GEO_SAMPLES_PER_QUESTION; s += 1) {
      pending.push({ questionIndex: q, sampleIndex: s });
    }
  }

  const collected: GeoSample[][] = questions.map(() => []);
  let cursor = 0;

  const run = async (): Promise<void> => {
    for (;;) {
      const next = pending[cursor];
      if (next === undefined) return;
      cursor += 1;

      const question = questions[next.questionIndex];
      if (question === undefined) continue;

      // The clock is checked before the ceiling so a run that ran out of time
      // does not hold a reservation it will never spend.
      if (dependencies.remainingMs() < GEO_MIN_BUDGET_FOR_CALL_MS) {
        collected[next.questionIndex]?.push(
          unavailableSample(next.sampleIndex, "time_budget"),
        );
        continue;
      }
      if (!dependencies.admitCall()) {
        collected[next.questionIndex]?.push(
          unavailableSample(next.sampleIndex, "cost_ceiling"),
        );
        continue;
      }

      try {
        const observation = await dependencies.provider.observe({
          prompt: question.question,
          model: dependencies.model,
          marketCode: dependencies.marketCode,
        });
        dependencies.settleCall(observation.costUsd);
        collected[next.questionIndex]?.push(
          classifyObservation(next.sampleIndex, observation, context),
        );
      } catch (error) {
        // A provider failure is still billed on some paths, so the reservation
        // is settled with whatever it cost before the sample is recorded.
        if (error instanceof GeoProviderError) {
          dependencies.settleCall(error.costUsd);
          collected[next.questionIndex]?.push(
            unavailableSample(next.sampleIndex, providerLimitation(error)),
          );
          continue;
        }
        dependencies.settleCall(null);
        collected[next.questionIndex]?.push(
          unavailableSample(next.sampleIndex, "provider_failed"),
        );
      }
    }
  };

  const lanes = Math.min(GEO_MAX_CONCURRENCY, pending.length);
  await Promise.all(Array.from({ length: lanes }, () => run()));

  return questions.map((question, index) =>
    aggregateSamples(
      question.questionId,
      question.question,
      collected[index] ?? [],
    ),
  );
}

/**
 * The failure class as a renderable code, never the provider's own message,
 * which may quote a third party's text.
 */
function providerLimitation(error: GeoProviderError): GeoSampleLimitation {
  switch (error.reason) {
    case "not_configured":
      return "provider_not_configured";
    case "timeout":
      return "provider_timeout";
    case "rate_limited":
      return "provider_rate_limited";
    case "auth_failed":
      return "provider_auth_failed";
    case "invalid_response":
      return "provider_no_answer";
    default:
      return "provider_failed";
  }
}
