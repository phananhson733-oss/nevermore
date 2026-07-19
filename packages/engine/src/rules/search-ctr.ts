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
    availability: "available",
    support: "supports",
    subjectRefs: [subjectUrl],
    claim,
    observedAt: ctx.observedAt("gsc"),
    limitation: GSC_LIMITATION,
  };
}

function evaluatePage(
  ctx: DiagnosticContext,
  subjectUrl: string,
  page: GscPageProjection,
): FindingCandidate | null {
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

  return {
    subjectRefs: [subjectUrl],
    severity,
    titleArgs: { url: subjectUrl },
    metrics: { ctr, position, impressions, clicks, benchmark },
    evidence: [
      ctrEvidence(ctx, subjectUrl, ctr, position, benchmark, threshold, page.topQueries),
    ],
  };
}

export const searchCtrRule = {
  id: "SEARCH-CTR-004",
  version: 1,
  domain: "search_performance",
  requiredDatasets: [{ dataset: "gsc", required: true }],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("gsc")) {
      return { status: "skipped", reason: "missing_dataset" };
    }

    const candidates: FindingCandidate[] = [];
    for (const [subjectUrl, page] of ctx.gsc) {
      const candidate = evaluatePage(ctx, subjectUrl, page);
      if (candidate) candidates.push(candidate);
    }

    if (candidates.length === 0) {
      return {
        status: "pass",
        metrics: { pagesEvaluated: ctx.gsc.size, triggered: 0 },
      };
    }
    return { status: "candidate", candidates };
  },
} satisfies DiagnosticRule;
