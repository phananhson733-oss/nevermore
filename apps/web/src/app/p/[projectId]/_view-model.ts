/**
 * Pure presentation rules shared by the project screens. Keeping these rules
 * outside React makes the data-honesty boundaries deterministic and cheap to
 * regression-test.
 */

interface SourceLimitationProjection {
  readonly limitation: string;
  readonly latestSnapshot: { readonly limitation: string } | null;
}

/**
 * Once a snapshot exists, its limitation describes the data that is actually
 * being shown. The connection limitation describes only the pre-snapshot
 * capability and may still contain the historical "no snapshot" placeholder.
 */
export function sourceLimitationForDisplay(
  source: SourceLimitationProjection,
): string {
  const snapshotLimitation = source.latestSnapshot?.limitation.trim();
  return snapshotLimitation && snapshotLimitation.length > 0
    ? snapshotLimitation
    : source.limitation;
}

/** De-duplicate projection joins inside one finding, never across findings. */
export function evidenceForFinding<T extends { readonly id: string }>(
  evidence: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** De-duplicate exact strings inside one semantic list, preserving order. */
export function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * Coverage already owns its limitations panel. The methodology footer keeps
 * only distinct, footer-specific limitations, preserving their source order.
 */
export function reportFooterLimitations(
  coverageLimitations: readonly string[],
  reportLimitations: readonly string[],
): readonly string[] {
  const coverage = new Set(coverageLimitations);
  const seen = new Set<string>();
  return reportLimitations.filter((limitation) => {
    if (coverage.has(limitation) || seen.has(limitation)) return false;
    seen.add(limitation);
    return true;
  });
}
