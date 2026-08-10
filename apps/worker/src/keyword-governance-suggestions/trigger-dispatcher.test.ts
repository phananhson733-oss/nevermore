import {
  KeywordGovernanceScheduleRequestsRepository,
  type ClaimedKeywordGovernanceScheduleRequest,
  type ProjectScope,
} from "@sf/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "../context.ts";
import {
  dispatchKeywordGovernanceScheduleRequest,
  dispatchKeywordGovernanceScheduleRequestBySource,
  runKeywordGovernanceSuggestionTriggerDispatcherSweep,
  startKeywordGovernanceSuggestionTriggerDispatcherLoop,
} from "./trigger-dispatcher.ts";

const IDS = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  request: "10000000-0000-4000-8000-000000000004",
  claim: "10000000-0000-4000-8000-000000000005",
  run: "10000000-0000-4000-8000-000000000006",
} as const;

const scope: ProjectScope = {
  workspaceId: IDS.workspace,
  projectId: IDS.project,
};

const claimedRequest: ClaimedKeywordGovernanceScheduleRequest = {
  id: IDS.request,
  workspaceId: IDS.workspace,
  projectId: IDS.project,
  dispatchKey: `keyword-governance-schedule.v1:${IDS.workspace}:${IDS.project}:analysis_refresh:${IDS.run}`,
  sourceKind: "analysis_refresh",
  sourceRef: IDS.run,
  initiatedBy: IDS.actor,
  requestedAt: "2026-08-10T00:00:00.000Z",
  nextAttemptAt: "2026-08-10T00:00:00.000Z",
  claimToken: IDS.claim,
  claimedAt: "2026-08-10T00:01:00.000Z",
  claimExpiresAt: "2026-08-10T00:02:00.000Z",
  attemptCount: 1,
  completedAt: null,
  lastErrorCode: null,
};

function context(): WorkerContext {
  return {
    db: {},
    boss: {},
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as WorkerContext;
}

const ACK_RESULTS = [
  {
    kind: "queued",
    runId: IDS.run,
    inputHash: "a".repeat(64),
    candidateCount: 1,
    hasMore: false,
  },
  {
    kind: "exact_pending_reused",
    generationRunId: IDS.run,
    inputHash: "a".repeat(64),
    suggestionCount: 1,
  },
  { kind: "no_candidates" },
  { kind: "authority_unavailable" },
] as const;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Keyword governance durable trigger dispatcher", () => {
  it.each(ACK_RESULTS)(
    "ACKs scheduler result $kind and completes the exact lease",
    async (schedulerResult) => {
      const ctx = context();
      const schedule = vi.fn(async () => schedulerResult);
      vi.spyOn(
        KeywordGovernanceScheduleRequestsRepository.prototype,
        "claimRequest",
      ).mockResolvedValue({ kind: "claimed", request: claimedRequest });
      vi.spyOn(
        KeywordGovernanceScheduleRequestsRepository.prototype,
        "complete",
      ).mockResolvedValue({
        kind: "completed",
        request: { ...claimedRequest, claimToken: null, completedAt: "2026-08-10T00:01:01.000Z" },
      });
      const release = vi
        .spyOn(
          KeywordGovernanceScheduleRequestsRepository.prototype,
          "release",
        );

      await expect(
        dispatchKeywordGovernanceScheduleRequest(
          ctx,
          { scope, requestId: IDS.request },
          { schedule },
        ),
      ).resolves.toEqual({ kind: "completed" });

      expect(schedule).toHaveBeenCalledWith(
        { db: ctx.db, boss: ctx.boss },
        { scope, initiatedBy: IDS.actor },
      );
      expect(
        KeywordGovernanceScheduleRequestsRepository.prototype.complete,
      ).toHaveBeenCalledWith(scope, {
        requestId: IDS.request,
        claimToken: IDS.claim,
      });
      expect(release).not.toHaveBeenCalled();
    },
  );

  it("does not schedule a request owned by another live lease", async () => {
    const ctx = context();
    const schedule = vi.fn();
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "claimRequest",
    ).mockResolvedValue({ kind: "unavailable" });

    await expect(
      dispatchKeywordGovernanceScheduleRequest(
        ctx,
        { scope, requestId: IDS.request },
        { schedule },
      ),
    ).resolves.toEqual({ kind: "unavailable" });

    expect(schedule).not.toHaveBeenCalled();
  });

  it("defers an active generation by releasing the exact lease without throwing", async () => {
    const ctx = context();
    const schedule = vi.fn(async () => ({
      kind: "active" as const,
      runId: IDS.run,
    }));
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "claimRequest",
    ).mockResolvedValue({ kind: "claimed", request: claimedRequest });
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "release",
    ).mockResolvedValue({
      kind: "released",
      request: {
        ...claimedRequest,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: "2026-08-10T00:02:00.000Z",
        lastErrorCode: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
      },
    });
    const complete = vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "complete",
    );

    await expect(
      dispatchKeywordGovernanceScheduleRequest(
        ctx,
        { scope, requestId: IDS.request },
        { schedule },
      ),
    ).resolves.toEqual({ kind: "deferred" });

    expect(
      KeywordGovernanceScheduleRequestsRepository.prototype.release,
    ).toHaveBeenCalledWith(scope, {
      requestId: IDS.request,
      claimToken: IDS.claim,
      errorCode: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("claims a generation continuation by its exact durable source identity", async () => {
    const ctx = context();
    const schedule = vi.fn(async () => ({ kind: "no_candidates" as const }));
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "claimBySource",
    ).mockResolvedValue({ kind: "claimed", request: claimedRequest });
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "complete",
    ).mockResolvedValue({
      kind: "completed",
      request: {
        ...claimedRequest,
        claimToken: null,
        completedAt: "2026-08-10T00:01:01.000Z",
      },
    });

    await expect(
      dispatchKeywordGovernanceScheduleRequestBySource(
        ctx,
        {
          scope,
          sourceKind: "generation_continuation",
          sourceRef: IDS.run,
        },
        { schedule },
      ),
    ).resolves.toEqual({ kind: "completed" });

    expect(
      KeywordGovernanceScheduleRequestsRepository.prototype.claimBySource,
    ).toHaveBeenCalledWith(scope, {
      sourceKind: "generation_continuation",
      sourceRef: IDS.run,
      leaseSeconds: 60,
    });
  });

  it("does not schedule when a terminal run has no durable continuation request", async () => {
    const ctx = context();
    const schedule = vi.fn();
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "claimBySource",
    ).mockResolvedValue({ kind: "unavailable" });

    await expect(
      dispatchKeywordGovernanceScheduleRequestBySource(
        ctx,
        {
          scope,
          sourceKind: "generation_continuation",
          sourceRef: IDS.run,
        },
        { schedule },
      ),
    ).resolves.toEqual({ kind: "unavailable" });

    expect(schedule).not.toHaveBeenCalled();
  });

  it("releases the exact lease with a fixed safe code and rethrows scheduler failure", async () => {
    const ctx = context();
    const failure = new Error("queue transport contained customer secret");
    const schedule = vi.fn(async () => {
      throw failure;
    });
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "claimRequest",
    ).mockResolvedValue({ kind: "claimed", request: claimedRequest });
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "release",
    ).mockResolvedValue({
      kind: "released",
      request: {
        ...claimedRequest,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: "2026-08-10T00:02:00.000Z",
        lastErrorCode: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
      },
    });

    await expect(
      dispatchKeywordGovernanceScheduleRequest(
        ctx,
        { scope, requestId: IDS.request },
        { schedule },
      ),
    ).rejects.toBe(failure);

    expect(
      KeywordGovernanceScheduleRequestsRepository.prototype.release,
    ).toHaveBeenCalledWith(scope, {
      requestId: IDS.request,
      claimToken: IDS.claim,
      errorCode: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
    });
    expect(ctx.logger.error).toHaveBeenCalledWith(
      "keyword_governance_schedule_dispatch_failed",
      {
        code: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
        requestId: IDS.request,
        sourceKind: "analysis_refresh",
      },
    );
  });

  it("counts an active maintenance result as deferred without failure logging", async () => {
    const ctx = context();
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "claimDue",
    ).mockResolvedValue([claimedRequest]);
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "release",
    ).mockResolvedValue({
      kind: "released",
      request: {
        ...claimedRequest,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: "2026-08-10T00:02:00.000Z",
        lastErrorCode: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
      },
    });
    const complete = vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "complete",
    );

    await expect(
      runKeywordGovernanceSuggestionTriggerDispatcherSweep(ctx, {
        limit: 1,
        schedule: async () => ({ kind: "active", runId: IDS.run }),
      }),
    ).resolves.toEqual({
      claimedCount: 1,
      completedCount: 0,
      deferredCount: 1,
      releasedCount: 0,
      staleCount: 0,
    });

    expect(complete).not.toHaveBeenCalled();
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });

  it("drains one bounded leased batch and leaves failed scheduling retryable", async () => {
    const ctx = context();
    const second = {
      ...claimedRequest,
      id: "10000000-0000-4000-8000-000000000007",
      projectId: "10000000-0000-4000-8000-000000000008",
      claimToken: "10000000-0000-4000-8000-000000000009",
      sourceKind: "csv_keyword_gap_import" as const,
    };
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "claimDue",
    ).mockResolvedValue([claimedRequest, second]);
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "complete",
    ).mockResolvedValue({
      kind: "completed",
      request: { ...claimedRequest, claimToken: null, completedAt: "2026-08-10T00:01:01.000Z" },
    });
    vi.spyOn(
      KeywordGovernanceScheduleRequestsRepository.prototype,
      "release",
    ).mockResolvedValue({
      kind: "released",
      request: {
        ...second,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: "2026-08-10T00:02:00.000Z",
        lastErrorCode: "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
      },
    });
    const schedule = vi
      .fn()
      .mockResolvedValueOnce({ kind: "no_candidates" })
      .mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      runKeywordGovernanceSuggestionTriggerDispatcherSweep(ctx, {
        limit: 2,
        leaseSeconds: 30,
        schedule,
      }),
    ).resolves.toEqual({
      claimedCount: 2,
      completedCount: 1,
      deferredCount: 0,
      releasedCount: 1,
      staleCount: 0,
    });

    expect(
      KeywordGovernanceScheduleRequestsRepository.prototype.claimDue,
    ).toHaveBeenCalledWith({ limit: 2, leaseSeconds: 30 });
    expect(schedule).toHaveBeenNthCalledWith(
      2,
      { db: ctx.db, boss: ctx.boss },
      {
        scope: { workspaceId: second.workspaceId, projectId: second.projectId },
        initiatedBy: IDS.actor,
      },
    );
  });

  it("coalesces loop ticks and stops without waiting for the polling cadence", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const sweep = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const loop = startKeywordGovernanceSuggestionTriggerDispatcherLoop(
      context(),
      { intervalMs: 1_000, sweep },
    );

    expect(sweep).toHaveBeenCalledTimes(1);
    const same = loop.runNow();
    expect(sweep).toHaveBeenCalledTimes(1);
    resolve();
    await same;
    await loop.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
