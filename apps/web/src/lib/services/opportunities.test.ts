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
} as const;

const CAPTURED_AT = "2026-07-21T08:00:00.000Z";
const CLUSTER = "customer-onboarding";
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

function frozenManifest() {
  return {
    projectId: ids.project,
    siteId: ids.site,
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
    governance: governance(),
  };
}

const INPUT_HASH = contentHash(
  frozenManifest() as unknown as CanonicalValue,
);

function readableRun() {
  return {
    id: ids.run,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    input_hash: INPUT_HASH,
    input_manifest: frozenManifest(),
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
  vi.spyOn(
    GrowthMapReadRepository.prototype,
    "listActiveActions",
  ).mockResolvedValue([]);

  return {
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
