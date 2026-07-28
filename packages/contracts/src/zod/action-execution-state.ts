import { z } from "zod";
import { IdempotencyKey, IsoDateTime, Uuid } from "./common.ts";

/** PostgreSQL `integer` ceiling for the append-only event revision. */
export const MAX_ACTION_EXECUTION_REVISION = 2_147_483_647;
/** Largest CAS value that can be advanced by one without overflowing. */
export const MAX_INCREMENTABLE_ACTION_EXECUTION_REVISION =
  MAX_ACTION_EXECUTION_REVISION - 1;

const ExpectedActionExecutionRevision = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_INCREMENTABLE_ACTION_EXECUTION_REVISION);
const ActionExecutionRevision = z
  .number()
  .int()
  .positive()
  .max(MAX_ACTION_EXECUTION_REVISION);
const PositiveVersion = z
  .number()
  .int()
  .positive()
  .max(MAX_ACTION_EXECUTION_REVISION);
const StepCount = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_ACTION_EXECUTION_REVISION);
const PositiveStepCount = z
  .number()
  .int()
  .positive()
  .max(MAX_ACTION_EXECUTION_REVISION);
const UserReadableExecutionText = z.string().trim().min(1).max(2_000);
const ExecutionPhase = z.string().trim().min(1).max(100);
const NextStep = z.string().trim().min(1).max(1_000).nullable();
const StableKey = z
  .string()
  .regex(
    /^[a-z][a-z0-9_.-]{0,127}$/u,
    "Must be a stable lowercase key",
  );
const Sha256Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Must be a lowercase SHA-256 hex digest");
const POSTGRES_UTC_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/u;

function isPostgresUtcInstant(value: string): boolean {
  const match = POSTGRES_UTC_INSTANT.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leap =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

const ExecutionObservedAt = IsoDateTime.refine(
  isPostgresUtcInstant,
  "Must be a real UTC instant at no more than PostgreSQL microsecond precision",
);

export const ActionExecutionState = z.enum([
  "blocked",
  "in_progress",
  "completed",
]);
export type ActionExecutionState = z.infer<typeof ActionExecutionState>;

export const ActionExecutionBlockerSourceKind = z.enum([
  "qa_claim",
  "provider_readiness",
  "approval",
  "dependency",
  "async_failure",
  "manual",
]);
export type ActionExecutionBlockerSourceKind = z.infer<
  typeof ActionExecutionBlockerSourceKind
>;

export const ActionExecutionBlockerFreshness = z.enum([
  "current",
  "stale",
  "unknown",
]);
export type ActionExecutionBlockerFreshness = z.infer<
  typeof ActionExecutionBlockerFreshness
>;

/**
 * A blocker is customer-readable but retains the exact authority source and
 * source observation time. Event actor/time remain separate server facts.
 */
export const ActionExecutionBlocker = z
  .object({
    code: StableKey,
    summary: UserReadableExecutionText,
    unlockCondition: UserReadableExecutionText,
    ownerId: Uuid.nullable(),
    sourceKind: ActionExecutionBlockerSourceKind,
    sourceRef: z.string().trim().min(1).max(1_000).nullable(),
    observedAt: ExecutionObservedAt,
    freshness: ActionExecutionBlockerFreshness,
  })
  .strict();
export type ActionExecutionBlocker = z.infer<
  typeof ActionExecutionBlocker
>;

/**
 * Numeric business progress exists only against one exact, versioned Step
 * Definition. It is not interchangeable with a machine Async Run percentage.
 */
export const ActionExecutionProgress = z
  .object({
    stepDefinitionId: Uuid,
    stepDefinitionVersion: PositiveVersion,
    completedSteps: StepCount,
    totalSteps: PositiveStepCount,
  })
  .strict()
  .superRefine((progress, ctx) => {
    if (progress.completedSteps > progress.totalSteps) {
      ctx.addIssue({
        code: "custom",
        path: ["completedSteps"],
        message: "completedSteps must be less than or equal to totalSteps",
      });
    }
  });
export type ActionExecutionProgress = z.infer<
  typeof ActionExecutionProgress
>;

const ActionExecutionCommandShape = {
  actionId: Uuid,
  artifactId: Uuid.nullable(),
  phase: ExecutionPhase,
  expectedRevision: ExpectedActionExecutionRevision,
  idempotencyKey: IdempotencyKey,
} as const;

const BlockActionExecutionRequest = z
  .object({
    ...ActionExecutionCommandShape,
    state: z.literal("blocked"),
    nextStep: NextStep,
    blocker: ActionExecutionBlocker,
    progress: z.null(),
  })
  .strict();

const StartActionExecutionRequest = z
  .object({
    ...ActionExecutionCommandShape,
    state: z.literal("in_progress"),
    nextStep: NextStep,
    blocker: z.null(),
    progress: ActionExecutionProgress.nullable(),
  })
  .strict();

const CompleteActionExecutionRequest = z
  .object({
    ...ActionExecutionCommandShape,
    state: z.literal("completed"),
    nextStep: z.null(),
    blocker: z.null(),
    progress: z.null(),
  })
  .strict();

/**
 * Exact client command. Event identity, project scope, event revision,
 * transition classification, actor and occurrence time are server-owned and
 * therefore absent from (and rejected by) this strict schema.
 */
export const RecordActionExecutionStateRequest = z.discriminatedUnion(
  "state",
  [
    BlockActionExecutionRequest,
    StartActionExecutionRequest,
    CompleteActionExecutionRequest,
  ],
);
export type RecordActionExecutionStateRequest = z.infer<
  typeof RecordActionExecutionStateRequest
>;

const PublicExecutionCommandShape = {
  phase: ExecutionPhase,
  expectedRevision: ExpectedActionExecutionRevision,
} as const;

/**
 * Browser/operator command for the existing Execution Center.
 *
 * Action/Artifact scope comes from the path and query, idempotency comes from
 * the request header, and manual blocker owner/source/time/freshness are
 * server-authored. Non-manual evidence sources are written only by trusted
 * backend workflows through `RecordActionExecutionStateRequest`.
 */
export const UpdateActionExecutionStateRequest =
  z.discriminatedUnion("state", [
    z
      .object({
        ...PublicExecutionCommandShape,
        state: z.literal("blocked"),
        nextStep: NextStep,
        blocker: z
          .object({
            code: StableKey,
            summary: UserReadableExecutionText,
            unlockCondition: UserReadableExecutionText,
          })
          .strict(),
        progress: z.null(),
      })
      .strict(),
    z
      .object({
        ...PublicExecutionCommandShape,
        state: z.literal("in_progress"),
        nextStep: NextStep,
        blocker: z.null(),
        progress: ActionExecutionProgress.nullable(),
      })
      .strict(),
    z
      .object({
        ...PublicExecutionCommandShape,
        state: z.literal("completed"),
        nextStep: z.null(),
        blocker: z.null(),
        progress: z.null(),
      })
      .strict(),
  ]);
export type UpdateActionExecutionStateRequest = z.infer<
  typeof UpdateActionExecutionStateRequest
>;

/** Compatibility name for repositories/services that describe the write as append. */
export const AppendActionExecutionStateRequest =
  RecordActionExecutionStateRequest;
export type AppendActionExecutionStateRequest =
  RecordActionExecutionStateRequest;

export const ActionExecutionTransitionKind = z.enum([
  "state_transition",
  "state_update",
]);
export type ActionExecutionTransitionKind = z.infer<
  typeof ActionExecutionTransitionKind
>;

const ActionExecutionEventShape = {
  ...ActionExecutionCommandShape,
  eventId: Uuid,
  projectId: Uuid,
  revision: ActionExecutionRevision,
  transitionKind: ActionExecutionTransitionKind,
  actorId: Uuid,
  occurredAt: IsoDateTime,
} as const;

const BlockedActionExecutionStateEvent = z
  .object({
    ...ActionExecutionEventShape,
    state: z.literal("blocked"),
    nextStep: NextStep,
    blocker: ActionExecutionBlocker,
    progress: z.null(),
  })
  .strict();

const InProgressActionExecutionStateEvent = z
  .object({
    ...ActionExecutionEventShape,
    state: z.literal("in_progress"),
    nextStep: NextStep,
    blocker: z.null(),
    progress: ActionExecutionProgress.nullable(),
  })
  .strict();

const CompletedActionExecutionStateEvent = z
  .object({
    ...ActionExecutionEventShape,
    state: z.literal("completed"),
    nextStep: z.null(),
    blocker: z.null(),
    progress: z.null(),
  })
  .strict();

/**
 * One immutable append-only event. A successful CAS advances the supplied
 * expected revision by exactly one; replay status belongs to the result
 * wrapper and never changes this canonical event.
 */
export const ActionExecutionStateEvent = z
  .discriminatedUnion("state", [
    BlockedActionExecutionStateEvent,
    InProgressActionExecutionStateEvent,
    CompletedActionExecutionStateEvent,
  ])
  .superRefine((event, ctx) => {
    if (event.revision !== event.expectedRevision + 1) {
      ctx.addIssue({
        code: "custom",
        path: ["revision"],
        message: "revision must equal expectedRevision plus one",
      });
    }
  });
export type ActionExecutionStateEvent = z.infer<
  typeof ActionExecutionStateEvent
>;

export const RecordActionExecutionStateResult = z
  .object({
    event: ActionExecutionStateEvent,
    replayed: z.boolean(),
  })
  .strict();
export type RecordActionExecutionStateResult = z.infer<
  typeof RecordActionExecutionStateResult
>;

/**
 * One exact execution stream. `artifactId = null` is the Action-level stream;
 * a UUID is that Artifact's own stream. The two are never implicitly merged.
 *
 * This is the authority for delivery execution facts and blocker evidence. It
 * is deliberately separate from the legacy Action plan/review workflow status.
 */
export const ActionExecutionStateTimeline = z
  .object({
    actionId: Uuid,
    artifactId: Uuid.nullable(),
    current: ActionExecutionStateEvent.nullable(),
    history: z.array(ActionExecutionStateEvent).max(10_000),
  })
  .strict()
  .superRefine((timeline, ctx) => {
    for (const [index, event] of timeline.history.entries()) {
      if (
        event.actionId !== timeline.actionId ||
        event.artifactId !== timeline.artifactId
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["history", index],
          message: "History event scope must match the requested execution stream",
        });
      }
      if (event.revision !== index + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["history", index, "revision"],
          message: "History revisions must be complete and ascending",
        });
      }
    }
    const latest = timeline.history.at(-1) ?? null;
    if (
      (latest === null) !== (timeline.current === null) ||
      (latest !== null &&
        timeline.current !== null &&
        latest.eventId !== timeline.current.eventId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["current"],
        message: "Current must be the latest exact history event",
      });
    }
  });
export type ActionExecutionStateTimeline = z.infer<
  typeof ActionExecutionStateTimeline
>;

/** Maximum exact Artifact streams accepted by one queue read. */
export const MAX_ACTION_EXECUTION_STATE_BATCH_SIZE = 50;

/**
 * Current immutable fact for one Artifact queue card.
 *
 * `current = null` is an intentional absence of recorded execution. Consumers
 * must not replace it with Artifact generation status or legacy Action status.
 */
export const ActionExecutionStateBatchItem = z
  .object({
    actionId: Uuid,
    artifactId: Uuid,
    current: ActionExecutionStateEvent.nullable(),
  })
  .strict()
  .superRefine((item, ctx) => {
    const current = item.current;
    if (current === null) return;
    if (
      current.actionId !== item.actionId ||
      current.artifactId !== item.artifactId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["current"],
        message:
          "Current event scope must match the exact Artifact execution stream",
      });
    }
  });
export type ActionExecutionStateBatchItem = z.infer<
  typeof ActionExecutionStateBatchItem
>;

/**
 * Bounded project-scoped current-state projection for the existing Execution
 * Center queue. This intentionally carries no history: full history remains on
 * the selected exact stream endpoint.
 */
export const ActionExecutionStateBatch = z
  .object({
    projectId: Uuid,
    items: z
      .array(ActionExecutionStateBatchItem)
      .min(1)
      .max(MAX_ACTION_EXECUTION_STATE_BATCH_SIZE),
  })
  .strict()
  .superRefine((batch, ctx) => {
    const artifactIds = new Set<string>();
    for (const [index, item] of batch.items.entries()) {
      if (artifactIds.has(item.artifactId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "artifactId"],
          message: "Artifact execution streams must be unique",
        });
      }
      artifactIds.add(item.artifactId);
      if (
        item.current !== null &&
        item.current.projectId !== batch.projectId
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "current", "projectId"],
          message: "Current event must belong to the requested project",
        });
      }
    }
  });
export type ActionExecutionStateBatch = z.infer<
  typeof ActionExecutionStateBatch
>;

const ActionStepDefinitionStep = z
  .object({
    key: StableKey,
    label: z.string().trim().min(1).max(500),
  })
  .strict();

/**
 * Immutable source of truth for customer-visible numeric business progress.
 * Array order is the step order; keys cannot repeat inside one definition.
 */
export const ActionStepDefinition = z
  .object({
    id: Uuid,
    projectId: Uuid,
    actionId: Uuid,
    artifactId: Uuid.nullable(),
    key: StableKey,
    version: PositiveVersion,
    steps: z
      .array(ActionStepDefinitionStep)
      .min(1)
      .max(100)
      .refine(
        (steps) =>
          new Set(steps.map((step) => step.key)).size === steps.length,
        "Step keys must be unique",
      ),
    hash: Sha256Hex,
    createdBy: Uuid,
    createdAt: IsoDateTime,
  })
  .strict();
export type ActionStepDefinition = z.infer<typeof ActionStepDefinition>;
