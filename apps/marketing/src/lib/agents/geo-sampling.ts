// @input  -- a confirmed query set, the confirmed context, a paid provider and a clock
// @output -- one orthogonal sample per planned call, with its evidence preserved
// @pos    -- the only place a provider answer becomes a reportable observation

import {
  findGeoAliasMatch,
  geoMentionSnippet,
} from "./geo-alias-match.ts";
import {
  deriveGeoMentionEligibility,
  type GeoAliasMatcherScope,
  type GeoConfirmedAliasV1,
} from "./geo-context.ts";
import {
  GeoProviderError,
  type GeoProviderCitationAnnotation,
  type GeoProviderClient,
  type GeoProviderObservation,
} from "./geo-provider.ts";
import type { GeoQueryUnitV1 } from "./geo-query-contract.ts";
import {
  deriveGeoSampleCounts,
  deriveProbeStatus,
} from "./geo-report-derive.ts";
import {
  type GeoCitationEvidenceRefV1,
  type GeoEvidenceRefV1,
  type GeoMentionEvidenceRefV1,
  type GeoQuestionObservationV3,
  type GeoSampleLimitationCode,
  type GeoSampleV3,
} from "./geo-report-contract.ts";
import { geoCitationDomain, isGeoTargetCitation } from "./geo-url.ts";

/**
 * How many provider calls may be in flight at once.
 *
 * Eight was measured, not guessed: a calibration that issued eight concurrent
 * calls finished in 28.5s, equal to its own slowest single call, with no sign
 * of throttling. Higher concurrency was never tested, and the failure mode of
 * guessing high is a 429 on a run the visitor has already paid for.
 */
export const GEO_MAX_CONCURRENCY = 8;

/**
 * Least time that must remain before another paid call is started.
 *
 * A call begun with less than this cannot finish inside the budget, so issuing
 * it would spend money on an answer the response has no room to carry.
 */
export const GEO_MIN_BUDGET_FOR_CALL_MS = 45_000;

export { normalizeGeoHost as normalizeCitedHost } from "./geo-url.ts";

export interface GeoSamplingContext {
  /** Normalized canonical host of the site under test. */
  readonly targetHost: string;
  readonly brandAliases: readonly GeoConfirmedAliasV1[];
  /**
   * Whether the matcher can speak about this alias set at all.
   *
   * Computed once from the confirmed aliases rather than per sample: it is a
   * property of the names, not of the answers, and recomputing it eighteen
   * times would invite eighteen chances to compute it differently.
   */
  readonly aliasScope: GeoAliasMatcherScope;
}

/** One planned provider call. Allocated before any asynchronous work begins. */
export interface GeoExecutionSlot {
  readonly queryIndex: number;
  readonly sampleIndex: number;
  readonly sampleId: string;
}

/**
 * The immutable execution plan for one run.
 *
 * Built in full before the first call, so the run's size is a fact the visitor
 * was shown rather than an emergent property of how the loop happened to
 * unfold. Every slot is dispatched at most once and every sample index exists
 * before anything is in flight; a plan assembled as calls complete is how a
 * retry becomes a nineteenth charge.
 */
export function buildGeoExecutionPlan(
  queries: readonly GeoQueryUnitV1[],
): readonly GeoExecutionSlot[] {
  const slots: GeoExecutionSlot[] = [];
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex]!;
    for (let sample = 1; sample <= query.samplesPlanned; sample += 1) {
      slots.push({
        queryIndex,
        sampleIndex: sample,
        sampleId: `${query.queryId}-s${sample}`,
      });
    }
  }
  return slots;
}

/**
 * Turn provider annotations into evidence, or say the list is unreadable.
 *
 * A citation whose host cannot be derived does not become the customer's own
 * host with a shrug — that would invent a source attribution and, worse, one
 * that points at the customer. It makes the whole sample's citation reading
 * unavailable, which is the honest answer to "we could not read this".
 */
function citationEvidence(
  sampleId: string,
  citations: readonly GeoProviderCitationAnnotation[],
  targetHost: string,
): readonly GeoCitationEvidenceRefV1[] | null {
  const evidence: GeoCitationEvidenceRefV1[] = [];
  for (const [index, citation] of citations.entries()) {
    const domain = geoCitationDomain(citation.url);
    if (domain === null) return null;
    const isTarget = isGeoTargetCitation(citation.url, targetHost);
    evidence.push({
      kind: "cited",
      evidenceId: `${sampleId}-c${index + 1}`,
      exactUrl: citation.url,
      // Recomputed, never carried alongside and trusted.
      domain,
      title: citation.title,
      annotationText: citation.annotationText,
      providerOutputItemIndex: citation.providerOutputItemIndex,
      sectionIndex: citation.sectionIndex,
      startIndex: citation.startIndex,
      endIndex: citation.endIndex,
      ownership: isTarget ? "target" : "unknown",
      // There is no honest URL-only classifier for marketplace, review,
      // community or editorial. Guessing one would put a made-up label on the
      // most-read line of the report.
      sourceType: isTarget ? "owned_page" : "unknown",
    });
  }
  return evidence;
}

/**
 * Turn one provider answer into one sample, keeping the dimensions apart.
 *
 * Nothing here collapses: a run that answered without searching still has its
 * annotations inspected, still has its prose checked for the brand, and still
 * records both results separately. The old classifier returned early on a
 * no-search answer and threw the mention away, which is precisely the
 * observation this Agent exists to make.
 */
export function observeToSample(
  slot: GeoExecutionSlot,
  query: GeoQueryUnitV1,
  observation: GeoProviderObservation,
  context: GeoSamplingContext,
): GeoSampleV3 {
  const limitations: GeoSampleLimitationCode[] = [];
  const aliases = context.brandAliases.map((entry) => entry.alias);

  const extracted = observation.citationsComplete
    ? citationEvidence(slot.sampleId, observation.citations, context.targetHost)
    : null;
  const extractionFailed = extracted === null;
  if (extractionFailed) limitations.push("citation_extraction_incomplete");

  const citations = extracted ?? [];
  const citationStatus = extractionFailed
    ? ("unavailable" as const)
    : citations.length === 0
      ? ("observed_none" as const)
      : citations.some((entry) => entry.ownership === "target")
        ? ("observed_target" as const)
        : ("observed_others_only" as const);

  const outOfScope = context.aliasScope === "out_of_scope";
  if (outOfScope) limitations.push("alias_matcher_out_of_scope");
  const match = outOfScope
    ? null
    : findGeoAliasMatch(observation.answerText, aliases);
  const mentionStatus = outOfScope
    ? ("unavailable" as const)
    : match === null
      ? ("not_observed" as const)
      : ("observed" as const);

  const mention: readonly GeoMentionEvidenceRefV1[] =
    match === null
      ? []
      : [
          {
            kind: "mention",
            evidenceId: `${slot.sampleId}-m1`,
            matchedAlias: match.alias,
            mentionSnippet: geoMentionSnippet(observation.answerText, match),
            snippetBasis: "provider_answer_text",
          },
        ];

  const evidence: readonly GeoEvidenceRefV1[] = [...citations, ...mention];

  return {
    sampleId: slot.sampleId,
    sampleIndex: slot.sampleIndex,
    answerStatus: "answered",
    observedAt: observation.observedAt,
    webSearchPerformed: observation.webSearchPerformed,
    // Filled in for the whole probe once every sample is home; a single sample
    // cannot say whether a probe's wording works.
    probeStatus: null,
    citationStatus,
    mentionStatus,
    mentionEligibility: deriveGeoMentionEligibility(
      query.text,
      context.brandAliases,
      context.aliasScope,
    ),
    recommendationStatus: "not_evaluated",
    evidence,
    limitations,
  };
}

/** The sample recorded when a planned call never produced a usable answer. */
export function unavailableSample(
  slot: GeoExecutionSlot,
  query: GeoQueryUnitV1,
  context: GeoSamplingContext,
  limitation: GeoSampleLimitationCode,
): GeoSampleV3 {
  return {
    sampleId: slot.sampleId,
    sampleIndex: slot.sampleIndex,
    answerStatus: "no_usable_answer",
    observedAt: null,
    // Not `false`. A call that produced no answer produced no evidence that a
    // search did not run either, and writing `false` would put a fabricated
    // observation into the search denominator.
    webSearchPerformed: null,
    probeStatus: null,
    citationStatus: "unavailable",
    mentionStatus: "unavailable",
    mentionEligibility: deriveGeoMentionEligibility(
      query.text,
      context.brandAliases,
      context.aliasScope,
    ),
    recommendationStatus: "not_evaluated",
    evidence: [],
    limitations: [limitation],
  };
}

/**
 * The probe verdict, derived where the counts are derived.
 *
 * Re-exported rather than reimplemented: the counting function excludes a
 * probe's unsearched samples from the citation denominator, so the verdict and
 * the exclusion have to come from the same rule or the report can disagree with
 * its own banner.
 */
export { deriveProbeStatus } from "./geo-report-derive.ts";

/**
 * Stamp the probe verdict onto every sample of a retrieval question.
 *
 * All of a probe's samples carry the same status because the verdict is about
 * the question's wording, not about any one answer. A failed trigger also lands
 * as a per-sample limitation so the reason a sample left the citation
 * denominator travels with the sample itself.
 */
export function applyProbeStatus(
  query: GeoQueryUnitV1,
  samples: readonly GeoSampleV3[],
): readonly GeoSampleV3[] {
  if (query.mode !== "retrieval_probe") return samples;
  const status = deriveProbeStatus(samples);
  return samples.map((sample) => {
    // Marked per sample, not per probe. Citation evaluability is judged per
    // sample, so a mixed probe's unsearched call leaves the denominator — and a
    // sample that leaves the denominator without saying why is a number the
    // report cannot explain. The probe verdict still travels alongside.
    const failedTrigger =
      sample.answerStatus === "answered" && sample.webSearchPerformed === false;
    return {
      ...sample,
      probeStatus: status,
      limitations:
        failedTrigger && !sample.limitations.includes("retrieval_trigger_failed")
          ? [...sample.limitations, "retrieval_trigger_failed"]
          : sample.limitations,
    };
  });
}

/** Assemble one question's observation from its samples. */
export function assembleQuestion(
  query: GeoQueryUnitV1,
  samples: readonly GeoSampleV3[],
): GeoQuestionObservationV3 {
  const ordered = applyProbeStatus(
    query,
    [...samples].sort((a, b) => a.sampleIndex - b.sampleIndex),
  );
  return {
    queryId: query.queryId,
    slot: query.slot,
    text: query.text,
    mode: query.mode,
    brandStance: query.brandStance,
    samplesPlanned: query.samplesPlanned,
    templateId: query.templateId,
    templateVersion: query.templateVersion,
    samples: ordered,
    // Never accepted from elsewhere: the guard recomputes with this same
    // function, and two implementations are how the two drift.
    counts: deriveGeoSampleCounts(ordered),
  };
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
  /** Record an observed model label, whatever the collector returned. */
  readonly noteModel: (model: string) => void;
}

/**
 * Run the immutable plan and return one observation per question.
 *
 * Calls are drawn from a single shared queue rather than issued in per-question
 * batches: measured latency ranged from 24s to 44s, and batching would make
 * every batch cost its slowest member. Every slot resolves to a sample, success
 * or failure, so one bad call never discards the paid results beside it, and a
 * request whose outcome is genuinely unknown is never retried — a retry after
 * an ambiguous timeout is a nineteenth billed call.
 */
export async function collectGeoSamples(
  queries: readonly GeoQueryUnitV1[],
  context: GeoSamplingContext,
  dependencies: GeoCollectionDependencies,
): Promise<readonly GeoQuestionObservationV3[]> {
  const plan = buildGeoExecutionPlan(queries);
  const collected: GeoSampleV3[][] = queries.map(() => []);
  let cursor = 0;

  const lane = async (): Promise<void> => {
    for (;;) {
      const slot = plan[cursor];
      if (slot === undefined) return;
      cursor += 1;

      const query = queries[slot.queryIndex];
      if (query === undefined) continue;
      const record = (sample: GeoSampleV3): void => {
        collected[slot.queryIndex]?.push(sample);
      };

      // The clock is checked before the ceiling so a run that ran out of time
      // does not hold a reservation it will never spend.
      if (dependencies.remainingMs() < GEO_MIN_BUDGET_FOR_CALL_MS) {
        record(unavailableSample(slot, query, context, "time_budget"));
        continue;
      }
      if (!dependencies.admitCall()) {
        record(unavailableSample(slot, query, context, "cost_ceiling"));
        continue;
      }

      try {
        const observation = await dependencies.provider.observe({
          prompt: query.text,
          model: dependencies.model,
          marketCode: dependencies.marketCode,
        });
        dependencies.settleCall(observation.costUsd);
        dependencies.noteModel(observation.model);
        record(observeToSample(slot, query, observation, context));
      } catch (error) {
        if (error instanceof GeoProviderError) {
          // Billed on some paths, so the reservation is settled with whatever
          // it cost before the sample is recorded.
          dependencies.settleCall(error.costUsd);
          record(
            unavailableSample(slot, query, context, providerLimitation(error)),
          );
          continue;
        }
        dependencies.settleCall(null);
        record(unavailableSample(slot, query, context, "transport_error"));
      }
    }
  };

  const lanes = Math.min(GEO_MAX_CONCURRENCY, plan.length);
  await Promise.all(Array.from({ length: lanes }, () => lane()));

  return queries.map((query, index) =>
    assembleQuestion(query, collected[index] ?? []),
  );
}

/**
 * The failure class as a renderable code, never the provider's own message,
 * which may quote a third party's text.
 *
 * `timeout` maps to `transport_outcome_unknown` rather than to a plain
 * transport error: an aborted request may still have reached the provider,
 * been answered and been billed, and that difference is the whole reason the
 * run never retries it.
 */
function providerLimitation(error: GeoProviderError): GeoSampleLimitationCode {
  switch (error.reason) {
    case "not_configured":
      return "provider_not_configured";
    case "timeout":
      return "transport_outcome_unknown";
    case "network_error":
      return "transport_error";
    case "rate_limited":
    case "auth_failed":
    case "bad_request":
    case "server_error":
      return "provider_error";
    case "invalid_response":
      return "provider_no_answer";
    default:
      return "provider_error";
  }
}
