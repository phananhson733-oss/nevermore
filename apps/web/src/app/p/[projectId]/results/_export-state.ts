import { z } from "zod";
import { ApiError } from "@/lib/api";
import { isTerminalRun, type ExportKind, type RunStatus } from "@/lib/api/hooks-report";

/**
 * Closed state machine behind the export rail's create/track flow (R3
 * blueprint D5, same shape as the Growth Map run-diagnosis machine). The
 * reducer owns every submission/tracking/terminal transition; the component
 * only dispatches events and derives its view through the selectors below, so
 * each branch is reachable from a unit test without mounting a React tree.
 *
 * The invariant the old ExportSection broke: a click cleared the tracked
 * export before the server answered, so a mid-poll exportId could be lost
 * forever. Here `submit` is fenced while creating/tracking, and the tracked
 * pointer survives its terminal as the manifest's data source.
 */

export type ExportRailPhase =
  | "idle"
  | "creating"
  | "tracking"
  | "conflictUnknown"
  | "protocolError"
  | "createFailed";

export interface ActiveExportRef {
  readonly exportId: string;
  readonly kind: ExportKind;
}

export interface ExportRailState {
  readonly phase: ExportRailPhase;
  /**
   * The export being tracked, or the last one to settle: kept after terminal
   * on purpose — it is the manifest/download's data source until the next
   * submit replaces it.
   */
  readonly active: ActiveExportRef | null;
  /** The kind the operator last requested; the retry target after a refusal. */
  readonly requestedKind: ExportKind | null;
  /** True when the tracked export was adopted from a 409 body pointer. */
  readonly adopted: boolean;
}

export const INITIAL_EXPORT_RAIL_STATE: ExportRailState = {
  phase: "idle",
  active: null,
  requestedKind: null,
  adopted: false,
};

export interface ExportPointer {
  readonly runId: string;
  readonly exportId: string;
  readonly kind: ExportKind | null;
}

export type ExportRailEvent =
  | { readonly type: "submit"; readonly kind: ExportKind }
  | { readonly type: "accepted"; readonly exportId: string }
  | { readonly type: "acceptedInvalid" }
  | { readonly type: "conflict"; readonly pointer: ExportPointer | null }
  | { readonly type: "createFailed" }
  | {
      readonly type: "exportTerminal";
      readonly exportId: string;
      readonly status: RunStatus;
    };

export function reduceExportRail(
  state: ExportRailState,
  event: ExportRailEvent,
): ExportRailState {
  switch (event.type) {
    case "submit": {
      // Machine-level single-flight fence: never while a create is in flight,
      // and never by clearing an export that is still being tracked.
      if (state.phase === "creating" || state.phase === "tracking") {
        return state;
      }
      return {
        phase: "creating",
        active: null,
        requestedKind: event.kind,
        adopted: false,
      };
    }
    case "accepted": {
      if (state.phase !== "creating" || state.requestedKind === null) {
        return state;
      }
      return {
        ...state,
        phase: "tracking",
        active: { exportId: event.exportId, kind: state.requestedKind },
      };
    }
    case "acceptedInvalid": {
      // A 202 whose body names no trackable export must become a visible
      // protocol error, never a silently blank rail.
      if (state.phase !== "creating") return state;
      return { ...state, phase: "protocolError", active: null };
    }
    case "conflict": {
      if (state.phase !== "creating") return state;
      if (event.pointer === null) {
        // The conflict named no locatable export: say so and offer an
        // explicit retry instead of pretending to track anything.
        return { ...state, phase: "conflictUnknown", active: null };
      }
      return {
        ...state,
        phase: "tracking",
        active: {
          exportId: event.pointer.exportId,
          kind: event.pointer.kind ?? state.requestedKind ?? "service_bundle",
        },
        adopted: true,
      };
    }
    case "createFailed": {
      if (state.phase !== "creating") return state;
      return { ...state, phase: "createFailed" };
    }
    case "exportTerminal": {
      if (state.phase !== "tracking") return state;
      if (state.active === null || state.active.exportId !== event.exportId) {
        return state;
      }
      if (!isTerminalRun(event.status)) return state;
      // `active` survives on purpose: it keeps the manifest/download (or the
      // terminal failure message) mounted while re-enabling the create
      // buttons.
      return { ...state, phase: "idle" };
    }
  }
}

/** Both create buttons are locked exactly while a create/track is live. */
export function exportCreateLocked(state: ExportRailState): boolean {
  return state.phase === "creating" || state.phase === "tracking";
}

/**
 * `Problem.current` is only `Record<string, unknown>` on the wire. A 409 is
 * adopted solely when it names well-formed run/export ids; anything else
 * becomes a pointerless conflict so an unvalidated value can never be polled.
 * An unknown `kind` is discarded rather than trusted.
 */
const ExportPointerSchema = z.object({
  runId: z.uuid(),
  exportId: z.uuid(),
  kind: z.unknown().optional(),
});

function readPointerKind(kind: unknown): ExportKind | null {
  return kind === "service_bundle" || kind === "client_bundle" ? kind : null;
}

export function parseExportPointer(
  current: Readonly<Record<string, unknown>> | null | undefined,
): ExportPointer | null {
  const parsed = ExportPointerSchema.safeParse(current);
  if (!parsed.success) return null;
  return {
    runId: parsed.data.runId,
    exportId: parsed.data.exportId,
    kind: readPointerKind(parsed.data.kind),
  };
}

/** Map one create failure onto exactly one machine event (D5). */
export function exportRailEventFromError(error: unknown): ExportRailEvent {
  if (error instanceof ApiError && error.code === "RUN_ALREADY_ACTIVE") {
    return {
      type: "conflict",
      pointer: parseExportPointer(error.problem.current),
    };
  }
  return { type: "createFailed" };
}
