import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementWindow } from "@sf/contracts";
import {
  AsyncRunsRepository,
  MeasurementWindowsRepository,
  type RunAttempt,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";
import { createDbMeasurementExecutionDependencies } from "./db-authority.ts";

const attempt: RunAttempt = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  runId: "00000000-0000-4000-8000-000000000003",
  attemptCount: 2,
};
const measurementWindowId =
  "00000000-0000-4000-8000-000000000004";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("DB measurement finalization", () => {
  it("locks the run fence, appends the immutable result, and terminalizes in one outer transaction", async () => {
    const calls: string[] = [];
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockImplementation(async () => {
      calls.push("lock");
      return {} as never;
    });
    vi.spyOn(
      MeasurementWindowsRepository.prototype,
      "appendFinalInTx",
    ).mockImplementation(async (_scope, input) => {
      calls.push("append");
      return { window: input.window, replayed: false };
    });
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "setTerminal",
    ).mockImplementation(async () => {
      calls.push("terminal");
      return true;
    });
    const ctx = context(calls);
    const dependencies =
      createDbMeasurementExecutionDependencies(ctx);
    const window = {
      measurementWindowId,
    } as MeasurementWindow;

    await expect(
      dependencies.finalize({
        scope: {
          workspaceId: attempt.workspaceId,
          projectId: attempt.projectId,
        },
        attempt,
        window,
        observationLineage: {
          gsc: {
            baselineObservationId: null,
            outcomeObservationId: null,
          },
          ga4: {
            baselineObservationId: null,
            outcomeObservationId: null,
          },
          geo: {
            baselineObservationId: null,
            outcomeObservationId: null,
          },
        },
      }),
    ).resolves.toBe(true);

    expect(calls).toEqual([
      "transaction",
      "lock",
      "append",
      "terminal",
    ]);
    expect(
      MeasurementWindowsRepository.prototype.appendFinalInTx,
    ).toHaveBeenCalledWith(
      {
        workspaceId: attempt.workspaceId,
        projectId: attempt.projectId,
      },
      expect.objectContaining({
        asyncRunId: attempt.runId,
        window,
      }),
    );
    expect(
      AsyncRunsRepository.prototype.setTerminal,
    ).toHaveBeenCalledWith(attempt, {
      status: "completed",
      resultType: "measurement_window",
      resultId: measurementWindowId,
    });
  });

  it("does not append or terminalize when a newer run attempt owns the fence", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(null);
    const append = vi.spyOn(
      MeasurementWindowsRepository.prototype,
      "appendFinalInTx",
    );
    const terminal = vi.spyOn(
      AsyncRunsRepository.prototype,
      "setTerminal",
    );
    const dependencies = createDbMeasurementExecutionDependencies(
      context([]),
    );

    await expect(
      dependencies.finalize({
        scope: {
          workspaceId: attempt.workspaceId,
          projectId: attempt.projectId,
        },
        attempt,
        window: {
          measurementWindowId,
        } as MeasurementWindow,
        observationLineage: {
          gsc: {
            baselineObservationId: null,
            outcomeObservationId: null,
          },
          ga4: {
            baselineObservationId: null,
            outcomeObservationId: null,
          },
          geo: {
            baselineObservationId: null,
            outcomeObservationId: null,
          },
        },
      }),
    ).resolves.toBe(false);

    expect(append).not.toHaveBeenCalled();
    expect(terminal).not.toHaveBeenCalled();
  });
});

function context(calls: string[]): WorkerContext {
  const transaction = vi.fn(
    async <T>(callback: (tx: never) => Promise<T>): Promise<T> => {
      calls.push("transaction");
      return callback({} as never);
    },
  );
  return {
    db: { transaction } as never,
    boss: {} as never,
    blobStore: {} as never,
    credentialKey: Buffer.alloc(32),
    appOrigin: "https://app.example.com",
    googleOAuth: { clientId: "id", clientSecret: "secret" },
    openai: { apiKey: "key", model: "model" },
    findingSummariesEnabled: false,
    logger: {} as never,
  };
}
