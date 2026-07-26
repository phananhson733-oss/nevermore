import type { InfiniteData } from "@tanstack/react-query";
import type {
  ActionStatus,
  PriorityBand,
  RoadmapLane,
} from "@/lib/api/hooks-studio";
import { allowedActionStatusTargets } from "../_action-status-transitions";

/**
 * Closed state machine behind the Execution "Adjust action" dialog (R2
 * blueprint 2026-07-27, D2/D5). The reducer owns every submission and 409
 * transition; the component only dispatches events and derives its view
 * through the selectors below, so each branch is reachable from a unit test
 * without mounting a React tree.
 *
 * The 409 space is deliberately closed: the server reuses VERSION_CONFLICT
 * for BOTH a stale `baseRevision` and an illegal status transition
 * (actions-service.ts). The refresh step disambiguates by revision: a moved
 * revision means stale (adopt the new base, keep the operator's text), an
 * unmoved revision means the transition itself was refused (clear the status
 * choice so the same request cannot loop forever).
 */

// The server contract bounds (UpdateActionRequest): reason trim 3..1000
// required, note <= 4000 optional.
export const OVERRIDE_REASON_MIN = 3;
export const OVERRIDE_REASON_MAX = 1000;
export const OVERRIDE_NOTE_MAX = 4000;

/** The subset of an Action the override machine reasons about. */
export interface OverrideActionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly status: ActionStatus;
  readonly priorityBand: PriorityBand;
  readonly roadmapLane: RoadmapLane;
  readonly revision: number;
}

/** Select values use "" as the "keep unchanged" sentinel (Plan precedent). */
export interface OverrideFormState {
  readonly statusSel: string;
  readonly prioritySel: string;
  readonly laneSel: string;
  readonly reason: string;
  readonly note: string;
}

export function initialOverrideForm(): OverrideFormState {
  return { statusSel: "", prioritySel: "", laneSel: "", reason: "", note: "" };
}

/** Dirty means any edit at all: a discard prompt must never lose silent work. */
export function isOverrideFormDirty(form: OverrideFormState): boolean {
  return (
    form.statusSel !== "" ||
    form.prioritySel !== "" ||
    form.laneSel !== "" ||
    form.reason.length > 0 ||
    form.note.length > 0
  );
}

export interface OverrideSubmitBody {
  readonly baseRevision: number;
  readonly reason: string;
  readonly status?: ActionStatus;
  readonly priorityBand?: PriorityBand;
  readonly roadmapLane?: RoadmapLane;
  readonly note?: string;
}

export type OverrideSubmitPlan =
  | { readonly kind: "reasonRequired" }
  | { readonly kind: "reasonTooLong" }
  | { readonly kind: "noteTooLong" }
  | { readonly kind: "noChange" }
  | { readonly kind: "submit"; readonly body: OverrideSubmitBody };

/**
 * Build the PATCH body from the form, or name the local refusal. Only real
 * changes enter the body: sentinels, values equal to the current Action, and
 * status targets the graph forbids are all dropped (Plan OverrideForm
 * semantics), so an "everything kept" submission is a noChange, not a 400.
 */
export function planOverrideSubmit(
  action: OverrideActionSnapshot,
  form: OverrideFormState,
): OverrideSubmitPlan {
  const reason = form.reason.trim();
  if (reason.length < OVERRIDE_REASON_MIN) return { kind: "reasonRequired" };
  if (reason.length > OVERRIDE_REASON_MAX) return { kind: "reasonTooLong" };

  const allowed = allowedActionStatusTargets(action.status);
  const changes: {
    status?: ActionStatus;
    priorityBand?: PriorityBand;
    roadmapLane?: RoadmapLane;
  } = {};
  if (
    form.statusSel !== "" &&
    allowed.includes(form.statusSel as ActionStatus)
  ) {
    changes.status = form.statusSel as ActionStatus;
  }
  if (form.prioritySel !== "" && form.prioritySel !== action.priorityBand) {
    changes.priorityBand = form.prioritySel as PriorityBand;
  }
  if (form.laneSel !== "" && form.laneSel !== action.roadmapLane) {
    changes.roadmapLane = form.laneSel as RoadmapLane;
  }
  if (Object.keys(changes).length === 0) return { kind: "noChange" };

  const note = form.note.trim();
  if (note.length > OVERRIDE_NOTE_MAX) return { kind: "noteTooLong" };

  return {
    kind: "submit",
    body: {
      baseRevision: action.revision,
      reason,
      ...changes,
      ...(note.length > 0 ? { note } : {}),
    },
  };
}

// ------------------------------------------------------------ the machine --

export type OverridePhase =
  | "idle"
  | "submitting"
  | "conflictRefreshing"
  | "staleConflict"
  | "transitionConflict"
  | "conflictRefreshError";

export type OverrideNotice =
  | "reasonRequired"
  | "reasonTooLong"
  | "noteTooLong"
  | "noChange"
  | "requestFailed"
  | "conflictStale"
  | "conflictTransition"
  | "conflictRefreshFailed";

export interface OverrideState {
  readonly phase: OverridePhase;
  /**
   * The Action the whole edit is measured against, frozen when the dialog
   * opens. Options, keep-current labels and the submitted `baseRevision` all
   * read THIS snapshot, never the live prop: a background list refetch that
   * advances the prop must not silently rebase an in-progress edit, or the
   * PATCH would carry the newer revision and step over the concurrent change
   * the CAS check exists to surface. Only `refreshResolved` — the machine's
   * own 409-disambiguation step — may move the baseline.
   */
  readonly baseline: OverrideActionSnapshot;
  readonly form: OverrideFormState;
  readonly notice: OverrideNotice | null;
  /** The caught error behind the notice, for ProblemNotice provenance. */
  readonly problem: unknown;
  /** The baseRevision whose PATCH earned the 409 being disambiguated. */
  readonly conflictRevision: number | null;
}

export function initialOverrideState(
  baseline: OverrideActionSnapshot,
): OverrideState {
  return {
    phase: "idle",
    baseline,
    form: initialOverrideForm(),
    notice: null,
    problem: null,
    conflictRevision: null,
  };
}

export type OverrideEvent =
  | { readonly type: "edit"; readonly patch: Partial<OverrideFormState> }
  | {
      readonly type: "reject";
      readonly notice:
        | "reasonRequired"
        | "reasonTooLong"
        | "noteTooLong"
        | "noChange";
    }
  | { readonly type: "submit" }
  | { readonly type: "requestFailed"; readonly problem: unknown }
  | {
      readonly type: "conflict";
      readonly submittedRevision: number;
      readonly problem: unknown;
    }
  | {
      readonly type: "refreshResolved";
      readonly refreshed: OverrideActionSnapshot | undefined;
    }
  | { readonly type: "refreshFailed"; readonly problem: unknown }
  | { readonly type: "retryRefresh" };

/** Phases whose only legal exits are machine events, never operator input. */
const LOCKED_PHASES: ReadonlySet<OverridePhase> = new Set([
  "submitting",
  "conflictRefreshing",
  "conflictRefreshError",
]);

/** Phases from which a (re)submission may start. */
const SUBMITTABLE_PHASES: ReadonlySet<OverridePhase> = new Set([
  "idle",
  "staleConflict",
  "transitionConflict",
]);

export function reduceOverride(
  state: OverrideState,
  event: OverrideEvent,
): OverrideState {
  switch (event.type) {
    case "edit": {
      if (LOCKED_PHASES.has(state.phase)) return state;
      return { ...state, form: { ...state.form, ...event.patch } };
    }
    case "reject": {
      if (!SUBMITTABLE_PHASES.has(state.phase)) return state;
      return { ...state, notice: event.notice, problem: null };
    }
    case "submit": {
      // Machine-level single-flight fence; the component adds a synchronous
      // ref fence on the handler's first line (R1 precedent).
      if (!SUBMITTABLE_PHASES.has(state.phase)) return state;
      return {
        ...state,
        phase: "submitting",
        notice: null,
        problem: null,
        conflictRevision: null,
      };
    }
    case "requestFailed": {
      if (state.phase !== "submitting") return state;
      return {
        ...state,
        phase: "idle",
        notice: "requestFailed",
        problem: event.problem,
      };
    }
    case "conflict": {
      if (state.phase !== "submitting") return state;
      return {
        ...state,
        phase: "conflictRefreshing",
        problem: event.problem,
        conflictRevision: event.submittedRevision,
      };
    }
    case "refreshResolved": {
      if (state.phase !== "conflictRefreshing") return state;
      const refreshed = event.refreshed;
      if (refreshed === undefined) {
        // The refreshed window no longer contains the action: neither 409
        // meaning can be proven, so stay locked behind an explicit retry.
        return {
          ...state,
          phase: "conflictRefreshError",
          notice: "conflictRefreshFailed",
        };
      }
      if (refreshed.revision !== state.conflictRevision) {
        // Stale base: adopt the refreshed current AS the new baseline in the
        // same event (options, keep labels and the next baseRevision move
        // together, atomically), keep the operator's text, drop selections
        // the refreshed current makes illegal or redundant.
        const statusStillLegal = allowedActionStatusTargets(
          refreshed.status,
        ).includes(state.form.statusSel as ActionStatus);
        return {
          ...state,
          phase: "staleConflict",
          notice: "conflictStale",
          baseline: refreshed,
          conflictRevision: null,
          form: {
            ...state.form,
            statusSel: statusStillLegal ? state.form.statusSel : "",
            prioritySel:
              state.form.prioritySel === refreshed.priorityBand
                ? ""
                : state.form.prioritySel,
            laneSel:
              state.form.laneSel === refreshed.roadmapLane
                ? ""
                : state.form.laneSel,
          },
        };
      }
      // Same revision: the server refused the transition itself. Clearing the
      // status choice forces a re-pick, which closes the 409 loop. Adopting
      // `refreshed` is revision-neutral here but keeps the baseline the
      // refresh's own truth rather than the open-time copy.
      return {
        ...state,
        phase: "transitionConflict",
        notice: "conflictTransition",
        baseline: refreshed,
        conflictRevision: null,
        form: { ...state.form, statusSel: "" },
      };
    }
    case "refreshFailed": {
      if (state.phase !== "conflictRefreshing") return state;
      // The GET's own failure replaces the 409 as the displayed problem: the
      // notice tells the operator the REFRESH failed, so the code/requestId
      // shown beside it must come from that failed read, not the stale PATCH.
      return {
        ...state,
        phase: "conflictRefreshError",
        notice: "conflictRefreshFailed",
        problem: event.problem,
      };
    }
    case "retryRefresh": {
      if (state.phase !== "conflictRefreshError") return state;
      return { ...state, phase: "conflictRefreshing" };
    }
  }
}

// --------------------------------------------------------------- selectors --

/** Inputs and submit are inert while a request or refusal is unresolved. */
export function overrideControlsLocked(state: OverrideState): boolean {
  return LOCKED_PHASES.has(state.phase);
}

/** Retry-refresh is the single exit from a failed conflict refresh. */
export function overrideRetryAvailable(state: OverrideState): boolean {
  return state.phase === "conflictRefreshError";
}

// ------------------------------------------------- success cache adoption --

/**
 * Guarded, immutable success-path cache write (D5). The mutation hook has
 * already invalidated and awaited a refetch by the time the caller runs, so
 * this only takes effect when that refetch failed or raced: a cached row is
 * replaced ONLY while it is staler than the successful PATCH response, and
 * every untouched page keeps its reference so no unrelated render is forced.
 */
export function adoptActionIntoPages<
  T extends { readonly id: string; readonly revision: number },
  P extends { readonly data: readonly T[] },
>(
  data: InfiniteData<P, string | null> | undefined,
  updated: T,
): InfiniteData<P, string | null> | undefined {
  if (data === undefined) return undefined;
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const items = page.data.map((item) => {
      if (item.id !== updated.id || item.revision >= updated.revision) {
        return item;
      }
      pageChanged = true;
      return updated;
    });
    if (!pageChanged) return page;
    changed = true;
    // Only `data` is replaced; the page keeps its meta and remains page-shaped.
    return { ...page, data: items } as P;
  });
  return changed ? { ...data, pages } : data;
}

// ------------------------------------------------ linked-action rail (D8) --

export type LinkedActionRailState =
  | "loaded"
  | "loading"
  | "error"
  | "notFoundAfterExhaustion"
  | "searchLimitReached";

/**
 * What the rail says about a selected artifact whose Action may live on a
 * cursor page that is not loaded yet (D8). "loading" while the bounded
 * auto-pagination can still make progress, "error" when the read needs an
 * operator retry. The two terminal outcomes are distinct on purpose:
 * "notFoundAfterExhaustion" means every page was read and the action is
 * genuinely absent, "searchLimitReached" means the bounded walk stopped at
 * its page cap while the server still had pages — one is a fact about the
 * data, the other about this screen's search budget.
 */
export function linkedActionRailState(input: {
  readonly artifactSelected: boolean;
  readonly actionLoaded: boolean;
  readonly listLoaded: boolean;
  readonly fetching: boolean;
  readonly fetchNextError: boolean;
  readonly initialError: boolean;
  readonly hasNextPage: boolean;
  readonly pagesLoaded: number;
  readonly maxPages: number;
}): LinkedActionRailState {
  if (!input.artifactSelected || input.actionLoaded) return "loaded";
  if (input.fetchNextError || input.initialError) return "error";
  if (!input.listLoaded || input.fetching) return "loading";
  if (!input.hasNextPage) return "notFoundAfterExhaustion";
  if (input.pagesLoaded < input.maxPages) return "loading";
  return "searchLimitReached";
}

/**
 * Whether the bounded linked-action walk (D8) should request the next cursor
 * page right now. Pure so the stop conditions — action already found, pages
 * exhausted, a failed page read awaiting an operator retry, a fetch already
 * in flight, and the page cap — are each provable with small values instead
 * of a 100-page fixture.
 */
export function shouldAutoFetchLinkedAction(input: {
  readonly artifactSelected: boolean;
  readonly actionLoaded: boolean;
  readonly listLoaded: boolean;
  readonly fetching: boolean;
  readonly fetchNextError: boolean;
  readonly hasNextPage: boolean;
  readonly pagesLoaded: number;
  readonly maxPages: number;
}): boolean {
  if (!input.artifactSelected || input.actionLoaded) return false;
  if (!input.listLoaded || !input.hasNextPage) return false;
  if (input.fetching || input.fetchNextError) return false;
  return input.pagesLoaded < input.maxPages;
}
