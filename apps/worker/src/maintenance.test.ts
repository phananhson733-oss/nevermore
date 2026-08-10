import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "./context.ts";

const mocks = vi.hoisted(() => ({
  isRecoveryAbortError: vi.fn(),
  startRecovery: vi.fn(),
  startCompetitorMonitor: vi.fn(),
  startKeywordGovernanceTrigger: vi.fn(),
  startOrphanCleanup: vi.fn(),
  startRetentionCleanup: vi.fn(),
}));

vi.mock("./handlers/recovery.ts", () => ({
  isRunRecoveryAbortError: mocks.isRecoveryAbortError,
  startRunRecoveryLoop: mocks.startRecovery,
}));
vi.mock("./handlers/orphan-cleanup.ts", () => ({
  startOrphanCleanupLoop: mocks.startOrphanCleanup,
}));
vi.mock("./handlers/retention-cleanup.ts", () => ({
  startRetentionCleanupLoop: mocks.startRetentionCleanup,
}));
vi.mock("./competitor-monitor/scheduler.ts", () => ({
  startCompetitorMonitorSchedulerLoop: mocks.startCompetitorMonitor,
}));
vi.mock("./keyword-governance-suggestions/trigger-dispatcher.ts", () => ({
  startKeywordGovernanceSuggestionTriggerDispatcherLoop:
    mocks.startKeywordGovernanceTrigger,
}));

import {
  getWorkerMaintenanceFromStartError,
  startWorkerMaintenance,
} from "./maintenance.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isRecoveryAbortError.mockReturnValue(false);
  mocks.startCompetitorMonitor.mockReturnValue({
    runNow: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  });
  mocks.startKeywordGovernanceTrigger.mockReturnValue({
    runNow: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startWorkerMaintenance", () => {
  it("starts both storage maintenance loops without making readiness await either sweep", async () => {
    const recoveryRunNow = vi.fn(async () => undefined);
    const recoveryStop = vi.fn(async () => undefined);
    const orphanStop = vi.fn(async () => undefined);
    const retentionStop = vi.fn(async () => undefined);
    const competitorMonitorStop = vi.fn(async () => undefined);
    const keywordGovernanceTriggerStop = vi.fn(async () => undefined);
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
    mocks.startRetentionCleanup.mockReturnValue({
      runNow: vi.fn(() => immediateSweep),
      stop: retentionStop,
    });
    mocks.startCompetitorMonitor.mockReturnValue({
      runNow: vi.fn(() => immediateSweep),
      stop: competitorMonitorStop,
    });
    mocks.startKeywordGovernanceTrigger.mockReturnValue({
      runNow: vi.fn(() => immediateSweep),
      stop: keywordGovernanceTriggerStop,
    });

    const maintenance = await startWorkerMaintenance({} as WorkerContext);

    expect(recoveryRunNow).toHaveBeenCalledTimes(1);
    expect(mocks.startOrphanCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.startRetentionCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.startCompetitorMonitor).toHaveBeenCalledTimes(1);
    expect(mocks.startKeywordGovernanceTrigger).toHaveBeenCalledTimes(1);
    expect(maintenance.keywordGovernanceTrigger.runNow).not.toHaveBeenCalled();
    expect(maintenance.competitorMonitor.runNow).not.toHaveBeenCalled();
    expect(maintenance.orphanCleanup.runNow).not.toHaveBeenCalled();
    expect(maintenance.retentionCleanup.runNow).not.toHaveBeenCalled();

    resolveImmediate();
    await maintenance.stop();
    await maintenance.stop();
    expect(orphanStop).toHaveBeenCalledTimes(1);
    expect(retentionStop).toHaveBeenCalledTimes(1);
    expect(competitorMonitorStop).toHaveBeenCalledTimes(1);
    expect(keywordGovernanceTriggerStop).toHaveBeenCalledTimes(1);
    expect(recoveryStop).toHaveBeenCalledTimes(1);
  });

  it("starts every loop stop concurrently and bounds a stuck retention stop", async () => {
    vi.useFakeTimers();
    const recoveryStop = vi.fn(async () => undefined);
    const orphanStop = vi.fn(async () => undefined);
    const retentionStop = vi.fn(() => new Promise<void>(() => undefined));
    const competitorMonitorStop = vi.fn(async () => undefined);
    const keywordGovernanceTriggerStop = vi.fn(async () => undefined);
    mocks.startRecovery.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: recoveryStop,
    });
    mocks.startOrphanCleanup.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: orphanStop,
    });
    mocks.startRetentionCleanup.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: retentionStop,
    });
    mocks.startCompetitorMonitor.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: competitorMonitorStop,
    });
    mocks.startKeywordGovernanceTrigger.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: keywordGovernanceTriggerStop,
    });
    const maintenance = await startWorkerMaintenance({} as WorkerContext, {
      stopTimeoutMs: 50,
    });

    const firstStop = maintenance.stop();
    const secondStop = maintenance.stop();
    expect(secondStop).toBe(firstStop);
    await Promise.resolve();
    expect(retentionStop).toHaveBeenCalledTimes(1);
    expect(orphanStop).toHaveBeenCalledTimes(1);
    expect(recoveryStop).toHaveBeenCalledTimes(1);
    expect(competitorMonitorStop).toHaveBeenCalledTimes(1);
    expect(keywordGovernanceTriggerStop).toHaveBeenCalledTimes(1);

    const rejected = expect(firstStop).rejects.toMatchObject({
      code: "WORKER_MAINTENANCE_STOP_FAILED",
      failedLoops: ["retention"],
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
  });

  it("stops partial maintenance when blocking startup recovery fails", async () => {
    const startupFailure = new Error("recovery-startup-customer-secret");
    const recoveryStop = vi.fn(async () => undefined);
    mocks.startRecovery.mockReturnValue({
      runNow: vi.fn(async () => {
        throw startupFailure;
      }),
      stop: recoveryStop,
    });

    await expect(
      startWorkerMaintenance({} as WorkerContext),
    ).rejects.toBe(startupFailure);

    expect(recoveryStop).toHaveBeenCalledTimes(1);
    expect(mocks.startRetentionCleanup).not.toHaveBeenCalled();
    expect(mocks.startOrphanCleanup).not.toHaveBeenCalled();
    expect(mocks.startCompetitorMonitor).not.toHaveBeenCalled();
    expect(mocks.startKeywordGovernanceTrigger).not.toHaveBeenCalled();
  });

  it("stops all previously started loops when a later loop cannot start", async () => {
    const startupFailure = new Error("orphan-startup-customer-secret");
    const recoveryStop = vi.fn(async () => undefined);
    const retentionStop = vi.fn(async () => undefined);
    const competitorMonitorStop = vi.fn(async () => undefined);
    const keywordGovernanceTriggerStop = vi.fn(async () => undefined);
    mocks.startRecovery.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: recoveryStop,
    });
    mocks.startRetentionCleanup.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: retentionStop,
    });
    mocks.startCompetitorMonitor.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: competitorMonitorStop,
    });
    mocks.startKeywordGovernanceTrigger.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: keywordGovernanceTriggerStop,
    });
    mocks.startOrphanCleanup.mockImplementation(() => {
      throw startupFailure;
    });

    await expect(
      startWorkerMaintenance({} as WorkerContext),
    ).rejects.toBe(startupFailure);

    expect(retentionStop).toHaveBeenCalledTimes(1);
    expect(competitorMonitorStop).toHaveBeenCalledTimes(1);
    expect(keywordGovernanceTriggerStop).toHaveBeenCalledTimes(1);
    expect(recoveryStop).toHaveBeenCalledTimes(1);
  });

  it("starts no storage loop when shutdown aborts blocking startup recovery", async () => {
    const controller = new AbortController();
    const recoveryStop = vi.fn(async () => undefined);
    mocks.startRecovery.mockImplementation(
      (_ctx: WorkerContext, options: { signal?: AbortSignal }) => {
        let resolveRecovery!: () => void;
        const recovery = new Promise<void>((resolve) => {
          resolveRecovery = resolve;
        });
        options.signal?.addEventListener("abort", resolveRecovery, {
          once: true,
        });
        return {
          runNow: vi.fn(() => recovery),
          stop: recoveryStop,
        };
      },
    );

    const starting = startWorkerMaintenance({} as WorkerContext, {
      signal: controller.signal,
      stopTimeoutMs: 50,
    });
    await vi.waitFor(() => expect(mocks.startRecovery).toHaveBeenCalled());
    controller.abort();
    const maintenance = await starting;

    expect(mocks.startRetentionCleanup).not.toHaveBeenCalled();
    expect(mocks.startOrphanCleanup).not.toHaveBeenCalled();
    expect(mocks.startCompetitorMonitor).not.toHaveBeenCalled();
    expect(mocks.startKeywordGovernanceTrigger).not.toHaveBeenCalled();
    await maintenance.stop();
    expect(recoveryStop).toHaveBeenCalledTimes(1);
  });

  it("preserves a real recovery rejection when shutdown aborts in the same race", async () => {
    const controller = new AbortController();
    const recoveryFailure = new Error("recovery-startup-customer-secret");
    let rejectRecovery!: (error: unknown) => void;
    const recovery = new Promise<void>((_resolve, reject) => {
      rejectRecovery = reject;
    });
    const recoveryStop = vi.fn(async () => undefined);
    mocks.startRecovery.mockReturnValue({
      runNow: vi.fn(() => recovery),
      stop: recoveryStop,
    });

    const starting = startWorkerMaintenance({} as WorkerContext, {
      signal: controller.signal,
      stopTimeoutMs: 50,
    });
    await vi.waitFor(() => expect(mocks.startRecovery).toHaveBeenCalled());
    controller.abort();
    rejectRecovery(recoveryFailure);

    await expect(starting).rejects.toBe(recoveryFailure);
    expect(mocks.startRetentionCleanup).not.toHaveBeenCalled();
    expect(mocks.startOrphanCleanup).not.toHaveBeenCalled();
    expect(mocks.startCompetitorMonitor).not.toHaveBeenCalled();
    expect(mocks.startKeywordGovernanceTrigger).not.toHaveBeenCalled();
    expect(recoveryStop).toHaveBeenCalledTimes(1);
  });

  it("treats a classified recovery abort as interrupted startup", async () => {
    const controller = new AbortController();
    const recoveryAbort = { code: "RUN_RECOVERY_ABORTED" };
    const recoveryStop = vi.fn(async () => undefined);
    mocks.isRecoveryAbortError.mockImplementation(
      (error: unknown) => error === recoveryAbort,
    );
    mocks.startRecovery.mockReturnValue({
      runNow: vi.fn(async () => {
        throw recoveryAbort;
      }),
      stop: recoveryStop,
    });

    const starting = startWorkerMaintenance({} as WorkerContext, {
      signal: controller.signal,
      stopTimeoutMs: 50,
    });
    controller.abort();
    const maintenance = await starting;

    expect(mocks.isRecoveryAbortError).toHaveBeenCalledWith(recoveryAbort);
    expect(mocks.startRetentionCleanup).not.toHaveBeenCalled();
    expect(mocks.startOrphanCleanup).not.toHaveBeenCalled();
    expect(mocks.startCompetitorMonitor).not.toHaveBeenCalled();
    expect(mocks.startKeywordGovernanceTrigger).not.toHaveBeenCalled();
    await maintenance.stop();
    expect(recoveryStop).toHaveBeenCalledTimes(1);
  });

  it("exposes partial maintenance when startup rollback times out", async () => {
    vi.useFakeTimers();
    const startupFailure = new Error("orphan-startup-customer-secret");
    const recoveryStop = vi.fn(async () => undefined);
    const retentionStop = vi.fn(() => new Promise<void>(() => undefined));
    const competitorMonitorStop = vi.fn(async () => undefined);
    const keywordGovernanceTriggerStop = vi.fn(async () => undefined);
    mocks.startRecovery.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: recoveryStop,
    });
    mocks.startRetentionCleanup.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: retentionStop,
    });
    mocks.startCompetitorMonitor.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: competitorMonitorStop,
    });
    mocks.startKeywordGovernanceTrigger.mockReturnValue({
      runNow: vi.fn(async () => undefined),
      stop: keywordGovernanceTriggerStop,
    });
    mocks.startOrphanCleanup.mockImplementation(() => {
      throw startupFailure;
    });

    const starting = startWorkerMaintenance({} as WorkerContext, {
      stopTimeoutMs: 50,
    });
    const rejected = expect(starting).rejects.toMatchObject({
      code: "WORKER_MAINTENANCE_START_CLEANUP_FAILED",
      failedLoops: ["retention"],
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    const failure = await starting.catch((error: unknown) => error);
    const partial = getWorkerMaintenanceFromStartError(failure);

    expect(partial).toBeDefined();
    expect(recoveryStop).toHaveBeenCalledTimes(1);
    expect(retentionStop).toHaveBeenCalledTimes(1);
    expect(competitorMonitorStop).toHaveBeenCalledTimes(1);
    expect(keywordGovernanceTriggerStop).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid stop deadline before any loop starts", async () => {
    await expect(
      startWorkerMaintenance({} as WorkerContext, { stopTimeoutMs: 0 }),
    ).rejects.toThrow(/stop timeout must be a positive integer/);

    expect(mocks.startRecovery).not.toHaveBeenCalled();
    expect(mocks.startCompetitorMonitor).not.toHaveBeenCalled();
    expect(mocks.startKeywordGovernanceTrigger).not.toHaveBeenCalled();
    expect(mocks.startRetentionCleanup).not.toHaveBeenCalled();
    expect(mocks.startOrphanCleanup).not.toHaveBeenCalled();
  });
});
