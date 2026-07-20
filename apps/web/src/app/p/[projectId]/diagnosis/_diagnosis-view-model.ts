import type {
  DiagnosticDomain,
  Finding,
  Severity,
} from "@/lib/api/hooks-diagnosis";

export interface FindingFilters {
  readonly domain: DiagnosticDomain | "all";
  readonly severity: Severity | "all";
}

/**
 * Filter the immutable findings page already owned by TanStack Query. This is a
 * view-only intersection over canonical DTO fields; it never re-fetches,
 * re-scores, or synthesizes findings.
 */
export function filterCanonicalFindings(
  findings: readonly Finding[],
  filters: FindingFilters,
): readonly Finding[] {
  return findings.filter(
    (finding) =>
      (filters.domain === "all" || finding.domain === filters.domain) &&
      (filters.severity === "all" || finding.severity === filters.severity),
  );
}
