import { randomUUID } from "node:crypto";
import {
  ActionExecutionStateEvent as ActionExecutionStateEventSchema,
  ActionStepDefinition as ActionStepDefinitionSchema,
  IdempotencyKey,
  MAX_INCREMENTABLE_ACTION_EXECUTION_REVISION,
  MAX_ACTION_EXECUTION_STATE_BATCH_SIZE,
  RecordActionExecutionStateRequest as RecordActionExecutionStateRequestSchema,
  Uuid,
  type ActionExecutionStateEvent,
  type ActionStepDefinition,
  type RecordActionExecutionStateRequest,
} from "@sf/contracts";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";

import type { DbTx } from "../client.ts";
import { contentHash, type CanonicalValue } from "../hash.ts";
import {
  canonicalUtcTimestamptz,
  isTimestamptzInstant,
} from "../instant.ts";
import {
  actionExecutionStateEvents,
  actionExecutionStepDefinitions,
  actions,
  executionArtifacts,
} from "../schema.ts";
import {
  projectPredicate,
  Repository,
  type Executor,
  type ProjectScope,
} from "./base.ts";

type StateEventRow =
  typeof actionExecutionStateEvents.$inferSelect;
type StepDefinitionRow =
  typeof actionExecutionStepDefinitions.$inferSelect;

interface TransactionalExecutor {
  transaction<T>(run: (tx: DbTx) => Promise<T>): Promise<T>;
}

export interface ActionExecutionStateClock {
  readonly newId: () => string;
  /** UTC RFC3339 server time. */
  readonly now: () => string;
}

const SYSTEM_CLOCK: ActionExecutionStateClock = {
  newId: randomUUID,
  now: () => new Date().toISOString(),
};

export interface RegisterActionStepDefinitionInput {
  readonly actionId: string;
  readonly artifactId: string | null;
  readonly key: string;
  readonly version: number;
  readonly steps: readonly {
    readonly key: string;
    readonly label: string;
  }[];
  readonly idempotencyKey: string;
}

export interface RegisterActionStepDefinitionResult {
  readonly definition: ActionStepDefinition;
  readonly replayed: boolean;
}

export type ActionExecutionStateConflictCode =
  | "ACTION_NOT_FOUND"
  | "ARTIFACT_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "REVISION_EXHAUSTED"
  | "IDEMPOTENCY_CONFLICT"
  | "STEP_DEFINITION_INVALID"
  | "STEP_DEFINITION_CONFLICT"
  | "COMPLETED_TERMINAL";

export class ActionExecutionStateConflictError extends Error {
  override readonly name = "ActionExecutionStateConflictError";

  constructor(
    readonly code: ActionExecutionStateConflictCode,
    readonly expectedRevision: number | null = null,
    readonly currentRevision: number | null = null,
  ) {
    super(
      {
        ACTION_NOT_FOUND: "The scoped Action does not exist",
        ARTIFACT_NOT_FOUND:
          "The scoped Artifact does not belong to the Action",
        REVISION_CONFLICT: "The Action execution revision is stale",
        REVISION_EXHAUSTED:
          "The Action execution revision cannot be advanced",
        IDEMPOTENCY_CONFLICT:
          "The Idempotency-Key is permanently bound to another request",
        STEP_DEFINITION_INVALID:
          "The progress does not match its exact Step Definition",
        STEP_DEFINITION_CONFLICT:
          "This Step Definition version already has another identity",
        COMPLETED_TERMINAL:
          "A completed Action execution cannot be reopened",
      }[code],
    );
  }
}

export type ActionExecutionStateIntegrityCode =
  | "SERVER_FACT_INVALID"
  | "EVENT_PROJECTION_INVALID"
  | "STEP_DEFINITION_PROJECTION_INVALID"
  | "PERSISTED_REQUEST_HASH_INVALID"
  | "PERSISTED_DEFINITION_HASH_INVALID"
  | "DATABASE_CONSTRAINT_REJECTED"
  | "EVENT_INSERT_FAILED"
  | "STEP_DEFINITION_INSERT_FAILED";

export class ActionExecutionStateIntegrityError extends Error {
  override readonly name = "ActionExecutionStateIntegrityError";

  constructor(readonly code: ActionExecutionStateIntegrityCode) {
    super(`Action execution authority failed integrity validation: ${code}`);
  }
}

function scopeArtifactPredicate(
  column: typeof actionExecutionStateEvents.artifact_id,
  artifactId: string | null,
): SQL {
  return artifactId === null ? isNull(column) : eq(column, artifactId);
}

function definitionArtifactPredicate(
  artifactId: string | null,
): SQL {
  return artifactId === null
    ? isNull(actionExecutionStepDefinitions.artifact_id)
    : eq(actionExecutionStepDefinitions.artifact_id, artifactId);
}

function assertScope(
  scope: ProjectScope,
  actorId?: string,
): void {
  Uuid.parse(scope.workspaceId);
  Uuid.parse(scope.projectId);
  if (actorId !== undefined) Uuid.parse(actorId);
}

function serverFacts(clock: ActionExecutionStateClock): {
  readonly id: string;
  readonly now: string;
} {
  const id = clock.newId();
  const now = clock.now();
  if (!Uuid.safeParse(id).success || !isTimestamptzInstant(now)) {
    throw new ActionExecutionStateIntegrityError(
      "SERVER_FACT_INVALID",
    );
  }
  return { id, now: canonicalUtcTimestamptz(now) };
}

function canonicalHash(value: unknown): string {
  return contentHash(value as CanonicalValue);
}

function normalizeActionExecutionStateRequest(
  request: RecordActionExecutionStateRequest,
): RecordActionExecutionStateRequest {
  const parsed = RecordActionExecutionStateRequestSchema.parse(request);
  if (parsed.state !== "blocked") return parsed;
  return {
    ...parsed,
    blocker: {
      ...parsed.blocker,
      observedAt: canonicalUtcTimestamptz(
        parsed.blocker.observedAt,
      ),
    },
  };
}

export function actionExecutionStateRequestHash(
  scope: ProjectScope,
  actorId: string,
  request: RecordActionExecutionStateRequest,
): string {
  const normalizedRequest =
    normalizeActionExecutionStateRequest(request);
  return canonicalHash({
    authority: "action-execution-state.v1",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    actorId,
    request: normalizedRequest,
  });
}

export function actionStepDefinitionRequestHash(
  scope: ProjectScope,
  actorId: string,
  input: RegisterActionStepDefinitionInput,
): string {
  return canonicalHash({
    authority: "action-step-definition-request.v1",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    actorId,
    input,
  });
}

function actionStepDefinitionHash(
  scope: ProjectScope,
  input: RegisterActionStepDefinitionInput,
): string {
  return canonicalHash({
    authority: "action-step-definition.v1",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    actionId: input.actionId,
    artifactId: input.artifactId,
    key: input.key,
    version: input.version,
    steps: input.steps,
  });
}

function projectStepDefinition(row: StepDefinitionRow): ActionStepDefinition {
  const parsed = ActionStepDefinitionSchema.safeParse({
    id: row.id,
    projectId: row.project_id,
    actionId: row.action_id,
    artifactId: row.artifact_id,
    key: row.definition_key,
    version: row.definition_version,
    steps: row.steps,
    hash: row.definition_hash,
    createdBy: row.created_by,
    createdAt: canonicalUtcTimestamptz(row.created_at),
  });
  if (!parsed.success) {
    throw new ActionExecutionStateIntegrityError(
      "STEP_DEFINITION_PROJECTION_INVALID",
    );
  }
  const definitionInput: RegisterActionStepDefinitionInput = {
    actionId: parsed.data.actionId,
    artifactId: parsed.data.artifactId,
    key: parsed.data.key,
    version: parsed.data.version,
    steps: parsed.data.steps,
    idempotencyKey: row.idempotency_key,
  };
  const scope = {
    workspaceId: row.workspace_id,
    projectId: row.project_id,
  };
  if (
    row.definition_hash !==
    actionStepDefinitionHash(scope, definitionInput)
  ) {
    throw new ActionExecutionStateIntegrityError(
      "PERSISTED_DEFINITION_HASH_INVALID",
    );
  }
  if (
    row.request_hash !==
    actionStepDefinitionRequestHash(
      scope,
      row.created_by,
      definitionInput,
    )
  ) {
    throw new ActionExecutionStateIntegrityError(
      "PERSISTED_REQUEST_HASH_INVALID",
    );
  }
  return parsed.data;
}

function projectStateEvent(row: StateEventRow): ActionExecutionStateEvent {
  const common = {
    eventId: row.id,
    projectId: row.project_id,
    actionId: row.action_id,
    artifactId: row.artifact_id,
    revision: row.revision,
    expectedRevision: row.expected_revision,
    transitionKind: row.transition_kind,
    state: row.state,
    phase: row.phase,
    nextStep: row.next_step,
    idempotencyKey: row.idempotency_key,
    actorId: row.actor_id,
    occurredAt: canonicalUtcTimestamptz(row.occurred_at),
  };

  const value =
    row.state === "blocked"
      ? {
          ...common,
          state: "blocked" as const,
          blocker: {
            code: row.blocker_code,
            summary: row.blocker_summary,
            unlockCondition: row.unlock_condition,
            ownerId: row.blocker_owner_id,
            sourceKind: row.blocker_source_kind,
            sourceRef: row.blocker_source_ref,
            observedAt:
              row.blocker_observed_at === null
                ? null
                : canonicalUtcTimestamptz(
                    row.blocker_observed_at,
                  ),
            freshness: row.blocker_freshness,
          },
          progress: null,
        }
      : row.state === "in_progress"
        ? {
            ...common,
            state: "in_progress" as const,
            blocker: null,
            progress:
              row.step_definition_id === null
                ? null
                : {
                    stepDefinitionId: row.step_definition_id,
                    stepDefinitionVersion:
                      row.step_definition_version,
                    completedSteps: row.completed_steps,
                    totalSteps: row.total_steps,
                  },
          }
        : {
            ...common,
            state: "completed" as const,
            nextStep: null,
            blocker: null,
            progress: null,
          };
  const parsed = ActionExecutionStateEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new ActionExecutionStateIntegrityError(
      "EVENT_PROJECTION_INVALID",
    );
  }
  const event = parsed.data;
  const request: RecordActionExecutionStateRequest =
    event.state === "blocked"
      ? {
          actionId: event.actionId,
          artifactId: event.artifactId,
          state: event.state,
          phase: event.phase,
          nextStep: event.nextStep,
          blocker: event.blocker,
          progress: null,
          expectedRevision: event.expectedRevision,
          idempotencyKey: event.idempotencyKey,
        }
      : event.state === "in_progress"
        ? {
            actionId: event.actionId,
            artifactId: event.artifactId,
            state: event.state,
            phase: event.phase,
            nextStep: event.nextStep,
            blocker: null,
            progress: event.progress,
            expectedRevision: event.expectedRevision,
            idempotencyKey: event.idempotencyKey,
          }
        : {
            actionId: event.actionId,
            artifactId: event.artifactId,
            state: event.state,
            phase: event.phase,
            nextStep: null,
            blocker: null,
            progress: null,
            expectedRevision: event.expectedRevision,
            idempotencyKey: event.idempotencyKey,
          };
  if (
    row.request_hash !==
    actionExecutionStateRequestHash(
      {
        workspaceId: row.workspace_id,
        projectId: row.project_id,
      },
      row.actor_id,
      request,
    )
  ) {
    throw new ActionExecutionStateIntegrityError(
      "PERSISTED_REQUEST_HASH_INVALID",
    );
  }
  return event;
}

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) {
      return undefined;
    }
    const wrapped = candidate as {
      readonly code?: unknown;
      readonly cause?: unknown;
    };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

export class ActionExecutionStateRepository extends Repository {
  constructor(
    exec: Executor,
    private readonly clock: ActionExecutionStateClock = SYSTEM_CLOCK,
  ) {
    super(exec);
  }

  async findCurrent(
    scope: ProjectScope,
    actionId: string,
    artifactId: string | null,
  ): Promise<ActionExecutionStateEvent | null> {
    assertScope(scope);
    Uuid.parse(actionId);
    if (artifactId !== null) Uuid.parse(artifactId);
    const rows = await this.exec
      .select()
      .from(actionExecutionStateEvents)
      .where(
        and(
          projectPredicate(actionExecutionStateEvents, scope),
          eq(actionExecutionStateEvents.action_id, actionId),
          scopeArtifactPredicate(
            actionExecutionStateEvents.artifact_id,
            artifactId,
          ),
        ),
      )
      .orderBy(
        desc(actionExecutionStateEvents.revision),
        desc(actionExecutionStateEvents.id),
      )
      .limit(1);
    return rows[0] ? projectStateEvent(rows[0]) : null;
  }

  async listHistory(
    scope: ProjectScope,
    actionId: string,
    artifactId: string | null,
  ): Promise<ActionExecutionStateEvent[]> {
    assertScope(scope);
    Uuid.parse(actionId);
    if (artifactId !== null) Uuid.parse(artifactId);
    const rows = await this.exec
      .select()
      .from(actionExecutionStateEvents)
      .where(
        and(
          projectPredicate(actionExecutionStateEvents, scope),
          eq(actionExecutionStateEvents.action_id, actionId),
          scopeArtifactPredicate(
            actionExecutionStateEvents.artifact_id,
            artifactId,
          ),
        ),
      )
      .orderBy(
        asc(actionExecutionStateEvents.revision),
        asc(actionExecutionStateEvents.id),
      );
    return rows.map(projectStateEvent);
  }

  /**
   * Read the latest immutable Artifact-level event for every requested stream
   * in one query. Streams without an event are intentionally absent and are
   * restored as `current: null` only after the service proves Artifact scope.
   */
  async listCurrentForArtifacts(
    scope: ProjectScope,
    artifactIds: readonly string[],
  ): Promise<ActionExecutionStateEvent[]> {
    assertScope(scope);
    if (
      artifactIds.length > MAX_ACTION_EXECUTION_STATE_BATCH_SIZE ||
      new Set(artifactIds).size !== artifactIds.length
    ) {
      throw new RangeError("Artifact execution batch is invalid");
    }
    if (artifactIds.length === 0) return [];
    for (const artifactId of artifactIds) Uuid.parse(artifactId);

    const rows = await this.exec
      .selectDistinctOn([actionExecutionStateEvents.artifact_id])
      .from(actionExecutionStateEvents)
      .where(
        and(
          projectPredicate(actionExecutionStateEvents, scope),
          isNotNull(actionExecutionStateEvents.artifact_id),
          inArray(actionExecutionStateEvents.artifact_id, [
            ...artifactIds,
          ]),
        ),
      )
      .orderBy(
        asc(actionExecutionStateEvents.artifact_id),
        desc(actionExecutionStateEvents.revision),
        desc(actionExecutionStateEvents.id),
      );
    return rows.map(projectStateEvent);
  }

  async append(
    scope: ProjectScope,
    actorId: string,
    request: RecordActionExecutionStateRequest,
  ): Promise<{
    readonly event: ActionExecutionStateEvent;
    readonly replayed: boolean;
  }> {
    assertScope(scope, actorId);
    const parsed = normalizeActionExecutionStateRequest(request);
    const requestHash = actionExecutionStateRequestHash(
      scope,
      actorId,
      parsed,
    );
    const replay = await this.findStateEventByIdempotencyKey(
      this.exec,
      scope,
      parsed.idempotencyKey,
    );
    if (replay) {
      return this.replayStateEvent(replay, requestHash);
    }

    return this.inTransaction(async (tx) => {
      await this.acquireProjectWriterLock(tx, scope);
      const lockedReplay =
        await this.findStateEventByIdempotencyKey(
          tx,
          scope,
          parsed.idempotencyKey,
        );
      if (lockedReplay) {
        return this.replayStateEvent(lockedReplay, requestHash);
      }
      return this.appendLocked(
        tx,
        scope,
        actorId,
        parsed,
        requestHash,
      );
    });
  }

  async registerStepDefinition(
    scope: ProjectScope,
    actorId: string,
    input: RegisterActionStepDefinitionInput,
  ): Promise<RegisterActionStepDefinitionResult> {
    assertScope(scope, actorId);
    Uuid.parse(input.actionId);
    if (input.artifactId !== null) Uuid.parse(input.artifactId);
    IdempotencyKey.parse(input.idempotencyKey);

    const preview = ActionStepDefinitionSchema.parse({
      id: "00000000-0000-4000-8000-000000000000",
      projectId: scope.projectId,
      actionId: input.actionId,
      artifactId: input.artifactId,
      key: input.key,
      version: input.version,
      steps: input.steps,
      hash: "0".repeat(64),
      createdBy: actorId,
      createdAt: "2000-01-01T00:00:00.000Z",
    });
    const normalizedInput: RegisterActionStepDefinitionInput = {
      actionId: preview.actionId,
      artifactId: preview.artifactId,
      key: preview.key,
      version: preview.version,
      steps: preview.steps,
      idempotencyKey: input.idempotencyKey,
    };
    const requestHash = actionStepDefinitionRequestHash(
      scope,
      actorId,
      normalizedInput,
    );
    const replay = await this.findStepDefinitionByIdempotencyKey(
      this.exec,
      scope,
      input.idempotencyKey,
    );
    if (replay) {
      return this.replayStepDefinition(replay, requestHash);
    }

    return this.inTransaction(async (tx) => {
      await this.acquireProjectWriterLock(tx, scope);
      const lockedReplay =
        await this.findStepDefinitionByIdempotencyKey(
          tx,
          scope,
          normalizedInput.idempotencyKey,
        );
      if (lockedReplay) {
        return this.replayStepDefinition(
          lockedReplay,
          requestHash,
        );
      }
      await this.assertActionScope(
        tx,
        scope,
        normalizedInput.actionId,
      );
      await this.assertArtifactScope(
        tx,
        scope,
        normalizedInput.actionId,
        normalizedInput.artifactId,
      );

      const conflicting = await tx
        .select({ id: actionExecutionStepDefinitions.id })
        .from(actionExecutionStepDefinitions)
        .where(
          and(
            projectPredicate(
              actionExecutionStepDefinitions,
              scope,
            ),
            eq(
              actionExecutionStepDefinitions.action_id,
              normalizedInput.actionId,
            ),
            definitionArtifactPredicate(
              normalizedInput.artifactId,
            ),
            eq(
              actionExecutionStepDefinitions.definition_key,
              normalizedInput.key,
            ),
            eq(
              actionExecutionStepDefinitions.definition_version,
              normalizedInput.version,
            ),
          ),
        )
        .limit(1);
      if (conflicting[0]) {
        throw new ActionExecutionStateConflictError(
          "STEP_DEFINITION_CONFLICT",
        );
      }

      const facts = serverFacts(this.clock);
      const rows = await tx
        .insert(actionExecutionStepDefinitions)
        .values({
          id: facts.id,
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          action_id: normalizedInput.actionId,
          artifact_id: normalizedInput.artifactId,
          definition_key: normalizedInput.key,
          definition_version: normalizedInput.version,
          steps: [...normalizedInput.steps],
          step_count: normalizedInput.steps.length,
          definition_hash: actionStepDefinitionHash(
            scope,
            normalizedInput,
          ),
          idempotency_key: normalizedInput.idempotencyKey,
          request_hash: requestHash,
          created_by: actorId,
          created_at: facts.now,
        })
        .returning();
      if (!rows[0]) {
        throw new ActionExecutionStateIntegrityError(
          "STEP_DEFINITION_INSERT_FAILED",
        );
      }
      return {
        definition: projectStepDefinition(rows[0]),
        replayed: false,
      };
    });
  }

  private async appendLocked(
    tx: Executor,
    scope: ProjectScope,
    actorId: string,
    request: RecordActionExecutionStateRequest,
    requestHash: string,
  ): Promise<{
    readonly event: ActionExecutionStateEvent;
    readonly replayed: boolean;
  }> {
    await this.assertActionScope(tx, scope, request.actionId);
    await this.assertArtifactScope(
      tx,
      scope,
      request.actionId,
      request.artifactId,
    );
    const latest = await this.findLatestStateEvent(
      tx,
      scope,
      request.actionId,
      request.artifactId,
      true,
    );
    const latestEvent =
      latest === null ? null : projectStateEvent(latest);
    const currentRevision = latestEvent?.revision ?? 0;
    if (latestEvent?.state === "completed") {
      throw new ActionExecutionStateConflictError(
        "COMPLETED_TERMINAL",
      );
    }
    if (currentRevision > MAX_INCREMENTABLE_ACTION_EXECUTION_REVISION) {
      throw new ActionExecutionStateConflictError(
        "REVISION_EXHAUSTED",
        request.expectedRevision,
        currentRevision,
      );
    }
    if (request.expectedRevision !== currentRevision) {
      throw new ActionExecutionStateConflictError(
        "REVISION_CONFLICT",
        request.expectedRevision,
        currentRevision,
      );
    }

    if (request.progress !== null) {
      const definitions = await tx
        .select()
        .from(actionExecutionStepDefinitions)
        .where(
          and(
            projectPredicate(
              actionExecutionStepDefinitions,
              scope,
            ),
            eq(
              actionExecutionStepDefinitions.id,
              request.progress.stepDefinitionId,
            ),
            eq(
              actionExecutionStepDefinitions.action_id,
              request.actionId,
            ),
            definitionArtifactPredicate(request.artifactId),
          ),
        )
        .limit(1);
      const definition = definitions[0];
      if (!definition) {
        throw new ActionExecutionStateConflictError(
          "STEP_DEFINITION_INVALID",
        );
      }
      const projectedDefinition =
        projectStepDefinition(definition);
      if (
        projectedDefinition.version !==
          request.progress.stepDefinitionVersion ||
        projectedDefinition.steps.length !==
          request.progress.totalSteps ||
        definition.step_count !== projectedDefinition.steps.length
      ) {
        throw new ActionExecutionStateConflictError(
          "STEP_DEFINITION_INVALID",
        );
      }
    }

    const facts = serverFacts(this.clock);
    const transitionKind =
      latestEvent === null || latestEvent.state !== request.state
        ? "state_transition"
        : "state_update";
    const blocker =
      request.state === "blocked" ? request.blocker : null;
    const progress =
      request.state === "in_progress" ? request.progress : null;
    const rows = await tx
      .insert(actionExecutionStateEvents)
      .values({
        id: facts.id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        action_id: request.actionId,
        artifact_id: request.artifactId,
        revision: request.expectedRevision + 1,
        expected_revision: request.expectedRevision,
        state: request.state,
        transition_kind: transitionKind,
        phase: request.phase,
        next_step: request.nextStep,
        blocker_code: blocker?.code ?? null,
        blocker_summary: blocker?.summary ?? null,
        unlock_condition: blocker?.unlockCondition ?? null,
        blocker_owner_id: blocker?.ownerId ?? null,
        blocker_source_kind: blocker?.sourceKind ?? null,
        blocker_source_ref: blocker?.sourceRef ?? null,
        blocker_observed_at: blocker?.observedAt ?? null,
        blocker_freshness: blocker?.freshness ?? null,
        step_definition_id: progress?.stepDefinitionId ?? null,
        step_definition_version:
          progress?.stepDefinitionVersion ?? null,
        completed_steps: progress?.completedSteps ?? null,
        total_steps: progress?.totalSteps ?? null,
        idempotency_key: request.idempotencyKey,
        request_hash: requestHash,
        actor_id: actorId,
        occurred_at: facts.now,
        created_at: facts.now,
      })
      .returning();
    if (!rows[0]) {
      throw new ActionExecutionStateIntegrityError(
        "EVENT_INSERT_FAILED",
      );
    }
    return {
      event: projectStateEvent(rows[0]),
      replayed: false,
    };
  }

  private async assertActionScope(
    exec: Executor,
    scope: ProjectScope,
    actionId: string,
  ): Promise<void> {
    const rows = await exec
      .select({
        id: actions.id,
        workspace_id: actions.workspace_id,
        project_id: actions.project_id,
        status: actions.status,
        revision: actions.revision,
      })
      .from(actions)
      .where(
        and(
          projectPredicate(actions, scope),
          eq(actions.id, actionId),
        ),
      )
      .limit(1)
      .for("update");
    if (!rows[0]) {
      throw new ActionExecutionStateConflictError(
        "ACTION_NOT_FOUND",
      );
    }
  }

  private async assertArtifactScope(
    exec: Executor,
    scope: ProjectScope,
    actionId: string,
    artifactId: string | null,
  ): Promise<void> {
    if (artifactId === null) return;
    const rows = await exec
      .select({
        id: executionArtifacts.id,
        workspace_id: executionArtifacts.workspace_id,
        project_id: executionArtifacts.project_id,
        action_id: executionArtifacts.action_id,
        status: executionArtifacts.status,
      })
      .from(executionArtifacts)
      .where(
        and(
          projectPredicate(executionArtifacts, scope),
          eq(executionArtifacts.action_id, actionId),
          eq(executionArtifacts.id, artifactId),
        ),
      )
      .limit(1)
      .for("update");
    if (!rows[0]) {
      throw new ActionExecutionStateConflictError(
        "ARTIFACT_NOT_FOUND",
      );
    }
  }

  private async findLatestStateEvent(
    exec: Executor,
    scope: ProjectScope,
    actionId: string,
    artifactId: string | null,
    lock: boolean,
  ): Promise<StateEventRow | null> {
    const query = exec
      .select()
      .from(actionExecutionStateEvents)
      .where(
        and(
          projectPredicate(actionExecutionStateEvents, scope),
          eq(actionExecutionStateEvents.action_id, actionId),
          scopeArtifactPredicate(
            actionExecutionStateEvents.artifact_id,
            artifactId,
          ),
        ),
      )
      .orderBy(
        desc(actionExecutionStateEvents.revision),
        desc(actionExecutionStateEvents.id),
      )
      .limit(1);
    const rows = lock ? await query.for("update") : await query;
    return rows[0] ?? null;
  }

  private async findStateEventByIdempotencyKey(
    exec: Executor,
    scope: ProjectScope,
    idempotencyKey: string,
  ): Promise<StateEventRow | null> {
    const rows = await exec
      .select()
      .from(actionExecutionStateEvents)
      .where(
        and(
          projectPredicate(actionExecutionStateEvents, scope),
          eq(
            actionExecutionStateEvents.idempotency_key,
            idempotencyKey,
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async findStepDefinitionByIdempotencyKey(
    exec: Executor,
    scope: ProjectScope,
    idempotencyKey: string,
  ): Promise<StepDefinitionRow | null> {
    const rows = await exec
      .select()
      .from(actionExecutionStepDefinitions)
      .where(
        and(
          projectPredicate(actionExecutionStepDefinitions, scope),
          eq(
            actionExecutionStepDefinitions.idempotency_key,
            idempotencyKey,
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private replayStateEvent(
    row: StateEventRow,
    requestHash: string,
  ): {
    readonly event: ActionExecutionStateEvent;
    readonly replayed: true;
  } {
    const event = projectStateEvent(row);
    if (row.request_hash !== requestHash) {
      throw new ActionExecutionStateConflictError(
        "IDEMPOTENCY_CONFLICT",
      );
    }
    return { event, replayed: true };
  }

  private replayStepDefinition(
    row: StepDefinitionRow,
    requestHash: string,
  ): RegisterActionStepDefinitionResult {
    const definition = projectStepDefinition(row);
    if (row.request_hash !== requestHash) {
      throw new ActionExecutionStateConflictError(
        "IDEMPOTENCY_CONFLICT",
      );
    }
    return {
      definition,
      replayed: true,
    };
  }

  private async acquireProjectWriterLock(
    exec: Executor,
    scope: ProjectScope,
  ): Promise<void> {
    const key =
      `action-execution:${scope.workspaceId}:${scope.projectId}`;
    await exec.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }

  private async inTransaction<T>(
    run: (tx: Executor) => Promise<T>,
  ): Promise<T> {
    const transactional = this.exec as TransactionalExecutor;
    try {
      if (typeof transactional.transaction === "function") {
        return await transactional.transaction((tx) => run(tx));
      }
      return await run(this.exec);
    } catch (error) {
      const code = pgCode(error);
      if (code === "40001") {
        throw new ActionExecutionStateConflictError(
          "REVISION_CONFLICT",
        );
      }
      if (code === "23514") {
        throw new ActionExecutionStateIntegrityError(
          "DATABASE_CONSTRAINT_REJECTED",
        );
      }
      throw error;
    }
  }
}
