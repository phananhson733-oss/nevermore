import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  CompetitorMonitorRepository,
  contentHash,
} from "@sf/db";
import { CONTRACT_VERSION } from "@sf/contracts";

import {
  runCompetitorMonitorSchedulingSweep,
  startCompetitorMonitorSchedulerLoop,
} from "./scheduler.ts";

const plan = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
  siteId: "10000000-0000-4000-8000-000000000003",
  sourceConnectionId: "10000000-0000-4000-8000-000000000004",
  actorId: "10000000-0000-4000-8000-000000000005",
  competitorId: "10000000-0000-4000-8000-000000000006",
  domain: "competitor.example",
  analysisScopes: ["content", "serp_visibility"],
  settingsRevision: 3,
  topicModelRevision: 4,
  market: "US",
  languageTag: "en-US",
  scheduledFor: "2026-07-28T00:00:00.000Z",
  previousMonitorRunId: null,
  previousSnapshotId: null,
} as const;

const run = {
  id: "10000000-0000-4000-8000-000000000007",
  workspace_id: plan.workspaceId,
  project_id: plan.projectId,
} as const;

function context(enabled = true) {
  return {
    dataForSeo: {
      enabled,
      login: enabled ? "provider-login" : null,
      password: enabled ? "provider-password" : null,
      maxKeywords: 200,
      maxCompetitors: 100,
    },
    db: {
      transaction: vi.fn(
        async (callback: (tx: object) => Promise<unknown>) => callback({}),
      ),
    },
    boss: {},
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
  } as never;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(
    CompetitorMonitorRepository.prototype,
    "listDuePlans",
  ).mockResolvedValue([plan]);
  vi.spyOn(
    AsyncRunsRepository.prototype,
    "insertQueued",
  ).mockResolvedValue(run as never);
  vi.spyOn(
    CollectionRunsRepository.prototype,
    "insertPlaceholder",
  ).mockResolvedValue({ id: run.id } as never);
  vi.spyOn(
    CompetitorMonitorRepository.prototype,
    "insertMonitorRun",
  ).mockResolvedValue();
});

describe("competitor monitor scheduler", () => {
  it("does not query or enqueue when real DataForSEO collection is unavailable", async () => {
    const ctx = context(false);
    const enqueue = vi.fn();

    await expect(
      runCompetitorMonitorSchedulingSweep(ctx, { enqueue }),
    ).resolves.toEqual({
      providerAvailable: false,
      dueCount: 0,
      scheduledCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });
    expect(
      CompetitorMonitorRepository.prototype.listDuePlans,
    ).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("atomically queues the existing DataForSEO collection with frozen competitor scope", async () => {
    const ctx = context();
    const enqueue = vi.fn(async () => "job-1");

    await expect(
      runCompetitorMonitorSchedulingSweep(ctx, {
        now: new Date("2026-07-28T00:00:00.000Z"),
        enqueue,
      }),
    ).resolves.toEqual({
      providerAvailable: true,
      dueCount: 1,
      scheduledCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });

    const collectionScope = {
      schemaVersion: "dataforseo.collection-scope.v1",
      queryKind: "ranked_keywords",
      target: "competitor.example",
      marketCode: "US",
      languageTag: "en-US",
      providerLanguageCode: "en",
      location: { kind: "name", name: "United States" },
      limit: 200,
    };
    expect(
      AsyncRunsRepository.prototype.insertQueued,
    ).toHaveBeenCalledWith({
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      kind: "collection",
      activeKey: `monitor:competitor:${plan.competitorId}`,
      initiatedBy: plan.actorId,
      contractVersion: CONTRACT_VERSION,
      requestPayload: {
        provider: "dataforseo",
        operation: "keyword_gap_import",
        sourceConnectionId: plan.sourceConnectionId,
        collectionScope,
      },
    });
    expect(
      CollectionRunsRepository.prototype.insertPlaceholder,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        siteId: plan.siteId,
        provider: "dataforseo",
        operation: "keyword_gap_import",
        methodVersion: "dataforseo.ranked_keywords.v1",
        parametersHash: contentHash({
          provider: "dataforseo",
          operation: "keyword_gap_import",
          siteId: plan.siteId,
          collectionScope,
        }),
      }),
    );
    expect(
      CompetitorMonitorRepository.prototype.insertMonitorRun,
    ).toHaveBeenCalledWith({ runId: run.id, plan });
    expect(enqueue).toHaveBeenCalledWith(
      {},
      {},
      "collect.dataforseo",
      {
        runId: run.id,
        workspaceId: plan.workspaceId,
        projectId: plan.projectId,
        contractVersion: CONTRACT_VERSION,
      },
    );
  });

  it("coalesces loop ticks and stops without waiting for the monthly cadence", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const sweep = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const loop = startCompetitorMonitorSchedulerLoop(context(), {
      intervalMs: 1_000,
      sweep,
    });

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
