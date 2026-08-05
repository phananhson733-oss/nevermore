import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  AuditRunsRepository,
  CapabilityRunsRepository,
  CollectionRunsRepository,
  CompetitorsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  IcpProfilesRepository,
  IdempotencyRepository,
  KeywordsRepository,
  ProjectsRepository,
  SitesRepository,
  type DataSnapshotRow,
} from "@sf/db";
import {
  CreateGrowthAuditRunRequest,
  GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
} from "@sf/contracts";
import {
  CRAWL_DATASET_KEY,
  CRAWL_METHOD_VERSION,
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
} from "@sf/sources";

const mocks = vi.hoisted(() => {
  const tx = {};
  const db = {
    transaction: vi.fn(async (callback: (executor: object) => unknown) =>
      callback(tx),
    ),
  };
  return {
    db,
    tx,
    enqueueRunInTx: vi.fn(async () => "job-1"),
    getBoss: vi.fn(async () => ({ name: "boss" })),
  };
});

vi.mock("@sf/db", async () => {
  const actual = await vi.importActual<typeof import("@sf/db")>("@sf/db");
  return { ...actual, enqueueRunInTx: mocks.enqueueRunInTx };
});
vi.mock("@/lib/db", () => ({ getDb: () => ({ db: mocks.db }) }));
vi.mock("@/lib/boss", () => ({ getBoss: mocks.getBoss }));

const { createGrowthAuditRun, loadGrowthAuditInputs } =
  await import("../audit-runs.ts");

const workspaceId = "00000000-0000-4000-8000-000000000011";
const projectId = "00000000-0000-4000-8000-000000000012";
const actorId = "00000000-0000-4000-8000-000000000013";
const siteId = "00000000-0000-4000-8000-000000000014";
const icpProfileId = "00000000-0000-4000-8000-000000000015";
const snapshotId = "00000000-0000-4000-8000-000000000016";
const runId = "00000000-0000-4000-8000-000000000017";
const auditRunId = "00000000-0000-4000-8000-000000000018";
const idempotencyKey = "growth-audit-key";
const legacyProfile = {
  productName: "Acme",
  oneLineDescription: "Ship faster",
  productType: "saas",
  businessModels: ["subscription"],
  marketCodes: ["US"],
  segments: ["Growth teams"],
  primaryConversion: {
    label: "Book a demo",
    type: "contact",
    targetUrl: "https://example.test/demo",
  },
  priorityUrls: ["https://example.test/pricing"],
  technicalConstraints: ["Legacy CMS"],
  resourceConstraints: ["One engineer"],
} as const;

const body: CreateGrowthAuditRunRequest = {
  siteId,
  icpProfileId,
  scope: { kind: "site" },
  outputLocale: "en",
  capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
};

const crawlSnapshot: DataSnapshotRow = {
  id: snapshotId,
  workspace_id: workspaceId,
  project_id: projectId,
  site_id: siteId,
  collection_run_id: "00000000-0000-4000-8000-000000000021",
  source_connection_id: "00000000-0000-4000-8000-000000000022",
  provider: "crawl",
  dataset_key: CRAWL_DATASET_KEY,
  schema_version: "crawl.site_graph.0.3.0",
  method_version: CRAWL_METHOD_VERSION,
  captured_at: "2026-07-21 09:02:03.000000+08",
  source_window: { end: null, start: null },
  availability: "available",
  limitation: "Static public crawl only.",
  raw_object_key: "raw/fixture.json",
  row_count: 3,
  checksum: "a".repeat(64),
  summary: {},
  created_at: "2026-07-21T01:02:04.000Z",
};

function snapshotForProvider(
  provider: "gsc" | "ga4" | "csv" | "dataforseo",
  id: string,
  datasetKey: string,
  methodVersion: string,
): DataSnapshotRow {
  return {
    ...crawlSnapshot,
    id,
    collection_run_id: id.replace(/.$/u, "1"),
    source_connection_id: id.replace(/.$/u, "2"),
    provider,
    dataset_key: datasetKey,
    schema_version: methodVersion,
    method_version: methodVersion,
    checksum: provider[0]!.repeat(64),
  };
}

const gscSnapshot = snapshotForProvider(
  "gsc",
  "00000000-0000-4000-8000-000000000026",
  "gsc.page_query_daily.v1",
  "gsc.page_query_daily.v1",
);
const ga4Snapshot = snapshotForProvider(
  "ga4",
  "00000000-0000-4000-8000-000000000025",
  "ga4.organic_landing_daily.v1",
  "ga4.organic_landing_daily.v1",
);
const csvSnapshot = snapshotForProvider(
  "csv",
  "00000000-0000-4000-8000-000000000024",
  "csv.keyword_gap.v1",
  "csv.keyword_gap.v1",
);
const dataForSeoSnapshot = snapshotForProvider(
  "dataforseo",
  "00000000-0000-4000-8000-000000000023",
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
);
const dataForSeoSearchLandscapeSnapshot = {
  ...snapshotForProvider(
    "dataforseo",
    "00000000-0000-4000-8000-000000000027",
    DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
    DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  ),
  captured_at: "2026-07-22T01:02:03.000Z",
};

function collectionRunForSnapshot(
  snapshot: DataSnapshotRow,
  operation: "keyword_gap_import" | "search_landscape",
) {
  return {
    id: snapshot.collection_run_id,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    source_connection_id: snapshot.source_connection_id,
    import_preview_id: null,
    crawl_seed_site_page_id: null,
    crawl_seed_url: null,
    provider: "dataforseo",
    operation,
    method_version: snapshot.method_version,
    parameters_hash: "f".repeat(64),
    row_count: snapshot.row_count,
    stop_reason: null,
    created_at: snapshot.created_at,
  } as const;
}

const queuedRun = {
  id: runId,
  workspace_id: workspaceId,
  project_id: projectId,
  kind: "diagnostic",
  status: "queued",
  active_key: "growth_audit",
  contract_version: "2026-07-21",
  request_payload: {},
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: null,
  result_id: null,
  attempt_count: 0,
  initiated_by: actorId,
  queued_at: "2026-07-24T00:00:00.000Z",
  started_at: null,
  completed_at: null,
};

function requestHash(): string {
  return contentHash({
    projectId,
    siteId,
    icpProfileId,
    scope: { kind: "site" },
    outputLocale: "en",
  });
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: projectId,
    workspace_id: workspaceId,
    archived_at: null,
    confirmed_icp_profile_id: icpProfileId,
    ...overrides,
  } as never;
}

function mockHappyPathInputs() {
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
    id: icpProfileId,
    version: 4,
    content_hash: "b".repeat(64),
    status: "complete",
    profile: legacyProfile,
  } as never);
  vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
    id: siteId,
    language_codes: ["fr-CA"],
  } as never);
  vi.spyOn(
    DataSnapshotsRepository.prototype,
    "findLatestEligibleBySite",
  ).mockImplementation(async (_scope, _siteId, selectors) =>
    selectors[0]?.datasetKey ===
    DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY
      ? []
      : [crawlSnapshot],
  );
  vi.spyOn(
    KeywordsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue([]);
  vi.spyOn(
    CompetitorsRepository.prototype,
    "listDiagnosticEligible",
  ).mockResolvedValue([]);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.db.transaction.mockImplementation(
    async (callback: (executor: object) => unknown) => callback(mocks.tx),
  );
});

describe("createGrowthAuditRun hard gates", () => {
  it("rejects a missing confirmed profile with CONTEXT_INCOMPLETE", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project({ confirmed_icp_profile_id: null }),
    );
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("rejects an audit that does not reference the confirmed profile", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project({
        confirmed_icp_profile_id: "00000000-0000-4000-8000-0000000000ff",
      }),
    );
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
  });

  it("rejects an archived project with PROJECT_ARCHIVED", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project({ archived_at: "2026-07-01T00:00:00.000Z" }),
    );
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED", status: 422 });
  });

  it("requires a usable crawl snapshot", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
      id: icpProfileId,
      version: 4,
      content_hash: "b".repeat(64),
      status: "complete",
      profile: legacyProfile,
    } as never);
    vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
      id: siteId,
      language_codes: ["fr-CA"],
    } as never);
    vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findLatestEligibleBySite",
    ).mockResolvedValue([]);
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({ code: "CRAWL_SNAPSHOT_REQUIRED", status: 422 });
  });
});

describe("loadGrowthAuditInputs DataForSEO selection", () => {
  it("selects the newest exact snapshot across legacy and search-landscape contracts", async () => {
    const newerLegacySnapshot = {
      ...dataForSeoSnapshot,
      captured_at: "2026-07-23T01:02:03.000Z",
    };
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
      id: icpProfileId,
      version: 4,
      content_hash: "b".repeat(64),
      status: "complete",
      profile: legacyProfile,
    } as never);
    vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
      id: siteId,
      language_codes: ["fr-CA"],
    } as never);
    vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findLatestEligibleBySite",
    ).mockImplementation(async (_scope, _siteId, selectors) =>
      selectors[0]?.datasetKey ===
      DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY
        ? [dataForSeoSearchLandscapeSnapshot]
        : [crawlSnapshot, newerLegacySnapshot],
    );
    vi.spyOn(
      CollectionRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(
      collectionRunForSnapshot(
        newerLegacySnapshot,
        "keyword_gap_import",
      ),
    );

    const inputs = await loadGrowthAuditInputs(
      {} as never,
      { workspaceId },
      projectId,
      project(),
      body,
    );

    expect(
      inputs.snapshots.filter(
        (snapshot) => snapshot.provider === "dataforseo",
      ),
    ).toEqual([newerLegacySnapshot]);
    expect(inputs.icp).toEqual({
      id: icpProfileId,
      version: 4,
      contentHash: "b".repeat(64),
      profile: legacyProfile,
    });
    expect(inputs.siteLanguageCodes).toEqual(["fr-CA"]);
  });

  it("fails closed when a search-landscape snapshot points to a legacy collection operation", async () => {
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
      id: icpProfileId,
      version: 4,
      content_hash: "b".repeat(64),
      status: "complete",
      profile: legacyProfile,
    } as never);
    vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue({
      id: siteId,
      language_codes: ["fr-CA"],
    } as never);
    vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findLatestEligibleBySite",
    ).mockImplementation(async (_scope, _siteId, selectors) =>
      selectors[0]?.datasetKey ===
      DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY
        ? [dataForSeoSearchLandscapeSnapshot]
        : [crawlSnapshot],
    );
    vi.spyOn(
      CollectionRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(
      collectionRunForSnapshot(
        dataForSeoSearchLandscapeSnapshot,
        "keyword_gap_import",
      ),
    );

    await expect(
      loadGrowthAuditInputs(
        {} as never,
        { workspaceId },
        projectId,
        project(),
        body,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });
});

describe("createGrowthAuditRun contract", () => {
  it("rejects an illegal capabilityContractVersion at the boundary", () => {
    const result = CreateGrowthAuditRunRequest.safeParse({
      ...body,
      capabilityContractVersion: "growth-audit.0.2.0",
    });
    expect(result.success).toBe(false);
  });

  it("creates async_run, diagnostic_run, capability_run and audit_run in one transaction", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue({
      id: "00000000-0000-4000-8000-0000000000aa",
    } as never);
    const complete = vi
      .spyOn(IdempotencyRepository.prototype, "complete")
      .mockResolvedValue(undefined as never);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue(project());
    vi.spyOn(ProjectsRepository.prototype, "setStage").mockResolvedValue(
      undefined as never,
    );
    mockHappyPathInputs();
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(
      null,
    );
    const insertQueued = vi
      .spyOn(AsyncRunsRepository.prototype, "insertQueued")
      .mockResolvedValue(queuedRun as never);
    const diagnosticInsert = vi
      .spyOn(DiagnosticRunsRepository.prototype, "insert")
      .mockResolvedValue(undefined as never);
    const capabilityCreate = vi
      .spyOn(CapabilityRunsRepository.prototype, "create")
      .mockResolvedValue({ async_run_id: runId } as never);
    const auditCreate = vi
      .spyOn(AuditRunsRepository.prototype, "create")
      .mockResolvedValue({ id: auditRunId } as never);

    const result = await createGrowthAuditRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    );

    expect(result).toMatchObject({
      status: 202,
      replayed: false,
      resourceRef: { type: "audit_run", id: auditRunId },
    });
    expect(mocks.db.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read",
    });
    expect(insertQueued).toHaveBeenCalledTimes(1);
    expect(insertQueued.mock.calls[0]?.[0]).toMatchObject({
      kind: "diagnostic",
      activeKey: "growth_audit",
    });
    expect(diagnosticInsert).toHaveBeenCalledTimes(1);
    const diagnosticValues = diagnosticInsert.mock.calls[0]?.[0];
    const inputManifest = diagnosticValues?.inputManifest as Record<
      string,
      unknown
    >;
    expect(Object.keys(inputManifest).sort()).toEqual([
      "contextProjection",
      "deliveryLocale",
      "governance",
      "icp",
      "projectId",
      "promptSetVersion",
      "ruleSetVersion",
      "siteId",
      "snapshots",
    ]);
    expect(inputManifest).toMatchObject({
      governance: {
        projectionVersion: "growth-governance.1.0.0",
        keywordClusters: [],
        competitors: [],
      },
      contextProjection: {
        profileGeneration: "legacy-icp.v1",
        siteLanguage: {
          sourceKind: "site",
          state: "declared_non_empty",
          languageCodes: ["fr-CA"],
        },
      },
    });
    expect(capabilityCreate).toHaveBeenCalledTimes(1);
    expect(capabilityCreate.mock.calls[0]?.[0]).toMatchObject({
      capabilityId: "growth-audit",
      capabilityVersion: "0.3.0",
      inputManifestHash: contentHash({
        capabilityId: "growth-audit",
        capabilityVersion: "0.3.0",
        capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
        projectId,
        siteId,
        icpProfileId,
        scope: { kind: "site" },
        selectedSnapshotIds: [snapshotId],
        outputLocale: "en",
      }),
      sideEffectClass: "read_only",
      mode: "production",
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0]?.[0]).toMatchObject({
      diagnosticRunId: runId,
      capabilityRunId: runId,
      scopeKind: "site",
      scopeKey: siteId,
      projectionVersion: "growth-audit.0.3.1",
    });
    expect(mocks.enqueueRunInTx).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      mocks.tx,
      "diagnose",
      expect.objectContaining({ runId }),
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("freezes the latest eligible snapshot from every supported provider", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue({
      id: "00000000-0000-4000-8000-0000000000aa",
    } as never);
    vi.spyOn(
      IdempotencyRepository.prototype,
      "complete",
    ).mockResolvedValue(undefined as never);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue(project());
    vi.spyOn(
      ProjectsRepository.prototype,
      "setStage",
    ).mockResolvedValue(undefined as never);
    mockHappyPathInputs();
    const selectSnapshots = vi
      .spyOn(DataSnapshotsRepository.prototype, "findLatestEligibleBySite")
      .mockImplementation(async (_scope, _siteId, selectors) =>
        selectors[0]?.datasetKey ===
        DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY
          ? [dataForSeoSearchLandscapeSnapshot]
          : [
              gscSnapshot,
              crawlSnapshot,
              dataForSeoSnapshot,
              ga4Snapshot,
              csvSnapshot,
            ],
      );
    vi.spyOn(
      CollectionRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(
      collectionRunForSnapshot(
        dataForSeoSearchLandscapeSnapshot,
        "search_landscape",
      ),
    );
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(
      null,
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "insertQueued",
    ).mockResolvedValue(queuedRun as never);
    const diagnosticInsert = vi
      .spyOn(DiagnosticRunsRepository.prototype, "insert")
      .mockResolvedValue(undefined as never);
    vi.spyOn(
      CapabilityRunsRepository.prototype,
      "create",
    ).mockResolvedValue({ async_run_id: runId } as never);
    vi.spyOn(AuditRunsRepository.prototype, "create").mockResolvedValue({
      id: auditRunId,
    } as never);

    await createGrowthAuditRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    );

    const legacySelectors = [
      {
        provider: "crawl",
        datasetKey: CRAWL_DATASET_KEY,
        methodVersion: CRAWL_METHOD_VERSION,
        collectionOperation: "site_graph",
        collectionMethodVersion: CRAWL_METHOD_VERSION,
      },
      {
        provider: "gsc",
        datasetKey: "gsc.page_query_daily.v1",
        methodVersion: "gsc.page_query_daily.v1",
        collectionOperation: "search_analytics",
        collectionMethodVersion: "gsc.page_query_daily.v1",
      },
      {
        provider: "ga4",
        datasetKey: "ga4.organic_landing_daily.v1",
        methodVersion: "ga4.organic_landing_daily.v1",
        collectionOperation: "organic_landing",
        collectionMethodVersion: "ga4.organic_landing_daily.v1",
      },
      {
        provider: "csv",
        datasetKey: "csv.keyword_gap.v1",
        methodVersion: "csv.keyword_gap.v1",
        collectionOperation: "keyword_gap_import",
        collectionMethodVersion: "csv.keyword_gap.v1",
      },
      {
        provider: "dataforseo",
        datasetKey: DATAFORSEO_DATASET_KEY,
        methodVersion: DATAFORSEO_METHOD_VERSION,
        collectionOperation: "keyword_gap_import",
        collectionMethodVersion: DATAFORSEO_METHOD_VERSION,
      },
    ];
    const compositeSelectors = [
      {
        provider: "dataforseo",
        datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
        methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
        collectionOperation: "search_landscape",
        collectionMethodVersion:
          DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
      },
      {
        provider: "dataforseo",
        datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
        methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
        collectionOperation: "search_landscape",
        collectionMethodVersion:
          DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
      },
    ];
    expect(selectSnapshots).toHaveBeenCalledTimes(4);
    for (const callNumber of [1, 3]) {
      expect(selectSnapshots).toHaveBeenNthCalledWith(
        callNumber,
        { workspaceId, projectId },
        siteId,
        legacySelectors,
      );
    }
    for (const callNumber of [2, 4]) {
      expect(selectSnapshots).toHaveBeenNthCalledWith(
        callNumber,
        { workspaceId, projectId },
        siteId,
        compositeSelectors,
      );
    }
    const manifest = diagnosticInsert.mock.calls[0]?.[0]
      .inputManifest as {
      readonly snapshots: readonly {
        readonly snapshotId: string;
        readonly provider: string;
      }[];
    };
    // The diagnostic frozen input owns canonical ID ordering independently of
    // repository return order.
    expect(manifest.snapshots).toEqual([
      expect.objectContaining({
        snapshotId: crawlSnapshot.id,
        provider: "crawl",
      }),
      expect.objectContaining({
        snapshotId: csvSnapshot.id,
        provider: "csv",
      }),
      expect.objectContaining({
        snapshotId: ga4Snapshot.id,
        provider: "ga4",
      }),
      expect.objectContaining({
        snapshotId: gscSnapshot.id,
        provider: "gsc",
      }),
      expect.objectContaining({
        snapshotId: dataForSeoSearchLandscapeSnapshot.id,
        provider: "dataforseo",
      }),
    ]);
    expect(manifest.snapshots).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshotId: dataForSeoSnapshot.id,
        }),
      ]),
    );
  });

  it("replays a completed command without re-enqueueing", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue({
      request_hash: requestHash(),
      status: "completed",
      resource_id: auditRunId,
      response_body: {
        run: { id: runId },
        statusUrl: `/api/mvp/projects/${projectId}/runs/${runId}`,
        resourceRef: { type: "audit_run", id: auditRunId },
      },
    } as never);
    const begin = vi.spyOn(IdempotencyRepository.prototype, "begin");
    const projectRead = vi.spyOn(ProjectsRepository.prototype, "findById");
    const profileRead = vi.spyOn(IcpProfilesRepository.prototype, "findById");
    const siteRead = vi.spyOn(SitesRepository.prototype, "findById");

    const result = await createGrowthAuditRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    );
    expect(result).toMatchObject({
      status: 202,
      replayed: true,
      resourceRef: { type: "audit_run", id: auditRunId },
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(projectRead).not.toHaveBeenCalled();
    expect(profileRead).not.toHaveBeenCalled();
    expect(siteRead).not.toHaveBeenCalled();
    expect(mocks.enqueueRunInTx).not.toHaveBeenCalled();
  });

  it("returns RUN_ALREADY_ACTIVE when another audit is active", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    mockHappyPathInputs();
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue({
      id: runId,
    } as never);
    await expect(
      createGrowthAuditRun(
        { workspaceId },
        projectId,
        actorId,
        idempotencyKey,
        body,
      ),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      // The winner is observable, so the body locates it too. A client that
      // reads only the response body would otherwise get a conflict it has no
      // way to follow, because `Location` is a header.
      current: {
        runId,
        statusUrl: expect.stringContaining(`/runs/${runId}`),
      },
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("does not claim an active run when the unique race leaves no winner", async () => {
    vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
      project(),
    );
    mockHappyPathInputs();
    // Blind to the winner on both reads: the index aborts only when a run WAS
    // active, and `findActive` sees only `queued`/`running`, so this is the
    // real race where the winner left both states in between.
    vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(
      null,
    );
    mocks.db.transaction.mockRejectedValueOnce({
      code: "23505",
      constraint: "async_runs_one_active_key_idx",
    });

    const error = await createGrowthAuditRun(
      { workspaceId },
      projectId,
      actorId,
      idempotencyKey,
      body,
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      // Both pointers present and explicitly null, so a client distinguishes
      // "we have no pointer" from "the field is missing"; and no invented
      // `Location`, because there is no run to point a header at either.
      current: { runId: null, statusUrl: null, activeKey: "growth_audit" },
      extraHeaders: undefined,
    });
    // The detail must not assert an active run it cannot observe.
    expect((error as Error).message).not.toContain("is already active");
  });
});
