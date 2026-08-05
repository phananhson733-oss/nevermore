import {
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  canonicalUtcTimestamptz,
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  enqueueRunInTx,
  GROWTH_AUDIT_PROJECTION_VERSION,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitesRepository,
  type CanonicalValue,
  type DataSnapshotRow,
  type Executor,
  type ProjectScope,
  type ProjectRow,
  type WorkspaceScope,
} from "@sf/db";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import {
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
} from "@sf/sources";
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
import { freezeDiagnosticGovernance } from "./diagnostic-governance";
import { isPostgresUniqueViolation } from "./db-errors";
import { runStatusUrl, toAsyncRunDto, type AsyncRunDto } from "./runs";

/**
 * `createGrowthAuditRun` (Slice 1). Freezes URL/ICP/snapshot inputs and queues a
 * versioned full Growth Audit. Route A: the audit reuses the canonical diagnostic
 * queue — it is a `kind: "diagnostic"` async run under its own `growth_audit`
 * active key, distinguished from a pure diagnosis only by its `audit_runs`
 * projection. The worker runs the exact current 12-rule, context-aware
 * diagnostic pipeline and then materializes the eight audit modules.
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
const AUDIT_SNAPSHOT_SELECTORS = [
  {
    provider: "crawl",
    datasetKey: CRAWL_DATASET_KEY,
    methodVersion: CRAWL_METHOD_VERSION,
    collectionOperation: "site_graph",
    collectionMethodVersion: CRAWL_METHOD_VERSION,
  },
  {
    provider: "gsc",
    datasetKey: "gsc.page_query_daily.v1",
    methodVersion: "gsc.page_query_daily.v1",
    collectionOperation: "search_analytics",
    collectionMethodVersion: "gsc.page_query_daily.v1",
  },
  {
    provider: "ga4",
    datasetKey: "ga4.organic_landing_daily.v1",
    methodVersion: "ga4.organic_landing_daily.v1",
    collectionOperation: "organic_landing",
    collectionMethodVersion: "ga4.organic_landing_daily.v1",
  },
  {
    provider: "csv",
    datasetKey: "csv.keyword_gap.v1",
    methodVersion: "csv.keyword_gap.v1",
    collectionOperation: "keyword_gap_import",
    collectionMethodVersion: "csv.keyword_gap.v1",
  },
  {
    provider: "dataforseo",
    datasetKey: DATAFORSEO_DATASET_KEY,
    methodVersion: DATAFORSEO_METHOD_VERSION,
    collectionOperation: "keyword_gap_import",
    collectionMethodVersion: DATAFORSEO_METHOD_VERSION,
  },
] as const;
const AUDIT_PROVIDER_ORDER = new Map<string, number>(
  AUDIT_SNAPSHOT_SELECTORS.map((selector, index) => [
    selector.provider,
    index,
  ]),
);
const AUDIT_SEARCH_LANDSCAPE_SELECTOR = [
  {
    provider: "dataforseo",
    datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
    methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
    collectionOperation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
    collectionMethodVersion:
      DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  },
  {
    provider: "dataforseo",
    datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
    methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
    collectionOperation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
    collectionMethodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  },
] as const;

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
    readonly profile: unknown;
  };
  readonly siteId: string;
  readonly siteLanguageCodes: readonly string[];
  /** Compatibility pointer retained for the separately governed recheck path. */
  readonly crawlSnapshot: DataSnapshotRow;
  readonly snapshots: readonly DataSnapshotRow[];
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

function corruptAuditSnapshotSelection(detail: string): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    detail,
  );
}

function exactDataForSeoSnapshot(
  snapshot: DataSnapshotRow,
  kind: "legacy" | "search_landscape_v1" | "search_landscape_v2",
): boolean {
  const datasetKey =
    kind === "legacy"
      ? DATAFORSEO_DATASET_KEY
      : kind === "search_landscape_v1"
        ? DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY
        : DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY;
  const methodVersion =
    kind === "legacy"
      ? DATAFORSEO_METHOD_VERSION
      : kind === "search_landscape_v1"
        ? DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION
        : DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION;
  return (
    snapshot.provider === "dataforseo" &&
    snapshot.dataset_key === datasetKey &&
    snapshot.schema_version === methodVersion &&
    snapshot.method_version === methodVersion
  );
}

function latestDataForSeoSnapshot(
  snapshots: readonly DataSnapshotRow[],
): DataSnapshotRow | undefined {
  return snapshots.reduce<DataSnapshotRow | undefined>((latest, candidate) => {
    if (!latest) return candidate;
    let latestAt: string;
    let candidateAt: string;
    try {
      latestAt = canonicalUtcTimestamptz(latest.captured_at);
      candidateAt = canonicalUtcTimestamptz(candidate.captured_at);
    } catch {
      return corruptAuditSnapshotSelection(
        "A DataForSEO Snapshot has an invalid capture time.",
      );
    }
    const ordering = Date.parse(candidateAt) - Date.parse(latestAt);
    if (ordering > 0) return candidate;
    if (ordering < 0) return latest;
    return candidate.id < latest.id ? candidate : latest;
  }, undefined);
}

async function assertExactDataForSeoCollectionRun(
  exec: Executor,
  scope: ProjectScope,
  snapshot: DataSnapshotRow,
): Promise<void> {
  const run = await new CollectionRunsRepository(exec).findById(
    snapshot.collection_run_id,
  );
  const legacy =
    exactDataForSeoSnapshot(snapshot, "legacy") &&
    run?.operation === "keyword_gap_import" &&
    run.method_version === DATAFORSEO_METHOD_VERSION;
  const compositeV1 =
    exactDataForSeoSnapshot(snapshot, "search_landscape_v1") &&
    run?.operation === DATAFORSEO_SEARCH_LANDSCAPE_OPERATION &&
    run.method_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION;
  const compositeV2 =
    exactDataForSeoSnapshot(snapshot, "search_landscape_v2") &&
    run?.operation === DATAFORSEO_SEARCH_LANDSCAPE_OPERATION &&
    run.method_version === DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION;
  if (
    !run ||
    run.workspace_id !== scope.workspaceId ||
    run.project_id !== scope.projectId ||
    run.site_id !== snapshot.site_id ||
    run.id !== snapshot.collection_run_id ||
    run.provider !== "dataforseo" ||
    (!legacy && !compositeV1 && !compositeV2)
  ) {
    return corruptAuditSnapshotSelection(
      "The selected DataForSEO Snapshot does not match an exact supported collection contract.",
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

  const snapshotsRepository = new DataSnapshotsRepository(exec);
  const legacySnapshots = await snapshotsRepository.findLatestEligibleBySite(
    projectScope,
    site.id,
    AUDIT_SNAPSHOT_SELECTORS,
  );
  const compositeSnapshots =
    await snapshotsRepository.findLatestEligibleBySite(
      projectScope,
      site.id,
      AUDIT_SEARCH_LANDSCAPE_SELECTOR,
    );
  const legacyDataForSeoSnapshots = legacySnapshots.filter(
    (snapshot) => snapshot.provider === "dataforseo",
  );
  const legacyDataForSeo = legacyDataForSeoSnapshots[0];
  if (
    legacyDataForSeoSnapshots.length > 1 ||
    (legacyDataForSeo &&
      !exactDataForSeoSnapshot(legacyDataForSeo, "legacy")) ||
    compositeSnapshots.length > 2 ||
    compositeSnapshots.some(
      (snapshot) =>
        !exactDataForSeoSnapshot(snapshot, "search_landscape_v1") &&
        !exactDataForSeoSnapshot(snapshot, "search_landscape_v2"),
    ) ||
    new Set(compositeSnapshots.map((snapshot) => snapshot.dataset_key)).size !==
      compositeSnapshots.length
  ) {
    return corruptAuditSnapshotSelection(
      "The DataForSEO Snapshot selector returned an unsupported contract.",
    );
  }
  const dataForSeoSnapshot = latestDataForSeoSnapshot([
    ...(legacyDataForSeo ? [legacyDataForSeo] : []),
    ...compositeSnapshots,
  ]);
  const snapshots = [
    ...legacySnapshots.filter(
      (snapshot) => snapshot.provider !== "dataforseo",
    ),
    ...(dataForSeoSnapshot ? [dataForSeoSnapshot] : []),
  ];
  if (dataForSeoSnapshot) {
    await assertExactDataForSeoCollectionRun(
      exec,
      projectScope,
      dataForSeoSnapshot,
    );
  }
  const crawlSnapshot = snapshots.find(
    (snapshot) => snapshot.provider === "crawl",
  );
  if (!crawlSnapshot) {
    throw new ProblemError(
      "CRAWL_SNAPSHOT_REQUIRED",
      "A crawl snapshot is required to audit.",
    );
  }

  // Repository order is deterministic already, but the audit contract owns an
  // explicit provider order so capability addressing cannot drift with a query
  // planner or a future repository implementation. The diagnostic manifest
  // performs its own canonical snapshot-id sort.
  const orderedSnapshots = [...snapshots].sort(
    (left, right) =>
      (AUDIT_PROVIDER_ORDER.get(left.provider) ?? Number.MAX_SAFE_INTEGER) -
      (AUDIT_PROVIDER_ORDER.get(right.provider) ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    icp: {
      id: icp.id,
      version: icp.version,
      contentHash: icp.content_hash,
      profile: icp.profile,
    },
    siteId: site.id,
    siteLanguageCodes: site.language_codes,
    crawlSnapshot,
    snapshots: orderedSnapshots,
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
  const statusUrl = runStatusUrl(projectId, runId);
  return new ProblemError(
    "RUN_ALREADY_ACTIVE",
    "A growth audit run is already active.",
    {
      headers: { Location: statusUrl },
      // Same pointer in the body as in the header, because a client that
      // only reads the response body would otherwise get a conflict it
      // cannot locate. `collection.ts` and `product-profile-synthesis.ts`
      // already answer this shape; these three did not.
      current: { runId, statusUrl },
    },
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
      const governance = await freezeDiagnosticGovernance(tx, projectScope);

      const frozen = buildDiagnosticFrozenInput({
        projectId,
        siteId: inputs.siteId,
        icp: inputs.icp,
        siteLanguageCodes: inputs.siteLanguageCodes,
        snapshots: inputs.snapshots,
        deliveryLocale: body.outputLocale,
        governance,
      });
      const capabilityManifestHash = contentHash({
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
        projectId,
        siteId: inputs.siteId,
        icpProfileId: inputs.icp.id,
        scope: canonicalScope(body.scope),
        selectedSnapshotIds: inputs.snapshots.map((snapshot) => snapshot.id),
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
        projectionVersion: GROWTH_AUDIT_PROJECTION_VERSION,
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
    }, { isolationLevel: "repeatable read" });
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
      // No winner to point at. The unique index only aborts when a run
      // WAS active and `findActive` only sees `queued`/`running`, so the
      // winner left both states between the abort and this read. Neither
      // a `Location` nor a runId can be invented, and the detail must
      // stop asserting an active run it cannot observe. `activeKey` is
      // the one locatable fact that survives; `Problem.current` is
      // `additionalProperties: true`, so this costs no contract change.
      // Same disposition as `collection.ts` for the same reason.
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A growth audit run held this project and is no longer active; retry the request.",
        { current: { runId: null, statusUrl: null, activeKey: GROWTH_AUDIT_ACTIVE_KEY } },
      );
    }
    throw error;
  }
}
