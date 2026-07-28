import type {
  ActionExecutionStateEvent,
  ActionExecutionStateTimeline,
} from "@sf/contracts";

interface ExecutionStateViewBase {
  readonly phase: string;
  readonly phaseKey: ExecutionPhaseTranslationKey | null;
  readonly nextStep: string | null;
  readonly occurredAt: string;
  readonly revision: number;
  readonly historyCount: number;
}

export interface EmptyExecutionStateView {
  readonly kind: "empty";
  readonly historyCount: 0;
}

export interface BlockedExecutionStateView extends ExecutionStateViewBase {
  readonly kind: "blocked";
  readonly blockerSummary: string;
  readonly unlockCondition: string;
}

export interface InProgressExecutionStateView
  extends ExecutionStateViewBase {
  readonly kind: "in_progress";
  readonly progress: {
    readonly completedSteps: number;
    readonly totalSteps: number;
  } | null;
}

export interface CompletedExecutionStateView
  extends ExecutionStateViewBase {
  readonly kind: "completed";
  readonly nextStep: null;
}

export type ExecutionStateView =
  | EmptyExecutionStateView
  | BlockedExecutionStateView
  | InProgressExecutionStateView
  | CompletedExecutionStateView;

export type ExecutionQueueStateView =
  | { readonly kind: "empty" }
  | {
      readonly kind: "blocked";
      readonly blockerSummary: string;
      readonly unlockCondition: string;
    }
  | {
      readonly kind: "in_progress";
      readonly progress: {
        readonly completedSteps: number;
        readonly totalSteps: number;
      } | null;
    }
  | { readonly kind: "completed" };

export type ExecutionPhaseTranslationKey =
  | "waitingForAuthorization"
  | "waitingForApproval"
  | "waitingForReview"
  | "implementation"
  | "technicalFix"
  | "drafting"
  | "qualityReview"
  | "delivery"
  | "verification"
  | "completed";

export function executionPhaseTranslationKey(
  phase: string,
): ExecutionPhaseTranslationKey | null {
  switch (phase) {
    case "waiting_for_authorization":
      return "waitingForAuthorization";
    case "waiting_for_approval":
      return "waitingForApproval";
    case "waiting_for_review":
      return "waitingForReview";
    case "implementation":
      return "implementation";
    case "technical_fix":
      return "technicalFix";
    case "drafting":
    case "research":
      return "drafting";
    case "qa":
    case "quality_review":
    case "approval":
      return "qualityReview";
    case "deliver":
    case "publishing":
      return "delivery";
    case "verified":
    case "verification":
      return "verification";
    case "completed":
    case "delivered":
      return "completed";
    default:
      return null;
  }
}

/**
 * Customer-facing projection of one exact Artifact execution stream.
 *
 * Deliberately does not accept the legacy Action status: an empty immutable
 * timeline must remain "no execution record", not a guessed delivery state.
 * Numeric progress is emitted only when the canonical event carries a real
 * versioned step definition.
 */
export function buildExecutionStateView(
  timeline: ActionExecutionStateTimeline,
): ExecutionStateView {
  const current = timeline.current;
  if (current === null) {
    return {
      kind: "empty",
      historyCount: 0,
    };
  }

  const common = {
    phase: current.phase,
    phaseKey: executionPhaseTranslationKey(current.phase),
    nextStep: current.nextStep,
    occurredAt: current.occurredAt,
    revision: current.revision,
    historyCount: timeline.history.length,
  } as const;

  if (current.state === "blocked") {
    return {
      ...common,
      kind: "blocked",
      blockerSummary: current.blocker.summary,
      unlockCondition: current.blocker.unlockCondition,
    };
  }
  if (current.state === "in_progress") {
    return {
      ...common,
      kind: "in_progress",
      progress:
        current.progress === null
          ? null
          : {
              completedSteps: current.progress.completedSteps,
              totalSteps: current.progress.totalSteps,
            },
    };
  }
  return {
    ...common,
    kind: "completed",
    nextStep: null,
  };
}

/**
 * Minimal customer-facing projection for an Artifact queue card.
 *
 * This accepts only the current immutable event (or its explicit absence), so
 * callers cannot accidentally substitute legacy Action/Artifact workflow
 * statuses. The selected-item rail remains responsible for phase and history.
 */
export function buildExecutionQueueStateView(
  current: ActionExecutionStateEvent | null,
): ExecutionQueueStateView {
  if (current === null) return { kind: "empty" };
  if (current.state === "blocked") {
    return {
      kind: "blocked",
      blockerSummary: current.blocker.summary,
      unlockCondition: current.blocker.unlockCondition,
    };
  }
  if (current.state === "in_progress") {
    return {
      kind: "in_progress",
      progress:
        current.progress === null
          ? null
          : {
              completedSteps: current.progress.completedSteps,
              totalSteps: current.progress.totalSteps,
            },
    };
  }
  return { kind: "completed" };
}
