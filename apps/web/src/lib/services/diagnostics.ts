import {
  AsyncRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  enqueueRunInTx,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitesRepository,
  type DataSnapshotRow,
  type WorkspaceScope,
} from "@sf/db";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import type { CreateDiagnosticRunRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { toAsyncRunDto, runStatusUrl, type AsyncRunDto } from "./runs";

/**
 * `createDiagnosticRun` (spec §8.1, §8.5, §13.2). Freezes an immutable input
 * manifest (complete ICP version + selected snapshots + rule/prompt set versions
 * + delivery locale), hashes it, and atomically enqueues the diagnostic run.
 * Hard gates: a complete ICP is required (422 CONTEXT_INCOMPLETE) and at least one
 * crawl snapshot must be selected (422 CRAWL_SNAPSHOT_REQUIRED).
 */

const CONTRACT_VERSION = "2026-07-18";
const IDEMPOTENCY_SCOPE = "createDiagnosticRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DIAGNOSTIC_ACTIVE_KEY = "diagnostic";

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
    capturedAt: s.captured_at,
    sourceWindow: s.source_window,
    availability: s.availability,
  };
}

function replay(
  row: { request_hash: string; status: string; resource_id: string | null; response_body: unknown },
  requestHash: string,
): DiagnosticAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key reused with a different body.");
  }
  if (row.status === "completed" && row.resource_id) {
    const body = row.response_body as
      | { run: AsyncRunDto; statusUrl: string; resourceRef: { type: "diagnostic_run"; id: string } }
      | null;
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
  body: CreateDiagnosticRunRequest,
): Promise<DiagnosticAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const boss = await getBoss();

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");

  // Hard gate 1: a COMPLETE ICP profile is required.
  if (!project.current_icp_profile_id) {
    throw new ProblemError("CONTEXT_INCOMPLETE", "A complete ICP profile is required to diagnose.");
  }
  const icp = await new IcpProfilesRepository(db).findById(projectScope, project.current_icp_profile_id);
  if (!icp || icp.status !== "complete") {
    throw new ProblemError("CONTEXT_INCOMPLETE", "The ICP profile must be complete to diagnose.");
  }

  const site = await new SitesRepository(db).findPrimary(projectScope);
  if (!site) throw new ProblemError("NOT_FOUND", "Project has no primary site.");

  // Load + validate the selected snapshots (project-scoped).
  const snapshots = await new DataSnapshotsRepository(db).findByIds(projectScope, body.snapshotIds);
  if (snapshots.length !== body.snapshotIds.length) {
    throw new ProblemError("SNAPSHOT_PROJECT_MISMATCH", "A selected snapshot does not belong to this project.");
  }
  // Hard gate 2: at least one crawl snapshot.
  if (!snapshots.some((s) => s.provider === "crawl")) {
    throw new ProblemError("CRAWL_SNAPSHOT_REQUIRED", "A crawl snapshot is required to diagnose.");
  }

  // Freeze + hash the input manifest (spec §8.1).
  const orderedSnapshots = [...snapshots].sort((a, b) => (a.id < b.id ? -1 : 1));
  const inputManifest = {
    projectId,
    siteId: site.id,
    icp: { id: icp.id, version: icp.version, contentHash: icp.content_hash },
    snapshots: orderedSnapshots.map(snapshotManifestEntry),
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: body.outputLocale,
  };
  const inputHash = contentHash(inputManifest as unknown as Parameters<typeof contentHash>[0]);
  const requestHash = contentHash({ snapshotIds: [...body.snapshotIds].sort(), outputLocale: body.outputLocale });
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const idem = new IdempotencyRepository(db);
  const existing = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
  if (existing) {
    const replayed = replay(existing, requestHash);
    if (replayed) return replayed;
  }
  const active = await new AsyncRunsRepository(db).findActive(projectScope, DIAGNOSTIC_ACTIVE_KEY);
  if (active) {
    throw new ProblemError("RUN_ALREADY_ACTIVE", "A diagnostic run is already active.", {
      headers: { Location: runStatusUrl(projectId, active.id) },
    });
  }

  return db.transaction(async (tx) => {
    const txIdem = new IdempotencyRepository(tx);
    const reserved = await txIdem.begin({
      workspaceId: scope.workspaceId,
      scope: IDEMPOTENCY_SCOPE,
      key: idempotencyKey,
      requestHash,
      expiresAt,
    });
    if (!reserved) {
      const now = await txIdem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
      const replayed = now ? replay(now, requestHash) : null;
      if (replayed) return replayed;
      throw new ProblemError("IDEMPOTENCY_KEY_REUSED", "Idempotency key is being processed.");
    }

    const run = await new AsyncRunsRepository(tx).insertQueued({
      workspaceId: scope.workspaceId,
      projectId,
      kind: "diagnostic",
      activeKey: DIAGNOSTIC_ACTIVE_KEY,
      initiatedBy: actorId,
      contractVersion: CONTRACT_VERSION,
      requestPayload: { snapshotIds: [...body.snapshotIds], outputLocale: body.outputLocale },
    });
    await new DiagnosticRunsRepository(tx).insert({
      runId: run.id,
      workspaceId: scope.workspaceId,
      projectId,
      siteId: site.id,
      icpProfileId: icp.id,
      icpProfileVersion: icp.version,
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      outputLocale: body.outputLocale,
      inputManifest,
      inputHash,
    });
    await enqueueRunInTx(boss, tx, "diagnose", {
      runId: run.id,
      workspaceId: scope.workspaceId,
      projectId,
      contractVersion: CONTRACT_VERSION,
    });

    const dto = toAsyncRunDto(run);
    const statusUrl = runStatusUrl(projectId, run.id);
    await txIdem.complete(reserved.id, {
      responseStatus: 202,
      responseBody: { run: dto, statusUrl, resourceRef: { type: "diagnostic_run", id: run.id } },
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
}
