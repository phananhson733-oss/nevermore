import {
  CompetitorsRepository,
  ProjectsRepository,
  type CompetitorEntityRow,
  type CompetitorOriginRow,
} from "@sf/db";
import {
  MAX_POSTGRES_INTEGER_REVISION,
  type ReviewCompetitorRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  loadPublishedGrowthMapGeneration: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("./growth-map-generation", () => ({
  loadPublishedGrowthMapGeneration: mocks.loadPublishedGrowthMapGeneration,
}));

const {
  getProjectAuditCompetitor,
  getProjectAuditCompetitorReviewDetail,
  listProjectAuditCompetitors,
  reviewProjectAuditCompetitor,
} = await import("./growth-map-competitors.ts");

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  competitor: "10000000-0000-4000-8000-000000000003",
  profileOrigin: "10000000-0000-4000-8000-000000000004",
  profile: "10000000-0000-4000-8000-000000000005",
  candidate: "10000000-0000-4000-8000-000000000006",
  evidenceRef: "10000000-0000-4000-8000-000000000007",
  csvOrigin: "10000000-0000-4000-8000-000000000008",
  snapshot: "10000000-0000-4000-8000-000000000009",
  observation: "10000000-0000-4000-8000-000000000010",
  importPreview: "10000000-0000-4000-8000-000000000011",
  collectionRun: "10000000-0000-4000-8000-000000000012",
  site: "10000000-0000-4000-8000-000000000013",
  manual: "10000000-0000-4000-8000-000000000014",
  historicalProfileOrigin: "10000000-0000-4000-8000-000000000015",
  historicalProfile: "10000000-0000-4000-8000-000000000016",
  historicalCandidate: "10000000-0000-4000-8000-000000000017",
  historicalEvidenceRef: "10000000-0000-4000-8000-000000000018",
  latestRun: "10000000-0000-4000-8000-000000000019",
  olderRun: "10000000-0000-7000-8000-000000000020",
  foreignRun: "10000000-0000-4000-8000-000000000021",
  unpublishedRun: "10000000-0000-4000-8000-000000000022",
  serpOrigin: "10000000-0000-4000-8000-000000000023",
  serpSnapshot: "10000000-0000-4000-8000-000000000024",
  serpObservation: "10000000-0000-4000-8000-000000000025",
  serpCollectionRun: "10000000-0000-4000-8000-000000000026",
  serpSource: "10000000-0000-4000-8000-000000000027",
  serpFallbackOrigin: "10000000-0000-4000-8000-000000000028",
  serpFallbackObservation: "10000000-0000-4000-8000-000000000029",
  olderSerpOrigin: "09000000-0000-4000-8000-000000000030",
  olderSerpSnapshot: "09000000-0000-4000-8000-000000000031",
  olderSerpObservation: "09000000-0000-4000-8000-000000000032",
  olderSerpCollectionRun: "09000000-0000-4000-8000-000000000033",
  aiOrigin: "10000000-0000-4000-8000-000000000034",
  aiSnapshot: "10000000-0000-4000-8000-000000000035",
  aiObservation: "10000000-0000-4000-8000-000000000036",
  aiCollectionRun: "10000000-0000-4000-8000-000000000037",
} as const;

const scope = { workspaceId: ids.workspace };
const capturedAt = "2026-07-22T08:00:00.000Z";
const evidenceRefs = [
  { evidenceRefId: ids.evidenceRef, kind: "userEdit" as const },
];
const governance: {
  projectionVersion: string;
  keywordClusters: readonly [];
  competitors: Array<{
    competitorEntityId: string;
    domain: string;
    reviewStatus: "candidate" | "approved" | "excluded";
    revision: number;
    relationship:
      | "direct"
      | "indirect"
      | "status_quo"
      | "benchmark"
      | "publisher"
      | null;
    analysisScopes: Array<
      | "positioning"
      | "product_capability"
      | "keyword_gap"
      | "content"
      | "serp_visibility"
    >;
    originRefs: Array<{
      occurrenceId: string;
      originKind:
        | "product_profile"
        | "csv_keyword_gap"
        | "manual"
        | "serp_overlap"
        | "ai_citation";
      snapshotId: string | null;
      observationId: string | null;
    }>;
  }>;
} = {
  projectionVersion: "growth-governance.1.0.0",
  keywordClusters: [],
  competitors: [
    {
      competitorEntityId: ids.competitor,
      domain: "example-competitor.com",
      reviewStatus: "approved",
      revision: 2,
      relationship: "direct",
      analysisScopes: ["keyword_gap", "positioning"],
      originRefs: [
        {
          occurrenceId: ids.csvOrigin,
          originKind: "csv_keyword_gap",
          snapshotId: ids.snapshot,
          observationId: ids.observation,
        },
        {
          occurrenceId: ids.profileOrigin,
          originKind: "product_profile",
          snapshotId: null,
          observationId: null,
        },
        {
          occurrenceId: ids.manual,
          originKind: "manual",
          snapshotId: null,
          observationId: null,
        },
      ],
    },
  ],
};

function governanceCompetitor(
  overrides: Partial<(typeof governance.competitors)[number]> = {},
): (typeof governance.competitors)[number] {
  return {
    competitorEntityId: ids.competitor,
    domain: "example-competitor.com",
    reviewStatus: "approved",
    revision: 2,
    relationship: "direct",
    analysisScopes: ["keyword_gap", "positioning"],
    originRefs: [
      {
        occurrenceId: ids.csvOrigin,
        originKind: "csv_keyword_gap",
        snapshotId: ids.snapshot,
        observationId: ids.observation,
      },
      {
        occurrenceId: ids.profileOrigin,
        originKind: "product_profile",
        snapshotId: null,
        observationId: null,
      },
      {
        occurrenceId: ids.manual,
        originKind: "manual",
        snapshotId: null,
        observationId: null,
      },
    ],
    ...overrides,
  };
}

function serpOriginRef(
  overrides: Partial<
    (typeof governance.competitors)[number]["originRefs"][number]
  > = {},
): (typeof governance.competitors)[number]["originRefs"][number] {
  return {
    occurrenceId: ids.serpOrigin,
    originKind: "serp_overlap",
    snapshotId: ids.serpSnapshot,
    observationId: ids.serpObservation,
    ...overrides,
  };
}

function aiCitationOriginRef(
  overrides: Partial<
    (typeof governance.competitors)[number]["originRefs"][number]
  > = {},
): (typeof governance.competitors)[number]["originRefs"][number] {
  return {
    occurrenceId: ids.aiOrigin,
    originKind: "ai_citation",
    snapshotId: ids.aiSnapshot,
    observationId: ids.aiObservation,
    ...overrides,
  };
}

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
    const take = () => (this.results.length > 0 ? this.results.shift() : []);
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

function activeProject(confirmedProfileId: string | null = ids.profile) {
  return vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: ids.project,
    workspace_id: ids.workspace,
    confirmed_icp_profile_id: confirmedProfileId,
    archived_at: null,
  } as never);
}

function entity(
  overrides: Partial<CompetitorEntityRow> = {},
): CompetitorEntityRow {
  return {
    id: ids.competitor,
    workspace_id: ids.workspace,
    project_id: ids.project,
    domain: "example-competitor.com",
    name: "Example Competitor",
    review_status: "approved",
    relationship: "direct",
    analysis_scope: ["keyword_gap", "positioning"],
    revision: 2,
    last_observed_at: capturedAt,
    origin_count: 3,
    created_at: capturedAt,
    updated_at: capturedAt,
    ...overrides,
  };
}

function profileOrigin(
  overrides: Partial<CompetitorOriginRow> = {},
): CompetitorOriginRow {
  return {
    id: ids.profileOrigin,
    workspace_id: ids.workspace,
    project_id: ids.project,
    competitor_id: ids.competitor,
    origin_kind: "product_profile",
    source_name: "Example Competitor",
    product_profile_id: ids.profile,
    profile_version: 2,
    candidate_id: ids.candidate,
    field_provenance_path: "/competitorCandidates/0",
    evidence_refs: evidenceRefs,
    source_review_status: "approved",
    source_relationship: "direct",
    source_analysis_scope: ["keyword_gap", "positioning"],
    data_snapshot_id: null,
    normalized_observation_id: null,
    import_preview_id: null,
    source_pointer: null,
    manual_entry_id: null,
    observed_at: null,
    created_at: capturedAt,
    ...overrides,
  };
}

function historicalProfileOrigin(): CompetitorOriginRow {
  return profileOrigin({
    id: ids.historicalProfileOrigin,
    product_profile_id: ids.historicalProfile,
    profile_version: 1,
    candidate_id: ids.historicalCandidate,
    evidence_refs: [
      { evidenceRefId: ids.historicalEvidenceRef, kind: "userEdit" },
    ],
  });
}

function csvOrigin(
  overrides: Partial<CompetitorOriginRow> = {},
): CompetitorOriginRow {
  return {
    id: ids.csvOrigin,
    workspace_id: ids.workspace,
    project_id: ids.project,
    competitor_id: ids.competitor,
    origin_kind: "csv_keyword_gap",
    source_name: null,
    product_profile_id: null,
    profile_version: null,
    candidate_id: null,
    field_provenance_path: null,
    evidence_refs: null,
    source_review_status: null,
    source_relationship: null,
    source_analysis_scope: null,
    data_snapshot_id: ids.snapshot,
    normalized_observation_id: ids.observation,
    import_preview_id: ids.importPreview,
    source_pointer: "/valueJson/competitorDomain",
    manual_entry_id: null,
    observed_at: capturedAt,
    created_at: capturedAt,
    ...overrides,
  };
}

function manualOrigin(
  overrides: Partial<CompetitorOriginRow> = {},
): CompetitorOriginRow {
  return {
    id: ids.manual,
    workspace_id: ids.workspace,
    project_id: ids.project,
    competitor_id: ids.competitor,
    origin_kind: "manual",
    source_name: "Example Competitor",
    product_profile_id: null,
    profile_version: null,
    candidate_id: null,
    field_provenance_path: null,
    evidence_refs: null,
    source_review_status: null,
    source_relationship: null,
    source_analysis_scope: null,
    data_snapshot_id: null,
    normalized_observation_id: null,
    import_preview_id: null,
    source_pointer: null,
    manual_entry_id: ids.manual,
    observed_at: null,
    created_at: capturedAt,
    ...overrides,
  };
}

function serpOrigin(
  overrides: Partial<CompetitorOriginRow> = {},
): CompetitorOriginRow {
  return {
    id: ids.serpOrigin,
    workspace_id: ids.workspace,
    project_id: ids.project,
    competitor_id: ids.competitor,
    origin_kind: "serp_overlap",
    source_name: null,
    product_profile_id: null,
    profile_version: null,
    candidate_id: null,
    field_provenance_path: null,
    evidence_refs: null,
    source_review_status: null,
    source_relationship: null,
    source_analysis_scope: null,
    data_snapshot_id: ids.serpSnapshot,
    normalized_observation_id: ids.serpObservation,
    import_preview_id: null,
    source_pointer: "/valueJson/competitorDomain",
    manual_entry_id: null,
    observed_at: capturedAt,
    created_at: capturedAt,
    ...overrides,
  };
}

function aiCitationOrigin(
  overrides: Partial<CompetitorOriginRow> = {},
): CompetitorOriginRow {
  return {
    id: ids.aiOrigin,
    workspace_id: ids.workspace,
    project_id: ids.project,
    competitor_id: ids.competitor,
    origin_kind: "ai_citation",
    source_name: null,
    product_profile_id: null,
    profile_version: null,
    candidate_id: null,
    field_provenance_path: null,
    evidence_refs: null,
    source_review_status: null,
    source_relationship: null,
    source_analysis_scope: null,
    data_snapshot_id: ids.aiSnapshot,
    normalized_observation_id: ids.aiObservation,
    import_preview_id: null,
    source_pointer: "/valueJson/competitorDomain",
    manual_entry_id: null,
    observed_at: capturedAt,
    created_at: capturedAt,
    ...overrides,
  };
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.profile,
    workspace_id: ids.workspace,
    project_id: ids.project,
    version: 2,
    status: "complete",
    profile: {
      profileSchemaVersion: "product-profile.0.3.0",
      competitorCandidates: [
        {
          candidateId: ids.candidate,
          name: "Example Competitor",
          domain: "example-competitor.com",
          relationship: "direct",
          analysisScope: ["keyword_gap", "positioning"],
          similarity: null,
          reason: "Customer-confirmed direct competitor.",
          reviewStatus: "approved",
          confidence: "high",
        },
      ],
      fieldProvenance: [
        {
          path: "/competitorCandidates/0",
          derivation: "declared",
          confidence: "high",
          evidenceRefs,
          limitation: "Confirmed by the customer.",
          observedAt: null,
        },
      ],
      privateProfilePayload: "must-not-leak-profile",
    },
    ...overrides,
  };
}

function historicalProfileRow() {
  const historicalEvidenceRefs = [
    { evidenceRefId: ids.historicalEvidenceRef, kind: "userEdit" as const },
  ];
  return profileRow({
    id: ids.historicalProfile,
    version: 1,
    profile: {
      ...profileRow().profile,
      competitorCandidates: [
        {
          candidateId: ids.historicalCandidate,
          name: "Example Competitor",
          domain: "example-competitor.com",
          relationship: "direct",
          analysisScope: ["keyword_gap", "positioning"],
          similarity: null,
          reason: "Customer-confirmed direct competitor in V1.",
          reviewStatus: "approved",
          confidence: "high",
        },
      ],
      fieldProvenance: [
        {
          path: "/competitorCandidates/0",
          derivation: "declared",
          confidence: "high",
          evidenceRefs: historicalEvidenceRefs,
          limitation: "Confirmed by the customer in V1.",
          observedAt: null,
        },
      ],
    },
  });
}

function csvObservation(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.observation,
    workspace_id: ids.workspace,
    project_id: ids.project,
    snapshot_id: ids.snapshot,
    site_page_id: null,
    provider: "csv",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    observed_at: capturedAt,
    availability: "available",
    value_json: {
      competitorDomain: "example-competitor.com",
      privateCsvPayload: "must-not-leak-csv",
    },
    origin: "user_provided",
    method: "observed",
    grade: "C",
    support: "supports",
    ...overrides,
  };
}

function csvSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.snapshot,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    collection_run_id: ids.collectionRun,
    source_connection_id: null,
    provider: "csv",
    dataset_key: "csv.keyword_gap.v1",
    method_version: "csv.keyword_gap.v1",
    captured_at: capturedAt,
    availability: "available",
    ...overrides,
  };
}

function csvCollectionRun(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.collectionRun,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    source_connection_id: null,
    provider: "csv",
    operation: "keyword_gap_import",
    method_version: "csv.keyword_gap.v1",
    import_preview_id: ids.importPreview,
    ...overrides,
  };
}

function csvPreview(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.importPreview,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    template_id: "keyword_gap_v1",
    status: "consumed",
    ...overrides,
  };
}

function serpObservation(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.serpObservation,
    workspace_id: ids.workspace,
    project_id: ids.project,
    snapshot_id: ids.serpSnapshot,
    site_page_id: null,
    provider: "dataforseo",
    metric_key: "dataforseo.competitor_domain.v1",
    subject_type: "site",
    subject_ref: "example-competitor.com",
    observed_at: capturedAt,
    availability: "available",
    value_numeric: null,
    value_text: null,
    value_json: {
      targetDomain: "relayops.example",
      competitorDomain: "example-competitor.com",
      intersections: 17,
      averagePosition: 8.5,
      summedPosition: 144,
      organicEstimatedTrafficVolume: 901.25,
      marketCode: "US",
      languageCode: "en",
    },
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "supports",
    ...overrides,
  };
}

function serpSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.serpSnapshot,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    collection_run_id: ids.serpCollectionRun,
    source_connection_id: ids.serpSource,
    provider: "dataforseo",
    dataset_key: "dataforseo.search_landscape.v1",
    schema_version: "dataforseo.search_landscape.v1",
    method_version: "dataforseo.search_landscape.v1",
    captured_at: capturedAt,
    availability: "available",
    ...overrides,
  };
}

function serpCollectionRun(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.serpCollectionRun,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    source_connection_id: ids.serpSource,
    provider: "dataforseo",
    operation: "search_landscape",
    method_version: "dataforseo.search_landscape.v1",
    import_preview_id: null,
    ...overrides,
  };
}

function fallbackSerpObservation(overrides: Record<string, unknown> = {}) {
  return serpObservation({
    metric_key: "dataforseo.serp_competitor.v1",
    value_json: {
      targetDomain: "relayops.example",
      competitorDomain: "example-competitor.com",
      averagePosition: 4.5,
      medianPosition: 4,
      rating: 92,
      organicEstimatedTrafficVolume: 850,
      keywordsCount: 18,
      visibility: 0.74,
      relevantSerpItems: 6,
      seedCount: 3,
      marketCode: "US",
      languageCode: "en",
    },
    ...overrides,
  });
}

function fallbackSerpSnapshot(overrides: Record<string, unknown> = {}) {
  return serpSnapshot({
    dataset_key: "dataforseo.search_landscape.v2",
    schema_version: "dataforseo.search_landscape.v2",
    method_version: "dataforseo.search_landscape.v2",
    ...overrides,
  });
}

function fallbackSerpCollectionRun(overrides: Record<string, unknown> = {}) {
  return serpCollectionRun({
    method_version: "dataforseo.search_landscape.v2",
    ...overrides,
  });
}

function canonicalOverlapObservation(overrides: Record<string, unknown> = {}) {
  return serpObservation({
    metric_key: "dataforseo.competitor_domain.v2",
    value_json: {
      ...serpObservation().value_json,
      targetOrganicKeywordCount: 100,
      serpOverlap: 0.17,
    },
    limitation:
      "Organic positions 1-100 in one exact US/en provider snapshot.",
    ...overrides,
  });
}

function searchLandscapeV3Snapshot(overrides: Record<string, unknown> = {}) {
  return serpSnapshot({
    dataset_key: "dataforseo.search_landscape.v3",
    schema_version: "dataforseo.search_landscape.v3",
    method_version: "dataforseo.search_landscape.v3",
    ...overrides,
  });
}

function searchLandscapeV3CollectionRun(
  overrides: Record<string, unknown> = {},
) {
  return serpCollectionRun({
    method_version: "dataforseo.search_landscape.v3",
    ...overrides,
  });
}

function aiCitationObservation(overrides: Record<string, unknown> = {}) {
  return serpObservation({
    id: ids.aiObservation,
    snapshot_id: ids.aiSnapshot,
    metric_key: "dataforseo.competitor_ai_citation.v1",
    value_json: {
      targetDomain: "relayops.example",
      competitorDomain: "example-competitor.com",
      attemptedQueries: 20,
      observedQueries: 17,
      citedQueries: 8,
      unavailableQueries: 3,
      cohortCoverage: "partial",
      querySetHash: "a".repeat(64),
      platform: "chat_gpt",
      model: "gpt-5",
      marketCode: "US",
      languageTag: "en-US",
      queryOutcomes: Array.from({ length: 20 }, (_, index) => ({
        queryEntityId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        queryRevision: index + 1,
        queryHash: String(index + 1).padStart(64, "0"),
        availability: index < 17 ? "available" : "unavailable",
        cited: index < 8,
      })),
    },
    limitation:
      "17 of 20 fixed prompts were observed; 3 were unavailable.",
    ...overrides,
  });
}

function aiCitationSnapshot(overrides: Record<string, unknown> = {}) {
  return searchLandscapeV3Snapshot({
    id: ids.aiSnapshot,
    collection_run_id: ids.aiCollectionRun,
    ...overrides,
  });
}

function aiCitationCollectionRun(overrides: Record<string, unknown> = {}) {
  return searchLandscapeV3CollectionRun({
    id: ids.aiCollectionRun,
    ...overrides,
  });
}

interface SerpProjectionDrift {
  readonly origin?: Partial<CompetitorOriginRow>;
  readonly observation?: Record<string, unknown>;
  readonly snapshot?: Record<string, unknown>;
  readonly run?: Record<string, unknown>;
}

const serpProjectionDrifts: ReadonlyArray<
  readonly [string, SerpProjectionDrift]
> = [
  [
    "a legacy DataForSEO operation",
    { run: { operation: "keyword_gap_import" } },
  ],
  [
    "a mixed Snapshot dataset",
    { snapshot: { dataset_key: "dataforseo.ranked_keywords.v1" } },
  ],
  [
    "a mixed Observation metric",
    { observation: { metric_key: "csv.keyword_gap.v1" } },
  ],
  [
    "a foreign subject domain",
    { observation: { subject_ref: "other-competitor.example" } },
  ],
  [
    "a non-exact valueJson shape",
    {
      observation: {
        value_json: {
          ...serpObservation().value_json,
          undocumentedVendorField: "must-not-pass",
        },
      },
    },
  ],
  [
    "a non-canonical origin pointer",
    { origin: { source_pointer: "/valueJson/intersections" } },
  ],
  [
    "a captured/observed mismatch",
    { observation: { observed_at: "2026-07-22T08:00:01.000Z" } },
  ],
];

function arrangeList(input: {
  readonly entity?: CompetitorEntityRow;
  readonly origins?: readonly CompetitorOriginRow[];
  readonly governanceCompetitors?: typeof governance.competitors;
  readonly generationRunId?: string;
  readonly nextCursor?: string | null;
  readonly queryResults?: readonly unknown[];
  readonly confirmedProfileId?: string | null;
} = {}) {
  activeProject(input.confirmedProfileId);
  const selected = input.entity ?? entity();
  const generationRunId = input.generationRunId ?? "published-run";
  mocks.loadPublishedGrowthMapGeneration.mockResolvedValue({
    run: { id: generationRunId },
    frozen: { runId: generationRunId },
    governance: {
      ...governance,
      competitors: [...(input.governanceCompetitors ?? governance.competitors)],
    },
  });
  vi.spyOn(CompetitorsRepository.prototype, "listByIds").mockResolvedValue([
    selected,
  ]);
  vi.spyOn(CompetitorsRepository.prototype, "listByIdsPage").mockResolvedValue({
    rows: [selected],
    nextCursor: input.nextCursor ?? null,
  });
  vi.spyOn(CompetitorsRepository.prototype, "listByProject").mockResolvedValue({
    rows: [selected],
    nextCursor: input.nextCursor ?? null,
  });
  vi.spyOn(CompetitorsRepository.prototype, "listOriginsByIds").mockResolvedValue(
    [...(input.origins ?? [csvOrigin(), profileOrigin(), manualOrigin()])],
  );
  const exec = new FakeExecutor();
  exec.enqueue(
    ...(input.queryResults ?? [
      [profileRow()],
      [csvObservation()],
      [csvSnapshot()],
      [csvCollectionRun()],
      [csvPreview()],
    ]),
  );
  return exec;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getDb.mockReset();
  mocks.loadPublishedGrowthMapGeneration.mockReset();
});

describe("Growth Map Competitor Library read service", () => {
  it("lists the current canonical competitor when it is absent from the published generation", async () => {
    const exec = arrangeList({ governanceCompetitors: [] });
    vi.spyOn(CompetitorsRepository.prototype, "listOrigins").mockResolvedValue([
      csvOrigin(),
      profileOrigin(),
      manualOrigin(),
    ]);

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: null },
      exec as never,
    );

    expect(response.data).toEqual([
      expect.objectContaining({
        competitorId: ids.competitor,
        domain: "example-competitor.com",
        reviewStatus: "approved",
      }),
    ]);
    expect(CompetitorsRepository.prototype.listByProject).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      { limit: 50, cursor: null },
    );
    expect(mocks.loadPublishedGrowthMapGeneration).not.toHaveBeenCalled();
  });

  it("selects one exact older published generation for the list without falling forward", async () => {
    const exec = arrangeList({
      generationRunId: ids.olderRun,
      governanceCompetitors: [
        governanceCompetitor({
          reviewStatus: "candidate",
          revision: 1,
          relationship: null,
          analysisScopes: [],
        }),
      ],
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: ids.olderRun },
      exec as never,
    );

    expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenCalledWith(
      exec,
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.olderRun,
    );
    expect(response.data[0]).toMatchObject({
      reviewStatus: "candidate",
      revision: 1,
      relationship: null,
      analysisScope: [],
    });
  });

  it.each(["list", "detail"] as const)(
    "fails closed when the generation loader returns a different run for an exact %s pin",
    async (kind) => {
      activeProject();
      mocks.loadPublishedGrowthMapGeneration.mockResolvedValue({
        run: { id: ids.latestRun },
        frozen: { runId: ids.latestRun },
        governance,
      });
      const listByIds = vi.spyOn(
        CompetitorsRepository.prototype,
        "listByIds",
      );
      const exec = new FakeExecutor();

      await expect(
        kind === "list"
          ? listProjectAuditCompetitors(
              scope,
              ids.project,
              {
                limit: 50,
                cursor: null,
                diagnosticRunId: ids.olderRun,
              },
              exec as never,
            )
          : getProjectAuditCompetitor(
              scope,
              ids.project,
              ids.competitor,
              { diagnosticRunId: ids.olderRun },
              exec as never,
            ),
      ).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        status: 503,
      });
      expect(listByIds).not.toHaveBeenCalled();
    },
  );

  it.each(["list", "detail"] as const)(
    "rejects a non-canonical diagnosticRunId before database access for %s",
    async (kind) => {
      const invalidRunId = "10000000-0000-7000-8000-00000000000A";
      const project = vi.spyOn(
        ProjectsRepository.prototype,
        "findById",
      );

      await expect(
        kind === "list"
          ? listProjectAuditCompetitors(scope, ids.project, {
              limit: 50,
              cursor: null,
              diagnosticRunId: invalidRunId,
            })
          : getProjectAuditCompetitor(
              scope,
              ids.project,
              ids.competitor,
              { diagnosticRunId: invalidRunId },
            ),
      ).rejects.toThrow("diagnosticRunId must be a canonical UUID");
      expect(project).not.toHaveBeenCalled();
      expect(mocks.getDb).not.toHaveBeenCalled();
      expect(
        mocks.loadPublishedGrowthMapGeneration,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["foreign", ids.foreignRun],
    ["unpublished", ids.unpublishedRun],
  ])(
    "fails closed for a %s exact list generation and never retries latest",
    async (_label, diagnosticRunId) => {
      activeProject();
      const notPublished = new ProblemError(
        "GROWTH_MAP_AUDIT_NOT_FOUND",
        "No completed Growth Map audit is available for this project.",
      );
      mocks.loadPublishedGrowthMapGeneration.mockRejectedValue(notPublished);
      const listByIds = vi.spyOn(
        CompetitorsRepository.prototype,
        "listByIds",
      );

      await expect(
        listProjectAuditCompetitors(
          scope,
          ids.project,
          { limit: 50, cursor: null, diagnosticRunId },
          new FakeExecutor() as never,
        ),
      ).rejects.toBe(notPublished);

      expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenCalledTimes(1);
      expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenCalledWith(
        expect.anything(),
        { workspaceId: ids.workspace, projectId: ids.project },
        diagnosticRunId,
      );
      expect(
        mocks.loadPublishedGrowthMapGeneration.mock.calls.some(
          (call) => call[2] === null || call[2] === undefined,
        ),
      ).toBe(false);
      expect(listByIds).not.toHaveBeenCalled();
    },
  );

  it("uses one repeatable-read, read-only snapshot when no executor is supplied", async () => {
    const exec = new FakeExecutor();
    activeProject(null);
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue({
      run: { id: "published-run" },
      frozen: { runId: "published-run" },
      governance: { ...governance, competitors: [] },
    });
    vi.spyOn(CompetitorsRepository.prototype, "listByIdsPage").mockResolvedValue({
      rows: [],
      nextCursor: null,
    });
    const transaction = vi.fn(
      async (callback: (selected: FakeExecutor) => Promise<unknown>) =>
        callback(exec),
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
    );

    expect(response.data).toEqual([]);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  });

  it("projects exact Product Profile, CSV, and manual origins without synthetic insights", async () => {
    const exec = arrangeList();

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.projectId).toBe(ids.project);
    expect(response.data).toHaveLength(1);
    const item = response.data[0]!;
    expect(item).toMatchObject({
      projectId: ids.project,
      competitorId: ids.competitor,
      domain: "example-competitor.com",
      name: null,
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["keyword_gap", "positioning"],
      revision: 2,
      lastObservedAt: capturedAt,
      serpOverlap: {
        availability: "unavailable",
        value: null,
        limitation: expect.stringMatching(
          /no immutable.*source.*recorded.*no canonical derived.*ratio/i,
        ),
      },
      aiCitationInsight: {
        availability: "unavailable",
        value: null,
        limitation: expect.stringMatching(
          /no immutable.*ai-citation aggregate.*not a measured zero/i,
        ),
      },
      coverage: { availability: "partial" },
    });
    expect(
      item.coverage.limitations.some((limitation) =>
        /display name is unavailable.*froze/i.test(limitation),
      ),
    ).toBe(true);
    expect(item.originOccurrences).toEqual(
      expect.arrayContaining([
        {
          occurrenceId: ids.profileOrigin,
          originKind: "product_profile",
          productProfileId: ids.profile,
          profileVersion: 2,
          candidateId: ids.candidate,
          fieldProvenancePath: "/competitorCandidates/0",
          evidenceRefs,
          observedAt: null,
        },
        {
          occurrenceId: ids.csvOrigin,
          originKind: "csv_keyword_gap",
          snapshotId: ids.snapshot,
          observationId: ids.observation,
          sourcePointer: "/valueJson/competitorDomain",
          importPreviewId: ids.importPreview,
          observedAt: capturedAt,
          evidenceRefs: [],
        },
        {
          occurrenceId: ids.manual,
          originKind: "manual",
          manualEntryId: ids.manual,
          observedAt: null,
          evidenceRefs: [],
        },
      ]),
    );
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("must-not-leak-profile");
    expect(serialized).not.toContain("must-not-leak-csv");
    expect(serialized).not.toContain("privateProfilePayload");
    expect(serialized).not.toContain("privateCsvPayload");
  });

  it("projects one exact DataForSEO competitor-domain origin from a pinned published generation without inventing a ratio", async () => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [serpOrigin()],
      governanceCompetitors: [
        governanceCompetitor({
          originRefs: [
            {
              occurrenceId: ids.serpOrigin,
              originKind: "serp_overlap",
              snapshotId: ids.serpSnapshot,
              observationId: ids.serpObservation,
            },
          ],
        }),
      ],
      generationRunId: ids.olderRun,
      queryResults: [
        [serpObservation()],
        [serpSnapshot()],
        [serpCollectionRun()],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      {
        limit: 50,
        cursor: null,
        diagnosticRunId: ids.olderRun,
      },
      exec as never,
    );

    expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenCalledWith(
      exec,
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.olderRun,
    );
    expect(response.data[0]).toMatchObject({
      competitorId: ids.competitor,
      lastObservedAt: capturedAt,
      originOccurrences: [
        {
          occurrenceId: ids.serpOrigin,
          originKind: "serp_overlap",
          snapshotId: ids.serpSnapshot,
          observationId: ids.serpObservation,
          evidenceRefs: [],
          observedAt: capturedAt,
        },
      ],
      serpOverlap: {
        availability: "unavailable",
        value: null,
        limitation: expect.stringMatching(
          /immutable.*source.*recorded.*no canonical derived.*ratio/i,
        ),
      },
      aiCitationInsight: {
        availability: "unavailable",
        value: null,
        limitation: expect.stringMatching(
          /no immutable.*ai-citation aggregate.*not a measured zero/i,
        ),
      },
    });
    expect(
      response.data[0]?.coverage.limitations.some((limitation) =>
        /immutable.*source.*recorded.*no canonical derived.*ratio/i.test(
          limitation,
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(response)).not.toMatch(/no canonical serp-overlap writer/i);
  });

  it("projects organic overlap only from the exact persisted v2 operands and ratio", async () => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [serpOrigin()],
      governanceCompetitors: [
        governanceCompetitor({ originRefs: [serpOriginRef()] }),
      ],
      generationRunId: ids.olderRun,
      queryResults: [
        [canonicalOverlapObservation()],
        [searchLandscapeV3Snapshot()],
        [searchLandscapeV3CollectionRun()],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: ids.olderRun },
      exec as never,
    );

    expect(response.data[0]?.serpOverlap).toEqual({
      availability: "available",
      value: 0.17,
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      valuePointer: "/valueJson/serpOverlap",
      observedAt: capturedAt,
      limitation:
        "Organic positions 1-100 in one exact US/en provider snapshot.",
    });
    expect(response.data[0]?.sharedKeywordInsight).toMatchObject({
      availability: "available",
      value: 17,
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
    });
  });

  it("accepts the canonical positive half-up 12-decimal organic overlap ratio", async () => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [serpOrigin()],
      governanceCompetitors: [
        governanceCompetitor({ originRefs: [serpOriginRef()] }),
      ],
      queryResults: [
        [
          canonicalOverlapObservation({
            value_json: {
              ...canonicalOverlapObservation().value_json,
              intersections: 2,
              targetOrganicKeywordCount: 3,
              serpOverlap: 0.666666666667,
            },
          }),
        ],
        [searchLandscapeV3Snapshot()],
        [searchLandscapeV3CollectionRun()],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.serpOverlap).toMatchObject({
      availability: "available",
      value: 0.666666666667,
    });
  });

  it.each([
    [
      "a ratio that does not equal its frozen operands",
      { value_json: { ...canonicalOverlapObservation().value_json, serpOverlap: 0.18 } },
    ],
    [
      "a shared-keyword numerator above its frozen denominator",
      {
        value_json: {
          ...canonicalOverlapObservation().value_json,
          intersections: 101,
          serpOverlap: 1.01,
        },
      },
    ],
    ["a foreign competitor domain", { subject_ref: "other.example" }],
    ["a different Snapshot", { snapshot_id: ids.aiSnapshot }],
    [
      "a captured/observed mismatch",
      { observed_at: "2026-07-22T08:00:01.000Z" },
    ],
  ])("fails closed for canonical organic overlap with %s", async (_label, observationDrift) => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [serpOrigin()],
      governanceCompetitors: [
        governanceCompetitor({ originRefs: [serpOriginRef()] }),
      ],
      queryResults: [
        [canonicalOverlapObservation(observationDrift)],
        [searchLandscapeV3Snapshot()],
        [searchLandscapeV3CollectionRun()],
      ],
      confirmedProfileId: null,
    });

    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        exec as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("projects the exact persisted fixed-20 AI citation aggregate and its partiality limitation", async () => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [aiCitationOrigin()],
      governanceCompetitors: [
        governanceCompetitor({ originRefs: [aiCitationOriginRef()] }),
      ],
      generationRunId: ids.olderRun,
      queryResults: [
        [aiCitationObservation()],
        [aiCitationSnapshot()],
        [aiCitationCollectionRun()],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: ids.olderRun },
      exec as never,
    );

    expect(response.data[0]?.originOccurrences).toEqual([
      {
        occurrenceId: ids.aiOrigin,
        originKind: "ai_citation",
        snapshotId: ids.aiSnapshot,
        observationId: ids.aiObservation,
        evidenceRefs: [],
        observedAt: capturedAt,
      },
    ]);
    expect(response.data[0]?.aiCitationInsight).toEqual({
      availability: "available",
      value: 8,
      attemptedQueries: 20,
      observedQueries: 17,
      unavailableQueries: 3,
      cohortCoverage: "partial",
      querySetHash: "a".repeat(64),
      platform: "chat_gpt",
      model: "gpt-5",
      marketCode: "US",
      languageTag: "en-US",
      snapshotId: ids.aiSnapshot,
      observationId: ids.aiObservation,
      valuePointer: "/valueJson/citedQueries",
      observedAt: capturedAt,
      limitation:
        "17 of 20 fixed prompts were observed; 3 were unavailable.",
    });
  });

  it("projects a complete AI citation cohort from current immutable lineage with no partiality limitation", async () => {
    const baseValue = aiCitationObservation().value_json as Record<
      string,
      unknown
    >;
    const queryOutcomes = (
      baseValue["queryOutcomes"] as Array<Record<string, unknown>>
    ).map((outcome, index) => ({
      ...outcome,
      availability: "available",
      cited: index < 8,
    }));
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [aiCitationOrigin()],
      queryResults: [
        [
          aiCitationObservation({
            value_json: {
              ...baseValue,
              observedQueries: 20,
              unavailableQueries: 0,
              cohortCoverage: "complete",
              queryOutcomes,
            },
            limitation:
              "Complete fixed-20 ChatGPT web-search cohort in US/en-US.",
          }),
        ],
        [aiCitationSnapshot({ availability: "available" })],
        [aiCitationCollectionRun()],
      ],
      confirmedProfileId: null,
    });
    vi.spyOn(CompetitorsRepository.prototype, "listOrigins").mockResolvedValue([
      aiCitationOrigin(),
    ]);

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: null },
      exec as never,
    );

    expect(mocks.loadPublishedGrowthMapGeneration).not.toHaveBeenCalled();
    expect(response.data[0]?.aiCitationInsight).toMatchObject({
      availability: "available",
      value: 8,
      attemptedQueries: 20,
      observedQueries: 20,
      unavailableQueries: 0,
      cohortCoverage: "complete",
      limitation: null,
    });
  });

  it("reports a persisted measured AI-citation zero only when at least one fixed-cohort query was observed", async () => {
    const baseValue = aiCitationObservation().value_json as Record<
      string,
      unknown
    >;
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [aiCitationOrigin()],
      governanceCompetitors: [
        governanceCompetitor({ originRefs: [aiCitationOriginRef()] }),
      ],
      queryResults: [
        [
          aiCitationObservation({
            value_json: {
              ...baseValue,
              citedQueries: 0,
              queryOutcomes: (
                baseValue["queryOutcomes"] as Array<Record<string, unknown>>
              ).map((outcome) => ({ ...outcome, cited: false })),
            },
          }),
        ],
        [aiCitationSnapshot()],
        [aiCitationCollectionRun()],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.aiCitationInsight).toMatchObject({
      availability: "available",
      value: 0,
      attemptedQueries: 20,
      observedQueries: 17,
      unavailableQueries: 3,
    });
  });

  it.each([
    [
      "zero observed queries",
      {
        observedQueries: 0,
        citedQueries: 0,
        unavailableQueries: 20,
        cohortCoverage: "partial",
      },
    ],
    ["inconsistent query arithmetic", { unavailableQueries: 2 }],
    ["citations above observed answers", { citedQueries: 18 }],
    ["a noncanonical language tag", { languageTag: "EN-us" }],
    [
      "duplicate frozen query hashes",
      {
        queryOutcomes: (
          (aiCitationObservation().value_json as Record<string, unknown>)[
            "queryOutcomes"
          ] as Array<Record<string, unknown>>
        ).map((outcome, index) => ({
          ...outcome,
          queryHash: index < 2 ? "f".repeat(64) : outcome["queryHash"],
        })),
      },
    ],
  ])("fails closed for an AI citation aggregate with %s", async (_label, valueDrift) => {
    const baseValue = aiCitationObservation().value_json as Record<
      string,
      unknown
    >;
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [aiCitationOrigin()],
      governanceCompetitors: [
        governanceCompetitor({ originRefs: [aiCitationOriginRef()] }),
      ],
      queryResults: [
        [
          aiCitationObservation({
            value_json: { ...baseValue, ...valueDrift },
          }),
        ],
        [aiCitationSnapshot()],
        [aiCitationCollectionRun()],
      ],
      confirmedProfileId: null,
    });

    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        exec as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("projects one exact v2 paid SERP-competitor origin without claiming domain overlap", async () => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [serpOrigin()],
      governanceCompetitors: [
        governanceCompetitor({
          originRefs: [
            {
              occurrenceId: ids.serpOrigin,
              originKind: "serp_overlap",
              snapshotId: ids.serpSnapshot,
              observationId: ids.serpObservation,
            },
          ],
        }),
      ],
      generationRunId: ids.olderRun,
      queryResults: [
        [fallbackSerpObservation()],
        [fallbackSerpSnapshot()],
        [fallbackSerpCollectionRun()],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      {
        limit: 50,
        cursor: null,
        diagnosticRunId: ids.olderRun,
      },
      exec as never,
    );

    expect(response.data[0]).toMatchObject({
      competitorId: ids.competitor,
      originOccurrences: [
        {
          occurrenceId: ids.serpOrigin,
          originKind: "serp_overlap",
          snapshotId: ids.serpSnapshot,
          observationId: ids.serpObservation,
          evidenceRefs: [],
          observedAt: capturedAt,
        },
      ],
    });
    expect(JSON.stringify(response)).not.toMatch(/17|intersections/iu);
  });

  it("projects the exact DataForSEO competitors-domain count as the shared-keyword insight", async () => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [serpOrigin()],
      governanceCompetitors: [
        governanceCompetitor({ originRefs: [serpOriginRef()] }),
      ],
      generationRunId: ids.olderRun,
      queryResults: [
        [serpObservation()],
        [serpSnapshot()],
        [serpCollectionRun()],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: ids.olderRun },
      exec as never,
    );

    const item = response.data[0]!;
    expect(item.sharedKeywordInsight).toEqual({
      availability: "available",
      value: 17,
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      valuePointer: "/valueJson/intersections",
      observedAt: capturedAt,
      limitation: expect.stringMatching(/top 20 organic results/iu),
    });
    expect(item.originOccurrences).toContainEqual(
      expect.objectContaining({
        originKind: "serp_overlap",
        snapshotId: ids.serpSnapshot,
        observationId: ids.serpObservation,
        observedAt: capturedAt,
      }),
    );
    expect(item.coverage.limitations).toContain(
      item.sharedKeywordInsight.limitation,
    );
  });

  it("projects the shared-keyword insight from the live review detail", async () => {
    activeProject(null);
    vi.spyOn(CompetitorsRepository.prototype, "findById").mockResolvedValue(
      entity({ name: null, origin_count: 1 }),
    );
    vi.spyOn(CompetitorsRepository.prototype, "listOrigins").mockResolvedValue([
      serpOrigin(),
    ]);
    const exec = new FakeExecutor();
    exec.enqueue([serpObservation()], [serpSnapshot()], [serpCollectionRun()]);

    const response = await getProjectAuditCompetitorReviewDetail(
      scope,
      ids.project,
      ids.competitor,
      exec as never,
    );

    expect(response.data.sharedKeywordInsight).toEqual({
      availability: "available",
      value: 17,
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      valuePointer: "/valueJson/intersections",
      observedAt: capturedAt,
      limitation: expect.stringMatching(/top 20 organic results/iu),
    });
    expect(response.data.coverage.limitations).toContain(
      response.data.sharedKeywordInsight.limitation,
    );
  });

  it("keeps the shared-keyword insight unavailable when only a v2 SERP-competitor Observation is recorded", async () => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [serpOrigin()],
      governanceCompetitors: [
        governanceCompetitor({ originRefs: [serpOriginRef()] }),
      ],
      generationRunId: ids.olderRun,
      queryResults: [
        [fallbackSerpObservation()],
        [fallbackSerpSnapshot()],
        [fallbackSerpCollectionRun()],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: ids.olderRun },
      exec as never,
    );

    expect(response.data[0]?.sharedKeywordInsight).toEqual({
      availability: "unavailable",
      value: null,
      limitation: expect.stringMatching(
        /none of its Observations carries a readable competitors-domain shared-keyword count/iu,
      ),
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("keywordsCount");
    expect(serialized).not.toMatch(/17|intersections/iu);
  });

  it("selects the competitors-domain Observation when one v2 Snapshot records both SERP origins", async () => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 2 }),
      origins: [
        serpOrigin({
          id: ids.serpFallbackOrigin,
          normalized_observation_id: ids.serpFallbackObservation,
        }),
        serpOrigin(),
      ],
      governanceCompetitors: [
        governanceCompetitor({
          originRefs: [
            serpOriginRef({
              occurrenceId: ids.serpFallbackOrigin,
              observationId: ids.serpFallbackObservation,
            }),
            serpOriginRef(),
          ],
        }),
      ],
      generationRunId: ids.olderRun,
      queryResults: [
        [
          fallbackSerpObservation({ id: ids.serpFallbackObservation }),
          serpObservation(),
        ],
        [fallbackSerpSnapshot()],
        [fallbackSerpCollectionRun()],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: ids.olderRun },
      exec as never,
    );

    expect(response.data[0]?.sharedKeywordInsight).toEqual({
      availability: "available",
      value: 17,
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      valuePointer: "/valueJson/intersections",
      observedAt: capturedAt,
      limitation: expect.stringMatching(/top 100 organic results/iu),
    });
    expect(JSON.stringify(response)).not.toContain("keywordsCount");
  });

  it("projects the newest readable shared-keyword Observation when several were collected", async () => {
    const olderCapturedAt = "2026-07-15T08:00:00.000Z";
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 2 }),
      origins: [
        serpOrigin({
          id: ids.olderSerpOrigin,
          data_snapshot_id: ids.olderSerpSnapshot,
          normalized_observation_id: ids.olderSerpObservation,
          observed_at: olderCapturedAt,
        }),
        serpOrigin(),
      ],
      governanceCompetitors: [
        governanceCompetitor({
          originRefs: [
            serpOriginRef({
              occurrenceId: ids.olderSerpOrigin,
              snapshotId: ids.olderSerpSnapshot,
              observationId: ids.olderSerpObservation,
            }),
            serpOriginRef(),
          ],
        }),
      ],
      generationRunId: ids.olderRun,
      queryResults: [
        [
          serpObservation({
            id: ids.olderSerpObservation,
            snapshot_id: ids.olderSerpSnapshot,
            observed_at: olderCapturedAt,
            value_json: {
              ...serpObservation().value_json,
              intersections: 5,
            },
          }),
          serpObservation(),
        ],
        [
          serpSnapshot({
            id: ids.olderSerpSnapshot,
            collection_run_id: ids.olderSerpCollectionRun,
            captured_at: olderCapturedAt,
          }),
          serpSnapshot(),
        ],
        [
          serpCollectionRun({ id: ids.olderSerpCollectionRun }),
          serpCollectionRun(),
        ],
      ],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null, diagnosticRunId: ids.olderRun },
      exec as never,
    );

    expect(response.data[0]?.sharedKeywordInsight).toEqual({
      availability: "available",
      value: 17,
      snapshotId: ids.serpSnapshot,
      observationId: ids.serpObservation,
      valuePointer: "/valueJson/intersections",
      observedAt: capturedAt,
      limitation: expect.stringMatching(/top 20 organic results/iu),
    });
  });

  it("reports the shared-keyword insight as unavailable when no DataForSEO competitors-domain source exists", async () => {
    const exec = arrangeList();

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    const item = response.data[0]!;
    expect(item.sharedKeywordInsight).toEqual({
      availability: "unavailable",
      value: null,
      limitation: expect.stringMatching(
        /no immutable dataforseo competitors-domain observation is recorded/iu,
      ),
    });
    expect(item.sharedKeywordInsight.limitation).toMatch(
      /not a measured zero/iu,
    );
    expect(item.coverage.limitations).toContain(
      item.sharedKeywordInsight.limitation,
    );
  });

  it("fails closed instead of reporting a zero shared-keyword count", async () => {
    const exec = arrangeList({
      entity: entity({ name: null, origin_count: 1 }),
      origins: [serpOrigin()],
      governanceCompetitors: [
        governanceCompetitor({ originRefs: [serpOriginRef()] }),
      ],
      queryResults: [
        [
          serpObservation({
            value_json: {
              ...serpObservation().value_json,
              intersections: 0,
            },
          }),
        ],
        [serpSnapshot()],
        [serpCollectionRun()],
      ],
      confirmedProfileId: null,
    });

    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        exec as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("projects the exact DataForSEO origin in the live review detail without widening it into a derived insight", async () => {
    activeProject(null);
    vi.spyOn(CompetitorsRepository.prototype, "findById").mockResolvedValue(
      entity({ name: null, origin_count: 1 }),
    );
    vi.spyOn(CompetitorsRepository.prototype, "listOrigins").mockResolvedValue([
      serpOrigin(),
    ]);
    const exec = new FakeExecutor();
    exec.enqueue(
      [serpObservation()],
      [serpSnapshot()],
      [serpCollectionRun()],
    );

    const response = await getProjectAuditCompetitorReviewDetail(
      scope,
      ids.project,
      ids.competitor,
      exec as never,
    );

    expect(response.data.originOccurrences).toEqual([
      {
        occurrenceId: ids.serpOrigin,
        originKind: "serp_overlap",
        snapshotId: ids.serpSnapshot,
        observationId: ids.serpObservation,
        evidenceRefs: [],
        observedAt: capturedAt,
      },
    ]);
    expect(response.data.serpOverlap).toEqual({
      availability: "unavailable",
      value: null,
      limitation: expect.stringMatching(
        /immutable.*source.*recorded.*no canonical derived.*ratio/i,
      ),
    });
  });

  it.each(serpProjectionDrifts)(
    "fails closed for DataForSEO lineage mixed with %s",
    async (_label, drift) => {
      const exec = arrangeList({
        entity: entity({ name: null, origin_count: 1 }),
        origins: [serpOrigin(drift.origin)],
        governanceCompetitors: [
          governanceCompetitor({
            originRefs: [
              {
                occurrenceId: ids.serpOrigin,
                originKind: "serp_overlap",
                snapshotId: ids.serpSnapshot,
                observationId: ids.serpObservation,
              },
            ],
          }),
        ],
        queryResults: [
          [serpObservation(drift.observation)],
          [serpSnapshot(drift.snapshot)],
          [serpCollectionRun(drift.run)],
        ],
        confirmedProfileId: null,
      });

      await expect(
        listProjectAuditCompetitors(
          scope,
          ids.project,
          { limit: 50, cursor: null },
          exec as never,
        ),
      ).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        status: 503,
      });
    },
  );

  it("does not widen an older frozen generation with a newer live DataForSEO origin", async () => {
    const exec = arrangeList({
      entity: entity({ origin_count: 2 }),
      origins: [manualOrigin()],
      governanceCompetitors: [
        governanceCompetitor({
          originRefs: [
            {
              occurrenceId: ids.manual,
              originKind: "manual",
              snapshotId: null,
              observationId: null,
            },
          ],
        }),
      ],
      generationRunId: ids.olderRun,
      queryResults: [],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      {
        limit: 50,
        cursor: null,
        diagnosticRunId: ids.olderRun,
      },
      exec as never,
    );

    expect(
      vi.mocked(CompetitorsRepository.prototype.listOriginsByIds),
    ).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      [ids.manual],
    );
    expect(response.data[0]?.originOccurrences).toEqual([
      {
        occurrenceId: ids.manual,
        originKind: "manual",
        manualEntryId: ids.manual,
        evidenceRefs: [],
        observedAt: null,
      },
    ]);
  });

  it("projects a valid immutable V1 origin after the project confirms V2", async () => {
    const exec = arrangeList({
      entity: entity({ last_observed_at: null, origin_count: 1 }),
      origins: [historicalProfileOrigin()],
      governanceCompetitors: [
        governanceCompetitor({
          originRefs: [
            {
              occurrenceId: ids.historicalProfileOrigin,
              originKind: "product_profile",
              snapshotId: null,
              observationId: null,
            },
          ],
        }),
      ],
      queryResults: [[historicalProfileRow()]],
      confirmedProfileId: ids.profile,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.originOccurrences).toEqual([
      {
        occurrenceId: ids.historicalProfileOrigin,
        originKind: "product_profile",
        productProfileId: ids.historicalProfile,
        profileVersion: 1,
        candidateId: ids.historicalCandidate,
        fieldProvenancePath: "/competitorCandidates/0",
        evidenceRefs: [
          { evidenceRefId: ids.historicalEvidenceRef, kind: "userEdit" },
        ],
        observedAt: null,
      },
    ]);
  });

  it("preserves mixed CSV, historical V1, and current V2 origin history", async () => {
    const exec = arrangeList({
      origins: [csvOrigin(), historicalProfileOrigin(), profileOrigin()],
      governanceCompetitors: [
        governanceCompetitor({
          originRefs: [
            {
              occurrenceId: ids.csvOrigin,
              originKind: "csv_keyword_gap",
              snapshotId: ids.snapshot,
              observationId: ids.observation,
            },
            {
              occurrenceId: ids.historicalProfileOrigin,
              originKind: "product_profile",
              snapshotId: null,
              observationId: null,
            },
            {
              occurrenceId: ids.profileOrigin,
              originKind: "product_profile",
              snapshotId: null,
              observationId: null,
            },
          ],
        }),
      ],
      queryResults: [
        [historicalProfileRow(), profileRow()],
        [csvObservation()],
        [csvSnapshot()],
        [csvCollectionRun()],
        [csvPreview()],
      ],
      confirmedProfileId: ids.profile,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.originOccurrences).toHaveLength(3);
    expect(response.data[0]?.originOccurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          occurrenceId: ids.csvOrigin,
          originKind: "csv_keyword_gap",
        }),
        expect.objectContaining({
          occurrenceId: ids.historicalProfileOrigin,
          originKind: "product_profile",
          productProfileId: ids.historicalProfile,
          profileVersion: 1,
          candidateId: ids.historicalCandidate,
        }),
        expect.objectContaining({
          occurrenceId: ids.profileOrigin,
          originKind: "product_profile",
          productProfileId: ids.profile,
          profileVersion: 2,
          candidateId: ids.candidate,
        }),
      ]),
    );
  });

  it("returns the same scoped projection from detail", async () => {
    activeProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue({
      run: { id: "published-run" },
      frozen: { runId: "published-run" },
      governance,
    });
    vi.spyOn(CompetitorsRepository.prototype, "listByIds").mockResolvedValue([
      entity(),
    ]);
    vi.spyOn(CompetitorsRepository.prototype, "listOriginsByIds").mockResolvedValue([
      csvOrigin(),
      profileOrigin(),
      manualOrigin(),
    ]);
    const exec = new FakeExecutor();
    exec.enqueue(
      [profileRow()],
      [csvObservation()],
      [csvSnapshot()],
      [csvCollectionRun()],
      [csvPreview()],
    );

    const response = await getProjectAuditCompetitor(
      scope,
      ids.project,
      ids.competitor,
      exec as never,
    );

    expect(response).toMatchObject({
      projectId: ids.project,
      data: {
        competitorId: ids.competitor,
        name: null,
        lastObservedAt: capturedAt,
      },
    });
    expect(
      response.data.coverage.limitations.some((limitation) =>
        /display name is unavailable.*froze/i.test(limitation),
      ),
    ).toBe(true);
  });

  it("selects one exact older published generation for detail", async () => {
    activeProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue({
      run: { id: ids.olderRun },
      frozen: { runId: ids.olderRun },
      governance: {
        ...governance,
        competitors: [
          governanceCompetitor({
            reviewStatus: "candidate",
            revision: 1,
            relationship: null,
            analysisScopes: [],
          }),
        ],
      },
    });
    vi.spyOn(CompetitorsRepository.prototype, "listByIds").mockResolvedValue([
      entity({ revision: 3 }),
    ]);
    vi.spyOn(
      CompetitorsRepository.prototype,
      "listOriginsByIds",
    ).mockResolvedValue([csvOrigin(), profileOrigin(), manualOrigin()]);
    const exec = new FakeExecutor();
    exec.enqueue(
      [profileRow()],
      [csvObservation()],
      [csvSnapshot()],
      [csvCollectionRun()],
      [csvPreview()],
    );

    const response = await getProjectAuditCompetitor(
      scope,
      ids.project,
      ids.competitor,
      { diagnosticRunId: ids.olderRun },
      exec as never,
    );

    expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenCalledWith(
      exec,
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.olderRun,
    );
    expect(response.data).toMatchObject({
      competitorId: ids.competitor,
      reviewStatus: "candidate",
      revision: 1,
      relationship: null,
      analysisScope: [],
    });
  });

  it.each([
    ["foreign", ids.foreignRun],
    ["unpublished", ids.unpublishedRun],
  ])(
    "fails closed for a %s exact detail generation and never retries latest",
    async (_label, diagnosticRunId) => {
      activeProject();
      const notPublished = new ProblemError(
        "GROWTH_MAP_AUDIT_NOT_FOUND",
        "No completed Growth Map audit is available for this project.",
      );
      mocks.loadPublishedGrowthMapGeneration.mockRejectedValue(notPublished);
      const listByIds = vi.spyOn(
        CompetitorsRepository.prototype,
        "listByIds",
      );

      await expect(
        getProjectAuditCompetitor(
          scope,
          ids.project,
          ids.competitor,
          { diagnosticRunId },
          new FakeExecutor() as never,
        ),
      ).rejects.toBe(notPublished);

      expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenCalledTimes(1);
      expect(mocks.loadPublishedGrowthMapGeneration).toHaveBeenCalledWith(
        expect.anything(),
        { workspaceId: ids.workspace, projectId: ids.project },
        diagnosticRunId,
      );
      expect(
        mocks.loadPublishedGrowthMapGeneration.mock.calls.some(
          (call) => call[2] === null || call[2] === undefined,
        ),
      ).toBe(false);
      expect(listByIds).not.toHaveBeenCalled();
    },
  );

  it("returns current live governance only from the explicit review detail read", async () => {
    activeProject();
    const current = entity({
      name: "Current Review",
      review_status: "candidate",
      relationship: null,
      analysis_scope: [],
      revision: 3,
      last_observed_at: null,
      origin_count: 1,
    });
    vi.spyOn(CompetitorsRepository.prototype, "findById").mockResolvedValue(
      current,
    );
    vi.spyOn(CompetitorsRepository.prototype, "listOrigins").mockResolvedValue([
      manualOrigin({ source_name: current.name }),
    ]);
    const listByIds = vi.spyOn(
      CompetitorsRepository.prototype,
      "listByIds",
    );
    const exec = new FakeExecutor();

    const response = await getProjectAuditCompetitorReviewDetail(
      scope,
      ids.project,
      ids.competitor,
      exec as never,
    );

    expect(response.data).toMatchObject({
      competitorId: ids.competitor,
      name: "Current Review",
      reviewStatus: "candidate",
      relationship: null,
      analysisScope: [],
      revision: 3,
    });
    expect(mocks.loadPublishedGrowthMapGeneration).not.toHaveBeenCalled();
    expect(listByIds).not.toHaveBeenCalled();
  });

  it("keeps manual input first-class without loading or inventing provider lineage", async () => {
    const selected = entity({
      last_observed_at: null,
      origin_count: 1,
    });
    const exec = arrangeList({
      entity: selected,
      origins: [manualOrigin()],
      governanceCompetitors: [
        governanceCompetitor({
          originRefs: [
            {
              occurrenceId: ids.manual,
              originKind: "manual",
              snapshotId: null,
              observationId: null,
            },
          ],
        }),
      ],
      queryResults: [],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.originOccurrences).toEqual([
      {
        occurrenceId: ids.manual,
        originKind: "manual",
        manualEntryId: ids.manual,
        observedAt: null,
        evidenceRefs: [],
      },
    ]);
    expect(exec.calls).toEqual([]);
  });

  it("keeps frozen governance after a newer live review changes the mutable entity", async () => {
    const exec = arrangeList({
      entity: entity({
        name: null,
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        revision: 3,
      }),
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]).toMatchObject({
      name: null,
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["keyword_gap", "positioning"],
      revision: 2,
      coverage: { availability: "partial" },
    });
    expect(
      response.data[0]?.coverage.limitations.some((limitation) =>
        /display name is unavailable.*froze/i.test(limitation),
      ),
    ).toBe(true);
    expect(
      response.data[0]?.coverage.limitations.some((limitation) =>
        /no immutable.*ai-citation aggregate.*not a measured zero/i.test(
          limitation,
        ),
      ),
    ).toBe(true);
  });

  it("keeps published name null when the live entity name differs or becomes null", async () => {
    const renamedExec = arrangeList({
      entity: entity({ name: "Renamed Live Competitor" }),
    });
    const renamedResponse = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      renamedExec as never,
    );
    expect(renamedResponse.data[0]).toMatchObject({
      name: null,
    });
    expect(
      renamedResponse.data[0]?.coverage.limitations.some((limitation) =>
        /display name is unavailable.*froze/i.test(limitation),
      ),
    ).toBe(true);

    vi.restoreAllMocks();
    const nullExec = arrangeList({
      entity: entity({ name: null }),
    });
    const nullResponse = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      nullExec as never,
    );
    expect(nullResponse.data[0]).toMatchObject({
      name: null,
    });
    expect(
      nullResponse.data[0]?.coverage.limitations.some((limitation) =>
        /display name is unavailable.*froze/i.test(limitation),
      ),
    ).toBe(true);
  });

  it("excludes newer live origins that are absent from the frozen manifest", async () => {
    const exec = arrangeList({
      origins: [csvOrigin(), profileOrigin()],
      governanceCompetitors: [
        governanceCompetitor({
          originRefs: [
            {
              occurrenceId: ids.csvOrigin,
              originKind: "csv_keyword_gap",
              snapshotId: ids.snapshot,
              observationId: ids.observation,
            },
            {
              occurrenceId: ids.profileOrigin,
              originKind: "product_profile",
              snapshotId: null,
              observationId: null,
            },
          ],
        }),
      ],
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.originOccurrences).toHaveLength(2);
    expect(response.data[0]?.originOccurrences).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ occurrenceId: ids.manual }),
      ]),
    );
  });

  it("pages only over frozen manifest membership and preserves nextCursor", async () => {
    const secondCompetitorId = "10000000-0000-4000-8000-000000000099";
    vi.spyOn(CompetitorsRepository.prototype, "listByIds").mockResolvedValue([
      entity(),
      entity({
        id: secondCompetitorId,
        domain: "second-competitor.example",
        name: "Second Competitor",
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        revision: 8,
        origin_count: 1,
      }),
    ]);
    const listByIdsPage = vi
      .spyOn(CompetitorsRepository.prototype, "listByIdsPage")
      .mockResolvedValue({
        rows: [entity()],
        nextCursor: "opaque-next",
      });
    vi.spyOn(CompetitorsRepository.prototype, "listOriginsByIds").mockResolvedValue([
      csvOrigin(),
      profileOrigin(),
      manualOrigin(),
    ]);
    activeProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue({
      run: { id: "published-run" },
      frozen: { runId: "published-run" },
      governance: {
        ...governance,
        competitors: [
          ...governance.competitors,
          {
            competitorEntityId: secondCompetitorId,
            domain: "second-competitor.example",
            reviewStatus: "approved",
            revision: 1,
            relationship: "benchmark",
            analysisScopes: ["positioning"],
            originRefs: [],
          },
        ],
      },
    });
    const exec = new FakeExecutor();
    exec.enqueue(
      [profileRow()],
      [csvObservation()],
      [csvSnapshot()],
      [csvCollectionRun()],
      [csvPreview()],
    );

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 1, cursor: null },
      exec as never,
    );

    expect(listByIdsPage).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      [ids.competitor, secondCompetitorId],
      { limit: 1, cursor: null },
    );
    expect(response.meta.nextCursor).toBe("opaque-next");
    expect(response.meta.hasNext).toBe(true);
  });

  it("fails closed when one frozen competitor id is missing even if another fills the first page", async () => {
    const secondCompetitorId = "10000000-0000-4000-8000-000000000099";
    activeProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue({
      run: { id: "published-run" },
      frozen: { runId: "published-run" },
      governance: {
        ...governance,
        competitors: [
          ...governance.competitors,
          {
            competitorEntityId: secondCompetitorId,
            domain: "second-competitor.example",
            reviewStatus: "approved",
            revision: 1,
            relationship: "benchmark",
            analysisScopes: ["positioning"],
            originRefs: [],
          },
        ],
      },
    });
    vi.spyOn(CompetitorsRepository.prototype, "listByIds").mockResolvedValue([
      entity(),
    ]);
    const listByIdsPage = vi.spyOn(
      CompetitorsRepository.prototype,
      "listByIdsPage",
    );

    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 1, cursor: null },
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(listByIdsPage).not.toHaveBeenCalled();
  });

  it("returns not found when detail is absent from the frozen manifest", async () => {
    activeProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue({
      run: { id: "published-run" },
      frozen: { runId: "published-run" },
      governance: { ...governance, competitors: [] },
    });
    const find = vi.spyOn(CompetitorsRepository.prototype, "listByIds");

    await expect(
      getProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(find).not.toHaveBeenCalled();
  });

  it("fails closed when a frozen origin lineage row no longer matches the manifest", async () => {
    const exec = arrangeList({
      origins: [csvOrigin({ data_snapshot_id: ids.importPreview }), profileOrigin(), manualOrigin()],
    });

    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        exec as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("fails closed for drifted Product Profile and CSV lineage", async () => {
    const profileDrift = arrangeList({
      queryResults: [
        [
          profileRow({
            profile: {
              ...profileRow().profile,
              competitorCandidates: [],
            },
          }),
        ],
        [csvObservation()],
        [csvSnapshot()],
        [csvCollectionRun()],
        [csvPreview()],
      ],
    });
    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        profileDrift as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });

    vi.restoreAllMocks();
    const csvDrift = arrangeList({
      queryResults: [
        [profileRow()],
        [csvObservation({ value_json: { competitorDomain: "other.example" } })],
        [csvSnapshot()],
        [csvCollectionRun()],
        [csvPreview()],
      ],
    });
    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        csvDrift as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });

    vi.restoreAllMocks();
    const csvSupportDrift = arrangeList({
      queryResults: [
        [profileRow()],
        [csvObservation({ support: "context" })],
        [csvSnapshot()],
        [csvCollectionRun()],
        [csvPreview()],
      ],
    });
    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        csvSupportDrift as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("fails closed when the final customer projection violates its strict contract", async () => {
    const exec = arrangeList({
      entity: entity({ last_observed_at: null, origin_count: 1 }),
      governanceCompetitors: [
        governanceCompetitor({
          reviewStatus: "approved",
          relationship: null,
        } as never),
      ],
      origins: [manualOrigin()],
      queryResults: [],
      confirmedProfileId: null,
    });

    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        exec as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("rejects malformed cursors, archived projects, and foreign detail before projection", async () => {
    const find = vi.spyOn(ProjectsRepository.prototype, "findById");
    const list = vi.spyOn(CompetitorsRepository.prototype, "listByIdsPage");
    const malformed = Buffer.from(
      "customer-private-not-a-semantic-cursor",
    ).toString("base64url");

    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: malformed },
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(find).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();

    find.mockResolvedValue({
      id: ids.project,
      workspace_id: ids.workspace,
      archived_at: capturedAt,
    } as never);
    await expect(
      listProjectAuditCompetitors(
        scope,
        ids.project,
        { limit: 50, cursor: null },
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(list).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    activeProject();
    mocks.loadPublishedGrowthMapGeneration.mockResolvedValue({
      run: { id: "published-run" },
      frozen: { runId: "published-run" },
      governance: { ...governance, competitors: [] },
    });
    await expect(
      getProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Growth Map Competitor Library review service", () => {
  const review: ReviewCompetitorRequest = {
    expectedRevision: 2,
    name: "Reviewed Competitor",
    reviewStatus: "approved",
    relationship: "benchmark",
    analysisScope: ["positioning"],
  };

  function reviewedEntity(
    overrides: Partial<CompetitorEntityRow> = {},
  ): CompetitorEntityRow {
    return entity({
      name: review.name,
      review_status: review.reviewStatus,
      relationship: review.relationship,
      analysis_scope: [...review.analysisScope],
      revision: review.expectedRevision + 1,
      last_observed_at: null,
      origin_count: 1,
      ...overrides,
    });
  }

  function arrangeReviewedDetail(
    find: ReturnType<typeof vi.spyOn>,
    selected: CompetitorEntityRow,
  ): FakeExecutor {
    find.mockResolvedValueOnce(selected as never);
    vi.spyOn(CompetitorsRepository.prototype, "listOrigins").mockResolvedValue([
      manualOrigin({ source_name: review.name }),
    ]);
    return new FakeExecutor();
  }

  it("writes one scoped optimistic review and returns the canonical detail projection", async () => {
    activeProject(null);
    const find = vi
      .spyOn(CompetitorsRepository.prototype, "findById")
      .mockResolvedValueOnce(
        entity({
          last_observed_at: null,
          origin_count: 1,
        }),
      );
    const repositoryReview = vi
      .spyOn(CompetitorsRepository.prototype, "review")
      .mockResolvedValue(reviewedEntity());
    const exec = arrangeReviewedDetail(find, reviewedEntity());

    const response = await reviewProjectAuditCompetitor(
      scope,
      ids.project,
      ids.competitor,
      review,
      exec as never,
    );

    expect(repositoryReview).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      ids.competitor,
      review,
    );
    expect(response).toMatchObject({
      projectId: ids.project,
      data: {
        competitorId: ids.competitor,
        name: review.name,
        reviewStatus: "approved",
        relationship: "benchmark",
        analysisScope: ["positioning"],
        revision: 3,
      },
    });
    expect(mocks.loadPublishedGrowthMapGeneration).not.toHaveBeenCalled();
  });

  it("runs the production write and canonical response read in one transaction", async () => {
    activeProject(null);
    const find = vi
      .spyOn(CompetitorsRepository.prototype, "findById")
      .mockResolvedValueOnce(
        entity({
          last_observed_at: null,
          origin_count: 1,
        }),
      );
    vi.spyOn(CompetitorsRepository.prototype, "review").mockResolvedValue(
      reviewedEntity(),
    );
    const exec = arrangeReviewedDetail(find, reviewedEntity());
    const transaction = vi.fn(
      async (callback: (selected: FakeExecutor) => Promise<unknown>) =>
        callback(exec),
    );
    mocks.getDb.mockReturnValue({ db: { transaction } });

    const response = await reviewProjectAuditCompetitor(
      scope,
      ids.project,
      ids.competitor,
      review,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(response.data.revision).toBe(review.expectedRevision + 1);
  });

  it("rejects an invalid internal review command before project or repository access", async () => {
    const project = vi.spyOn(ProjectsRepository.prototype, "findById");
    const repositoryReview = vi.spyOn(
      CompetitorsRepository.prototype,
      "review",
    );

    await expect(
      reviewProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        {
          ...review,
          relationship: null,
        } as ReviewCompetitorRequest,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(project).not.toHaveBeenCalled();
    expect(repositoryReview).not.toHaveBeenCalled();
  });

  it("rejects a competitor revision that cannot be incremented before project access", async () => {
    const project = vi.spyOn(ProjectsRepository.prototype, "findById");
    const repositoryReview = vi.spyOn(
      CompetitorsRepository.prototype,
      "review",
    );

    await expect(
      reviewProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        {
          ...review,
          expectedRevision: MAX_POSTGRES_INTEGER_REVISION,
        },
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(project).not.toHaveBeenCalled();
    expect(repositoryReview).not.toHaveBeenCalled();
  });

  it("rejects a malformed competitor id before project access", async () => {
    const project = vi.spyOn(ProjectsRepository.prototype, "findById");

    await expect(
      reviewProjectAuditCompetitor(
        scope,
        ids.project,
        "customer-private-competitor",
        review,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(project).not.toHaveBeenCalled();
  });

  it("treats the exact current review as an idempotent no-op", async () => {
    activeProject(null);
    const current = reviewedEntity({ revision: review.expectedRevision });
    const find = vi
      .spyOn(CompetitorsRepository.prototype, "findById")
      .mockResolvedValueOnce(current);
    const repositoryReview = vi.spyOn(
      CompetitorsRepository.prototype,
      "review",
    );
    const exec = arrangeReviewedDetail(find, current);

    const response = await reviewProjectAuditCompetitor(
      scope,
      ids.project,
      ids.competitor,
      review,
      exec as never,
    );

    expect(repositoryReview).not.toHaveBeenCalled();
    expect(response.data.revision).toBe(review.expectedRevision);
  });

  it("converges a safe retry when the immediately following revision already contains the same review", async () => {
    activeProject(null);
    const applied = reviewedEntity();
    const find = vi
      .spyOn(CompetitorsRepository.prototype, "findById")
      .mockResolvedValueOnce(
        entity({ last_observed_at: null, origin_count: 1 }),
      )
      .mockResolvedValueOnce(applied);
    vi.spyOn(CompetitorsRepository.prototype, "review").mockResolvedValue(null);
    const exec = arrangeReviewedDetail(find, applied);

    const response = await reviewProjectAuditCompetitor(
      scope,
      ids.project,
      ids.competitor,
      review,
      exec as never,
    );

    expect(response.data.revision).toBe(review.expectedRevision + 1);
  });

  it("recognizes an already-applied immediate retry before attempting another write", async () => {
    activeProject(null);
    const applied = reviewedEntity();
    const find = vi
      .spyOn(CompetitorsRepository.prototype, "findById")
      .mockResolvedValueOnce(applied);
    const repositoryReview = vi.spyOn(
      CompetitorsRepository.prototype,
      "review",
    );
    const exec = arrangeReviewedDetail(find, applied);

    const response = await reviewProjectAuditCompetitor(
      scope,
      ids.project,
      ids.competitor,
      review,
      exec as never,
    );

    expect(repositoryReview).not.toHaveBeenCalled();
    expect(response.data.revision).toBe(review.expectedRevision + 1);
  });

  it("returns a conflict when the review CAS loses to a different command", async () => {
    activeProject(null);
    vi.spyOn(CompetitorsRepository.prototype, "findById")
      .mockResolvedValueOnce(
        entity({ last_observed_at: null, origin_count: 1 }),
      )
      .mockResolvedValueOnce(
        entity({
          name: "Other Review",
          revision: 3,
          last_observed_at: null,
          origin_count: 1,
        }),
      );
    vi.spyOn(CompetitorsRepository.prototype, "review").mockResolvedValue(null);

    await expect(
      reviewProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        review,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({
      code: "STALE_REVISION",
      status: 409,
      current: {
        kind: "revision_conflict",
        resource: "competitor_review",
        expectedRevision: 2,
        currentRevision: 3,
      },
    });
  });

  it("fails closed when the repository returns a cross-scope review result", async () => {
    activeProject(null);
    vi.spyOn(CompetitorsRepository.prototype, "findById").mockResolvedValueOnce(
      entity({ last_observed_at: null, origin_count: 1 }),
    );
    vi.spyOn(CompetitorsRepository.prototype, "review").mockResolvedValue(
      reviewedEntity({ workspace_id: "20000000-0000-4000-8000-000000000001" }),
    );

    await expect(
      reviewProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        review,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("fails closed before writing when the scoped entity read drifts across workspaces", async () => {
    activeProject(null);
    vi.spyOn(CompetitorsRepository.prototype, "findById").mockResolvedValue(
      entity({
        workspace_id: "20000000-0000-4000-8000-000000000001",
        last_observed_at: null,
        origin_count: 1,
      }),
    );
    const repositoryReview = vi.spyOn(
      CompetitorsRepository.prototype,
      "review",
    );

    await expect(
      reviewProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        review,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
    expect(repositoryReview).not.toHaveBeenCalled();
  });

  it("returns a structured stale-revision conflict without attempting a write", async () => {
    activeProject(null);
    vi.spyOn(CompetitorsRepository.prototype, "findById").mockResolvedValue(
      entity({ revision: 4 }),
    );
    const repositoryReview = vi.spyOn(
      CompetitorsRepository.prototype,
      "review",
    );

    await expect(
      reviewProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        review,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({
      code: "STALE_REVISION",
      status: 409,
      current: {
        kind: "revision_conflict",
        resource: "competitor_review",
        projectId: ids.project,
        resourceId: ids.competitor,
        expectedRevision: 2,
        currentRevision: 4,
      },
    });
    expect(repositoryReview).not.toHaveBeenCalled();
  });

  it("maps disappearance after a lost CAS to the same non-enumerating 404", async () => {
    activeProject(null);
    vi.spyOn(CompetitorsRepository.prototype, "findById")
      .mockResolvedValueOnce(
        entity({ last_observed_at: null, origin_count: 1 }),
      )
      .mockResolvedValueOnce(null);
    vi.spyOn(CompetitorsRepository.prototype, "review").mockResolvedValue(null);

    await expect(
      reviewProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        review,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("keeps missing, foreign, and archived competitors non-enumerating", async () => {
    activeProject(null);
    vi.spyOn(CompetitorsRepository.prototype, "findById").mockResolvedValue(
      null,
    );
    const repositoryReview = vi.spyOn(
      CompetitorsRepository.prototype,
      "review",
    );

    await expect(
      reviewProjectAuditCompetitor(
        scope,
        ids.project,
        ids.competitor,
        review,
        new FakeExecutor() as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(repositoryReview).not.toHaveBeenCalled();
  });
});
