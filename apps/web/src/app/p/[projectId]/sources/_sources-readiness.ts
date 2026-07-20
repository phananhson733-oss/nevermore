import type {
  Provider,
  SourceConnection,
} from "@/lib/api/hooks-sources";

/** Canonical provider order promised by the Sources API. */
export const SOURCE_PROVIDER_ORDER: readonly Provider[] = [
  "crawl",
  "gsc",
  "ga4",
  "csv",
  "dataforseo",
];

export type SourceAcquisitionMode = "live" | "manual" | "disabled";

export interface SourcesReadiness {
  readonly familyCount: number;
  readonly expectedFamilyCount: number;
  readonly connectedCount: number;
  readonly usableCount: number;
  readonly partialCount: number;
  readonly unavailableCount: number;
  readonly enabledCount: number;
  readonly gapProviders: readonly Provider[];
  readonly missingProviders: readonly Provider[];
}

/**
 * Present the existing connection type as an acquisition mode. Feature-disabled
 * slots remain explicit instead of looking like a live integration.
 */
export function sourceAcquisitionMode(
  source: SourceConnection,
): SourceAcquisitionMode {
  if (!source.featureEnabled) return "disabled";
  return source.connectionType === "file_import" ? "manual" : "live";
}

/**
 * Derive page readiness from canonical SourceConnection/DataSnapshot fields.
 * `available`, `partial`, and `unavailable` are snapshot facts; a connection by
 * itself never contributes usable data. Missing provider slots count as
 * unavailable while remaining separately visible as a contract-completeness gap.
 */
export function deriveSourcesReadiness(
  sources: readonly SourceConnection[],
): SourcesReadiness {
  const byProvider = new Map<Provider, SourceConnection>();
  for (const source of sources) {
    if (!byProvider.has(source.provider)) byProvider.set(source.provider, source);
  }

  const canonicalSources = SOURCE_PROVIDER_ORDER.flatMap((provider) => {
    const source = byProvider.get(provider);
    return source ? [source] : [];
  });
  const missingProviders = SOURCE_PROVIDER_ORDER.filter(
    (provider) => !byProvider.has(provider),
  );
  const enabledSources = canonicalSources.filter(
    (source) => source.featureEnabled,
  );
  const usableCount = enabledSources.filter(
    (source) => source.latestSnapshot?.availability === "available",
  ).length;
  const partialCount = enabledSources.filter(
    (source) => source.latestSnapshot?.availability === "partial",
  ).length;
  const enabledCount = enabledSources.length;

  return {
    familyCount: canonicalSources.length,
    expectedFamilyCount: SOURCE_PROVIDER_ORDER.length,
    connectedCount: enabledSources.filter(
      (source) => source.id !== null && source.state !== "disconnected",
    ).length,
    usableCount,
    partialCount,
    unavailableCount: enabledCount - usableCount - partialCount,
    enabledCount,
    gapProviders: enabledSources
      .filter(
        (source) =>
          source.featureEnabled &&
          source.latestSnapshot?.availability !== "available",
      )
      .map((source) => source.provider),
    missingProviders,
  };
}

/**
 * Coverage is intentionally strict: only a fully available latest snapshot
 * contributes. A connection or a partial snapshot is useful context, but it is
 * not silently promoted to complete evidence.
 */
export function sourcesCoveragePercentage(
  sources: readonly SourceConnection[],
): number {
  const readiness = deriveSourcesReadiness(sources);
  if (readiness.enabledCount === 0) return 0;
  return Math.round(
    (readiness.usableCount / readiness.enabledCount) * 100,
  );
}

/** Diagnosis is ready only when every enabled canonical family is usable. */
export function sourcesReadyForDiagnosis(
  sources: readonly SourceConnection[],
): boolean {
  const readiness = deriveSourcesReadiness(sources);
  return (
    readiness.enabledCount > 0 &&
    readiness.usableCount === readiness.enabledCount &&
    readiness.gapProviders.length === 0 &&
    readiness.missingProviders.length === 0
  );
}

/**
 * Value used for the large card metric. `null` means "not available" and must
 * remain visually distinct from a measured zero. Partial snapshots keep their
 * real row count while their status continues to communicate the limitation.
 */
export function sourcePrimaryRowCount(
  source: SourceConnection,
): number | null {
  const snapshot = source.latestSnapshot;
  if (snapshot === null || snapshot.availability === "unavailable") {
    return null;
  }
  return snapshot.rowCount;
}

/** Keep checksums scannable without rendering the full immutable digest. */
export function abbreviateChecksum(checksum: string): string {
  if (checksum.length <= 24) return checksum;
  return `${checksum.slice(0, 12)}…${checksum.slice(-8)}`;
}
