import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitorMonitorRepository } from "@sf/db";
import { ProblemError } from "@sf/observability";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const {
  getProjectAuditCompetitorMonitor,
  updateProjectAuditCompetitorMonitor,
} = await import("./growth-map-competitor-monitor.ts");

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  site: "10000000-0000-4000-8000-000000000004",
  competitor: "10000000-0000-4000-8000-000000000005",
  run: "10000000-0000-4000-8000-000000000006",
  signal: "10000000-0000-4000-8000-000000000007",
  topic: "10000000-0000-4000-8000-000000000008",
  keyword: "10000000-0000-4000-8000-000000000009",
  previousSnapshot: "10000000-0000-4000-8000-000000000010",
  snapshot: "10000000-0000-4000-8000-000000000011",
} as const;

const scope = { workspaceId: ids.workspace };
const now = new Date("2026-07-28T00:00:00.000Z");

function context(overrides: Record<string, unknown> = {}) {
  return vi
    .spyOn(CompetitorMonitorRepository.prototype, "readContext")
    .mockResolvedValue({
      site_id: ids.site,
      market_codes: ["US"],
      language_codes: ["en-US"],
      topic_model_revision: 4,
      source_available: true,
      ...overrides,
    } as never);
}

function config(overrides: Record<string, unknown> = {}) {
  return vi
    .spyOn(CompetitorMonitorRepository.prototype, "findSettings")
    .mockResolvedValue({
      enabled: true,
      frequency: "monthly",
      revision: 2,
      updated_at: now.toISOString(),
      ...overrides,
    } as never);
}

function library(overrides: Record<string, unknown> = {}) {
  return vi
    .spyOn(CompetitorMonitorRepository.prototype, "listLibraryRows")
    .mockResolvedValue([
      {
        competitor_id: ids.competitor,
        domain: "competitor.example",
        name: "Competitor",
        relationship: "direct",
        analysis_scopes: ["content", "serp_visibility"],
        monitor_run_id: ids.run,
        run_status: "completed",
        evaluation_state: "available",
        last_collection_at: now.toISOString(),
        next_collection_at: "2026-08-28T00:00:00.000Z",
        evaluation_limitation: null,
        ...overrides,
      },
    ] as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getDb.mockReset();
});

describe("Growth Map competitor monitor service", () => {
  it("returns unavailable for multi-market context without choosing the first value", async () => {
    context({ market_codes: ["US", "GB"] });
    config();
    const list = vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "listLibraryRows",
    );

    const result = await getProjectAuditCompetitorMonitor(
      scope,
      ids.project,
      {} as never,
      now,
    );

    expect(result).toMatchObject({
      availability: "unavailable",
      scope: null,
      competitors: [],
    });
    expect(result.limitation).toMatch(/唯一/u);
    expect(list).not.toHaveBeenCalled();
  });

  it("keeps an approved competitor unavailable when the internal DataForSEO source is missing", async () => {
    context({ source_available: false });
    config();
    library({
      monitor_run_id: null,
      run_status: null,
      evaluation_state: null,
      last_collection_at: null,
      next_collection_at: null,
    });
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "listSignals",
    ).mockResolvedValue([]);

    const result = await getProjectAuditCompetitorMonitor(
      scope,
      ids.project,
      {} as never,
      now,
    );

    expect(result.competitors[0]).toMatchObject({
      eligibility: "eligible",
      collectionState: "unavailable",
      evaluationState: "unavailable",
      lastCollectionAt: null,
      nextCollectionAt: null,
      recentSignals: [],
    });
    expect(result.competitors[0]?.limitation).toMatch(/DataForSEO/u);
  });

  it("projects real rank evidence into the existing competitor-library opportunity update basis", async () => {
    context();
    config();
    library();
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "listSignals",
    ).mockResolvedValue([
      {
        id: ids.signal,
        competitor_id: ids.competitor,
        monitor_run_id: ids.run,
        signal_kind: "rank_gain",
        topic_node_id: ids.topic,
        topic_label: "Customer onboarding",
        keyword_entity_id: ids.keyword,
        keyword: "customer onboarding automation",
        content_url: null,
        matched_keyword_ids: null,
        overlap_ratio: null,
        previous_rank: 13,
        current_rank: 7,
        improvement: 6,
        previous_snapshot_id: ids.previousSnapshot,
        current_snapshot_id: ids.snapshot,
        limitation: null,
        detected_at: now.toISOString(),
        run_signal_count: 1,
      },
    ]);

    const result = await getProjectAuditCompetitorMonitor(
      scope,
      ids.project,
      {} as never,
      now,
    );

    expect(result.competitors[0]).toMatchObject({
      collectionState: "collected",
      evaluationState: "available",
      nextCollectionAt: "2026-08-28T00:00:00.000Z",
      recentSignals: [
        {
          kind: "rank_gain",
          improvement: 6,
          opportunityUpdate: {
            state: "ready",
            growthMapSection: "competitor_library",
            sourceRef: `competitor_monitor_signal:${ids.signal}`,
          },
        },
      ],
    });
  });

  it("marks legacy evaluations as partial when more than 100 signals existed", async () => {
    context();
    config();
    library();
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "listSignals",
    ).mockResolvedValue([
      {
        id: ids.signal,
        competitor_id: ids.competitor,
        monitor_run_id: ids.run,
        signal_kind: "rank_gain",
        topic_node_id: ids.topic,
        topic_label: "Customer onboarding",
        keyword_entity_id: ids.keyword,
        keyword: "customer onboarding automation",
        content_url: null,
        matched_keyword_ids: null,
        overlap_ratio: null,
        previous_rank: 13,
        current_rank: 7,
        improvement: 6,
        previous_snapshot_id: ids.previousSnapshot,
        current_snapshot_id: ids.snapshot,
        limitation: null,
        detected_at: now.toISOString(),
        run_signal_count: 101,
      },
    ]);

    const result = await getProjectAuditCompetitorMonitor(
      scope,
      ids.project,
      {} as never,
      now,
    );

    expect(result.competitors[0]).toMatchObject({
      evaluationState: "available",
      recentSignals: [{ signalId: ids.signal }],
    });
    expect(result.competitors[0]?.limitation).toMatch(/100/u);
  });

  it("does not expose old signals when the latest evaluation is baseline or unavailable", async () => {
    context();
    config();
    library({
      evaluation_state: "baseline",
      evaluation_limitation: "首次采集仅建立 baseline。",
    });
    const listSignals = vi
      .spyOn(CompetitorMonitorRepository.prototype, "listSignals")
      .mockResolvedValue([]);

    const result = await getProjectAuditCompetitorMonitor(
      scope,
      ids.project,
      {} as never,
      now,
    );
    expect(result.competitors[0]).toMatchObject({
      evaluationState: "baseline",
      recentSignals: [],
    });
    expect(listSignals).not.toHaveBeenCalled();
  });

  it("keeps the last real collection and exposes the actual retry time after a failed attempt", async () => {
    context();
    config();
    library({
      run_status: "failed",
      evaluation_state: null,
      last_collection_at: "2026-06-28T00:00:00.000Z",
      next_collection_at: "2026-07-29T00:00:00.000Z",
      evaluation_limitation: null,
    });
    const listSignals = vi
      .spyOn(CompetitorMonitorRepository.prototype, "listSignals")
      .mockResolvedValue([]);

    const result = await getProjectAuditCompetitorMonitor(
      scope,
      ids.project,
      {} as never,
      now,
    );
    expect(result.competitors[0]).toMatchObject({
      collectionState: "unavailable",
      evaluationState: "unavailable",
      lastCollectionAt: "2026-06-28T00:00:00.000Z",
      nextCollectionAt: "2026-07-29T00:00:00.000Z",
      recentSignals: [],
    });
    expect(listSignals).not.toHaveBeenCalled();
  });

  it("maps a stale settings revision to an explicit 409 instead of a generic failure", async () => {
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "saveSettings",
    ).mockResolvedValue(null);
    vi.spyOn(
      CompetitorMonitorRepository.prototype,
      "findSettings",
    ).mockResolvedValue({
      enabled: true,
      frequency: "monthly",
      revision: 4,
      updated_at: now.toISOString(),
    });

    await expect(
      updateProjectAuditCompetitorMonitor(
        scope,
        ids.project,
        ids.actor,
        {
          expectedRevision: 3,
          enabled: true,
          frequency: "monthly",
        },
        {} as never,
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProblemError &&
        error.code === "VERSION_CONFLICT" &&
        error.status === 409,
    );
  });
});
