import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  MAX_MEASUREMENT_KEYWORD_RANK_FACTS,
  MeasurementTargetKeywordRankIntegrityError,
  MeasurementTargetKeywordRanksRepository,
} from "./measurement-keyword-ranks.ts";

function fixtureExecutor() {
  const statements: unknown[] = [];
  const results: unknown[][] = [];
  const executor = {
    execute(statement: unknown) {
      statements.push(statement);
      return Promise.resolve({ rows: results.shift() ?? [] });
    },
  };
  return {
    executor: executor as never,
    enqueue(rows: unknown[]) {
      results.push(rows);
    },
    lastSql() {
      const statement = statements.at(-1);
      if (!statement) throw new Error("No SQL was recorded.");
      return new PgDialect().sqlToQuery(statement as never);
    },
  };
}

const IDS = {
  workspace: "d2000000-0000-4000-8000-000000000001",
  project: "d2000000-0000-4000-8000-000000000002",
  page: "d2000000-0000-4000-8000-000000000003",
  keyword: "d2000000-0000-4000-8000-000000000004",
  topic: "d2000000-0000-4000-8000-000000000005",
  occurrence: "d2000000-0000-4000-8000-000000000006",
  snapshot: "d2000000-0000-4000-8000-000000000007",
  observation: "d2000000-0000-4000-8000-000000000008",
} as const;

const scope = {
  workspaceId: IDS.workspace,
  projectId: IDS.project,
};
const input = {
  sitePageId: IDS.page,
  canonicalUrl: "https://example.com/customer-onboarding/",
  beforeWindow: {
    startAt: "2026-05-01T00:00:00.000Z",
    endAt: "2026-05-29T00:00:00.000Z",
  },
  afterWindow: {
    startAt: "2026-06-29T00:00:00.000Z",
    endAt: "2026-07-27T00:00:00.000Z",
  },
} as const;

function row(overrides: Record<string, unknown> = {}) {
  return {
    page_exists: true,
    page_id: IDS.page,
    page_url: input.canonicalUrl,
    topic_model_revision: 3,
    missing_decision_count: 0,
    mirror_divergence_count: 0,
    invalid_decision_count: 0,
    keyword_id: IDS.keyword,
    display_keyword: "Customer Onboarding Automation",
    normalized_keyword: "customer onboarding automation",
    market_code: "US",
    language_tag: "en-US",
    topic_node_id: IDS.topic,
    topic_label: "Customer onboarding",
    decision_topic_model_revision: 3,
    occurrence_id: IDS.occurrence,
    occurrence_normalized_keyword:
      "customer onboarding automation",
    occurrence_market: "US",
    occurrence_language_tag: "en-US",
    occurrence_source_kind: "dataforseo_ranked",
    occurrence_scope_basis: "provider_collection_scope",
    occurrence_source_pointer: "/valueJson/keyword",
    occurrence_source_ref:
      `observation:${IDS.observation}#/valueJson/keyword`,
    occurrence_provider_data_as_of: null,
    snapshot_id: IDS.snapshot,
    snapshot_provider: "dataforseo",
    snapshot_dataset_key: "dataforseo.ranked_keywords.v1",
    snapshot_schema_version: "dataforseo.ranked_keywords.v1",
    snapshot_method_version: "dataforseo.ranked_keywords.v1",
    collection_provider: "dataforseo",
    collection_operation: "keyword_gap_import",
    collection_method_version: "dataforseo.ranked_keywords.v1",
    snapshot_availability: "available",
    observation_id: IDS.observation,
    observation_provider: "dataforseo",
    observation_metric_key: "csv.keyword_gap.v1",
    observation_availability: "available",
    observation_observed_at: "2026-05-20T00:00:00.000Z",
    observation_grade: "B",
    observation_limitation:
      "DataForSEO does not expose a provider data-as-of timestamp.",
    observation_value_json: {
      keyword: "Customer Onboarding Automation",
      currentUrl: input.canonicalUrl,
      currentRank: 12,
    },
    ...overrides,
  };
}

describe("MeasurementTargetKeywordRanksRepository", () => {
  it("reads only current confirmed page targets and DataForSEO absolute-rank facts in both frozen windows", async () => {
    const db = fixtureExecutor();
    db.enqueue([row()]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).resolves.toEqual({
      sitePageId: IDS.page,
      canonicalUrl: input.canonicalUrl,
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
          observations: [
            {
              occurrenceId: IDS.occurrence,
              snapshotId: IDS.snapshot,
              observationId: IDS.observation,
              value: 12,
              observedAt: "2026-05-20T00:00:00.000Z",
              limitation:
                "DataForSEO does not expose a provider data-as-of timestamp.",
            },
          ],
        },
      ],
    });

    const query = db.lastSql();
    expect(query.sql).toContain("latest_confirmed as materialized");
    expect(query.sql).toContain("current_keyword_authority as materialized");
    expect(query.sql).toMatch(
      /decision_topic_model_revision[^]*model\.revision/u,
    );
    expect(query.sql).toContain(
      "authority.decision_status = 'approved'",
    );
    expect(query.sql).toContain(
      "authority.decision_review_state = 'confirmed'",
    );
    expect(query.sql).toContain(
      "occurrence.source_kind = 'dataforseo_ranked'",
    );
    expect(query.sql).toContain(
      "snapshot.method_version as snapshot_method_version",
    );
    expect(query.sql).toContain(
      "collection.operation as collection_operation",
    );
    expect(query.sql).not.toContain(
      "occurrence.source_kind = 'gsc_top_query'",
    );
    expect(query.sql).toMatch(
      /observation\.observed_at\s+>=\s+\$/u,
    );
    expect(query.sql).toMatch(
      /observation\.observed_at\s+<\s+\$/u,
    );
    expect(query.params).toContain(scope.workspaceId);
    expect(query.params).toContain(scope.projectId);
    expect(query.params).toContain(IDS.page);
    expect(query.params).toContain(input.canonicalUrl);
  });

  it("accepts exact composite search-landscape ranked-keyword lineage", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      row({
        snapshot_dataset_key: "dataforseo.search_landscape.v1",
        snapshot_schema_version: "dataforseo.search_landscape.v1",
        snapshot_method_version: "dataforseo.search_landscape.v1",
        collection_operation: "search_landscape",
        collection_method_version: "dataforseo.search_landscape.v1",
      }),
    ]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).resolves.toMatchObject({
      keywords: [
        {
          observations: [
            {
              snapshotId: IDS.snapshot,
              observationId: IDS.observation,
              value: 12,
            },
          ],
        },
      ],
    });
  });

  it("accepts exact v2 search-landscape ranked-keyword lineage", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      row({
        snapshot_dataset_key: "dataforseo.search_landscape.v2",
        snapshot_schema_version: "dataforseo.search_landscape.v2",
        snapshot_method_version: "dataforseo.search_landscape.v2",
        collection_operation: "search_landscape",
        collection_method_version: "dataforseo.search_landscape.v2",
      }),
    ]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).resolves.toMatchObject({
      keywords: [
        {
          observations: [
            {
              snapshotId: IDS.snapshot,
              observationId: IDS.observation,
              value: 12,
            },
          ],
        },
      ],
    });
  });

  it("accepts exact v3 search-landscape ranked-keyword lineage", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      row({
        snapshot_dataset_key: "dataforseo.search_landscape.v3",
        snapshot_schema_version: "dataforseo.search_landscape.v3",
        snapshot_method_version: "dataforseo.search_landscape.v3",
        collection_operation: "search_landscape",
        collection_method_version: "dataforseo.search_landscape.v3",
      }),
    ]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).resolves.toMatchObject({
      keywords: [
        {
          observations: [
            {
              snapshotId: IDS.snapshot,
              observationId: IDS.observation,
              value: 12,
            },
          ],
        },
      ],
    });
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
        snapshot_dataset_key: "dataforseo.search_landscape.v1",
        snapshot_schema_version: "dataforseo.search_landscape.v1",
        snapshot_method_version: "dataforseo.search_landscape.v1",
      },
    },
    {
      drift: "composite Snapshot with a legacy method",
      overrides: {
        snapshot_dataset_key: "dataforseo.search_landscape.v1",
        snapshot_schema_version: "dataforseo.search_landscape.v1",
        collection_operation: "search_landscape",
        collection_method_version: "dataforseo.search_landscape.v1",
      },
    },
  ])("fails closed on $drift", async ({ overrides }) => {
    const db = fixtureExecutor();
    db.enqueue([row(overrides)]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).rejects.toEqual(
      new MeasurementTargetKeywordRankIntegrityError(
        "RANK_LINEAGE_INVALID",
      ),
    );
  });

  it("returns unavailable-ready empty authority without inventing a Keyword or zero when no model exists", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      row({
        topic_model_revision: null,
        keyword_id: null,
        display_keyword: null,
        normalized_keyword: null,
        market_code: null,
        language_tag: null,
        topic_node_id: null,
        topic_label: null,
        decision_topic_model_revision: null,
        occurrence_id: null,
        occurrence_normalized_keyword: null,
        occurrence_market: null,
        occurrence_language_tag: null,
        occurrence_source_kind: null,
        occurrence_scope_basis: null,
        occurrence_source_pointer: null,
        occurrence_source_ref: null,
        occurrence_provider_data_as_of: null,
        snapshot_id: null,
        snapshot_provider: null,
        snapshot_dataset_key: null,
        snapshot_schema_version: null,
        snapshot_method_version: null,
        collection_provider: null,
        collection_operation: null,
        collection_method_version: null,
        snapshot_availability: null,
        observation_id: null,
        observation_provider: null,
        observation_metric_key: null,
        observation_availability: null,
        observation_observed_at: null,
        observation_grade: null,
        observation_limitation: null,
        observation_value_json: null,
      }),
    ]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).resolves.toEqual({
      sitePageId: IDS.page,
      canonicalUrl: input.canonicalUrl,
      topicModelRevision: null,
      keywords: [],
    });
  });

  it("fails closed when a stale Topic revision is presented as the latest authority", async () => {
    const db = fixtureExecutor();
    db.enqueue([row({ decision_topic_model_revision: 2 })]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).rejects.toEqual(
      new MeasurementTargetKeywordRankIntegrityError(
        "AUTHORITY_RESULT_INVALID",
      ),
    );
  });

  it("fails closed on mirrored Keyword governance drift", async () => {
    const db = fixtureExecutor();
    db.enqueue([row({ mirror_divergence_count: 1 })]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).rejects.toEqual(
      new MeasurementTargetKeywordRankIntegrityError(
        "KEYWORD_AUTHORITY_DIVERGED",
      ),
    );
  });

  it("keeps a true null rank absent rather than converting it to zero", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      row({
        observation_value_json: {
          keyword: "Customer Onboarding Automation",
          currentUrl: input.canonicalUrl,
          currentRank: null,
        },
      }),
    ]);

    const authority =
      await new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input);
    expect(authority.keywords[0]?.observations).toEqual([]);
  });

  it("rejects a GSC metric or mismatched canonical source identity", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      row({
        observation_provider: "gsc",
        observation_metric_key: "gsc.page.v1",
      }),
    ]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).rejects.toEqual(
      new MeasurementTargetKeywordRankIntegrityError(
        "RANK_LINEAGE_INVALID",
      ),
    );
  });

  it("does not attribute a same-site DataForSEO rank to a different measured URL", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      row({
        observation_value_json: {
          keyword: "Customer Onboarding Automation",
          currentUrl: "https://example.com/pricing/",
          currentRank: 4,
        },
      }),
    ]);

    const authority =
      await new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input);
    expect(authority.keywords[0]?.observations).toEqual([]);
  });

  it("does not attribute a cross-origin DataForSEO result to the measured URL", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      row({
        observation_value_json: {
          keyword: "Customer Onboarding Automation",
          currentUrl:
            "https://competitor.example/customer-onboarding/",
          currentRank: 2,
        },
      }),
    ]);

    const authority =
      await new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input);
    expect(authority.keywords[0]?.observations).toEqual([]);
  });

  it("fails closed when DataForSEO method-version lineage drifts", async () => {
    const db = fixtureExecutor();
    db.enqueue([
      row({
        snapshot_method_version: "dataforseo.ranked_keywords.v0",
      }),
    ]);

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).rejects.toEqual(
      new MeasurementTargetKeywordRankIntegrityError(
        "RANK_LINEAGE_INVALID",
      ),
    );
  });

  it("fails closed instead of silently truncating rank facts", async () => {
    const db = fixtureExecutor();
    db.enqueue(
      Array.from(
        { length: MAX_MEASUREMENT_KEYWORD_RANK_FACTS + 1 },
        (_, index) =>
          row({
            occurrence_id: `d2000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            observation_id: `d3000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            occurrence_source_ref:
              `observation:d3000000-0000-4000-8000-${String(index).padStart(12, "0")}#/valueJson/keyword`,
          }),
      ),
    );

    await expect(
      new MeasurementTargetKeywordRanksRepository(
        db.executor,
      ).readForMeasuredPage(scope, input),
    ).rejects.toMatchObject({
      code: "RANK_FACT_LIMIT_EXCEEDED",
    });
  });
});
