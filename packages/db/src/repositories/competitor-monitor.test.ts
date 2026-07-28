import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  CompetitorMonitorRepository,
  addCalendarMonthUtc,
} from "./competitor-monitor.ts";

class FakeExecutor {
  readonly calls: string[] = [];
  readonly results: unknown[] = [];

  enqueue(...rows: unknown[]): void {
    this.results.push(...rows);
  }

  async execute(query: unknown): Promise<unknown> {
    this.calls.push(new PgDialect().sqlToQuery(query as never).sql);
    return this.results.shift() ?? { rows: [] };
  }
}

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
};

describe("CompetitorMonitorRepository", () => {
  it("uses UTC calendar-month cadence rather than a fabricated 30-day duration", () => {
    expect(addCalendarMonthUtc("2026-01-31T12:00:00.000Z")).toBe(
      "2026-02-28T12:00:00.000Z",
    );
    expect(addCalendarMonthUtc("2024-01-31T12:00:00.000Z")).toBe(
      "2024-02-29T12:00:00.000Z",
    );
    expect(addCalendarMonthUtc("2026-07-28T00:00:00.000Z")).toBe(
      "2026-08-28T00:00:00.000Z",
    );
  });

  it("uses CAS when creating or updating monthly settings", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          enabled: true,
          frequency: "monthly",
          revision: 1,
          updated_at: "2026-07-28T00:00:00.000Z",
        },
      ],
    });
    const result = await new CompetitorMonitorRepository(
      db as never,
    ).saveSettings(scope, "10000000-0000-4000-8000-000000000003", {
      expectedRevision: 0,
      enabled: true,
      frequency: "monthly",
    });

    expect(result?.revision).toBe(1);
    expect(db.calls[0]).toMatch(/on conflict[\s\S]*where[\s\S]*revision/iu);
    expect(db.calls[0]).toMatch(/archived_at is null/iu);
  });

  it("lists only due approved competitors with explicit content or SERP scope", async () => {
    const db = new FakeExecutor();
    db.enqueue({ rows: [] });
    await new CompetitorMonitorRepository(db as never).listDuePlans({
      now: "2026-07-28T00:00:00.000Z",
      limit: 20,
    });

    expect(db.calls[0]).toMatch(/review_status = 'approved'/iu);
    expect(db.calls[0]).toMatch(/'content' = any/iu);
    expect(db.calls[0]).toMatch(/'serp_visibility' = any/iu);
    expect(db.calls[0]).toMatch(/cardinality\(site\.market_codes\) = 1/iu);
    expect(db.calls[0]).toMatch(/cardinality\(site\.language_codes\) = 1/iu);
    expect(db.calls[0]).toMatch(/connection\.site_id = site\.id/iu);
    expect(db.calls[0]).toMatch(/topic_model_revisions[\s\S]*status = 'confirmed'/iu);
    expect(db.calls[0]).toMatch(/source_connections[\s\S]*provider = 'dataforseo'/iu);
    expect(db.calls[0]).toMatch(
      /latest_attempt\.id = evaluation\.monitor_run_id[\s\S]*interval '1 month'/iu,
    );
    expect(db.calls[0]).toMatch(
      /latest_attempt\.created_at \+ interval '24 hours'/iu,
    );
    expect(db.calls[0]).not.toMatch(
      /previous_monitor_run_id[\s\S]*select monitor_run_id/iu,
    );
  });

  it("keeps the last evaluated collection while exposing the real retry or monthly due time", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          competitor_id: "10000000-0000-4000-8000-000000000003",
          domain: "competitor.example",
          name: "Competitor",
          relationship: "direct",
          analysis_scopes: ["content"],
          monitor_run_id: "10000000-0000-4000-8000-000000000004",
          run_status: "failed",
          evaluation_state: null,
          last_collection_at: "2026-06-28T00:00:00.000Z",
          next_collection_at: "2026-07-29T00:00:00.000Z",
          evaluation_limitation: null,
        },
      ],
    });

    const rows = await new CompetitorMonitorRepository(
      db as never,
    ).listLibraryRows(scope);
    expect(rows[0]).toMatchObject({
      last_collection_at: "2026-06-28T00:00:00.000Z",
      next_collection_at: "2026-07-29T00:00:00.000Z",
    });
    expect(db.calls[0]).toMatch(
      /coalesce\([\s\S]*historical\.evaluated_at/iu,
    );
    expect(db.calls[0]).toMatch(
      /evaluation\.evaluated_at \+ interval '1 month'/iu,
    );
    expect(db.calls[0]).toMatch(
      /monitor\.created_at \+ interval '24 hours'/iu,
    );
  });

  it("loads rank facts only from canonical DataForSEO snapshot observations", async () => {
    const db = new FakeExecutor();
    db.enqueue({ rows: [] });
    await new CompetitorMonitorRepository(db as never).listSnapshotRankFacts(
      scope,
      "10000000-0000-4000-8000-000000000004",
    );

    expect(db.calls[0]).toMatch(/dataforseo\.ranked_keywords\.v1/iu);
    expect(db.calls[0]).toMatch(/metric_key = 'csv\.keyword_gap\.v1'/iu);
    expect(db.calls[0]).toMatch(/availability = 'available'/iu);
    expect(db.calls[0]).toMatch(/value_json ->> 'keyword'/iu);
    expect(db.calls[0]).toMatch(/value_json ->> 'currentRank'/iu);
  });

  it("loads only current confirmed keyword assignments in the frozen market and language", async () => {
    const db = new FakeExecutor();
    db.enqueue({ rows: [] });
    await new CompetitorMonitorRepository(
      db as never,
    ).listConfirmedTopicKeywords(scope, 4, "US", "en-US");

    expect(db.calls[0]).toMatch(/decision\.review_state = 'confirmed'/iu);
    expect(db.calls[0]).toMatch(
      /keyword\.mapping_revision = decision\.governance_revision/iu,
    );
    expect(db.calls[0]).toMatch(/keyword\.market =/iu);
    expect(db.calls[0]).toMatch(/keyword\.language_tag =/iu);
    expect(db.calls[0]).toMatch(/not exists[\s\S]*newer\.governance_revision/iu);
    expect(db.calls[0]).not.toMatch(/decision\.mapping_review_state/iu);
  });

  it("rejects alternative writers that try to persist more than 100 signals for one monthly run", async () => {
    const db = new FakeExecutor();
    const repository = new CompetitorMonitorRepository(db as never);
    const signals = Array.from({ length: 101 }, (_, index) => ({
      id: `12000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      kind: "rank_gain" as const,
      topicNodeId: "12000000-0000-4000-8000-000000000201",
      keywordEntityId: "12000000-0000-4000-8000-000000000202",
      contentUrl: null,
      matchedKeywordIds: null,
      overlapRatio: null,
      previousRank: 20,
      currentRank: 10,
      improvement: 10,
      limitation: null,
    }));

    await expect(
      repository.insertEvaluation({
        run: {
          id: "12000000-0000-4000-8000-000000000203",
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          competitor_id: "12000000-0000-4000-8000-000000000204",
          analysis_scopes: ["serp_visibility"],
          topic_model_revision: 1,
          target_domain: "competitor.example",
          market: "US",
          language_tag: "en-US",
          previous_monitor_run_id:
            "12000000-0000-4000-8000-000000000205",
          previous_snapshot_id:
            "12000000-0000-4000-8000-000000000206",
        },
        snapshotId: "12000000-0000-4000-8000-000000000207",
        state: "available",
        limitation: null,
        evaluatedAt: "2026-07-28T00:00:00.000Z",
        signals,
      }),
    ).rejects.toThrow(/100/u);
  });

  it("bounds each historical run to 100 signals while returning its full row count", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          id: "12000000-0000-4000-8000-000000000301",
          competitor_id: "12000000-0000-4000-8000-000000000302",
          monitor_run_id: "12000000-0000-4000-8000-000000000303",
          signal_kind: "rank_gain",
          topic_node_id: "12000000-0000-4000-8000-000000000304",
          topic_label: "Customer onboarding",
          keyword_entity_id: "12000000-0000-4000-8000-000000000305",
          keyword: "customer onboarding automation",
          content_url: null,
          matched_keyword_ids: null,
          overlap_ratio: null,
          previous_rank: 13,
          current_rank: 7,
          improvement: 6,
          previous_snapshot_id: "12000000-0000-4000-8000-000000000306",
          current_snapshot_id: "12000000-0000-4000-8000-000000000307",
          limitation: null,
          detected_at: "2026-07-28T00:00:00.000Z",
          run_signal_count: 101,
        },
      ],
    });

    const rows = await new CompetitorMonitorRepository(db as never).listSignals(
      scope,
      ["12000000-0000-4000-8000-000000000303"],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.run_signal_count).toBe(101);
    expect(db.calls[0]).toMatch(/count\(\*\) over/iu);
    expect(db.calls[0]).toMatch(
      /row_number\(\) over[\s\S]*partition by signal\.monitor_run_id/iu,
    );
    expect(db.calls[0]).toMatch(/where signal_ordinal <=/iu);
  });

  it("loads immutable snapshot metadata without treating missing facts as zero", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          id: "10000000-0000-4000-8000-000000000004",
          captured_at: "2026-07-28T00:00:00.000Z",
          availability: "partial",
        },
      ],
    });
    const row = await new CompetitorMonitorRepository(
      db as never,
    ).findSnapshotMetadata(
      scope,
      "10000000-0000-4000-8000-000000000004",
    );

    expect(row).toEqual({
      id: "10000000-0000-4000-8000-000000000004",
      captured_at: "2026-07-28T00:00:00.000Z",
      availability: "partial",
    });
    expect(db.calls[0]).toMatch(/data_snapshots/iu);
  });

  it("treats DataForSEO as available only when the primary site has ranked_keywords authority", async () => {
    const db = new FakeExecutor();
    db.enqueue({
      rows: [
        {
          site_id: "10000000-0000-4000-8000-000000000004",
          market_codes: ["US"],
          language_codes: ["en-US"],
          topic_model_revision: 4,
          source_available: true,
        },
      ],
    });

    const row = await new CompetitorMonitorRepository(db as never).readContext(scope);

    expect(row).toEqual({
      site_id: "10000000-0000-4000-8000-000000000004",
      market_codes: ["US"],
      language_codes: ["en-US"],
      topic_model_revision: 4,
      source_available: true,
    });
    expect(db.calls[0]).toMatch(/source\.site_id = site\.id/iu);
  });
});
