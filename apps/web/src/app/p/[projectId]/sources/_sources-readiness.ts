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
  const usableCount = canonicalSources.filter(
    (source) => source.latestSnapshot?.availability === "available",
  ).length;
  const partialCount = canonicalSources.filter(
    (source) => source.latestSnapshot?.availability === "partial",
  ).length;

  return {
    familyCount: canonicalSources.length,
    expectedFamilyCount: SOURCE_PROVIDER_ORDER.length,
    connectedCount: canonicalSources.filter(
      (source) => source.id !== null && source.state !== "disconnected",
    ).length,
    usableCount,
    partialCount,
    unavailableCount:
      SOURCE_PROVIDER_ORDER.length - usableCount - partialCount,
    enabledCount: canonicalSources.filter((source) => source.featureEnabled)
      .length,
    gapProviders: canonicalSources
      .filter(
        (source) =>
          source.featureEnabled &&
          source.latestSnapshot?.availability !== "available",
      )
      .map((source) => source.provider),
    missingProviders,
  };
}

/** Keep checksums scannable without rendering the full immutable digest. */
export function abbreviateChecksum(checksum: string): string {
  if (checksum.length <= 24) return checksum;
  return `${checksum.slice(0, 12)}…${checksum.slice(-8)}`;
}
