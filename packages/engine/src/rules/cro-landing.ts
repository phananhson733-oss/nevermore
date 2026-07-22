import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";
import { analyticsTargetResolution, findingTarget } from "../target.ts";

/**
 * CRO-LANDING-003 (spec §8.4, conversion_journey). A landing page whose GA4
 * key-event conversion rate is well below the site baseline is under-converting.
 * This rule is PURE: it reads the frozen GA4 landing projection and never touches
 * the DB, network, LLM or clock.
 *
 * The site baseline is the aggregate `sum(keyEvents) / sum(sessions)` over pages
 * with a usable key-event count — NOT the average of per-page rates. When no
 * usable baseline exists the rule is `inconclusive` (never "low conversion").
 */

const MIN_SESSIONS = 500;
const RATE_THRESHOLD = 0.7;
const BASELINE_UNAVAILABLE = "ga4_baseline_unavailable";

const GA4_LIMITATION =
  "Conversion rate uses GA4 key events under the project's key-event mapping; pages with unmapped key events are excluded and only pages with at least 500 sessions are evaluated.";

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

function hasAmbiguousBaselineParticipant(ctx: DiagnosticContext): boolean {
  for (const observations of ctx.ga4ObservationGroups.values()) {
    if (observations.length <= 1) continue;
    // Every mapped page contributes to the aggregate baseline, regardless of
    // its page-level session threshold. Picking or silently dropping one of
    // several immutable rows would make both baseline and trigger status
    // unprovable. Unmapped duplicates affect neither calculation.
    if (observations.some(({ projection }) => projection.keyEvents !== null)) {
      return true;
    }
  }
  return false;
}

export const croLandingRule = {
  id: "CRO-LANDING-003",
  version: 1,
  domain: "conversion_journey",
  requiredDatasets: [{ dataset: "ga4", required: true }],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("ga4")) {
      return { status: "skipped", reason: "missing_dataset" };
    }
    if (hasAmbiguousBaselineParticipant(ctx)) {
      return { status: "inconclusive", reason: "missing_observation_lineage" };
    }

    // Site baseline from the aggregate totals, over pages with a usable count.
    let sumKeyEvents = 0;
    let sumSessions = 0;
    for (const page of ctx.ga4.values()) {
      if (page.keyEvents === null) continue;
      sumKeyEvents += page.keyEvents;
      sumSessions += page.sessions;
    }
    if (sumSessions === 0) {
      return { status: "inconclusive", reason: BASELINE_UNAVAILABLE };
    }
    const baseline = sumKeyEvents / sumSessions;
    if (baseline === 0) {
      return { status: "inconclusive", reason: BASELINE_UNAVAILABLE };
    }

    const candidates: FindingCandidate[] = [];
    for (const [url, page] of ctx.ga4.entries()) {
      if (page.keyEvents === null) continue; // page-level inconclusive, not a defect
      if (page.sessions < MIN_SESSIONS) continue;
      const pageRate = page.keyEvents / page.sessions;
      if (pageRate >= baseline * RATE_THRESHOLD) continue;

      const severity: Severity =
        ctx.isPriority(url) || ctx.isCommercial(url) ? "high" : "medium";
      const targetResolution = analyticsTargetResolution(
        ctx.ga4ObservationForSubject(url),
      );
      if (targetResolution.status === "missing_lineage") {
        return { status: "inconclusive", reason: "missing_observation_lineage" };
      }
      const evidence: EvidenceDraft = {
        sourceProvider: "ga4",
        origin: "first_party",
        method: "observed",
        grade: "A",
        availability: "available",
        support: "supports",
        subjectRefs: [url],
        claim: `Landing page converts key events at ${(pageRate * 100).toFixed(2)}% of sessions versus the ${(baseline * 100).toFixed(2)}% site baseline (below ${RATE_THRESHOLD * 100}% of baseline).`,
        observedAt: ctx.observedAt("ga4"),
        limitation: GA4_LIMITATION,
      };
      candidates.push({
        subjectRefs: [url],
        severity,
        titleArgs: { pageRate: pct(pageRate), baseline: pct(baseline) },
        metrics: {
          pageRate,
          baseline,
          sessions: page.sessions,
          keyEvents: page.keyEvents,
        },
        evidence: [evidence],
        target: findingTarget(
          { relation: "direct_url", targetKind: "url" },
          targetResolution.targetRef,
          [targetResolution.member],
          "observation_members",
        ),
      });
    }

    if (candidates.length === 0) {
      return {
        status: "pass",
        metrics: { baseline, evaluatedSessions: sumSessions, evaluatedKeyEvents: sumKeyEvents },
      };
    }
    return { status: "candidate", candidates };
  },
} satisfies DiagnosticRule;
