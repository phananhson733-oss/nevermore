import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  GROWTH_AUDIT_PROJECTION_VERSION,
  ProjectsRepository,
  type Executor,
  type ProjectScope,
} from "@sf/db";
import { asyncRuns } from "@sf/db/schema";

const COLLECTION_STEP_KEYS = [
  "crawl",
  "gsc",
  "ga4",
  "dataforseo",
  "dataforseo_backlinks",
] as const;
const OPTIONAL_STEP_KEYS = [
  "gsc",
  "ga4",
  "dataforseo",
  "dataforseo_backlinks",
] as const;

function collectionStepKeyForSnapshot(
  snapshot: Awaited<
    ReturnType<DataSnapshotsRepository["findByIds"]>
  >[number],
): (typeof COLLECTION_STEP_KEYS)[number] | null {
  if (snapshot.provider === "dataforseo") {
    return snapshot.dataset_key === "dataforseo.backlinks.v1" &&
      snapshot.schema_version === "dataforseo.backlinks.v1" &&
      snapshot.method_version === "dataforseo.backlinks.v1"
      ? "dataforseo_backlinks"
      : "dataforseo";
  }
  return COLLECTION_STEP_KEYS.includes(
    snapshot.provider as (typeof COLLECTION_STEP_KEYS)[number],
  )
    ? (snapshot.provider as (typeof COLLECTION_STEP_KEYS)[number])
    : null;
}

function manifestSnapshotIds(manifest: Record<string, unknown>): string[] {
  const snapshots = manifest["snapshots"];
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw new Error("published diagnostic fixture requires frozen Snapshots");
  }
  return snapshots.map((snapshot) => {
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      Array.isArray(snapshot) ||
      typeof (snapshot as Record<string, unknown>)["snapshotId"] !== "string"
    ) {
      throw new Error("published diagnostic fixture has an invalid Snapshot");
    }
    return (snapshot as Record<string, string>)["snapshotId"]!;
  });
}

/**
 * Attach an already completed DiagnosticRun to the exact Analysis Refresh
 * publication lineage required by customer-facing Growth Map readers.
 *
 * The helper deliberately does not manufacture the diagnostic, snapshots, or
 * confirmed Product Profile. Callers must seed those canonical inputs first.
 */
export async function publishDiagnosticGeneration(
  exec: Executor,
  input: {
    readonly scope: ProjectScope;
    readonly diagnosticRunId: string;
    readonly actorId: string;
    readonly completedAt: string;
    readonly topicModelOutcome?: "skipped" | "failed";
  },
): Promise<{
  readonly analysisRefreshRunId: string;
  readonly auditRunId: string;
}> {
  const diagnostic = await new DiagnosticRunsRepository(exec).findById(
    input.scope,
    input.diagnosticRunId,
  );
  if (!diagnostic) {
    throw new Error("published diagnostic fixture is missing its DiagnosticRun");
  }
  const runs = new AsyncRunsRepository(exec);
  const canonicalRun = await runs.findById(
    input.scope,
    input.diagnosticRunId,
  );
  if (
    !canonicalRun ||
    (canonicalRun.status !== "completed" &&
      canonicalRun.status !== "partial") ||
    canonicalRun.result_type !== "diagnostic_run" ||
    canonicalRun.result_id !== input.diagnosticRunId
  ) {
    throw new Error(
      "published diagnostic fixture requires a terminal canonical result",
    );
  }
  const project = await new ProjectsRepository(exec).findById(
    { workspaceId: input.scope.workspaceId },
    input.scope.projectId,
  );
  if (
    !project ||
    project.confirmed_icp_profile_id !== diagnostic.icp_profile_id
  ) {
    throw new Error(
      "published diagnostic fixture requires the frozen confirmed Product Profile",
    );
  }

  const audits = new AuditRunsRepository(exec);
  let audit = await audits.findByDiagnosticRunId(
    input.scope,
    input.diagnosticRunId,
  );
  if (!audit) {
    await new CapabilityRunsRepository(exec).create({
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
      asyncRunId: input.diagnosticRunId,
      capabilityId: "growth-audit",
      capabilityVersion: "0.3.0",
      inputManifestHash: contentHash({
        diagnosticRunId: input.diagnosticRunId,
      }),
      mode: "production",
      sideEffectClass: "read_only",
    });
    audit = await audits.create({
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
      diagnosticRunId: input.diagnosticRunId,
      capabilityRunId: input.diagnosticRunId,
      scopeKind: "site",
      scopeKey: diagnostic.site_id,
      projectionVersion: GROWTH_AUDIT_PROJECTION_VERSION,
    });
  }
  if (
    audit.projection_version !== GROWTH_AUDIT_PROJECTION_VERSION ||
    audit.scope_kind !== "site" ||
    audit.scope_key !== diagnostic.site_id
  ) {
    throw new Error(
      "published diagnostic fixture has a non-canonical Growth Audit projection",
    );
  }

  const snapshotIds = manifestSnapshotIds(diagnostic.input_manifest);
  const snapshots = await new DataSnapshotsRepository(exec).findByIds(
    input.scope,
    snapshotIds,
  );
  if (snapshots.length !== snapshotIds.length) {
    throw new Error("published diagnostic fixture Snapshot lineage is incomplete");
  }
  const snapshotByProvider = new Map<
    (typeof COLLECTION_STEP_KEYS)[number],
    (typeof snapshots)[number]
  >();
  for (const snapshot of snapshots) {
    if (snapshot.site_id !== diagnostic.site_id) {
      throw new Error(
        "published diagnostic fixture cannot publish foreign-site Snapshots",
      );
    }
    const stepKey = collectionStepKeyForSnapshot(snapshot);
    if (!stepKey) {
      continue;
    }
    if (snapshotByProvider.has(stepKey)) {
      throw new Error(
        `published diagnostic fixture has duplicate ${stepKey} Snapshots`,
      );
    }
    const collectionRun = await runs.findById(
      input.scope,
      snapshot.collection_run_id,
    );
    if (
      !collectionRun ||
      (collectionRun.status !== "completed" &&
        collectionRun.status !== "partial") ||
      collectionRun.kind !== "collection" ||
      collectionRun.result_type !== "collection_run" ||
      collectionRun.result_id !== collectionRun.id ||
      collectionRun.completed_at === null ||
      snapshot.availability === "unavailable"
    ) {
      throw new Error(
        `published diagnostic fixture ${stepKey} Snapshot lacks a terminal canonical collection`,
      );
    }
    snapshotByProvider.set(stepKey, snapshot);
  }
  if (!snapshotByProvider.has("crawl")) {
    throw new Error("published diagnostic fixture requires one Crawl Snapshot");
  }

  const analysisRefreshRunId = randomUUID();
  await exec.insert(asyncRuns).values({
    id: analysisRefreshRunId,
    workspace_id: input.scope.workspaceId,
    project_id: input.scope.projectId,
    kind: "analysis_refresh",
    status: "running",
    result_type: "analysis_refresh_run",
    result_id: analysisRefreshRunId,
    initiated_by: input.actorId,
    queued_at: input.completedAt,
    started_at: input.completedAt,
  });
  const refreshes = new AnalysisRefreshRunsRepository(exec);
  await refreshes.create({
    runId: analysisRefreshRunId,
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    siteId: diagnostic.site_id,
    icpProfileId: diagnostic.icp_profile_id,
  });

  for (const stepKey of COLLECTION_STEP_KEYS) {
    const snapshot = snapshotByProvider.get(stepKey);
    if (!snapshot) {
      if (stepKey === "crawl") {
        throw new Error("published diagnostic fixture lost its Crawl Snapshot");
      }
      if (
        !(await refreshes.skipStep(
          input.scope,
          analysisRefreshRunId,
          stepKey,
          "Provider is not present in this deterministic integration fixture.",
        ))
      ) {
        throw new Error(`could not skip fixture ${stepKey} step`);
      }
      continue;
    }
    if (
      !(await refreshes.startStep(
        input.scope,
        analysisRefreshRunId,
        stepKey,
        snapshot.collection_run_id,
      )) ||
      !(await refreshes.completeStep(
        input.scope,
        analysisRefreshRunId,
        stepKey,
        {
          childAsyncRunId: snapshot.collection_run_id,
          resultSnapshotId: snapshot.id,
        },
      ))
    ) {
      throw new Error(`could not publish fixture ${stepKey} step`);
    }
  }
  const topicModelOutcome = input.topicModelOutcome ?? "skipped";
  if (topicModelOutcome === "skipped") {
    if (
      !(await refreshes.skipStep(
        input.scope,
        analysisRefreshRunId,
        "topic_model",
        "insufficient_keyword_evidence",
      ))
    ) {
      throw new Error("could not skip fixture Topic Model step");
    }
  } else if (
    !(await refreshes.failStep(
      input.scope,
      analysisRefreshRunId,
      "topic_model",
      {
        childAsyncRunId: null,
        error: {
          code: "TOPIC_MODEL_GENERATION_FIXTURE_FAILED",
          summary: "The deterministic Topic Model fixture failed.",
        },
      },
    ))
  ) {
    throw new Error("could not fail fixture Topic Model step");
  }
  if (
    !(await refreshes.startStep(
      input.scope,
      analysisRefreshRunId,
      "growth_audit",
      input.diagnosticRunId,
    )) ||
    !(await refreshes.completeStep(
      input.scope,
      analysisRefreshRunId,
      "growth_audit",
      {
        childAsyncRunId: input.diagnosticRunId,
        resultSnapshotId: null,
      },
    ))
  ) {
    throw new Error("could not publish fixture Growth Audit step");
  }

  const parentStatus =
    canonicalRun.status === "partial" ||
    OPTIONAL_STEP_KEYS.some((stepKey) => !snapshotByProvider.has(stepKey)) ||
    topicModelOutcome === "failed"
      ? "partial"
      : "completed";
  await exec
    .update(asyncRuns)
    .set({
      status: parentStatus,
      completed_at: input.completedAt,
      updated_at: input.completedAt,
    })
    .where(eq(asyncRuns.id, analysisRefreshRunId));

  return { analysisRefreshRunId, auditRunId: audit.id };
}
