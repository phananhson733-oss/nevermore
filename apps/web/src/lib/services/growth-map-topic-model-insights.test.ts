import {
  TopicModelInsightsConflictError,
  TopicModelInsightsIntegrityError,
  TopicModelInsightsRepository,
} from "@sf/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getProjectAuditTopicModelInsights } = await import(
  "./growth-map-topic-model-insights"
);

const ids = {
  workspace: "95000000-0000-4000-8000-000000000001",
  project: "95000000-0000-4000-8000-000000000002",
  node: "95000000-0000-4000-8000-000000000003",
} as const;
const scope = { workspaceId: ids.workspace };
const now = new Date("2026-07-28T06:00:00.000Z");

function node(overrides: Record<string, unknown> = {}) {
  return {
    topicNodeId: ids.node,
    topicModelRevision: 4,
    label: "Customer Onboarding",
    keywordCount: 3,
    approvedKeywordCount: 2,
    reviewPendingKeywordCount: 1,
    existingPageKeywordCount: 2,
    newAssetKeywordCount: 1,
    unassignedKeywordCount: 0,
    mappedPageCount: 2,
    conflictingIntentCount: 0,
    ...overrides,
  };
}

function confirmed(overrides: Record<string, unknown> = {}) {
  return {
    state: "confirmed",
    projectId: ids.project,
    topicModelRevision: 4,
    nodes: [node()],
    nonExcludedKeywordCount: 3,
    unassignedTopicKeywordCount: 0,
    orphanAssignmentCount: 0,
    invalidatedAssignmentCount: 0,
    ...overrides,
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Growth Map Topic Model insights service", () => {
  it("projects current node counts and deterministic content coverage from confirmed authority", async () => {
    const readLatestConfirmed = vi
      .spyOn(
        TopicModelInsightsRepository.prototype,
        "readLatestConfirmed",
      )
      .mockResolvedValue(confirmed() as never);

    const result = await getProjectAuditTopicModelInsights(
      scope,
      ids.project,
      {} as never,
      now,
    );

    expect(readLatestConfirmed).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      projectId: ids.project,
    });
    expect(result).toMatchObject({
      projectId: ids.project,
      topicModelRevision: 4,
      nodes: [
        {
          topicNodeId: ids.node,
          keywordCount: 3,
          approvedKeywordCount: 2,
          reviewPendingKeywordCount: 1,
          existingPageKeywordCount: 2,
          newAssetKeywordCount: 1,
          mappedPageCount: 2,
          coverageState: "partial",
          limitation: expect.stringMatching(/内容覆盖不完整/u),
        },
      ],
      coverage: { availability: "available", limitations: [] },
      generatedAt: now.toISOString(),
    });
  });

  it("marks confirmed-intent multi-page evidence as an SEO cannibalization conflict", async () => {
    vi.spyOn(
      TopicModelInsightsRepository.prototype,
      "readLatestConfirmed",
    ).mockResolvedValue(
      confirmed({
        nodes: [
          node({
            reviewPendingKeywordCount: 0,
            existingPageKeywordCount: 3,
            newAssetKeywordCount: 0,
            mappedPageCount: 2,
            conflictingIntentCount: 1,
          }),
        ],
      }) as never,
    );

    const result = await getProjectAuditTopicModelInsights(
      scope,
      ids.project,
      {} as never,
      now,
    );

    expect(result.nodes[0]).toMatchObject({
      coverageState: "conflict",
      conflictingIntentCount: 1,
      limitation: expect.stringMatching(/SEO cannibalization/u),
    });
  });

  it("returns unavailable without fabricating nodes when no confirmed model exists", async () => {
    vi.spyOn(
      TopicModelInsightsRepository.prototype,
      "readLatestConfirmed",
    ).mockResolvedValue({
      state: "no_confirmed_model",
      projectId: ids.project,
    });

    const result = await getProjectAuditTopicModelInsights(
      scope,
      ids.project,
      {} as never,
      now,
    );

    expect(result).toEqual({
      projectId: ids.project,
      topicModelRevision: null,
      nodes: [],
      coverage: {
        availability: "unavailable",
        limitations: [
          "当前项目尚无已确认的 Topic Model，因此无法生成关键词与内容覆盖分析。",
        ],
      },
      generatedAt: now.toISOString(),
    });
  });

  it("reports orphaned, unassigned, and invalidated assignments as partial coverage", async () => {
    vi.spyOn(
      TopicModelInsightsRepository.prototype,
      "readLatestConfirmed",
    ).mockResolvedValue(
      confirmed({
        nonExcludedKeywordCount: 6,
        unassignedTopicKeywordCount: 1,
        orphanAssignmentCount: 1,
        invalidatedAssignmentCount: 1,
      }) as never,
    );

    const result = await getProjectAuditTopicModelInsights(
      scope,
      ids.project,
      {} as never,
      now,
    );

    expect(result.coverage).toMatchObject({
      availability: "partial",
      limitations: [
        expect.stringMatching(/尚未分配/u),
        expect.stringMatching(/已失效、缺失或未来版本/u),
        expect.stringMatching(/拆分、合并或删除/u),
      ],
    });
  });

  it("maps missing projects and authority corruption to stable problems", async () => {
    const read = vi.spyOn(
      TopicModelInsightsRepository.prototype,
      "readLatestConfirmed",
    );
    read.mockRejectedValueOnce(
      new TopicModelInsightsConflictError("PROJECT_NOT_FOUND"),
    );
    await expect(
      getProjectAuditTopicModelInsights(
        scope,
        ids.project,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    read.mockRejectedValueOnce(
      new TopicModelInsightsIntegrityError(
        "KEYWORD_AUTHORITY_DIVERGED",
      ),
    );
    await expect(
      getProjectAuditTopicModelInsights(
        scope,
        ids.project,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("fails closed when repository facts cannot satisfy the public contract", async () => {
    vi.spyOn(
      TopicModelInsightsRepository.prototype,
      "readLatestConfirmed",
    ).mockResolvedValue(
      confirmed({
        nodes: [node({ existingPageKeywordCount: 99 })],
      }) as never,
    );

    await expect(
      getProjectAuditTopicModelInsights(
        scope,
        ids.project,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("uses one repeatable-read, read-only transaction in production", async () => {
    const sentinel = new Error("stop before repository read");
    const transaction = vi.fn(
      async (
        callback: (tx: unknown) => Promise<unknown>,
        options: Record<string, unknown>,
      ) => {
        expect(callback).toEqual(expect.any(Function));
        expect(options).toEqual({
          isolationLevel: "repeatable read",
          accessMode: "read only",
        });
        throw sentinel;
      },
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });

    await expect(
      getProjectAuditTopicModelInsights(
        scope,
        ids.project,
        undefined,
        now,
      ),
    ).rejects.toBe(sentinel);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid injected clock before database access", async () => {
    await expect(
      getProjectAuditTopicModelInsights(
        scope,
        ids.project,
        undefined,
        new Date(Number.NaN),
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
