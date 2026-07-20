import type {
  DiagnosticDomain,
  Finding,
  Severity,
} from "@/lib/api/hooks-diagnosis";
import type { Coverage } from "@/lib/api";

export type CoveragePresentationState =
  | "available"
  | "not-run"
  | "unavailable";

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

/**
 * Keep an absent assessment distinct from an evaluated `missing` domain.
 * `coverage === null` means the API has no assessment at all; whether that is
 * because diagnosis never ran or because an existing run lacks coverage is
 * determined by the canonical latest-run presence, never inferred from zeros.
 */
export function resolveCoveragePresentationState(
  coverage: Coverage | null,
  hasEverRun: boolean,
): CoveragePresentationState {
  if (coverage !== null) return "available";
  return hasEverRun ? "unavailable" : "not-run";
}
