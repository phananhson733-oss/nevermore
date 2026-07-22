import {
  AsyncRunsRepository,
  canonicalUtcTimestamptz,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  enqueueRunInTx,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitesRepository,
  type CanonicalValue,
  type DataSnapshotRow,
  type WorkspaceScope,
} from "@sf/db";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import { CRAWL_METHOD_VERSION } from "@sf/sources";
import { CONTRACT_VERSION, type CreateDiagnosticRunRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { isPostgresUniqueViolation } from "./db-errors";
import { toAsyncRunDto, runStatusUrl, type AsyncRunDto } from "./runs";

/**
 * `createDiagnosticRun` (spec §8.1, §8.5, §13.2). Freezes an immutable input
 * manifest (complete ICP version + selected snapshots + rule/prompt set versions
 * + delivery locale), hashes it, and atomically enqueues the diagnostic run.
 * Hard gates: a complete ICP is required (422 CONTEXT_INCOMPLETE) and at least one
 * available/partial crawl snapshot must be selected (422 CRAWL_SNAPSHOT_REQUIRED).
 */

const IDEMPOTENCY_SCOPE = "createDiagnosticRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DIAGNOSTIC_ACTIVE_KEY = "diagnostic";

type DiagnosticRunCommand = Omit<CreateDiagnosticRunRequest, "snapshotIds"> & {
  readonly snapshotIds: readonly string[];
};

export interface DiagnosticAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "diagnostic_run"; id: string };
  readonly location: string;
  readonly replayed: boolean;
}

function snapshotManifestEntry(s: DataSnapshotRow) {
  return {
    snapshotId: s.id,
    provider: s.provider,
    datasetKey: s.dataset_key,
    schemaVersion: s.schema_version,
    methodVersion: s.method_version,
    checksum: s.checksum,
    capturedAt: canonicalUtcTimestamptz(s.captured_at),
    sourceWindow: s.source_window,
    availability: s.availability,
  };
}

export function buildDiagnosticFrozenInput(input: {
  readonly projectId: string;
  readonly siteId: string;
  readonly icp: {
    readonly id: string;
    readonly version: number;
    readonly contentHash: string;
  };
  readonly snapshots: readonly DataSnapshotRow[];
  readonly deliveryLocale: string;
}): {
  readonly manifest: Record<string, unknown>;
  readonly inputHash: string;
} {
  const orderedSnapshots = [...input.snapshots].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
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
    deliveryLocale: input.deliveryLocale,
  };
  return {
    manifest,
    inputHash: contentHash(manifest as CanonicalValue),
  };
}

/**
 * A diagnostic manifest may freeze one snapshot per provider. CSV and
 * DataForSEO may coexist: they share a logical keyword-gap slot, but retain
 * distinct provider lineage and are de-duplicated by the engine at cluster
 * level rather than by discarding one immutable source.
 */
export function assertDiagnosticSnapshotSelection(
  snapshots: readonly Pick<DataSnapshotRow, "provider">[],
): void {
  const providers = snapshots.map((snapshot) => snapshot.provider);
  if (new Set(providers).size !== providers.length) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Select at most one snapshot per provider.",
    );
  }
}

/**
 * Snapshot selection is the diagnostic's exact Site identity. Deriving it from
 * immutable snapshots avoids silently substituting the project's primary Site
 * when a project legitimately owns more than one Site.
 */
export function diagnosticSnapshotSiteId(
  snapshots: readonly Pick<DataSnapshotRow, "site_id">[],
): string {
  const siteId = snapshots[0]?.site_id;
  if (!siteId || snapshots.some((snapshot) => snapshot.site_id !== siteId)) {
    throw new ProblemError(
      "SNAPSHOT_PROJECT_MISMATCH",
      "Selected snapshots must belong to one site.",
    );
  }
  return siteId;
}

function replay(
  row: {
    request_hash: string;
    status: string;
    resource_id: string | null;
    response_body: unknown;
  },
  requestHash: string,
): DiagnosticAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key reused with a different body.",
    );
  }
  if (row.status === "completed" && row.resource_id) {
    const body = row.response_body as {
      run: AsyncRunDto;
      statusUrl: string;
      resourceRef: { type: "diagnostic_run"; id: string };
    } | null;
    if (body?.run) {
      return {
        status: 202,
        run: body.run,
        statusUrl: body.statusUrl,
        resourceRef: body.resourceRef,
        location: body.statusUrl,
        replayed: true,
      };
    }
  }
  return null;
}

export async function createDiagnosticRun(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: DiagnosticRunCommand,
): Promise<DiagnosticAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  // Request array order is part of the wire body. The immutable input manifest
  // is sorted separately after a replay miss.
  const requestHash = contentHash({
    projectId,
    snapshotIds: body.snapshotIds,
    outputLocale: body.outputLocale,
  });

  // The accepted command is stable even if the project, ICP pointer, or
  // snapshots later change. Consult its workspace-scoped key first; projectId
  // in the hash prevents cross-project response replay.
  const idem = new IdempotencyRepository(db);
  const existing = await idem.find(
    scope.workspaceId,
    IDEMPOTENCY_SCOPE,
    idempotencyKey,
  );
  if (existing) {
    const replayed = replay(existing, requestHash);
    if (replayed) return replayed;
  }

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at)
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");

  // Hard gate 1: a reviewed COMPLETE profile is required. The working/current
  // pointer may advance to a later draft; diagnostics must freeze only the
  // customer's separately confirmed version.
  if (!project.confirmed_icp_profile_id) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "A confirmed product profile is required to diagnose.",
    );
  }
  const icp = await new IcpProfilesRepository(db).findById(
    projectScope,
    project.confirmed_icp_profile_id,
  );
  if (!icp || icp.status !== "complete") {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The product profile must be confirmed before diagnosis.",
    );
  }

  // Load + validate the selected snapshots (project-scoped).
  const snapshots = await new DataSnapshotsRepository(db).findByIds(
    projectScope,
    body.snapshotIds,
  );
  if (snapshots.length !== body.snapshotIds.length) {
    throw new ProblemError(
      "SNAPSHOT_PROJECT_MISMATCH",
      "A selected snapshot does not belong to this project.",
    );
  }
  const selectedSiteId = diagnosticSnapshotSiteId(snapshots);
  const site = await new SitesRepository(db).findById(
    projectScope,
    selectedSiteId,
  );
  if (!site) {
    throw new ProblemError(
      "SNAPSHOT_PROJECT_MISMATCH",
      "The selected snapshot site does not belong to this project.",
    );
  }
  // Hard gate 2: at least one usable crawl snapshot.
  if (
    !snapshots.some(
      (s) =>
        s.provider === "crawl" &&
        s.method_version === CRAWL_METHOD_VERSION &&
        (s.availability === "available" || s.availability === "partial"),
    )
  ) {
    throw new ProblemError(
      "CRAWL_SNAPSHOT_REQUIRED",
      "A crawl snapshot is required to diagnose.",
    );
  }
  // One immutable snapshot per provider keeps lineage unambiguous. CSV and
  // DataForSEO may coexist; the engine de-duplicates shared keyword demand by
  // canonical cluster identity instead of discarding either source.
  assertDiagnosticSnapshotSelection(snapshots);

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const active = await new AsyncRunsRepository(db).findActive(
    projectScope,
    DIAGNOSTIC_ACTIVE_KEY,
  );
  if (active) {
    const now = await idem.find(
      scope.workspaceId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
    );
    const replayed = now ? replay(now, requestHash) : null;
    if (replayed) return replayed;
    throw new ProblemError(
      "RUN_ALREADY_ACTIVE",
      "A diagnostic run is already active.",
      {
        headers: { Location: runStatusUrl(projectId, active.id) },
      },
    );
  }

  const boss = await getBoss();
  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
      const txProjects = new ProjectsRepository(tx);
      const txIcp = new IcpProfilesRepository(tx);
      const txSites = new SitesRepository(tx);
      const txSnapshots = new DataSnapshotsRepository(tx);
      const reserved = await txIdem.begin({
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        expiresAt,
      });
      if (!reserved) {
        const now = await txIdem.find(
          scope.workspaceId,
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
        );
        const replayed = now ? replay(now, requestHash) : null;
        if (replayed) return replayed;
        throw new ProblemError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key is being processed.",
        );
      }

      const currentProject = await txProjects.findByIdForUpdate(scope, projectId);
      if (!currentProject) {
        throw new ProblemError("NOT_FOUND", "Project not found.");
      }
      if (currentProject.archived_at) {
        throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
      }
      if (!currentProject.confirmed_icp_profile_id) {
        throw new ProblemError(
          "CONTEXT_INCOMPLETE",
          "A confirmed product profile is required to diagnose.",
        );
      }

      const confirmedIcp = await txIcp.findById(
        projectScope,
        currentProject.confirmed_icp_profile_id,
      );
      if (!confirmedIcp || confirmedIcp.status !== "complete") {
        throw new ProblemError(
          "CONTEXT_INCOMPLETE",
          "The product profile must be confirmed before diagnosis.",
        );
      }

      const currentSnapshots = await txSnapshots.findByIds(
        projectScope,
        body.snapshotIds,
      );
      if (currentSnapshots.length !== body.snapshotIds.length) {
        throw new ProblemError(
          "SNAPSHOT_PROJECT_MISMATCH",
          "A selected snapshot does not belong to this project.",
        );
      }
      const currentSiteId = diagnosticSnapshotSiteId(currentSnapshots);
      const currentSite = await txSites.findById(
        projectScope,
        currentSiteId,
      );
      if (!currentSite) {
        throw new ProblemError(
          "SNAPSHOT_PROJECT_MISMATCH",
          "The selected snapshot site does not belong to this project.",
        );
      }
      if (
        !currentSnapshots.some(
          (snapshot) =>
            snapshot.provider === "crawl" &&
            snapshot.method_version === CRAWL_METHOD_VERSION &&
            (snapshot.availability === "available" ||
              snapshot.availability === "partial"),
        )
      ) {
        throw new ProblemError(
          "CRAWL_SNAPSHOT_REQUIRED",
          "A crawl snapshot is required to diagnose.",
        );
      }
      assertDiagnosticSnapshotSelection(currentSnapshots);

      const frozenInput = buildDiagnosticFrozenInput({
        projectId,
        siteId: currentSite.id,
        icp: {
          id: confirmedIcp.id,
          version: confirmedIcp.version,
          contentHash: confirmedIcp.content_hash,
        },
        snapshots: currentSnapshots,
        deliveryLocale: body.outputLocale,
      });

      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "diagnostic",
        activeKey: DIAGNOSTIC_ACTIVE_KEY,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          snapshotIds: [...body.snapshotIds],
          outputLocale: body.outputLocale,
        },
      });
      await new DiagnosticRunsRepository(tx).insert({
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        siteId: currentSite.id,
        icpProfileId: confirmedIcp.id,
        icpProfileVersion: confirmedIcp.version,
        ruleSetVersion: RULE_SET_VERSION,
        promptSetVersion: PROMPT_SET_VERSION,
        outputLocale: body.outputLocale,
        inputManifest: frozenInput.manifest,
        inputHash: frozenInput.inputHash,
      });
      await enqueueRunInTx(boss, tx, "diagnose", {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });
      await new ProjectsRepository(tx).setStage(
        scope,
        projectId,
        "diagnosing",
      );

      const dto = toAsyncRunDto(run);
      const statusUrl = runStatusUrl(projectId, run.id);
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody: {
          run: dto,
          statusUrl,
          resourceRef: { type: "diagnostic_run", id: run.id },
        },
        resourceType: "diagnostic_run",
        resourceId: run.id,
      });

      return {
        status: 202,
        run: dto,
        statusUrl,
        resourceRef: { type: "diagnostic_run" as const, id: run.id },
        location: statusUrl,
        replayed: false,
      };
    });
  } catch (error) {
    // Lost the active-key race: the partial unique index aborted the insert.
    if (
      isPostgresUniqueViolation(error, "async_runs_one_active_key_idx")
    ) {
      const winnerKey = await idem.find(
        scope.workspaceId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
      );
      const replayed = winnerKey ? replay(winnerKey, requestHash) : null;
      if (replayed) return replayed;
      const winner = await new AsyncRunsRepository(db).findActive(
        projectScope,
        DIAGNOSTIC_ACTIVE_KEY,
      );
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A diagnostic run is already active.",
        {
          ...(winner
            ? { headers: { Location: runStatusUrl(projectId, winner.id) } }
            : {}),
        },
      );
    }
    throw error;
  }
}
