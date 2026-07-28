import {
  DataSnapshotsRepository,
  GrowthMapReadRepository,
  InternalLinkMapIntegrityError,
  InternalLinkMapRepository,
  ProjectsRepository,
  SitesRepository,
  contentHash,
  type CanonicalValue,
  type InternalLinkCrawlObservationRow,
} from "@sf/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getProjectAuditInternalLinkMap } = await import(
  "./growth-map-internal-link-map"
);

const ids = {
  workspace: "93000000-0000-4000-8000-000000000001",
  project: "93000000-0000-4000-8000-000000000002",
  site: "93000000-0000-4000-8000-000000000003",
  icp: "93000000-0000-4000-8000-000000000004",
  run: "93000000-0000-4000-8000-000000000005",
  collectionRun: "93000000-0000-4000-8000-000000000006",
  snapshot: "93000000-0000-4000-8000-000000000007",
  pageA1: "93000000-0000-4000-8000-000000000008",
  pageA2: "93000000-0000-4000-8000-000000000009",
  pageB: "93000000-0000-4000-8000-000000000010",
  pageC: "93000000-0000-4000-8000-000000000011",
  pageD: "93000000-0000-4000-8000-000000000012",
  observationA1: "93000000-0000-4000-8000-000000000013",
  observationA2: "93000000-0000-4000-8000-000000000014",
  observationB: "93000000-0000-4000-8000-000000000015",
  observationC: "93000000-0000-4000-8000-000000000016",
  observationD: "93000000-0000-4000-8000-000000000017",
  finding: "93000000-0000-4000-8000-000000000018",
  action: "93000000-0000-4000-8000-000000000019",
  topicShared: "93000000-0000-4000-8000-000000000020",
  topicOther: "93000000-0000-4000-8000-000000000021",
} as const;

const scope = { workspaceId: ids.workspace };
const projectScope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};
const exec = {} as never;
const now = new Date("2026-07-28T12:00:00.000Z");
const capturedAt = "2026-07-28T08:00:00.000Z";
const origin = "https://example.com";

function activeProject() {
  return {
    id: ids.project,
    workspace_id: ids.workspace,
    archived_at: null,
  };
}

function snapshot(
  availability: "available" | "partial" | "unavailable" = "available",
) {
  return {
    id: ids.snapshot,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    collection_run_id: ids.collectionRun,
    source_connection_id: null,
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    schema_version: "crawl.site_graph.v1",
    method_version: "crawl.engine.v1",
    captured_at: capturedAt,
    source_window: { start: null, end: null },
    availability,
    limitation:
      availability === "available"
        ? ""
        : availability === "partial"
          ? "Crawl reached its URL budget."
          : "Crawl source was unavailable.",
    raw_object_key: null,
    row_count: 5,
    checksum: "a".repeat(64),
    summary: {},
    created_at: capturedAt,
  };
}

function readableRun(
  crawlAvailability: "available" | "partial" | "unavailable" = "available",
) {
  const frozenSnapshot = snapshot(crawlAvailability);
  const inputManifest = {
    projectId: ids.project,
    siteId: ids.site,
    icp: {
      id: ids.icp,
      version: 2,
      contentHash: "b".repeat(64),
    },
    ruleSetVersion: "2026-07-27",
    promptSetVersion: "2026-07-27",
    deliveryLocale: "zh-CN",
    snapshots: [
      {
        snapshotId: frozenSnapshot.id,
        provider: frozenSnapshot.provider,
        datasetKey: frozenSnapshot.dataset_key,
        schemaVersion: frozenSnapshot.schema_version,
        methodVersion: frozenSnapshot.method_version,
        capturedAt: frozenSnapshot.captured_at,
        sourceWindow: frozenSnapshot.source_window,
        availability: frozenSnapshot.availability,
        checksum: frozenSnapshot.checksum,
      },
    ],
  };
  return {
    id: ids.run,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    icp_profile_id: ids.icp,
    icp_profile_version: 2,
    rule_set_version: "2026-07-27",
    prompt_set_version: "2026-07-27",
    output_locale: "zh-CN",
    input_manifest: inputManifest,
    input_hash: contentHash(inputManifest as CanonicalValue),
    coverage: {},
    created_at: capturedAt,
    run_status: "completed" as const,
    run_completed_at: "2026-07-28T08:05:00.000Z",
  };
}

function site() {
  return {
    id: ids.site,
    workspace_id: ids.workspace,
    project_id: ids.project,
    origin,
    host: "example.com",
  };
}

function pageProjection(
  fetchUrl: string,
  title: string,
  internalOutlinks: readonly {
    targetSubjectUrl: string;
    rel: string | null;
    anchorText: string | null;
  }[] = [],
) {
  return {
    fetchUrl,
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: true,
    robotsDirectives: [],
    title,
    metaDescription: null,
    h1: [],
    headings: [],
    wordCount: 500,
    internalOutlinks,
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: true,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 100,
    contentType: "text/html",
  };
}

function observation(
  input: {
    observationId: string;
    sitePageId: string;
    subjectRef: string;
    fetchUrl: string;
    title: string;
    internalOutlinks?: readonly {
      targetSubjectUrl: string;
      rel: string | null;
      anchorText: string | null;
    }[];
    availability?: "available" | "partial" | "unavailable";
  },
): InternalLinkCrawlObservationRow {
  const availability = input.availability ?? "available";
  return {
    observation_id: input.observationId,
    workspace_id: ids.workspace,
    project_id: ids.project,
    snapshot_id: ids.snapshot,
    site_page_id: input.sitePageId,
    provider: "crawl",
    metric_key: "crawl.page.v1",
    subject_type: "url",
    subject_ref: input.subjectRef,
    observed_at: capturedAt,
    availability,
    value_numeric: null,
    value_text: null,
    value_json:
      availability === "available"
        ? pageProjection(
            input.fetchUrl,
            input.title,
            input.internalOutlinks,
          )
        : null,
    unit: null,
    origin: "direct_public",
    method: "observed",
    grade: "B",
    support: "supports",
    limitation:
      availability === "available"
        ? ""
        : "The exact page could not be observed.",
    normalized_url: input.fetchUrl,
  };
}

function completeObservations(): InternalLinkCrawlObservationRow[] {
  return [
    observation({
      observationId: ids.observationA1,
      sitePageId: ids.pageA1,
      subjectRef: `${origin}/a`,
      fetchUrl: `${origin}/a`,
      title: "A exact",
      internalOutlinks: [
        {
          targetSubjectUrl: `${origin}/b`,
          anchorText: "B",
          rel: null,
        },
        {
          targetSubjectUrl: `${origin}/c`,
          anchorText: "C",
          rel: "nofollow",
        },
      ],
    }),
    observation({
      observationId: ids.observationA2,
      sitePageId: ids.pageA2,
      subjectRef: `${origin}/a`,
      fetchUrl: `${origin}/a/`,
      title: "A slash",
      internalOutlinks: [
        {
          targetSubjectUrl: `${origin}/b`,
          anchorText: "B alternate",
          rel: null,
        },
      ],
    }),
    observation({
      observationId: ids.observationB,
      sitePageId: ids.pageB,
      subjectRef: `${origin}/b`,
      fetchUrl: `${origin}/b/`,
      title: "B",
      internalOutlinks: [
        {
          targetSubjectUrl: `${origin}/a`,
          anchorText: "A",
          rel: null,
        },
      ],
    }),
    observation({
      observationId: ids.observationC,
      sitePageId: ids.pageC,
      subjectRef: `${origin}/c`,
      fetchUrl: `${origin}/c/`,
      title: "C",
    }),
    observation({
      observationId: ids.observationD,
      sitePageId: ids.pageD,
      subjectRef: `${origin}/d`,
      fetchUrl: `${origin}/d/`,
      title: "D",
    }),
  ];
}

function installDefaults(): void {
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(
    activeProject() as never,
  );
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "findLatestReadableRun",
  ).mockResolvedValue(readableRun());
  vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue(
    [snapshot()] as never,
  );
  vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue(
    site() as never,
  );
  vi.spyOn(
    InternalLinkMapRepository.prototype,
    "listFrozenCrawlObservations",
  ).mockResolvedValue(completeObservations());
  vi.spyOn(
    InternalLinkMapRepository.prototype,
    "listExecutionRefs",
  ).mockResolvedValue([
    {
      site_page_id: ids.pageD,
      finding_id: ids.finding,
      action_id: ids.action,
    },
  ]);
  vi.spyOn(
    InternalLinkMapRepository.prototype,
    "readConfirmedPageTopics",
  ).mockResolvedValue({
    state: "confirmed",
    projectId: ids.project,
    topicModelRevision: 3,
    mappings: [
      {
        sitePageId: ids.pageA1,
        topicNodeId: ids.topicShared,
        topicModelRevision: 3,
        topicLabel: "Customer onboarding",
      },
      {
        sitePageId: ids.pageB,
        topicNodeId: ids.topicShared,
        topicModelRevision: 3,
        topicLabel: "Customer onboarding",
      },
      {
        sitePageId: ids.pageC,
        topicNodeId: ids.topicShared,
        topicModelRevision: 3,
        topicLabel: "Customer onboarding",
      },
      {
        sitePageId: ids.pageD,
        topicNodeId: ids.topicOther,
        topicModelRevision: 3,
        topicLabel: "Other",
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installDefaults();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Growth Map Internal Link Map read service", () => {
  it("deduplicates exact URL variants into deterministic canonical nodes and frozen edges", async () => {
    const result = await getProjectAuditInternalLinkMap(
      scope,
      ids.project,
      null,
      exec,
      now,
    );

    expect(result).toMatchObject({
      projectId: ids.project,
      diagnosticRunId: ids.run,
      crawlSnapshot: {
        snapshotId: ids.snapshot,
        capturedAt,
        availability: "available",
        limitation: null,
      },
      coverage: {
        availability: "available",
        crawlCompleteness: "complete",
        limitations: [],
      },
      graph: {
        totalEdgeCount: 3,
        edgesTruncated: false,
      },
      selectedPage: null,
      generatedAt: now.toISOString(),
    });
    expect(result.graph.nodes).toEqual([
      {
        canonicalUrl: `${origin}/a`,
        sitePageIds: [ids.pageA1, ids.pageA2],
        title: "A exact",
        inboundCount: 1,
        outboundCount: 2,
        status: "connected",
        executionRefs: [],
      },
      {
        canonicalUrl: `${origin}/b`,
        sitePageIds: [ids.pageB],
        title: "B",
        inboundCount: 1,
        outboundCount: 1,
        status: "connected",
        executionRefs: [],
      },
      {
        canonicalUrl: `${origin}/c`,
        sitePageIds: [ids.pageC],
        title: "C",
        inboundCount: 1,
        outboundCount: 0,
        status: "one_way",
        executionRefs: [],
      },
      {
        canonicalUrl: `${origin}/d`,
        sitePageIds: [ids.pageD],
        title: "D",
        inboundCount: 0,
        outboundCount: 0,
        status: "orphan",
        executionRefs: [
          { findingId: ids.finding, actionId: ids.action },
        ],
      },
    ]);
    expect(result.graph.edges).toEqual([
      {
        sourceCanonicalUrl: `${origin}/a`,
        targetCanonicalUrl: `${origin}/b`,
        sourceSitePageIds: [ids.pageA1, ids.pageA2],
        targetSitePageIds: [ids.pageB],
        facts: [
          {
            observationId: ids.observationA1,
            sourceSitePageId: ids.pageA1,
            anchorText: "B",
            rel: null,
          },
          {
            observationId: ids.observationA2,
            sourceSitePageId: ids.pageA2,
            anchorText: "B alternate",
            rel: null,
          },
        ],
        reciprocal: true,
      },
      expect.objectContaining({
        sourceCanonicalUrl: `${origin}/a`,
        targetCanonicalUrl: `${origin}/c`,
        reciprocal: false,
      }),
      expect.objectContaining({
        sourceCanonicalUrl: `${origin}/b`,
        targetCanonicalUrl: `${origin}/a`,
        reciprocal: true,
      }),
    ]);
  });

  it("returns inbound evidence and only confirmed same-topic missing-link recommendations for one selected page", async () => {
    const result = await getProjectAuditInternalLinkMap(
      scope,
      ids.project,
      ids.pageB,
      exec,
      now,
    );

    expect(result.selectedPage).toEqual({
      selectedSitePageId: ids.pageB,
      canonicalUrl: `${origin}/b`,
      inboundSources: [
        expect.objectContaining({
          sourceCanonicalUrl: `${origin}/a`,
          targetCanonicalUrl: `${origin}/b`,
        }),
      ],
      recommendationCoverage: {
        availability: "available",
        limitations: [],
      },
      recommendations: [
        {
          sourceCanonicalUrl: `${origin}/c`,
          sourceSitePageIds: [ids.pageC],
          targetCanonicalUrl: `${origin}/b`,
          targetSitePageIds: [ids.pageB],
          basis: {
            kind: "same_confirmed_topic",
            topicNodeId: ids.topicShared,
            topicModelRevision: 3,
            topicLabel: "Customer onboarding",
          },
          explanation:
            "页面与目标页同属已确认 Topic「Customer onboarding」，但冻结 Crawl 中尚未观察到指向目标页的内链。",
        },
      ],
      totalRecommendationCount: 1,
      recommendationsTruncated: false,
    });
    expect(
      InternalLinkMapRepository.prototype.readConfirmedPageTopics,
    ).toHaveBeenCalledWith(projectScope, [
      ids.pageA1,
      ids.pageA2,
      ids.pageB,
      ids.pageC,
      ids.pageD,
    ]);
  });

  it("does not infer orphan pages from a partial crawl or an unresolved target", async () => {
    vi.mocked(
      GrowthMapReadRepository.prototype.findLatestReadableRun,
    ).mockResolvedValueOnce(readableRun("partial"));
    vi.mocked(
      DataSnapshotsRepository.prototype.findByIds,
    ).mockResolvedValueOnce([snapshot("partial")] as never);
    vi.mocked(
      InternalLinkMapRepository.prototype.listFrozenCrawlObservations,
    ).mockResolvedValueOnce([
      observation({
        observationId: ids.observationC,
        sitePageId: ids.pageC,
        subjectRef: `${origin}/c`,
        fetchUrl: `${origin}/c/`,
        title: "C",
        internalOutlinks: [
          {
            targetSubjectUrl: `${origin}/not-observed`,
            anchorText: "Missing target",
            rel: null,
          },
        ],
      }),
    ]);
    vi.mocked(
      InternalLinkMapRepository.prototype.listExecutionRefs,
    ).mockResolvedValueOnce([]);

    const result = await getProjectAuditInternalLinkMap(
      scope,
      ids.project,
      null,
      exec,
      now,
    );

    expect(result.coverage).toMatchObject({
      availability: "partial",
      crawlCompleteness: "partial",
      limitations: expect.arrayContaining([
        "Crawl reached its URL budget.",
        expect.stringMatching(/未收录目标页/),
      ]),
    });
    expect(result.graph.nodes).toEqual([
      expect.objectContaining({
        canonicalUrl: `${origin}/c`,
        inboundCount: 0,
        outboundCount: 0,
        status: "unknown",
      }),
    ]);
    expect(result.graph.edges).toEqual([]);
  });

  it("keeps a frozen crawl partial when an observation has no exact SitePage lineage", async () => {
    const unlineaged = {
      ...observation({
        observationId: ids.observationC,
        sitePageId: ids.pageC,
        subjectRef: `${origin}/ambiguous`,
        fetchUrl: `${origin}/ambiguous/`,
        title: "Ambiguous",
        availability: "unavailable",
      }),
      site_page_id: null,
      normalized_url: null,
    };
    vi.mocked(
      InternalLinkMapRepository.prototype.listFrozenCrawlObservations,
    ).mockResolvedValueOnce([
      observation({
        observationId: ids.observationD,
        sitePageId: ids.pageD,
        subjectRef: `${origin}/d`,
        fetchUrl: `${origin}/d/`,
        title: "D",
      }),
      unlineaged,
    ]);
    vi.mocked(
      InternalLinkMapRepository.prototype.listExecutionRefs,
    ).mockResolvedValueOnce([]);

    const result = await getProjectAuditInternalLinkMap(
      scope,
      ids.project,
      null,
      exec,
      now,
    );

    expect(result.coverage).toMatchObject({
      availability: "partial",
      crawlCompleteness: "partial",
      limitations: expect.arrayContaining([
        expect.stringMatching(/SitePage 血缘/),
      ]),
    });
    expect(result.graph.nodes).toEqual([
      expect.objectContaining({
        canonicalUrl: `${origin}/d`,
        status: "unknown",
      }),
    ]);
  });

  it("reports unavailable without graph guesses when no readable diagnostic exists", async () => {
    vi.mocked(
      GrowthMapReadRepository.prototype.findLatestReadableRun,
    ).mockResolvedValueOnce(null);

    const result = await getProjectAuditInternalLinkMap(
      scope,
      ids.project,
      ids.pageB,
      exec,
      now,
    );

    expect(result).toEqual({
      projectId: ids.project,
      diagnosticRunId: null,
      crawlSnapshot: null,
      coverage: {
        availability: "unavailable",
        crawlCompleteness: "unavailable",
        limitations: ["当前项目没有可读取的已完成诊断。"],
      },
      graph: {
        nodes: [],
        edges: [],
        totalEdgeCount: 0,
        edgesTruncated: false,
      },
      selectedPage: null,
      generatedAt: now.toISOString(),
    });
    expect(
      InternalLinkMapRepository.prototype.listFrozenCrawlObservations,
    ).not.toHaveBeenCalled();
  });

  it("preserves an unavailable frozen Crawl Snapshot instead of treating zero pages as truth", async () => {
    vi.mocked(
      GrowthMapReadRepository.prototype.findLatestReadableRun,
    ).mockResolvedValueOnce(readableRun("unavailable"));
    vi.mocked(
      DataSnapshotsRepository.prototype.findByIds,
    ).mockResolvedValueOnce([snapshot("unavailable")] as never);

    const result = await getProjectAuditInternalLinkMap(
      scope,
      ids.project,
      null,
      exec,
      now,
    );

    expect(result).toMatchObject({
      diagnosticRunId: ids.run,
      crawlSnapshot: {
        snapshotId: ids.snapshot,
        availability: "unavailable",
        limitation: "Crawl source was unavailable.",
      },
      coverage: {
        availability: "unavailable",
        crawlCompleteness: "unavailable",
        limitations: ["Crawl source was unavailable."],
      },
      graph: {
        nodes: [],
        edges: [],
        totalEdgeCount: 0,
        edgesTruncated: false,
      },
      selectedPage: null,
    });
    expect(
      InternalLinkMapRepository.prototype.listFrozenCrawlObservations,
    ).not.toHaveBeenCalled();
  });

  it("returns no recommendation guesses when confirmed Topic authority is absent", async () => {
    vi.mocked(
      InternalLinkMapRepository.prototype.readConfirmedPageTopics,
    ).mockResolvedValueOnce({
      state: "no_confirmed_model",
      projectId: ids.project,
    });

    const result = await getProjectAuditInternalLinkMap(
      scope,
      ids.project,
      ids.pageB,
      exec,
      now,
    );

    expect(result.selectedPage).toMatchObject({
      recommendationCoverage: {
        availability: "unavailable",
        limitations: ["尚无已确认的 Topic Model，无法生成内链推荐。"],
      },
      recommendations: [],
      totalRecommendationCount: 0,
      recommendationsTruncated: false,
    });
  });

  it("does not borrow a sibling exact variant's Topic mapping for the selected SitePage", async () => {
    const result = await getProjectAuditInternalLinkMap(
      scope,
      ids.project,
      ids.pageA2,
      exec,
      now,
    );

    expect(result.selectedPage).toMatchObject({
      selectedSitePageId: ids.pageA2,
      canonicalUrl: `${origin}/a`,
      recommendationCoverage: {
        availability: "unavailable",
        limitations: [
          "目标页没有已确认的 Topic/Keyword 映射，无法生成内链推荐。",
        ],
      },
      recommendations: [],
      totalRecommendationCount: 0,
      recommendationsTruncated: false,
    });
  });

  it("hides foreign selected SitePage identities after building the scoped frozen graph", async () => {
    await expect(
      getProjectAuditInternalLinkMap(
        scope,
        ids.project,
        "93000000-0000-4000-8000-000000000099",
        exec,
        now,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(
      InternalLinkMapRepository.prototype.readConfirmedPageTopics,
    ).not.toHaveBeenCalled();
  });

  it("maps repository and frozen-lineage integrity failures to dependency unavailable", async () => {
    vi.mocked(
      InternalLinkMapRepository.prototype.listFrozenCrawlObservations,
    ).mockRejectedValueOnce(
      new InternalLinkMapIntegrityError(
        "CRAWL_OBSERVATION_LIMIT_EXCEEDED",
      ),
    );

    await expect(
      getProjectAuditInternalLinkMap(
        scope,
        ids.project,
        null,
        exec,
        now,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });

    vi.mocked(
      GrowthMapReadRepository.prototype.findLatestReadableRun,
    ).mockResolvedValueOnce({
      ...readableRun(),
      input_hash: "c".repeat(64),
    });
    await expect(
      getProjectAuditInternalLinkMap(
        scope,
        ids.project,
        null,
        exec,
        now,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("uses one repeatable-read, read-only production transaction", async () => {
    const sentinel = new Error("transaction boundary");
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

    await expect(
      getProjectAuditInternalLinkMap(
        scope,
        ids.project,
        null,
        undefined,
        now,
      ),
    ).rejects.toBe(sentinel);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid injected clock before opening a transaction", async () => {
    await expect(
      getProjectAuditInternalLinkMap(
        scope,
        ids.project,
        null,
        undefined,
        new Date(Number.NaN),
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
