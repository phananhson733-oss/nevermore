// @input  -- the samples a run produced, nothing else
// @output -- every denominator the report shows, derived once
// @pos    -- the single counting rule the producer and the strict guard both call

import { geoDomainHash, type GeoCanonicalValue } from "./geo-canonical.ts";
import type {
  GeoMentionEligibility,
  GeoQuestionObservationV3,
  GeoRunLimitationCode,
  GeoSampleV3,
  GeoSurfaceProvenanceV1,
} from "./geo-report-contract.ts";
import type { GeoProbeStatus } from "./geo-report-contract.ts";
import type { GeoQueryMode } from "./geo-query-contract.ts";

/** Hash domain for the report content fingerprint. */
const GEO_REPORT_CONTENT_HASH_DOMAIN = "geo_report_content.v1";

/**
 * Why there is exactly one counting function.
 *
 * The counts are the report's headline claim, and a paid run has already been
 * lost once to two implementations of them disagreeing: the sampler emitted a
 * number its own guard then refused, and twenty-four billed answers became a
 * 502. So the producer does not compute counts and the guard does not check
 * them against a second algorithm — both call this, and the guard's job is only
 * to prove the payload's numbers are the ones this function produces.
 */

export interface GeoObservationCounts {
  /** One record per planned call, successful or not. */
  readonly scheduledSamples: number;
  readonly answeredSamples: number;
  readonly unavailableSamples: number;
  /**
   * Samples that can speak to whether a search ran.
   *
   * Without it `searchPerformedSamples` has no honest denominator: a run where
   * six of eighteen calls failed would otherwise report "5 searched of 18",
   * quietly counting twelve calls that never had the chance.
   */
  readonly searchEvaluableSamples: number;
  readonly searchPerformedSamples: number;
  /**
   * Samples whose annotations were readable AND whose probe was working.
   *
   * A retrieval probe that did not search is an instrumentation failure, not an
   * observation about the customer, so its samples are excluded here rather
   * than counted as "we looked and you were not cited".
   */
  readonly citationEvaluableSamples: number;
  readonly targetCitedIn: number;
  readonly mentionEvaluableSamples: number;
  readonly targetMentionedIn: number;
}

/**
 * The three facts that are safe to state about the whole run.
 *
 * Mode-agnostic on purpose: how many calls were planned, how many produced an
 * answer, and how many did not are true of the run as a whole and mean the same
 * thing for every question. Every other number lives in a stratum, because a
 * run-level `targetMentionedIn` would blend three prompted repetitions with one
 * unprompted discovery, and a run-level `searchPerformedSamples` would report
 * 15 of 18 when the honest reading is 15 of 15 retrieval calls and 0 of 3
 * natural ones. Publishing a blended number invites the misuse whether or not
 * the correct strata sit beside it.
 */
export interface GeoRunTotals {
  readonly scheduledSamples: number;
  readonly answeredSamples: number;
  readonly unavailableSamples: number;
}

export interface GeoSearchCounts {
  readonly searchEvaluableSamples: number;
  readonly searchPerformedSamples: number;
}

export interface GeoCitationCounts {
  readonly citationEvaluableSamples: number;
  readonly targetCitedIn: number;
}

export interface GeoMentionCounts {
  readonly mentionEvaluableSamples: number;
  readonly targetMentionedIn: number;
}

export interface GeoRunCoverageV3 {
  readonly totals: GeoRunTotals;
  /** Retrieval and natural demand never share a search denominator. */
  readonly search: Readonly<Record<GeoQueryMode, GeoSearchCounts>>;
  /** Nor a citation denominator. */
  readonly citation: Readonly<Record<GeoQueryMode, GeoCitationCounts>>;
  /** A prompted mention is tautology; it never joins an unprompted count. */
  readonly mention: Readonly<
    Record<GeoMentionEligibility, GeoMentionCounts>
  >;
  readonly validProbes: number;
  readonly triggerFailedProbes: number;
  readonly degradedProbes: number;
  readonly failedProbes: number;
}

const EMPTY: GeoObservationCounts = {
  scheduledSamples: 0,
  answeredSamples: 0,
  unavailableSamples: 0,
  searchEvaluableSamples: 0,
  searchPerformedSamples: 0,
  citationEvaluableSamples: 0,
  targetCitedIn: 0,
  mentionEvaluableSamples: 0,
  targetMentionedIn: 0,
};

/**
 * What a retrieval probe's own samples say about its instrumentation.
 *
 * Lives here, with the counting, because the counts depend on it and because a
 * verdict read out of the payload is a verdict a payload can lie about. Judged
 * over the samples that can speak to it: a probe whose calls all failed says
 * nothing about triggering, one whose answers all searched is `valid`, one
 * whose answers never searched is an instrumentation failure, and the mixed
 * case is its own verdict rather than being rounded to either.
 */
export function deriveProbeStatus(
  samples: readonly GeoSampleV3[],
): GeoProbeStatus {
  // Only the samples that can speak to search execution. An answered sample
  // whose search flag is unavailable is not an answer that "did not search",
  // and rounding it that way would put unavailable back where zero used to be —
  // this time inside the verdict that decides the degraded banner.
  const evaluable = samples.filter(
    (sample) =>
      sample.answerStatus === "answered" && sample.webSearchPerformed !== null,
  );
  if (evaluable.length === 0) return "provider_failed";
  const searched = evaluable.filter(
    (sample) => sample.webSearchPerformed === true,
  ).length;
  if (searched === evaluable.length) return "valid";
  if (searched === 0) return "trigger_failed";
  return "degraded_mixed_trigger";
}

/**
 * Whether this sample's citation reading may be counted, given its mode.
 *
 * Exported because the handoff packet labels each exported sample with the same
 * fact, and a second copy of this rule is how the packet and the report come to
 * disagree about which sample a ratio rests on.
 */
export function isGeoSampleCitationEvaluable(
  sample: GeoSampleV3,
  mode: GeoQueryMode,
): boolean {
  if (sample.answerStatus !== "answered") return false;
  if (sample.citationStatus === "unavailable") return false;
  return mode !== "retrieval_probe" || sample.webSearchPerformed === true;
}

/**
 * Whether this sample's citation reading may be counted.
 *
 * Three exclusions, each meaning "this run cannot say":
 *
 * - the call produced no usable answer, so there was nothing to inspect;
 * - the annotation list could not be read in full;
 * - it is a retrieval-probe sample that did not actually search. The wording
 *   was measured to reach the live web, so a sample that stayed in the model's
 *   weights is an instrumentation failure. Judged per sample rather than per
 *   probe: a `degraded_mixed_trigger` probe's two unsearched calls must not
 *   enter the denominator merely because its third call worked.
 *
 * None of the three is a fact about the customer's site.
 */
function isCitationEvaluable(sample: GeoSampleV3): boolean {
  // The mode is carried in, not inferred from `probeStatus`. Inferring it meant
  // a payload could clear the probe status and have a retrieval sample counted
  // as a natural-demand one, which is the difference between an instrumentation
  // failure and a fact about the customer.
  return isGeoSampleCitationEvaluable(
    sample,
    sample.probeStatus === null ? "natural_demand" : "retrieval_probe",
  );
}

export function deriveGeoSampleCounts(
  samples: readonly GeoSampleV3[],
): GeoObservationCounts {
  let counts = { ...EMPTY, scheduledSamples: samples.length };

  for (const sample of samples) {
    const answered = sample.answerStatus === "answered";
    const citationEvaluable = isCitationEvaluable(sample);
    // Gated on an answered call as well as on the matcher: a failed call has no
    // prose to look for a brand in, and counting it would put a fabricated
    // observation into the mention denominator.
    const mentionEvaluable =
      answered && sample.mentionStatus !== "unavailable";

    counts = {
      scheduledSamples: counts.scheduledSamples,
      answeredSamples: counts.answeredSamples + (answered ? 1 : 0),
      unavailableSamples: counts.unavailableSamples + (answered ? 0 : 1),
      searchEvaluableSamples:
        counts.searchEvaluableSamples +
        (answered && sample.webSearchPerformed !== null ? 1 : 0),
      searchPerformedSamples:
        counts.searchPerformedSamples +
        (answered && sample.webSearchPerformed === true ? 1 : 0),
      citationEvaluableSamples:
        counts.citationEvaluableSamples + (citationEvaluable ? 1 : 0),
      targetCitedIn:
        counts.targetCitedIn +
        (citationEvaluable && sample.citationStatus === "observed_target"
          ? 1
          : 0),
      mentionEvaluableSamples:
        counts.mentionEvaluableSamples + (mentionEvaluable ? 1 : 0),
      targetMentionedIn:
        counts.targetMentionedIn +
        (mentionEvaluable && sample.mentionStatus === "observed" ? 1 : 0),
    };
  }

  return counts;
}

function samplesOf(
  questions: readonly GeoQuestionObservationV3[],
  keep: (question: GeoQuestionObservationV3, sample: GeoSampleV3) => boolean,
): readonly GeoSampleV3[] {
  return questions.flatMap((question) =>
    question.samples.filter((sample) => keep(question, sample)),
  );
}

function searchCountsOf(
  samples: readonly GeoSampleV3[],
): GeoSearchCounts {
  const counts = deriveGeoSampleCounts(samples);
  return {
    searchEvaluableSamples: counts.searchEvaluableSamples,
    searchPerformedSamples: counts.searchPerformedSamples,
  };
}

function citationCountsOf(
  samples: readonly GeoSampleV3[],
): GeoCitationCounts {
  const counts = deriveGeoSampleCounts(samples);
  return {
    citationEvaluableSamples: counts.citationEvaluableSamples,
    targetCitedIn: counts.targetCitedIn,
  };
}

function mentionCountsOf(
  samples: readonly GeoSampleV3[],
): GeoMentionCounts {
  const counts = deriveGeoSampleCounts(samples);
  return {
    mentionEvaluableSamples: counts.mentionEvaluableSamples,
    targetMentionedIn: counts.targetMentionedIn,
  };
}

export function deriveGeoRunCoverage(
  questions: readonly GeoQuestionObservationV3[],
): GeoRunCoverageV3 {
  const all = questions.flatMap((question) => question.samples);
  const totals = deriveGeoSampleCounts(all);
  const probes = questions.filter(
    (question) => question.mode === "retrieval_probe",
  );
  // Recomputed from the samples rather than read off the payload: a verdict a
  // client supplies is a verdict a client can invent, and this one decides both
  // the degraded banner and which samples enter the citation denominator.
  const verdict = (question: GeoQuestionObservationV3): string =>
    deriveProbeStatus(question.samples);
  const byMode = (mode: GeoQueryMode): readonly GeoSampleV3[] =>
    samplesOf(questions, (question) => question.mode === mode);
  const byEligibility = (
    eligibility: GeoMentionEligibility,
  ): readonly GeoSampleV3[] =>
    samplesOf(
      questions,
      (_question, sample) => sample.mentionEligibility === eligibility,
    );

  return {
    totals: {
      scheduledSamples: totals.scheduledSamples,
      answeredSamples: totals.answeredSamples,
      unavailableSamples: totals.unavailableSamples,
    },
    search: {
      natural_demand: searchCountsOf(byMode("natural_demand")),
      retrieval_probe: searchCountsOf(byMode("retrieval_probe")),
    },
    citation: {
      natural_demand: citationCountsOf(byMode("natural_demand")),
      retrieval_probe: citationCountsOf(byMode("retrieval_probe")),
    },
    mention: {
      unprompted: mentionCountsOf(byEligibility("unprompted")),
      prompted: mentionCountsOf(byEligibility("prompted")),
    },
    validProbes: probes.filter((question) => verdict(question) === "valid")
      .length,
    triggerFailedProbes: probes.filter(
      (question) => verdict(question) === "trigger_failed",
    ).length,
    degradedProbes: probes.filter(
      (question) => verdict(question) === "degraded_mixed_trigger",
    ).length,
    failedProbes: probes.filter(
      (question) => verdict(question) === "provider_failed",
    ).length,
  };
}

const COUNT_KEYS = [
  "scheduledSamples",
  "answeredSamples",
  "unavailableSamples",
  "searchEvaluableSamples",
  "searchPerformedSamples",
  "citationEvaluableSamples",
  "targetCitedIn",
  "mentionEvaluableSamples",
  "targetMentionedIn",
] as const;

function isCountsShape(value: unknown): value is GeoObservationCounts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === COUNT_KEYS.length &&
    COUNT_KEYS.every(
      (key) =>
        Object.hasOwn(record, key) &&
        Number.isSafeInteger(record[key]) &&
        (record[key] as number) >= 0,
    )
  );
}

function equalCounts(
  value: unknown,
  expected: GeoObservationCounts,
): value is GeoObservationCounts {
  if (!isCountsShape(value)) return false;
  const record = value as unknown as Record<string, number>;
  const wanted = expected as unknown as Record<string, number>;
  return COUNT_KEYS.every((key) => record[key] === wanted[key]);
}

/**
 * Whether a payload's per-question counts are the ones the samples produce.
 *
 * Also enforces the relationships the numbers must satisfy. They are checked
 * rather than assumed because a payload can be hand-edited, and because a
 * denominator smaller than its numerator is exactly the shape of an
 * accidentally impressive report.
 */
export function isSameGeoCounts(
  value: unknown,
  samples: readonly GeoSampleV3[],
): boolean {
  const expected = deriveGeoSampleCounts(samples);
  if (!equalCounts(value, expected)) return false;
  return (
    expected.answeredSamples + expected.unavailableSamples ===
      expected.scheduledSamples &&
    expected.targetCitedIn <= expected.citationEvaluableSamples &&
    expected.targetMentionedIn <= expected.mentionEvaluableSamples &&
    expected.searchPerformedSamples <= expected.searchEvaluableSamples &&
    expected.citationEvaluableSamples <= expected.scheduledSamples &&
    expected.mentionEvaluableSamples <= expected.scheduledSamples
  );
}

/**
 * Whether a payload's coverage block is the one these questions produce.
 *
 * Compared field by field rather than by serializing both sides: a wire payload
 * carries whatever key order the producer happened to write, and a report that
 * failed to render because two identical objects stringified differently would
 * be the same class of bug this module exists to prevent.
 */
function equalShape(value: unknown, expected: object): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const wanted = expected as Record<string, unknown>;
  const keys = Object.keys(wanted);
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => record[key] === wanted[key])
  );
}

export function isSameGeoCoverage(
  value: unknown,
  questions: readonly GeoQuestionObservationV3[],
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const expected = deriveGeoRunCoverage(questions);
  const topKeys = [
    "totals",
    "search",
    "citation",
    "mention",
    "validProbes",
    "triggerFailedProbes",
    "degradedProbes",
    "failedProbes",
  ];
  if (
    Object.keys(record).length !== topKeys.length ||
    !topKeys.every((key) => Object.hasOwn(record, key))
  ) {
    return false;
  }

  if (!equalShape(record.totals, expected.totals)) return false;

  const groups: readonly [unknown, Readonly<Record<string, object>>][] = [
    [record.search, expected.search],
    [record.citation, expected.citation],
    [record.mention, expected.mention],
  ];
  for (const [actual, wanted] of groups) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
      return false;
    }
    const bucket = actual as Record<string, unknown>;
    const keys = Object.keys(wanted);
    if (
      Object.keys(bucket).length !== keys.length ||
      !keys.every((key) => equalShape(bucket[key], wanted[key]!))
    ) {
      return false;
    }
  }

  return (
    record.validProbes === expected.validProbes &&
    record.triggerFailedProbes === expected.triggerFailedProbes &&
    record.degradedProbes === expected.degradedProbes &&
    record.failedProbes === expected.failedProbes
  );
}

/**
 * The projection the report fingerprint covers.
 *
 * Written out field by field for the same reason as the context and query-set
 * projections: a field added later must not join the hash domain by accident.
 * `reportContentHash` itself is excluded by construction — everything else the
 * report asserts is in, including the run's own ephemeral id, so a packet
 * carrying this digest can only have come from this run.
 */
export interface GeoReportHashRunV1 {
  readonly schemaVersion: string;
  readonly runId: string;
  readonly sampledAt: string;
  readonly targetHost: string;
  readonly contextHash: string;
  readonly querySetContentHash: string;
  readonly provenance: GeoSurfaceProvenanceV1;
}

export function geoReportContentProjection(
  run: GeoReportHashRunV1,
  questions: readonly GeoQuestionObservationV3[],
  limitations: readonly GeoRunLimitationCode[],
): GeoCanonicalValue {
  const questionValues: GeoCanonicalValue[] = questions.map(
    (question): GeoCanonicalValue => ({
      queryId: question.queryId,
      slot: question.slot,
      text: question.text,
      mode: question.mode,
      brandStance: question.brandStance,
      samplesPlanned: question.samplesPlanned,
      templateId: question.templateId,
      templateVersion: question.templateVersion,
      samples: question.samples.map(
        (sample): GeoCanonicalValue => ({
          sampleId: sample.sampleId,
          sampleIndex: sample.sampleIndex,
          answerStatus: sample.answerStatus,
          observedAt: sample.observedAt,
          webSearchPerformed: sample.webSearchPerformed,
          probeStatus: sample.probeStatus,
          citationStatus: sample.citationStatus,
          mentionStatus: sample.mentionStatus,
          mentionEligibility: sample.mentionEligibility,
          recommendationStatus: sample.recommendationStatus,
          limitations: [...sample.limitations],
          evidence: sample.evidence.map(
            (entry): GeoCanonicalValue =>
              entry.kind === "cited"
                ? {
                    kind: entry.kind,
                    evidenceId: entry.evidenceId,
                    exactUrl: entry.exactUrl,
                    domain: entry.domain,
                    title: entry.title,
                    annotationText: entry.annotationText,
                    providerOutputItemIndex: entry.providerOutputItemIndex,
                    sectionIndex: entry.sectionIndex,
                    startIndex: entry.startIndex,
                    endIndex: entry.endIndex,
                    ownership: entry.ownership,
                    sourceType: entry.sourceType,
                  }
                : {
                    kind: entry.kind,
                    evidenceId: entry.evidenceId,
                    matchedAlias: entry.matchedAlias,
                    mentionSnippet: entry.mentionSnippet,
                    snippetBasis: entry.snippetBasis,
                  },
          ),
        }),
      ),
    }),
  );

  return {
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    sampledAt: run.sampledAt,
    targetHost: run.targetHost,
    contextHash: run.contextHash,
    querySetContentHash: run.querySetContentHash,
    provenance: { ...run.provenance, modelObserved: [...run.provenance.modelObserved] },
    limitations: [...limitations],
    questions: questionValues,
  };
}

/**
 * The report fingerprint.
 *
 * What it honestly proves: an action list or a handoff packet carrying it was
 * built from this exact report. It proves nothing about who ran the report,
 * whether the observations are accurate, or that the run was authorized.
 */
export async function geoReportContentHash(
  run: GeoReportHashRunV1,
  questions: readonly GeoQuestionObservationV3[],
  limitations: readonly GeoRunLimitationCode[],
): Promise<string> {
  return geoDomainHash(
    GEO_REPORT_CONTENT_HASH_DOMAIN,
    geoReportContentProjection(run, questions, limitations),
  );
}
