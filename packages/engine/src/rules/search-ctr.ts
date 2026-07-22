/**
 * SEARCH-CTR-004 (spec §8.3, §8.4). For each GSC page with a meaningful
 * impression base in positions 1–10, flag pages whose impression-weighted CTR
 * sits below half the positional benchmark — the snippet is under-earning the
 * clicks its ranking should produce. Pure: reads only the frozen context.
 */

import type { GscPageProjection, GscTopQuery } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";
import { ctrBenchmark, ctrThreshold } from "../util/ctr-benchmark.ts";
import { analyticsTargetResolution, findingTarget } from "../target.ts";

const GSC_LIMITATION =
  "Search Console returns top rows by clicks, not the full query universe.";

const MIN_IMPRESSIONS = 1000;
const MIN_POSITION = 1;
const MAX_POSITION = 10;
const TOP_QUERY_LIMIT = 10;

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

/** Top queries by impressions (copy before sorting — topQueries is readonly). */
function topByImpressions(queries: readonly GscTopQuery[]): readonly GscTopQuery[] {
  return [...queries]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, TOP_QUERY_LIMIT);
}

function ctrEvidence(
  ctx: DiagnosticContext,
  subjectUrl: string,
  ctr: number,
  position: number,
  benchmark: number,
  threshold: number,
  queries: readonly GscTopQuery[],
): EvidenceDraft {
  const availability = ctx.datasetAvailability("gsc");
  const top = topByImpressions(queries);
  const queryList =
    top.length === 0
      ? "none"
      : top.map((q) => `${q.query} (${q.impressions} impr)`).join(", ");
  const claim =
    `Impression-weighted CTR ${pct(ctr)} at average position ${position.toFixed(1)} ` +
    `is below the positional benchmark ${pct(benchmark)} ` +
    `(under-performance threshold ${pct(threshold)}). ` +
    `Top queries by impressions: ${queryList}.`;
  return {
    sourceProvider: "gsc",
    origin: "first_party",
    method: "observed",
    grade: "A",
    availability: availability === "partial" ? "partial" : "available",
    support: "supports",
    subjectRefs: [subjectUrl],
    claim,
    observedAt: ctx.observedAt("gsc"),
    limitation:
      availability === "partial"
        ? `${GSC_LIMITATION} The selected snapshot is partial, so omitted rows may affect completeness.`
        : GSC_LIMITATION,
  };
}

function evaluatePage(
  ctx: DiagnosticContext,
  subjectUrl: string,
  page: GscPageProjection,
): FindingCandidate | "missing_lineage" | null {
  const { clicks, impressions, position } = page.current28d;
  if (impressions < MIN_IMPRESSIONS) return null;
  if (position === null || position < MIN_POSITION || position > MAX_POSITION) return null;

  const benchmark = ctrBenchmark(position);
  const threshold = ctrThreshold(position);
  if (benchmark === null || threshold === null) return null;

  const ctr = clicks / impressions;
  if (ctr >= threshold) return null;

  const severity: Severity =
    ctx.isPriority(subjectUrl) || ctx.isCommercial(subjectUrl) ? "high" : "medium";
  const targetResolution = analyticsTargetResolution(
    ctx.gscObservationForSubject(subjectUrl),
  );
  if (targetResolution.status === "missing_lineage") {
    return "missing_lineage";
  }

  return {
    subjectRefs: [subjectUrl],
    severity,
    titleArgs: { url: subjectUrl },
    metrics: { ctr, position, impressions, clicks, benchmark },
    evidence: [
      ctrEvidence(ctx, subjectUrl, ctr, position, benchmark, threshold, page.topQueries),
    ],
    target: findingTarget(
      { relation: "direct_url", targetKind: "url" },
      targetResolution.targetRef,
      [targetResolution.member],
      "observation_members",
    ),
  };
}

function hasAmbiguousTrigger(ctx: DiagnosticContext): boolean {
  for (const [subjectUrl, observations] of ctx.gscObservationGroups) {
    if (observations.length <= 1) continue;
    for (const observation of observations) {
      // Ambiguous rows are evaluated only far enough to determine whether the
      // subject would trigger. evaluatePage returns before target creation when
      // its persisted one-to-one lineage cannot be selected.
      if (
        evaluatePage(ctx, subjectUrl, observation.projection) ===
        "missing_lineage"
      ) {
        return true;
      }
    }
  }
  return false;
}

export const searchCtrRule = {
  id: "SEARCH-CTR-004",
  version: 1,
  domain: "search_performance",
  requiredDatasets: [{ dataset: "gsc", required: true }],
  evaluate(ctx: DiagnosticContext): RuleResult {
    const availability = ctx.datasetAvailability("gsc");
    if (availability === "unavailable") {
      return { status: "skipped", reason: "missing_dataset" };
    }
    if (hasAmbiguousTrigger(ctx)) {
      return { status: "inconclusive", reason: "missing_observation_lineage" };
    }

    const candidates: FindingCandidate[] = [];
    for (const [subjectUrl, page] of ctx.gsc) {
      const candidate = evaluatePage(ctx, subjectUrl, page);
      if (candidate === "missing_lineage") {
        return { status: "inconclusive", reason: "missing_observation_lineage" };
      }
      if (candidate) candidates.push(candidate);
    }

    if (candidates.length === 0) {
      if (availability === "partial") {
        return { status: "inconclusive", reason: "partial_gsc_snapshot" };
      }
      return {
        status: "pass",
        metrics: { pagesEvaluated: ctx.gsc.size, triggered: 0 },
      };
    }
    return { status: "candidate", candidates };
  },
} satisfies DiagnosticRule;
