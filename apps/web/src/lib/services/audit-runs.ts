import {
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
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
  type Executor,
  type ProjectRow,
  type WorkspaceScope,
} from "@sf/db";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import { CRAWL_DATASET_KEY, CRAWL_METHOD_VERSION } from "@sf/sources";
import {
  CONTRACT_VERSION,
  GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
  type CreateGrowthAuditRunRequest,
  type GrowthAuditScope,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { buildDiagnosticFrozenInput } from "./diagnostics";
import { isPostgresUniqueViolation } from "./db-errors";
import { runStatusUrl, toAsyncRunDto, type AsyncRunDto } from "./runs";

/**
 * `createGrowthAuditRun` (Slice 1). Freezes URL/ICP/snapshot inputs and queues a
 * versioned full Growth Audit. Route A: the audit reuses the canonical diagnostic
 * queue — it is a `kind: "diagnostic"` async run under its own `growth_audit`
 * active key, distinguished from a pure diagnosis only by its `audit_runs`
 * projection. The worker runs the exact 11-rule diagnostic pipeline and then
 * materializes the eight audit modules.
 *
 * Hard gates mirror diagnosis: a confirmed COMPLETE Product Profile is required
 * (422 CONTEXT_INCOMPLETE) and at least one usable crawl snapshot must exist for
 * the audited Site (422 CRAWL_SNAPSHOT_REQUIRED).
 */

const IDEMPOTENCY_SCOPE = "createGrowthAuditRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const GROWTH_AUDIT_ACTIVE_KEY = "growth_audit";
const CAPABILITY_ID = "growth-audit";
const CAPABILITY_VERSION = "0.3.0";
const PROJECTION_VERSION = "growth-audit.0.3.0";

export interface GrowthAuditAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "audit_run"; id: string };
  readonly location: string;
  readonly replayed: boolean;
}

export interface GrowthAuditInputs {
  readonly icp: {
    readonly id: string;
    readonly version: number;
    readonly contentHash: string;
  };
  readonly siteId: string;
  readonly crawlSnapshot: DataSnapshotRow;
}

/** Canonical, `undefined`-free scope for stable content addressing. */
function canonicalScope(scope: GrowthAuditScope): CanonicalValue {
  if (scope.kind === "site") return { kind: "site" };
  return { kind: scope.kind, targetRefs: [...scope.targetRefs] };
}

/** Stable, bounded audit `scope_key`: the Site id, or a hash of the target set. */
function deriveScopeKey(scope: GrowthAuditScope, siteId: string): string {
  if (scope.kind === "site") return siteId;
  return contentHash([...scope.targetRefs].sort());
}

export function assertProjectDiagnosable(
  project: ProjectRow | null,
  icpProfileId: string,
): asserts project is ProjectRow {
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at)
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
  // The audit must freeze the customer's separately confirmed COMPLETE profile,
  // never a later working draft.
  if (!project.confirmed_icp_profile_id) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "A confirmed product profile is required to audit.",
    );
  }
  if (project.confirmed_icp_profile_id !== icpProfileId) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The audit must reference the confirmed product profile.",
    );
  }
}

export async function loadGrowthAuditInputs(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  project: ProjectRow,
  body: CreateGrowthAuditRunRequest,
): Promise<GrowthAuditInputs> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const icp = await new IcpProfilesRepository(exec).findById(
    projectScope,
    project.confirmed_icp_profile_id!,
  );
  if (!icp || icp.status !== "complete") {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The product profile must be confirmed before auditing.",
    );
  }

  const site = await new SitesRepository(exec).findById(
    projectScope,
    body.siteId,
  );
  if (!site) {
    throw new ProblemError(
      "SNAPSHOT_PROJECT_MISMATCH",
      "The audited site does not belong to this project.",
    );
  }

  const eligible = await new DataSnapshotsRepository(
    exec,
  ).findLatestEligibleCrawlBySite(
    projectScope,
    site.id,
    CRAWL_DATASET_KEY,
    CRAWL_METHOD_VERSION,
  );
  if (!eligible) {
    throw new ProblemError(
      "CRAWL_SNAPSHOT_REQUIRED",
      "A crawl snapshot is required to audit.",
    );
  }
  // The eligibility read projects a bounded column set; re-read the full
  // immutable row so the frozen diagnostic manifest carries every field the
  // manifest guard validates (including source_window).
  const [crawlSnapshot] = await new DataSnapshotsRepository(exec).findByIds(
    projectScope,
    [eligible.id],
  );
  if (!crawlSnapshot) {
    throw new ProblemError(
      "CRAWL_SNAPSHOT_REQUIRED",
      "A crawl snapshot is required to audit.",
    );
  }

  return {
    icp: { id: icp.id, version: icp.version, contentHash: icp.content_hash },
    siteId: site.id,
    crawlSnapshot,
  };
}

function replay(
  row: {
    readonly request_hash: string;
    readonly status: string;
    readonly resource_id: string | null;
    readonly response_body: unknown;
  },
  requestHash: string,
): GrowthAuditAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key reused with a different body.",
    );
  }
  if (row.status !== "completed" || row.resource_id === null) return null;
  const body = row.response_body as {
    readonly run: AsyncRunDto;
    readonly statusUrl: string;
    readonly resourceRef: { type: "audit_run"; id: string };
  } | null;
  if (!body?.run || body.resourceRef?.type !== "audit_run") return null;
  return {
    status: 202,
    run: body.run,
    statusUrl: body.statusUrl,
    resourceRef: body.resourceRef,
    location: body.statusUrl,
    replayed: true,
  };
}

function activeConflict(projectId: string, runId: string): ProblemError {
  return new ProblemError(
    "RUN_ALREADY_ACTIVE",
    "A growth audit run is already active.",
    { headers: { Location: runStatusUrl(projectId, runId) } },
  );
}

export async function createGrowthAuditRun(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateGrowthAuditRunRequest,
): Promise<GrowthAuditAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  // The accepted command is stable even if project/ICP/snapshots later change.
  const requestHash = contentHash({
    projectId,
    siteId: body.siteId,
    icpProfileId: body.icpProfileId,
    scope: canonicalScope(body.scope),
    outputLocale: body.outputLocale,
  });

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
  assertProjectDiagnosable(project, body.icpProfileId);
  await loadGrowthAuditInputs(db, scope, projectId, project, body);

  const active = await new AsyncRunsRepository(db).findActive(
    projectScope,
    GROWTH_AUDIT_ACTIVE_KEY,
  );
  if (active) {
    const now = await idem.find(
      scope.workspaceId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
    );
    const replayed = now ? replay(now, requestHash) : null;
    if (replayed) return replayed;
    throw activeConflict(projectId, active.id);
  }

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  const boss = await getBoss();
  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
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

      const currentProject = await new ProjectsRepository(tx).findByIdForUpdate(
        scope,
        projectId,
      );
      assertProjectDiagnosable(currentProject, body.icpProfileId);
      const inputs = await loadGrowthAuditInputs(
        tx,
        scope,
        projectId,
        currentProject,
        body,
      );

      const frozen = buildDiagnosticFrozenInput({
        projectId,
        siteId: inputs.siteId,
        icp: inputs.icp,
        snapshots: [inputs.crawlSnapshot],
        deliveryLocale: body.outputLocale,
      });
      const capabilityManifestHash = contentHash({
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
        projectId,
        siteId: inputs.siteId,
        icpProfileId: inputs.icp.id,
        scope: canonicalScope(body.scope),
        selectedSnapshotIds: [inputs.crawlSnapshot.id],
        outputLocale: body.outputLocale,
      });

      // Provenance order is load-bearing: the audit_runs guard requires the
      // diagnostic and capability projections of this canonical run to exist
      // first (async_run -> diagnostic_run -> capability_run -> audit_run).
      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "diagnostic",
        activeKey: GROWTH_AUDIT_ACTIVE_KEY,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          siteId: inputs.siteId,
          icpProfileId: inputs.icp.id,
          scope: canonicalScope(body.scope),
          outputLocale: body.outputLocale,
          capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
        },
      });
      await new DiagnosticRunsRepository(tx).insert({
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        siteId: inputs.siteId,
        icpProfileId: inputs.icp.id,
        icpProfileVersion: inputs.icp.version,
        ruleSetVersion: RULE_SET_VERSION,
        promptSetVersion: PROMPT_SET_VERSION,
        outputLocale: body.outputLocale,
        inputManifest: frozen.manifest,
        inputHash: frozen.inputHash,
      });
      await new CapabilityRunsRepository(tx).create({
        workspaceId: scope.workspaceId,
        projectId,
        asyncRunId: run.id,
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        inputManifestHash: capabilityManifestHash,
        mode: "production",
        sideEffectClass: "read_only",
      });
      const auditRun = await new AuditRunsRepository(tx).create({
        workspaceId: scope.workspaceId,
        projectId,
        diagnosticRunId: run.id,
        capabilityRunId: run.id,
        scopeKind: body.scope.kind,
        scopeKey: deriveScopeKey(body.scope, inputs.siteId),
        projectionVersion: PROJECTION_VERSION,
      });
      await enqueueRunInTx(boss, tx, "diagnose", {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });
      await new ProjectsRepository(tx).setStage(scope, projectId, "diagnosing");

      const dto = toAsyncRunDto(run);
      const statusUrl = runStatusUrl(projectId, run.id);
      const resourceRef = { type: "audit_run" as const, id: auditRun.id };
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody: { run: dto, statusUrl, resourceRef },
        resourceType: "audit_run",
        resourceId: auditRun.id,
      });
      return {
        status: 202,
        run: dto,
        statusUrl,
        resourceRef,
        location: statusUrl,
        replayed: false,
      };
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error, "async_runs_one_active_key_idx")) {
      const winnerKey = await idem.find(
        scope.workspaceId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
      );
      const replayed = winnerKey ? replay(winnerKey, requestHash) : null;
      if (replayed) return replayed;
      const winner = await new AsyncRunsRepository(db).findActive(
        projectScope,
        GROWTH_AUDIT_ACTIVE_KEY,
      );
      if (winner) throw activeConflict(projectId, winner.id);
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A growth audit run is already active.",
      );
    }
    throw error;
  }
}
