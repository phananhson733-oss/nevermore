import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MeasurementTargetKeywordRankIntegrityError,
  MeasurementTargetKeywordRanksRepository,
  MeasurementWindowsRepository,
} from "@sf/db";

const { getProjectMeasurementTargetKeywordRanks } = await import(
  "./measurement-keyword-ranks.ts"
);

const IDS = {
  workspace: "d4000000-0000-4000-8000-000000000001",
  project: "d4000000-0000-4000-8000-000000000002",
  window: "d4000000-0000-4000-8000-000000000003",
  site: "d4000000-0000-4000-8000-000000000004",
  page: "d4000000-0000-4000-8000-000000000005",
  action: "d4000000-0000-4000-8000-000000000006",
  artifact: "d4000000-0000-4000-8000-000000000007",
  artifactRevision: "d4000000-0000-4000-8000-000000000008",
  attempt: "d4000000-0000-4000-8000-000000000009",
  change: "d4000000-0000-4000-8000-00000000000a",
  delivery: "d4000000-0000-4000-8000-000000000013",
  keyword: "d4000000-0000-4000-8000-00000000000b",
  topic: "d4000000-0000-4000-8000-00000000000c",
  baselineOccurrence: "d4000000-0000-4000-8000-00000000000d",
  baselineSnapshot: "d4000000-0000-4000-8000-00000000000e",
  baselineObservation: "d4000000-0000-4000-8000-00000000000f",
  outcomeOccurrence: "d4000000-0000-4000-8000-000000000010",
  outcomeSnapshot: "d4000000-0000-4000-8000-000000000011",
  outcomeObservation: "d4000000-0000-4000-8000-000000000012",
} as const;

const scope = { workspaceId: IDS.workspace };
const canonicalUrl =
  "https://example.com/customer-onboarding/";
const beforeWindow = {
  startAt: "2026-05-01T00:00:00.000Z",
  endAt: "2026-05-29T00:00:00.000Z",
};
const afterWindow = {
  startAt: "2026-06-29T00:00:00.000Z",
  endAt: "2026-07-27T00:00:00.000Z",
};

function measurementWindow() {
  return {
    measurementWindowId: IDS.window,
    projectId: IDS.project,
    siteId: IDS.site,
    target: {
      kind: "url" as const,
      targetRef: "/customer-onboarding/",
      sitePageId: IDS.page,
    },
    actionId: IDS.action,
    artifactId: IDS.artifact,
    artifactRevisionId: IDS.artifactRevision,
    artifactRevision: 1,
    artifactContentHash: "a".repeat(64),
    publicationAttemptId: IDS.attempt,
    verifiedChangeReceipt: {
      id: IDS.change,
      providerKind: "github" as const,
      providerRequestId: "github-request-42",
      remoteScopeRef: "installation:42/repository:org/repo",
      remoteObjectId: "merge-42",
      remoteRevision: "merge-sha",
      deliveryUrl: "https://github.com/org/repo/pull/42",
      artifactContentHash: "a".repeat(64),
      contentChecksum: "a".repeat(64),
      remoteFacts: { repository: "org/repo", mergedPullRequest: 42 },
      observedAt: "2026-06-01T00:00:00.000Z",
      receiptKind: "change_receipt" as const,
      predecessorDeliveryReceiptId: IDS.delivery,
      remoteObjectKind: "github_merge" as const,
      liveCanonicalUrl: canonicalUrl,
      verificationState: "verified_live" as const,
      evidenceRefs: ["evidence://github/merge/42"],
      limitation: null,
    },
    timelineDeliveryReceipt: null,
    beforeWindow,
    afterWindow,
    timezone: "UTC",
    url: canonicalUrl,
    canonicalUrl,
    interpretation: "observational_non_causal" as const,
    state: "observed" as const,
    technicalVerificationRef: null,
    limitation: null,
    dimensions: {} as never,
    recordedAt: "2026-07-27T00:00:00.000Z",
  };
}

function observation(
  phase: "baseline" | "outcome",
  value: number,
) {
  return {
    occurrenceId:
      phase === "baseline"
        ? IDS.baselineOccurrence
        : IDS.outcomeOccurrence,
    snapshotId:
      phase === "baseline"
        ? IDS.baselineSnapshot
        : IDS.outcomeSnapshot,
    observationId:
      phase === "baseline"
        ? IDS.baselineObservation
        : IDS.outcomeObservation,
    value,
    observedAt:
      phase === "baseline"
        ? "2026-05-20T00:00:00.000Z"
        : "2026-07-20T00:00:00.000Z",
    limitation:
      "DataForSEO does not expose a provider data-as-of timestamp.",
  };
}

function authority(
  observations = [
    observation("baseline", 12),
    observation("outcome", 7),
  ],
) {
  return {
    sitePageId: IDS.page,
    canonicalUrl,
    topicModelRevision: 3,
    keywords: [
      {
        keywordId: IDS.keyword,
        displayKeyword: "Customer Onboarding Automation",
        normalizedKeyword: "customer onboarding automation",
        marketCode: "US",
        languageTag: "en-US",
        topicNodeId: IDS.topic,
        topicLabel: "Customer onboarding",
        topicModelRevision: 3,
        observations,
      },
    ],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("getProjectMeasurementTargetKeywordRanks", () => {
  it("compares the latest real absolute rank in each server-owned window", async () => {
    vi.spyOn(
      MeasurementWindowsRepository.prototype,
      "findById",
    ).mockResolvedValue(measurementWindow());
    const read = vi
      .spyOn(
        MeasurementTargetKeywordRanksRepository.prototype,
        "readForMeasuredPage",
      )
      .mockResolvedValue(
        authority([
          observation("baseline", 14),
          observation("baseline", 12),
          observation("outcome", 7),
        ]),
      );

    await expect(
      getProjectMeasurementTargetKeywordRanks(
        scope,
        IDS.project,
        IDS.window,
        {} as never,
        new Date("2026-07-27T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      projectId: IDS.project,
      measurementWindowId: IDS.window,
      sitePageId: IDS.page,
      interpretation:
        "dataforseo_absolute_rank_observational_non_causal",
      keywords: [
        {
          keywordId: IDS.keyword,
          state: "observed",
          baselineObservation: {
            provider: "dataforseo",
            metric: "absolute_rank",
            value: 12,
          },
          outcomeObservation: { value: 7 },
          rankImprovement: 5,
          trend: "improved",
        },
      ],
      coverage: { availability: "available" },
    });
    expect(read).toHaveBeenCalledWith(
      {
        workspaceId: IDS.workspace,
        projectId: IDS.project,
      },
      {
        sitePageId: IDS.page,
        canonicalUrl,
        beforeWindow,
        afterWindow,
      },
    );
  });

  it("keeps a one-sided comparison insufficient instead of treating missing rank as zero", async () => {
    vi.spyOn(
      MeasurementWindowsRepository.prototype,
      "findById",
    ).mockResolvedValue(measurementWindow());
    vi.spyOn(
      MeasurementTargetKeywordRanksRepository.prototype,
      "readForMeasuredPage",
    ).mockResolvedValue(authority([observation("baseline", 12)]));

    const result =
      await getProjectMeasurementTargetKeywordRanks(
        scope,
        IDS.project,
        IDS.window,
        {} as never,
        new Date("2026-07-27T12:00:00.000Z"),
      );
    expect(result.keywords[0]).toMatchObject({
      state: "insufficient_data",
      baselineObservation: { value: 12 },
      outcomeObservation: null,
      rankImprovement: null,
      trend: "unavailable",
    });
    expect(result.coverage.availability).toBe("unavailable");
  });

  it("returns explicit unavailable coverage when no confirmed targets exist", async () => {
    vi.spyOn(
      MeasurementWindowsRepository.prototype,
      "findById",
    ).mockResolvedValue(measurementWindow());
    vi.spyOn(
      MeasurementTargetKeywordRanksRepository.prototype,
      "readForMeasuredPage",
    ).mockResolvedValue({
      sitePageId: IDS.page,
      canonicalUrl,
      topicModelRevision: 3,
      keywords: [],
    });

    await expect(
      getProjectMeasurementTargetKeywordRanks(
        scope,
        IDS.project,
        IDS.window,
        {} as never,
        new Date("2026-07-27T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      keywords: [],
      coverage: {
        availability: "unavailable",
        limitations: [
          "No confirmed target Keywords are mapped to this exact page.",
        ],
      },
    });
  });

  it("does not enumerate a missing or foreign Measurement Window", async () => {
    vi.spyOn(
      MeasurementWindowsRepository.prototype,
      "findById",
    ).mockResolvedValue(null);

    await expect(
      getProjectMeasurementTargetKeywordRanks(
        scope,
        IDS.project,
        IDS.window,
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("maps corrupt canonical rank lineage to a stable dependency error", async () => {
    vi.spyOn(
      MeasurementWindowsRepository.prototype,
      "findById",
    ).mockResolvedValue(measurementWindow());
    vi.spyOn(
      MeasurementTargetKeywordRanksRepository.prototype,
      "readForMeasuredPage",
    ).mockRejectedValue(
      new MeasurementTargetKeywordRankIntegrityError(
        "RANK_LINEAGE_INVALID",
      ),
    );

    await expect(
      getProjectMeasurementTargetKeywordRanks(
        scope,
        IDS.project,
        IDS.window,
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });
});
