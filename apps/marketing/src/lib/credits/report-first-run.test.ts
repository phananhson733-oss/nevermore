// @input  -- a qualifying tool slug and injected scheduler/identity/store fakes
// @output -- assertions that the reporter never throws and never blocks a response
// @pos    -- guards the one side effect the tool handlers gained

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reportFirstToolRun,
  type FirstRunReporterDependencies,
} from "./report-first-run.ts";

const USER = "11111111-1111-4111-8111-111111111111";

/** Runs the scheduled task inline so a test can await what production defers. */
function collectTask(): {
  readonly schedule: FirstRunReporterDependencies["schedule"];
  readonly run: () => Promise<void>;
} {
  const tasks: Array<() => Promise<void>> = [];
  return {
    schedule: (task) => {
      tasks.push(task);
    },
    run: async () => {
      for (const task of tasks) await task();
    },
  };
}

function deps(
  overrides: Partial<FirstRunReporterDependencies> = {},
): FirstRunReporterDependencies {
  return {
    schedule: (task) => {
      void task();
    },
    readUser: vi.fn(async () => ({
      status: "authenticated" as const,
      userId: USER,
    })),
    reward: vi.fn(async () => ({
      kind: "ok" as const,
      value: { rewarded: true, reason: "rewarded_both" },
    })),
    enabled: () => true,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportFirstToolRun", () => {
  it("returns synchronously, so the caller never awaits it", () => {
    const { schedule } = collectTask();
    expect(reportFirstToolRun("agent-audit", deps({ schedule }))).toBeUndefined();
  });

  it("claims the referral for the signed-in visitor", async () => {
    const collected = collectTask();
    const reward = vi.fn(async () => ({
      kind: "ok" as const,
      value: { rewarded: true, reason: "rewarded_both" },
    }));

    reportFirstToolRun(
      "agent-audit",
      deps({ schedule: collected.schedule, reward }),
    );
    await collected.run();

    expect(reward).toHaveBeenCalledWith(USER, "agent-audit");
  });

  it("does nothing when the flag is off, without even asking who is calling", async () => {
    const collected = collectTask();
    const readUser = vi.fn();
    reportFirstToolRun(
      "agent-audit",
      deps({ schedule: collected.schedule, readUser, enabled: () => false }),
    );
    await collected.run();
    expect(readUser).not.toHaveBeenCalled();
  });

  it.each(["unauthenticated", "unavailable"] as const)(
    "claims nothing when identity is %s",
    async (status) => {
      const collected = collectTask();
      const reward = vi.fn();
      reportFirstToolRun(
        "profile-refresh",
        deps({
          schedule: collected.schedule,
          readUser: async () => ({ status }),
          reward,
        }),
      );
      await collected.run();
      expect(reward).not.toHaveBeenCalled();
    },
  );

  /**
   * agents/audit-handler.ts returns its success outside any try/catch, so a
   * throw here becomes a 500 on a run that already produced its evidence. A
   * credit is worth strictly less than the work the visitor waited for.
   */
  it("swallows a scheduler that throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      reportFirstToolRun(
        "agent-audit",
        deps({
          schedule: () => {
            throw new Error("after() outside a request scope");
          },
        }),
      ),
    ).not.toThrow();
    expect(error).toHaveBeenCalled();
  });

  it("swallows a rejecting store and says so in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const collected = collectTask();

    reportFirstToolRun(
      "profile-refresh",
      deps({
        schedule: collected.schedule,
        reward: async () => {
          throw new Error("connection reset");
        },
      }),
    );
    await expect(collected.run()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "[credits] first-run report failed:",
      expect.any(Error),
    );
  });

  it("swallows an identity probe that throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const collected = collectTask();
    reportFirstToolRun(
      "agent-audit",
      deps({
        schedule: collected.schedule,
        readUser: async () => {
          throw new Error("auth unreachable");
        },
      }),
    );
    await expect(collected.run()).resolves.toBeUndefined();
  });
});
