import {
  CompetitorsRepository,
  ProjectsRepository,
  type CompetitorEntityRow,
  type CompetitorOriginRow,
} from "@sf/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getProjectAuditCompetitor, listProjectAuditCompetitors } = await import(
  "./growth-map-competitors.ts"
);

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
} as const;

const scope = { workspaceId: ids.workspace };
const capturedAt = "2026-07-22T08:00:00.000Z";
const evidenceRefs = [
  { evidenceRefId: ids.evidenceRef, kind: "userEdit" as const },
];

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

function arrangeList(input: {
  readonly entity?: CompetitorEntityRow;
  readonly origins?: readonly CompetitorOriginRow[];
  readonly nextCursor?: string | null;
  readonly queryResults?: readonly unknown[];
  readonly confirmedProfileId?: string | null;
} = {}) {
  activeProject(input.confirmedProfileId);
  const selected = input.entity ?? entity();
  vi.spyOn(CompetitorsRepository.prototype, "listByProject").mockResolvedValue({
    rows: [selected],
    nextCursor: input.nextCursor ?? null,
  });
  vi.spyOn(CompetitorsRepository.prototype, "listOrigins").mockResolvedValue(
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
});

describe("Growth Map Competitor Library read service", () => {
  it("uses one repeatable-read, read-only snapshot when no executor is supplied", async () => {
    const exec = new FakeExecutor();
    activeProject(null);
    vi.spyOn(CompetitorsRepository.prototype, "listByProject").mockResolvedValue({
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
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["keyword_gap", "positioning"],
      revision: 2,
      lastObservedAt: capturedAt,
      serpOverlap: {
        availability: "unavailable",
        value: null,
        limitation: expect.stringMatching(/canonical.*writer/i),
      },
      aiCitationInsight: {
        availability: "unavailable",
        value: null,
        limitation: expect.stringMatching(/canonical.*writer/i),
      },
    });
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

  it("returns the same scoped projection from detail", async () => {
    activeProject();
    vi.spyOn(CompetitorsRepository.prototype, "findById").mockResolvedValue(
      entity(),
    );
    vi.spyOn(CompetitorsRepository.prototype, "listOrigins").mockResolvedValue([
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
      data: { competitorId: ids.competitor, lastObservedAt: capturedAt },
    });
  });

  it("keeps manual input first-class without loading or inventing provider lineage", async () => {
    const selected = entity({
      review_status: "candidate",
      relationship: null,
      analysis_scope: [],
      revision: 0,
      last_observed_at: null,
      origin_count: 1,
    });
    const exec = arrangeList({
      entity: selected,
      origins: [manualOrigin()],
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

  it("keeps CSV-first entity governance pending when a later Product Profile source is approved", async () => {
    const exec = arrangeList({
      entity: entity({
        name: null,
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        revision: 0,
      }),
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]).toMatchObject({
      reviewStatus: "candidate",
      relationship: null,
      analysisScope: [],
      revision: 0,
      coverage: {
        availability: "partial",
        limitations: expect.arrayContaining([
          expect.stringMatching(
            /Product Profile source is approved.*still awaiting.*review/i,
          ),
        ]),
      },
    });
  });

  it("marks an immutable origin history capped at 100 as explicitly partial", async () => {
    const origins = Array.from({ length: 100 }, (_, index) => {
      const suffix = (index + 20).toString(16).padStart(12, "0");
      const id = `10000000-0000-4000-8000-${suffix}`;
      return manualOrigin({ id, manual_entry_id: id });
    });
    const exec = arrangeList({
      entity: entity({
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        last_observed_at: null,
        origin_count: 101,
      }),
      origins,
      queryResults: [],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.originOccurrences).toHaveLength(100);
    expect(response.data[0]?.coverage).toMatchObject({
      availability: "partial",
      limitations: expect.arrayContaining([
        expect.stringMatching(/most recent 100.*origin/i),
      ]),
    });
  });

  it("keeps the approved-source governance warning when that Product Profile origin is older than the 100-origin window", async () => {
    const origins = Array.from({ length: 100 }, (_, index) => {
      const suffix = (index + 200).toString(16).padStart(12, "0");
      const id = `10000000-0000-4000-8000-${suffix}`;
      return manualOrigin({ id, manual_entry_id: id });
    });
    const exec = arrangeList({
      entity: entity({
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        last_observed_at: null,
        origin_count: 101,
      }),
      origins,
      queryResults: [[{ competitor_id: ids.competitor }]],
      confirmedProfileId: null,
    });

    const response = await listProjectAuditCompetitors(
      scope,
      ids.project,
      { limit: 50, cursor: null },
      exec as never,
    );

    expect(response.data[0]?.coverage).toMatchObject({
      availability: "partial",
      limitations: expect.arrayContaining([
        expect.stringMatching(
          /Product Profile source is approved.*still awaiting.*review/i,
        ),
      ]),
    });
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
      entity: entity({
        relationship: null,
        last_observed_at: null,
        origin_count: 1,
      }),
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
    const list = vi.spyOn(CompetitorsRepository.prototype, "listByProject");
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
    vi.spyOn(CompetitorsRepository.prototype, "findById").mockResolvedValue(
      null,
    );
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
