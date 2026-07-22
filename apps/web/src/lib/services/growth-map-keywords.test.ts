import {
  KeywordOccurrencesRepository,
  KeywordsRepository,
  ProjectsRepository,
  SitePagesRepository,
  normalizedUrlHash,
  type KeywordEntityRow,
  type KeywordOccurrenceRow,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { createDataForSeoCollectionScope } from "@sf/sources";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getProjectAuditKeyword, listProjectAuditKeywords } = await import(
  "./growth-map-keywords.ts"
);

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  keyword: "10000000-0000-4000-8000-000000000003",
  occurrence: "10000000-0000-4000-8000-000000000004",
  snapshot: "10000000-0000-4000-8000-000000000005",
  observation: "10000000-0000-4000-8000-000000000006",
  sitePage: "10000000-0000-4000-8000-000000000007",
  importPreview: "10000000-0000-4000-8000-000000000008",
  collectionRun: "10000000-0000-4000-8000-000000000010",
} as const;

const scope = { workspaceId: ids.workspace };
const capturedAt = "2026-07-22T08:00:00.000Z";
const normalizedUrl = "https://example.com/customer-onboarding/";

interface QueryLike {
  from(...args: unknown[]): QueryLike;
  where(...args: unknown[]): QueryLike;
  orderBy(...args: unknown[]): QueryLike;
  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

class FakeExecutor {
  readonly calls: string[] = [];
  private readonly results: unknown[] = [];

  enqueue(...results: unknown[]): void {
    this.results.push(...results);
  }

  select(): QueryLike {
    this.calls.push("select");
    const take = () =>
      this.results.length > 0 ? this.results.shift() : [];
    const query: QueryLike = {
      from() {
        return query;
      },
      where() {
        return query;
      },
      orderBy() {
        return query;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(take()).then(onFulfilled, onRejected);
      },
    };
    return query;
  }
}

function entity(
  overrides: Partial<KeywordEntityRow> = {},
): KeywordEntityRow {
  return {
    id: ids.keyword,
    workspace_id: ids.workspace,
    project_id: ids.project,
    display_keyword: "Customer Onboarding Software",
    normalized_keyword: "customer onboarding software",
    market: "US",
    language_tag: "en-US",
    query_kind: "search_query",
    status: "candidate",
    intent: null,
    buyer_stage: "consideration",
    cluster_key: "customer-onboarding",
    mapping_decision: "existing_page",
    mapped_site_page_id: ids.sitePage,
    mapping_review_state: "confirmed",
    mapping_revision: 2,
    first_seen_at: capturedAt,
    last_seen_at: capturedAt,
    created_at: capturedAt,
    updated_at: capturedAt,
    ...overrides,
  };
}

function occurrence(
  overrides: Partial<KeywordOccurrenceRow> = {},
): KeywordOccurrenceRow {
  return {
    id: ids.occurrence,
    workspace_id: ids.workspace,
    project_id: ids.project,
    data_snapshot_id: ids.snapshot,
    normalized_observation_id: ids.observation,
    display_keyword: "Customer Onboarding Software",
    normalized_keyword: "customer onboarding software",
    market: "US",
    language_tag: "en-US",
    query_kind: "search_query",
    source_kind: "dataforseo_ranked",
    scope_basis: "provider_collection_scope",
    source_pointer: "/valueJson/keyword",
    source_ref: `observation:${ids.observation}#/valueJson/keyword`,
    collected_at: capturedAt,
    provider_data_as_of: null,
    created_at: capturedAt,
    ...overrides,
  };
}

function dataForSeoObservation(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.observation,
    workspace_id: ids.workspace,
    project_id: ids.project,
    snapshot_id: ids.snapshot,
    site_page_id: null,
    provider: "dataforseo",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    subject_ref: "customer-onboarding",
    observed_at: capturedAt,
    availability: "available",
    value_json: {
      keyword: "customer onboarding software",
      clusterKey: "customer-onboarding",
      searchVolume: 0,
      currentRank: 12,
      currentUrl: normalizedUrl,
      competitorDomain: null,
      competitorRank: null,
      marketCode: "US",
      languageCode: "en",
    },
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "context",
    limitation: "Provider rows are bounded by the frozen collection scope.",
    ...overrides,
  };
}

function dataForSeoSnapshot(overrides: Record<string, unknown> = {}) {
  const collectionScope = createDataForSeoCollectionScope({
    target: "example.com",
    marketCode: "US",
    languageTag: "en-US",
    locationCode: 2840,
    limit: 200,
  });
  return {
    id: ids.snapshot,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: "10000000-0000-4000-8000-000000000009",
    collection_run_id: ids.collectionRun,
    provider: "dataforseo",
    dataset_key: "dataforseo.ranked_keywords.v1",
    captured_at: capturedAt,
    availability: "available",
    limitation: "Provider rows are bounded by the frozen collection scope.",
    summary: {
      collectionScope,
      timing: {
        collectedAt: capturedAt,
        dataAsOf: null,
        observedAt: null,
        freshness: "unknown",
      },
      privateRawTaskId: "must-not-leak",
    },
    ...overrides,
  };
}

function collectionRun(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.collectionRun,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: "10000000-0000-4000-8000-000000000009",
    provider: "dataforseo",
    operation: "keyword_gap_import",
    method_version: "dataforseo.ranked_keywords.v1",
    import_preview_id: null,
    ...overrides,
  };
}

function sitePage() {
  return {
    id: ids.sitePage,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: "10000000-0000-4000-8000-000000000009",
    normalized_url: normalizedUrl,
    normalized_url_hash: normalizedUrlHash(normalizedUrl),
    template_key: null,
    created_at: capturedAt,
    updated_at: capturedAt,
  };
}

function mockProject(active = true) {
  return vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: ids.project,
    workspace_id: ids.workspace,
    archived_at: active ? null : capturedAt,
  } as never);
}

function arrangeList(input: {
  entity?: KeywordEntityRow;
  occurrence?: KeywordOccurrenceRow;
  nextOccurrenceCursor?: string | null;
  observations?: readonly unknown[];
  snapshots?: readonly unknown[];
  collectionRuns?: readonly unknown[];
  sitePages?: readonly ReturnType<typeof sitePage>[];
} = {}) {
  mockProject();
  const keyword = input.entity ?? entity();
  vi.spyOn(KeywordsRepository.prototype, "listByProject").mockResolvedValue({
    rows: [keyword],
    nextCursor: null,
  });
  vi.spyOn(
    KeywordOccurrencesRepository.prototype,
    "listForEntity",
  ).mockResolvedValue({
    rows: [input.occurrence ?? occurrence()],
    nextCursor: input.nextOccurrenceCursor ?? null,
  });
  vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue(
    (input.sitePages ?? [sitePage()]) as never,
  );
  const exec = new FakeExecutor();
  exec.enqueue(
    input.observations ?? [dataForSeoObservation()],
    input.snapshots ?? [dataForSeoSnapshot()],
    input.collectionRuns ?? [collectionRun()],
  );
  return exec;
}

beforeEach(() => {
  mocks.getDb.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Growth Map Keyword Library read service", () => {
  it("projects canonical value_json pointers, real DataForSEO scope, and verified Existing Page identity", async () => {
    const exec = arrangeList();

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null, now: new Date("2026-07-22T09:00:00.000Z") },
      exec as never,
    );

    expect(response.projectId).toBe(ids.project);
    expect(response.data).toHaveLength(1);
    expect(response.data[0]).toMatchObject({
      keywordId: ids.keyword,
      cluster: null,
      classificationLimitations: {
        intent: expect.any(String),
        buyerStage: null,
        cluster: expect.stringMatching(/canonical cluster ID/i),
      },
      mappedTarget: {
        kind: "existing_page",
        sitePageId: ids.sitePage,
        normalizedUrl,
        reviewState: "approved",
        revision: 2,
      },
      sourceOccurrences: [
        expect.objectContaining({
          occurrenceId: ids.occurrence,
          sourceKind: "dataforseo_ranked",
          scopeBasis: "provider_collection_scope",
          scopeLimitation: expect.stringMatching(
            /example\.com.*US.*en-US.*2840.*200/is,
          ),
          providerDataAsOf: null,
          freshness: "unknown",
        }),
      ],
      metrics: {
        volume: expect.objectContaining({
          value: 0,
          observationId: ids.observation,
          valuePointer: "/valueJson/searchVolume",
        }),
        kd: null,
        currentRank: expect.objectContaining({
          value: 12,
          valuePointer: "/valueJson/currentRank",
        }),
        currentUrl: expect.objectContaining({
          value: normalizedUrl,
          valuePointer: "/valueJson/currentUrl",
        }),
        limitations: expect.objectContaining({
          kd: expect.stringMatching(/keywordDifficulty/),
        }),
      },
    });
    expect(JSON.stringify(response)).not.toContain("must-not-leak");
  });

  it("fails closed when a DataForSEO occurrence points at the legacy CSV dataset key", async () => {
    const exec = arrangeList({
      snapshots: [
        dataForSeoSnapshot({
          dataset_key: "csv.keyword_gap.v1",
        }),
      ],
    });

    await expect(
      listProjectAuditKeywords(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        exec as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("marks an occurrence history capped at 100 as partial instead of silently claiming completeness", async () => {
    const exec = arrangeList({
      nextOccurrenceCursor: Buffer.from(
        "2026-07-21T08:00:00.000Z 10000000-0000-4000-8000-000000000010",
      ).toString("base64url"),
    });

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.coverage).toMatchObject({
      availability: "partial",
      limitations: expect.arrayContaining([
        expect.stringMatching(/most recent 100 source occurrences/i),
      ]),
    });
  });

  it("takes CSV import identity only from its project-scoped canonical CollectionRun lineage", async () => {
    const csvOccurrence = occurrence({
      source_kind: "csv_import",
      scope_basis: "user_provided",
    });
    const csvObservation = dataForSeoObservation({
      provider: "csv",
      origin: "user_provided",
      grade: "C",
    });
    const csvSnapshot = dataForSeoSnapshot({
      provider: "csv",
      dataset_key: "csv.keyword_gap.v1",
      summary: {},
    });
    const exec = arrangeList({
      occurrence: csvOccurrence,
      observations: [csvObservation],
      snapshots: [csvSnapshot],
      collectionRuns: [
        collectionRun({
          provider: "csv",
          method_version: "csv.keyword_gap.v1",
          import_preview_id: ids.importPreview,
        }),
      ],
    });

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.sourceOccurrences[0]).toMatchObject({
      sourceKind: "csv_import",
      importPreviewId: ids.importPreview,
    });

    vi.restoreAllMocks();
    const missingRunImport = arrangeList({
      occurrence: csvOccurrence,
      observations: [csvObservation],
      snapshots: [csvSnapshot],
      collectionRuns: [
        collectionRun({
          provider: "csv",
          method_version: "csv.keyword_gap.v1",
          import_preview_id: null,
        }),
      ],
    });
    await expect(
      listProjectAuditKeywords(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        missingRunImport as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("states GSC market/language as frozen project context and never reinterprets top-query metrics", async () => {
    const gscOccurrence = occurrence({
      source_kind: "gsc_top_query",
      scope_basis: "project_context",
      source_pointer: "/valueJson/topQueries/0/query",
      source_ref: `observation:${ids.observation}#/valueJson/topQueries/0/query`,
      display_keyword: "Customer Onboarding Software",
    });
    const gscObservation = dataForSeoObservation({
      site_page_id: ids.sitePage,
      provider: "gsc",
      metric_key: "gsc.page.v1",
      subject_type: "url",
      subject_ref: normalizedUrl,
      origin: "first_party",
      grade: "A",
      value_json: {
        topQueries: [
          {
            query: "customer onboarding software",
            clicks: 10,
            impressions: 100,
            position: 7.5,
          },
        ],
      },
    });
    const gscSnapshot = dataForSeoSnapshot({
      provider: "gsc",
      dataset_key: "gsc.page_query_daily.v1",
      summary: {
        keywordLibraryContext: {
          basis: "project_context",
          marketCode: "US",
          languageTag: "en-US",
        },
        timing: { dataAsOf: null },
      },
    });
    const exec = arrangeList({
      entity: entity({
        cluster_key: null,
        mapping_decision: "unassigned",
        mapped_site_page_id: null,
        mapping_review_state: "unreviewed",
        mapping_revision: 0,
      }),
      occurrence: gscOccurrence,
      observations: [gscObservation],
      snapshots: [gscSnapshot],
      collectionRuns: [
        collectionRun({
          provider: "gsc",
          operation: "search_analytics",
          method_version: "gsc.search_analytics.v1",
        }),
      ],
    });

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.sourceOccurrences[0]).toMatchObject({
      sourceKind: "gsc_top_query",
      scopeBasis: "project_context",
      scopeLimitation: expect.stringMatching(
        /not filtered by market or language.*US.*en-US/is,
      ),
    });
    expect(response.data[0]?.metrics).toMatchObject({
      volume: null,
      kd: null,
      currentRank: null,
      currentUrl: null,
      competitorDomain: null,
      competitorRank: null,
      limitations: {
        volume: expect.any(String),
        kd: expect.any(String),
        currentRank: expect.any(String),
        currentUrl: expect.any(String),
        competitorDomain: expect.any(String),
        competitorRank: expect.any(String),
      },
    });
  });

  it("keeps a manual occurrence first-class without fabricated provider lineage", async () => {
    mockProject();
    vi.spyOn(KeywordsRepository.prototype, "listByProject").mockResolvedValue({
      rows: [
        entity({
          query_kind: "generative_query",
          cluster_key: null,
          mapping_decision: "new_asset",
          mapped_site_page_id: null,
          mapping_review_state: "unreviewed",
          mapping_revision: 0,
        }),
      ],
      nextCursor: null,
    });
    vi.spyOn(
      KeywordOccurrencesRepository.prototype,
      "listForEntity",
    ).mockResolvedValue({
      rows: [
        occurrence({
          id: ids.occurrence,
          data_snapshot_id: null,
          normalized_observation_id: null,
          query_kind: "generative_query",
          source_kind: "manual",
          scope_basis: "manual",
          source_pointer: null,
          source_ref: `manual:${ids.occurrence}`,
          provider_data_as_of: null,
        }),
      ],
      nextCursor: null,
    });
    vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([]);
    const exec = new FakeExecutor();

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.sourceOccurrences).toEqual([
      expect.objectContaining({
        occurrenceId: ids.occurrence,
        sourceKind: "manual",
        snapshotId: null,
        sourceObservationId: null,
        sourcePointer: null,
        providerDataAsOf: null,
        freshness: "unknown",
        scopeBasis: "manual",
      }),
    ]);
    expect(exec.calls).toEqual([]);
  });

  it("fails closed for archived projects and foreign Existing Page identities", async () => {
    mockProject(false);
    const list = vi.spyOn(KeywordsRepository.prototype, "listByProject");

    await expect(
      listProjectAuditKeywords(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(list).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    const exec = arrangeList({ sitePages: [] });
    await expect(
      listProjectAuditKeywords(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        exec as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("returns project-scoped detail and not-found for an absent Keyword", async () => {
    mockProject();
    vi.spyOn(KeywordsRepository.prototype, "findById").mockResolvedValue(null);

    await expect(
      getProjectAuditKeyword(
        scope,
        ids.project,
        ids.keyword,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    "customer-private-malformed-keyset",
    "2026-02-31T00:00:00.000Z 10000000-0000-4000-8000-000000000003",
  ])("rejects a semantically invalid cursor before database access: %j", async (payload) => {
    const cursor = Buffer.from(payload).toString("base64url");

    let caught: unknown;
    try {
      await listProjectAuditKeywords(scope, ids.project, { limit: 50, cursor });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProblemError);
    expect(caught).toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect((caught as Error).message).not.toContain(payload);
  });

  it.each([
    {
      name: "list",
      read: () =>
        listProjectAuditKeywords(scope, ids.project, {
          limit: 50,
          cursor: null,
        }),
    },
    {
      name: "detail",
      read: () => getProjectAuditKeyword(scope, ids.project, ids.keyword),
    },
  ])("uses one repeatable-read, read-only transaction for a production $name", async ({ read }) => {
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

    await expect(read()).rejects.toBe(sentinel);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
