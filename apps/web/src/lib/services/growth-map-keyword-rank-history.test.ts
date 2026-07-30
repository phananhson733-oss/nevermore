import {
  KeywordRankHistoryIntegrityError,
  KeywordRankHistoryRepository,
} from "@sf/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getProjectAuditKeyword: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("./growth-map-keywords", () => ({
  getProjectAuditKeyword: mocks.getProjectAuditKeyword,
}));

const { getProjectAuditKeywordRankHistory } = await import(
  "./growth-map-keyword-rank-history"
);

const ids = {
  workspace: "91000000-0000-4000-8000-000000000001",
  project: "91000000-0000-4000-8000-000000000002",
  keyword: "91000000-0000-4000-8000-000000000003",
  page: "91000000-0000-4000-8000-000000000004",
  occurrenceA: "91000000-0000-4000-8000-000000000005",
  occurrenceB: "91000000-0000-4000-8000-000000000006",
  snapshotA: "91000000-0000-4000-8000-000000000007",
  snapshotB: "91000000-0000-4000-8000-000000000008",
  observationA: "91000000-0000-4000-8000-000000000009",
  observationB: "91000000-0000-4000-8000-000000000010",
  changeReceipt: "91000000-0000-4000-8000-000000000011",
  publicationAttempt: "91000000-0000-4000-8000-000000000012",
  artifact: "91000000-0000-4000-8000-000000000013",
} as const;

const scope = { workspaceId: ids.workspace };
const normalizedUrl = "https://example.com/blog/onboarding/";
const now = new Date("2026-07-28T12:34:56.789Z");
const startedAt = "2026-04-29T12:34:56.789Z";

function keywordDetail(
  mappedTarget:
    | {
        kind: "existing_page";
        sitePageId: string;
        normalizedUrl: string;
      }
    | { kind: "unassigned" } = {
    kind: "existing_page",
    sitePageId: ids.page,
    normalizedUrl,
  },
) {
  return {
    projectId: ids.project,
    data: {
      projectId: ids.project,
      keywordId: ids.keyword,
      mappedTarget,
    },
  };
}

function rankFacts() {
  return [
    {
      occurrenceId: ids.occurrenceA,
      snapshotId: ids.snapshotA,
      observationId: ids.observationA,
      provider: "dataforseo" as const,
      metric: "absolute_rank" as const,
      value: 12,
      valuePointer: "/valueJson/currentRank",
      observedAt: "2026-06-01T12:00:00.000Z",
      providerDataAsOf: null,
      grade: "B" as const,
      limitation:
        "DataForSEO exposes an absolute observed rank but no provider data-as-of timestamp.",
    },
    {
      occurrenceId: ids.occurrenceB,
      snapshotId: ids.snapshotB,
      observationId: ids.observationB,
      provider: "gsc" as const,
      metric: "gsc_28d_average_position" as const,
      value: 9.4,
      valuePointer: "/valueJson/topQueries/0/position",
      observedAt: "2026-07-01T12:00:00.000Z",
      providerDataAsOf: "2026-06-30T23:59:59.000Z",
      grade: "A" as const,
      limitation:
        "GSC position is an impression-weighted 28-day average, not an absolute SERP rank.",
    },
  ];
}

function marker(liveCanonicalUrl = normalizedUrl) {
  return {
    changeReceiptId: ids.changeReceipt,
    publicationAttemptId: ids.publicationAttempt,
    attemptKind: "publish" as const,
    artifactId: ids.artifact,
    artifactRevision: 2,
    targetRef: "/blog/onboarding/",
    liveCanonicalUrl,
    changedAt: "2026-06-15T12:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditKeyword.mockResolvedValue(keywordDetail());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Growth Map Keyword rank-history read service", () => {
  it("keeps DataForSEO absolute rank and GSC 28-day average in separate series", async () => {
    const listRankObservations = vi
      .spyOn(
        KeywordRankHistoryRepository.prototype,
        "listRankObservations",
      )
      .mockResolvedValue(rankFacts());
    const listContentChanges = vi
      .spyOn(
        KeywordRankHistoryRepository.prototype,
        "listContentChanges",
      )
      .mockResolvedValue([marker()]);
    const exec = {} as never;

    const result = await getProjectAuditKeywordRankHistory(
      scope,
      ids.project,
      ids.keyword,
      exec,
      now,
    );

    expect(mocks.getProjectAuditKeyword).toHaveBeenCalledWith(
      scope,
      ids.project,
      ids.keyword,
      null,
      exec,
    );
    expect(listRankObservations).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.keyword,
      { startedAt, endedAt: now.toISOString() },
    );
    expect(listContentChanges).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      {
        startedAt,
        endedAt: now.toISOString(),
        sitePageId: ids.page,
        normalizedUrl,
      },
    );
    expect(result).toMatchObject({
      projectId: ids.project,
      keywordId: ids.keyword,
      window: {
        startedAt,
        endedAt: now.toISOString(),
        days: 90,
      },
      series: [
        { provider: "dataforseo", metric: "absolute_rank" },
        {
          provider: "gsc",
          metric: "gsc_28d_average_position",
        },
      ],
      changeMarkers: [marker()],
      coverage: { availability: "partial" },
      generatedAt: now.toISOString(),
    });
  });

  it("does not query Change Receipts when governance has no canonical existing page", async () => {
    mocks.getProjectAuditKeyword.mockResolvedValueOnce(
      keywordDetail({ kind: "unassigned" }),
    );
    vi.spyOn(
      KeywordRankHistoryRepository.prototype,
      "listRankObservations",
    ).mockResolvedValue(rankFacts());
    const listContentChanges = vi.spyOn(
      KeywordRankHistoryRepository.prototype,
      "listContentChanges",
    );

    const result = await getProjectAuditKeywordRankHistory(
      scope,
      ids.project,
      ids.keyword,
      {} as never,
      now,
    );

    expect(result.mappedPage).toBeNull();
    expect(result.changeMarkers).toEqual([]);
    expect(result.coverage).toMatchObject({
      availability: "partial",
      limitations: expect.arrayContaining([
        expect.stringMatching(/not mapped.*canonical existing page/i),
      ]),
    });
    expect(listContentChanges).not.toHaveBeenCalled();
  });

  it("reports honest unavailable coverage instead of projecting missing rank as zero", async () => {
    vi.spyOn(
      KeywordRankHistoryRepository.prototype,
      "listRankObservations",
    ).mockResolvedValue([]);
    vi.spyOn(
      KeywordRankHistoryRepository.prototype,
      "listContentChanges",
    ).mockResolvedValue([]);

    const result = await getProjectAuditKeywordRankHistory(
      scope,
      ids.project,
      ids.keyword,
      {} as never,
      now,
    );

    expect(result.series).toEqual([]);
    expect(result.coverage).toEqual({
      availability: "unavailable",
      limitations: [
        "No canonical rank observations are available in the exact trailing 90-day UTC window.",
      ],
    });
  });

  it("fails closed when a Change Receipt resolves to a different live canonical page", async () => {
    vi.spyOn(
      KeywordRankHistoryRepository.prototype,
      "listRankObservations",
    ).mockResolvedValue(rankFacts());
    vi.spyOn(
      KeywordRankHistoryRepository.prototype,
      "listContentChanges",
    ).mockResolvedValue([
      marker("https://example.com/customer-private-page/"),
    ]);

    await expect(
      getProjectAuditKeywordRankHistory(
        scope,
        ids.project,
        ids.keyword,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("maps repository lineage failures to a stable dependency problem", async () => {
    vi.spyOn(
      KeywordRankHistoryRepository.prototype,
      "listRankObservations",
    ).mockRejectedValue(
      new KeywordRankHistoryIntegrityError(
        "OBSERVATION_LINEAGE_INVALID",
      ),
    );

    await expect(
      getProjectAuditKeywordRankHistory(
        scope,
        ids.project,
        ids.keyword,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("fails before repository access when detail scope does not match the selected Keyword", async () => {
    mocks.getProjectAuditKeyword.mockResolvedValueOnce({
      ...keywordDetail(),
      projectId: "91000000-0000-4000-8000-000000000099",
    });
    const listRankObservations = vi.spyOn(
      KeywordRankHistoryRepository.prototype,
      "listRankObservations",
    );

    await expect(
      getProjectAuditKeywordRankHistory(
        scope,
        ids.project,
        ids.keyword,
        {} as never,
        now,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
    expect(listRankObservations).not.toHaveBeenCalled();
  });

  it("uses one repeatable-read, read-only transaction in production", async () => {
    const sentinel = new Error("stop before repository reads");
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
      getProjectAuditKeywordRankHistory(
        scope,
        ids.project,
        ids.keyword,
        undefined,
        now,
      ),
    ).rejects.toBe(sentinel);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid injected clock before opening a transaction", async () => {
    await expect(
      getProjectAuditKeywordRankHistory(
        scope,
        ids.project,
        ids.keyword,
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
