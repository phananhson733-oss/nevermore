import {
  ActionsRepository,
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  contentHash,
  DiagnosticRunsRepository,
  enqueueRunInTx,
  FindingsRepository,
  FindingTargetsRepository,
  GROWTH_AUDIT_RECHECK_PROJECTION_VERSION,
  IdempotencyRepository,
  ProjectsRepository,
  type DbTx,
  type DiagnosticRunRow,
  type Executor,
  type FindingTargetRow,
  type WorkspaceScope,
} from "@sf/db";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import {
  CONTRACT_VERSION,
  GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
  type CreateActionRecheckRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import {
  assertProjectDiagnosable,
  loadGrowthAuditInputs,
  type GrowthAuditAcceptedResult,
} from "./audit-runs";
import { buildDiagnosticFrozenInput } from "./diagnostics";
import { isPostgresUniqueViolation } from "./db-errors";
import { runStatusUrl, toAsyncRunDto, type AsyncRunDto } from "./runs";

/**
 * `createActionRecheck` (Slice 1, Task 8). Re-runs the frozen diagnostic pipeline
 * against fresh crawl data to re-verify one already confirmed Action's technical
 * condition. It creates a brand-new immutable audit run under the isolated
 * `growth-audit-recheck.0.3.0` projection version, reusing the canonical
 * diagnostic queue (async_run -> diagnostic_run -> capability_run -> audit_run).
 * It never mutates the prior run and never writes a performance checkpoint; the
 * Results surface compares the two runs afterward.
 */

const IDEMPOTENCY_SCOPE = "createActionRecheck";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CAPABILITY_ID = "growth-audit";
const CAPABILITY_VERSION = "0.3.0";

function recheckActiveKey(actionId: string): string {
  // Per-action key so a recheck is never mutually exclusive with the project's
  // full audit under the shared `growth_audit` active key.
  return `growth_audit_recheck:${actionId}`;
}

export type ActionRecheckAcceptedResult = GrowthAuditAcceptedResult;

interface RecheckContext {
  readonly priorDiagnosticRun: DiagnosticRunRow;
  readonly outputLocale: string;
}

/** Prefer the direct URL target, else the first resolved/definition target. */
function resolveRootTarget(
  targets: readonly FindingTargetRow[],
): FindingTargetRow | null {
  const resolved = targets.filter(
    (target) => target.resolution_state === "resolved",
  );
  const directUrl = resolved.find(
    (target) =>
      target.relation === "direct_url" && target.target_kind === "url",
  );
  return directUrl ?? resolved[0] ?? targets[0] ?? null;
}

/**
 * Load and validate the immutable recheck inputs: the prior audit run, its
 * confirmed Action, the source Finding, and the frozen root FindingTarget. The
 * request `targetScope` must equal the confirmed Action's root target, and the
 * Action must belong to the prior run's diagnostic run (spec §8.6, §9.1).
 */
async function loadRecheckContext(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  body: CreateActionRecheckRequest,
): Promise<RecheckContext> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const priorRun = await new AuditRunsRepository(exec).findById(
    projectScope,
    body.priorRunId,
  );
  if (!priorRun) {
    throw new ProblemError("NOT_FOUND", "The prior audit run was not found.");
  }
  const action = await new ActionsRepository(exec).findById(
    projectScope,
    body.actionId,
  );
  if (!action) {
    throw new ProblemError("NOT_FOUND", "The Action was not found.");
  }
  if (action.source_diagnostic_run_id !== priorRun.diagnostic_run_id) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "The Action does not belong to the prior audit run.",
    );
  }
  const finding = await new FindingsRepository(exec).findById(
    projectScope,
    action.source_finding_id,
  );
  if (!finding) {
    throw new ProblemError("NOT_FOUND", "The source Finding was not found.");
  }
  const targets = await new FindingTargetsRepository(exec).listForFindings(
    projectScope,
    action.source_diagnostic_run_id,
    [finding.id],
  );
  const root = resolveRootTarget(targets);
  if (
    !root ||
    root.target_kind !== body.targetScope.kind ||
    root.target_ref !== body.targetScope.ref
  ) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "The target scope does not match the confirmed Action's root target.",
    );
  }
  const priorDiagnosticRun = await new DiagnosticRunsRepository(exec).findById(
    projectScope,
    priorRun.diagnostic_run_id,
  );
  if (!priorDiagnosticRun) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The prior diagnostic run was not found.",
    );
  }
  return {
    priorDiagnosticRun,
    outputLocale: priorDiagnosticRun.output_locale,
  };
}

function requestHashFor(
  projectId: string,
  body: CreateActionRecheckRequest,
  outputLocale: string,
): string {
  return contentHash({
    projectId,
    actionId: body.actionId,
    priorRunId: body.priorRunId,
    targetScope: { kind: body.targetScope.kind, ref: body.targetScope.ref },
    outputLocale,
  });
}

function replay(
  row: {
    readonly request_hash: string;
    readonly status: string;
    readonly resource_id: string | null;
    readonly response_body: unknown;
  },
  requestHash: string,
): ActionRecheckAcceptedResult | null {
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
    "A recheck for this Action is already active.",
    { headers: { Location: runStatusUrl(projectId, runId) } },
  );
}

export async function createActionRecheck(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateActionRecheckRequest,
): Promise<ActionRecheckAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const activeKey = recheckActiveKey(body.actionId);

  const context = await loadRecheckContext(db, scope, projectId, body);
  const requestHash = requestHashFor(projectId, body, context.outputLocale);

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
  assertProjectDiagnosable(project, project?.confirmed_icp_profile_id ?? "");

  const active = await new AsyncRunsRepository(db).findActive(
    projectScope,
    activeKey,
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
    return await db.transaction((tx) =>
      runRecheckTransaction({
        tx,
        boss,
        scope,
        projectId,
        actorId,
        idempotencyKey,
        activeKey,
        requestHash,
        expiresAt,
        body,
        context,
      }),
    );
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
        activeKey,
      );
      if (winner) throw activeConflict(projectId, winner.id);
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A recheck for this Action is already active.",
      );
    }
    throw error;
  }
}

interface RecheckTransactionInput {
  readonly tx: DbTx;
  readonly boss: Awaited<ReturnType<typeof getBoss>>;
  readonly scope: WorkspaceScope;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly activeKey: string;
  readonly requestHash: string;
  readonly expiresAt: string;
  readonly body: CreateActionRecheckRequest;
  readonly context: RecheckContext;
}

async function runRecheckTransaction(
  input: RecheckTransactionInput,
): Promise<ActionRecheckAcceptedResult> {
  const { tx, scope, projectId, context } = input;
  const txIdem = new IdempotencyRepository(tx);
  const reserved = await txIdem.begin({
    workspaceId: scope.workspaceId,
    scope: IDEMPOTENCY_SCOPE,
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    expiresAt: input.expiresAt,
  });
  if (!reserved) {
    const now = await txIdem.find(
      scope.workspaceId,
      IDEMPOTENCY_SCOPE,
      input.idempotencyKey,
    );
    const replayed = now ? replay(now, input.requestHash) : null;
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
  assertProjectDiagnosable(
    currentProject,
    currentProject?.confirmed_icp_profile_id ?? "",
  );
  // Select the latest eligible crawl snapshot: a recheck is re-run over NEW data.
  const inputs = await loadGrowthAuditInputs(
    tx,
    scope,
    projectId,
    currentProject,
    {
      siteId: context.priorDiagnosticRun.site_id,
      icpProfileId: currentProject.confirmed_icp_profile_id!,
      scope: { kind: "site" },
      outputLocale: context.outputLocale,
      capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
    },
  );
  return persistRecheckRun(input, inputs, reserved.id);
}

async function persistRecheckRun(
  input: RecheckTransactionInput,
  inputs: Awaited<ReturnType<typeof loadGrowthAuditInputs>>,
  reservedId: string,
): Promise<ActionRecheckAcceptedResult> {
  const { tx, scope, projectId, actorId, body, context } = input;
  const selectedSnapshotIds = [inputs.crawlSnapshot.id];
  const frozen = buildDiagnosticFrozenInput({
    projectId,
    siteId: inputs.siteId,
    icp: inputs.icp,
    snapshots: [inputs.crawlSnapshot],
    deliveryLocale: context.outputLocale,
  });
  const capabilityManifestHash = contentHash({
    capabilityId: CAPABILITY_ID,
    capabilityVersion: CAPABILITY_VERSION,
    capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
    operation: "growth_audit_recheck",
    projectId,
    siteId: inputs.siteId,
    icpProfileId: inputs.icp.id,
    actionId: body.actionId,
    priorRunId: body.priorRunId,
    targetScope: { kind: body.targetScope.kind, ref: body.targetScope.ref },
    selectedSnapshotIds,
    outputLocale: context.outputLocale,
  });

  const run = await new AsyncRunsRepository(tx).insertQueued({
    workspaceId: scope.workspaceId,
    projectId,
    kind: "diagnostic",
    activeKey: input.activeKey,
    initiatedBy: actorId,
    contractVersion: CONTRACT_VERSION,
    requestPayload: {
      operation: "growth_audit_recheck",
      priorRunId: body.priorRunId,
      actionId: body.actionId,
      targetScope: { kind: body.targetScope.kind, ref: body.targetScope.ref },
      capabilityContractVersion: body.capabilityContractVersion,
      selectedSnapshotIds,
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
    outputLocale: context.outputLocale,
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
    scopeKind: "site",
    scopeKey: inputs.siteId,
    projectionVersion: GROWTH_AUDIT_RECHECK_PROJECTION_VERSION,
  });
  await enqueueRunInTx(input.boss, tx, "diagnose", {
    runId: run.id,
    workspaceId: scope.workspaceId,
    projectId,
    contractVersion: CONTRACT_VERSION,
  });

  const dto = toAsyncRunDto(run);
  const statusUrl = runStatusUrl(projectId, run.id);
  const resourceRef = { type: "audit_run" as const, id: auditRun.id };
  await new IdempotencyRepository(tx).complete(reservedId, {
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
}
