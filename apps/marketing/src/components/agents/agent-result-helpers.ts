// @input  -- filtered SeoAuditRecord and SeoAuditCoverage facts
// @output -- deterministic opportunity ordering and honest evaluation summaries
// @pos    -- pure presentation derivations for both Agent result surfaces

import type { SeoAuditCoverage, SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import type { AgentKind } from "./agent-types";

export interface AgentRecordSummary {
  readonly total: number;
  readonly evaluated: number;
  readonly unverified: number;
  readonly observed: number;
  readonly notObserved: number;
}

export type AgentRecommendationPriority = "P0" | "P1" | "P2" | "P3";

export interface RankedAgentRecommendation {
  readonly id: string;
  readonly agent: AgentKind;
  readonly check: AgentAuditEvaluatedCheck;
  readonly priority: AgentRecommendationPriority;
  readonly evidenceAvailable: boolean;
  readonly evidenceRecords: readonly SeoAuditRecord[];
  readonly reach: number;
  readonly primaryForAgent: boolean;
}

export interface RankAgentRecommendationOptions {
  readonly targetUrl?: string;
  readonly limit?: number;
}

const RESULT_RANK: Readonly<Record<string, number>> = {
  blocker: 4,
  warning: 3,
  tip: 2,
  excluded: 1,
  pass: 0,
};

const RESULT_PRIORITY: Readonly<Record<string, AgentRecommendationPriority>> = {
  blocker: "P0",
  warning: "P1",
  tip: "P2",
  excluded: "P3",
  pass: "P3",
};

function comparableUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function recommendationEvidenceRecords(
  check: AgentAuditEvaluatedCheck,
  recordsById: ReadonlyMap<string, SeoAuditRecord>,
  targetUrl: string | undefined,
): readonly SeoAuditRecord[] {
  const records = check.evidenceRecordIds
    .map((recordId) => recordsById.get(recordId))
    .filter((record): record is SeoAuditRecord => record !== undefined);
  if (check.check.scope !== "page" || !targetUrl) return records;

  const target = comparableUrl(targetUrl);
  if (!target) return [];
  return records.flatMap((record) => {
    const observations = record.observations.filter(
      (observation) => comparableUrl(observation.url) === target,
    );
    return observations.length === 0
      ? []
      : [
          {
            ...record,
            state: "observed" as const,
            tested: Math.max(1, observations.length),
            affected: observations.length,
            observations,
          },
        ];
  });
}

/**
 * Rank decisions, not raw crawl rows. Severity and collected evidence lead;
 * Agent ownership decides otherwise-equivalent candidates; observed reach is
 * only the final supporting tie-breaker.
 */
export function rankAgentRecommendations(
  agent: AgentKind,
  checks: readonly AgentAuditEvaluatedCheck[],
  records: readonly SeoAuditRecord[],
  options: RankAgentRecommendationOptions = {},
): readonly RankedAgentRecommendation[] {
  const recordsById = new Map(records.map((record) => [record.id, record]));

  return checks
    .map((check, index) => {
      const evidenceRecords = recommendationEvidenceRecords(
        check,
        recordsById,
        options.targetUrl,
      );
      const observedEvidence = evidenceRecords.filter(
        (record) => record.state === "observed" && record.affected > 0,
      );
      const result = String(check.result);
      return {
        recommendation: {
          id: `${agent}:${check.check.scope}:${check.check.id}`,
          agent,
          check,
          priority: RESULT_PRIORITY[result] ?? "P3",
          evidenceAvailable: observedEvidence.length > 0,
          evidenceRecords,
          reach: observedEvidence.reduce(
            (total, record) => total + record.affected,
            0,
          ),
          primaryForAgent: check.check.primaryAgent === agent,
        } satisfies RankedAgentRecommendation,
        index,
      };
    })
    .filter(({ recommendation }) => recommendation.check.result !== "pass")
    .toSorted(
      (left, right) =>
        (RESULT_RANK[String(right.recommendation.check.result)] ?? 0) -
          (RESULT_RANK[String(left.recommendation.check.result)] ?? 0) ||
        Number(right.recommendation.evidenceAvailable) -
          Number(left.recommendation.evidenceAvailable) ||
        Number(right.recommendation.primaryForAgent) -
          Number(left.recommendation.primaryForAgent) ||
        right.recommendation.reach - left.recommendation.reach ||
        left.index - right.index,
    )
    .slice(0, Math.max(0, options.limit ?? 3))
    .map(({ recommendation }) => recommendation);
}

export function summarizeAgentRecords(
  records: readonly SeoAuditRecord[],
): AgentRecordSummary {
  const unverified = records.filter(
    (record) => record.state === "unverified",
  ).length;
  return {
    total: records.length,
    evaluated: records.length - unverified,
    unverified,
    observed: records.filter((record) => record.state === "observed").length,
    notObserved: records.filter(
      (record) => record.state === "not_observed",
    ).length,
  };
}

export function notCollectedUrlCount(
  coverage: SeoAuditCoverage,
): number | null {
  if (coverage.availability === "unavailable") return null;

  return (
    coverage.urlsSkipped +
    coverage.urlsBlocked +
    coverage.urlsDisallowed +
    coverage.urlsErrored
  );
}
