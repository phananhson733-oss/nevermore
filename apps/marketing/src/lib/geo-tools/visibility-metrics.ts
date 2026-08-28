// @input  -- one frozen question set, every sample a run produced, and the site the run is about
// @output -- the run's proportions, its cited-domain table, per-question counts, and the manifest's success ratio and status
// @pos    -- where a pile of answers becomes numbers; every denominator this tool prints is chosen in this file

/**
 * Denominators, in one place.
 *
 * Three of them, and they are deliberately different:
 *
 * - Mention counts answered samples. An answer that never came back is not an
 *   answer that failed to mention the brand.
 * - Citation counts only answered samples where the model actually searched,
 *   and only for the wording that was measured to search. Folding a
 *   memory-written answer into that denominator is the difference between
 *   "nobody cites you" and "the model did not look".
 * - The question-level rate counts questions, not samples. Five samples of one
 *   question are not five independent observations, and pooling them is how
 *   seven questions clear the "n >= 35, safe to print 0.0%" bar.
 *
 * Nothing here formats a percentage or a sentence; the page renders these
 * through `describeProportion` and next-intl.
 */

import { geoCitationDomain, normalizeGeoHost } from "../agents/geo-url.ts";
import type { GeoKbCompetitor } from "./kb-contract.ts";
import type { GeoQuestion, GeoQuestionLayer } from "./kb-questions.ts";
import {
  benjaminiHochberg,
  changeVerdict,
  collapseGroupsToBernoulli,
  pooled,
  twoProportionP,
  wilson,
  MIN_TRIALS_FOR_TEST,
  type Proportion,
} from "./stats.ts";
import {
  VISIBILITY_MIN_SUCCESS_RATIO,
  type VisibilityCitedDomain,
  type VisibilityComparison,
  type VisibilityMetrics,
  type VisibilityProportion,
  type VisibilityQuestionResult,
  type VisibilityRunStatus,
  type VisibilitySample,
} from "./visibility-contract.ts";

/**
 * The order layers are printed in, fixed here rather than taken from the data.
 *
 * A table that reorders itself between two runs of the same frozen question set
 * reads as a change when nothing changed.
 */
const LAYER_ORDER: readonly GeoQuestionLayer[] = [
  "problem",
  "discovery",
  "comparison",
  "evaluation",
  "branded",
];

/** Example links kept per cited domain. Evidence, not a link dump. */
export const VISIBILITY_MAX_SAMPLE_URLS = 3;

/** The aggregate hypotheses the run-over-run view tests. */
export const VISIBILITY_COMPARED_METRICS = [
  "unpromptedMention",
  "citation",
  "questionsMentioned",
] as const;

export type VisibilityComparedMetric = (typeof VISIBILITY_COMPARED_METRICS)[number];

export interface VisibilityAggregateOptions {
  /** The site under test. Compared on exact canonical host, never by suffix. */
  readonly ownHost: string;
  /**
   * The frozen knowledge base's competitors.
   *
   * Taken whole rather than pre-filtered, so the "confirmed only" rule is
   * enforced here instead of in each caller: an unconfirmed brand name is not a
   * name, and labelling a domain as a rival on the strength of one is a claim
   * the knowledge base refused to make.
   */
  readonly competitors?: readonly GeoKbCompetitor[];
  /** What the run planned per question, which is what `successRatio` is measured against. */
  readonly samplesPerQuestion: number;
  /**
   * Engines that returned nothing at all for this run.
   *
   * Absent means every engine answered. A run that lost a whole engine can
   * still have a healthy success ratio among the engines that replied, and
   * reporting that as `ok` would hide half the surface.
   */
  readonly engineFailures?: readonly string[];
  /**
   * Citation URLs observed in the run, already normalized by
   * `normalizeGeoCitationUrl`. Only used to hang example links off the domain
   * table; the counts come from the samples.
   */
  readonly citationUrls?: readonly string[];
}

export interface VisibilityAggregate {
  readonly metrics: VisibilityMetrics;
  readonly citedDomains: readonly VisibilityCitedDomain[];
  readonly questions: readonly VisibilityQuestionResult[];
  /** Samples that came back, over the calls the run planned or made. */
  readonly successRatio: number;
  readonly answered: number;
  readonly calls: number;
  readonly status: VisibilityRunStatus;
}

/* ------------------------------------------------------------------ */
/* Sample predicates                                                   */
/* ------------------------------------------------------------------ */

function isAnswered(sample: VisibilitySample): boolean {
  return sample.status === "ok";
}

/**
 * Whether a citation was possible for this sample at all.
 *
 * `webSearchPerformed === true` and nothing looser: `null` is "the provider did
 * not say", which is not permission to assume it looked. The guard is also what
 * keeps `cited <= citationEvaluable`, and a provider that reports links beside
 * `webSearchPerformed: false` would otherwise push a successes count past its
 * trials count and make the Wilson interval throw.
 */
function isCitationEvaluable(sample: VisibilitySample): boolean {
  return isAnswered(sample) && sample.webSearchPerformed === true;
}

function stripLevel(proportion: Proportion): VisibilityProportion {
  return {
    successes: proportion.successes,
    trials: proportion.trials,
    point: proportion.point,
    lo: proportion.lo,
    hi: proportion.hi,
  };
}

/* ------------------------------------------------------------------ */
/* Per-question counts                                                 */
/* ------------------------------------------------------------------ */

function groupSamples(
  samples: readonly VisibilitySample[],
): ReadonlyMap<string, readonly VisibilitySample[]> {
  const byQuestion = new Map<string, VisibilitySample[]>();
  for (const sample of samples) {
    const bucket = byQuestion.get(sample.questionId);
    if (bucket === undefined) byQuestion.set(sample.questionId, [sample]);
    else bucket.push(sample);
  }
  // Concurrency decides arrival order, so the report would otherwise shuffle
  // its own evidence between two runs of the same question set.
  for (const bucket of byQuestion.values()) {
    bucket.sort((left, right) => left.sampleIndex - right.sampleIndex);
  }
  return byQuestion;
}

function questionResult(
  question: GeoQuestion,
  samples: readonly VisibilitySample[],
): VisibilityQuestionResult {
  let answered = 0;
  let mentioned = 0;
  let citationEvaluable = 0;
  let cited = 0;
  for (const sample of samples) {
    if (!isAnswered(sample)) continue;
    answered += 1;
    if (sample.mentioned) mentioned += 1;
    if (!isCitationEvaluable(sample)) continue;
    citationEvaluable += 1;
    if (sample.cited) cited += 1;
  }
  return {
    questionId: question.id,
    text: question.text,
    layer: question.layer,
    mode: question.mode,
    calibrated: question.calibrated,
    samples,
    answered,
    mentioned,
    // Raw counts, both of them: a demand-mode question's citations are worth
    // reporting beside its wording. What they are not allowed to do is enter a
    // rate, and that filter lives in `metricsFrom` where the rates are built.
    citationEvaluable,
    cited,
  };
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

interface CountPart {
  readonly successes: number;
  readonly trials: number;
}

const mentionPart = (result: VisibilityQuestionResult): CountPart => ({
  successes: result.mentioned,
  trials: result.answered,
});

const citationPart = (result: VisibilityQuestionResult): CountPart => ({
  successes: result.cited,
  trials: result.citationEvaluable,
});

const isRetrieval = (result: VisibilityQuestionResult): boolean =>
  result.mode === "retrieval";

/**
 * Branded questions are excluded from every discovery number.
 *
 * "Is <brand> a good choice?" names the brand in the question, so the model
 * repeating it back is not visibility - it is the question. Counting those two
 * questions would give a brand that is never found anywhere a non-zero
 * unprompted rate, which is the one number this tool exists to get right. Their
 * mentions are reported on their own line, `promptedMention`.
 *
 * This applies to `questionsMentioned` too. Each proportion carries the
 * denominator it was actually computed over, so the page prints "n of 40" and
 * never the size of the frozen set.
 */
const isUnprompted = (result: VisibilityQuestionResult): boolean =>
  result.layer !== "branded";

function metricsFrom(
  results: readonly VisibilityQuestionResult[],
): VisibilityMetrics {
  const unprompted = results.filter(isUnprompted);
  const branded = results.filter((result) => !isUnprompted(result));
  const questionLevel = collapseGroupsToBernoulli(unprompted.map(mentionPart));

  const byLayer = LAYER_ORDER.flatMap((layer) => {
    const inLayer = results.filter((result) => result.layer === layer);
    if (inLayer.length === 0) return [];
    return [
      {
        layer,
        mention: stripLevel(pooled(inLayer.map(mentionPart))),
        citation: stripLevel(
          pooled(inLayer.filter(isRetrieval).map(citationPart)),
        ),
      },
    ];
  });

  return {
    unpromptedMention: stripLevel(pooled(unprompted.map(mentionPart))),
    promptedMention: stripLevel(pooled(branded.map(mentionPart))),
    citation: stripLevel(pooled(results.filter(isRetrieval).map(citationPart))),
    questionsMentioned: stripLevel(
      wilson(questionLevel.successes, questionLevel.trials),
    ),
    byLayer,
  };
}

/* ------------------------------------------------------------------ */
/* Cited domains                                                       */
/* ------------------------------------------------------------------ */

function normalizedHostSet(values: readonly string[]): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const value of values) {
    const host = normalizeGeoHost(value);
    if (host !== null) hosts.add(host);
  }
  return hosts;
}

function groupCitationUrls(
  urls: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const byDomain = new Map<string, string[]>();
  for (const url of urls) {
    const domain = geoCitationDomain(url);
    if (domain === null) continue;
    const kept = byDomain.get(domain);
    if (kept === undefined) {
      byDomain.set(domain, [url]);
      continue;
    }
    if (kept.length >= VISIBILITY_MAX_SAMPLE_URLS || kept.includes(url)) continue;
    kept.push(url);
  }
  return byDomain;
}

/**
 * Which domains the answers pointed at, counted in answers.
 *
 * The unit is the answer, not the URL: a page that cites four articles from one
 * publisher is one answer's worth of evidence for that publisher, and counting
 * URLs would let a single verbose answer outrank a domain that appeared in
 * every run.
 *
 * Every answered sample contributes, including demand-mode ones. This table is
 * counts rather than a rate, so there is no denominator for an unmeasured
 * wording to contaminate.
 */
function citedDomainsFrom(
  samples: readonly VisibilitySample[],
  options: VisibilityAggregateOptions,
): readonly VisibilityCitedDomain[] {
  const ownHost = normalizeGeoHost(options.ownHost);
  const competitorHosts = normalizedHostSet(
    (options.competitors ?? [])
      .filter((entry) => entry.confirmed && entry.domain.length > 0)
      .map((entry) => entry.domain),
  );
  const urlsByDomain = groupCitationUrls(options.citationUrls ?? []);

  const answersByDomain = new Map<string, number>();
  for (const sample of samples) {
    if (!isAnswered(sample)) continue;
    // Deduplicated again here: the contract says a sample's domains are unique
    // within the answer, and this table would silently double-count a producer
    // that ever stopped being true.
    for (const domain of new Set(sample.citedDomains)) {
      answersByDomain.set(domain, (answersByDomain.get(domain) ?? 0) + 1);
    }
  }

  return [...answersByDomain.entries()]
    .map(([domain, answers]) => {
      const isOwn = ownHost !== null && domain === ownHost;
      return {
        domain,
        answers,
        isOwn,
        // A knowledge base that lists the customer's own domain as a rival is
        // wrong about one of the two; the site under test wins, because the
        // alternative prints your own pages as a competitor's.
        isCompetitor: !isOwn && competitorHosts.has(domain),
        sampleUrls: urlsByDomain.get(domain) ?? [],
      };
    })
    .sort((left, right) =>
      // Count first, then the domain itself. The tie-break is a plain code-unit
      // comparison rather than a locale one, because the same run must not
      // order its table differently for a reader in a different locale.
      right.answers !== left.answers
        ? right.answers - left.answers
        : left.domain < right.domain
          ? -1
          : left.domain > right.domain
            ? 1
            : 0,
    );
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export function aggregateVisibility(
  questions: readonly GeoQuestion[],
  samples: readonly VisibilitySample[],
  options: VisibilityAggregateOptions,
): VisibilityAggregate {
  if (
    !Number.isSafeInteger(options.samplesPerQuestion) ||
    options.samplesPerQuestion < 0
  ) {
    throw new RangeError(
      `samplesPerQuestion must be a non-negative integer, got ${options.samplesPerQuestion}`,
    );
  }

  const grouped = groupSamples(samples);
  const results = questions.map((question) =>
    questionResult(question, grouped.get(question.id) ?? []),
  );

  const answered = results.reduce((total, result) => total + result.answered, 0);
  const matched = results.reduce(
    (total, result) => total + result.samples.length,
    0,
  );
  const planned = questions.length * options.samplesPerQuestion;
  // Whichever is larger, so an attribution question sampled deeper than the
  // plan does not manufacture a success ratio above one, and a sample carrying
  // a question id that is not in the frozen set drags the ratio down instead of
  // vanishing. Losing samples to a mislabelled id should make a run look worse
  // than it was, never better.
  const calls = Math.max(planned, samples.length);
  const successRatio = calls === 0 ? 0 : answered / calls;

  const lostAnEngine = (options.engineFailures ?? []).length > 0;
  const status: VisibilityRunStatus =
    successRatio < VISIBILITY_MIN_SUCCESS_RATIO
      ? "insufficient"
      : lostAnEngine || matched < planned
        ? "partial"
        : "ok";

  return {
    metrics: metricsFrom(results),
    citedDomains: citedDomainsFrom(samples, options),
    questions: results,
    successRatio,
    answered,
    calls,
    status,
  };
}

/* ------------------------------------------------------------------ */
/* Run over run                                                        */
/* ------------------------------------------------------------------ */

/** Per-question counts as the stored run row keeps them: numbers, no answers. */
export interface VisibilityComparisonQuestion {
  readonly questionId: string;
  readonly text: string;
  readonly answered: number;
  readonly mentioned: number;
}

export interface VisibilityComparisonSide {
  readonly runId: string;
  readonly finishedAt: string;
  readonly metrics: VisibilityMetrics;
  readonly questions: readonly VisibilityComparisonQuestion[];
}

/**
 * Whether two runs of the same frozen question set differ.
 *
 * Three aggregate hypotheses go through Benjamini-Hochberg together, and only
 * the testable ones enter it: padding the set with hypotheses whose p value is
 * a fixed 1 (the floor's return value) inflates m and quietly costs the real
 * ones their power.
 *
 * Per question the answer is a direction and nothing more. One question at five
 * samples cannot support a significance claim, and the run-level correction is
 * what stops forty of them from producing four "improvements" out of noise.
 */
export function compareVisibility(
  base: VisibilityComparisonSide,
  current: VisibilityComparisonSide,
): VisibilityComparison {
  const pairs = VISIBILITY_COMPARED_METRICS.map((metric) => ({
    metric,
    base: base.metrics[metric],
    current: current.metrics[metric],
  }));

  const testable = pairs.map(
    (pair) =>
      pair.base.trials >= MIN_TRIALS_FOR_TEST &&
      pair.current.trials >= MIN_TRIALS_FOR_TEST,
  );
  const testedPValues = pairs
    .filter((_, index) => testable[index] === true)
    .map((pair) =>
      twoProportionP(
        pair.base.successes,
        pair.base.trials,
        pair.current.successes,
        pair.current.trials,
      ),
    );
  const rejections = benjaminiHochberg(testedPValues);

  let testedIndex = 0;
  const aggregates = pairs.map((pair, index) => {
    const rejected =
      testable[index] === true ? (rejections[testedIndex++] ?? false) : false;
    const verdict = changeVerdict(
      {
        baseSuccesses: pair.base.successes,
        baseTrials: pair.base.trials,
        currentSuccesses: pair.current.successes,
        currentTrials: pair.current.trials,
      },
      rejected,
    );
    return {
      metric: pair.metric,
      base: pair.base,
      current: pair.current,
      diff: verdict.diff,
      lo: verdict.lo,
      hi: verdict.hi,
      changed: verdict.changed,
      testable: verdict.testable,
    };
  });

  const baseById = new Map(
    base.questions.map((question) => [question.questionId, question] as const),
  );
  const questions = current.questions.flatMap((question) => {
    const before = baseById.get(question.questionId);
    if (before === undefined) return [];
    // Counts are only comparable over the same denominator. "3 of 5" against
    // "2 of 3" is a higher rate reported as a loss, so a question whose sample
    // count moved between runs is left out rather than pointed the wrong way.
    if (before.answered !== question.answered || question.answered === 0) {
      return [];
    }
    if (before.mentioned === question.mentioned) return [];
    return [
      {
        questionId: question.questionId,
        text: question.text,
        baseMentioned: before.mentioned,
        currentMentioned: question.mentioned,
        of: question.answered,
        direction:
          question.mentioned > before.mentioned
            ? ("gained" as const)
            : ("lost" as const),
      },
    ];
  });

  return {
    baseRunId: base.runId,
    baseFinishedAt: base.finishedAt,
    aggregates,
    questions,
  };
}
