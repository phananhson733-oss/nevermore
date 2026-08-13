// @input  -- filtered SeoAuditRecord and SeoAuditCoverage facts
// @output -- deterministic opportunity ordering and honest evaluation summaries
// @pos    -- pure presentation derivations for both Agent result surfaces

import type { SeoAuditCoverage, SeoAuditRecord } from "@sf/public-tools";

export interface AgentRecordSummary {
  readonly total: number;
  readonly evaluated: number;
  readonly unverified: number;
  readonly observed: number;
  readonly notObserved: number;
}

/**
 * Issue opportunities are observed conditions, never site-resource discovery.
 * Their order is reach (affected observation count), not severity or impact.
 */
export function topObservedOpportunities(
  records: readonly SeoAuditRecord[],
): readonly SeoAuditRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) =>
        record.state === "observed" &&
        record.affected > 0 &&
        record.unit !== "site_resource",
    )
    .toSorted(
      (left, right) =>
        right.record.affected - left.record.affected ||
        left.index - right.index,
    )
    .slice(0, 3)
    .map(({ record }) => record);
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
