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

export type AgentRecommendationPriority = "P0" | "P1" | "P2";

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

/**
 * A check this run could not evaluate, with the reason it could not.
 *
 * "Waiting on a source we have not integrated" and "the crawl could not attribute
 * this to your page" are different problems with different next steps; reporting
 * both as a missing data source sends the reader after integrations they already
 * have.
 */
export type AgentUnevaluatedReason =
  | "source_not_integrated"
  | "not_attributable_to_target"
  | "not_measurable_this_run";

export interface AgentDataSourceGap {
  readonly id: string;
  readonly agent: AgentKind;
  readonly check: AgentAuditEvaluatedCheck;
  readonly reason: AgentUnevaluatedReason;
}

function unevaluatedReason(
  check: AgentAuditEvaluatedCheck,
): AgentUnevaluatedReason {
  if (check.engine === "access-required" || check.engine === "not-integrated") {
    return "source_not_integrated";
  }
  return check.truth === "partial" || check.truth === "not-observed"
    ? "not_attributable_to_target"
    : "not_measurable_this_run";
}

export interface AgentRecommendationAnalysis {
  readonly ranked: readonly RankedAgentRecommendation[];
  /** Actionable recommendations found before the display limit was applied. */
  readonly rankedTotal: number;
  readonly displayLimit: number;
  readonly hiddenCount: number;
  readonly dataSourceGaps: readonly AgentDataSourceGap[];
}

export interface RankAgentRecommendationOptions {
  readonly targetUrl?: string;
  readonly limit?: number;
}

export const AGENT_RECOMMENDATION_DISPLAY_LIMIT = 3;

/** Only these result states describe something this run actually observed. */
const ACTIONABLE_RESULTS: ReadonlySet<string> = new Set([
  "blocker",
  "warning",
  "tip",
]);

const RESULT_RANK: Readonly<Record<string, number>> = {
  blocker: 3,
  warning: 2,
  tip: 1,
};

const RESULT_PRIORITY: Readonly<Record<string, AgentRecommendationPriority>> = {
  blocker: "P0",
  warning: "P1",
  tip: "P2",
};

export function comparableUrl(
  value: string | null | undefined,
): string | null {
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
 * Sibling records of one check observe the same population, so an affected URL
 * seen in several records is still one affected URL. Site-level observations
 * carry no URL and are counted on their own.
 */
function observedReach(records: readonly SeoAuditRecord[]): number {
  const affectedUrls = new Set<string>();
  let siteLevelAffected = 0;
  for (const record of records) {
    for (const observation of record.observations) {
      if (observation.url === null) siteLevelAffected += 1;
      else {
        affectedUrls.add(comparableUrl(observation.url) ?? observation.url);
      }
    }
  }
  return affectedUrls.size + siteLevelAffected;
}

/**
 * Rank decisions, not raw crawl rows. Severity and collected evidence lead;
 * Agent ownership decides otherwise-equivalent candidates; observed reach is
 * only the final supporting tie-breaker. The confirmed Profile is deliberately
 * not part of this ordering.
 *
 * Passes and checks this run could not evaluate never enter the ranking: an
 * excluded check has no observation to act on, so it is reported as a data
 * source gap instead.
 */
export function analyzeAgentRecommendations(
  agent: AgentKind,
  checks: readonly AgentAuditEvaluatedCheck[],
  records: readonly SeoAuditRecord[],
  options: RankAgentRecommendationOptions = {},
): AgentRecommendationAnalysis {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const displayLimit = Math.max(
    0,
    options.limit ?? AGENT_RECOMMENDATION_DISPLAY_LIMIT,
  );

  const dataSourceGaps = checks
    .filter((check) => String(check.result) === "excluded")
    .map((check) => ({
      id: `${agent}:${check.check.scope}:${check.check.id}`,
      agent,
      check,
      reason: unevaluatedReason(check),
    }));

  const ordered = checks
    .filter((check) => ACTIONABLE_RESULTS.has(String(check.result)))
    .map((check, index) => {
      const evidenceRecords = recommendationEvidenceRecords(
        check,
        recordsById,
        options.targetUrl,
      );
      const observedEvidence = evidenceRecords.filter(
        (record) => record.state === "observed" && record.affected > 0,
      );
      return {
        recommendation: {
          id: `${agent}:${check.check.scope}:${check.check.id}`,
          agent,
          check,
          priority: RESULT_PRIORITY[String(check.result)] ?? "P2",
          evidenceAvailable: observedEvidence.length > 0,
          evidenceRecords,
          reach: observedReach(observedEvidence),
          primaryForAgent: check.check.primaryAgent === agent,
        } satisfies RankedAgentRecommendation,
        index,
      };
    })
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
    .map(({ recommendation }) => recommendation);

  const ranked = ordered.slice(0, displayLimit);
  return {
    ranked,
    rankedTotal: ordered.length,
    displayLimit,
    hiddenCount: ordered.length - ranked.length,
    dataSourceGaps,
  };
}

export function rankAgentRecommendations(
  agent: AgentKind,
  checks: readonly AgentAuditEvaluatedCheck[],
  records: readonly SeoAuditRecord[],
  options: RankAgentRecommendationOptions = {},
): readonly RankedAgentRecommendation[] {
  return analyzeAgentRecommendations(agent, checks, records, options).ranked;
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
