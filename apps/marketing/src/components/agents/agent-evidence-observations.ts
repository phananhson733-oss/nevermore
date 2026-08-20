// @input  -- one evaluated check plus the joined neutral audit ledger
// @output -- exact affected URL/site observations grouped for UI or copy packets
// @pos    -- shared truth-preserving projection used by Stage 02, Stage 04, and AI handoff

import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import { comparableUrl } from "./agent-result-helpers";

export interface AgentAffectedObservationRecordGroup {
  readonly recordId: string;
  readonly values: SeoAuditRecord["observations"][number]["values"];
  readonly source: AgentAuditEvaluatedCheck["check"]["dataSource"];
  readonly truth: AgentAuditEvaluatedCheck["truth"];
}

export interface AgentAffectedObservation {
  readonly url: string | null;
  readonly recordGroups: readonly AgentAffectedObservationRecordGroup[];
}

const SITE_LEVEL_KEY = "\u0000site-level";

/**
 * Join one evaluated check back to the neutral evidence it cited.
 *
 * Canonical comparison is used only for grouping/filtering. The first observed
 * exact URL spelling remains what the user sees and what an AI handoff carries.
 */
export function agentAffectedObservations(
  check: AgentAuditEvaluatedCheck,
  records: readonly SeoAuditRecord[],
  targetUrl?: string,
): readonly AgentAffectedObservation[] {
  const target =
    check.check.scope === "page" ? comparableUrl(targetUrl) : null;
  if (check.check.scope === "page" && target === null) return [];

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const grouped = new Map<
    string,
    { url: string | null; recordGroups: AgentAffectedObservationRecordGroup[] }
  >();
  const seenRecordIds = new Set<string>();

  for (const recordId of check.evidenceRecordIds) {
    if (seenRecordIds.has(recordId)) continue;
    seenRecordIds.add(recordId);
    const record = recordsById.get(recordId);
    if (!record) continue;

    for (const observation of record.observations) {
      const compared = comparableUrl(observation.url);
      if (check.check.scope === "page" && compared !== target) continue;

      const key =
        observation.url === null
          ? SITE_LEVEL_KEY
          : compared ?? `invalid:${observation.url}`;
      const current = grouped.get(key) ?? {
        url: observation.url,
        recordGroups: [],
      };
      current.recordGroups.push({
        recordId: record.id,
        values: observation.values,
        source: check.check.dataSource,
        truth: check.truth,
      });
      if (!grouped.has(key)) grouped.set(key, current);
    }
  }

  return [...grouped.values()].map(({ url, recordGroups }) => ({
    url,
    recordGroups,
  }));
}
