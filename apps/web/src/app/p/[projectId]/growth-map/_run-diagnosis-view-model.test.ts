import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import {
  INITIAL_RUN_DIAGNOSIS_STATE,
  parseDiagnosticRunPointer,
  reduceRunDiagnosis,
  refreshAfterDiagnosticTerminal,
  runDiagnosisButtonLabelKey,
  runDiagnosisEventFromError,
  runDiagnosisLocked,
  runDiagnosisStatusPill,
  shouldRefreshAfterTerminal,
  showRunStatusReadError,
  type RunDiagnosisState,
} from "./_run-diagnosis-view-model.ts";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RUN_ID = "22222222-2222-4222-8222-222222222222";

function apiError(
  code: string,
  current?: Readonly<Record<string, unknown>> | null,
): ApiError {
  return new ApiError({
    type: "about:blank",
    title: "Conflict",
    status: 409,
    code,
    detail: "Problem detail.",
    requestId: "request-1",
    ...(current === undefined ? {} : { current }),
  });
}

function tracking(overrides: Partial<RunDiagnosisState> = {}): RunDiagnosisState {
  return {
    ...reduceRunDiagnosis(
      reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, { type: "submit" }),
      { type: "accepted", runId: RUN_ID },
    ),
    ...overrides,
  };
}

describe("reduceRunDiagnosis submit fence", () => {
  it("moves idle to submitting and clears the previous terminal pill", () => {
    const withPill = reduceRunDiagnosis(tracking(), {
      type: "runTerminal",
      runId: RUN_ID,
      status: "completed",
    });
    expect(withPill.terminal).toEqual({ runId: RUN_ID, status: "completed" });
    const next = reduceRunDiagnosis(withPill, { type: "submit" });
    expect(next.phase).toBe("submitting");
    expect(next.terminal).toBeNull();
    expect(next.submitNotice).toBeNull();
    expect(next.runActiveNotice).toBe(false);
  });

  it("refuses submit from submitting, tracking, and conflictUnknown", () => {
    const submitting = reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, {
      type: "submit",
    });
    expect(reduceRunDiagnosis(submitting, { type: "submit" })).toBe(submitting);
    const tracked = tracking();
    expect(reduceRunDiagnosis(tracked, { type: "submit" })).toBe(tracked);
    const unknown = reduceRunDiagnosis(submitting, {
      type: "conflict",
      pointer: null,
    });
    expect(reduceRunDiagnosis(unknown, { type: "submit" })).toBe(unknown);
  });

  it("refuses submit while the sticky context gate is set", () => {
    const gated = reduceRunDiagnosis(
      reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, { type: "submit" }),
      { type: "serverGate", gate: "context" },
    );
    expect(gated.phase).toBe("idle");
    expect(gated.contextGate).toBe(true);
    expect(reduceRunDiagnosis(gated, { type: "submit" })).toBe(gated);
  });
});

describe("reduceRunDiagnosis submission outcomes", () => {
  it("tracks an accepted run", () => {
    const state = tracking();
    expect(state.phase).toBe("tracking");
    expect(state.trackedRunId).toBe(RUN_ID);
    expect(state.runActiveNotice).toBe(false);
  });

  it("takes over a valid 409 pointer with the runActive notice", () => {
    const submitting = reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, {
      type: "submit",
    });
    const state = reduceRunDiagnosis(submitting, {
      type: "conflict",
      pointer: { runId: OTHER_RUN_ID },
    });
    expect(state.phase).toBe("tracking");
    expect(state.trackedRunId).toBe(OTHER_RUN_ID);
    expect(state.runActiveNotice).toBe(true);
  });

  it("moves to conflictUnknown when the 409 carries no usable pointer", () => {
    const submitting = reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, {
      type: "submit",
    });
    const state = reduceRunDiagnosis(submitting, {
      type: "conflict",
      pointer: null,
    });
    expect(state.phase).toBe("conflictUnknown");
    expect(state.runActiveNotice).toBe(true);
    expect(state.trackedRunId).toBeNull();
  });

  it("maps the crawl server gate to the needsCrawl notice and unlocks", () => {
    const submitting = reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, {
      type: "submit",
    });
    const state = reduceRunDiagnosis(submitting, {
      type: "serverGate",
      gate: "crawl",
    });
    expect(state.phase).toBe("idle");
    expect(state.submitNotice).toBe("needsCrawl");
    expect(state.contextGate).toBe(false);
  });

  it("maps an unmapped submit failure to the generic notice and unlocks", () => {
    const submitting = reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, {
      type: "submit",
    });
    const state = reduceRunDiagnosis(submitting, { type: "submitFailed" });
    expect(state.phase).toBe("idle");
    expect(state.submitNotice).toBe("genericError");
  });
});

describe("reduceRunDiagnosis terminal handling", () => {
  it.each(["completed", "partial", "failed", "cancelled"] as const)(
    "unlocks on %s, keeps the pill, and flips the session label",
    (status) => {
      const state = reduceRunDiagnosis(tracking(), {
        type: "runTerminal",
        runId: RUN_ID,
        status,
      });
      expect(state.phase).toBe("idle");
      expect(state.terminal).toEqual({ runId: RUN_ID, status });
      expect(state.trackedRunId).toBe(RUN_ID);
      expect(state.sessionHasTerminal).toBe(true);
      expect(runDiagnosisLocked(state)).toBe(false);
    },
  );

  it.each(["completed", "partial"] as const)(
    "records a single %s invalidation per runId",
    (status) => {
      const before = tracking();
      expect(shouldRefreshAfterTerminal(before, RUN_ID, status)).toBe(true);
      const after = reduceRunDiagnosis(before, {
        type: "runTerminal",
        runId: RUN_ID,
        status,
      });
      expect(after.invalidatedRunIds).toEqual([RUN_ID]);
      expect(shouldRefreshAfterTerminal(after, RUN_ID, status)).toBe(false);
      const again = reduceRunDiagnosis(after, {
        type: "runTerminal",
        runId: RUN_ID,
        status,
      });
      expect(again.invalidatedRunIds).toEqual([RUN_ID]);
    },
  );

  it("never refreshes twice for a runId re-adopted after its refresh", () => {
    // A 409 takeover can re-track a run that already completed and refreshed
    // in this session. The invalidation ledger, not the phase, must stop the
    // second refresh while the machine is genuinely tracking again.
    const refreshed = reduceRunDiagnosis(tracking(), {
      type: "runTerminal",
      runId: RUN_ID,
      status: "completed",
    });
    const readopted = reduceRunDiagnosis(
      reduceRunDiagnosis(refreshed, { type: "submit" }),
      { type: "conflict", pointer: { runId: RUN_ID } },
    );
    expect(readopted.phase).toBe("tracking");
    expect(readopted.trackedRunId).toBe(RUN_ID);
    expect(shouldRefreshAfterTerminal(readopted, RUN_ID, "completed")).toBe(
      false,
    );
  });

  it.each(["failed", "cancelled"] as const)(
    "never refreshes on %s",
    (status) => {
      const before = tracking();
      expect(shouldRefreshAfterTerminal(before, RUN_ID, status)).toBe(false);
      const after = reduceRunDiagnosis(before, {
        type: "runTerminal",
        runId: RUN_ID,
        status,
      });
      expect(after.invalidatedRunIds).toEqual([]);
    },
  );

  it("ignores a terminal report for a run it is not tracking", () => {
    const state = tracking();
    expect(
      reduceRunDiagnosis(state, {
        type: "runTerminal",
        runId: OTHER_RUN_ID,
        status: "completed",
      }),
    ).toBe(state);
    expect(shouldRefreshAfterTerminal(state, OTHER_RUN_ID, "completed")).toBe(
      false,
    );
  });

  it("ignores a non-terminal status report", () => {
    const state = tracking();
    expect(
      reduceRunDiagnosis(state, {
        type: "runTerminal",
        runId: RUN_ID,
        status: "running",
      }),
    ).toBe(state);
  });

  it("clears the 409 takeover notice once the adopted run is terminal", () => {
    const submitting = reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, {
      type: "submit",
    });
    const adopted = reduceRunDiagnosis(submitting, {
      type: "conflict",
      pointer: { runId: OTHER_RUN_ID },
    });
    const done = reduceRunDiagnosis(adopted, {
      type: "runTerminal",
      runId: OTHER_RUN_ID,
      status: "completed",
    });
    expect(done.runActiveNotice).toBe(false);
    expect(done.terminal).toEqual({ runId: OTHER_RUN_ID, status: "completed" });
  });
});

describe("reduceRunDiagnosis explicit recoveries", () => {
  it("releases the sticky context gate only through recheckContext", () => {
    const gated = reduceRunDiagnosis(
      reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, { type: "submit" }),
      { type: "serverGate", gate: "context" },
    );
    const released = reduceRunDiagnosis(gated, { type: "recheckContext" });
    expect(released.contextGate).toBe(false);
    expect(released.phase).toBe("idle");
  });

  it("returns to idle from conflictUnknown only through conflictRecovery", () => {
    const unknown = reduceRunDiagnosis(
      reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, { type: "submit" }),
      { type: "conflict", pointer: null },
    );
    expect(runDiagnosisLocked(unknown)).toBe(true);
    const recovered = reduceRunDiagnosis(unknown, { type: "conflictRecovery" });
    expect(recovered.phase).toBe("idle");
    expect(recovered.runActiveNotice).toBe(false);
    expect(runDiagnosisLocked(recovered)).toBe(false);
  });
});

describe("view selectors", () => {
  it("locks every non-idle phase, including tracking under a poll read error", () => {
    expect(runDiagnosisLocked(INITIAL_RUN_DIAGNOSIS_STATE)).toBe(false);
    expect(
      runDiagnosisLocked(
        reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, { type: "submit" }),
      ),
    ).toBe(true);
    const polled = tracking();
    expect(runDiagnosisLocked(polled)).toBe(true);
    expect(showRunStatusReadError(polled, true)).toBe(true);
    expect(showRunStatusReadError(polled, false)).toBe(false);
    expect(showRunStatusReadError(INITIAL_RUN_DIAGNOSIS_STATE, true)).toBe(
      false,
    );
  });

  it("labels the button by session terminal history and in-flight state", () => {
    expect(runDiagnosisButtonLabelKey(INITIAL_RUN_DIAGNOSIS_STATE)).toBe(
      "runDiagnosis",
    );
    expect(
      runDiagnosisButtonLabelKey(
        reduceRunDiagnosis(INITIAL_RUN_DIAGNOSIS_STATE, { type: "submit" }),
      ),
    ).toBe("runInProgress");
    expect(runDiagnosisButtonLabelKey(tracking())).toBe("runInProgress");
    const done = reduceRunDiagnosis(tracking(), {
      type: "runTerminal",
      runId: RUN_ID,
      status: "failed",
    });
    expect(runDiagnosisButtonLabelKey(done)).toBe("rerunDiagnosis");
  });

  it("sources the status pill from the poll while tracking and the terminal after", () => {
    expect(runDiagnosisStatusPill(INITIAL_RUN_DIAGNOSIS_STATE, undefined)).toBe(
      null,
    );
    expect(runDiagnosisStatusPill(tracking(), undefined)).toBe("queued");
    expect(runDiagnosisStatusPill(tracking(), "running")).toBe("running");
    const done = reduceRunDiagnosis(tracking(), {
      type: "runTerminal",
      runId: RUN_ID,
      status: "partial",
    });
    expect(runDiagnosisStatusPill(done, undefined)).toBe("partial");
  });
});

describe("parseDiagnosticRunPointer", () => {
  it("accepts a UUID runId", () => {
    expect(parseDiagnosticRunPointer({ runId: RUN_ID })).toEqual({
      runId: RUN_ID,
    });
    expect(
      parseDiagnosticRunPointer({ runId: RUN_ID, statusUrl: "/anything" }),
    ).toEqual({ runId: RUN_ID });
  });

  it("rejects missing, null, and malformed pointers", () => {
    expect(parseDiagnosticRunPointer(undefined)).toBeNull();
    expect(parseDiagnosticRunPointer(null)).toBeNull();
    expect(parseDiagnosticRunPointer({})).toBeNull();
    expect(parseDiagnosticRunPointer({ runId: null })).toBeNull();
    expect(parseDiagnosticRunPointer({ runId: "" })).toBeNull();
    expect(parseDiagnosticRunPointer({ runId: "not-a-uuid" })).toBeNull();
    expect(parseDiagnosticRunPointer({ runId: 7 })).toBeNull();
  });
});

describe("runDiagnosisEventFromError", () => {
  it("maps RUN_ALREADY_ACTIVE with a valid pointer to a conflict takeover", () => {
    expect(
      runDiagnosisEventFromError(
        apiError("RUN_ALREADY_ACTIVE", { runId: RUN_ID, statusUrl: "/x" }),
      ),
    ).toEqual({ type: "conflict", pointer: { runId: RUN_ID } });
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["invalid", { runId: "diagnostic" }],
  ] as const)(
    "maps RUN_ALREADY_ACTIVE with a %s pointer to conflictUnknown",
    (_label, current) => {
      expect(runDiagnosisEventFromError(apiError("RUN_ALREADY_ACTIVE", current)))
        .toEqual({ type: "conflict", pointer: null });
    },
  );

  it("maps the server hard gates and everything else", () => {
    expect(runDiagnosisEventFromError(apiError("CONTEXT_INCOMPLETE"))).toEqual({
      type: "serverGate",
      gate: "context",
    });
    expect(
      runDiagnosisEventFromError(apiError("CRAWL_SNAPSHOT_REQUIRED")),
    ).toEqual({ type: "serverGate", gate: "crawl" });
    expect(runDiagnosisEventFromError(apiError("RATE_LIMITED"))).toEqual({
      type: "submitFailed",
    });
    expect(runDiagnosisEventFromError(new Error("network"))).toEqual({
      type: "submitFailed",
    });
  });
});

describe("refreshAfterDiagnosticTerminal", () => {
  it("prefix-invalidates every read model the run terminal changes", async () => {
    const invalidateQueries = vi.fn(async () => undefined);
    const queryClient = { invalidateQueries } as unknown as Parameters<
      typeof refreshAfterDiagnosticTerminal
    >[0];
    await refreshAfterDiagnosticTerminal(queryClient, "project-1");
    const keys = invalidateQueries.mock.calls
      .map((call) => (call as unknown[])[0])
      .map((options) => (options as { queryKey: readonly string[] }).queryKey);
    expect(keys).toEqual([
      ["growth-map", "project-1"],
      ["findings", "project-1"],
      ["snapshots", "project-1"],
      ["workspace", "project-1"],
      ["project", "project-1"],
    ]);
    for (const call of invalidateQueries.mock.calls) {
      expect((call as unknown[])[0]).toMatchObject({ refetchType: "active" });
    }
  });
});
