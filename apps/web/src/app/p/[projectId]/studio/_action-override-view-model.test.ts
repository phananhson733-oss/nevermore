import { describe, expect, it } from "vitest";
import {
  adoptActionIntoPages,
  INITIAL_OVERRIDE_STATE,
  OVERRIDE_NOTE_MAX,
  OVERRIDE_REASON_MAX,
  OVERRIDE_REASON_MIN,
  initialOverrideForm,
  isOverrideFormDirty,
  overrideControlsLocked,
  overrideRetryAvailable,
  planOverrideSubmit,
  reduceOverride,
  type OverrideActionSnapshot,
  type OverrideEvent,
  type OverrideState,
} from "./_action-override-view-model";

const ACTION: OverrideActionSnapshot = {
  status: "planned",
  priorityBand: "high",
  roadmapLane: "now",
  revision: 4,
};

function form(overrides: Partial<ReturnType<typeof initialOverrideForm>> = {}) {
  return { ...initialOverrideForm(), ...overrides };
}

function reduceAll(
  events: readonly OverrideEvent[],
  from: OverrideState = INITIAL_OVERRIDE_STATE,
): OverrideState {
  return events.reduce(reduceOverride, from);
}

/** idle -> submitting with a valid plan, for conflict-branch setups. */
function submittingState(): OverrideState {
  return reduceAll([
    { type: "edit", patch: { statusSel: "blocked", reason: "why not" } },
    { type: "submit" },
  ]);
}

function conflictState(): OverrideState {
  return reduceAll(
    [{ type: "conflict", submittedRevision: 4, problem: new Error("409") }],
    submittingState(),
  );
}

// ------------------------------------------------------ submit planning ----

describe("planOverrideSubmit", () => {
  it("keeps sentinel selections out of the body (status-only change)", () => {
    const plan = planOverrideSubmit(
      ACTION,
      form({ statusSel: "blocked", reason: "why" }),
    );
    expect(plan).toEqual({
      kind: "submit",
      body: { baseRevision: 4, reason: "why", status: "blocked" },
    });
  });

  it("builds a priority-only body", () => {
    const plan = planOverrideSubmit(
      ACTION,
      form({ prioritySel: "low", reason: "why" }),
    );
    expect(plan).toEqual({
      kind: "submit",
      body: { baseRevision: 4, reason: "why", priorityBand: "low" },
    });
  });

  it("builds a lane-only body", () => {
    const plan = planOverrideSubmit(
      ACTION,
      form({ laneSel: "later", reason: "why" }),
    );
    expect(plan).toEqual({
      kind: "submit",
      body: { baseRevision: 4, reason: "why", roadmapLane: "later" },
    });
  });

  it("combines all three changed dimensions plus a trimmed note", () => {
    const plan = planOverrideSubmit(
      ACTION,
      form({
        statusSel: "in_progress",
        prioritySel: "critical",
        laneSel: "next",
        reason: "  shift focus  ",
        note: "  context for the team  ",
      }),
    );
    expect(plan).toEqual({
      kind: "submit",
      body: {
        baseRevision: 4,
        reason: "shift focus",
        status: "in_progress",
        priorityBand: "critical",
        roadmapLane: "next",
        note: "context for the team",
      },
    });
  });

  it("drops a selection equal to the current value (kept sentinel semantics)", () => {
    const plan = planOverrideSubmit(
      ACTION,
      form({ prioritySel: "high", laneSel: "now", reason: "why" }),
    );
    expect(plan).toEqual({ kind: "noChange" });
  });

  it("drops a status choice the graph does not allow from the current state", () => {
    const plan = planOverrideSubmit(
      ACTION,
      form({ statusSel: "done", reason: "why" }),
    );
    expect(plan).toEqual({ kind: "noChange" });
  });

  it("rejects an all-sentinel form as noChange even with a valid reason", () => {
    const plan = planOverrideSubmit(ACTION, form({ reason: "why" }));
    expect(plan).toEqual({ kind: "noChange" });
  });

  it.each([
    { len: OVERRIDE_REASON_MIN - 1, kind: "reasonRequired" },
    { len: OVERRIDE_REASON_MIN, kind: "submit" },
    { len: OVERRIDE_REASON_MAX, kind: "submit" },
    { len: OVERRIDE_REASON_MAX + 1, kind: "reasonTooLong" },
  ])("reason boundary: $len chars -> $kind", ({ len, kind }) => {
    const plan = planOverrideSubmit(
      ACTION,
      form({ statusSel: "blocked", reason: "r".repeat(len) }),
    );
    expect(plan.kind).toBe(kind);
  });

  it("measures the reason boundary on the trimmed value", () => {
    const padded = ` ${"r".repeat(OVERRIDE_REASON_MAX)} `;
    const plan = planOverrideSubmit(
      ACTION,
      form({ statusSel: "blocked", reason: padded }),
    );
    expect(plan.kind).toBe("submit");
  });

  it.each([
    { len: OVERRIDE_NOTE_MAX, kind: "submit" },
    { len: OVERRIDE_NOTE_MAX + 1, kind: "noteTooLong" },
  ])("note boundary: $len chars -> $kind", ({ len, kind }) => {
    const plan = planOverrideSubmit(
      ACTION,
      form({ statusSel: "blocked", reason: "why", note: "n".repeat(len) }),
    );
    expect(plan.kind).toBe(kind);
  });

  it("omits an empty note from the body", () => {
    const plan = planOverrideSubmit(
      ACTION,
      form({ statusSel: "blocked", reason: "why", note: "   " }),
    );
    expect(plan).toEqual({
      kind: "submit",
      body: { baseRevision: 4, reason: "why", status: "blocked" },
    });
  });
});

// ------------------------------------------------------------- dirtiness ---

describe("isOverrideFormDirty", () => {
  it("treats the pristine form as clean", () => {
    expect(isOverrideFormDirty(initialOverrideForm())).toBe(false);
  });

  it.each([
    { patch: { statusSel: "blocked" } },
    { patch: { prioritySel: "low" } },
    { patch: { laneSel: "later" } },
    { patch: { reason: "x" } },
    { patch: { note: "x" } },
  ])("any non-sentinel selection or text marks dirty: %j", ({ patch }) => {
    expect(isOverrideFormDirty(form(patch))).toBe(true);
  });

  it("returns a fresh pristine form per call (no shared identity)", () => {
    const a = initialOverrideForm();
    const b = initialOverrideForm();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

// ------------------------------------------------------------ the machine --

describe("reduceOverride", () => {
  it("starts idle with a pristine form and no notice", () => {
    expect(INITIAL_OVERRIDE_STATE.phase).toBe("idle");
    expect(INITIAL_OVERRIDE_STATE.form).toEqual(initialOverrideForm());
    expect(INITIAL_OVERRIDE_STATE.notice).toBeNull();
    expect(INITIAL_OVERRIDE_STATE.problem).toBeNull();
  });

  it("edit merges immutably and never mutates the previous state", () => {
    const before = INITIAL_OVERRIDE_STATE;
    const after = reduceOverride(before, {
      type: "edit",
      patch: { reason: "because" },
    });
    expect(after.form.reason).toBe("because");
    expect(before.form.reason).toBe("");
    expect(after).not.toBe(before);
  });

  it("reject surfaces a local validation notice and stays unlocked", () => {
    const state = reduceOverride(INITIAL_OVERRIDE_STATE, {
      type: "reject",
      notice: "noChange",
    });
    expect(state.phase).toBe("idle");
    expect(state.notice).toBe("noChange");
    expect(overrideControlsLocked(state)).toBe(false);
  });

  it("submit locks the machine and clears prior notices", () => {
    const state = reduceAll([
      { type: "reject", notice: "reasonRequired" },
      { type: "submit" },
    ]);
    expect(state.phase).toBe("submitting");
    expect(state.notice).toBeNull();
    expect(state.problem).toBeNull();
    expect(overrideControlsLocked(state)).toBe(true);
  });

  it("machine-level single flight: a second submit while submitting is ignored", () => {
    const locked = submittingState();
    expect(reduceOverride(locked, { type: "submit" })).toBe(locked);
  });

  it("submit is ignored while the conflict refresh is in flight or failed", () => {
    const refreshing = conflictState();
    expect(refreshing.phase).toBe("conflictRefreshing");
    expect(reduceOverride(refreshing, { type: "submit" })).toBe(refreshing);
    const failed = reduceOverride(refreshing, { type: "refreshFailed" });
    expect(reduceOverride(failed, { type: "submit" })).toBe(failed);
  });

  it("requestFailed unlocks with a requestFailed notice and keeps the form", () => {
    const problem = new Error("500");
    const state = reduceOverride(submittingState(), {
      type: "requestFailed",
      problem,
    });
    expect(state.phase).toBe("idle");
    expect(state.notice).toBe("requestFailed");
    expect(state.problem).toBe(problem);
    expect(state.form.statusSel).toBe("blocked");
    expect(state.form.reason).toBe("why not");
  });

  it("conflict enters conflictRefreshing, remembers the submitted revision, and locks", () => {
    const state = conflictState();
    expect(state.phase).toBe("conflictRefreshing");
    expect(state.conflictRevision).toBe(4);
    expect(overrideControlsLocked(state)).toBe(true);
    expect(overrideRetryAvailable(state)).toBe(false);
  });

  // -------- D5 refresh resolution branches --------

  it("staleConflict: new revision adopted, reason kept, illegal status cleared", () => {
    const state = reduceAll(
      [
        {
          type: "refreshResolved",
          refreshed: {
            // Refreshed current is blocked: "blocked" is no longer a legal
            // target from itself, so the selection must clear.
            status: "blocked",
            priorityBand: "high",
            roadmapLane: "now",
            revision: 5,
          },
        },
      ],
      conflictState(),
    );
    expect(state.phase).toBe("staleConflict");
    expect(state.notice).toBe("conflictStale");
    expect(state.form.statusSel).toBe("");
    expect(state.form.reason).toBe("why not");
    expect(overrideControlsLocked(state)).toBe(false);
  });

  it("staleConflict keeps a status choice that is still legal for the new current", () => {
    const state = reduceAll(
      [
        {
          type: "refreshResolved",
          refreshed: {
            // planned -> blocked is still allowed, so the choice survives.
            status: "planned",
            priorityBand: "low",
            roadmapLane: "later",
            revision: 6,
          },
        },
      ],
      conflictState(),
    );
    expect(state.phase).toBe("staleConflict");
    expect(state.form.statusSel).toBe("blocked");
  });

  it("staleConflict clears priority/lane choices that now equal the current value", () => {
    const start = reduceAll([
      {
        type: "edit",
        patch: { prioritySel: "low", laneSel: "later", reason: "why not" },
      },
      { type: "submit" },
      { type: "conflict", submittedRevision: 4, problem: new Error("409") },
    ]);
    const state = reduceOverride(start, {
      type: "refreshResolved",
      refreshed: {
        status: "planned",
        priorityBand: "low",
        roadmapLane: "later",
        revision: 9,
      },
    });
    expect(state.phase).toBe("staleConflict");
    expect(state.form.prioritySel).toBe("");
    expect(state.form.laneSel).toBe("");
    expect(state.form.reason).toBe("why not");
  });

  it("transitionConflict: same revision clears the status choice and re-arms", () => {
    const state = reduceOverride(conflictState(), {
      type: "refreshResolved",
      refreshed: { ...ACTION, revision: 4 },
    });
    expect(state.phase).toBe("transitionConflict");
    expect(state.notice).toBe("conflictTransition");
    expect(state.form.statusSel).toBe("");
    expect(state.form.reason).toBe("why not");
    expect(overrideControlsLocked(state)).toBe(false);
  });

  it("a vanished action resolves to conflictRefreshError, not a silent unlock", () => {
    const state = reduceOverride(conflictState(), {
      type: "refreshResolved",
      refreshed: undefined,
    });
    expect(state.phase).toBe("conflictRefreshError");
    expect(state.notice).toBe("conflictRefreshFailed");
    expect(overrideControlsLocked(state)).toBe(true);
    expect(overrideRetryAvailable(state)).toBe(true);
  });

  it("refreshFailed locks with retry as the only exit", () => {
    const state = reduceOverride(conflictState(), { type: "refreshFailed" });
    expect(state.phase).toBe("conflictRefreshError");
    expect(state.notice).toBe("conflictRefreshFailed");
    expect(overrideRetryAvailable(state)).toBe(true);
  });

  it("retryRefresh re-enters conflictRefreshing keeping the remembered revision", () => {
    const failed = reduceOverride(conflictState(), { type: "refreshFailed" });
    const retried = reduceOverride(failed, { type: "retryRefresh" });
    expect(retried.phase).toBe("conflictRefreshing");
    expect(retried.conflictRevision).toBe(4);
    const recovered = reduceOverride(retried, {
      type: "refreshResolved",
      refreshed: { ...ACTION, status: "planned", revision: 7 },
    });
    expect(recovered.phase).toBe("staleConflict");
  });

  it("retryRefresh outside conflictRefreshError is ignored", () => {
    expect(
      reduceOverride(INITIAL_OVERRIDE_STATE, { type: "retryRefresh" }),
    ).toBe(INITIAL_OVERRIDE_STATE);
  });

  it("refresh events outside conflictRefreshing are ignored", () => {
    expect(
      reduceOverride(INITIAL_OVERRIDE_STATE, {
        type: "refreshResolved",
        refreshed: { ...ACTION, revision: 9 },
      }),
    ).toBe(INITIAL_OVERRIDE_STATE);
    expect(
      reduceOverride(INITIAL_OVERRIDE_STATE, { type: "refreshFailed" }),
    ).toBe(INITIAL_OVERRIDE_STATE);
  });

  it("a resubmission after staleConflict locks again (no permanent 409 loop)", () => {
    const stale = reduceOverride(conflictState(), {
      type: "refreshResolved",
      refreshed: { ...ACTION, status: "planned", revision: 5 },
    });
    const resubmitted = reduceOverride(stale, { type: "submit" });
    expect(resubmitted.phase).toBe("submitting");
    expect(resubmitted.notice).toBeNull();
  });
});

// ------------------------------------------------- success cache adoption --

describe("adoptActionIntoPages", () => {
  const item = (id: string, revision: number) => ({ id, revision });
  const cache = {
    pages: [
      { data: [item("a", 1), item("b", 1)], meta: { nextCursor: "p1" } },
      { data: [item("c", 3)], meta: { nextCursor: null } },
    ],
    pageParams: [null, "p1"],
  };

  it("replaces a staler cached row immutably and keeps untouched pages by reference", () => {
    const updated = item("b", 2);
    const next = adoptActionIntoPages(cache, updated);
    expect(next).not.toBe(cache);
    expect(next?.pages[0]?.data[1]).toBe(updated);
    expect(next?.pages[0]?.data[0]).toBe(cache.pages[0]!.data[0]);
    expect(next?.pages[1]).toBe(cache.pages[1]);
    // The original cache was never mutated.
    expect(cache.pages[0]!.data[1]).toEqual(item("b", 1));
  });

  it("is a reference no-op when the cache already holds an equal or newer revision", () => {
    expect(adoptActionIntoPages(cache, item("c", 3))).toBe(cache);
    expect(adoptActionIntoPages(cache, item("c", 2))).toBe(cache);
  });

  it("is a reference no-op for an id outside the loaded window", () => {
    expect(adoptActionIntoPages(cache, item("zz", 9))).toBe(cache);
  });

  it("passes undefined through so setQueryData leaves an empty cache alone", () => {
    expect(adoptActionIntoPages(undefined, item("a", 2))).toBeUndefined();
  });
});
