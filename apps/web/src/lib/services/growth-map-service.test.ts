import {
  contentHash,
  DataSnapshotsRepository,
  EvidenceRepository,
  GrowthMapReadRepository,
  ProjectsRepository,
  sha256Hex,
  type CanonicalValue,
  type DataSnapshotRow,
  type GrowthMapReadableRunRow,
} from "@sf/db";
import {
  buildContextProjectionV1,
  GOVERNANCE_PROJECTION_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import { ProblemError } from "@sf/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildExecutionPreview } from "./execution-preview.ts";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

const { getProjectAuditUrl, listProjectAuditUrls } =
  await import("./growth-map.ts");

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  uiLocale: "zh-CN" as const,
};
const projectId = "00000000-0000-4000-8000-000000000002";
const sitePageId = "00000000-0000-4000-8000-000000000003";
const latestRunId = "00000000-0000-4000-8000-000000000004";
const olderPublishedRunId = "a0000000-0000-7000-8000-000000000005";
const snapshotId = "00000000-0000-4000-8000-000000000006";
const foreignRunId = "00000000-0000-4000-8000-000000000007";
const unpublishedRunId = "00000000-0000-4000-8000-000000000008";
const siteId = "00000000-0000-4000-8000-000000000009";
const icpProfileId = "00000000-0000-4000-8000-000000000010";
const collectionRunId = "00000000-0000-4000-8000-000000000011";
const sourceConnectionId = "00000000-0000-4000-8000-000000000012";
const findingId = "00000000-0000-4000-8000-000000000013";
const findingTargetId = "00000000-0000-4000-8000-000000000014";
const observationId = "00000000-0000-4000-8000-000000000015";
const evidenceId = "00000000-0000-4000-8000-000000000016";
const actionId = "00000000-0000-4000-8000-000000000017";
const artifactId = "00000000-0000-4000-8000-000000000018";
const capturedAt = "2026-07-21T08:00:00.000Z";
const normalizedUrl = "https://example.test/customer-onboarding/";
const profileContentHash = "c".repeat(64);
const contextProjection = buildContextProjectionV1({
  profileContentHash,
  profile: {
    profileSchemaVersion: "product-profile.0.3.0",
    productName: "Acme",
    oneLiner: "Ship faster",
    productType: "saas",
    businessModels: ["subscription"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [],
  },
  siteLanguageCodes: ["en"],
});

type GrowthMapReadKind = "portfolio" | "detail";

function readWithPin(
  kind: GrowthMapReadKind,
  diagnosticRunId: string,
  exec: unknown,
): Promise<unknown> {
  return kind === "portfolio"
    ? listProjectAuditUrls(
        scope,
        projectId,
        { limit: 50, cursor: null, diagnosticRunId },
        exec as never,
      )
    : getProjectAuditUrl(
        scope,
        projectId,
        sitePageId,
        { diagnosticRunId },
        exec as never,
      );
}

function publishedGenerationFixture(runId = olderPublishedRunId): {
  readonly run: GrowthMapReadableRunRow;
  readonly snapshot: DataSnapshotRow;
} {
  const sourceWindow = { start: null, end: null };
  const snapshot: DataSnapshotRow = {
    id: snapshotId,
    workspace_id: scope.workspaceId,
    project_id: projectId,
    site_id: siteId,
    collection_run_id: collectionRunId,
    source_connection_id: sourceConnectionId,
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    schema_version: "0.3.0",
    method_version: "crawl.site_graph.v2",
    captured_at: capturedAt,
    source_window: sourceWindow,
    availability: "available",
    limitation: "Bounded public crawl.",
    raw_object_key: null,
    row_count: 0,
    checksum: "a".repeat(64),
    summary: {},
    created_at: capturedAt,
  };
  const manifest: Record<string, unknown> = {
    projectId,
    siteId,
    icp: {
      id: icpProfileId,
      version: 2,
      contentHash: profileContentHash,
    },
    snapshots: [
      {
        snapshotId,
        provider: snapshot.provider,
        datasetKey: snapshot.dataset_key,
        schemaVersion: snapshot.schema_version,
        methodVersion: snapshot.method_version,
        checksum: snapshot.checksum,
        capturedAt: snapshot.captured_at,
        sourceWindow,
        availability: snapshot.availability,
      },
    ],
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en-US",
    governance: {
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [],
      competitors: [],
    },
    contextProjection,
  };
  return {
    snapshot,
    run: {
      id: runId,
      workspace_id: scope.workspaceId,
      project_id: projectId,
      site_id: siteId,
      icp_profile_id: icpProfileId,
      icp_profile_version: 2,
      rule_set_version: RULE_SET_VERSION,
      prompt_set_version: PROMPT_SET_VERSION,
      output_locale: "en-US",
      input_manifest: manifest,
      input_hash: contentHash(manifest as CanonicalValue),
      coverage: {},
      created_at: capturedAt,
      run_status: "completed",
      run_completed_at: capturedAt,
    },
  };
}

const emptySummary = {
  urlCount: 0,
  opportunityUrlCount: 0,
  listedUrlCount: 0,
  signalCount: 0,
  precedingUrlCount: 0,
  rankGroups: [],
} as const;

function installPortfolioSummary(
  summary: {
    readonly urlCount: number;
    readonly opportunityUrlCount: number;
    readonly listedUrlCount: number;
    readonly signalCount: number;
    readonly precedingUrlCount: number;
    readonly rankGroups: readonly {
      readonly severityRank: number;
      readonly coverageCount: number;
      readonly findingCount: number;
      readonly urlCount: number;
    }[];
  } = emptySummary,
) {
  return vi
    .spyOn(GrowthMapReadRepository.prototype, "summarizeCurrentRunUrls")
    .mockResolvedValue(summary);
}

function installUrlDetailFixtures(options: {
  readonly ruleId: string;
  readonly reviewState: "unreviewed" | "confirmed";
  readonly withExecution: boolean;
  readonly severity?: "critical" | "high" | "medium" | "low";
  readonly active?: boolean;
  readonly normalizedUrl?: string;
  readonly coverageCount?: number;
}) {
  const generation = publishedGenerationFixture();
  const pageUrl = options.normalizedUrl ?? normalizedUrl;
  const pageExtract = {
    schemaVersion: "crawl.page-extract.v1",
    depth: 0,
    subjectUrl: pageUrl,
    projection: {
      fetchUrl: pageUrl,
      title: "Customer onboarding",
    },
  };
  const inventory = {
    workspace_id: scope.workspaceId,
    project_id: projectId,
    site_page_id: sitePageId,
    site_id: siteId,
    normalized_url: pageUrl,
    normalized_url_hash: sha256Hex(pageUrl),
    template_key: null,
    site_page_created_at: capturedAt,
    page_snapshot_id: "00000000-0000-4000-8000-000000000019",
    crawl_snapshot_id: snapshotId,
    page_snapshot_content_hash: contentHash(
      pageExtract as unknown as CanonicalValue,
    ),
    page_snapshot_canonical_extract: null,
    page_snapshot_extract: pageExtract,
    page_snapshot_captured_at: capturedAt,
  };
  const observation = {
    id: observationId,
    workspace_id: scope.workspaceId,
    project_id: projectId,
    snapshot_id: snapshotId,
    site_page_id: sitePageId,
    provider: "crawl",
    metric_key: "crawl.page.v1",
    subject_type: "url",
    subject_ref: pageUrl,
    observed_at: capturedAt,
    availability: "available",
    value_numeric: null,
    value_text: null,
    value_json: {
      fetchUrl: pageUrl,
      status: 200,
      finalStatus: 200,
      wordCount: 1200,
      responseMs: 100,
    },
    unit: null,
    origin: "source_observation",
    method: "observed",
    grade: "A",
    support: "supports",
    limitation: "Bounded public crawl.",
  };
  const target = {
    id: findingTargetId,
    workspace_id: scope.workspaceId,
    project_id: projectId,
    site_id: siteId,
    finding_id: findingId,
    diagnostic_run_id: olderPublishedRunId,
    relation: "direct_url",
    target_kind: "url",
    target_ref: pageUrl,
    resolution_state: "resolved",
    basis_kind: "crawl_exact_fetch",
    site_page_id: sitePageId,
    page_snapshot_id: inventory.page_snapshot_id,
    source_observation_id: observationId,
    member_ref: pageUrl,
    limitation: null,
    relation_key: "direct-url",
    created_at: capturedAt,
  };
  const finding = {
    id: findingId,
    workspace_id: scope.workspaceId,
    project_id: projectId,
    finding_key: `${pageUrl}:${options.ruleId}`,
    rule_id: options.ruleId,
    rule_version: options.ruleId === "TECH-HTTP-001" ? 2 : 1,
    rule_family: "technical",
    intent: "fix",
    domain: "technical_search",
    title_key: "finding.technical",
    title_args: {},
    summary: "Fix the selected URL.",
    summary_locale: "en",
    summary_invocation_id: null,
    subject_refs: [pageUrl],
    severity: options.severity ?? "high",
    confidence: "high",
    review_state: options.reviewState,
    review_revision: options.reviewState === "confirmed" ? 1 : 0,
    review_reason: null,
    review_note: null,
    active: options.active ?? true,
    regressed: false,
    first_seen_run_id: olderPublishedRunId,
    last_seen_run_id: olderPublishedRunId,
    first_seen_at: capturedAt,
    last_seen_at: capturedAt,
    resolved_at: null,
    created_at: capturedAt,
    updated_at: capturedAt,
  };

  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: projectId,
    default_delivery_locale: "en",
  } as never);
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "findReadableRunById",
  ).mockResolvedValue(generation.run);
  vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
    generation.snapshot,
  ]);
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "findCurrentRunUrl",
  ).mockResolvedValue(inventory as never);
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "listObservations",
  ).mockResolvedValue([observation] as never);
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "listResolvedTargets",
  ).mockResolvedValue([target] as never);
  vi.spyOn(GrowthMapReadRepository.prototype, "listFindings").mockResolvedValue(
    [finding] as never,
  );
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "listFindingCoverageCounts",
  ).mockResolvedValue(new Map([[findingId, options.coverageCount ?? 1]]));
  vi.spyOn(EvidenceRepository.prototype, "listForFindings").mockResolvedValue([
    { finding_id: findingId, evidence_id: evidenceId, role: "primary" },
  ] as never);
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "listActiveActions",
  ).mockResolvedValue(
    options.withExecution
      ? ([{ id: actionId, source_finding_id: findingId }] as never)
      : [],
  );
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "listArtifacts",
  ).mockResolvedValue(
    options.withExecution
      ? ([{ id: artifactId, action_id: actionId }] as never)
      : [],
  );
}

describe("Growth Map URL read boundary", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: "reviewable Finding",
      ruleId: "TECH-HTTP-001",
      reviewState: "unreviewed" as const,
      withExecution: false,
      expectedPreview: buildExecutionPreview("TECH-HTTP-001", "en"),
      expectedExecutionRef: null,
    },
    {
      name: "confirmed Finding",
      ruleId: "TECH-HTTP-001",
      reviewState: "confirmed" as const,
      withExecution: true,
      expectedPreview: buildExecutionPreview("TECH-HTTP-001", "en"),
      expectedExecutionRef: { actionId, artifactIds: [artifactId] },
    },
    {
      name: "unknown runtime template",
      ruleId: "TECH-UNKNOWN-999",
      reviewState: "unreviewed" as const,
      withExecution: false,
      expectedPreview: null,
      expectedExecutionRef: null,
    },
  ])(
    "keeps evidence readable and preview identity separate for a $name",
    async ({
      ruleId,
      reviewState,
      withExecution,
      expectedPreview,
      expectedExecutionRef,
    }) => {
      installUrlDetailFixtures({ ruleId, reviewState, withExecution });

      const result = await getProjectAuditUrl(
        scope,
        projectId,
        sitePageId,
        { diagnosticRunId: olderPublishedRunId },
        {} as never,
      );

      expect(result.data.findings).toHaveLength(1);
      const projectedFinding = result.data.findings[0];
      expect(projectedFinding).toMatchObject({
        findingId,
        ruleId,
        reviewState,
        evidenceIds: [evidenceId],
      });
      expect(projectedFinding?.executionPreview).toEqual(expectedPreview);
      expect(projectedFinding?.executionRef).toEqual(expectedExecutionRef);
      expect(result.data.coverage.limitations).toContain(
        "本次诊断未冻结 GSC 数据快照。",
      );
    },
  );

  it.each(["portfolio", "detail"] as const)(
    "keeps the latest frozen run for an unpinned %s read when its output locale differs from the workbench locale",
    async (kind) => {
      vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
        id: projectId,
      } as never);
      const latestRun = vi
        .spyOn(GrowthMapReadRepository.prototype, "findLatestReadableRun")
        .mockResolvedValue({
          id: latestRunId,
          output_locale: "en-US",
          input_manifest: {
            snapshots: [{ snapshotId }],
          },
        } as never);
      const exactRun = vi.spyOn(
        GrowthMapReadRepository.prototype,
        "findReadableRunById",
      );
      const sentinel = new Error("reached frozen snapshot lookup");
      const snapshots = vi
        .spyOn(DataSnapshotsRepository.prototype, "findByIds")
        .mockRejectedValue(sentinel);
      const exec = {} as never;

      await expect(
        kind === "portfolio"
          ? listProjectAuditUrls(
              scope,
              projectId,
              { limit: 50, cursor: null },
              exec,
            )
          : // This deliberately locks the legacy fourth-argument Executor seam.
            getProjectAuditUrl(scope, projectId, sitePageId, exec),
      ).rejects.toBe(sentinel);
      expect(latestRun).toHaveBeenCalledWith({
        workspaceId: scope.workspaceId,
        projectId,
      });
      expect(latestRun).toHaveBeenCalledTimes(1);
      expect(exactRun).not.toHaveBeenCalled();
      expect(snapshots).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["portfolio", "detail"] as const)(
    "binds a canonical UUIDv7 pinned %s read to the exact older published run without consulting latest",
    async (kind) => {
      vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
        id: projectId,
      } as never);
      const latestRun = vi.spyOn(
        GrowthMapReadRepository.prototype,
        "findLatestReadableRun",
      );
      const exactRun = vi
        .spyOn(GrowthMapReadRepository.prototype, "findReadableRunById")
        .mockResolvedValue({
          id: olderPublishedRunId,
          output_locale: "en-US",
          input_manifest: {
            snapshots: [{ snapshotId }],
          },
        } as never);
      const sentinel = new Error("reached exact frozen snapshot lookup");
      const snapshots = vi
        .spyOn(DataSnapshotsRepository.prototype, "findByIds")
        .mockRejectedValue(sentinel);

      await expect(readWithPin(kind, olderPublishedRunId, {})).rejects.toBe(
        sentinel,
      );
      expect(exactRun).toHaveBeenCalledWith(
        { workspaceId: scope.workspaceId, projectId },
        olderPublishedRunId,
      );
      expect(exactRun).toHaveBeenCalledTimes(1);
      expect(latestRun).not.toHaveBeenCalled();
      expect(snapshots).toHaveBeenCalledWith(
        { workspaceId: scope.workspaceId, projectId },
        [snapshotId],
      );
    },
  );

  it("returns the exact older published diagnosticRunId from a pinned portfolio response", async () => {
    const current = publishedGenerationFixture();
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
      id: projectId,
    } as never);
    const latestRun = vi.spyOn(
      GrowthMapReadRepository.prototype,
      "findLatestReadableRun",
    );
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "findReadableRunById",
    ).mockResolvedValue(current.run);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      current.snapshot,
    ]);
    const listUrls = vi
      .spyOn(GrowthMapReadRepository.prototype, "listCurrentRunUrls")
      .mockResolvedValue({ rows: [], nextCursor: null });
    installPortfolioSummary();
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listObservations",
    ).mockResolvedValue([]);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listResolvedTargets",
    ).mockResolvedValue([]);

    const result = await listProjectAuditUrls(
      scope,
      projectId,
      {
        limit: 50,
        cursor: null,
        diagnosticRunId: olderPublishedRunId,
      },
      {} as never,
    );

    expect(result.diagnosticRunId).toBe(olderPublishedRunId);
    expect(listUrls).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      olderPublishedRunId,
      { limit: 50, cursor: null, opportunitiesOnly: true },
    );
    expect(latestRun).not.toHaveBeenCalled();
  });

  it("reports the whole frozen generation in meta.summary, not the loaded page", async () => {
    const current = publishedGenerationFixture();
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
      id: projectId,
    } as never);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "findReadableRunById",
    ).mockResolvedValue(current.run);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      current.snapshot,
    ]);
    const listUrls = vi
      .spyOn(GrowthMapReadRepository.prototype, "listCurrentRunUrls")
      .mockResolvedValue({ rows: [], nextCursor: "bmV4dC1wYWdl" });
    // The production Astrologywiki generation: 647 admitted URLs, 359 with an
    // Opportunity, and only 8 deduplicated Findings behind 2934 memberships.
    const summarize = installPortfolioSummary({
      urlCount: 647,
      opportunityUrlCount: 359,
      listedUrlCount: 359,
      signalCount: 8,
      precedingUrlCount: 0,
      rankGroups: [
        { severityRank: 2, coverageCount: 354, findingCount: 1, urlCount: 353 },
        { severityRank: 2, coverageCount: 6, findingCount: 1, urlCount: 1 },
        { severityRank: 2, coverageCount: 2, findingCount: 1, urlCount: 2 },
        { severityRank: 2, coverageCount: 1, findingCount: 1, urlCount: 3 },
      ],
    });
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listObservations",
    ).mockResolvedValue([]);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listResolvedTargets",
    ).mockResolvedValue([]);

    const result = await listProjectAuditUrls(
      scope,
      projectId,
      {
        limit: 50,
        cursor: null,
        search: "wiki",
        diagnosticRunId: olderPublishedRunId,
      },
      {} as never,
    );

    expect(result.meta.summary).toEqual({
      urlCount: 647,
      opportunityUrlCount: 359,
      listedUrlCount: 359,
      signalCount: 8,
      // A medium Finding on 354 pages outranks the same severity on one page.
      priorityCounts: { critical: 0, high: 353, medium: 1, low: 5 },
      precedingUrlCount: 0,
    });
    // The summary is counted under the exact filters the page was read with.
    expect(summarize).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      olderPublishedRunId,
      { cursor: null, opportunitiesOnly: true, search: "wiki" },
    );
    expect(listUrls).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId },
      olderPublishedRunId,
      { limit: 50, cursor: null, opportunitiesOnly: true, search: "wiki" },
    );
  });

  it("fails closed when a summary rank group has no readable severity", async () => {
    const current = publishedGenerationFixture();
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
      id: projectId,
    } as never);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "findReadableRunById",
    ).mockResolvedValue(current.run);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      current.snapshot,
    ]);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listCurrentRunUrls",
    ).mockResolvedValue({ rows: [], nextCursor: null });
    installPortfolioSummary({
      urlCount: 1,
      opportunityUrlCount: 1,
      listedUrlCount: 1,
      signalCount: 1,
      precedingUrlCount: 0,
      rankGroups: [
        { severityRank: 4, coverageCount: 1, findingCount: 1, urlCount: 1 },
      ],
    });
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listObservations",
    ).mockResolvedValue([]);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listResolvedTargets",
    ).mockResolvedValue([]);

    await expect(
      listProjectAuditUrls(
        scope,
        projectId,
        { limit: 50, cursor: null, diagnosticRunId: olderPublishedRunId },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it.each([
    {
      name: "an ignored Finding",
      reviewState: "ignored" as const,
      active: true,
    },
    {
      name: "a resolved Finding",
      reviewState: "unreviewed" as const,
      active: false,
    },
  ])("never lets $name keep a URL ranked", async ({ reviewState, active }) => {
    installUrlDetailFixtures({
      ruleId: "TECH-HTTP-001",
      reviewState: reviewState as "unreviewed" | "confirmed",
      withExecution: false,
      active,
      coverageCount: 354,
    });

    const result = await getProjectAuditUrl(
      scope,
      projectId,
      sitePageId,
      { diagnosticRunId: olderPublishedRunId },
      {} as never,
    );

    expect(result.data.findingIds).toEqual([findingId]);
    expect(result.data.reviewableFindingIds).toEqual([]);
    expect(result.data.priority).toEqual({
      availability: "unavailable",
      value: null,
      limitation: "指向该 URL 的 Finding 已全部被忽略或解决，因此不再派生优先级。",
    });
  });

  it("keeps an accepted Finding ranking its URL until it is resolved", async () => {
    installUrlDetailFixtures({
      ruleId: "SEARCH-CTR-004",
      reviewState: "confirmed",
      withExecution: true,
      severity: "high",
      coverageCount: 1,
    });

    const result = await getProjectAuditUrl(
      scope,
      projectId,
      sitePageId,
      { diagnosticRunId: olderPublishedRunId },
      {} as never,
    );

    // A confirmed Finding no longer needs a review decision, so it leaves
    // reviewableFindingIds, but it is still an accepted open problem and the
    // Opportunity keyset still orders by it.
    expect(result.data.reviewableFindingIds).toEqual([]);
    expect(result.data.priority).toMatchObject({
      availability: "available",
      value: "high",
      basis: { findingIds: [findingId] },
    });
  });

  it("ranks a medium Finding by its cross-page blast radius, not by severity alone", async () => {
    installUrlDetailFixtures({
      ruleId: "TECH-LINKGRAPH-005",
      reviewState: "unreviewed",
      withExecution: false,
      severity: "medium",
      coverageCount: 354,
    });

    const result = await getProjectAuditUrl(
      scope,
      projectId,
      sitePageId,
      { diagnosticRunId: olderPublishedRunId },
      {} as never,
    );

    expect(result.data.priority).toMatchObject({
      availability: "available",
      value: "high",
      basis: {
        derivationVersion: "url_opportunity_rank.v1",
        sitePageId,
        findingIds: [findingId],
      },
    });
  });

  it("leaves a single-page medium Finding at the bottom of the same generation", async () => {
    installUrlDetailFixtures({
      ruleId: "SEARCH-CTR-004",
      reviewState: "unreviewed",
      withExecution: false,
      severity: "medium",
      coverageCount: 1,
    });

    const result = await getProjectAuditUrl(
      scope,
      projectId,
      sitePageId,
      { diagnosticRunId: olderPublishedRunId },
      {} as never,
    );

    expect(result.data.priority).toMatchObject({
      availability: "available",
      value: "low",
    });
  });

  it.each([
    {
      name: "a language-prefixed wiki page",
      url: "https://example.test/zh/wiki/aries-rising/",
      pageType: "documentation",
    },
    {
      name: "an unprefixed blog post",
      url: "https://example.test/blog/2026/mercury-retrograde/",
      pageType: "blog",
    },
    {
      name: "a locale home page",
      url: "https://example.test/en/",
      pageType: "home",
    },
    {
      name: "an unmatched path",
      url: "https://example.test/customer-onboarding/",
      pageType: null,
    },
  ])("classifies $name without touching template_key", async ({ url, pageType }) => {
    installUrlDetailFixtures({
      ruleId: "TECH-HTTP-001",
      reviewState: "unreviewed",
      withExecution: false,
      normalizedUrl: url,
    });

    const result = await getProjectAuditUrl(
      scope,
      projectId,
      sitePageId,
      { diagnosticRunId: olderPublishedRunId },
      {} as never,
    );

    expect(result.data.pageType).toBe(pageType);
    expect(result.data.templateKey).toBeNull();
  });

  it("surfaces the run's stored coverage limitations behind the generic partial sentence", async () => {
    const current = publishedGenerationFixture();
    const storedLimitation =
      "未提供关键词差距 CSV 或 DataForSEO 快照；内容差距规则已跳过。";
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
      id: projectId,
    } as never);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "findLatestReadableRun",
    ).mockResolvedValue({
      ...current.run,
      run_status: "partial",
      coverage: {
        overall: "partial",
        domains: { content_intent: "partial" },
        limitations: [storedLimitation, "   ", 42],
      },
    } as never);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      current.snapshot,
    ]);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listCurrentRunUrls",
    ).mockResolvedValue({ rows: [], nextCursor: null });
    installPortfolioSummary();
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listObservations",
    ).mockResolvedValue([]);
    vi.spyOn(
      GrowthMapReadRepository.prototype,
      "listResolvedTargets",
    ).mockResolvedValue([]);

    const result = await listProjectAuditUrls(
      scope,
      projectId,
      { limit: 50, cursor: null },
      {} as never,
    );

    expect(result.meta.coverage.availability).toBe("partial");
    expect(result.meta.coverage.limitations.slice(0, 2)).toEqual([
      "最新一次已完成的诊断仅覆盖了部分数据。",
      storedLimitation,
    ]);
  });

  it.each(["portfolio", "detail"] as const)(
    "fails closed when the exact-generation repository violates the requested pin for a %s response",
    async (kind) => {
      const mismatched = publishedGenerationFixture(latestRunId);
      vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
        id: projectId,
      } as never);
      vi.spyOn(
        GrowthMapReadRepository.prototype,
        "findReadableRunById",
      ).mockResolvedValue(mismatched.run);
      vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      ).mockResolvedValue([mismatched.snapshot]);
      const listUrls = vi.spyOn(
        GrowthMapReadRepository.prototype,
        "listCurrentRunUrls",
      );
      const findUrl = vi.spyOn(
        GrowthMapReadRepository.prototype,
        "findCurrentRunUrl",
      );

      await expect(
        readWithPin(kind, olderPublishedRunId, {}),
      ).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        status: 503,
      });
      expect(listUrls).not.toHaveBeenCalled();
      expect(findUrl).not.toHaveBeenCalled();
    },
  );

  it.each(
    (["portfolio", "detail"] as const).flatMap((kind) =>
      [
        { reason: "foreign", diagnosticRunId: foreignRunId },
        {
          reason: "unpublished",
          diagnosticRunId: unpublishedRunId,
        },
      ].map((scenario) => ({ kind, ...scenario })),
    ),
  )(
    "fails closed for a $reason pinned run in a $kind read without falling back to latest",
    async ({ kind, diagnosticRunId }) => {
      vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
        id: projectId,
      } as never);
      const latestRun = vi.spyOn(
        GrowthMapReadRepository.prototype,
        "findLatestReadableRun",
      );
      const exactRun = vi
        .spyOn(GrowthMapReadRepository.prototype, "findReadableRunById")
        .mockResolvedValue(null);
      const snapshots = vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      );

      await expect(
        readWithPin(kind, diagnosticRunId, {}),
      ).rejects.toMatchObject({
        code: "GROWTH_MAP_AUDIT_NOT_FOUND",
        status: 404,
      });
      expect(exactRun).toHaveBeenCalledWith(
        { workspaceId: scope.workspaceId, projectId },
        diagnosticRunId,
      );
      expect(exactRun).toHaveBeenCalledTimes(1);
      expect(latestRun).not.toHaveBeenCalled();
      expect(snapshots).not.toHaveBeenCalled();
    },
  );

  it.each(["portfolio", "detail"] as const)(
    "rejects a non-canonical diagnosticRunId before database access for a %s read",
    async (kind) => {
      const project = vi.spyOn(ProjectsRepository.prototype, "findById");
      const invalidRunId = olderPublishedRunId.toUpperCase();

      await expect(
        kind === "portfolio"
          ? listProjectAuditUrls(scope, projectId, {
              limit: 50,
              cursor: null,
              diagnosticRunId: invalidRunId,
            })
          : getProjectAuditUrl(scope, projectId, sitePageId, {
              diagnosticRunId: invalidRunId,
            }),
      ).rejects.toThrow("diagnosticRunId must be a canonical UUID");
      expect(project).not.toHaveBeenCalled();
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );

  it("distinguishes a missing project from a project with no completed Growth Map audit", async () => {
    const findProject = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: projectId } as never);
    const findRun = vi
      .spyOn(GrowthMapReadRepository.prototype, "findLatestReadableRun")
      .mockResolvedValue(null);

    await expect(
      listProjectAuditUrls(
        scope,
        projectId,
        { limit: 50, cursor: null },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(findRun).not.toHaveBeenCalled();

    await expect(
      listProjectAuditUrls(
        scope,
        projectId,
        { limit: 50, cursor: null },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: "GROWTH_MAP_AUDIT_NOT_FOUND",
      status: 404,
    });
    expect(findProject).toHaveBeenCalledTimes(2);
    expect(findRun).toHaveBeenCalledTimes(1);
  });

  it.each([
    "customer-private-malformed-keyset",
    "2026-02-31T00:00:00.000Z 00000000-0000-4000-8000-000000000003",
    "2026-07-19T00:00:00.000Z customer-private-invalid-uuid",
  ])(
    "rejects a semantically invalid timestamp/UUID cursor before database access: %j",
    async (privatePayload) => {
      const cursor = Buffer.from(privatePayload, "utf8").toString("base64url");

      let caught: unknown;
      try {
        await listProjectAuditUrls(scope, projectId, {
          limit: 50,
          cursor,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ProblemError);
      expect(caught).toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Query parameter failed validation.",
      });
      expect((caught as ProblemError).fieldErrors).toEqual([
        {
          pointer: "/cursor",
          code: "invalid_query_value",
          message: "Invalid query parameter.",
        },
      ]);
      expect(mocks.getDb).not.toHaveBeenCalled();
      expect((caught as ProblemError).message).not.toContain(privatePayload);
      expect((caught as ProblemError).message).not.toContain(cursor);
    },
  );

  it.each([
    {
      name: "portfolio",
      read: () =>
        listProjectAuditUrls(scope, projectId, { limit: 50, cursor: null }),
    },
    {
      name: "detail",
      read: () =>
        getProjectAuditUrl(
          scope,
          projectId,
          "00000000-0000-4000-8000-000000000003",
        ),
    },
  ])(
    "uses one repeatable-read, read-only transaction for a production $name read",
    async ({ read }) => {
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
      expect(mocks.getDb).toHaveBeenCalledTimes(1);
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );
});
