import { describe, expect, it } from "vitest";
import type {
  Availability,
  DataSnapshot,
  Provider,
  SourceConnection,
} from "@/lib/api/hooks-sources";
import {
  SOURCE_PROVIDER_ORDER,
  abbreviateChecksum,
  deriveSourcesReadiness,
  sourceAcquisitionMode,
  sourcePrimaryRowCount,
  sourcesCoveragePercentage,
  sourcesReadyForDiagnosis,
} from "./_sources-readiness.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const CAPTURED_AT = "2026-07-20T08:30:00.000Z";

function snapshot(
  provider: Provider,
  availability: Availability,
): DataSnapshot {
  return {
    id: `snapshot-${provider}`,
    provider,
    datasetKey: `${provider}.canonical.v1`,
    schemaVersion: "0.2.0",
    methodVersion: `${provider}.method.v1`,
    capturedAt: CAPTURED_AT,
    sourceWindow: { start: "2026-06-01", end: "2026-06-30" },
    availability,
    limitation: "Canonical fixture limitation.",
    rowCount: 42,
    checksum: "0123456789abcdef".repeat(4),
  };
}

function source(
  provider: Provider,
  overrides: Partial<SourceConnection> = {},
): SourceConnection {
  const connectionType =
    provider === "crawl"
      ? "public"
      : provider === "gsc" || provider === "ga4"
        ? "oauth"
        : provider === "csv"
          ? "file_import"
          : "api_key_stub";
  return {
    id: provider === "dataforseo" ? null : `source-${provider}`,
    projectId: PROJECT_ID,
    provider,
    connectionType,
    state: provider === "dataforseo" ? "disconnected" : "available",
    externalRef: null,
    scopes: [],
    connectedAt: provider === "dataforseo" ? null : CAPTURED_AT,
    latestSnapshot: null,
    activeRun: null,
    limitation: "Canonical fixture limitation.",
    featureEnabled: provider !== "dataforseo",
    updatedAt: CAPTURED_AT,
    ...overrides,
  };
}

describe("Sources readiness projection", () => {
  it("derives connected, usable, partial, and unavailable counts from canonical slots", () => {
    const sources = [
      source("crawl", { latestSnapshot: snapshot("crawl", "available") }),
      source("gsc", {
        state: "partial",
        latestSnapshot: snapshot("gsc", "partial"),
      }),
      source("ga4", { state: "connected", latestSnapshot: null }),
      source("csv", { latestSnapshot: snapshot("csv", "available") }),
      source("dataforseo"),
    ] as const;

    expect(deriveSourcesReadiness(sources)).toEqual({
      familyCount: 5,
      expectedFamilyCount: 5,
      connectedCount: 4,
      usableCount: 2,
      partialCount: 1,
      unavailableCount: 1,
      enabledCount: 4,
      gapProviders: ["gsc", "ga4"],
      missingProviders: [],
    });
  });

  it("treats a missing canonical family as unavailable without inventing a slot", () => {
    const sources = [
      source("crawl", { latestSnapshot: snapshot("crawl", "available") }),
      source("gsc"),
      source("ga4"),
      source("csv"),
    ] as const;

    expect(deriveSourcesReadiness(sources)).toMatchObject({
      familyCount: 4,
      expectedFamilyCount: 5,
      usableCount: 1,
      partialCount: 0,
      unavailableCount: 3,
      missingProviders: ["dataforseo"],
    });
  });

  it("uses the canonical connection type for live, manual, and disabled modes", () => {
    expect(sourceAcquisitionMode(source("crawl"))).toBe("live");
    expect(sourceAcquisitionMode(source("gsc"))).toBe("live");
    expect(sourceAcquisitionMode(source("csv"))).toBe("manual");
    expect(sourceAcquisitionMode(source("dataforseo"))).toBe("disabled");
  });

  it("computes coverage only across enabled families without promoting connections or partial data", () => {
    const sources = [
      source("crawl", { latestSnapshot: snapshot("crawl", "available") }),
      source("gsc", {
        state: "partial",
        latestSnapshot: snapshot("gsc", "partial"),
      }),
      source("ga4", { state: "connected" }),
      source("csv", { latestSnapshot: snapshot("csv", "available") }),
      source("dataforseo"),
    ] as const;

    expect(sourcesCoveragePercentage(sources)).toBe(50);
    expect(sourcesReadyForDiagnosis(sources)).toBe(false);
  });

  it("reports 4/4 enabled families as 100% and ready when DataForSEO is disabled", () => {
    const sources = [
      source("crawl", { latestSnapshot: snapshot("crawl", "available") }),
      source("gsc", { latestSnapshot: snapshot("gsc", "available") }),
      source("ga4", { latestSnapshot: snapshot("ga4", "available") }),
      source("csv", { latestSnapshot: snapshot("csv", "available") }),
      source("dataforseo"),
    ] as const;

    expect(deriveSourcesReadiness(sources)).toMatchObject({
      enabledCount: 4,
      usableCount: 4,
      unavailableCount: 0,
      gapProviders: [],
    });
    expect(sourcesCoveragePercentage(sources)).toBe(100);
    expect(sourcesReadyForDiagnosis(sources)).toBe(true);
  });

  it("keeps coverage and diagnosis readiness at zero when no family is enabled", () => {
    const sources = SOURCE_PROVIDER_ORDER.map((provider) =>
      source(provider, {
        featureEnabled: false,
        latestSnapshot: snapshot(provider, "available"),
      }),
    );

    expect(deriveSourcesReadiness(sources)).toMatchObject({
      enabledCount: 0,
      usableCount: 0,
    });
    expect(sourcesCoveragePercentage(sources)).toBe(0);
    expect(sourcesReadyForDiagnosis(sources)).toBe(false);
  });

  it("keeps unavailable evidence distinct from a measured zero", () => {
    expect(sourcePrimaryRowCount(source("crawl"))).toBeNull();
    expect(
      sourcePrimaryRowCount(
        source("gsc", {
          latestSnapshot: snapshot("gsc", "unavailable"),
        }),
      ),
    ).toBeNull();
    expect(
      sourcePrimaryRowCount(
        source("csv", {
          latestSnapshot: { ...snapshot("csv", "available"), rowCount: 0 },
        }),
      ),
    ).toBe(0);
    expect(
      sourcePrimaryRowCount(
        source("ga4", {
          latestSnapshot: snapshot("ga4", "partial"),
        }),
      ),
    ).toBe(42);
  });

  it("abbreviates long checksums while preserving both identifying ends", () => {
    const checksum = "0123456789abcdef".repeat(4);

    expect(abbreviateChecksum(checksum)).toBe("0123456789ab…89abcdef");
    expect(abbreviateChecksum("short-checksum")).toBe("short-checksum");
  });
});
