import {
  BeginTopicModelDraftRequest as BeginTopicModelDraftRequestSchema,
  ConfirmTopicModelRequest as ConfirmTopicModelRequestSchema,
  KeywordGovernanceRevisionConflict,
  PatchTopicModelDraftRequest as PatchTopicModelDraftRequestSchema,
  TopicModelWorkspaceProjection,
  type BeginTopicModelDraftRequest,
  type ConfirmTopicModelRequest,
  type PatchTopicModelDraftRequest,
  type TopicModelRevision,
} from "@sf/contracts";
import {
  KeywordGovernanceScheduleRequestsRepository,
  ProjectsRepository,
  TopicModelConflictError,
  TopicModelIntegrityError,
  TopicModelsRepository,
  type Executor,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import { scheduleKeywordGovernanceSuggestions } from "@sf/db/keyword-governance-suggestion-scheduler";
import { ProblemError } from "@sf/observability";
import { getBoss } from "@/lib/boss";
import { getDb } from "@/lib/db";

type DraftTopicModel = Extract<TopicModelRevision, { state: "draft" }>;
type ConfirmedTopicModel = Extract<
  TopicModelRevision,
  { state: "confirmed" }
>;
type TopicModelWorkspace = ReturnType<typeof TopicModelWorkspaceProjection.parse>;
type SuggestionSchedulerContext = Parameters<
  typeof scheduleKeywordGovernanceSuggestions
>[0];

interface ConfirmDraftTransactionResult {
  readonly workspace: TopicModelWorkspace;
  readonly scheduleRequestId: string;
}

async function dispatchManualTopicSuggestionRequest(
  schedulerContext: SuggestionSchedulerContext,
  projectScope: ProjectScope,
  requestId: string,
  initiatedBy: string,
): Promise<void> {
  const requests = new KeywordGovernanceScheduleRequestsRepository(
    schedulerContext.db,
  );
  const claim = await requests.claimRequest(projectScope, {
    requestId,
    leaseSeconds: 60,
  });
  if (claim.kind === "unavailable") return;
  const release = async (): Promise<void> => {
    try {
      await requests.release(projectScope, {
        requestId,
        claimToken: claim.request.claimToken,
        errorCode: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
      });
    } catch {
      // Lease expiry keeps this durable request recoverable by the Worker.
    }
  };
  try {
    const scheduled = await scheduleKeywordGovernanceSuggestions(
      schedulerContext,
      {
        scope: projectScope,
        initiatedBy,
      },
    );
    if (scheduled.kind === "active") {
      await release();
      return;
    }
    await requests.complete(projectScope, {
      requestId,
      claimToken: claim.request.claimToken,
    });
  } catch {
    await release();
  }
}

export interface TopicModelMutationScope extends WorkspaceScope {
  /** Server-resolved operator identity; never accepted from the request body. */
  readonly actorId: string;
}

function projectNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Project not found.");
}

function topicDraftNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Topic Model draft not found.");
}

function topicModelUnavailable(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The Topic Model authority failed its integrity checks.",
  );
}

async function loadActiveProject(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
): Promise<ProjectScope> {
  const project = await new ProjectsRepository(exec).findById(
    scope,
    projectId,
  );
  if (
    !project ||
    project.workspace_id !== scope.workspaceId ||
    project.id !== projectId ||
    project.archived_at !== null
  ) {
    return projectNotFound();
  }
  return { workspaceId: scope.workspaceId, projectId };
}

function revisionConflict(
  projectId: string,
  expectedRevision: number | null,
  currentRevision: number | null,
): never {
  const parsed = KeywordGovernanceRevisionConflict.safeParse({
    kind: "revision_conflict",
    resource: "topic_model",
    projectId,
    resourceId: projectId,
    expectedRevision,
    currentRevision,
  });
  if (!parsed.success) return topicModelUnavailable();
  throw new ProblemError(
    "STALE_REVISION",
    "Topic Model revision is stale; refetch and retry.",
    { current: parsed.data },
  );
}

function semanticTopicValidation(
  message: string,
  code = "invalid_topic_model_mutation",
): never {
  throw new ProblemError("VALIDATION_ERROR", message, {
    errors: [
      {
        pointer: "/intents",
        code,
        message,
      },
    ],
  });
}

interface ExpectedTopicRevisions {
  readonly modelRevision: number;
  readonly editRevision?: number;
}

function mapTopicModelError(
  error: unknown,
  projectId: string,
  expected: ExpectedTopicRevisions,
): never {
  if (error instanceof TopicModelConflictError) {
    switch (error.code) {
      case "PROJECT_NOT_FOUND":
        return projectNotFound();
      case "DRAFT_NOT_FOUND":
        return topicDraftNotFound();
      case "DRAFT_EXISTS":
        throw new ProblemError(
          "VERSION_CONFLICT",
          "A Topic Model draft already exists; open the current draft instead.",
        );
      case "MODEL_REVISION_CONFLICT":
        if (error.expectedRevision !== expected.modelRevision) {
          return topicModelUnavailable();
        }
        return revisionConflict(
          projectId,
          error.expectedRevision,
          error.currentRevision,
        );
      case "EDIT_REVISION_CONFLICT":
        if (
          expected.editRevision === undefined ||
          error.expectedRevision !== expected.editRevision
        ) {
          return topicModelUnavailable();
        }
        return revisionConflict(
          projectId,
          error.expectedRevision,
          error.currentRevision,
        );
      case "TOPIC_NODE_NOT_FOUND":
        return semanticTopicValidation(
          "A referenced Topic Node does not exist in the current draft.",
        );
      case "TOPIC_NODE_INVALID":
        return semanticTopicValidation(
          "The requested Topic changes would create an invalid Topic Map.",
        );
      case "TOPIC_ROOT_RETIRE_FORBIDDEN":
        return semanticTopicValidation(
          "根 Topic 不能删除；请先保留或重构根节点。",
          "root_topic_cannot_be_retired",
        );
      case "TOPIC_NODE_HAS_ACTIVE_CHILDREN":
        return semanticTopicValidation(
          "该 Topic 仍有活跃子节点；请先移动或删除这些子节点。",
          "topic_has_active_children",
        );
      case "TOPIC_ALIAS_CONFLICT":
      case "REVISION_EXHAUSTED":
        return topicModelUnavailable();
    }
  }
  if (error instanceof TopicModelIntegrityError) {
    return topicModelUnavailable();
  }
  throw error;
}

function workspaceProjection(
  projectId: string,
  latestConfirmed: ConfirmedTopicModel | null,
  draft: DraftTopicModel | null,
): ReturnType<typeof TopicModelWorkspaceProjection.parse> {
  const parsed = TopicModelWorkspaceProjection.safeParse({
    projectId,
    latestConfirmed,
    draft,
    generatedAt: new Date().toISOString(),
  });
  if (!parsed.success) return topicModelUnavailable();
  return parsed.data;
}

async function readWorkspace(
  exec: Executor,
  scope: ProjectScope,
): Promise<ReturnType<typeof TopicModelWorkspaceProjection.parse>> {
  const repository = new TopicModelsRepository(exec);
  // A transaction executor owns one pg client. Keep these reads sequential.
  const latestConfirmed = await repository.getLatestConfirmed(scope);
  const draft = await repository.getDraft(scope);
  return workspaceProjection(scope.projectId, latestConfirmed, draft);
}

async function getWorkspaceInSnapshot(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
): Promise<ReturnType<typeof TopicModelWorkspaceProjection.parse>> {
  const projectScope = await loadActiveProject(exec, scope, projectId);
  try {
    return await readWorkspace(exec, projectScope);
  } catch (error) {
    if (error instanceof TopicModelIntegrityError) {
      return topicModelUnavailable();
    }
    throw error;
  }
}

/**
 * Read the confirmed Topic Map and its editable successor together. A draft
 * never replaces the confirmed model before an explicit confirmation.
 */
export async function getProjectAuditTopicModelWorkspace(
  scope: WorkspaceScope,
  projectId: string,
  exec?: Executor,
): Promise<ReturnType<typeof TopicModelWorkspaceProjection.parse>> {
  if (exec) return getWorkspaceInSnapshot(exec, scope, projectId);
  return getDb().db.transaction(
    (tx) => getWorkspaceInSnapshot(tx, scope, projectId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function beginDraftInTransaction(
  exec: Executor,
  scope: TopicModelMutationScope,
  projectId: string,
  body: BeginTopicModelDraftRequest,
): Promise<ReturnType<typeof TopicModelWorkspaceProjection.parse>> {
  const projectScope = await loadActiveProject(exec, scope, projectId);
  const repository = new TopicModelsRepository(exec);
  try {
    await repository.beginDraftFromLatestConfirmed(
      projectScope,
      scope.actorId,
      body,
    );
    return await readWorkspace(exec, projectScope);
  } catch (error) {
    return mapTopicModelError(error, projectId, {
      modelRevision: body.expectedLatestConfirmedRevision,
    });
  }
}

/** Begin the unique next Topic Map draft from an exact confirmed revision. */
export async function beginProjectAuditTopicModelDraft(
  scope: TopicModelMutationScope,
  projectId: string,
  body: BeginTopicModelDraftRequest,
  exec?: Executor,
): Promise<ReturnType<typeof TopicModelWorkspaceProjection.parse>> {
  const parsed = BeginTopicModelDraftRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Topic Model draft request failed validation.",
    );
  }
  if (exec) {
    return beginDraftInTransaction(exec, scope, projectId, parsed.data);
  }
  return getDb().db.transaction((tx) =>
    beginDraftInTransaction(tx, scope, projectId, parsed.data),
  );
}

async function patchDraftInTransaction(
  exec: Executor,
  scope: TopicModelMutationScope,
  projectId: string,
  body: PatchTopicModelDraftRequest,
): Promise<ReturnType<typeof TopicModelWorkspaceProjection.parse>> {
  const projectScope = await loadActiveProject(exec, scope, projectId);
  const repository = new TopicModelsRepository(exec);
  try {
    await repository.patchDraft(projectScope, scope.actorId, body);
    return await readWorkspace(exec, projectScope);
  } catch (error) {
    return mapTopicModelError(error, projectId, {
      modelRevision: body.topicModelRevision,
      editRevision: body.expectedEditRevision,
    });
  }
}

/**
 * Apply one compare-and-swap edit batch. Node UUIDs and aliases remain
 * server-authored. Split, merge, and retirement are staged in the draft;
 * affected Keyword invalidation is atomic with explicit confirmation.
 */
export async function patchProjectAuditTopicModelDraft(
  scope: TopicModelMutationScope,
  projectId: string,
  body: PatchTopicModelDraftRequest,
  exec?: Executor,
): Promise<ReturnType<typeof TopicModelWorkspaceProjection.parse>> {
  const parsed = PatchTopicModelDraftRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Topic Model edit failed validation.",
    );
  }
  if (exec) {
    return patchDraftInTransaction(exec, scope, projectId, parsed.data);
  }
  return getDb().db.transaction((tx) =>
    patchDraftInTransaction(tx, scope, projectId, parsed.data),
  );
}

async function confirmDraftInTransaction(
  exec: Executor,
  scope: TopicModelMutationScope,
  projectId: string,
  body: ConfirmTopicModelRequest,
): Promise<ConfirmDraftTransactionResult> {
  const projectScope = await loadActiveProject(exec, scope, projectId);
  const repository = new TopicModelsRepository(exec);
  try {
    await repository.confirmDraft(projectScope, scope.actorId, body);
    const workspace = await readWorkspace(exec, projectScope);
    const recorded =
      await new KeywordGovernanceScheduleRequestsRepository(
        exec,
      ).insertRequest(projectScope, {
        sourceKind: "topic_model_confirmation_manual",
        sourceRef: `${projectId}:${body.topicModelRevision}`,
        initiatedBy: scope.actorId,
      });
    return { workspace, scheduleRequestId: recorded.request.id };
  } catch (error) {
    return mapTopicModelError(error, projectId, {
      modelRevision: body.topicModelRevision,
      editRevision: body.expectedEditRevision,
    });
  }
}

/**
 * Confirm the exact draft edit revision and expose it as the new immutable
 * Growth Map Topic authority.
 */
export async function confirmProjectAuditTopicModelDraft(
  scope: TopicModelMutationScope,
  projectId: string,
  body: ConfirmTopicModelRequest,
  exec?: Executor,
): Promise<ReturnType<typeof TopicModelWorkspaceProjection.parse>> {
  const parsed = ConfirmTopicModelRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Topic Model confirmation failed validation.",
    );
  }
  if (exec) {
    const confirmed = await confirmDraftInTransaction(
      exec,
      scope,
      projectId,
      parsed.data,
    );
    return confirmed.workspace;
  }
  const db = getDb().db;
  const confirmed = await db.transaction((tx) =>
    confirmDraftInTransaction(tx, scope, projectId, parsed.data),
  );
  try {
    await dispatchManualTopicSuggestionRequest(
      { db, boss: await getBoss() },
      { workspaceId: scope.workspaceId, projectId },
      confirmed.scheduleRequestId,
      scope.actorId,
    );
  } catch {
    // The manual Topic confirmation and request are already committed.
  }
  return confirmed.workspace;
}
