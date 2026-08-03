import {
  KeywordGovernanceConflictError,
  KeywordGovernanceIntegrityError,
  KeywordGovernanceRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  ProjectsRepository,
  SitePagesRepository,
  normalizedUrlHash,
  type KeywordEntityRow,
  type KeywordOccurrenceRow,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import {
  createDataForSeoCollectionScope,
  createDataForSeoSearchLandscapeScope,
  createDataForSeoSearchLandscapeV2Scope,
} from "@sf/sources";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  loadPublishedGrowthMapGeneration: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("./growth-map-generation.ts", () => ({
  loadPublishedGrowthMapGeneration: mocks.loadPublishedGrowthMapGeneration,
}));

const {
  getProjectAuditKeyword,
  getProjectAuditKeywordReviewDetail,
  listProjectAuditKeywords,
  reviewProjectAuditKeyword,
} = await import("./growth-map-keywords.ts");

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  publishedRun: "20000000-0000-4000-8000-000000000001",
  keyword: "10000000-0000-4000-8000-000000000003",
  occurrence: "10000000-0000-4000-8000-000000000004",
  snapshot: "10000000-0000-4000-8000-000000000005",
  observation: "10000000-0000-4000-8000-000000000006",
  sitePage: "10000000-0000-4000-8000-000000000007",
  importPreview: "10000000-0000-4000-8000-000000000008",
  collectionRun: "10000000-0000-4000-8000-000000000010",
  actor: "10000000-0000-4000-8000-000000000011",
  topicNode: "10000000-0000-4000-8000-000000000012",
  decision: "10000000-0000-4000-8000-000000000013",
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
    schema_version: "dataforseo.ranked_keywords.v1",
    method_version: "dataforseo.ranked_keywords.v1",
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

function dataForSeoSearchLandscapeSnapshot(
  overrides: Record<string, unknown> = {},
) {
  const collectionScope = createDataForSeoSearchLandscapeScope({
    target: "example.com",
    marketCode: "US",
    languageTag: "en-US",
    locationCode: 2840,
    rankedKeywordsLimit: 200,
    competitorsDomainLimit: 75,
  });
  return dataForSeoSnapshot({
    dataset_key: "dataforseo.search_landscape.v1",
    schema_version: "dataforseo.search_landscape.v1",
    method_version: "dataforseo.search_landscape.v1",
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
  });
}

function searchLandscapeCollectionRun(
  overrides: Record<string, unknown> = {},
) {
  return collectionRun({
    operation: "search_landscape",
    method_version: "dataforseo.search_landscape.v1",
    ...overrides,
  });
}

function dataForSeoSearchLandscapeV2Snapshot(
  overrides: Record<string, unknown> = {},
) {
  const collectionScope = createDataForSeoSearchLandscapeV2Scope({
    target: "example.com",
    marketCode: "US",
    languageTag: "en-US",
    locationCode: 2840,
    rankedKeywordsLimit: 200,
    competitorsDomainLimit: 100,
    serpCompetitorsLimit: 100,
    seeds: [
      {
        keyword: "customer onboarding software",
        sourceKind: "gsc_top_query",
        sourceRef: `observation:${ids.observation}#/valueJson/query`,
      },
    ],
  });
  return dataForSeoSnapshot({
    dataset_key: "dataforseo.search_landscape.v2",
    schema_version: "dataforseo.search_landscape.v2",
    method_version: "dataforseo.search_landscape.v2",
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
  });
}

function searchLandscapeV2CollectionRun(
  overrides: Record<string, unknown> = {},
) {
  return collectionRun({
    operation: "search_landscape",
    method_version: "dataforseo.search_landscape.v2",
    ...overrides,
  });
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

function reviewedGovernance() {
  const reason = "Confirmed against the exact Topic Model revision.";
  return {
    decision: {
      decisionId: ids.decision,
      projectId: ids.project,
      keywordId: ids.keyword,
      governanceRevision: 3,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: ids.topicNode,
      topicModelRevision: 3,
      mappingDecision: "existing_page",
      mappedSitePageId: ids.sitePage,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      reason,
      decisionOrigin: "user",
      decidedBy: ids.actor,
      decidedAt: capturedAt,
    },
    projection: {
      currentDecisionId: ids.decision,
      projectId: ids.project,
      keywordId: ids.keyword,
      governanceRevision: 3,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: ids.topicNode,
      topicModelRevision: 3,
      mappingDecision: "existing_page",
      mappedSitePageId: ids.sitePage,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      mappingRevision: 3,
      executionState: "ready",
      reason,
      updatedAt: capturedAt,
    },
    clusterKey: "Customer Onboarding",
    reviewedProjection: {
      projectId: ids.project,
      keywordId: ids.keyword,
      governanceRevision: 3,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: ids.topicNode,
      topicModelRevision: 3,
      clusterKey: "Customer Onboarding",
      mappingDecision: "existing_page",
      mappedSitePageId: ids.sitePage,
      mappingReviewState: "confirmed",
      assignmentInvalidatedBy: null,
      earlierHistoryAvailable: false,
    },
  } as const;
}

function frozenGovernance(input?: {
  readonly fact?: Partial<{
    keywordEntityId: string;
    displayKeyword: string;
    normalizedKeyword: string;
    marketCode: string;
    languageTag: string;
    revision: number;
    status: "candidate" | "approved" | "excluded" | "parked";
    queryKind: "search_query" | "generative_query";
    intent: string | null;
    buyerStage: string | null;
    clusterKey: string | null;
    mappingDecision: "unassigned" | "existing_page" | "new_asset";
    mappedSitePageId: string | null;
    mappingReviewState: "unreviewed" | "confirmed";
    lastSeenAt: string;
  }>;
  readonly occurrenceRefs?: readonly {
    occurrenceId: string;
    snapshotId: string | null;
    observationId: string | null;
  }[];
  readonly metricRefs?: readonly {
    snapshotId: string;
    observationId: string;
    valuePointer: string;
  }[];
  readonly clusterTopicNodeId?: string | null;
  readonly clusterTopicModelRevision?: number | null;
}) {
  const fact = input?.fact;
  const has = (key: string) =>
    fact !== undefined && Object.prototype.hasOwnProperty.call(fact, key);
  return {
    projectionVersion: "growth-governance.1.0.0",
    keywordClusters: [
      {
        clusterKey:
          has("clusterKey")
            ? (fact!.clusterKey ?? "Customer Onboarding")
            : "Customer Onboarding",
        ...(input?.clusterTopicNodeId === undefined ||
        input.clusterTopicNodeId === null
          ? {}
          : {
              topicNodeId: input.clusterTopicNodeId,
              topicModelRevision:
                input.clusterTopicModelRevision ?? 3,
            }),
        keywords: [
          {
            keywordEntityId: fact?.keywordEntityId ?? ids.keyword,
            displayKeyword:
              fact?.displayKeyword ?? "Customer Onboarding Software",
            normalizedKeyword:
              fact?.normalizedKeyword ?? "customer onboarding software",
            marketCode: fact?.marketCode ?? "US",
            languageTag: fact?.languageTag ?? "en-US",
            revision: fact?.revision ?? 2,
            status: fact?.status ?? "approved",
            queryKind: fact?.queryKind ?? "search_query",
            intent:
              has("intent")
                ? fact!.intent ?? null
                : "commercial",
            buyerStage:
              has("buyerStage")
                ? fact!.buyerStage ?? null
                : "consideration",
            clusterKey:
              has("clusterKey")
                ? fact!.clusterKey ?? null
                : "Customer Onboarding",
            mappingDecision: fact?.mappingDecision ?? "existing_page",
            mappedSitePageId:
              has("mappedSitePageId")
                ? fact!.mappedSitePageId ?? null
                : ids.sitePage,
            mappingReviewState: fact?.mappingReviewState ?? "confirmed",
            lastSeenAt: fact?.lastSeenAt ?? capturedAt,
            occurrenceRefs: input?.occurrenceRefs ?? [
              {
                occurrenceId: ids.occurrence,
                snapshotId: ids.snapshot,
                observationId: ids.observation,
              },
            ],
            metricRefs: input?.metricRefs ?? [],
          },
        ],
      },
    ],
    competitors: [],
  } as const;
}

function publishedGeneration(governance = frozenGovernance()) {
  return {
    run: {
      id: ids.publishedRun,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: "10000000-0000-4000-8000-000000000009",
      icp_profile_id: "30000000-0000-4000-8000-000000000001",
      icp_profile_version: 1,
      rule_set_version: "mvp.rules.0.2.2",
      prompt_set_version: "prompt-set",
      output_locale: "en",
      input_manifest: { governance, snapshots: [{ snapshotId: ids.snapshot }] },
      input_hash: "hash",
      coverage: {},
      created_at: capturedAt,
      run_status: "completed",
      run_completed_at: capturedAt,
    },
    frozen: { snapshots: [] },
    governance,
  } as const;
}

function arrangeList(input: {
  entity?: KeywordEntityRow;
  occurrence?: KeywordOccurrenceRow;
  governance?: ReturnType<typeof frozenGovernance>;
  nextCursor?: string | null;
  observations?: readonly unknown[];
  snapshots?: readonly unknown[];
  collectionRuns?: readonly unknown[];
  sitePages?: readonly ReturnType<typeof sitePage>[];
} = {}) {
  mockProject();
  mocks.loadPublishedGrowthMapGeneration.mockResolvedValue(
    publishedGeneration(input.governance),
  );
  const keyword = input.entity ?? entity();
  vi.spyOn(KeywordsRepository.prototype, "listByIds").mockResolvedValue([
    keyword,
  ]);
  vi.spyOn(KeywordsRepository.prototype, "listByIdsPage").mockResolvedValue({
    rows: [keyword],
    nextCursor: input.nextCursor ?? null,
  });
  vi.spyOn(KeywordsRepository.prototype, "listByProject").mockResolvedValue({
    rows: [keyword],
    nextCursor: input.nextCursor ?? null,
  });
  vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue(
    (input.sitePages ?? [sitePage()]) as never,
  );
  const exec = new FakeExecutor();
  exec.enqueue(
    [input.occurrence ?? occurrence()],
    input.observations ?? [dataForSeoObservation()],
    input.snapshots ?? [dataForSeoSnapshot()],
    input.collectionRuns ?? [collectionRun()],
  );
  return exec;
}

beforeEach(() => {
  mocks.getDb.mockReset();
  mocks.loadPublishedGrowthMapGeneration.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Growth Map Keyword Library read service", () => {
  it("lists current canonical candidates even when the published generation contains no keywords", async () => {
    mockProject();
    const candidate = entity({
        status: "candidate",
        mapping_review_state: "unreviewed",
        cluster_key: null,
        mapping_decision: "new_asset",
        mapped_site_page_id: null,
    });
    vi.spyOn(KeywordsRepository.prototype, "listByProject").mockResolvedValue({
      rows: [candidate],
      nextCursor: null,
    });
    vi.spyOn(
      KeywordOccurrencesRepository.prototype,
      "listForEntity",
    ).mockResolvedValue({ rows: [occurrence()], nextCursor: null });
    vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([]);
    const exec = new FakeExecutor();
    exec.enqueue(
      [dataForSeoObservation()],
      [dataForSeoSnapshot()],
      [collectionRun()],
    );

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: null },
      exec as never,
    );

    expect(response.data).toEqual([
      expect.objectContaining({
        keywordId: ids.keyword,
        status: "candidate",
        displayKeyword: "Customer Onboarding Software",
      }),
    ]);
    expect(KeywordsRepository.prototype.listByProject).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      { limit: 50, cursor: null },
    );
    expect(mocks.loadPublishedGrowthMapGeneration).not.toHaveBeenCalled();
  });

  it("returns an empty unavailable page for a valid published generation with no governed keywords", async () => {
    mockProject();
    const governance = {
      projectionVersion: "growth-governance.1.0.0",
      keywordClusters: [],
      competitors: [],
    } as const;
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue(
      publishedGeneration(governance as never),
    );
    vi.spyOn(KeywordsRepository.prototype, "listByIds").mockResolvedValue([]);
    vi.spyOn(KeywordsRepository.prototype, "listByIdsPage").mockResolvedValue({
      rows: [],
      nextCursor: null,
    });
    const exec = new FakeExecutor();

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: ids.publishedRun },
      exec as never,
    );

    expect(response.data).toEqual([]);
    expect(response.meta).toMatchObject({
      hasNext: false,
      nextCursor: null,
      coverage: {
        availability: "unavailable",
        limitations: [expect.any(String)],
      },
    });
    expect(exec.calls).toEqual([]);
  });

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
        intent: null,
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

  it("projects ranked-keyword evidence from the exact composite search-landscape lineage", async () => {
    const exec = arrangeList({
      snapshots: [dataForSeoSearchLandscapeSnapshot()],
      collectionRuns: [searchLandscapeCollectionRun()],
    });

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null, now: new Date("2026-07-22T09:00:00.000Z") },
      exec as never,
    );

    expect(response.data[0]).toMatchObject({
      sourceOccurrences: [
        expect.objectContaining({
          sourceKind: "dataforseo_ranked",
          snapshotId: ids.snapshot,
          sourceObservationId: ids.observation,
          sourcePointer: "/valueJson/keyword",
          scopeLimitation: expect.stringMatching(
            /search_landscape.*example\.com.*US.*en-US.*2840.*200.*75/is,
          ),
        }),
      ],
      metrics: {
        currentRank: expect.objectContaining({
          snapshotId: ids.snapshot,
          observationId: ids.observation,
          valuePointer: "/valueJson/currentRank",
          value: 12,
        }),
      },
    });
    expect(JSON.stringify(response)).not.toContain("must-not-leak");
  });

  it("projects ranked-keyword evidence from the v2 1-100 scope with frozen fallback seeds", async () => {
    const exec = arrangeList({
      snapshots: [dataForSeoSearchLandscapeV2Snapshot()],
      collectionRuns: [searchLandscapeV2CollectionRun()],
    });

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      {
        limit: 50,
        cursor: null,
        now: new Date("2026-07-22T09:00:00.000Z"),
      },
      exec as never,
    );

    expect(response.data[0]).toMatchObject({
      sourceOccurrences: [
        expect.objectContaining({
          sourceKind: "dataforseo_ranked",
          snapshotId: ids.snapshot,
          sourceObservationId: ids.observation,
          scopeLimitation: expect.stringMatching(
            /search_landscape v2.*200.*100.*100.*1 frozen seed/is,
          ),
        }),
      ],
      metrics: {
        currentRank: expect.objectContaining({ value: 12 }),
      },
    });
    expect(JSON.stringify(response)).not.toContain("must-not-leak");
  });

  it.each([
    {
      drift: "legacy Snapshot with composite CollectionRun",
      snapshots: [dataForSeoSnapshot()],
      collectionRuns: [searchLandscapeCollectionRun()],
    },
    {
      drift: "composite Snapshot with legacy CollectionRun",
      snapshots: [dataForSeoSearchLandscapeSnapshot()],
      collectionRuns: [collectionRun()],
    },
    {
      drift: "composite Snapshot with a forged method",
      snapshots: [dataForSeoSearchLandscapeSnapshot()],
      collectionRuns: [
        searchLandscapeCollectionRun({
          method_version: "dataforseo.ranked_keywords.v1",
        }),
      ],
    },
  ])("fails closed on $drift", async ({ snapshots, collectionRuns }) => {
    const exec = arrangeList({ snapshots, collectionRuns });

    await expect(
      listProjectAuditKeywords(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        exec as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("projects frozen review facts and only flags that a newer live revision exists", async () => {
    const exec = arrangeList({
      entity: entity({
        status: "parked",
        intent: null,
        buyer_stage: null,
        cluster_key: "A newer mutable cluster",
        mapping_decision: "new_asset",
        mapped_site_page_id: null,
        mapping_review_state: "unreviewed",
        mapping_revision: 9,
      }),
      governance: frozenGovernance({
        fact: {
          status: "approved",
          intent: "commercial",
          buyerStage: "consideration",
          clusterKey: "Customer Onboarding",
          mappingDecision: "existing_page",
          mappedSitePageId: ids.sitePage,
          mappingReviewState: "confirmed",
          revision: 2,
        },
      }),
      nextCursor: "opaque-frozen-keyset",
    });
    const legacyLivePage = vi.spyOn(
      KeywordsRepository.prototype,
      "listByProject",
    );

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(legacyLivePage).not.toHaveBeenCalled();
    expect(response.meta.nextCursor).toBe("opaque-frozen-keyset");
    expect(response.data[0]).toMatchObject({
      status: "approved",
      revision: 2,
      intent: "commercial",
      buyerStage: "consideration",
      mappedTarget: {
        kind: "existing_page",
        sitePageId: ids.sitePage,
        reviewState: "approved",
        revision: 2,
      },
      coverage: {
        availability: "partial",
        limitations: expect.arrayContaining([
          expect.stringMatching(/newer live Keyword review/i),
        ]),
      },
    });
  });

  it("passes an exact pinned diagnosticRunId to the published generation helper for list and detail", async () => {
    const listExec = arrangeList();
    const detailExec = arrangeList();

    await listProjectAuditKeywords(
      scope,
      ids.project,
      {
        limit: 50,
        cursor: null,
        diagnosticRunId: ids.publishedRun,
      },
      listExec as never,
    );
    await getProjectAuditKeyword(
      scope,
      ids.project,
      ids.keyword,
      ids.publishedRun,
      detailExec as never,
    );

    expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenNthCalledWith(
      1,
      listExec,
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.publishedRun,
    );
    expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenNthCalledWith(
      2,
      detailExec,
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.publishedRun,
    );
  });

  it("fails closed when a pinned published read resolves a different diagnostic run id", async () => {
    const exec = arrangeList();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValueOnce({
      ...publishedGeneration(),
      run: {
        ...publishedGeneration().run,
        id: "20000000-0000-4000-8000-000000000099",
      },
    });

    await expect(
      listProjectAuditKeywords(
        scope,
        ids.project,
        {
          limit: 50,
          cursor: null,
          diagnosticRunId: ids.publishedRun,
        },
        exec as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("keeps frozen null classification and mapping facts instead of falling back to newer live values", async () => {
    const exec = arrangeList({
      entity: entity({
        status: "parked",
        intent: "commercial",
        buyer_stage: "decision",
        cluster_key: "newer-live-cluster",
        mapping_decision: "existing_page",
        mapped_site_page_id: ids.sitePage,
        mapping_review_state: "confirmed",
        mapping_revision: 9,
      }),
      governance: frozenGovernance({
        fact: {
          revision: 2,
          status: "candidate",
          intent: null,
          buyerStage: null,
          clusterKey: null,
          mappingDecision: "new_asset",
          mappedSitePageId: null,
          mappingReviewState: "unreviewed",
        },
      }),
    });

    const response = await listProjectAuditKeywords(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]).toMatchObject({
      status: "candidate",
      revision: 2,
      intent: null,
      buyerStage: null,
      cluster: null,
      classificationLimitations: {
        intent: expect.any(String),
        buyerStage: expect.any(String),
        cluster: expect.any(String),
      },
      mappedTarget: {
        kind: "new_asset",
        reviewState: "unreviewed",
        revision: 2,
      },
      coverage: {
        limitations: expect.arrayContaining([
          expect.stringMatching(/newer live Keyword review/i),
        ]),
      },
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
      governance: frozenGovernance({
        fact: {
          revision: 0,
          status: "candidate",
          intent: null,
          buyerStage: null,
          clusterKey: null,
          mappingDecision: "unassigned",
          mappedSitePageId: null,
          mappingReviewState: "unreviewed",
        },
      }),
      occurrence: gscOccurrence,
      observations: [gscObservation],
      snapshots: [gscSnapshot],
      collectionRuns: [
        collectionRun({
          provider: "gsc",
          operation: "search_analytics",
          method_version: "gsc.page_query_daily.v1",
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

  it("projects interview summaries and public reviews as distinct, de-identified source evidence", async () => {
    const evidenceAsOf = "2026-07-20T00:00:00.000Z";
    const sharedValue = {
      keyword: "customer onboarding software",
      marketCode: "US",
      languageCode: "en-US",
      providerDataAsOf: evidenceAsOf,
      evidenceLabel: "Q2 customer onboarding research",
      sourceRecordHash: "a".repeat(64),
      participantName: "must-not-leak",
      reviewBody: "must-not-leak",
    };
    const interview = arrangeList({
      occurrence: occurrence({
        source_kind: "interview_summary",
        scope_basis: "user_provided",
        provider_data_as_of: evidenceAsOf,
      }),
      observations: [
        dataForSeoObservation({
          provider: "voc",
          metric_key: "voc.keyword_evidence.v1",
          origin: "user_provided",
          grade: "C",
          value_json: sharedValue,
        }),
      ],
      snapshots: [
        dataForSeoSnapshot({
          provider: "voc",
          dataset_key: "voc.interview_summary.v1",
          source_connection_id: null,
          summary: {
            keywordEvidenceScope: {
              sourceKind: "interview_summary",
              basis: "customer_research",
              marketCode: "US",
              languageTag: "en-US",
            },
            timing: {
              collectedAt: capturedAt,
              dataAsOf: evidenceAsOf,
            },
          },
        }),
      ],
      collectionRuns: [
        collectionRun({
          provider: "voc",
          operation: "keyword_evidence_collection",
          method_version: "voc.interview_summary.v1",
          source_connection_id: null,
        }),
      ],
    });

    const interviewResponse = await listProjectAuditKeywords(
      scope,
      ids.project,
      {
        limit: 50,
        cursor: null,
        now: new Date("2026-07-22T09:00:00.000Z"),
      },
      interview as never,
    );
    expect(interviewResponse.data[0]?.sourceOccurrences[0]).toMatchObject({
      sourceKind: "interview_summary",
      collectionRunId: ids.collectionRun,
      evidenceLabel: "Q2 customer onboarding research",
      sourceRecordHash: "a".repeat(64),
      scopeBasis: "user_provided",
      freshness: "current",
    });
    expect(JSON.stringify(interviewResponse)).not.toMatch(
      /participantName|reviewBody|must-not-leak/u,
    );

    vi.restoreAllMocks();
    const review = arrangeList({
      occurrence: occurrence({
        source_kind: "user_review",
        scope_basis: "provider_collection_scope",
        provider_data_as_of: evidenceAsOf,
      }),
      observations: [
        dataForSeoObservation({
          provider: "voc",
          metric_key: "voc.keyword_evidence.v1",
          origin: "direct_public",
          grade: "B",
          value_json: {
            ...sharedValue,
            evidenceLabel: "RelayOps public review corpus",
            sourceRecordHash: "b".repeat(64),
            reviewPlatform: "g2",
            sourceUrl:
              "https://www.g2.com/products/relayops/reviews",
          },
        }),
      ],
      snapshots: [
        dataForSeoSnapshot({
          provider: "voc",
          dataset_key: "voc.user_review.v1",
          source_connection_id: null,
          summary: {
            keywordEvidenceScope: {
              sourceKind: "user_review",
              basis: "public_review_platform",
              marketCode: "US",
              languageTag: "en-US",
              reviewPlatform: "g2",
            },
            timing: {
              collectedAt: capturedAt,
              dataAsOf: evidenceAsOf,
            },
          },
        }),
      ],
      collectionRuns: [
        collectionRun({
          provider: "voc",
          operation: "keyword_evidence_collection",
          method_version: "voc.user_review.v1",
          source_connection_id: null,
        }),
      ],
    });
    const reviewResponse = await listProjectAuditKeywords(
      scope,
      ids.project,
      {
        limit: 50,
        cursor: null,
        now: new Date("2026-07-22T09:00:00.000Z"),
      },
      review as never,
    );
    expect(reviewResponse.data[0]?.sourceOccurrences[0]).toMatchObject({
      sourceKind: "user_review",
      collectionRunId: ids.collectionRun,
      evidenceLabel: "RelayOps public review corpus",
      sourceRecordHash: "b".repeat(64),
      reviewPlatform: "g2",
      sourceUrl: "https://www.g2.com/products/relayops/reviews",
      scopeBasis: "provider_collection_scope",
      freshness: "current",
    });
    expect(JSON.stringify(reviewResponse)).not.toMatch(
      /participantName|reviewBody|must-not-leak/u,
    );
  });

  it("fails closed when an interview and a public review borrow each other's provenance", async () => {
    const evidenceAsOf = "2026-07-20T00:00:00.000Z";
    const exec = arrangeList({
      occurrence: occurrence({
        source_kind: "interview_summary",
        scope_basis: "user_provided",
        provider_data_as_of: evidenceAsOf,
      }),
      observations: [
        dataForSeoObservation({
          provider: "voc",
          metric_key: "voc.keyword_evidence.v1",
          origin: "direct_public",
          grade: "B",
          value_json: {
            keyword: "customer onboarding software",
            marketCode: "US",
            languageCode: "en-US",
            providerDataAsOf: evidenceAsOf,
            evidenceLabel: "Public review evidence",
            sourceRecordHash: "c".repeat(64),
            reviewPlatform: "g2",
          },
        }),
      ],
      snapshots: [
        dataForSeoSnapshot({
          provider: "voc",
          dataset_key: "voc.interview_summary.v1",
          source_connection_id: null,
          summary: {
            keywordEvidenceScope: {
              sourceKind: "interview_summary",
              basis: "customer_research",
              marketCode: "US",
              languageTag: "en-US",
            },
            timing: {
              collectedAt: capturedAt,
              dataAsOf: evidenceAsOf,
            },
          },
        }),
      ],
      collectionRuns: [
        collectionRun({
          provider: "voc",
          operation: "keyword_evidence_collection",
          method_version: "voc.interview_summary.v1",
          source_connection_id: null,
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

  it("keeps a manual occurrence first-class without fabricated provider lineage", async () => {
    mockProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue(
      publishedGeneration(
        frozenGovernance({
          fact: {
            queryKind: "generative_query",
            revision: 0,
            status: "candidate",
            intent: null,
            buyerStage: null,
            clusterKey: null,
            mappingDecision: "new_asset",
            mappedSitePageId: null,
            mappingReviewState: "unreviewed",
          },
          occurrenceRefs: [
            {
              occurrenceId: ids.occurrence,
              snapshotId: null,
              observationId: null,
            },
          ],
        }),
      ),
    );
    vi.spyOn(KeywordsRepository.prototype, "listByIds").mockResolvedValue([
      entity({
        query_kind: "generative_query",
        cluster_key: null,
        mapping_decision: "new_asset",
        mapped_site_page_id: null,
        mapping_review_state: "unreviewed",
        mapping_revision: 0,
      }),
    ]);
    vi.spyOn(KeywordsRepository.prototype, "listByIdsPage").mockResolvedValue({
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
    vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([]);
    const exec = new FakeExecutor();
    exec.enqueue([
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
    ]);

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
    expect(exec.calls).toEqual(["select"]);
  });

  it("fails closed for archived projects and foreign Existing Page identities", async () => {
    mockProject(false);
    const list = vi.spyOn(KeywordsRepository.prototype, "listByIdsPage");

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

  it("returns detail from the append-only governance authority, including the canonical Topic identity and server-resolved name", async () => {
    mockProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue(
      publishedGeneration(
        frozenGovernance({
          fact: {
            status: "approved",
            intent: "commercial",
            buyerStage: "consideration",
            clusterKey: "Customer Onboarding",
            mappingDecision: "existing_page",
            mappedSitePageId: ids.sitePage,
            mappingReviewState: "confirmed",
            revision: 3,
          },
          clusterTopicNodeId: ids.topicNode,
          clusterTopicModelRevision: 3,
        }),
      ),
    );
    vi.spyOn(KeywordsRepository.prototype, "listByIds").mockResolvedValue([
      entity({
        status: "candidate",
        intent: null,
        buyer_stage: null,
        cluster_key: "new mutable cluster",
        mapping_decision: "new_asset",
        mapped_site_page_id: null,
        mapping_review_state: "unreviewed",
        mapping_revision: 7,
      }),
    ]);
    vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([
      sitePage(),
    ] as never);
    const exec = new FakeExecutor();
    exec.enqueue(
      [occurrence()],
      [dataForSeoObservation()],
      [dataForSeoSnapshot()],
      [collectionRun()],
    );

    const response = await getProjectAuditKeyword(
      scope,
      ids.project,
      ids.keyword,
      null,
      exec as never,
    );

    expect(response.data).toMatchObject({
      status: "approved",
      revision: 3,
      intent: "commercial",
      buyerStage: "consideration",
      cluster: {
        clusterId: ids.topicNode,
        name: "Customer Onboarding",
      },
      classificationLimitations: { cluster: null },
      mappedTarget: {
        kind: "existing_page",
        sitePageId: ids.sitePage,
        reviewState: "approved",
        revision: 3,
      },
      coverage: {
        limitations: expect.arrayContaining([
          expect.stringMatching(/newer live Keyword review/i),
        ]),
      },
    });
  });

  it("returns not-found when the scoped keyword is absent from the frozen published manifest", async () => {
    mockProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue(
      publishedGeneration(
        frozenGovernance({
          fact: {
            keywordEntityId:
              "10000000-0000-4000-8000-000000000099",
          },
        }),
      ),
    );
    const findEntities = vi.spyOn(KeywordsRepository.prototype, "listByIds");

    await expect(
      getProjectAuditKeyword(
        scope,
        ids.project,
        ids.keyword,
        null,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(findEntities).not.toHaveBeenCalled();
  });

  it("fails closed when frozen occurrence lineage drifts from the exact published manifest", async () => {
    mockProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue(
      publishedGeneration(),
    );
    vi.spyOn(KeywordsRepository.prototype, "listByIds").mockResolvedValue([
      entity(),
    ]);
    vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([
      sitePage(),
    ] as never);
    const exec = new FakeExecutor();
    exec.enqueue([
      occurrence({
        data_snapshot_id: "10000000-0000-4000-8000-000000000099",
      }),
    ]);

    await expect(
      getProjectAuditKeyword(
        scope,
        ids.project,
        ids.keyword,
        null,
        exec as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("fails closed when a future frozen governance emits exact metricRefs", async () => {
    mockProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue(
      publishedGeneration(
        frozenGovernance({
          metricRefs: [
            {
              snapshotId: ids.snapshot,
              observationId: ids.observation,
              valuePointer: "/valueJson/searchVolume",
            },
          ],
        }),
      ),
    );
    vi.spyOn(KeywordsRepository.prototype, "listByIds").mockResolvedValue([
      entity(),
    ]);
    vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([
      sitePage(),
    ] as never);
    const exec = new FakeExecutor();
    exec.enqueue(
      [occurrence()],
      [dataForSeoObservation()],
      [dataForSeoSnapshot()],
      [collectionRun()],
    );

    await expect(
      getProjectAuditKeyword(
        scope,
        ids.project,
        ids.keyword,
        null,
        exec as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("keeps published r2 frozen while live review detail and PATCH advance to r3", async () => {
    mockProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue(
      publishedGeneration(
        frozenGovernance({
          fact: {
            revision: 2,
            status: "approved",
            intent: "commercial",
            buyerStage: "consideration",
            clusterKey: "Customer Onboarding",
            mappingDecision: "existing_page",
            mappedSitePageId: ids.sitePage,
            mappingReviewState: "confirmed",
          },
          clusterTopicNodeId: ids.topicNode,
          clusterTopicModelRevision: 2,
        }),
      ),
    );
    const liveGovernance = {
      ...reviewedGovernance(),
      decision: {
        ...reviewedGovernance().decision,
        governanceRevision: 3,
      },
      projection: {
        ...reviewedGovernance().projection,
        governanceRevision: 3,
        mappingRevision: 3,
      },
      reviewedProjection: {
        ...reviewedGovernance().reviewedProjection,
        governanceRevision: 3,
      },
    } as const;
    const liveEntity = entity({
      status: "candidate",
      intent: null,
      buyer_stage: null,
      cluster_key: "new mutable cluster",
      mapping_decision: "new_asset",
      mapped_site_page_id: null,
      mapping_review_state: "unreviewed",
      mapping_revision: 3,
    });
    vi.spyOn(KeywordsRepository.prototype, "listByIds").mockResolvedValue([
      liveEntity,
    ]);
    vi.spyOn(KeywordsRepository.prototype, "findById").mockResolvedValue(
      entity({
        status: "approved",
        intent: "commercial",
        buyer_stage: "consideration",
        cluster_key: "Customer Onboarding",
        mapping_decision: "existing_page",
        mapped_site_page_id: ids.sitePage,
        mapping_review_state: "confirmed",
        mapping_revision: 3,
      }),
    );
    vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "findCurrent",
    ).mockResolvedValue(liveGovernance);
    vi.spyOn(
      KeywordOccurrencesRepository.prototype,
      "listForEntity",
    ).mockResolvedValue({
      rows: [occurrence()],
      nextCursor: null,
    });
    vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "reviewKeyword",
    ).mockResolvedValue({
      ...liveGovernance,
      replayed: false,
    });
    vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([
      sitePage(),
    ] as never);
    const exec = new FakeExecutor();
    exec.enqueue(
      [occurrence()],
      [dataForSeoObservation()],
      [dataForSeoSnapshot()],
      [collectionRun()],
      [dataForSeoObservation()],
      [dataForSeoSnapshot()],
      [collectionRun()],
      [dataForSeoObservation()],
      [dataForSeoSnapshot()],
      [collectionRun()],
    );

    const publishedBefore = await getProjectAuditKeyword(
      scope,
      ids.project,
      ids.keyword,
      null,
      exec as never,
    );
    const patchResponse = await reviewProjectAuditKeyword(
      { workspaceId: ids.workspace, actorId: ids.actor },
      ids.project,
      ids.keyword,
      {
        expectedGovernanceRevision: 2,
        status: "approved",
        intent: "commercial",
        buyerStage: "consideration",
        topicNodeId: ids.topicNode,
        topicModelRevision: 3,
        mappingDecision: "existing_page",
        mappedSitePageId: ids.sitePage,
        reason: reviewedGovernance().projection.reason,
      },
      exec as never,
    );
    const reviewDetail = await getProjectAuditKeywordReviewDetail(
      scope,
      ids.project,
      ids.keyword,
      exec as never,
    );

    expect(publishedBefore.data.revision).toBe(2);
    expect(patchResponse.data.revision).toBe(3);
    expect(reviewDetail.data.revision).toBe(3);
    expect(patchResponse.data.mappedTarget).toMatchObject({
      kind: "existing_page",
      sitePageId: ids.sitePage,
      reviewState: "approved",
      revision: 3,
      reason: reviewedGovernance().projection.reason,
    });
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

describe("Growth Map Keyword governance review service", () => {
  const review = {
    expectedGovernanceRevision: 2,
    status: "approved",
    intent: "commercial",
    buyerStage: "consideration",
    topicNodeId: ids.topicNode,
    topicModelRevision: 3,
    mappingDecision: "existing_page",
    mappedSitePageId: ids.sitePage,
    reason: "Confirmed against the exact Topic Model revision.",
  } as const;
  const reviewScope = {
    workspaceId: ids.workspace,
    actorId: ids.actor,
  };

  function arrangeReviewedDetail() {
    mockProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue(
      publishedGeneration(
        frozenGovernance({
          fact: {
            status: "approved",
            intent: "commercial",
            buyerStage: "consideration",
            clusterKey: "Customer Onboarding",
            mappingDecision: "existing_page",
            mappedSitePageId: ids.sitePage,
            mappingReviewState: "confirmed",
            revision: 3,
          },
          clusterTopicNodeId: ids.topicNode,
          clusterTopicModelRevision: 3,
        }),
      ),
    );
    vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "reviewKeyword",
    ).mockResolvedValue({
      ...reviewedGovernance(),
      replayed: false,
    });
    vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "findCurrent",
    ).mockResolvedValue(reviewedGovernance());
    vi.spyOn(KeywordsRepository.prototype, "findById").mockResolvedValue(
      entity({
        status: "approved",
        intent: "commercial",
        buyer_stage: "consideration",
        cluster_key: "Customer Onboarding",
        mapping_decision: "existing_page",
        mapped_site_page_id: ids.sitePage,
        mapping_review_state: "confirmed",
        mapping_revision: 3,
      }),
    );
    vi.spyOn(
      KeywordOccurrencesRepository.prototype,
      "listForEntity",
    ).mockResolvedValue({
      rows: [occurrence()],
      nextCursor: null,
    });
    vi.spyOn(KeywordsRepository.prototype, "listByIds").mockResolvedValue([
      entity({
        status: "approved",
        intent: "commercial",
        buyer_stage: "consideration",
        cluster_key: "Customer Onboarding",
        mapping_decision: "existing_page",
        mapped_site_page_id: ids.sitePage,
        mapping_review_state: "confirmed",
        mapping_revision: 3,
      }),
    ]);
    vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([
      sitePage(),
    ] as never);
    const exec = new FakeExecutor();
    exec.enqueue(
      [dataForSeoObservation()],
      [dataForSeoSnapshot()],
      [collectionRun()],
    );
    return exec;
  }

  it("writes one server-actor-scoped review and returns the canonical detail projection", async () => {
    const exec = arrangeReviewedDetail();
    const repositoryReview = vi.mocked(
      KeywordGovernanceRepository.prototype.reviewKeyword,
    );

    const response = await reviewProjectAuditKeyword(
      reviewScope,
      ids.project,
      ids.keyword,
      review,
      exec as never,
    );

    expect(repositoryReview).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.keyword,
      ids.actor,
      review,
    );
    expect(response).toMatchObject({
      projectId: ids.project,
      data: {
        keywordId: ids.keyword,
        status: "approved",
        intent: "commercial",
        buyerStage: "consideration",
        cluster: {
          clusterId: ids.topicNode,
          name: "Customer Onboarding",
        },
        mappedTarget: {
          kind: "existing_page",
          sitePageId: ids.sitePage,
          revision: 3,
          reason: reviewedGovernance().projection.reason,
        },
      },
    });
  });

  it("keeps production write and canonical response read in one transaction", async () => {
    const exec = arrangeReviewedDetail();
    const transaction = vi.fn(
      async (callback: (selected: FakeExecutor) => Promise<unknown>) =>
        callback(exec),
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });

    const response = await reviewProjectAuditKeyword(
      reviewScope,
      ids.project,
      ids.keyword,
      review,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(response.data.mappedTarget?.revision).toBe(3);
  });

  it("rejects an invalid internal command before repository access", async () => {
    const repositoryReview = vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "reviewKeyword",
    );

    await expect(
      reviewProjectAuditKeyword(
        reviewScope,
        ids.project,
        ids.keyword,
        { ...review, reason: "no" },
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(repositoryReview).not.toHaveBeenCalled();
  });

  it("returns a typed stale-revision conflict without leaking repository internals", async () => {
    vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "reviewKeyword",
    ).mockRejectedValue(
      new KeywordGovernanceConflictError(
        "REVISION_CONFLICT",
        review.expectedGovernanceRevision,
        4,
      ),
    );

    await expect(
      reviewProjectAuditKeyword(
        reviewScope,
        ids.project,
        ids.keyword,
        review,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({
      code: "STALE_REVISION",
      status: 409,
      current: {
        kind: "revision_conflict",
        resource: "keyword_review",
        projectId: ids.project,
        resourceId: ids.keyword,
        expectedRevision: 2,
        currentRevision: 4,
      },
    });
  });

  it.each([
    new KeywordGovernanceConflictError("REVISION_CONFLICT"),
    new KeywordGovernanceConflictError(
      "REVISION_CONFLICT",
      review.expectedGovernanceRevision,
      null,
    ),
    new KeywordGovernanceConflictError(
      "REVISION_CONFLICT",
      review.expectedGovernanceRevision,
      review.expectedGovernanceRevision,
    ),
    new KeywordGovernanceConflictError(
      "REVISION_CONFLICT",
      review.expectedGovernanceRevision + 1,
      review.expectedGovernanceRevision + 2,
    ),
  ])(
    "fails closed instead of fabricating invalid revision-conflict facts",
    async (repositoryError) => {
      vi.spyOn(
        KeywordGovernanceRepository.prototype,
        "reviewKeyword",
      ).mockRejectedValue(repositoryError);

      await expect(
        reviewProjectAuditKeyword(
          reviewScope,
          ids.project,
          ids.keyword,
          review,
          new FakeExecutor() as never,
        ),
      ).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        status: 503,
      });
    },
  );

  it.each([
    ["KEYWORD_NOT_FOUND", "NOT_FOUND", 404],
    ["SITE_PAGE_NOT_FOUND", "NOT_FOUND", 404],
    ["TOPIC_ASSIGNMENT_INVALID", "VALIDATION_ERROR", 422],
  ] as const)(
    "maps %s to the customer-safe %s boundary",
    async (repositoryCode, code, status) => {
      vi.spyOn(
        KeywordGovernanceRepository.prototype,
        "reviewKeyword",
      ).mockRejectedValue(
        new KeywordGovernanceConflictError(repositoryCode),
      );

      await expect(
        reviewProjectAuditKeyword(
          reviewScope,
          ids.project,
          ids.keyword,
          review,
          new FakeExecutor() as never,
        ),
      ).rejects.toMatchObject({ code, status });
    },
  );

  it("fails closed when the persisted decision projection is corrupt", async () => {
    vi.spyOn(
      KeywordGovernanceRepository.prototype,
      "reviewKeyword",
    ).mockRejectedValue(
      new KeywordGovernanceIntegrityError("CURRENT_DECISION_DIVERGED"),
    );

    await expect(
      reviewProjectAuditKeyword(
        reviewScope,
        ids.project,
        ids.keyword,
        review,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });
});
