import { ApiError } from "@/lib/api";
import {
  analysisRefreshRunIdFromError,
  isTerminalRunStatus,
  type RunStatus,
} from "@/lib/api/hooks-sources";

/**
 * Closed state machine behind the Growth Map "Run diagnosis" control
 * (R1 blueprint D4). The reducer owns every submission/tracking/terminal
 * transition; the component only dispatches events and derives its view
 * through the selectors below, so each branch is reachable from a unit test
 * without mounting a React tree.
 */

export type RunDiagnosisPhase =
  | "idle"
  | "submitting"
  | "tracking"
  | "conflictUnknown";

export interface RunDiagnosisTerminal {
  readonly runId: string;
  readonly status: RunStatus;
}

/** Which server-side 422 precondition is holding the control shut. */
export type RunDiagnosisServerGate = "context" | "crawl";

export interface RunDiagnosisState {
  readonly phase: RunDiagnosisPhase;
  /** Kept after terminal on purpose: it is the pill's data source (D4). */
  readonly trackedRunId: string | null;
  /** Last observed terminal run; visible until the next submit clears it. */
  readonly terminal: RunDiagnosisTerminal | null;
  /** A 409 takeover (or unknown conflict) is being surfaced to the operator. */
  readonly runActiveNotice: boolean;
  /**
   * Sticky 422 gate (CONTEXT_INCOMPLETE or SOURCE_NOT_CONNECTED); released
   * only by the matching explicit recheck, never by another click. Both gates
   * share one shape so neither can silently re-POST into the rate limit.
   */
  readonly serverGate: RunDiagnosisServerGate | null;
  readonly submitNotice: "genericError" | null;
  /** Success terminals already refreshed, exactly once per runId (D5). */
  readonly invalidatedRunIds: readonly string[];
  /** Session-scoped Run vs Re-run label input (D8). */
  readonly sessionHasTerminal: boolean;
}

export const INITIAL_RUN_DIAGNOSIS_STATE: RunDiagnosisState = {
  phase: "idle",
  trackedRunId: null,
  terminal: null,
  runActiveNotice: false,
  serverGate: null,
  submitNotice: null,
  invalidatedRunIds: [],
  sessionHasTerminal: false,
};

export interface AnalysisRefreshRunPointer {
  readonly runId: string;
}

export type RunDiagnosisEvent =
  | { readonly type: "submit" }
  | { readonly type: "accepted"; readonly runId: string }
  | {
      readonly type: "conflict";
      readonly pointer: AnalysisRefreshRunPointer | null;
    }
  | { readonly type: "serverGate"; readonly gate: RunDiagnosisServerGate }
  | { readonly type: "submitFailed" }
  | {
      readonly type: "runTerminal";
      readonly runId: string;
      readonly status: RunStatus;
    }
  | { readonly type: "recheckGate"; readonly gate: RunDiagnosisServerGate }
  | { readonly type: "conflictRecovery" };

function isSuccessTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "partial";
}

export function reduceRunDiagnosis(
  state: RunDiagnosisState,
  event: RunDiagnosisEvent,
): RunDiagnosisState {
  switch (event.type) {
    case "submit": {
      // Machine-level single-flight fence: one logical submission at a time,
      // and never while a sticky server gate is unresolved (D1, D2).
      if (state.phase !== "idle" || state.serverGate !== null) return state;
      return {
        ...state,
        phase: "submitting",
        terminal: null,
        submitNotice: null,
        runActiveNotice: false,
      };
    }
    case "accepted": {
      if (state.phase !== "submitting") return state;
      return {
        ...state,
        phase: "tracking",
        trackedRunId: event.runId,
        runActiveNotice: false,
      };
    }
    case "conflict": {
      if (state.phase !== "submitting") return state;
      if (event.pointer === null) {
        return { ...state, phase: "conflictUnknown", runActiveNotice: true };
      }
      return {
        ...state,
        phase: "tracking",
        trackedRunId: event.pointer.runId,
        runActiveNotice: true,
      };
    }
    case "serverGate": {
      // Both 422 preconditions are sticky: the control stays shut until the
      // matching explicit recheck, so a click can never re-POST into the
      // 20/15min rate limit while the server keeps refusing.
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "idle", serverGate: event.gate };
    }
    case "submitFailed": {
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "idle", submitNotice: "genericError" };
    }
    case "runTerminal": {
      if (state.phase !== "tracking") return state;
      if (event.runId !== state.trackedRunId) return state;
      if (!isTerminalRunStatus(event.status)) return state;
      const invalidated =
        isSuccessTerminal(event.status) &&
        !state.invalidatedRunIds.includes(event.runId)
          ? [...state.invalidatedRunIds, event.runId]
          : state.invalidatedRunIds;
      return {
        ...state,
        phase: "idle",
        terminal: { runId: event.runId, status: event.status },
        runActiveNotice: false,
        invalidatedRunIds: invalidated,
        sessionHasTerminal: true,
      };
    }
    case "recheckGate": {
      // Releases only the gate it names: a context recheck can never unlock a
      // crawl gate (and vice versa). The crawl recheck is dispatched by the
      // component strictly after a successful sources.refetch().
      if (state.serverGate !== event.gate) return state;
      return { ...state, serverGate: null };
    }
    case "conflictRecovery": {
      if (state.phase !== "conflictUnknown") return state;
      return { ...state, phase: "idle", runActiveNotice: false };
    }
  }
}

/**
 * Whether this terminal report must trigger the post-run refresh. Read BEFORE
 * dispatching the matching `runTerminal` event: the reduce records the runId
 * so the same terminal can never refresh twice (D5).
 */
export function shouldRefreshAfterTerminal(
  state: RunDiagnosisState,
  runId: string,
  status: RunStatus,
): boolean {
  return (
    state.phase === "tracking" &&
    state.trackedRunId === runId &&
    isSuccessTerminal(status) &&
    !state.invalidatedRunIds.includes(runId)
  );
}

/**
 * Locked is derived from the phase, never from `trackedRunId !== null` (D4):
 * the tracked id survives terminal as the pill source. A poll read error keeps
 * the phase at `tracking`, so the lock holds without extra state.
 */
export function runDiagnosisLocked(state: RunDiagnosisState): boolean {
  return state.phase !== "idle";
}

export function showRunStatusReadError(
  state: RunDiagnosisState,
  pollErrored: boolean,
): boolean {
  return state.phase === "tracking" && pollErrored;
}

export type RunDiagnosisLabelKey =
  | "runDiagnosis"
  | "rerunDiagnosis"
  | "runInProgress";

/** Session-scoped label (D8): no claim is made about pre-session history. */
export function runDiagnosisButtonLabelKey(
  state: RunDiagnosisState,
): RunDiagnosisLabelKey {
  if (state.phase === "submitting" || state.phase === "tracking") {
    return "runInProgress";
  }
  return state.sessionHasTerminal ? "rerunDiagnosis" : "runDiagnosis";
}

/** The pill reads the live poll while tracking, then the recorded terminal. */
export function runDiagnosisStatusPill(
  state: RunDiagnosisState,
  polledStatus: RunStatus | undefined,
): RunStatus | null {
  if (state.phase === "tracking") return polledStatus ?? "queued";
  return state.terminal?.status ?? null;
}

/** Map one Analysis Refresh submission failure onto one machine event (D7). */
export function runDiagnosisEventFromError(error: unknown): RunDiagnosisEvent {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "RUN_ALREADY_ACTIVE": {
        const runId = analysisRefreshRunIdFromError(error);
        return {
          type: "conflict",
          pointer: runId === null ? null : { runId },
        };
      }
      case "CONTEXT_INCOMPLETE":
        return { type: "serverGate", gate: "context" };
      case "SOURCE_NOT_CONNECTED":
        return { type: "serverGate", gate: "crawl" };
      default:
        return { type: "submitFailed" };
    }
  }
  return { type: "submitFailed" };
}
