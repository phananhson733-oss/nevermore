import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "./context.ts";

const mocks = vi.hoisted(() => ({
  startRecovery: vi.fn(),
  startOrphanCleanup: vi.fn(),
}));

vi.mock("./handlers/recovery.ts", () => ({
  startRunRecoveryLoop: mocks.startRecovery,
}));
vi.mock("./handlers/orphan-cleanup.ts", () => ({
  startOrphanCleanupLoop: mocks.startOrphanCleanup,
}));

import { startWorkerMaintenance } from "./maintenance.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startWorkerMaintenance", () => {
  it("starts orphan cleanup exactly once without making readiness await its immediate sweep", async () => {
    const recoveryRunNow = vi.fn(async () => undefined);
    const recoveryStop = vi.fn(async () => undefined);
    const orphanStop = vi.fn(async () => undefined);
    let resolveImmediate!: () => void;
    const immediateSweep = new Promise<void>((resolve) => {
      resolveImmediate = resolve;
    });
    mocks.startRecovery.mockReturnValue({
      runNow: recoveryRunNow,
      stop: recoveryStop,
    });
    mocks.startOrphanCleanup.mockImplementation(() => {
      // The loop owns its one immediate fire-and-forget sweep. Keep it pending
      // to prove maintenance startup/readiness does not await it.
      void immediateSweep;
      return { runNow: vi.fn(() => immediateSweep), stop: orphanStop };
    });

    const maintenance = await startWorkerMaintenance({} as WorkerContext);

    expect(recoveryRunNow).toHaveBeenCalledTimes(1);
    expect(mocks.startOrphanCleanup).toHaveBeenCalledTimes(1);
    expect(maintenance.orphanCleanup.runNow).not.toHaveBeenCalled();

    resolveImmediate();
    await maintenance.stop();
    expect(orphanStop).toHaveBeenCalledTimes(1);
    expect(recoveryStop).toHaveBeenCalledTimes(1);
  });
});
