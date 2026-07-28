import {
  ActionExecutionStateConflictError,
  ActionExecutionStateIntegrityError,
  ActionExecutionStateRepository,
  ActionsRepository,
  ExecutionArtifactsRepository,
  ProjectsRepository,
  type Executor,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import {
  ActionExecutionStateBatch,
  ActionExecutionStateTimeline,
  MAX_ACTION_EXECUTION_STATE_BATCH_SIZE,
  Uuid,
  type ActionExecutionStateBatch as ActionExecutionStateBatchDto,
  type ActionExecutionStateTimeline as ActionExecutionStateTimelineDto,
  type RecordActionExecutionStateRequest,
  type RecordActionExecutionStateResult,
  type UpdateActionExecutionStateRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";

import { getDb } from "@/lib/db";

interface UpdateActionExecutionStateOptions {
  readonly exec?: Executor;
  readonly now?: () => string;
}

function dependencyUnavailable(): ProblemError {
  return new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The delivery execution record is temporarily unavailable.",
  );
}

function mapAuthorityError(error: unknown): never {
  if (error instanceof ProblemError) throw error;
  if (error instanceof ActionExecutionStateIntegrityError) {
    throw dependencyUnavailable();
  }
  if (error instanceof ActionExecutionStateConflictError) {
    switch (error.code) {
      case "ACTION_NOT_FOUND":
      case "ARTIFACT_NOT_FOUND":
        throw new ProblemError("NOT_FOUND", "Execution target not found.");
      case "REVISION_CONFLICT":
        throw new ProblemError(
          "VERSION_CONFLICT",
          "The delivery execution record changed; refetch and retry.",
          {
            current: {
              expectedRevision: error.expectedRevision,
              currentRevision: error.currentRevision,
            },
          },
        );
      case "IDEMPOTENCY_CONFLICT":
        throw new ProblemError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency-Key reused with another delivery execution command.",
        );
      case "REVISION_EXHAUSTED":
      case "COMPLETED_TERMINAL":
        throw new ProblemError(
          "ACTION_NOT_EXECUTABLE",
          "This delivery execution stream cannot be advanced.",
        );
      case "STEP_DEFINITION_INVALID":
      case "STEP_DEFINITION_CONFLICT":
        throw new ProblemError(
          "VALIDATION_ERROR",
          "The supplied progress does not match the current delivery steps.",
        );
    }
  }
  throw error;
}

async function assertExactExecutionScope(
  workspaceScope: WorkspaceScope,
  projectId: string,
  actionId: string,
  artifactId: string | null,
  exec: Executor,
  writable: boolean,
): Promise<ProjectScope> {
  const project = await new ProjectsRepository(exec).findById(
    workspaceScope,
    projectId,
  );
  if (!project) {
    throw new ProblemError("NOT_FOUND", "Execution target not found.");
  }
  if (writable && project.archived_at) {
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
  }

  const projectScope = {
    workspaceId: workspaceScope.workspaceId,
    projectId,
  };
  const action = await new ActionsRepository(exec).findById(
    projectScope,
    actionId,
  );
  if (!action) {
    throw new ProblemError("NOT_FOUND", "Execution target not found.");
  }

  if (artifactId !== null) {
    const artifact = await new ExecutionArtifactsRepository(
      exec,
    ).findById(projectScope, artifactId);
    if (!artifact || artifact.action_id !== actionId) {
      throw new ProblemError("NOT_FOUND", "Execution target not found.");
    }
  }
  return projectScope;
}

function invalidArtifactBatch(): never {
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Artifact execution batch failed validation.",
  );
}

/**
 * Read current execution authority for a bounded Artifact queue page.
 *
 * The two scoped queries are constant with respect to queue size: one proves
 * each Artifact's Action binding, and one reads each stream's latest immutable
 * event. Missing or mismatched rows fail the entire projection closed.
 */
export async function getArtifactExecutionStateBatch(
  workspaceScope: WorkspaceScope,
  projectId: string,
  artifactIds: readonly string[],
  exec: Executor = getDb().db,
): Promise<ActionExecutionStateBatchDto> {
  if (
    artifactIds.length < 1 ||
    artifactIds.length > MAX_ACTION_EXECUTION_STATE_BATCH_SIZE ||
    new Set(artifactIds).size !== artifactIds.length ||
    artifactIds.some((artifactId) => !Uuid.safeParse(artifactId).success)
  ) {
    return invalidArtifactBatch();
  }
  const project = await new ProjectsRepository(exec).findById(
    workspaceScope,
    projectId,
  );
  if (!project) {
    throw new ProblemError("NOT_FOUND", "Execution target not found.");
  }
  const projectScope = {
    workspaceId: workspaceScope.workspaceId,
    projectId,
  };
  const artifactRows = await new ExecutionArtifactsRepository(
    exec,
  ).listByIds(projectScope, artifactIds);
  if (
    artifactRows.length !== artifactIds.length ||
    new Set(artifactRows.map((artifact) => artifact.id)).size !==
      artifactRows.length
  ) {
    throw new ProblemError("NOT_FOUND", "Execution target not found.");
  }
  const artifactById = new Map(
    artifactRows.map((artifact) => [artifact.id, artifact] as const),
  );

  try {
    const currentEvents = await new ActionExecutionStateRepository(
      exec,
    ).listCurrentForArtifacts(projectScope, artifactIds);
    const currentByArtifact = new Map<
      string,
      (typeof currentEvents)[number]
    >();
    for (const current of currentEvents) {
      const artifactId = current.artifactId;
      const artifact =
        artifactId === null ? undefined : artifactById.get(artifactId);
      if (
        artifactId === null ||
        artifact === undefined ||
        current.projectId !== projectId ||
        current.actionId !== artifact.action_id ||
        currentByArtifact.has(artifactId)
      ) {
        throw dependencyUnavailable();
      }
      currentByArtifact.set(artifactId, current);
    }
    const candidate = {
      projectId,
      items: artifactIds.map((artifactId) => {
        const artifact = artifactById.get(artifactId);
        if (!artifact) throw dependencyUnavailable();
        return {
          actionId: artifact.action_id,
          artifactId,
          current: currentByArtifact.get(artifactId) ?? null,
        };
      }),
    };
    const parsed = ActionExecutionStateBatch.safeParse(candidate);
    if (!parsed.success) throw dependencyUnavailable();
    return parsed.data;
  } catch (error) {
    return mapAuthorityError(error);
  }
}

/**
 * Read one exact delivery execution stream.
 *
 * `artifactId = null` means the Action-level stream. A UUID means that
 * Artifact's stream. Neither scope is inferred from the legacy plan/review
 * `Action.status`, and the two streams are never implicitly aggregated.
 */
export async function getActionExecutionStateTimeline(
  workspaceScope: WorkspaceScope,
  projectId: string,
  actionId: string,
  artifactId: string | null,
  exec: Executor = getDb().db,
): Promise<ActionExecutionStateTimelineDto> {
  const projectScope = await assertExactExecutionScope(
    workspaceScope,
    projectId,
    actionId,
    artifactId,
    exec,
    false,
  );
  try {
    const history = await new ActionExecutionStateRepository(
      exec,
    ).listHistory(projectScope, actionId, artifactId);
    const candidate = {
      actionId,
      artifactId,
      current: history.at(-1) ?? null,
      history,
    };
    const parsed = ActionExecutionStateTimeline.safeParse(candidate);
    if (!parsed.success) throw dependencyUnavailable();
    return parsed.data;
  } catch (error) {
    return mapAuthorityError(error);
  }
}

function internalCommand(
  actionId: string,
  artifactId: string | null,
  actorId: string,
  idempotencyKey: string,
  body: UpdateActionExecutionStateRequest,
  observedAt: string,
): RecordActionExecutionStateRequest {
  if (body.state === "blocked") {
    return {
      actionId,
      artifactId,
      state: body.state,
      phase: body.phase,
      nextStep: body.nextStep,
      blocker: {
        ...body.blocker,
        ownerId: actorId,
        sourceKind: "manual",
        sourceRef: null,
        observedAt,
        freshness: "current",
      },
      progress: null,
      expectedRevision: body.expectedRevision,
      idempotencyKey,
    };
  }
  if (body.state === "in_progress") {
    return {
      actionId,
      artifactId,
      state: body.state,
      phase: body.phase,
      nextStep: body.nextStep,
      blocker: null,
      progress: body.progress,
      expectedRevision: body.expectedRevision,
      idempotencyKey,
    };
  }
  return {
    actionId,
    artifactId,
    state: body.state,
    phase: body.phase,
    nextStep: null,
    blocker: null,
    progress: null,
    expectedRevision: body.expectedRevision,
    idempotencyKey,
  };
}

/**
 * Append one customer/operator delivery execution update.
 *
 * The public request supplies no scope, actor, source, timestamp, freshness, or
 * idempotency facts. Manual blocker authority is completed here from the
 * authenticated operator and server clock before the repository writes it.
 */
export async function updateActionExecutionState(
  workspaceScope: WorkspaceScope,
  projectId: string,
  actionId: string,
  artifactId: string | null,
  actorId: string,
  idempotencyKey: string,
  body: UpdateActionExecutionStateRequest,
  options: UpdateActionExecutionStateOptions = {},
): Promise<RecordActionExecutionStateResult> {
  const exec = options.exec ?? getDb().db;
  const projectScope = await assertExactExecutionScope(
    workspaceScope,
    projectId,
    actionId,
    artifactId,
    exec,
    true,
  );
  const now = options.now?.() ?? new Date().toISOString();
  try {
    return await new ActionExecutionStateRepository(exec).append(
      projectScope,
      actorId,
      internalCommand(
        actionId,
        artifactId,
        actorId,
        idempotencyKey,
        body,
        now,
      ),
    );
  } catch (error) {
    return mapAuthorityError(error);
  }
}
