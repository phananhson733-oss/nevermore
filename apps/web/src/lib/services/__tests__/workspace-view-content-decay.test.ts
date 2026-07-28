import { ContentDecayMonitorRepository } from "@sf/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOverviewContentDecayMonitor } from "@/lib/services/workspace-view";

const scope = {
  workspaceId: "92000000-0000-4000-8000-000000000001",
  projectId: "92000000-0000-4000-8000-000000000002",
};
const siteId = "92000000-0000-4000-8000-000000000003";
const tx = { role: "repeatable-read read-only transaction" };
const page = {
  sitePageId: "92000000-0000-4000-8000-000000000004",
  normalizedUrl: "https://example.com/blog/retention",
};

const checkpoints = [
  {
    snapshotId: "92000000-0000-4000-8000-000000000011",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: "92000000-0000-4000-8000-000000000021",
    provider: "gsc",
    datasetKey: "gsc.page_query_daily.v1",
    methodVersion: "gsc.page_query_daily.v1",
    availability: "available",
    capturedAt: "2026-04-29T08:00:00.000Z",
    sourceWindow: { start: "2026-03-02", end: "2026-04-26" },
    providerTimeZone: "UTC",
  },
  {
    snapshotId: "92000000-0000-4000-8000-000000000012",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: "92000000-0000-4000-8000-000000000021",
    provider: "gsc",
    datasetKey: "gsc.page_query_daily.v1",
    methodVersion: "gsc.page_query_daily.v1",
    availability: "available",
    capturedAt: "2026-05-29T08:00:00.000Z",
    sourceWindow: { start: "2026-04-01", end: "2026-05-26" },
    providerTimeZone: "UTC",
  },
  {
    snapshotId: "92000000-0000-4000-8000-000000000013",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: "92000000-0000-4000-8000-000000000021",
    provider: "gsc",
    datasetKey: "gsc.page_query_daily.v1",
    methodVersion: "gsc.page_query_daily.v1",
    availability: "available",
    capturedAt: "2026-06-29T08:00:00.000Z",
    sourceWindow: { start: "2026-05-02", end: "2026-06-26" },
    providerTimeZone: "UTC",
  },
] as const;

function observation(
  checkpoint: (typeof checkpoints)[number],
  index: number,
  clicks: number,
  position: number,
) {
  return {
    observationId: `92000000-0000-4000-8000-${(100 + index)
      .toString()
      .padStart(12, "0")}`,
    snapshotId: checkpoint.snapshotId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    sitePageId: page.sitePageId,
    normalizedUrl: page.normalizedUrl,
    subjectRef: page.normalizedUrl,
    provider: "gsc",
    metricKey: "gsc.page.v1",
    availability: "available",
    observedAt: checkpoint.capturedAt,
    current28d: { clicks, impressions: 1_000, position },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadOverviewContentDecayMonitor", () => {
  it("projects only frozen Growth Map pages through the reusable monthly decision boundary", async () => {
    vi.spyOn(
      ContentDecayMonitorRepository.prototype,
      "listMonthlyCheckpoints",
    ).mockResolvedValue([...checkpoints]);
    vi.spyOn(
      ContentDecayMonitorRepository.prototype,
      "listPageObservations",
    ).mockResolvedValue([
      observation(checkpoints[0], 1, 500, 8),
      observation(checkpoints[1], 2, 450, 13.1),
      observation(checkpoints[2], 3, 300, 18.2),
    ]);

    const result = await loadOverviewContentDecayMonitor(
      tx as never,
      scope,
      {
        siteId,
        pages: [page],
      },
      "2026-06-30T00:00:00.000Z",
    );

    expect(result.status).toBe("available");
    expect(result.alerts).toEqual([
      expect.objectContaining({
        sitePageId: page.sitePageId,
        normalizedUrl: page.normalizedUrl,
        triggers: ["rank_decline", "traffic_decline"],
      }),
    ]);
    expect(
      ContentDecayMonitorRepository.prototype.listPageObservations,
    ).toHaveBeenCalledWith(
      scope,
      checkpoints.map((checkpoint) => checkpoint.snapshotId),
      [page.sitePageId],
    );
    expect(
      vi.mocked(
        ContentDecayMonitorRepository.prototype.listMonthlyCheckpoints,
      ).mock.contexts[0],
    ).toMatchObject({ exec: tx });
  });

  it("returns honest unavailable state without querying GSC when no frozen URL authority exists", async () => {
    const checkpointsSpy = vi.spyOn(
      ContentDecayMonitorRepository.prototype,
      "listMonthlyCheckpoints",
    );
    const observationsSpy = vi.spyOn(
      ContentDecayMonitorRepository.prototype,
      "listPageObservations",
    );

    const result = await loadOverviewContentDecayMonitor(
      tx as never,
      scope,
      { siteId: null, pages: [] },
      "2026-06-30T00:00:00.000Z",
    );

    expect(result.status).toBe("unavailable");
    expect(result.alerts).toEqual([]);
    expect(checkpointsSpy).not.toHaveBeenCalled();
    expect(observationsSpy).not.toHaveBeenCalled();
  });

  it("batches URL observations at the repository bound and still returns at most three alerts", async () => {
    const pages = Array.from({ length: 101 }, (_, index) => ({
      sitePageId: `92000000-0000-4000-8000-${(1_000 + index)
        .toString()
        .padStart(12, "0")}`,
      normalizedUrl: `https://example.com/blog/${index}`,
    }));
    vi.spyOn(
      ContentDecayMonitorRepository.prototype,
      "listMonthlyCheckpoints",
    ).mockResolvedValue([...checkpoints]);
    const observationSpy = vi
      .spyOn(
        ContentDecayMonitorRepository.prototype,
        "listPageObservations",
      )
      .mockImplementation(async (_scope, snapshotIds, pageIds) =>
        pageIds.flatMap((sitePageId, pageIndex) => {
          const normalizedUrl =
            pages.find((candidate) => candidate.sitePageId === sitePageId)
              ?.normalizedUrl ?? "";
          return snapshotIds.map((snapshotId, checkpointIndex) => ({
            observationId: `93000000-0000-4000-8000-${(
              pageIndex * 10 +
              checkpointIndex +
              1
            )
              .toString()
              .padStart(12, "0")}`,
            snapshotId,
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            sitePageId,
            normalizedUrl,
            subjectRef: normalizedUrl,
            provider: "gsc",
            metricKey: "gsc.page.v1",
            availability: "available",
            observedAt: checkpoints[checkpointIndex]!.capturedAt,
            current28d: {
              clicks: [100, 70, 40][checkpointIndex]!,
              impressions: 1_000,
              position: [5, 11, 17][checkpointIndex]!,
            },
          }));
        }),
      );

    const result = await loadOverviewContentDecayMonitor(
      tx as never,
      scope,
      { siteId, pages },
      "2026-06-30T00:00:00.000Z",
    );

    expect(observationSpy).toHaveBeenCalledTimes(2);
    expect(observationSpy.mock.calls[0]?.[2]).toHaveLength(100);
    expect(observationSpy.mock.calls[1]?.[2]).toHaveLength(1);
    expect(result.alerts).toHaveLength(3);
  });
});
