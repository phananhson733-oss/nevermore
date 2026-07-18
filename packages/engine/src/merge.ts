import type {
  EvidenceDraft,
  FindingCandidate,
  RuleId,
  Severity,
} from "./rule.ts";
import { FINDING_REGISTRY } from "./registry.ts";
import { canonicalize, contentHash } from "./util/hash.ts";

/**
 * Run-internal merge + cross-run identity (spec §8.6).
 *  - Run-internal merge key: canonical `{domain, ruleFamily, sortedSubjectRefs, intent}`.
 *  - Cross-run finding key: sha256 of canonical `{projectId, domain, ruleFamily,
 *    sortedSubjectRefs, intent}`.
 * Aggregate rules use a stable subjectRef SET key; member URLs live in evidence,
 * never in the key, so slash/member churn never splits a finding.
 */

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export interface MergedCandidate {
  readonly ruleId: RuleId;
  readonly ruleFamily: string;
  readonly intent: string;
  readonly domain: string;
  readonly subjectRefs: readonly string[];
  readonly severity: Severity;
  readonly titleArgs: Record<string, string | number>;
  readonly metrics: Record<string, number | string | null>;
  readonly evidence: readonly EvidenceDraft[];
}

function sortedSubjectRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)].sort();
}

function mergeKey(ruleId: RuleId, subjectRefs: readonly string[]): string {
  const meta = FINDING_REGISTRY[ruleId];
  // Canonical field name is `sortedSubjectRefs` per spec §8.6.
  return canonicalize({
    domain: meta.domain,
    ruleFamily: meta.ruleFamily,
    sortedSubjectRefs: sortedSubjectRefs(subjectRefs),
    intent: meta.intent,
  });
}

/** The stable cross-run finding key for a merged candidate (spec §8.6). */
export function findingKey(
  projectId: string,
  ruleId: RuleId,
  subjectRefs: readonly string[],
): string {
  const meta = FINDING_REGISTRY[ruleId];
  return contentHash({
    projectId,
    domain: meta.domain,
    ruleFamily: meta.ruleFamily,
    sortedSubjectRefs: sortedSubjectRefs(subjectRefs),
    intent: meta.intent,
  });
}

/**
 * Merge candidates emitted within one run: candidates sharing a merge key union
 * their evidence and subject refs and keep the highest severity. Rule order is
 * preserved for determinism.
 */
export function mergeRunCandidates(
  perRule: readonly {
    ruleId: RuleId;
    candidates: readonly FindingCandidate[];
  }[],
): MergedCandidate[] {
  const byKey = new Map<string, MergedCandidate>();
  for (const { ruleId, candidates } of perRule) {
    const meta = FINDING_REGISTRY[ruleId];
    for (const candidate of candidates) {
      const key = mergeKey(ruleId, candidate.subjectRefs);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          ruleId,
          ruleFamily: meta.ruleFamily,
          intent: meta.intent,
          domain: meta.domain,
          subjectRefs: sortedSubjectRefs(candidate.subjectRefs),
          severity: candidate.severity,
          titleArgs: candidate.titleArgs,
          metrics: candidate.metrics,
          evidence: candidate.evidence,
        });
        continue;
      }
      const severity =
        SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[existing.severity]
          ? candidate.severity
          : existing.severity;
      byKey.set(key, {
        ...existing,
        severity,
        evidence: [...existing.evidence, ...candidate.evidence],
      });
    }
  }
  return [...byKey.values()];
}
