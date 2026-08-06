import {
  ActionsRepository,
  contentHash,
  EvidenceRepository,
  FindingsRepository,
  FindingTargetsRepository,
  GrowthMapReadRepository,
  ObservationsRepository,
  ProjectsRepository,
  TopicClusterReadRepository,
  type CanonicalValue,
  type Executor,
} from "@sf/db";
import {
  buildContextProjectionV1,
  CONTEXTUAL_RULE_SET_VERSION,
  GOVERNED_LEGACY_RULE_SET_VERSION,
  LEGACY_RULE_SET_VERSION,
  LINKGRAPH_LEGACY_RULE_SET_VERSION,
  PROMPT_SET_VERSION,
} from "@sf/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProjectOpportunity,
  listProjectOpportunities,
} from "./opportunities";

const ids = {
  workspace: "40000000-0000-4000-8000-000000000001",
  project: "40000000-0000-4000-8000-000000000002",
  site: "40000000-0000-4000-8000-000000000003",
  run: "40000000-0000-4000-8000-000000000004",
  finding: "40000000-0000-4000-8000-000000000005",
  target: "40000000-0000-4000-8000-000000000006",
  snapshot: "40000000-0000-4000-8000-000000000007",
  collection: "40000000-0000-4000-8000-000000000008",
  observation: "40000000-0000-4000-8000-000000000009",
  keyword: "40000000-0000-4000-8000-000000000010",
  keywordOccurrence: "40000000-0000-4000-8000-000000000011",
  queryEvidence: "40000000-0000-4000-8000-000000000012",
  competitorEvidence: "40000000-0000-4000-8000-000000000013",
  competitor: "40000000-0000-4000-8000-000000000014",
  competitorOrigin: "40000000-0000-4000-8000-000000000015",
  competitorB: "40000000-0000-4000-8000-000000000016",
  competitorBOrigin: "40000000-0000-4000-8000-000000000017",
  foreignCompetitor: "40000000-0000-4000-8000-000000000018",
  nonOwnedEvidence: "40000000-0000-4000-8000-000000000019",
  icp: "40000000-0000-4000-8000-000000000020",
} as const;

const CAPTURED_AT = "2026-07-21T08:00:00.000Z";
const CLUSTER = "customer-onboarding";
const ICP_HASH = "a".repeat(64);
const exec = { kind: "repeatable-read-test" } as unknown as Executor;
const readScope = {
  workspaceId: ids.workspace,
  uiLocale: "en" as const,
};
const projectScope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};

function governance() {
  return {
    projectionVersion: "growth-governance.1.0.0",
    keywordClusters: [
      {
        clusterKey: CLUSTER,
        keywords: [
          {
            keywordEntityId: ids.keyword,
            displayKeyword: "Customer onboarding software",
            normalizedKeyword: "customer onboarding software",
            marketCode: "US",
            languageTag: "en-US",
            revision: 3,
            status: "approved",
            queryKind: "search_query",
            intent: "commercial",
            buyerStage: "consideration",
            clusterKey: CLUSTER,
            mappingDecision: "new_asset",
            mappedSitePageId: null,
            mappingReviewState: "confirmed",
            lastSeenAt: CAPTURED_AT,
            occurrenceRefs: [
              {
                occurrenceId: ids.keywordOccurrence,
                snapshotId: ids.snapshot,
                observationId: ids.observation,
              },
            ],
            metricRefs: [],
          },
        ],
      },
    ],
    competitors: [
      {
        competitorEntityId: ids.competitor,
        domain: "approved-competitor.example",
        reviewStatus: "approved",
        revision: 2,
        relationship: "direct",
        analysisScopes: ["keyword_gap"],
        originRefs: [
          {
            occurrenceId: ids.competitorOrigin,
            originKind: "manual",
            snapshotId: null,
            observationId: null,
          },
        ],
      },
      {
        competitorEntityId: ids.competitorB,
        domain: "also-approved-but-unbound.example",
        reviewStatus: "approved",
        revision: 7,
        relationship: "benchmark",
        analysisScopes: ["content", "serp_visibility"],
        originRefs: [
          {
            occurrenceId: ids.competitorBOrigin,
            originKind: "manual",
            snapshotId: null,
            observationId: null,
          },
        ],
      },
    ],
  };
}

const contextProjection = buildContextProjectionV1({
  profileContentHash: ICP_HASH,
  profile: {
    profileSchemaVersion: "product-profile.0.3.0",
    productName: "Acme",
    oneLiner: "Ship faster",
    productType: "saas",
    businessModels: ["subscription"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [],
  },
  siteLanguageCodes: ["en-US"],
});

function frozenManifest(
  ruleSetVersion: string = CONTEXTUAL_RULE_SET_VERSION,
) {
  return {
    projectId: ids.project,
    siteId: ids.site,
    icp: { id: ids.icp, version: 3, contentHash: ICP_HASH },
    snapshots: [
      {
        snapshotId: ids.snapshot,
        provider: "dataforseo",
        datasetKey: "dataforseo.ranked_keywords.v1",
        schemaVersion: "0.3.0",
        methodVersion: "dataforseo.ranked_keywords.v1",
        checksum: "b".repeat(64),
        capturedAt: CAPTURED_AT,
        sourceWindow: { start: null, end: null },
        availability: "available",
      },
    ],
    ruleSetVersion,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en-US",
    ...(ruleSetVersion === GOVERNED_LEGACY_RULE_SET_VERSION ||
    ruleSetVersion === LINKGRAPH_LEGACY_RULE_SET_VERSION ||
    ruleSetVersion === CONTEXTUAL_RULE_SET_VERSION
      ? { governance: governance() }
      : {}),
    ...(ruleSetVersion === CONTEXTUAL_RULE_SET_VERSION
      ? { contextProjection }
      : {}),
  };
}

function readableRun(
  ruleSetVersion: string = CONTEXTUAL_RULE_SET_VERSION,
  inputManifest: Record<string, unknown> = frozenManifest(ruleSetVersion),
) {
  return {
    id: ids.run,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    icp_profile_id: ids.icp,
    icp_profile_version: 3,
    rule_set_version: ruleSetVersion,
    prompt_set_version: PROMPT_SET_VERSION,
    output_locale: "en-US",
    input_hash: contentHash(inputManifest as unknown as CanonicalValue),
    input_manifest: inputManifest,
  };
}

function currentEvidenceRows(
  competitorSubjectRefs: readonly string[] = [
    `competitor:${ids.competitor}`,
  ],
) {
  return [
    {
      id: ids.queryEvidence,
      diagnostic_run_id: ids.run,
      source_provider: "dataforseo",
      origin: "vendor_observation",
      method: "observed",
      grade: "B",
      availability: "available",
      support: "supports",
      subject_refs: [`keyword_cluster:${CLUSTER}`],
      claim: "The frozen provider rows support this cluster.",
      observed_at: CAPTURED_AT,
      limitation: "The provider snapshot is a bounded ranked-keyword sample.",
      snapshot_id: ids.snapshot,
      collection_run_id: ids.collection,
      analysis_invocation_id: null,
    },
    {
      id: ids.competitorEvidence,
      diagnostic_run_id: ids.run,
      source_provider: "system",
      origin: "derived",
      method: "computed",
      grade: "B",
      availability: "available",
      support: "context",
      subject_refs: [
        `keyword_cluster:${CLUSTER}`,
        ...competitorSubjectRefs,
      ],
      claim: "Approved competitor governance supports comparison context.",
      observed_at: CAPTURED_AT,
      limitation: "Competitor context does not establish keyword demand.",
      snapshot_id: null,
      collection_run_id: null,
      analysis_invocation_id: null,
    },
  ];
}

function normalizedObservation() {
  return {
    id: ids.observation,
    workspace_id: ids.workspace,
    project_id: ids.project,
    snapshot_id: ids.snapshot,
    site_page_id: null,
    provider: "dataforseo",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    subject_ref: CLUSTER,
    observed_at: CAPTURED_AT,
    availability: "available",
    value_numeric: null,
    value_text: null,
    value_json: {
      keyword: "Customer onboarding software",
      clusterKey: CLUSTER,
      searchVolume: 900,
      keywordDifficulty: 42,
      currentRank: 6,
      currentUrl: null,
      competitorDomain: null,
      competitorRank: null,
      marketCode: "US",
      languageCode: "en-US",
    },
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "context",
    limitation: "The provider snapshot is a bounded ranked-keyword sample.",
  };
}

function installRepositoryFixtures() {
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: ids.project,
    default_delivery_locale: "zh-CN",
  } as never);
  const runRead = vi.spyOn(
    GrowthMapReadRepository.prototype,
    "findLatestReadableRun",
  ).mockResolvedValue(readableRun() as never);

  const finding = {
    id: ids.finding,
    workspace_id: ids.workspace,
    project_id: ids.project,
    finding_key: "topic:customer-onboarding:CONTENT-GAP-011",
    rule_id: "CONTENT-GAP-011",
    rule_version: 2,
    rule_family: "content-gap",
    intent: "create",
    domain: "content_intent",
    title_key: "finding.content_gap",
    title_args: {},
    summary: "Create a customer-onboarding resource.",
    summary_locale: "en",
    summary_invocation_id: null,
    subject_refs: [`keyword_cluster:${CLUSTER}`],
    severity: "high",
    confidence: "high",
    review_state: "unreviewed",
    review_revision: 0,
    review_reason: null,
    review_note: null,
    active: true,
    regressed: false,
    first_seen_run_id: ids.run,
    last_seen_run_id: ids.run,
    first_seen_at: CAPTURED_AT,
    last_seen_at: CAPTURED_AT,
    resolved_at: null,
    created_at: CAPTURED_AT,
    updated_at: CAPTURED_AT,
  } as never;
  vi.spyOn(FindingsRepository.prototype, "findById").mockResolvedValue(finding);
  const findingList = vi
    .spyOn(FindingsRepository.prototype, "list")
    .mockResolvedValue({
    rows: [finding],
    nextCursor: null,
  });

  const target = {
    id: ids.target,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    finding_id: ids.finding,
    diagnostic_run_id: ids.run,
    relation: "affected_by_keyword_cluster",
    target_kind: "keyword_cluster",
    target_ref: CLUSTER,
    resolution_state: "definition_only",
    basis_kind: "target_definition",
    site_page_id: null,
    page_snapshot_id: null,
    source_observation_id: null,
    member_ref: null,
    limitation: null,
    relation_key: "cluster-target",
    created_at: CAPTURED_AT,
  } as never;
  vi.spyOn(
    FindingTargetsRepository.prototype,
    "listForFindings",
  ).mockResolvedValue([target]);

  const evidenceLinks = vi
    .spyOn(EvidenceRepository.prototype, "listForFindings")
    .mockResolvedValue([
      {
        finding_id: ids.finding,
        evidence_id: ids.queryEvidence,
        role: "primary",
      },
      {
        finding_id: ids.finding,
        evidence_id: ids.competitorEvidence,
        role: "context",
      },
    ]);
  const evidenceRead = vi
    .spyOn(EvidenceRepository.prototype, "findByIds")
    .mockResolvedValue(currentEvidenceRows());

  const observationRead = vi
    .spyOn(ObservationsRepository.prototype, "listBySnapshotIds")
    .mockResolvedValue([normalizedObservation()]);

  vi.spyOn(
    TopicClusterReadRepository.prototype,
    "listSupportingFindings",
  ).mockResolvedValue([]);
  vi.spyOn(ActionsRepository.prototype, "findActiveByFinding").mockResolvedValue(
    null,
  );
  const actionInsert = vi.spyOn(ActionsRepository.prototype, "insert");
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "listActiveActions",
  ).mockResolvedValue([]);

  return {
    actionInsert,
    evidenceLinks,
    evidenceRead,
    finding,
    findingList,
    observationRead,
    runRead,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Opportunity governed relation read wiring", () => {
  it.each([
    {
      name: "detail",
      read: async () =>
        (
          await getProjectOpportunity(
            readScope,
            ids.project,
            ids.finding,
            exec,
          )
        ).data,
    },
    {
      name: "list",
      read: async () =>
        (
          await listProjectOpportunities(
            readScope,
            ids.project,
            { limit: 50, cursor: null, now: new Date(CAPTURED_AT) },
            exec,
          )
        ).data[0]!,
    },
  ])(
    "projects the $name execution preview from the Project delivery locale without creating an Action",
    async ({ read }) => {
      const { actionInsert } = installRepositoryFixtures();

      const opportunity = await read();

      expect(opportunity).toMatchObject({
        readiness: "reviewable",
        primaryFindingId: ids.finding,
        executionPreview: {
          templateId: "create_gap_content.v1",
          templateVersion: 1,
          artifactType: "content_brief",
          effort: "large",
          risk: "low",
          contentLocale: "zh-CN",
          title: "为未覆盖的关键词簇创建内容",
          description: "为无匹配可收录页面的高需求关键词簇创建决策阶段内容。",
          expectedOutcome: "该关键词簇获得针对性页面以承接既有需求。",
        },
      });
      expect("actionId" in opportunity).toBe(false);
      expect("action" in opportunity).toBe(false);
      expect(actionInsert).not.toHaveBeenCalled();
    },
  );

  it("asks the repository for a run-and-rule filtered page before cursoring", async () => {
    const { finding, findingList } = installRepositoryFixtures();
    findingList.mockImplementationOnce(async (_scope, options) => {
      const query = options as unknown as Record<string, unknown>;
      const ruleIds = query["ruleIds"];
      const isGovernedOpportunityQuery =
        query["lastSeenRunId"] === ids.run &&
        Array.isArray(ruleIds) &&
        ruleIds.includes("CONTENT-GAP-011");
      return isGovernedOpportunityQuery
        ? { rows: [finding], nextCursor: null }
        : { rows: [], nextCursor: "cursor-consumed-by-unrelated-findings" };
    });

    const page = await listProjectOpportunities(
      readScope,
      ids.project,
      { limit: 1, cursor: null, now: new Date(CAPTURED_AT) },
      exec,
    );

    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.primaryFindingId).toBe(ids.finding);
    expect(page.meta).toEqual({
      limit: 1,
      nextCursor: null,
      hasNext: false,
    });
    expect(findingList).toHaveBeenCalledWith(
      projectScope,
      expect.objectContaining({
        limit: 1,
        cursor: null,
        activeOnly: true,
        lastSeenRunId: ids.run,
        ruleIds: expect.arrayContaining([
          "TECH-HTTP-001",
          "CONTENT-GAP-011",
          "GEO-ENTITY-001",
        ]),
      }),
    );
  });

  it.each([
    {
      name: "detail",
      read: async () =>
        (
          await getProjectOpportunity(
            readScope,
            ids.project,
            ids.finding,
            exec,
          )
        ).data,
    },
    {
      name: "list",
      read: async () =>
        (
          await listProjectOpportunities(
            readScope,
            ids.project,
            { limit: 50, cursor: null, now: new Date(CAPTURED_AT) },
            exec,
          )
        ).data[0]!,
    },
  ])(
    "assembles $name relations only from the current run envelope, observations, and explicitly bound evidence",
    async ({ read }) => {
      const { evidenceLinks, observationRead } = installRepositoryFixtures();

      await expect(read()).resolves.toMatchObject({
        searchQueries: [
          {
            queryKind: "search",
            query: "Customer onboarding software",
            observationId: ids.observation,
            snapshotId: ids.snapshot,
            sourceProvider: "dataforseo",
            metrics: {
              monthlyVolume: 900,
              keywordDifficulty: 42,
              organicRank: 6,
              impressions: null,
              clicks: null,
            },
          },
        ],
        generativeQueries: [],
        competitorRefs: [ids.competitor],
      });
      expect(evidenceLinks).toHaveBeenCalledWith(
        projectScope,
        [ids.finding],
        { diagnosticRunId: ids.run },
      );
      expect(observationRead).toHaveBeenCalledWith(projectScope, [
        ids.snapshot,
      ]);
    },
  );

  it.each([
    ["governed 0.2.2", GOVERNED_LEGACY_RULE_SET_VERSION],
    ["linkgraph 0.2.3", LINKGRAPH_LEGACY_RULE_SET_VERSION],
  ])(
    "admits relations from an exact historical %s envelope without synthesizing context",
    async (_label, ruleSetVersion) => {
      const { observationRead, runRead } = installRepositoryFixtures();
      runRead.mockResolvedValueOnce(readableRun(ruleSetVersion) as never);

      const detail = await getProjectOpportunity(
        readScope,
        ids.project,
        ids.finding,
        exec,
      );

      expect(detail.data.searchQueries).toHaveLength(1);
      expect(detail.data.competitorRefs).toEqual([ids.competitor]);
      expect(observationRead).toHaveBeenCalledOnce();
      expect(
        Object.hasOwn(
          readableRun(ruleSetVersion).input_manifest,
          "contextProjection",
        ),
      ).toBe(false);
    },
  );

  it("keeps an exact pre-governance 0.2.1 envelope readable without inventing relation authority", async () => {
    const { observationRead, runRead } = installRepositoryFixtures();
    runRead.mockResolvedValueOnce(
      readableRun(LEGACY_RULE_SET_VERSION) as never,
    );

    const detail = await getProjectOpportunity(
      readScope,
      ids.project,
      ids.finding,
      exec,
    );

    expect(detail.data).toMatchObject({
      searchQueries: [],
      generativeQueries: [],
      competitorRefs: [],
    });
    expect(observationRead).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a current envelope missing context",
      ruleSetVersion: CONTEXTUAL_RULE_SET_VERSION,
      manifest: () => {
        const { contextProjection: _context, ...manifest } = frozenManifest();
        return manifest;
      },
    },
    {
      name: "a current envelope with context schema drift",
      ruleSetVersion: CONTEXTUAL_RULE_SET_VERSION,
      manifest: () => ({
        ...frozenManifest(),
        contextProjection: {
          ...contextProjection,
          schemaVersion: "context-projection.v999",
        },
      }),
    },
    {
      name: "a current envelope with context compiler drift",
      ruleSetVersion: CONTEXTUAL_RULE_SET_VERSION,
      manifest: () => ({
        ...frozenManifest(),
        contextProjection: {
          ...contextProjection,
          compilerVersion: "context-projection.compiler.999.0.0",
        },
      }),
    },
    {
      name: "a current envelope with an extra context key",
      ruleSetVersion: CONTEXTUAL_RULE_SET_VERSION,
      manifest: () => ({
        ...frozenManifest(),
        contextProjection: {
          ...contextProjection,
          surprise: true,
        },
      }),
    },
    {
      name: "a current envelope with an extra preview authority",
      ruleSetVersion: CONTEXTUAL_RULE_SET_VERSION,
      manifest: () => ({
        ...frozenManifest(),
        executionPreview: { title: "must remain current-view only" },
      }),
    },
    {
      name: "a 0.2.3 envelope carrying current context",
      ruleSetVersion: LINKGRAPH_LEGACY_RULE_SET_VERSION,
      manifest: () => ({
        ...frozenManifest(LINKGRAPH_LEGACY_RULE_SET_VERSION),
        contextProjection,
      }),
    },
    {
      name: "a 0.2.1 envelope carrying governance",
      ruleSetVersion: LEGACY_RULE_SET_VERSION,
      manifest: () => ({
        ...frozenManifest(LEGACY_RULE_SET_VERSION),
        governance: governance(),
      }),
    },
    {
      name: "a manifest rule generation that disagrees with its run",
      ruleSetVersion: GOVERNED_LEGACY_RULE_SET_VERSION,
      manifest: () => frozenManifest(LINKGRAPH_LEGACY_RULE_SET_VERSION),
    },
  ])("fails relation authority closed for $name", async (fixture) => {
    const { observationRead, runRead } = installRepositoryFixtures();
    const manifest = fixture.manifest();
    runRead.mockResolvedValueOnce(
      readableRun(fixture.ruleSetVersion, manifest) as never,
    );

    const detail = await getProjectOpportunity(
      readScope,
      ids.project,
      ids.finding,
      exec,
    );

    expect(detail.data).toMatchObject({
      searchQueries: [],
      generativeQueries: [],
      competitorRefs: [],
    });
    expect(observationRead).not.toHaveBeenCalled();
  });

  it("does not fan one explicitly bound competitor out to every approved competitor", async () => {
    installRepositoryFixtures();

    const detail = await getProjectOpportunity(
      readScope,
      ids.project,
      ids.finding,
      exec,
    );

    expect(governance().competitors.map((item) => item.reviewStatus)).toEqual([
      "approved",
      "approved",
    ]);
    expect(detail.data.competitorRefs).toEqual([ids.competitor]);
    expect(detail.data.competitorRefs).not.toContain(ids.competitorB);
  });

  it.each([
    {
      name: "an invalid competitor subject",
      rows: () => currentEvidenceRows(["competitor:not-a-uuid"]),
    },
    {
      name: "a foreign competitor identity",
      rows: () =>
        currentEvidenceRows([`competitor:${ids.foreignCompetitor}`]),
    },
    {
      name: "a valid identity present only on non-owned Evidence",
      rows: () => [
        ...currentEvidenceRows([]),
        {
          ...currentEvidenceRows([`competitor:${ids.competitor}`])[1]!,
          id: ids.nonOwnedEvidence,
        },
      ],
    },
  ])("drops $name instead of widening competitor relations", async ({ rows }) => {
    const { evidenceRead } = installRepositoryFixtures();
    evidenceRead.mockResolvedValueOnce(rows());

    const detail = await getProjectOpportunity(
      readScope,
      ids.project,
      ids.finding,
      exec,
    );

    expect(detail.data.competitorRefs).toEqual([]);
  });

  it("fails relation authority closed when governance bytes do not match the run input hash", async () => {
    const { observationRead, runRead } = installRepositoryFixtures();
    runRead.mockResolvedValueOnce({
      ...readableRun(),
      input_manifest: {
        ...frozenManifest(),
        governance: {
          ...governance(),
          competitors: [],
        },
      },
    } as never);

    const detail = await getProjectOpportunity(
      readScope,
      ids.project,
      ids.finding,
      exec,
    );

    expect(detail.data).toMatchObject({
      searchQueries: [],
      generativeQueries: [],
      competitorRefs: [],
    });
    expect(observationRead).not.toHaveBeenCalled();
  });

  it("drops a malformed source metric instead of coercing it into query evidence", async () => {
    const { observationRead } = installRepositoryFixtures();
    observationRead.mockResolvedValueOnce([
      {
        ...normalizedObservation(),
        value_json: {
          ...normalizedObservation().value_json,
          currentRank: 0,
        },
      },
    ]);

    const detail = await getProjectOpportunity(
      readScope,
      ids.project,
      ids.finding,
      exec,
    );

    expect(detail.data.searchQueries).toEqual([]);
    expect(detail.data.competitorRefs).toEqual([ids.competitor]);
  });

  it("does not surface historical Evidence even when a repository result is corrupt", async () => {
    const { evidenceRead, observationRead } = installRepositoryFixtures();
    evidenceRead.mockResolvedValueOnce(
      currentEvidenceRows().map((row) => ({
        ...row,
        diagnostic_run_id: "40000000-0000-4000-8000-000000000099",
      })),
    );

    await expect(
      getProjectOpportunity(
        readScope,
        ids.project,
        ids.finding,
        exec,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "This finding is not an actionable opportunity.",
    });
    expect(observationRead).not.toHaveBeenCalled();
  });
});
