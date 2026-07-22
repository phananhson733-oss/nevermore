/**
 * SEARCH-DECAY-002 (spec §8.3, §8.4). For each GSC page with a meaningful prior
 * click base, flag pages whose trailing-28-day clicks fell by 20% or more versus
 * the previous 28 days — established search demand is decaying. Pure: reads only
 * the frozen context, no clock or network.
 */

import type { GscPageProjection } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";
import { analyticsTargetResolution, findingTarget } from "../target.ts";

const GSC_LIMITATION =
  "Search Console returns top rows by clicks, not the full query universe.";

const MIN_PREVIOUS_CLICKS = 100;
const DECAY_THRESHOLD = -0.2;

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function decayEvidence(
  ctx: DiagnosticContext,
  subjectUrl: string,
  currentClicks: number,
  previousClicks: number,
  delta: number,
): EvidenceDraft {
  const claim =
    `Search clicks fell from ${previousClicks} in the previous 28 days to ${currentClicks} ` +
    `in the current 28 days, a ${pct(delta)} change.`;
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
): FindingCandidate | "missing_lineage" | null {
  const previousClicks = page.previous28d.clicks;
  if (previousClicks < MIN_PREVIOUS_CLICKS) return null;

  const currentClicks = page.current28d.clicks;
  const delta = (currentClicks - previousClicks) / previousClicks;
  if (delta > DECAY_THRESHOLD) return null;

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
    metrics: { currentClicks, previousClicks, delta },
    evidence: [decayEvidence(ctx, subjectUrl, currentClicks, previousClicks, delta)],
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
      // Qualifying duplicate rows cannot safely select a single immutable
      // observation member, so the rule fails closed only for that trigger.
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

export const searchDecayRule = {
  id: "SEARCH-DECAY-002",
  version: 1,
  domain: "search_performance",
  requiredDatasets: [{ dataset: "gsc", required: true }],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("gsc")) {
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
      return {
        status: "pass",
        metrics: { pagesEvaluated: ctx.gsc.size, triggered: 0 },
      };
    }
    return { status: "candidate", candidates };
  },
} satisfies DiagnosticRule;
