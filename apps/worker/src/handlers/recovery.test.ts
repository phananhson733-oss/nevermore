import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  ExecutionArtifactsRepository,
  IdempotencyRepository,
  OAuthIntentsRepository,
  ProjectsRepository,
  SourceConnectionsRepository,
  type AsyncRunRow,
  type JobWithMetadata,
} from "@sf/db";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import {
  isRunRecoveryAbortError,
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
  contractVersion: "2026-07-18",
};
const SOURCE_CONNECTION_ID = "00000000-0000-4000-8000-000000000005";

beforeEach(() => {
  vi.spyOn(
    AsyncRunsRepository.prototype,
    "lockActiveForRecovery",
  ).mockResolvedValue({} as never);
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue({
    id: PAYLOAD.projectId,
    workspace_id: PAYLOAD.workspaceId,
    archived_at: null,
  } as never);
});

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
    expect(queueForRun(run("collection", { provider: "toString" }))).toBeNull();
    expect(queueForRun(run("collection", { provider: "__proto__" }))).toBeNull();
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
    expect(execute).toHaveBeenCalledWith(
      PAYLOAD,
      expect.objectContaining({ logger: ctx.logger }),
    );
  });

  it("accepts the legacy payload contract during a rolling upgrade", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(run("diagnostic", {}, "0.2.0"));
    const execute = vi.fn(async () => undefined);
    const legacyPayload = { ...PAYLOAD, contractVersion: "0.2.0" };
    const job = { ...metadataJob(1), data: legacyPayload };

    await prepareRunDelivery(context(), job, execute);

    expect(execute).toHaveBeenCalledWith(
      legacyPayload,
      expect.objectContaining({ logger: expect.any(Object) }),
    );
  });

  it.each([
    ["missing", undefined],
    ["unknown", "2099-01-01"],
    ["non-string", { malicious: "payload-secret" }],
  ] as const)(
    "fails an active run with an unsupported %s contract and acks the delivery",
    async (_label, contractVersion) => {
      vi.spyOn(
        AsyncRunsRepository.prototype,
        "prepareDelivery",
      ).mockResolvedValue(run("diagnostic", {}));
      const reconcile = vi
        .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
        .mockResolvedValue(true);
      const execute = vi.fn(async () => undefined);
      const { ctx, lines } = contextWithCapturedLogger();
      const { contractVersion: _current, ...basePayload } = PAYLOAD;
      const data =
        contractVersion === undefined
          ? basePayload
          : { ...basePayload, contractVersion };

      await expect(
        prepareRunDelivery(ctx, { ...metadataJob(0), data }, execute),
      ).resolves.toBeUndefined();

      expect(execute).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalledWith(
        { workspaceId: PAYLOAD.workspaceId, projectId: PAYLOAD.projectId },
        PAYLOAD.runId,
        {
          status: "failed",
          lastErrorCode: "UNSUPPORTED_JOB_CONTRACT",
          lastErrorSummary:
            "The queue job uses an unsupported contract version.",
        },
      );
      expect(lines).toContainEqual({
        event: "run_delivery_reconciled",
        fields: {
          code: "UNSUPPORTED_JOB_CONTRACT",
          runId: PAYLOAD.runId,
        },
      });
      expect(JSON.stringify(lines)).not.toContain("2099-01-01");
      expect(JSON.stringify(lines)).not.toContain("payload-secret");
    },
  );

  it("fails a supported contract mismatch without invoking the runner", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(run("diagnostic", {}, "0.2.0"));
    const reconcile = vi
      .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
      .mockResolvedValue(true);
    const execute = vi.fn(async () => undefined);
    const { ctx, lines } = contextWithCapturedLogger();

    await expect(
      prepareRunDelivery(ctx, metadataJob(0), execute),
    ).resolves.toBeUndefined();

    expect(execute).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledWith(
      { workspaceId: PAYLOAD.workspaceId, projectId: PAYLOAD.projectId },
      PAYLOAD.runId,
      expect.objectContaining({ lastErrorCode: "JOB_CONTRACT_MISMATCH" }),
    );
    expect(lines).toContainEqual({
      event: "run_delivery_reconciled",
      fields: {
        code: "JOB_CONTRACT_MISMATCH",
        runId: PAYLOAD.runId,
      },
    });
    expect(JSON.stringify(lines)).not.toContain("0.2.0");
    expect(JSON.stringify(lines)).not.toContain("2026-07-18");
  });

  it("acks an invalid contract and the next sweep immediately finishes reconciliation", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(run("diagnostic", {}));
    const lock = vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockActiveForRecovery",
    ).mockRejectedValueOnce(new Error("contractVersion=payload-secret"));
    const execute = vi.fn(async () => undefined);
    const { ctx, lines } = contextWithCapturedLogger();
    const invalid = { ...PAYLOAD, contractVersion: "2099-01-01" };

    await expect(
      prepareRunDelivery(
        ctx,
        { ...metadataJob(0), data: invalid },
        execute,
      ),
    ).resolves.toBeUndefined();

    expect(execute).not.toHaveBeenCalled();
    expect(lines).toContainEqual({
      event: "run_delivery_reconciliation_failed",
      fields: {
        code: "UNSUPPORTED_JOB_CONTRACT",
        runId: PAYLOAD.runId,
      },
    });
    expect(JSON.stringify(lines)).not.toContain("2099-01-01");
    expect(JSON.stringify(lines)).not.toContain("payload-secret");

    const row = run("diagnostic", {});
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveForRecovery",
    ).mockResolvedValue([row]);
    const reconcile = vi
      .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
      .mockResolvedValue(true);
    const completedInvalidJob = {
      ...metadataJob(0),
      state: "completed" as const,
      data: invalid,
    };

    await reconcileActiveRuns(
      contextWithBoss({
        getJobById: vi.fn(async () => completedInvalidJob),
        findJobs: vi.fn(async () => [completedInvalidJob]),
      }),
      {
        now: new Date("2026-07-18T00:00:01.000Z"),
        missingAfterMs: 60 * 60 * 1_000,
      },
    );

    expect(lock).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledWith(
      scopeFor(row),
      row.id,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNSUPPORTED_JOB_CONTRACT",
      }),
    );
    expect(JSON.stringify(lines)).not.toContain("2099-01-01");
  });

  it("atomically fails an artifact projection for a contract mismatch", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(
      run(
        "artifact_generation",
        { artifactId: "artifact-contract-mismatch" },
        "0.2.0",
      ),
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
    const execute = vi.fn(async () => undefined);

    await prepareRunDelivery(context(), metadataJob(0), execute);

    expect(execute).not.toHaveBeenCalled();
    expect(failArtifact).toHaveBeenCalledWith(
      { workspaceId: PAYLOAD.workspaceId, projectId: PAYLOAD.projectId },
      "artifact-contract-mismatch",
      PAYLOAD.runId,
    );
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

  it("atomically recovers the scoped syncing source when a collection exhausts retries", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(
      run("collection", {
        provider: "crawl",
        sourceConnectionId: SOURCE_CONNECTION_ID,
      }),
    );
    let canonicalExecutor: unknown;
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "reconcileActiveToTerminal",
    ).mockImplementation(function (this: AsyncRunsRepository) {
      canonicalExecutor = (this as unknown as { exec: unknown }).exec;
      return Promise.resolve(true);
    });
    let sourceExecutor: unknown;
    const recoverSource = vi
      .spyOn(
        SourceConnectionsRepository.prototype,
        "recoverSyncingAfterCollectionFailure",
      )
      .mockImplementation(function (this: SourceConnectionsRepository) {
        sourceExecutor = (this as unknown as { exec: unknown }).exec;
        return Promise.resolve(true);
      });
    const ctx = context();
    const transaction = vi.spyOn(ctx.db, "transaction");

    await expect(
      prepareRunDelivery(ctx, metadataJob(2, 2), async () => {
        throw new Error("provider raw secret");
      }),
    ).rejects.toThrow("provider raw secret");

    expect(recoverSource).toHaveBeenCalledWith(
      { workspaceId: PAYLOAD.workspaceId, projectId: PAYLOAD.projectId },
      SOURCE_CONNECTION_ID,
      "crawl",
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(canonicalExecutor).toBe(sourceExecutor);
    expect(canonicalExecutor).not.toBe(ctx.db);
  });

  it("does not project a source when the canonical recovery CAS loses", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(
      run("collection", {
        provider: "crawl",
        sourceConnectionId: SOURCE_CONNECTION_ID,
      }),
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "reconcileActiveToTerminal",
    ).mockResolvedValue(false);
    const recoverSource = vi.spyOn(
      SourceConnectionsRepository.prototype,
      "recoverSyncingAfterCollectionFailure",
    );

    await expect(
      prepareRunDelivery(context(), metadataJob(2, 2), async () => {
        throw new Error("already terminal");
      }),
    ).rejects.toThrow("already terminal");

    expect(recoverSource).not.toHaveBeenCalled();
  });

  it("preserves the runner error and redacts a source projection failure", async () => {
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "prepareDelivery",
    ).mockResolvedValue(
      run("collection", {
        provider: "crawl",
        sourceConnectionId: SOURCE_CONNECTION_ID,
      }),
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "reconcileActiveToTerminal",
    ).mockResolvedValue(true);
    vi.spyOn(
      SourceConnectionsRepository.prototype,
      "recoverSyncingAfterCollectionFailure",
    ).mockRejectedValue(new Error("password=source-projection-secret"));
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
    expect(JSON.stringify(lines)).not.toContain("source-projection-secret");
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

  it.each([
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["missing", null],
  ] as const)(
    "recovers a collection source after a %s queue outcome",
    async (_label, queueState) => {
      const row = run("collection", {
        provider: "crawl",
        sourceConnectionId: SOURCE_CONNECTION_ID,
      });
      vi.spyOn(
        AsyncRunsRepository.prototype,
        "listActiveForRecovery",
      ).mockResolvedValue([row]);
      vi.spyOn(
        AsyncRunsRepository.prototype,
        "reconcileActiveToTerminal",
      ).mockResolvedValue(true);
      const recoverSource = vi
        .spyOn(
          SourceConnectionsRepository.prototype,
          "recoverSyncingAfterCollectionFailure",
        )
        .mockResolvedValue(true);

      await reconcileActiveRuns(
        contextWithBoss({
          getJobById: vi.fn(async () =>
            queueState === null ? null : jobFor(row, queueState),
          ),
          findJobs: vi.fn(async () => []),
        }),
        {
          now: new Date("2026-07-19T12:00:00.000Z"),
          missingAfterMs: 60 * 60 * 1_000,
        },
      );

      expect(recoverSource).toHaveBeenCalledWith(
        scopeFor(row),
        SOURCE_CONNECTION_ID,
        "crawl",
      );
    },
  );

  it.each([
    ["collection", { provider: "crawl" }],
    [
      "collection",
      { provider: "crawl", sourceConnectionId: "not-a-uuid" },
    ],
    [
      "collection",
      { provider: "dataforseo", sourceConnectionId: SOURCE_CONNECTION_ID },
    ],
    ["diagnostic", { sourceConnectionId: SOURCE_CONNECTION_ID }],
  ] as const)(
    "does not use an absent, malformed, or non-collection source projection: %s %j",
    async (kind, requestPayload) => {
      const row = run(kind, requestPayload);
      vi.spyOn(
        AsyncRunsRepository.prototype,
        "listActiveForRecovery",
      ).mockResolvedValue([row]);
      vi.spyOn(
        AsyncRunsRepository.prototype,
        "reconcileActiveToTerminal",
      ).mockResolvedValue(true);
      const recoverSource = vi.spyOn(
        SourceConnectionsRepository.prototype,
        "recoverSyncingAfterCollectionFailure",
      );

      await reconcileActiveRuns(
        contextWithBoss({
          getJobById: vi.fn(async () => jobFor(row, "failed")),
          findJobs: vi.fn(async () => []),
        }),
      );

      expect(recoverSource).not.toHaveBeenCalled();
    },
  );

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

  it("immediately fails a run whose only scoped job has a mismatched version", async () => {
    const row = run("diagnostic", {}, "0.2.0");
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveForRecovery",
    ).mockResolvedValue([row]);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "reconcileActiveToTerminal")
      .mockResolvedValue(true);
    const mismatched = {
      ...jobFor(row, "active"),
      data: {
        ...jobFor(row, "active").data,
        contractVersion: "2026-07-18",
      },
    };
    const findJobs = vi.fn(async () => [mismatched]);

    const { ctx, lines } = contextWithCapturedLogger({
      getJobById: vi.fn(async () => mismatched),
      findJobs,
    });

    await reconcileActiveRuns(ctx, {
      now: new Date("2026-07-18T00:00:01.000Z"),
      missingAfterMs: 60 * 60 * 1_000,
    });

    expect(findJobs).toHaveBeenCalledWith("diagnose", {
      data: { runId: row.id },
    });
    expect(terminal).toHaveBeenCalledWith(
      scopeFor(row),
      row.id,
      expect.objectContaining({ lastErrorCode: "JOB_CONTRACT_MISMATCH" }),
    );
    expect(JSON.stringify(lines)).not.toContain("0.2.0");
    expect(JSON.stringify(lines)).not.toContain("2026-07-18");
  });

  it("prefers a valid legacy job over invalid direct and duplicate candidates", async () => {
    const row = run("diagnostic", {}, "0.2.0");
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveForRecovery",
    ).mockResolvedValue([row]);
    const terminal = vi.spyOn(
      AsyncRunsRepository.prototype,
      "reconcileActiveToTerminal",
    );
    const invalidDirect = {
      ...jobFor(row, "active"),
      data: {
        ...jobFor(row, "active").data,
        contractVersion: "2026-07-18",
      },
    };
    const validLegacy = jobFor(row, "active", "legacy-valid-job");
    const findJobs = vi.fn(async () => [
      validLegacy,
      invalidDirect,
      validLegacy,
    ]);

    await reconcileActiveRuns(
      contextWithBoss({
        getJobById: vi.fn(async () => invalidDirect),
        findJobs,
      }),
      {
        now: new Date("2026-07-19T12:00:00.000Z"),
        missingAfterMs: 1,
      },
    );

    expect(findJobs).toHaveBeenCalledTimes(1);
    expect(terminal).not.toHaveBeenCalled();
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

    const firstStop = loop.stop();
    const secondStop = loop.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid cadence and reports a startup sweep failure safely", async () => {
    expect(() =>
      startRunRecoveryLoop(context(), { intervalMs: 0 }),
    ).toThrow(/interval must be a positive integer/i);

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

  it("aborts a stuck sweep, caches stop, and schedules no later work", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const reconcile = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>(() => {
          receivedSignal = signal;
        }),
    );
    const loop = startRunRecoveryLoop(context(), {
      intervalMs: 60_000,
      sweepTimeoutMs: 60_000,
      stopTimeoutMs: 50,
      reconcile,
    });
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    expect(receivedSignal?.aborted).toBe(false);

    const firstStop = loop.stop();
    const secondStop = loop.stop();
    expect(secondStop).toBe(firstStop);
    expect(receivedSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    await expect(firstStop).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("does not layer another sweep over a driver operation that outlives its deadline", async () => {
    vi.useFakeTimers();
    let settleFirst!: () => void;
    const firstSweep = new Promise<void>((resolve) => {
      settleFirst = resolve;
    });
    const reconcile = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockReturnValueOnce(firstSweep)
      .mockResolvedValue(undefined);
    const loop = startRunRecoveryLoop(context(), {
      intervalMs: 100,
      sweepTimeoutMs: 50,
      stopTimeoutMs: 25,
      reconcile,
    });

    const firstRun = loop.runNow();
    let abortError: unknown;
    const observed = firstRun.catch((error: unknown) => {
      abortError = error;
      throw error;
    });
    const rejected = expect(observed).rejects.toMatchObject({
      code: "RUN_RECOVERY_ABORTED",
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(isRunRecoveryAbortError(abortError)).toBe(true);
    expect(isRunRecoveryAbortError(new Error("not an abort"))).toBe(false);
    expect(
      isRunRecoveryAbortError(
        new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error("hostile prototype");
            },
          },
        ),
      ),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(reconcile).toHaveBeenCalledTimes(1);

    settleFirst();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(reconcile).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it("starts no later DB query after stop even when the current query settles after DB end", async () => {
    vi.useFakeTimers();
    let settleScrub!: (count: number) => void;
    const scrub = vi
      .spyOn(OAuthIntentsRepository.prototype, "scrubExpired")
      .mockReturnValue(
        new Promise<number>((resolve) => {
          settleScrub = resolve;
        }),
      );
    const prune = vi.spyOn(
      IdempotencyRepository.prototype,
      "pruneExpired",
    );
    const listActive = vi.spyOn(
      AsyncRunsRepository.prototype,
      "listActiveForRecovery",
    );
    let databaseEnded = false;
    const loop = startRunRecoveryLoop(context(), {
      intervalMs: 60_000,
      sweepTimeoutMs: 60_000,
      stopTimeoutMs: 50,
    });
    await vi.waitFor(() => expect(scrub).toHaveBeenCalledTimes(1));

    await loop.stop();
    databaseEnded = true;
    settleScrub(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(databaseEnded).toBe(true);
    expect(prune).not.toHaveBeenCalled();
    expect(listActive).not.toHaveBeenCalled();
  });
});

function run(
  kind: string,
  requestPayload: Record<string, unknown>,
  contractVersion = "2026-07-18",
): AsyncRunRow {
  return {
    id: PAYLOAD.runId,
    workspace_id: PAYLOAD.workspaceId,
    project_id: PAYLOAD.projectId,
    kind,
    status: "running",
    active_key: "fixture",
    contract_version: contractVersion,
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
      contractVersion: row.contract_version,
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
      findingSummariesEnabled: true,
      logger,
    },
    lines,
  };
}
