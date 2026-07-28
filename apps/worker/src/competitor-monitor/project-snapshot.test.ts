import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitorMonitorRepository } from "@sf/db";

import { projectCompetitorMonitorSnapshot } from "./project-snapshot.ts";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  competitor: "10000000-0000-4000-8000-000000000003",
  run: "10000000-0000-4000-8000-000000000004",
  previousRun: "10000000-0000-4000-8000-000000000005",
  currentSnapshot: "10000000-0000-4000-8000-000000000006",
  previousSnapshot: "10000000-0000-4000-8000-000000000007",
  topic: "10000000-0000-4000-8000-000000000008",
  keyword: "10000000-0000-4000-8000-000000000009",
  signal: "10000000-0000-4000-8000-000000000010",
} as const;

const scope = { workspaceId: ids.workspace, projectId: ids.project };
const run = {
  id: ids.run,
  workspace_id: ids.workspace,
  project_id: ids.project,
  competitor_id: ids.competitor,
  analysis_scopes: ["serp_visibility"],
  topic_model_revision: 4,
  target_domain: "competitor.example",
  market: "US",
  language_tag: "en-US",
  previous_monitor_run_id: ids.previousRun,
  previous_snapshot_id: ids.previousSnapshot,
} as const;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("projectCompetitorMonitorSnapshot", () => {
  it("leaves ordinary customer collections on the existing projection path", async () => {
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "findMonitorRun",
    ).mockResolvedValue(null);
    const insert = vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "insertEvaluation",
    );

    const result = await projectCompetitorMonitorSnapshot(
      {} as never,
      scope,
      ids.run,
      ids.currentSnapshot,
    );

    expect(result).toEqual({ isCompetitorMonitor: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("uses the first real snapshot only as baseline", async () => {
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "findMonitorRun",
    ).mockResolvedValue({
      ...run,
      previous_monitor_run_id: null,
      previous_snapshot_id: null,
    });
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "findSnapshotMetadata",
    ).mockResolvedValue({
      id: ids.currentSnapshot,
      captured_at: "2026-07-28T00:00:00.000Z",
      availability: "available",
    });
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "listSnapshotRankFacts",
    ).mockResolvedValue([]);
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "listConfirmedTopicKeywords",
    ).mockResolvedValue([]);
    const insert = vi
      .spyOn(
        CompetitorMonitorRepository.prototype,
        "insertEvaluation",
      )
      .mockResolvedValue();

    const result = await projectCompetitorMonitorSnapshot(
      {} as never,
      scope,
      ids.run,
      ids.currentSnapshot,
    );

    expect(result).toEqual({
      isCompetitorMonitor: true,
      evaluationState: "baseline",
      signalCount: 0,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "baseline",
        snapshotId: ids.currentSnapshot,
        signals: [],
      }),
    );
  });

  it("compares two canonical snapshots and persists only a scoped rank gain", async () => {
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "findMonitorRun",
    ).mockResolvedValue(run);
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "findSnapshotMetadata",
    )
      .mockResolvedValueOnce({
        id: ids.currentSnapshot,
        captured_at: "2026-07-28T00:00:00.000Z",
        availability: "available",
      })
      .mockResolvedValueOnce({
        id: ids.previousSnapshot,
        captured_at: "2026-06-28T00:00:00.000Z",
        availability: "available",
      });
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "listSnapshotRankFacts",
    )
      .mockResolvedValueOnce([
        {
          normalized_keyword: "customer onboarding automation",
          current_rank: 7,
          current_url: "https://competitor.example/new",
        },
      ])
      .mockResolvedValueOnce([
        {
          normalized_keyword: "customer onboarding automation",
          current_rank: 13,
          current_url: "https://competitor.example/old",
        },
      ]);
    const topics = vi
      .spyOn(
        CompetitorMonitorRepository.prototype,
        "listConfirmedTopicKeywords",
      )
      .mockResolvedValue([
        {
          topic_node_id: ids.topic,
          topic_label: "Customer onboarding",
          keyword_entity_id: ids.keyword,
          display_keyword: "customer onboarding automation",
          normalized_keyword: "customer onboarding automation",
        },
      ]);
    const insert = vi
      .spyOn(
        CompetitorMonitorRepository.prototype,
        "insertEvaluation",
      )
      .mockResolvedValue();

    const result = await projectCompetitorMonitorSnapshot(
      {} as never,
      scope,
      ids.run,
      ids.currentSnapshot,
      {
        now: () => "2026-07-28T00:01:00.000Z",
        idFactory: () => ids.signal,
      },
    );

    expect(topics).toHaveBeenCalledWith(scope, 4, "US", "en-US");
    expect(result).toEqual({
      isCompetitorMonitor: true,
      evaluationState: "available",
      signalCount: 1,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "available",
        evaluatedAt: "2026-07-28T00:01:00.000Z",
        signals: [
          expect.objectContaining({
            id: ids.signal,
            kind: "rank_gain",
            keywordEntityId: ids.keyword,
            improvement: 6,
          }),
        ],
      }),
    );
  });

  it("records an unavailable snapshot as unavailable without fabricating facts", async () => {
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "findMonitorRun",
    ).mockResolvedValue(run);
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "findSnapshotMetadata",
    ).mockResolvedValue({
      id: ids.currentSnapshot,
      captured_at: "2026-07-28T00:00:00.000Z",
      availability: "unavailable",
    });
    const facts = vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "listSnapshotRankFacts",
    );
    const insert = vi
      .spyOn(
        CompetitorMonitorRepository.prototype,
        "insertEvaluation",
      )
      .mockResolvedValue();

    const result = await projectCompetitorMonitorSnapshot(
      {} as never,
      scope,
      ids.run,
      ids.currentSnapshot,
    );

    expect(result).toEqual({
      isCompetitorMonitor: true,
      evaluationState: "unavailable",
      signalCount: 0,
    });
    expect(facts).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "unavailable",
        limitation: expect.stringMatching(/不可用/u),
        signals: [],
      }),
    );
  });
});
