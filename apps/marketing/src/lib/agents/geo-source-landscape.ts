// @input  -- one contract-valid v3 report, and nothing else
// @output -- who the answers actually cited, counted against the same denominators
// @pos    -- the aggregate view of evidence the per-question list cannot show

import type { GeoQueryMode } from "./geo-query-contract.ts";
import type {
  GeoQuestionObservationV3,
  GeoReportDataV3,
} from "./geo-report-contract.ts";
import { isGeoSampleCitationEvaluable } from "./geo-report-derive.ts";

/**
 * One cited host, counted twice over.
 *
 * Both numbers matter and they answer different questions. `citedInSamples`
 * says how reliably a host shows up when the assistant answers; `citedInQuestions`
 * says how much of the buyer's decision it covers. A host cited three times in
 * one question is not the same finding as a host cited once in three questions,
 * and a single count would hide which one happened.
 */
export interface GeoCitedSourceV1 {
  readonly domain: string;
  readonly citedInSamples: number;
  readonly citedInQuestions: number;
  /** True only for the customer's own host, recomputed from the evidence. */
  readonly isTarget: boolean;
  /** Distinct URLs on this host, in first-observed order, for the reader to open. */
  readonly urls: readonly string[];
}

/** One mode's sources, counted only against that mode's own denominator. */
export interface GeoModeSourcesV1 {
  readonly sources: readonly GeoCitedSourceV1[];
  /** The denominator both per-source counts are read against. */
  readonly citationEvaluableSamples: number;
  /** Questions that had at least one citation-evaluable sample. */
  readonly citationEvaluableQuestions: number;
  /** Distinct hosts cited in this mode, including the customer's own. */
  readonly distinctDomains: number;
  /**
   * Whether the customer's host appears among this mode's cited sources.
   *
   * `null`, not `false`, when this mode produced no countable sample at all.
   * Fifteen retrieval calls that never searched cannot establish that the site
   * was absent; writing `false` there is the oldest mistake this report exists
   * to refuse, and it reached the exported brief before cross-model review
   * caught it on 2026-08-19.
   */
  readonly targetObserved: boolean | null;
}

/**
 * What the run observed about sources, as counts and nothing else.
 *
 * Split by mode, and never totalled. A retrieval probe is asked three times and
 * a natural-demand question once, so a blended count would treat one repeat of a
 * calibrated probe as interchangeable with a whole one-shot question — the
 * shared denominator the coverage block above this table exists to refuse, and
 * the ordering would inherit the same distortion.
 *
 * Deliberately carries no classification of what any host *is*. A URL does not
 * say whether a page is a review, a marketplace, a community thread or a vendor's
 * own marketing, and the sampler already refuses to guess that for exactly this
 * reason — putting a made-up label on the most-read line of the report is worse
 * than leaving the reader to open the link.
 */
export interface GeoSourceLandscapeV1 {
  readonly byMode: Readonly<Record<GeoQueryMode, GeoModeSourcesV1>>;
}

interface Accumulator {
  domain: string;
  samples: Set<string>;
  questions: Set<string>;
  isTarget: boolean;
  urls: string[];
}

/** Returns how many of this question's samples were countable, not merely whether any were. */
function accumulate(
  question: GeoQuestionObservationV3,
  into: Map<string, Accumulator>,
): number {
  let evaluable = 0;
  for (const sample of question.samples) {
    // The same rule the coverage block counts by, imported rather than
    // re-expressed: a landscape built on a wider denominator than the numbers
    // above it would quietly disagree with them.
    if (!isGeoSampleCitationEvaluable(sample, question.mode)) continue;
    evaluable += 1;
    for (const entry of sample.evidence) {
      if (entry.kind !== "cited") continue;
      const existing = into.get(entry.domain);
      const acc: Accumulator = existing ?? {
        domain: entry.domain,
        samples: new Set<string>(),
        questions: new Set<string>(),
        isTarget: false,
        urls: [],
      };
      acc.samples.add(sample.sampleId);
      acc.questions.add(question.queryId);
      if (entry.ownership === "target") acc.isTarget = true;
      if (!acc.urls.includes(entry.exactUrl)) acc.urls.push(entry.exactUrl);
      if (existing === undefined) into.set(entry.domain, acc);
    }
  }
  return evaluable;
}

/**
 * Aggregate the evidence the per-question list already shows.
 *
 * Every number here is a count of records already rendered further up the page,
 * so this view can be read beside them without a second denominator to reconcile.
 * Sorted by sample reach, then question reach, then host, so two runs of the same
 * report produce the same order.
 */
function modeSources(
  questions: readonly GeoQuestionObservationV3[],
): GeoModeSourcesV1 {
  const into = new Map<string, Accumulator>();
  let citationEvaluableSamples = 0;
  let citationEvaluableQuestions = 0;

  for (const question of questions) {
    // One pass, one number. Counting the denominator in a second loop beside
    // the accumulator was two implementations of "which samples count", and the
    // per-question digest would have made it three.
    const evaluable = accumulate(question, into);
    citationEvaluableSamples += evaluable;
    if (evaluable > 0) citationEvaluableQuestions += 1;
  }

  const sources = [...into.values()]
    .map(
      (acc): GeoCitedSourceV1 => ({
        domain: acc.domain,
        citedInSamples: acc.samples.size,
        citedInQuestions: acc.questions.size,
        isTarget: acc.isTarget,
        urls: [...acc.urls],
      }),
    )
    .sort(
      (a, b) =>
        b.citedInSamples - a.citedInSamples ||
        b.citedInQuestions - a.citedInQuestions ||
        a.domain.localeCompare(b.domain),
    );

  return {
    sources,
    citationEvaluableSamples,
    citationEvaluableQuestions,
    distinctDomains: sources.length,
    targetObserved:
      citationEvaluableSamples === 0
        ? null
        : sources.some((source) => source.isTarget),
  };
}

/** One question's cited hosts, counted against that question's own samples. */
export interface GeoQuestionSourcesV1 {
  readonly queryId: string;
  readonly citationEvaluableSamples: number;
  readonly sources: readonly {
    readonly domain: string;
    readonly citedInSamples: number;
    readonly isTarget: boolean;
  }[];
}

/**
 * The same counting, narrowed to one question.
 *
 * The exported brief needs a per-question host digest, and deriving it there
 * would be a third place that decides which samples count. It goes through
 * {@link isGeoSampleCitationEvaluable} like everything else, so a question's
 * host list can never rest on a wider set of samples than the ratio printed
 * beside it.
 */
export function deriveGeoQuestionSources(
  question: GeoQuestionObservationV3,
): GeoQuestionSourcesV1 {
  const into = new Map<string, Accumulator>();
  const evaluable = accumulate(question, into);
  return {
    queryId: question.queryId,
    citationEvaluableSamples: evaluable,
    sources: [...into.values()]
      .map((acc) => ({
        domain: acc.domain,
        citedInSamples: acc.samples.size,
        isTarget: acc.isTarget,
      }))
      .sort(
        (a, b) =>
          b.citedInSamples - a.citedInSamples ||
          a.domain.localeCompare(b.domain),
      ),
  };
}

/**
 * Aggregate the evidence the per-question list already shows.
 *
 * Every number here is a count of records already rendered further up the page,
 * so this view can be read beside them without a second denominator to reconcile.
 * Sorted by sample reach, then question reach, then host, so two runs of the same
 * report produce the same order.
 */
export function deriveGeoSourceLandscape(
  report: GeoReportDataV3,
): GeoSourceLandscapeV1 {
  const of = (mode: GeoQueryMode): GeoModeSourcesV1 =>
    modeSources(report.questions.filter((question) => question.mode === mode));
  return {
    byMode: {
      retrieval_probe: of("retrieval_probe"),
      natural_demand: of("natural_demand"),
    },
  };
}
