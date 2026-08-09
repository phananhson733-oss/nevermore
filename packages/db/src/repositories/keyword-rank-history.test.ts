import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  KeywordRankHistoryIntegrityError,
  KeywordRankHistoryRepository,
  MAX_KEYWORD_RANK_HISTORY_POINTS,
} from "./keyword-rank-history.ts";

interface Call {
  readonly statement: unknown;
}

function fixtureExecutor() {
  const calls: Call[] = [];
  const results: unknown[][] = [];
  const executor = {
    execute(statement: unknown) {
      calls.push({ statement });
      return Promise.resolve({ rows: results.shift() ?? [] });
    },
  };
  return {
    executor: executor as never,
    enqueue(rows: unknown[]) {
      results.push(rows);
    },
    lastSql() {
      const call = calls.at(-1);
      if (!call) throw new Error("No SQL call was recorded.");
      return new PgDialect().sqlToQuery(call.statement as never);
    },
  };
}

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  keyword: "10000000-0000-4000-8000-000000000003",
  occurrenceA: "10000000-0000-4000-8000-000000000004",
  occurrenceB: "10000000-0000-4000-8000-000000000005",
  snapshotA: "10000000-0000-4000-8000-000000000006",
  snapshotB: "10000000-0000-4000-8000-000000000007",
  observationA: "10000000-0000-4000-8000-000000000008",
  observationB: "10000000-0000-4000-8000-000000000009",
  page: "10000000-0000-4000-8000-000000000010",
  site: "10000000-0000-4000-8000-000000000011",
  receipt: "10000000-0000-4000-8000-000000000012",
  attempt: "10000000-0000-4000-8000-000000000013",
  artifact: "10000000-0000-4000-8000-000000000014",
} as const;

const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};
const window = {
  startedAt: "2026-04-28T12:00:00.000Z",
  endedAt: "2026-07-27T12:00:00.000Z",
};

function dataForSeoRow(overrides: Record<string, unknown> = {}) {
  return {
    occurrence_id: ids.occurrenceA,
    snapshot_id: ids.snapshotA,
    observation_id: ids.observationA,
    workspace_id: ids.workspace,
    project_id: ids.project,
    normalized_keyword: "customer onboarding software",
    occurrence_normalized_keyword: "customer onboarding software",
    source_kind: "dataforseo_ranked",
    source_pointer: "/valueJson/keyword",
    provider_data_as_of: null,
    snapshot_provider: "dataforseo",
    dataset_key: "dataforseo.ranked_keywords.v1",
    snapshot_schema_version: "dataforseo.ranked_keywords.v1",
    snapshot_method_version: "dataforseo.ranked_keywords.v1",
    collection_provider: "dataforseo",
    collection_operation: "keyword_gap_import",
    collection_method_version: "dataforseo.ranked_keywords.v1",
    snapshot_availability: "available",
    provider: "dataforseo",
    metric_key: "csv.keyword_gap.v1",
    observed_at: "2026-06-01T12:00:00.000Z",
    availability: "available",
    value_json: {
      keyword: "Customer Onboarding Software",
      currentRank: 12,
    },
    grade: "B",
    limitation:
      "DataForSEO does not return a provider data-as-of timestamp.",
    ...overrides,
  };
}

function gscRow(overrides: Record<string, unknown> = {}) {
  return {
    occurrence_id: ids.occurrenceB,
    snapshot_id: ids.snapshotB,
    observation_id: ids.observationB,
    workspace_id: ids.workspace,
    project_id: ids.project,
    normalized_keyword: "customer onboarding software",
    occurrence_normalized_keyword: "customer onboarding software",
    source_kind: "gsc_top_query",
    source_pointer: "/valueJson/topQueries/0/query",
    provider_data_as_of: "2026-06-30T23:59:59.000Z",
    snapshot_provider: "gsc",
    dataset_key: "gsc.page_query_daily.v1",
    snapshot_schema_version: "gsc.page_query_daily.v1",
    snapshot_method_version: "gsc.page_query_daily.v1",
    collection_provider: "gsc",
    collection_operation: "search_analytics",
    collection_method_version: "gsc.page_query_daily.v1",
    snapshot_availability: "available",
    provider: "gsc",
    metric_key: "gsc.page.v1",
    observed_at: "2026-07-01T12:00:00.000Z",
    availability: "available",
    value_json: {
      topQueries: [
        {
          query: "Customer Onboarding Software",
          position: 9.4,
        },
      ],
    },
    grade: "A",
    limitation:
      "GSC position is an impression-weighted 28-day average.",
    ...overrides,
  };
}

function changeRow(overrides: Record<string, unknown> = {}) {
  return {
    change_receipt_id: ids.receipt,
    publication_attempt_id: ids.attempt,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    attempt_kind: "publish",
    artifact_id: ids.artifact,
    artifact_revision: 2,
    target_ref: "/blog/customer-onboarding/",
    live_canonical_url:
      "https://example.com/blog/customer-onboarding/",
    verification_state: "verified_live",
    limitation: null,
    changed_at: "2026-06-15T12:00:00.000Z",
    page_id: ids.page,
    page_url: "https://example.com/blog/customer-onboarding/",
    ...overrides,
  };
}

describe("KeywordRankHistoryRepository", () => {
  it("loads one bounded immutable time series and keeps provider metrics distinct", async () => {
    const db = fixtureExecutor();
    db.enqueue([dataForSeoRow(), gscRow()]);
    const repository = new KeywordRankHistoryRepository(db.executor);

    await expect(
      repository.listRankObservations(scope, ids.keyword, window),
    ).resolves.toEqual([
      expect.objectContaining({
        provider: "dataforseo",
        metric: "absolute_rank",
        value: 12,
        valuePointer: "/valueJson/currentRank",
        grade: "B",
      }),
      expect.objectContaining({
        provider: "gsc",
        metric: "gsc_28d_average_position",
        value: 9.4,
        valuePointer: "/valueJson/topQueries/0/position",
        grade: "A",
      }),
    ]);

    const query = db.lastSql();
    expect(query.sql).toContain('from "app"."keyword_entity_sources"');
    expect(query.sql).toContain(
      'inner join "app"."normalized_observations"',
    );
    expect(query.sql).toContain('inner join "app"."data_snapshots"');
    expect(query.sql).toContain('inner join "app"."collection_runs"');
    expect(query.sql).toContain(
      "in (\n          'dataforseo_ranked',\n          'gsc_top_query'",
    );
    expect(query.sql).toContain(
      'order by\n        "app"."normalized_observations"."observed_at" asc',
    );
    expect(query.params).toContain(scope.workspaceId);
    expect(query.params).toContain(scope.projectId);
    expect(query.params).toContain(ids.keyword);
  });

  it("accepts ranked-keyword facts from the exact composite search-landscape lineage", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      dataForSeoRow({
        dataset_key: "dataforseo.search_landscape.v1",
        snapshot_schema_version: "dataforseo.search_landscape.v1",
        snapshot_method_version: "dataforseo.search_landscape.v1",
        collection_operation: "search_landscape",
        collection_method_version: "dataforseo.search_landscape.v1",
      }),
    ]);

    await expect(
      new KeywordRankHistoryRepository(db.executor).listRankObservations(
        scope,
        ids.keyword,
        window,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        provider: "dataforseo",
        metric: "absolute_rank",
        value: 12,
        valuePointer: "/valueJson/currentRank",
      }),
    ]);
  });

  it("accepts ranked-keyword facts from the exact v2 search-landscape lineage", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      dataForSeoRow({
        dataset_key: "dataforseo.search_landscape.v2",
        snapshot_schema_version: "dataforseo.search_landscape.v2",
        snapshot_method_version: "dataforseo.search_landscape.v2",
        collection_operation: "search_landscape",
        collection_method_version: "dataforseo.search_landscape.v2",
      }),
    ]);

    await expect(
      new KeywordRankHistoryRepository(db.executor).listRankObservations(
        scope,
        ids.keyword,
        window,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        provider: "dataforseo",
        metric: "absolute_rank",
        value: 12,
        valuePointer: "/valueJson/currentRank",
      }),
    ]);
  });

  it("accepts ranked-keyword facts from the exact v3 search-landscape lineage", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      dataForSeoRow({
        dataset_key: "dataforseo.search_landscape.v3",
        snapshot_schema_version: "dataforseo.search_landscape.v3",
        snapshot_method_version: "dataforseo.search_landscape.v3",
        collection_operation: "search_landscape",
        collection_method_version: "dataforseo.search_landscape.v3",
      }),
    ]);

    await expect(
      new KeywordRankHistoryRepository(db.executor).listRankObservations(
        scope,
        ids.keyword,
        window,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        provider: "dataforseo",
        metric: "absolute_rank",
        value: 12,
      }),
    ]);
  });

  it.each([
    {
      drift: "legacy dataset with composite operation",
      overrides: {
        collection_operation: "search_landscape",
        collection_method_version: "dataforseo.search_landscape.v1",
      },
    },
    {
      drift: "composite dataset with legacy operation",
      overrides: {
        dataset_key: "dataforseo.search_landscape.v1",
        snapshot_schema_version: "dataforseo.search_landscape.v1",
        snapshot_method_version: "dataforseo.search_landscape.v1",
      },
    },
    {
      drift: "composite dataset with legacy Snapshot method",
      overrides: {
        dataset_key: "dataforseo.search_landscape.v1",
        snapshot_schema_version: "dataforseo.search_landscape.v1",
        collection_operation: "search_landscape",
        collection_method_version: "dataforseo.search_landscape.v1",
      },
    },
  ])("fails closed on $drift", async ({ overrides }) => {
    const db = fixtureExecutor();
    db.enqueue([dataForSeoRow(overrides)]);

    await expect(
      new KeywordRankHistoryRepository(db.executor).listRankObservations(
        scope,
        ids.keyword,
        window,
      ),
    ).rejects.toMatchObject({
      code: "OBSERVATION_LINEAGE_INVALID",
    });
  });

  it("omits honest null rank values without inventing zero", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      dataForSeoRow({
        value_json: {
          keyword: "Customer Onboarding Software",
          currentRank: null,
        },
      }),
      gscRow({
        value_json: {
          topQueries: [
            {
              query: "Customer Onboarding Software",
              position: null,
            },
          ],
        },
      }),
    ]);

    await expect(
      new KeywordRankHistoryRepository(db.executor).listRankObservations(
        scope,
        ids.keyword,
        window,
      ),
    ).resolves.toEqual([]);
  });

  it("fails closed on provider, query, or Observation lineage drift", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      gscRow({
        value_json: {
          topQueries: [{ query: "Another query", position: 9.4 }],
        },
      }),
    ]);

    await expect(
      new KeywordRankHistoryRepository(db.executor).listRankObservations(
        scope,
        ids.keyword,
        window,
      ),
    ).rejects.toBeInstanceOf(KeywordRankHistoryIntegrityError);
  });

  it("rejects duplicate canonical Observation value pointers", async () => {
    const db = fixtureExecutor();
    db.enqueue([dataForSeoRow(), dataForSeoRow()]);

    await expect(
      new KeywordRankHistoryRepository(db.executor).listRankObservations(
        scope,
        ids.keyword,
        window,
      ),
    ).rejects.toMatchObject({
      code: "OBSERVATION_IDENTITY_DUPLICATE",
    });
  });

  it("fails closed instead of silently truncating a 90-day history", async () => {
    const db = fixtureExecutor();
    db.enqueue(
      Array.from(
        { length: MAX_KEYWORD_RANK_HISTORY_POINTS + 1 },
        (_, index) =>
          dataForSeoRow({
            occurrence_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          }),
      ),
    );

    await expect(
      new KeywordRankHistoryRepository(db.executor).listRankObservations(
        scope,
        ids.keyword,
        window,
      ),
    ).rejects.toMatchObject({ code: "HISTORY_LIMIT_EXCEEDED" });
  });

  it("loads only verified Change Receipts for the exact canonical mapped page", async () => {
    const db = fixtureExecutor();
    db.enqueue([changeRow()]);
    const repository = new KeywordRankHistoryRepository(db.executor);

    await expect(
      repository.listContentChanges(scope, {
        ...window,
        sitePageId: ids.page,
        normalizedUrl:
          "https://example.com/blog/customer-onboarding/",
      }),
    ).resolves.toEqual([
      {
        changeReceiptId: ids.receipt,
        publicationAttemptId: ids.attempt,
        attemptKind: "publish",
        artifactId: ids.artifact,
        artifactRevision: 2,
        targetRef: "/blog/customer-onboarding/",
        liveCanonicalUrl:
          "https://example.com/blog/customer-onboarding/",
        changedAt: "2026-06-15T12:00:00.000Z",
      },
    ]);

    const query = db.lastSql();
    expect(query.sql).toContain(
      "\"receipt_kind\" = 'change_receipt'",
    );
    expect(query.sql).toContain(
      "\"verification_state\" = 'verified_live'",
    );
    expect(query.params).toContain(ids.page);
    expect(query.params).toContain(
      "https://example.com/blog/customer-onboarding/",
    );
    expect(query.params).toContain("/blog/customer-onboarding/");
  });

  it("rejects unavailable or unverified rows as content-change markers", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      changeRow({
        verification_state: "pending",
        limitation: "Provider verification has not completed.",
      }),
    ]);

    await expect(
      new KeywordRankHistoryRepository(db.executor).listContentChanges(
        scope,
        {
          ...window,
          sitePageId: ids.page,
          normalizedUrl:
            "https://example.com/blog/customer-onboarding/",
        },
      ),
    ).rejects.toMatchObject({
      code: "CHANGE_MARKER_LINEAGE_INVALID",
    });
  });

  it("rejects a verified receipt whose live canonical URL is a different page", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      changeRow({
        live_canonical_url:
          "https://example.com/blog/a-different-page/",
      }),
    ]);

    await expect(
      new KeywordRankHistoryRepository(db.executor).listContentChanges(
        scope,
        {
          ...window,
          sitePageId: ids.page,
          normalizedUrl:
            "https://example.com/blog/customer-onboarding/",
        },
      ),
    ).rejects.toMatchObject({
      code: "CHANGE_MARKER_LINEAGE_INVALID",
    });
  });
});
