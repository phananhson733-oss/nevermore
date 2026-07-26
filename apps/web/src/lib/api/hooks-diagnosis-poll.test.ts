import { describe, expect, it } from "vitest";
import {
  isRunTerminal,
  runPollInterval,
  type AsyncRun,
  type RunPollState,
  type RunStatus,
} from "./hooks-diagnosis";

function run(status: RunStatus): AsyncRun {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    kind: "diagnostic",
    status,
    progress: { phase: "rules", current: 1, total: 11, messageKey: "run.rules" },
    lastError: null,
    resultRef: null,
    queuedAt: "2026-07-20T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

function state(overrides: Partial<RunPollState> = {}): RunPollState {
  return {
    status: "success",
    data: run("running"),
    dataUpdateCount: 1,
    ...overrides,
  };
}

/**
 * The run poller decides one thing — "ask again, and when?" — and every wrong
 * answer it can give is a live defect rather than a style note: stopping early
 * leaves a running diagnosis frozen on screen, and never stopping is an
 * unbounded 1s loop against an endpoint that is already refusing us.
 */
describe("run poll cadence", () => {
  /**
   * The escalation is a product promise (spec §9.1), not an implementation
   * detail: it is what keeps a long crawl from hammering the API while still
   * showing a short run's result quickly. `dataUpdateCount` is 1 after the
   * FIRST successful poll, so the first wait is the schedule's first step.
   */
  it("escalates 1s -> 2s -> 4s -> 5s and then holds", () => {
    const waits = [0, 1, 2, 3, 4, 9, 40].map((dataUpdateCount) =>
      runPollInterval(state({ dataUpdateCount })),
    );

    expect(waits).toStrictEqual([1000, 1000, 2000, 4000, 5000, 5000, 5000]);
  });

  /**
   * The loop this closes was real: with the status query itself failing,
   * `dataUpdateCount` never leaves 0, so the schedule would hold at its
   * SHORTEST interval and retry a 401/404/5xx once a second forever.
   */
  it("stops polling when the status query itself is failing", () => {
    expect(
      runPollInterval(state({ status: "error", dataUpdateCount: 0 })),
    ).toBe(false);
    expect(runPollInterval(state({ status: "error", data: undefined }))).toBe(
      false,
    );
  });

  /**
   * The terminal set is the one migration `0002_async_run_terminal_invariant`
   * makes irreversible in the database: once a run reaches one of those, no
   * further status can ever be written, so another poll can only return the
   * same row. The two non-terminal statuses are the whole reason to keep
   * asking.
   */
  it("stops on every status the database will never let change again", () => {
    for (const status of [
      "completed",
      "partial",
      "failed",
      "cancelled",
    ] as const) {
      expect(isRunTerminal(status), status).toBe(true);
      expect(runPollInterval(state({ data: run(status) })), status).toBe(false);
    }
    for (const status of ["queued", "running"] as const) {
      expect(isRunTerminal(status), status).toBe(false);
      expect(
        runPollInterval(state({ data: run(status) })),
        status,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * Before the first response there is no run to judge, so the REPEAT is off
   * and the initial fetch — which `refetchInterval` does not govern — is what
   * loads it. The schedule starts on the poll after that, which is why every
   * expectation above is indexed on `dataUpdateCount` rather than on wall time.
   */
  it("schedules no repeat until a run has actually been read", () => {
    expect(
      runPollInterval(
        state({ status: "pending", data: undefined, dataUpdateCount: 0 }),
      ),
    ).toBe(false);
    expect(runPollInterval(state({ dataUpdateCount: 1 }))).toBe(1000);
  });
});
