import {
  DataSnapshotsRepository,
  GrowthMapReadRepository,
  MAX_GROWTH_MAP_SNAPSHOT_LOOKUP,
  type Executor,
  type GrowthMapReadableRunRow,
  type ProjectScope,
} from "@sf/db";
import type { GovernanceProjectionV1 } from "@sf/engine";
import { ProblemError } from "@sf/observability";
import {
  validateGrowthMapFrozenRun,
  type FrozenGrowthMapRun,
} from "./growth-map-projection";

export interface PublishedGrowthMapGeneration {
  readonly run: GrowthMapReadableRunRow;
  readonly frozen: FrozenGrowthMapRun;
  readonly governance: GovernanceProjectionV1;
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function corruptPublishedGeneration(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The published Growth Map generation failed its provenance checks.",
  );
}

function manifestSnapshotIds(run: GrowthMapReadableRunRow): string[] {
  const raw = run.input_manifest["snapshots"];
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > MAX_GROWTH_MAP_SNAPSHOT_LOOKUP
  ) {
    return corruptPublishedGeneration();
  }
  const ids: string[] = [];
  const uniqueIds = new Set<string>();
  for (const entry of raw) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry)
    ) {
      return corruptPublishedGeneration();
    }
    const snapshotId = (entry as Record<string, unknown>)["snapshotId"];
    if (
      typeof snapshotId !== "string" ||
      snapshotId.length === 0 ||
      snapshotId.trim() !== snapshotId ||
      !CANONICAL_UUID.test(snapshotId) ||
      uniqueIds.has(snapshotId)
    ) {
      return corruptPublishedGeneration();
    }
    ids.push(snapshotId);
    uniqueIds.add(snapshotId);
  }
  return ids;
}

/**
 * Resolve the only customer-visible Growth Map generation.
 *
 * The repository admits a DiagnosticRun only after its owning Analysis
 * Refresh has reached a publishable terminal state. The immutable diagnostic
 * manifest then supplies the exact URL, Keyword, and Competitor generation;
 * callers must never widen membership from the current mutable libraries.
 */
export async function loadPublishedGrowthMapGeneration(
  exec: Executor,
  scope: ProjectScope,
  diagnosticRunId?: string | null,
): Promise<PublishedGrowthMapGeneration> {
  const repository = new GrowthMapReadRepository(exec);
  const run =
    diagnosticRunId === undefined || diagnosticRunId === null
      ? await repository.findLatestReadableRun(scope)
      : await repository.findReadableRunById(scope, diagnosticRunId);
  if (!run) {
    throw new ProblemError(
      "GROWTH_MAP_AUDIT_NOT_FOUND",
      "No completed Growth Map audit is available for this project.",
    );
  }

  const snapshotIds = manifestSnapshotIds(run);
  const snapshots = await new DataSnapshotsRepository(exec).findByIds(
    scope,
    snapshotIds,
  );
  let frozen: FrozenGrowthMapRun;
  try {
    frozen = validateGrowthMapFrozenRun(run, snapshots, scope);
  } catch {
    return corruptPublishedGeneration();
  }
  const governance = frozen.governance;
  if (governance === undefined) return corruptPublishedGeneration();
  return {
    run,
    frozen,
    governance,
  };
}
