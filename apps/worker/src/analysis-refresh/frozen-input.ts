import {
  canonicalUtcTimestamptz,
  contentHash,
  type CanonicalValue,
  type DataSnapshotRow,
} from "@sf/db";
import {
  GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
} from "@sf/contracts";
import {
  buildContextProjectionV1,
  parseContextProjectionV1,
  parseGovernanceProjectionV1,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
  type GovernanceProjectionV1,
} from "@sf/engine";

export const GROWTH_AUDIT_ACTIVE_KEY = "growth_audit" as const;
export const GROWTH_AUDIT_CAPABILITY_ID = "growth-audit" as const;
export const GROWTH_AUDIT_CAPABILITY_VERSION = "0.3.0" as const;

function snapshotManifestEntry(snapshot: DataSnapshotRow) {
  return {
    snapshotId: snapshot.id,
    provider: snapshot.provider,
    datasetKey: snapshot.dataset_key,
    schemaVersion: snapshot.schema_version,
    methodVersion: snapshot.method_version,
    checksum: snapshot.checksum,
    capturedAt: canonicalUtcTimestamptz(snapshot.captured_at),
    sourceWindow: snapshot.source_window,
    availability: snapshot.availability,
  };
}

/**
 * Strict worker-local isomorph of the canonical diagnostic input freezer.
 * Snapshot IDs are sorted independently from plan/provider order, exactly as
 * normal diagnostic and Growth Audit commands do.
 */
export function buildAnalysisRefreshDiagnosticFrozenInput(input: {
  readonly projectId: string;
  readonly siteId: string;
  readonly icp: {
    readonly id: string;
    readonly version: number;
    readonly contentHash: string;
    readonly profile: unknown;
  };
  readonly siteLanguageCodes: readonly string[];
  readonly snapshots: readonly DataSnapshotRow[];
  readonly outputLocale: string;
  readonly governance: GovernanceProjectionV1;
}): {
  readonly manifest: Record<string, unknown>;
  readonly inputHash: string;
} {
  const orderedSnapshots = [...input.snapshots].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const governance = parseGovernanceProjectionV1(input.governance);
  const contextProjection = parseContextProjectionV1(
    buildContextProjectionV1({
      profile: input.icp.profile,
      profileContentHash: input.icp.contentHash,
      siteLanguageCodes: input.siteLanguageCodes,
    }),
  );
  const manifest = {
    projectId: input.projectId,
    siteId: input.siteId,
    icp: {
      id: input.icp.id,
      version: input.icp.version,
      contentHash: input.icp.contentHash,
    },
    snapshots: orderedSnapshots.map(snapshotManifestEntry),
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: input.outputLocale,
    governance,
    contextProjection,
  };
  return {
    manifest,
    inputHash: contentHash(manifest as unknown as CanonicalValue),
  };
}

/**
 * Capability addressing deliberately keeps selected snapshot IDs in the
 * server-owned plan/provider order. This mirrors createGrowthAuditRun; the
 * diagnostic manifest above owns its separate canonical ID sort.
 */
export function growthAuditCapabilityManifestHash(input: {
  readonly projectId: string;
  readonly siteId: string;
  readonly icpProfileId: string;
  readonly selectedSnapshotIds: readonly string[];
  readonly outputLocale: string;
}): string {
  return contentHash({
    capabilityId: GROWTH_AUDIT_CAPABILITY_ID,
    capabilityVersion: GROWTH_AUDIT_CAPABILITY_VERSION,
    capabilityContractVersion:
      GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
    projectId: input.projectId,
    siteId: input.siteId,
    icpProfileId: input.icpProfileId,
    scope: { kind: "site" },
    selectedSnapshotIds: [...input.selectedSnapshotIds],
    outputLocale: input.outputLocale,
  });
}
