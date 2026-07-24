import {
  ActionsRepository,
  AsyncRunsRepository,
  CapabilityRunsRepository,
  CompetitorsRepository,
  contentHash,
  DiagnosticRunsRepository,
  enqueueRunInTx,
  ExecutionArtifactsRepository,
  FindingsRepository,
  FlowShadowQaGatesRepository,
  FlowShadowResearchPacksRepository,
  FlowShadowRunsRepository,
  CONTENT_SHADOW_PROJECTION_VERSION,
  IdempotencyRepository,
  KeywordsRepository,
  ProjectsRepository,
  type CanonicalValue,
  type Executor,
  type FlowShadowRunRow,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import { PROMPT_SET_VERSION } from "@sf/engine";
import {
  buildContentShadowInputManifest,
  CONTENT_SHADOW_ADAPTER_VERSION,
  ContentShadowObservationSeparationError,
  type ContentShadowInputManifest,
} from "@sf/flow-shadow";
import {
  CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
  ContentShadowAuthoritySource,
  CONTRACT_VERSION,
  type ContentShadowRunResponse,
  type CreateContentShadowRunRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { isPostgresUniqueViolation } from "./db-errors";
import { runStatusUrl, toAsyncRunDto, type AsyncRunDto } from "./runs";

/**
 * SEO/GEO Content Shadow commands (Slice 2 Task 4).
 *
 * `createContentShadowRun` freezes an already confirmed content Finding, its
 * single canonical Action, the confirmed `content_brief` revision, and the
 * explicit competitor / SearchQuery cluster / GenerativeQuery identity sets into
 * one content-addressed tuple, then queues a shadow-mode capability run.
 *
 * It is deliberately a NON-confirming command (Slice 2 red line B): it requires
 * a Finding the canonical Finding Review transaction already confirmed and
 * refuses otherwise. It writes no Action, approval, checkpoint or opportunity
 * row, never touches a Finding's review state, and never recasts the brief — it
 * only freezes and consumes the revision that already exists. Every read-only
 * assertion below is deliberately redundant with the `flow_shadow_runs`
 * provenance trigger: the service returns an actionable 4xx, the trigger is the
 * last-resort 23514 backstop.
 */

const IDEMPOTENCY_SCOPE = "createContentShadowRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CAPABILITY_ID = "content-shadow";
const CAPABILITY_VERSION = "0.3.0";
const CONTENT_BRIEF_ARTIFACT_TYPE = "content_brief";
const DRAFT_ARTIFACT_TYPE = "english_blog_draft";

/** The frozen content rules whose Action template mints a `content_brief`. */
const CONTENT_BRIEF_RULE_IDS: ReadonlySet<string> = new Set([
  "SEARCH-DECAY-002",
  "CONTENT-COVERAGE-001",
  "CONTENT-GAP-011",
  "CRO-LANDING-003",
]);

function contentShadowActiveKey(actionId: string): string {
  return `content_shadow:${actionId}`;
}

export interface ContentShadowAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "flow_shadow_run"; id: string };
  readonly location: string;
  readonly replayed: boolean;
}

export interface ContentShadowInputs {
  readonly siteId: string;
  readonly actionId: string;
  readonly findingId: string;
  readonly sourceDiagnosticRunId: string;
  readonly contentBriefArtifactId: string;
  readonly contentBriefRevision: number;
  readonly competitorEntityIds: readonly string[];
  readonly clusterKey: string;
  readonly keywordEntityIds: readonly string[];
  readonly generativeQueryEntityIds: readonly string[];
}

/**
 * Read-only admission checks. Runs once before the transaction as a fast
 * pre-flight and again inside it under the project row lock, so a concurrent
 * dismissal/review cannot slip between the check and the freeze.
 */
export async function loadContentShadowInputs(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  body: CreateContentShadowRunRequest,
): Promise<ContentShadowInputs> {
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };

  const actions = new ActionsRepository(exec);
  const action = await actions.findById(projectScope, body.actionId);
  if (!action) throw new ProblemError("NOT_FOUND", "Action not found.");
  if (action.status === "dismissed") {
    throw new ProblemError(
      "ACTION_NOT_EXECUTABLE",
      "A dismissed Action cannot start a Content Shadow run.",
    );
  }

  const finding = await new FindingsRepository(exec).findById(
    projectScope,
    action.source_finding_id,
  );
  if (!finding) {
    throw new ProblemError("NOT_FOUND", "Source Finding not found.");
  }
  // Requires — never performs — confirmation (red line B).
  if (finding.review_state !== "confirmed") {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The source Finding must already be confirmed before a Content Shadow run.",
    );
  }
  if (!CONTENT_BRIEF_RULE_IDS.has(finding.rule_id)) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Only a content-brief Finding can start a Content Shadow run.",
    );
  }
  if (finding.last_seen_run_id !== action.source_diagnostic_run_id) {
    throw new ProblemError(
      "VERSION_CONFLICT",
      "The source Finding moved beyond the Action's frozen diagnosis.",
    );
  }

  // Exactly one canonical Action per confirmed Finding: a second live Action
  // would mean a second confirmation path exists (red line B).
  const actionCount = await actions.countActionsForFinding(
    projectScope,
    finding.id,
  );
  if (actionCount !== 1) {
    throw new ProblemError(
      "FINDING_ACTION_ACTIVE",
      "A confirmed Finding must own exactly one canonical Action.",
    );
  }

  const artifacts = new ExecutionArtifactsRepository(exec);
  const brief = await artifacts.findLiveByActionType(
    projectScope,
    action.id,
    CONTENT_BRIEF_ARTIFACT_TYPE,
  );
  if (!brief) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "A confirmed content brief is required to start a Content Shadow run.",
    );
  }
  const requestedRevision = body.contentBriefRevision ?? brief.current_revision;
  if (requestedRevision < 1 || requestedRevision > brief.current_revision) {
    throw new ProblemError(
      "STALE_REVISION",
      "The requested content brief revision is not available.",
    );
  }
  const briefRevision = await artifacts.findRevision(
    projectScope,
    brief.id,
    requestedRevision,
  );
  if (!briefRevision) {
    throw new ProblemError(
      "STALE_REVISION",
      "The requested content brief revision is not available.",
    );
  }

  const diagnosticRun = await new DiagnosticRunsRepository(exec).findById(
    projectScope,
    action.source_diagnostic_run_id,
  );
  if (!diagnosticRun) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The Action's frozen source diagnosis is unavailable.",
    );
  }

  // Every frozen identity must belong to this live project (decision R4).
  const competitorEntityIds = [...new Set(body.competitorEntityIds)];
  if (competitorEntityIds.length > 0) {
    const found = await new CompetitorsRepository(exec).listByIds(
      projectScope,
      competitorEntityIds,
    );
    if (found.length !== competitorEntityIds.length) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "Every frozen competitor must belong to this project.",
      );
    }
  }

  const keywords = new KeywordsRepository(exec);
  const keywordEntityIds = [...new Set(body.searchCluster.keywordEntityIds)];
  const keywordRows = await keywords.listByIds(projectScope, keywordEntityIds);
  if (keywordRows.length !== keywordEntityIds.length) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Every frozen search keyword must belong to this project.",
    );
  }
  for (const row of keywordRows) {
    // Search observation must be search observation (invariant 8).
    if (row.query_kind !== "search_query") {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "The frozen search cluster may only contain SearchQuery entities.",
      );
    }
    if (row.cluster_key !== body.searchCluster.clusterKey) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "Every frozen search keyword must belong to the frozen cluster.",
      );
    }
  }

  const generativeQueryEntityIds = [...new Set(body.generativeQueryEntityIds)];
  if (generativeQueryEntityIds.length > 0) {
    const generativeRows = await keywords.listByIds(
      projectScope,
      generativeQueryEntityIds,
    );
    if (generativeRows.length !== generativeQueryEntityIds.length) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "Every frozen generative query must belong to this project.",
      );
    }
    for (const row of generativeRows) {
      if (row.query_kind !== "generative_query") {
        throw new ProblemError(
          "VALIDATION_ERROR",
          "The frozen generative set may only contain GenerativeQuery entities.",
        );
      }
    }
  }

  return {
    siteId: diagnosticRun.site_id,
    actionId: action.id,
    findingId: finding.id,
    sourceDiagnosticRunId: action.source_diagnostic_run_id,
    contentBriefArtifactId: brief.id,
    contentBriefRevision: requestedRevision,
    competitorEntityIds,
    clusterKey: body.searchCluster.clusterKey,
    keywordEntityIds,
    generativeQueryEntityIds,
  };
}

/**
 * Freeze the pinned input tuple and its content address (red line C). Mirrors
 * `buildDiagnosticFrozenInput`: the hash is computed here, never in SQL, and
 * the adapter/prompt/projection versions are server-fixed (decision R3).
 */
export function buildContentShadowFrozenInput(input: {
  readonly inputs: ContentShadowInputs;
  readonly outputLocale: string;
}): {
  readonly manifest: ContentShadowInputManifest;
  readonly contentHash: string;
} {
  const { inputs } = input;
  const manifest = buildContentShadowInputManifest({
    primaryFindingId: inputs.findingId,
    sourceActionId: inputs.actionId,
    sourceDiagnosticRunId: inputs.sourceDiagnosticRunId,
    contentBriefArtifactId: inputs.contentBriefArtifactId,
    contentBriefRevision: inputs.contentBriefRevision,
    competitorEntityIds: inputs.competitorEntityIds,
    searchCluster: {
      clusterKey: inputs.clusterKey,
      keywordEntityIds: inputs.keywordEntityIds,
    },
    generativeQueryEntityIds: inputs.generativeQueryEntityIds,
    flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    projectionVersion: CONTENT_SHADOW_PROJECTION_VERSION,
    outputLocale: input.outputLocale,
  });
  return {
    manifest,
    contentHash: contentHash(manifest as unknown as CanonicalValue),
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
): ContentShadowAcceptedResult | null {
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
    readonly resourceRef: { type: "flow_shadow_run"; id: string };
  } | null;
  if (!body?.run || body.resourceRef?.type !== "flow_shadow_run") return null;
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
    "A Content Shadow run is already active for this Action.",
    { headers: { Location: runStatusUrl(projectId, runId) } },
  );
}

function assertProjectShadowable(
  project: { readonly archived_at: string | null } | null,
): void {
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) {
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
  }
}

export async function createContentShadowRun(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateContentShadowRunRequest,
): Promise<ContentShadowAcceptedResult> {
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const { db } = getDb();
  const activeKey = contentShadowActiveKey(body.actionId);
  const requestHash = contentHash({
    projectId,
    actionId: body.actionId,
    contentBriefRevision: body.contentBriefRevision ?? null,
    competitorEntityIds: [...body.competitorEntityIds].sort(),
    searchCluster: {
      clusterKey: body.searchCluster.clusterKey,
      keywordEntityIds: [...body.searchCluster.keywordEntityIds].sort(),
    },
    generativeQueryEntityIds: [...body.generativeQueryEntityIds].sort(),
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
  assertProjectShadowable(project);
  await loadContentShadowInputs(db, scope, projectId, body);

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
      assertProjectShadowable(currentProject);
      const inputs = await loadContentShadowInputs(tx, scope, projectId, body);
      const frozen = buildContentShadowFrozenInput({
        inputs,
        outputLocale: body.outputLocale,
      });
      const capabilityManifestHash = contentHash({
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        capabilityContractVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
        projectId,
        contentHash: frozen.contentHash,
      });

      // Provenance order is load-bearing: the flow_shadow_runs guard requires
      // the canonical run and its capability projection to exist first
      // (async_run -> capability_run -> flow_shadow_run).
      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "content_shadow",
        activeKey,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          actionId: body.actionId,
          outputLocale: body.outputLocale,
          capabilityContractVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
        },
      });
      await new CapabilityRunsRepository(tx).create({
        workspaceId: scope.workspaceId,
        projectId,
        asyncRunId: run.id,
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        inputManifestHash: capabilityManifestHash,
        // Shadow mode with internal writes only: no external CMS/publish write
        // exists anywhere in this capability (red line D).
        mode: "shadow",
        sideEffectClass: "internal_write",
      });
      const shadowRun = await new FlowShadowRunsRepository(tx).create({
        workspaceId: scope.workspaceId,
        projectId,
        siteId: inputs.siteId,
        capabilityRunId: run.id,
        sourceFindingId: inputs.findingId,
        sourceActionId: body.actionId,
        contentBriefArtifactId: inputs.contentBriefArtifactId,
        contentBriefRevision: inputs.contentBriefRevision,
        flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
        frozenInputManifest: frozen.manifest as unknown as Record<
          string,
          unknown
        >,
        contentHash: frozen.contentHash,
        projectionVersion: CONTENT_SHADOW_PROJECTION_VERSION,
      });
      await enqueueRunInTx(boss, tx, "content-shadow", {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });

      const dto = toAsyncRunDto(run);
      const statusUrl = runStatusUrl(projectId, run.id);
      const resourceRef = {
        type: "flow_shadow_run" as const,
        id: shadowRun.id,
      };
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody: { run: dto, statusUrl, resourceRef },
        resourceType: "flow_shadow_run",
        resourceId: shadowRun.id,
      });
      return {
        status: 202 as const,
        run: dto,
        statusUrl,
        resourceRef,
        location: statusUrl,
        replayed: false,
      };
    });
  } catch (error) {
    if (error instanceof ContentShadowObservationSeparationError) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "Search and generative observation must stay separate.",
      );
    }
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
        "A Content Shadow run is already active for this Action.",
      );
    }
    throw error;
  }
}

function frozenStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * The frozen manifest is written by this service and is append-only, so a
 * missing field is a real integrity fault rather than something to paper over
 * with a plausible-looking default.
 */
function requiredManifestString(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return value;
}

type ContentShadowSources = NonNullable<
  ContentShadowRunResponse["research"]
>["sources"];

/** Project the stored pack's sources through the response contract shape. */
function projectPackSources(pack: Record<string, unknown>): ContentShadowSources {
  const sources = pack["sources"];
  if (!Array.isArray(sources)) return [];
  const parsed = ContentShadowAuthoritySource.array().safeParse(sources);
  return parsed.success ? parsed.data : [];
}

/**
 * Phase is DERIVED from which append-only child rows exist (decision R1); the
 * shadow rows own no mutable status column of their own.
 */
function deriveContentShadowPhase(
  runStatus: string,
  hasResearch: boolean,
  hasDraftRevision: boolean,
  hasQa: boolean,
): ContentShadowRunResponse["phase"] {
  if (runStatus === "failed" || runStatus === "cancelled") return "failed";
  if (hasQa) return runStatus === "completed" ? "complete" : "qa";
  if (hasDraftRevision) return "draft";
  if (hasResearch) return "research";
  return "queued";
}

/** `GET /projects/{projectId}/content-shadow-runs/{flowShadowRunId}`. */
export async function getContentShadowRun(
  scope: WorkspaceScope,
  projectId: string,
  flowShadowRunId: string,
): Promise<ContentShadowRunResponse> {
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const { db } = getDb();

  // A run in another workspace or project is reported absent, never forbidden.
  const shadowRun: FlowShadowRunRow | null = await new FlowShadowRunsRepository(
    db,
  ).findById(projectScope, flowShadowRunId);
  if (!shadowRun) {
    throw new ProblemError("NOT_FOUND", "Content Shadow run not found.");
  }

  const run = await new AsyncRunsRepository(db).findById(
    projectScope,
    shadowRun.capability_run_id,
  );
  if (!run) {
    throw new ProblemError("NOT_FOUND", "Content Shadow run not found.");
  }

  const manifest = shadowRun.frozen_input_manifest;
  const cluster = manifest["searchCluster"];
  const clusterRecord =
    typeof cluster === "object" && cluster !== null && !Array.isArray(cluster)
      ? (cluster as Record<string, unknown>)
      : {};
  const outputLocale = requiredManifestString(manifest, "outputLocale");

  const pack = await new FlowShadowResearchPacksRepository(db).findByRun(
    projectScope,
    shadowRun.id,
  );
  const gates = await new FlowShadowQaGatesRepository(db).findByRun(
    projectScope,
    shadowRun.id,
  );
  const gate = gates[0] ?? null;

  const artifacts = new ExecutionArtifactsRepository(db);
  const draftArtifact = await artifacts.findLiveByActionType(
    projectScope,
    shadowRun.source_action_id,
    DRAFT_ARTIFACT_TYPE,
  );
  const draftRevision =
    draftArtifact && draftArtifact.current_revision >= 1
      ? await artifacts.findRevision(
          projectScope,
          draftArtifact.id,
          draftArtifact.current_revision,
        )
      : null;

  const research: ContentShadowRunResponse["research"] =
    pack === null
      ? null
      : {
          packId: pack.id,
          sources: projectPackSources(pack.pack),
          limitations: frozenStringArray(pack.pack["limitations"]),
          generatedAt: pack.created_at,
        };

  return {
    flowShadowRunId: shadowRun.id,
    projectId: shadowRun.project_id,
    siteId: shadowRun.site_id,
    asyncRunId: run.id,
    status: run.status as ContentShadowRunResponse["status"],
    phase: deriveContentShadowPhase(
      run.status,
      pack !== null,
      draftRevision !== null,
      gate !== null,
    ),
    contentHash: shadowRun.content_hash,
    projectionVersion: shadowRun.projection_version,
    flowAdapterVersion: shadowRun.flow_adapter_version,
    outputLocale,
    createdAt: shadowRun.created_at,
    source: {
      findingId: shadowRun.source_finding_id,
      actionId: shadowRun.source_action_id,
      contentBriefArtifactId: shadowRun.content_brief_artifact_id,
      contentBriefRevision: shadowRun.content_brief_revision,
    },
    frozenInputs: {
      primaryFindingId: shadowRun.source_finding_id,
      sourceDiagnosticRunId: requiredManifestString(
        manifest,
        "sourceDiagnosticRunId",
      ),
      competitorEntityIds: frozenStringArray(manifest["competitorEntityIds"]),
      searchCluster: {
        clusterKey: requiredManifestString(clusterRecord, "clusterKey"),
        keywordEntityIds: frozenStringArray(clusterRecord["keywordEntityIds"]),
      },
      generativeQueryEntityIds: frozenStringArray(
        manifest["generativeQueryEntityIds"],
      ),
    },
    research,
    draft: draftArtifact
      ? {
          artifactId: draftArtifact.id,
          status: draftArtifact.status as NonNullable<
            ContentShadowRunResponse["draft"]
          >["status"],
          currentRevision: draftArtifact.current_revision,
          contentText: draftRevision?.content_text ?? null,
        }
      : null,
    qa: gate
      ? {
          gateId: gate.id,
          verdict: gate.verdict,
          evaluatedArtifactId: gate.evaluated_artifact_id,
          evaluatedRevision: gate.evaluated_revision,
          claims: gate.claims as NonNullable<
            ContentShadowRunResponse["qa"]
          >["claims"],
          evaluatedAt: gate.created_at,
        }
      : null,
  };
}
