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
  IcpProfilesRepository,
  IdempotencyRepository,
  KeywordsRepository,
  ProjectsRepository,
  SitesRepository,
  type ArtifactRow,
  type CanonicalValue,
  type Executor,
  type FlowShadowQaGateRow,
  type FlowShadowRunRow,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import {
  CONTENT_SHADOW_PROMPT_SET_VERSION,
  extractContentBriefOutline,
  type ContentBriefOutline,
} from "@sf/artifacts";
import {
  buildContentShadowInputManifest,
  qaSeverityForClaimId,
  CONTENT_SHADOW_ADAPTER_VERSION,
  ContentShadowObservationSeparationError,
  type ContentShadowFirstPartyIdentity,
  type ContentShadowInputManifest,
} from "@sf/flow-shadow";
import { parseIcp } from "@sf/engine";
import {
  CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
  ContentShadowAuthoritySource,
  ContentShadowQaClaim,
  CONTRACT_VERSION,
  type ContentShadowRunResponse,
  type ContentShadowRunSummary,
  type CreateContentShadowRunRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { isPostgresUniqueViolation } from "./db-errors";
import { assertValidTimestampUuidListCursor } from "./list-cursor";
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

/** The frozen content rules whose Action template mints a `content_brief`. */
const CONTENT_BRIEF_RULE_IDS: ReadonlySet<string> = new Set([
  "SEARCH-DECAY-002",
  "CONTENT-COVERAGE-001",
  "CONTENT-GAP-011",
  "CRO-LANDING-003",
]);

/**
 * Brief statuses a shadow run may freeze. `archived` and `failed` are operator
 * or generator outcomes that say "this is not the brief anymore"; `generating`
 * means a rewrite is in flight and the revision under it is about to be
 * superseded. The `flow_shadow_runs` provenance trigger deliberately does NOT
 * look at `status` or `validation_state` — those are human state-machine
 * concepts, not lineage — so this is the only layer that can refuse them.
 */
const FREEZABLE_BRIEF_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "ready",
]);

/** Verbatim from `createActionArtifact`: one drift, one sentence, everywhere. */
const FINDING_DRIFT_DETAIL =
  "Finding changed after this Action was created; review the current opportunity before generating an artifact.";

function briefRejected(code: string, detail: string): ProblemError {
  return new ProblemError("VALIDATION_ERROR", detail, {
    errors: [{ pointer: "/actionId", code, message: detail }],
  });
}

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
  /**
   * The project's own web identity, frozen at accept time (Slice 2 Task 6b).
   * Both halves come from rows this run already pins: the site the frozen
   * diagnosis ran against, and the immutable `icp_profiles` version that
   * diagnosis froze.
   */
  readonly firstParty: ContentShadowFirstPartyIdentity;
  /**
   * Deterministically extracted from the SAME brief revision and keyword rows
   * this function already read — no extra query. Freezing it is what makes the
   * draft a child of the brief rather than its sibling (Slice 2 Task 4b).
   */
  readonly contentBriefOutline: ContentBriefOutline;
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
    throw briefRejected(
      "rule_not_content",
      `Rule ${finding.rule_id} does not produce a content brief, so it cannot start a Content Shadow run.`,
    );
  }
  if (finding.last_seen_run_id !== action.source_diagnostic_run_id) {
    throw new ProblemError("VERSION_CONFLICT", FINDING_DRIFT_DETAIL);
  }

  // Exactly one canonical Action per confirmed Finding: a second live Action
  // would mean a second confirmation path exists (red line B).
  const actionCount = await actions.countActionsForFinding(
    projectScope,
    finding.id,
  );
  if (actionCount === 0) {
    // Defence in depth: unreachable from here, because the admission path above
    // already holds a non-dismissed Action whose `source_finding_id` is this
    // Finding. The state itself IS reachable — dismissing the only Action of a
    // confirmed Finding leaves "confirmed with nothing to execute" — and it is
    // the operator's to fix (restore the Action), so it stays a 422 and matches
    // the code the dismissed-Action branch already answers.
    throw new ProblemError(
      "ACTION_NOT_EXECUTABLE",
      "The confirmed Finding has no live Action to execute; restore the dismissed Action first.",
    );
  }
  if (actionCount > 1) {
    // NOT a 5xx, and deliberately so. `UNIQUE (source_finding_id, template_id)`
    // only makes "one Finding + one template" unique; when a rule set version
    // maps the same rule_id to a NEW template_id, that Finding can legitimately
    // acquire a second Action under the new template. So this is a reachable
    // product state, not data corruption, and 503's "retry later" would be a
    // lie — retrying never converges. It needs a human to pick which Action is
    // canonical, which is exactly what 409 means here.
    throw new ProblemError(
      "FINDING_ACTION_ACTIVE",
      `The confirmed Finding owns ${actionCount} live Actions; dismiss all but the canonical one before running a Content Shadow.`,
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
  if (!FREEZABLE_BRIEF_STATUSES.has(brief.status)) {
    throw briefRejected(
      "brief_not_live",
      `The content brief is ${brief.status}; only a draft or ready brief can be frozen into a Content Shadow run.`,
    );
  }
  if (brief.validation_state === "invalid") {
    throw briefRejected(
      "brief_invalid",
      "The content brief failed its last validation; fix it before freezing it into a Content Shadow run.",
    );
  }
  if (brief.current_revision < 1) {
    throw briefRejected(
      "brief_missing_revision",
      "The content brief has no generated revision to freeze.",
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

  // The project's own web identity, frozen so the QA gate can tell a first-party
  // link apart from an outside citation. `sites.origin` is a MUTABLE row, which
  // is precisely why it is frozen here rather than read at judgement time: an
  // origin that moves inside the accept -> claim window changes the content
  // address and fails the run as input drift (red line C). The conversion target
  // comes from the immutable `icp_profiles` version this diagnosis already
  // pinned, so it cannot move at all.
  const site = await new SitesRepository(exec).findById(
    projectScope,
    diagnosticRun.site_id,
  );
  if (!site) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The frozen diagnosis' site is unavailable.",
    );
  }
  const icpProfile = await new IcpProfilesRepository(exec).findById(
    projectScope,
    diagnosticRun.icp_profile_id,
  );
  if (!icpProfile) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The frozen diagnosis' ICP profile is unavailable.",
    );
  }
  const firstParty: ContentShadowFirstPartyIdentity = {
    siteOrigin: site.origin,
    // `parseIcp` is the one shared reader of the profile jsonb, so the worker's
    // replay guard cannot disagree with this side about what the value is.
    icpPrimaryConversionUrl:
      parseIcp(icpProfile.profile).primaryConversion?.targetUrl ?? null,
  };

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

  // Structured extraction over data already in hand (Slice 2 Task 4b). Only the
  // brief's STRUCTURE crosses into the prompt allowlist; its prose never does.
  const { outline } = extractContentBriefOutline({
    briefMarkdown: briefRevision.content_text,
    keywords: keywordRows.map((row) => ({
      id: row.id,
      displayKeyword: row.display_keyword,
      normalizedKeyword: row.normalized_keyword,
      mappingDecision: row.mapping_decision,
      mappingReviewState: row.mapping_review_state,
    })),
  });

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
    firstParty,
    contentBriefOutline: outline,
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
    firstParty: inputs.firstParty,
    contentBriefOutline: inputs.contentBriefOutline,
    flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    // One constant, one source. The service used to read `PROMPT_SET_VERSION`
    // from `@sf/engine` while the worker read a same-valued but INDEPENDENT
    // constant from `@sf/artifacts`; advancing either alone would have made
    // every Content Shadow run drift.
    promptSetVersion: CONTENT_SHADOW_PROMPT_SET_VERSION,
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

/**
 * One content address, one shadow run (red line C), enforced by the
 * `flow_shadow_runs` UNIQUE (project_id, content_hash) index. Re-submitting a
 * byte-identical frozen tuple is therefore a request for a run that already
 * exists — including after the first one reached a terminal state and released
 * its active key — so the operator is pointed at it instead of silently getting
 * a second, differently drafted run under the same content address.
 *
 * The forward path decision D2 approves stays open: everything the tuple names
 * — the brief revision, the competitor set, cluster membership, the generative
 * set, the output locale, and the pinned adapter/prompt/projection versions —
 * changes the address when it changes, so a genuinely different shadow run for
 * the same Action is accepted.
 */
function contentAddressConflict(
  projectId: string,
  existing: FlowShadowRunRow,
): ProblemError {
  return new ProblemError(
    "VERSION_CONFLICT",
    "A Content Shadow run with exactly these frozen inputs already exists. Read it, or vary the frozen inputs (brief revision, competitor set, cluster, generative set or output locale) to run a different shadow.",
    {
      headers: {
        Location: runStatusUrl(projectId, existing.capability_run_id),
      },
    },
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
      // Checked under the project row lock taken above, so a concurrent
      // duplicate cannot slip between this read and the insert. It converts what
      // the unique index would otherwise raise as an unreadable repository fault
      // into an actionable conflict that names the existing run.
      const duplicate = await new FlowShadowRunsRepository(
        tx,
      ).findByContentHash(projectScope, frozen.contentHash);
      if (duplicate) throw contentAddressConflict(projectId, duplicate);
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

function manifestRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return value as Record<string, unknown>;
}

type ContentShadowFrozenInputsDto = ContentShadowRunResponse["frozenInputs"];

/**
 * The project's frozen web identity, as the read API reports it.
 *
 * It is surfaced because the QA gate's link judgement now hinges on it: a
 * reviewer reading "this link resolves" has to be able to see WHAT it resolved
 * against, and the research pack that also carries it does not exist until the
 * run reaches its research phase.
 */
function projectFirstParty(
  manifest: Record<string, unknown>,
): ContentShadowFrozenInputsDto["firstParty"] {
  const record = manifestRecord(manifest, "firstParty");
  const conversion = record["icpPrimaryConversionUrl"];
  if (typeof conversion !== "string" && conversion !== null) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return {
    siteOrigin: requiredManifestString(record, "siteOrigin"),
    icpPrimaryConversionUrl: conversion,
  };
}

const OUTLINE_PAGE_ASSIGNMENTS: ReadonlySet<string> = new Set([
  "existing_page",
  "new_asset",
  "mixed",
  "unassigned",
]);

/**
 * The brief-derived COVERAGE CHECKLIST (Task 4b decision O-6), which Task 4b
 * deliberately left out of this `.strict()` projection. The side-by-side review
 * has to render the checklist itself — "which committed topics did this draft
 * promise to cover?" is the reviewer's first question — so it is added here
 * rather than leaving the UI to re-derive it from a brief it does not hold.
 */
function projectBriefOutline(
  manifest: Record<string, unknown>,
): ContentShadowFrozenInputsDto["contentBriefOutline"] {
  const record = manifestRecord(manifest, "contentBriefOutline");
  const pageAssignment = record["pageAssignment"];
  if (
    typeof pageAssignment !== "string" ||
    !OUTLINE_PAGE_ASSIGNMENTS.has(pageAssignment)
  ) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return {
    briefSections: frozenStringArray(record["briefSections"]),
    targetKeywords: frozenStringArray(record["targetKeywords"]),
    pageAssignment:
      pageAssignment as ContentShadowFrozenInputsDto["contentBriefOutline"]["pageAssignment"],
  };
}

type ContentShadowSources = NonNullable<
  ContentShadowRunResponse["research"]
>["sources"];

/** Project the stored pack's sources through the response contract shape. */
function projectPackSources(
  pack: Record<string, unknown>,
): ContentShadowSources {
  const sources = pack["sources"];
  if (!Array.isArray(sources)) return [];
  const parsed = ContentShadowAuthoritySource.array().safeParse(sources);
  return parsed.success ? parsed.data : [];
}

type ContentShadowQaClaimsDto = NonNullable<
  ContentShadowRunResponse["qa"]
>["claims"];

/** The claim shape the gate row actually stores — severity is not persisted. */
const StoredContentShadowQaClaim = ContentShadowQaClaim.omit({
  severity: true,
});

/**
 * Widen the stored claims with the severity the gate package owns.
 *
 * The severity is looked up from `@sf/flow-shadow`'s own table rather than
 * restated here: a second literal list of "which checks block" living in this
 * mapper would drift from the rules it describes, and the direction that drift
 * takes is the expensive one — a claim shown as advisory while the gate treats
 * it as blocking reads to a reviewer as safe to accept.
 *
 * An unreadable claim array fails the read instead of degrading to an empty
 * list. A gate row exists precisely because a judgement was made; answering
 * "no findings" when the findings cannot be parsed would be the "we did not
 * look" -> "we found nothing" substitution the gate itself exists to prevent.
 */
function projectQaClaims(stored: unknown): ContentShadowQaClaimsDto {
  const parsed = StoredContentShadowQaClaim.array().safeParse(stored);
  if (!parsed.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The stored Content Shadow quality findings are unreadable.",
    );
  }
  return parsed.data.map((claim) => ({
    ...claim,
    severity: qaSeverityForClaimId(claim.claimId),
  }));
}

type ContentShadowDraftDto = NonNullable<ContentShadowRunResponse["draft"]>;

/**
 * Resolve the draft THIS run owns, never the Action's currently live artifact.
 *
 * `findLiveByActionType` is deliberately not used here. Decision D2 allows a
 * later shadow run for the same Action, and that run legitimately installs a
 * new revision on the same artifact row; answering with it would make a
 * finished run report a body its own frozen QA verdict never saw, and would
 * make a still-queued run claim a predecessor's draft. Two run-scoped bindings
 * are tried in order of durability, and when neither resolves the honest answer
 * is `null` rather than a plausible-looking fallback:
 *
 * 1. this run's QA gate, which pinned (artifact, revision) append-only;
 * 2. this run's own invocation lineage (revision -> invocation -> run);
 * 3. the artifact still claimed by this run, which has produced no revision yet
 *    — reported with revision 0 so the phase cannot read as `draft`.
 */
async function resolveRunScopedDraft(
  artifacts: ExecutionArtifactsRepository,
  scope: ProjectScope,
  asyncRunId: string,
  gate: FlowShadowQaGateRow | null,
): Promise<ContentShadowDraftDto | null> {
  const project = (
    artifact: ArtifactRow,
    revision: number,
    contentText: string | null,
  ): ContentShadowDraftDto => ({
    artifactId: artifact.id,
    status: artifact.status as ContentShadowDraftDto["status"],
    currentRevision: revision,
    contentText,
  });

  if (gate) {
    const artifact = await artifacts.findById(
      scope,
      gate.evaluated_artifact_id,
    );
    if (artifact) {
      const revision = await artifacts.findRevision(
        scope,
        artifact.id,
        gate.evaluated_revision,
      );
      return project(
        artifact,
        gate.evaluated_revision,
        revision?.content_text ?? null,
      );
    }
  }

  const generated = await artifacts.findRevisionByGenerationRun(
    scope,
    asyncRunId,
  );
  if (generated) {
    const artifact = await artifacts.findById(scope, generated.artifact_id);
    if (artifact) {
      return project(artifact, generated.revision, generated.content_text);
    }
  }

  const claimed = await artifacts.findByGenerationRun(scope, asyncRunId);
  return claimed ? project(claimed, 0, null) : null;
}

/**
 * Phase is DERIVED from which append-only RUN-SCOPED child rows exist (decision
 * R1); the shadow rows own no mutable status column of their own, and no input
 * here may come from a row another run could have moved.
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

/**
 * `GET /projects/{projectId}/content-shadow-runs` — the run index.
 *
 * The index answers exactly one question: which Content Shadow runs does this
 * project have? Before it existed a run id was handed out once, in the 202 that
 * created the run, so a page reload left the research pack, the QA verdict and
 * every honesty disclosure unreachable — what a customer could read depended on
 * whether they had refreshed.
 *
 * Each row is assembled from the run's own immutable record alone: no child row
 * is read, no async run is joined, and no phase is derived. That is a contract
 * property, not an optimisation — a list that reported state would have to
 * guess at it per page, and the detail projection already reads the append-only
 * rows that own it.
 */
export async function listContentShadowRuns(
  scope: WorkspaceScope,
  projectId: string,
  opts: { limit: number; cursor: string | null },
): Promise<{
  data: ContentShadowRunSummary[];
  nextCursor: string | null;
  limit: number;
}> {
  assertValidTimestampUuidListCursor(opts.cursor);
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const { db } = getDb();

  // A project in another workspace is reported absent, never forbidden.
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const page = await new FlowShadowRunsRepository(db).listByProject(
    projectScope,
    opts,
  );
  return {
    data: page.rows.map((row) => toContentShadowRunSummary(row)),
    nextCursor: page.nextCursor,
    limit: opts.limit,
  };
}

function toContentShadowRunSummary(
  row: FlowShadowRunRow,
): ContentShadowRunSummary {
  return {
    flowShadowRunId: row.id,
    projectId: row.project_id,
    siteId: row.site_id,
    asyncRunId: row.capability_run_id,
    contentHash: row.content_hash,
    projectionVersion: row.projection_version,
    flowAdapterVersion: row.flow_adapter_version,
    outputLocale: requiredManifestString(
      row.frozen_input_manifest,
      "outputLocale",
    ),
    createdAt: row.created_at,
    source: {
      findingId: row.source_finding_id,
      actionId: row.source_action_id,
      contentBriefArtifactId: row.content_brief_artifact_id,
      contentBriefRevision: row.content_brief_revision,
    },
  };
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

  const draft = await resolveRunScopedDraft(
    new ExecutionArtifactsRepository(db),
    projectScope,
    shadowRun.capability_run_id,
    gate,
  );

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
      draft !== null && draft.currentRevision >= 1,
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
      firstParty: projectFirstParty(manifest),
      contentBriefOutline: projectBriefOutline(manifest),
    },
    research,
    draft,
    qa: gate
      ? {
          gateId: gate.id,
          verdict: gate.verdict,
          evaluatedArtifactId: gate.evaluated_artifact_id,
          evaluatedRevision: gate.evaluated_revision,
          claims: projectQaClaims(gate.claims),
          evaluatedAt: gate.created_at,
        }
      : null,
  };
}
