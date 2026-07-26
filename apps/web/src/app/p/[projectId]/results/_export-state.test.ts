import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import type { ProblemBody } from "@/lib/api/types";
import {
  INITIAL_EXPORT_RAIL_STATE,
  exportCreateLocked,
  exportRailEventFromError,
  parseExportPointer,
  reduceExportRail,
  type ExportRailState,
} from "./_export-state.ts";

const RUN_ID = "00000000-0000-4000-8000-000000000901";
const EXPORT_ID = "00000000-0000-4000-8000-000000000902";
const OTHER_EXPORT_ID = "00000000-0000-4000-8000-000000000903";

function conflictError(
  current: Readonly<Record<string, unknown>> | undefined,
): ApiError {
  const problem: ProblemBody = {
    type: "about:blank",
    title: "Conflict",
    status: 409,
    code: "RUN_ALREADY_ACTIVE",
    detail: "An export of this kind is already running.",
    requestId: "test-request",
    ...(current !== undefined ? { current } : {}),
  };
  return new ApiError(problem);
}

function state(overrides: Partial<ExportRailState> = {}): ExportRailState {
  return { ...INITIAL_EXPORT_RAIL_STATE, ...overrides };
}

function tracking(overrides: Partial<ExportRailState> = {}): ExportRailState {
  return state({
    phase: "tracking",
    active: { exportId: EXPORT_ID, kind: "service_bundle" },
    requestedKind: "service_bundle",
    ...overrides,
  });
}

/**
 * The closed export-rail machine (R3 blueprint D5). Every wrong transition it
 * can make is a live defect: clearing a tracked export mid-poll loses the
 * exportId forever (the old ExportSection.start() bug), a silent 202 without a
 * resourceRef leaves a blank rail, and an unvalidated 409 pointer would be
 * polled as if it were real.
 */
describe("reduceExportRail", () => {
  it("submits only from a settled phase and records the requested kind", () => {
    const next = reduceExportRail(state(), {
      type: "submit",
      kind: "client_bundle",
    });
    expect(next).toMatchObject({
      phase: "creating",
      active: null,
      requestedKind: "client_bundle",
    });
  });

  it("fences a submit while creating (single flight)", () => {
    const creating = reduceExportRail(state(), {
      type: "submit",
      kind: "service_bundle",
    });
    expect(
      reduceExportRail(creating, { type: "submit", kind: "client_bundle" }),
    ).toBe(creating);
  });

  it("never clears a live tracked export with a new click", () => {
    const live = tracking();
    expect(
      reduceExportRail(live, { type: "submit", kind: "client_bundle" }),
    ).toBe(live);
  });

  it("tracks the accepted export id", () => {
    const creating = reduceExportRail(state(), {
      type: "submit",
      kind: "service_bundle",
    });
    expect(
      reduceExportRail(creating, { type: "accepted", exportId: EXPORT_ID }),
    ).toMatchObject({
      phase: "tracking",
      active: { exportId: EXPORT_ID, kind: "service_bundle" },
    });
  });

  it("turns a 202 without a trackable id into a visible protocol error", () => {
    const creating = reduceExportRail(state(), {
      type: "submit",
      kind: "service_bundle",
    });
    expect(
      reduceExportRail(creating, { type: "acceptedInvalid" }),
    ).toMatchObject({ phase: "protocolError", active: null });
  });

  it("adopts a valid 409 pointer and tracks the existing export", () => {
    const creating = reduceExportRail(state(), {
      type: "submit",
      kind: "service_bundle",
    });
    const adopted = reduceExportRail(creating, {
      type: "conflict",
      pointer: { runId: RUN_ID, exportId: OTHER_EXPORT_ID, kind: "client_bundle" },
    });
    expect(adopted).toMatchObject({
      phase: "tracking",
      active: { exportId: OTHER_EXPORT_ID, kind: "client_bundle" },
      adopted: true,
    });
  });

  it("falls back to the requested kind when the pointer names no kind", () => {
    const creating = reduceExportRail(state(), {
      type: "submit",
      kind: "service_bundle",
    });
    const adopted = reduceExportRail(creating, {
      type: "conflict",
      pointer: { runId: RUN_ID, exportId: OTHER_EXPORT_ID, kind: null },
    });
    expect(adopted).toMatchObject({
      active: { exportId: OTHER_EXPORT_ID, kind: "service_bundle" },
    });
  });

  it("surfaces a pointerless 409 as conflictUnknown instead of pretending to track", () => {
    const creating = reduceExportRail(state(), {
      type: "submit",
      kind: "service_bundle",
    });
    const unknown = reduceExportRail(creating, {
      type: "conflict",
      pointer: null,
    });
    expect(unknown).toMatchObject({ phase: "conflictUnknown", active: null });
    // The explicit retry is a fresh submit from this phase.
    expect(
      reduceExportRail(unknown, { type: "submit", kind: "service_bundle" }),
    ).toMatchObject({ phase: "creating" });
  });

  it("keeps a create failure retryable", () => {
    const creating = reduceExportRail(state(), {
      type: "submit",
      kind: "service_bundle",
    });
    const failed = reduceExportRail(creating, { type: "createFailed" });
    expect(failed).toMatchObject({ phase: "createFailed" });
    expect(
      reduceExportRail(failed, { type: "submit", kind: "service_bundle" }),
    ).toMatchObject({ phase: "creating" });
  });

  it("settles to idle on the tracked export's terminal poll and keeps the pointer", () => {
    for (const status of ["completed", "partial", "failed", "cancelled"] as const) {
      const settled = reduceExportRail(tracking(), {
        type: "exportTerminal",
        exportId: EXPORT_ID,
        status,
      });
      expect(settled, status).toMatchObject({
        phase: "idle",
        active: { exportId: EXPORT_ID, kind: "service_bundle" },
      });
    }
  });

  it("ignores terminal reports for a non-tracked export or a live status", () => {
    const live = tracking();
    expect(
      reduceExportRail(live, {
        type: "exportTerminal",
        exportId: OTHER_EXPORT_ID,
        status: "completed",
      }),
    ).toBe(live);
    expect(
      reduceExportRail(live, {
        type: "exportTerminal",
        exportId: EXPORT_ID,
        status: "running",
      }),
    ).toBe(live);
  });

  it("allows a fresh submit after terminal and only then clears the old pointer", () => {
    const settled = reduceExportRail(tracking(), {
      type: "exportTerminal",
      exportId: EXPORT_ID,
      status: "completed",
    });
    const resubmitted = reduceExportRail(settled, {
      type: "submit",
      kind: "client_bundle",
    });
    expect(resubmitted).toMatchObject({
      phase: "creating",
      active: null,
      requestedKind: "client_bundle",
    });
  });
});

describe("exportCreateLocked", () => {
  it("locks both create buttons while creating or tracking, and only then", () => {
    expect(exportCreateLocked(state())).toBe(false);
    expect(exportCreateLocked(state({ phase: "creating" }))).toBe(true);
    expect(exportCreateLocked(tracking())).toBe(true);
    expect(exportCreateLocked(state({ phase: "conflictUnknown" }))).toBe(false);
    expect(exportCreateLocked(state({ phase: "protocolError" }))).toBe(false);
    expect(exportCreateLocked(state({ phase: "createFailed" }))).toBe(false);
  });
});

describe("parseExportPointer", () => {
  it("accepts only well-formed UUID pointers", () => {
    expect(
      parseExportPointer({ runId: RUN_ID, exportId: EXPORT_ID }),
    ).toEqual({ runId: RUN_ID, exportId: EXPORT_ID, kind: null });
    expect(
      parseExportPointer({
        runId: RUN_ID,
        exportId: EXPORT_ID,
        kind: "client_bundle",
      }),
    ).toEqual({ runId: RUN_ID, exportId: EXPORT_ID, kind: "client_bundle" });
  });

  it("rejects missing, non-UUID, and non-object pointers", () => {
    expect(parseExportPointer(undefined)).toBeNull();
    expect(parseExportPointer(null)).toBeNull();
    expect(parseExportPointer({})).toBeNull();
    expect(parseExportPointer({ runId: RUN_ID })).toBeNull();
    expect(
      parseExportPointer({ runId: "not-a-uuid", exportId: EXPORT_ID }),
    ).toBeNull();
    expect(
      parseExportPointer({ runId: RUN_ID, exportId: "export-bundle" }),
    ).toBeNull();
  });

  it("treats an unknown kind as no kind rather than trusting it", () => {
    expect(
      parseExportPointer({
        runId: RUN_ID,
        exportId: EXPORT_ID,
        kind: "zip_of_everything",
      }),
    ).toEqual({ runId: RUN_ID, exportId: EXPORT_ID, kind: null });
  });
});

describe("exportRailEventFromError", () => {
  it("maps a 409 with a valid current pointer onto conflict-with-pointer", () => {
    const event = exportRailEventFromError(
      conflictError({ runId: RUN_ID, exportId: EXPORT_ID, kind: "client_bundle" }),
    );
    expect(event).toEqual({
      type: "conflict",
      pointer: { runId: RUN_ID, exportId: EXPORT_ID, kind: "client_bundle" },
    });
  });

  it("maps a 409 without a usable pointer onto conflictUnknown", () => {
    expect(exportRailEventFromError(conflictError(undefined))).toEqual({
      type: "conflict",
      pointer: null,
    });
    expect(
      exportRailEventFromError(conflictError({ runId: "not-a-uuid" })),
    ).toEqual({ type: "conflict", pointer: null });
  });

  it("maps every other failure onto createFailed", () => {
    const dependency = new ApiError({
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
      code: "DEPENDENCY_UNAVAILABLE",
      detail: "raw provider detail",
      requestId: "test-request",
    });
    expect(exportRailEventFromError(dependency)).toEqual({
      type: "createFailed",
    });
    expect(exportRailEventFromError(new Error("offline"))).toEqual({
      type: "createFailed",
    });
  });
});
