import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  ExecutionArtifactsRepository,
  IdempotencyRepository,
  OAuthIntentsRepository,
  type AsyncRunRow,
  type JobWithMetadata,
} from "@sf/db";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import {
  prepareRunDelivery,
  queueForRun,
  reconcileActiveRuns,
  runRecoverySweep,
  startRunRecoveryLoop,
} from "./recovery.ts";

const PAYLOAD = {
  runId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000003",
  contractVersion: "0.2.0",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("queueForRun", () => {
  it("maps the four collection providers and three other run kinds", () => {
    expect(queueForRun(run("collection", { provider: "crawl" }))).toBe(
      "collect.crawl",
    );
    expect(queueForRun(run("collection", { provider: "gsc" }))).toBe(
      "collect.gsc",
    );
    expect(queueForRun(run("collection", { provider: "ga4" }))).toBe(
      "collect.ga4",
    );
    expect(queueForRun(run("collection", { provider: "csv" }))).toBe(
      "collect.csv",
    );
    expect(queueForRun(run("diagnostic", {}))).toBe("diagnose");
    expect(queueForRun(run("artifact_generation", {}))).toBe(
      "artifact.generate",
    );
    expect(queueForRun(run("export", {}))).toBe("export.bundle");
  });

  it("rejects unknown/missing collection providers", () => {
    expect(queueForRun(run("collection", {}))).toBeNull();
    expect(queueForRun(run("collection", { provider: "dataforseo" }))).toBeNull();
    expect(queueForRun(run("unknown", {}))).toBeNull();
  });
});

describe("prepareRunDelivery", () => {
  it("passes only an eligible metadata delivery to its runner", async () => {
    const prepare = vi
      .spyOn(AsyncRunsRepository.prototype, "prepareDelivery")
      .mockResolvedValue(run("diagnostic", {}));
    const execute = vi.fn(async () => undefined);
    const ctx = context();
    const job = metadataJob(1);

    await prepareRunDelivery(ctx, job, execute);

    expect(prepare).toHaveBeenCalledWith(
      { workspaceId: PAYLOAD.workspaceId, projectId: PAYLOAD.projectId },
      PAYLOAD.runId,
      1,
    );
    expect(execute).toHaveBeenCalledWith(PAYLOAD);
  });

  it("acks stale/foreign metadata without invoking a runner or logging payload", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(null);
    const execute = vi.fn(async () => undefined);
    const { ctx, lines } = contextWithCapturedLogger();

    await prepareRunDelivery(ctx, metadataJob(1), execute);

    expect(execute).not.toHaveBeenCalled();
    expect(lines).toEqual([
      {
        event: "run_delivery_skipped",
        fields: {
          code: "CANONICAL_RUN_NOT_DELIVERABLE",
          runId: PAYLOAD.runId,
          retryCount: 1,
        },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain("contractVersion");
  });

  it("marks a still-active canonical run failed when the final retry throws", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(run("diagnostic", {}));
    const reconcile = vi
      .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
      .mockResolvedValue(true);
    const failure = new Error("transient fixture");
    const execute = vi.fn(async () => {
      throw failure;
    });
    const { ctx, lines } = contextWithCapturedLogger();

    await expect(
      prepareRunDelivery(ctx, metadataJob(2, 2), execute),
    ).rejects.toBe(failure);
    expect(reconcile).toHaveBeenCalledWith(
      { workspaceId: PAYLOAD.workspaceId, projectId: PAYLOAD.projectId },
      PAYLOAD.runId,
      {
        status: "failed",
        lastErrorCode: "QUEUE_RETRY_EXHAUSTED",
        lastErrorSummary: "Queue retries exhausted before the run completed.",
      },
    );
    expect(lines).toContainEqual({
      event: "run_delivery_reconciled",
      fields: {
        code: "QUEUE_RETRY_EXHAUSTED",
        runId: PAYLOAD.runId,
      },
    });
    expect(JSON.stringify(lines)).not.toContain("transient fixture");
  });

  it("does not overwrite a permanent terminal result when a handler throws", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(run("diagnostic", {}));
    const reconcile = vi
      .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
      .mockResolvedValue(false);

    await expect(
      prepareRunDelivery(context(), metadataJob(1, 1), async () => {
        throw new Error("already terminal");
      }),
    ).rejects.toThrow("already terminal");
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("atomically fails only the artifact projection owned by the exhausted run", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(
      run("artifact_generation", { artifactId: "artifact-1" }),
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "reconcileActiveToTerminal",
    ).mockResolvedValue(true);
    const failArtifact = vi
      .spyOn(
        ExecutionArtifactsRepository.prototype,
        "setFailedForGenerationRun",
      )
      .mockResolvedValue(true);

    await expect(
      prepareRunDelivery(context(), metadataJob(2, 2), async () => {
        throw new Error("final transient");
      }),
    ).rejects.toThrow("final transient");

    expect(failArtifact).toHaveBeenCalledWith(
      { workspaceId: PAYLOAD.workspaceId, projectId: PAYLOAD.projectId },
      "artifact-1",
      PAYLOAD.runId,
    );
  });

  it("preserves the runner error and redacts a reconciliation failure", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(run("diagnostic", {}));
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "reconcileActiveToTerminal",
    ).mockRejectedValue(new Error("password=projection-secret"));
    const runnerError = new Error("runner transient");
    const { ctx, lines } = contextWithCapturedLogger();

    await expect(
      prepareRunDelivery(ctx, metadataJob(2, 2), async () => {
        throw runnerError;
      }),
    ).rejects.toBe(runnerError);
    expect(lines).toContainEqual({
      event: "run_delivery_reconciliation_failed",
      fields: {
        code: "QUEUE_RETRY_EXHAUSTED",
        runId: PAYLOAD.runId,
      },
    });
    expect(JSON.stringify(lines)).not.toContain("projection-secret");
  });
});

describe("reconcileActiveRuns", () => {
  it.each(["created", "retry", "active"] as const)(
    "keeps a scoped %s queue job active",
    async (state) => {
      const row = run("diagnostic", {});
      vi.spyOn(
        AsyncRunsRepository.prototype,
        "listActiveForRecovery",
      ).mockResolvedValue([row]);
      const terminal = vi
        .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
        .mockResolvedValue(true);
      const getJobById = vi.fn(async () => jobFor(row, state));
      const findJobs = vi.fn(async () => []);

      await reconcileActiveRuns(
        contextWithBoss({ getJobById, findJobs }),
      );

      expect(getJobById).toHaveBeenCalledWith("diagnose", row.id);
      expect(findJobs).not.toHaveBeenCalled();
      expect(terminal).not.toHaveBeenCalled();
    },
  );

  it("maps failed, cancelled, and inconsistent completed jobs to stable terminal outcomes", async () => {
    const failed = runWithId("00000000-0000-4000-8000-000000000011");
    const cancelled = runWithId("00000000-0000-4000-8000-000000000012");
    const completed = runWithId("00000000-0000-4000-8000-000000000013");
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveForRecovery",
    ).mockResolvedValue([failed, cancelled, completed]);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
      .mockResolvedValue(true);
    const jobs = new Map([
      [failed.id, jobFor(failed, "failed")],
      [cancelled.id, jobFor(cancelled, "cancelled")],
      [completed.id, jobFor(completed, "completed")],
    ]);

    await reconcileActiveRuns(
      contextWithBoss({
        getJobById: vi.fn(async (_queue: string, id: string) =>
          jobs.get(id) ?? null,
        ),
        findJobs: vi.fn(async () => []),
      }),
    );

    expect(terminal).toHaveBeenCalledWith(
      scopeFor(failed),
      failed.id,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "QUEUE_JOB_FAILED",
      }),
    );
    expect(terminal).toHaveBeenCalledWith(
      scopeFor(cancelled),
      cancelled.id,
      expect.objectContaining({
        status: "cancelled",
        lastErrorCode: "QUEUE_JOB_CANCELLED",
      }),
    );
    expect(terminal).toHaveBeenCalledWith(
      scopeFor(completed),
      completed.id,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "QUEUE_JOB_COMPLETED_WITHOUT_CANONICAL_RESULT",
      }),
    );
  });

  it("falls back to a payload-scoped legacy id and rejects a foreign direct payload", async () => {
    const row = run("diagnostic", {});
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveForRecovery",
    ).mockResolvedValue([row]);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
      .mockResolvedValue(true);
    const foreign = {
      ...jobFor(row, "failed"),
      data: { ...PAYLOAD, projectId: "foreign-project" },
    };
    const legacy = jobFor(row, "failed", "legacy-random-id");
    const findJobs = vi.fn(async () => [legacy]);

    await reconcileActiveRuns(
      contextWithBoss({
        getJobById: vi.fn(async () => foreign),
        findJobs,
      }),
    );

    expect(findJobs).toHaveBeenCalledWith("diagnose", {
      data: { runId: row.id },
    });
    expect(terminal).toHaveBeenCalledWith(
      scopeFor(row),
      row.id,
      expect.objectContaining({ lastErrorCode: "QUEUE_JOB_FAILED" }),
    );
  });

  it("fails only old missing jobs and safely fails an invalid queue mapping", async () => {
    const old = runWithId("00000000-0000-4000-8000-000000000021");
    const fresh = {
      ...runWithId("00000000-0000-4000-8000-000000000022"),
      started_at: null,
      queued_at: "2026-07-19T11:30:00.000Z",
      status: "queued",
    };
    const invalid = {
      ...runWithId("00000000-0000-4000-8000-000000000023"),
      kind: "collection",
      request_payload: { provider: "dataforseo" },
    };
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveForRecovery",
    ).mockResolvedValue([old, fresh, invalid]);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
      .mockResolvedValue(true);
    const getJobById = vi.fn(async () => null);
    const findJobs = vi.fn(async () => []);

    await reconcileActiveRuns(
      contextWithBoss({ getJobById, findJobs }),
      {
        now: new Date("2026-07-19T12:00:00.000Z"),
        missingAfterMs: 60 * 60 * 1_000,
      },
    );

    expect(terminal).toHaveBeenCalledWith(
      scopeFor(old),
      old.id,
      expect.objectContaining({ lastErrorCode: "QUEUE_JOB_MISSING" }),
    );
    expect(terminal).not.toHaveBeenCalledWith(
      scopeFor(fresh),
      fresh.id,
      expect.anything(),
    );
    expect(terminal).toHaveBeenCalledWith(
      scopeFor(invalid),
      invalid.id,
      expect.objectContaining({ lastErrorCode: "QUEUE_MAPPING_INVALID" }),
    );
    expect(getJobById).toHaveBeenCalledTimes(2);
  });

  it("leaves a run active when public queue lookup fails and logs no raw error", async () => {
    const row = run("diagnostic", {});
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveForRecovery",
    ).mockResolvedValue([row]);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
      .mockResolvedValue(true);
    const { ctx, lines } = contextWithCapturedLogger({
      getJobById: vi.fn(async () => {
        throw new Error("password=fixture-secret");
      }),
      findJobs: vi.fn(async () => []),
    });

    await reconcileActiveRuns(ctx);

    expect(terminal).not.toHaveBeenCalled();
    expect(lines).toContainEqual({
      event: "run_recovery_failed",
      fields: { code: "RUN_RECOVERY_CHECK_FAILED", runId: row.id },
    });
    expect(JSON.stringify(lines)).not.toContain("fixture-secret");
  });
});

describe("startRunRecoveryLoop", () => {
  it("scrubs expired OAuth intents in the same startup/minutely sweep without logging secrets", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const scrubExpired = vi
      .spyOn(OAuthIntentsRepository.prototype, "scrubExpired")
      .mockResolvedValue(2);
    const pruneExpired = vi
      .spyOn(IdempotencyRepository.prototype, "pruneExpired")
      .mockResolvedValue(3);
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveForRecovery",
    ).mockResolvedValue([]);
    const { ctx, lines } = contextWithCapturedLogger();

    await runRecoverySweep(ctx, { now });

    expect(scrubExpired).toHaveBeenCalledWith(now);
    expect(pruneExpired).toHaveBeenCalledWith();
    expect(lines).toContainEqual({
      event: "oauth_intents_scrubbed",
      fields: { count: 2 },
    });
    expect(lines).toContainEqual({
      event: "idempotency_keys_pruned",
      fields: { count: 3 },
    });
    expect(JSON.stringify(lines)).not.toContain("token");
  });

  it("keeps run recovery going when expired idempotency cleanup fails", async () => {
    vi.spyOn(OAuthIntentsRepository.prototype, "scrubExpired").mockResolvedValue(0);
    vi.spyOn(IdempotencyRepository.prototype, "pruneExpired").mockRejectedValue(
      new Error("password=idempotency-cleanup-secret"),
    );
    const listActive = vi
      .spyOn(AsyncRunsRepository.prototype, "listActiveForRecovery")
      .mockResolvedValue([]);
    const { ctx, lines } = contextWithCapturedLogger();

    await runRecoverySweep(ctx, {
      now: new Date("2026-07-18T12:00:00.000Z"),
    });

    expect(listActive).toHaveBeenCalled();
    expect(lines).toContainEqual({
      event: "idempotency_key_prune_failed",
      fields: { code: "IDEMPOTENCY_KEY_PRUNE_FAILED" },
    });
    expect(JSON.stringify(lines)).not.toContain("cleanup-secret");
  });

  it("runs at startup and periodically, then closes without keeping timers alive", async () => {
    vi.useFakeTimers();
    const reconcile = vi.fn(async () => undefined);
    const loop = startRunRecoveryLoop(context(), {
      intervalMs: 1_000,
      reconcile,
    });

    await loop.runNow();
    expect(reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reconcile).toHaveBeenCalledTimes(2);

    await loop.stop();
    await loop.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid cadence and reports a startup sweep failure safely", async () => {
    expect(() =>
      startRunRecoveryLoop(context(), { intervalMs: 0 }),
    ).toThrow(/interval must be positive/i);

    vi.useFakeTimers();
    const { ctx, lines } = contextWithCapturedLogger();
    const loop = startRunRecoveryLoop(ctx, {
      intervalMs: 1_000,
      reconcile: async () => {
        throw new Error("password=sweep-secret");
      },
    });
    await expect(loop.runNow()).rejects.toThrow("sweep-secret");
    await Promise.resolve();
    expect(lines).toContainEqual({
      event: "run_recovery_failed",
      fields: { code: "RUN_RECOVERY_SWEEP_FAILED" },
    });
    expect(JSON.stringify(lines)).not.toContain("password=");
    await loop.stop();
  });
});

function run(
  kind: string,
  requestPayload: Record<string, unknown>,
): AsyncRunRow {
  return {
    id: PAYLOAD.runId,
    workspace_id: PAYLOAD.workspaceId,
    project_id: PAYLOAD.projectId,
    kind,
    status: "running",
    active_key: "fixture",
    contract_version: "0.2.0",
    request_payload: requestPayload,
    progress: {},
    last_error_code: null,
    last_error_summary: null,
    result_type: null,
    result_id: null,
    attempt_count: 1,
    initiated_by: "00000000-0000-4000-8000-000000000004",
    queued_at: "2026-07-18T00:00:00.000Z",
    started_at: "2026-07-18T00:00:00.000Z",
    completed_at: null,
  };
}

function metadataJob(
  retryCount: number,
  retryLimit = 2,
): JobWithMetadata<typeof PAYLOAD> {
  return {
    id: PAYLOAD.runId,
    name: "diagnose",
    data: PAYLOAD,
    expireInSeconds: 600,
    heartbeatSeconds: 60,
    signal: new AbortController().signal,
    priority: 0,
    state: "active",
    retryLimit,
    retryCount,
    retryDelay: 0,
    retryBackoff: true,
    startAfter: new Date(),
    startedOn: new Date(),
    singletonKey: null,
    singletonOn: null,
    deleteAfterSeconds: 600,
    createdOn: new Date(),
    completedOn: null,
    keepUntil: new Date(),
    policy: "standard",
    heartbeatOn: new Date(),
    blocked: false,
    blocking: false,
    pendingDependencies: 0,
    deadLetter: "",
    output: {},
    sourceName: null,
    sourceId: null,
    sourceCreatedOn: null,
    sourceRetryCount: null,
  };
}

function runWithId(id: string): AsyncRunRow {
  return { ...run("diagnostic", {}), id };
}

function jobFor(
  row: AsyncRunRow,
  state: JobWithMetadata["state"],
  id = row.id,
): JobWithMetadata<typeof PAYLOAD> {
  return {
    ...metadataJob(0),
    id,
    state,
    data: {
      ...PAYLOAD,
      runId: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
    },
  };
}

function scopeFor(row: AsyncRunRow): {
  workspaceId: string;
  projectId: string;
} {
  return { workspaceId: row.workspace_id, projectId: row.project_id };
}

function context(): WorkerContext {
  return contextWithCapturedLogger().ctx;
}

function contextWithBoss(
  boss: Record<string, unknown>,
): WorkerContext {
  return contextWithCapturedLogger(boss).ctx;
}

function contextWithCapturedLogger(
  boss: Record<string, unknown> = {},
): {
  readonly ctx: WorkerContext;
  readonly lines: Array<{
    event: string;
    fields?: Record<string, unknown>;
  }>;
} {
  const lines: Array<{
    event: string;
    fields?: Record<string, unknown>;
  }> = [];
  const append = (event: string, fields?: Record<string, unknown>): void => {
    lines.push(fields ? { event, fields } : { event });
  };
  const logger: Logger = {
    context: { service: "worker", environment: "test" },
    child: () => logger,
    debug: append,
    info: append,
    warn: append,
    error: append,
  };
  return {
    ctx: {
      db: {
        transaction: async (
          callback: (tx: WorkerContext["db"]) => Promise<unknown>,
        ) => callback({} as WorkerContext["db"]),
      } as WorkerContext["db"],
      boss: boss as unknown as WorkerContext["boss"],
      blobStore: {} as WorkerContext["blobStore"],
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "id", clientSecret: "secret" },
      openai: { apiKey: "key", model: "model" },
      logger,
    },
    lines,
  };
}
