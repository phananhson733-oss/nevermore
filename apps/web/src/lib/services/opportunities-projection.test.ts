import { describe, expect, it } from "vitest";
import { GrowthOpportunity } from "@sf/contracts";
import {
  GOVERNANCE_PROJECTION_VERSION,
  parseGovernanceProjectionV1,
} from "@sf/engine";
import type { EvidenceDto } from "./diagnostic-mappers";
import {
  buildActionSummary,
  buildEvidenceSummary,
  buildOpportunity,
  deriveOpportunityKey,
  primaryTopicClusterKey,
  resolvePrimaryTarget,
  resolveReadiness,
  type OpportunityFindingInput,
  type OpportunityGrowthRelationEvidenceInput,
  type OpportunityTargetInput,
} from "./opportunities-projection";
import {
  groupTopicClusterSupportRows,
  type TopicClusterSupportRow,
} from "./topic-cluster-projection";

const ids = {
  finding: "30000000-0000-4000-8000-000000000001",
  action: "30000000-0000-4000-8000-000000000003",
  evidence: "30000000-0000-4000-8000-000000000011",
  run: "30000000-0000-4000-8000-000000000012",
  snapshot: "30000000-0000-4000-8000-000000000013",
  sitePage: "30000000-0000-4000-8000-000000000014",
  collection: "30000000-0000-4000-8000-000000000015",
  project: "30000000-0000-4000-8000-000000000032",
  site: "30000000-0000-4000-8000-000000000033",
  keywordEvidence: "30000000-0000-4000-8000-000000000034",
  competitorEvidence: "30000000-0000-4000-8000-000000000035",
  searchKeyword: "30000000-0000-4000-8000-000000000041",
  generativeKeyword: "30000000-0000-4000-8000-000000000042",
  searchOccurrence: "30000000-0000-4000-8000-000000000043",
  generativeOccurrence: "30000000-0000-4000-8000-000000000044",
  searchObservation: "30000000-0000-4000-8000-000000000045",
  generativeObservation: "30000000-0000-4000-8000-000000000046",
  searchSnapshot: "30000000-0000-4000-8000-000000000047",
  generativeSnapshot: "30000000-0000-4000-8000-000000000048",
  competitor: "30000000-0000-4000-8000-000000000051",
  competitorOrigin: "30000000-0000-4000-8000-000000000052",
  secondSearchKeyword: "30000000-0000-4000-8000-000000000053",
  secondSearchOccurrence: "30000000-0000-4000-8000-000000000054",
} as const;

const NOW = Date.parse("2026-07-21T09:00:00.000Z");
const DIAGNOSTIC_INPUT_HASH = "a".repeat(64);

function crawlEvidence(overrides: Partial<EvidenceDto> = {}): EvidenceDto {
  return {
    id: ids.evidence,
    sourceProvider: "crawl",
    origin: "first_party",
    method: "crawl.page.v1",
    grade: "A",
    availability: "available",
    support: "supports",
    claim: "The owned page lacks a concise answer block.",
    subjectRefs: [],
    observedAt: "2026-07-21T08:00:00.000Z",
    limitation: "Single immutable crawl snapshot.",
    snapshotId: ids.snapshot,
    collectionRunId: ids.collection,
    analysisInvocationId: null,
    ...overrides,
  };
}

function ownedUrlTarget(
  overrides: Partial<OpportunityTargetInput> = {},
): OpportunityTargetInput {
  return {
    relation: "direct_url",
    targetKind: "url",
    targetRef: "https://example.com/customer-onboarding/",
    resolutionState: "resolved",
    sitePageId: ids.sitePage,
    pageSnapshotId: "30000000-0000-4000-8000-000000000016",
    ...overrides,
  };
}

function systemEvidence(
  id: string,
  claim: string,
  overrides: Partial<EvidenceDto> = {},
): EvidenceDto {
  return {
    id,
    sourceProvider: "system",
    origin: "derived",
    method: "computed",
    grade: "B",
    availability: "available",
    support: "context",
    claim,
    subjectRefs: [
      { type: "keyword_cluster", value: "customer onboarding" },
    ],
    observedAt: "2026-07-21T08:00:00.000Z",
    limitation: "Frozen governance context for this diagnostic run.",
    snapshotId: null,
    collectionRunId: null,
    analysisInvocationId: null,
    ...overrides,
  };
}

const reviewableFinding: OpportunityFindingInput = {
  id: ids.finding,
  ruleId: "CONTENT-COVERAGE-001",
  reviewState: "unreviewed",
  active: true,
  title: "Make the onboarding page a citation-ready answer asset",
};

describe("deriveOpportunityKey", () => {
  it("keys URL targets by path so absolute forms collapse", () => {
    expect(
      deriveOpportunityKey({
        primaryTarget: "url",
        targetRef: "https://example.com/customer-onboarding/",
        ruleId: "CONTENT-COVERAGE-001",
      }),
    ).toBe("url:/customer-onboarding/:CONTENT-COVERAGE-001");
  });

  it("keys non-URL targets by their literal ref", () => {
    expect(
      deriveOpportunityKey({
        primaryTarget: "topic",
        targetRef: "customer onboarding",
        ruleId: "CONTENT-GAP-011",
      }),
    ).toBe("topic:customer onboarding:CONTENT-GAP-011");
  });
});

describe("resolvePrimaryTarget", () => {
  it("resolves a suitable owned asset from a resolved crawl URL", () => {
    const primary = resolvePrimaryTarget([ownedUrlTarget()]);
    expect(primary?.primaryTarget).toBe("url");
    expect(primary?.hasSuitableOwnedAsset).toBe(true);
    expect(primary?.ownedAsset).toMatchObject({
      sitePageId: ids.sitePage,
      suitableForIntent: true,
    });
  });

  it("has no owned asset for a topic target", () => {
    const primary = resolvePrimaryTarget([
      {
        relation: "affected_by_keyword_cluster",
        targetKind: "keyword_cluster",
        targetRef: "customer onboarding",
        resolutionState: "resolved",
        sitePageId: null,
        pageSnapshotId: null,
      },
    ]);
    expect(primary?.primaryTarget).toBe("topic");
    expect(primary?.hasSuitableOwnedAsset).toBe(false);
    expect(primary?.ownedAsset).toBeNull();
  });
});

describe("buildEvidenceSummary", () => {
  it("maps crawl lineage and derives freshness", () => {
    const traces = buildEvidenceSummary([crawlEvidence()], {
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      traceKind: "evidence",
      snapshotId: ids.snapshot,
      collectionRunId: ids.collection,
      analysisInvocationId: null,
      freshness: "current",
      support: "supports",
    });
  });

  it("drops unavailable evidence the contract cannot trace", () => {
    const traces = buildEvidenceSummary(
      [crawlEvidence({ availability: "unavailable" })],
      { diagnosticRunId: ids.run, now: NOW },
    );
    expect(traces).toHaveLength(0);
  });
});

describe("resolveReadiness", () => {
  it("treats reviewable states as reviewable and ignored as skip", () => {
    expect(
      resolveReadiness({
        finding: { reviewState: "unreviewed", active: true },
        action: null,
      }),
    ).toBe("reviewable");
    expect(
      resolveReadiness({
        finding: { reviewState: "ignored", active: true },
        action: null,
      }),
    ).toBe("skip");
  });

  it("is confirmed only with an active Action", () => {
    expect(
      resolveReadiness({
        finding: { reviewState: "confirmed", active: true },
        action: { id: ids.action, sourceFindingId: ids.finding, status: "planned" },
      }),
    ).toBe("confirmed");
    expect(
      resolveReadiness({
        finding: { reviewState: "confirmed", active: true },
        action: null,
      }),
    ).toBe("skip");
  });
});

describe("buildActionSummary", () => {
  it("fixes the Artifact type from the frozen rule projection", () => {
    expect(
      buildActionSummary(
        { id: ids.action, sourceFindingId: ids.finding, status: "planned" },
        "CONTENT-COVERAGE-001",
      ),
    ).toEqual({
      actionId: ids.action,
      findingId: ids.finding,
      status: "planned",
      artifactType: "content_brief",
    });
  });
});

describe("buildOpportunity", () => {
  it("builds an improve reviewable Opportunity for a suitable owned page", () => {
    const opportunity = buildOpportunity({
      finding: reviewableFinding,
      targets: [ownedUrlTarget()],
      evidence: [crawlEvidence()],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(opportunity).not.toBeNull();
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
    expect(opportunity).toMatchObject({
      readiness: "reviewable",
      workShape: "improve",
      primaryFindingId: ids.finding,
      lenses: ["demand_competition"],
    });
  });

  it("builds a create Opportunity when there is no suitable owned asset", () => {
    const opportunity = buildOpportunity({
      finding: reviewableFinding,
      targets: [
        {
          relation: "affected_by_keyword_cluster",
          targetKind: "keyword_cluster",
          targetRef: "customer onboarding",
          resolutionState: "resolved",
          sitePageId: null,
          pageSnapshotId: null,
        },
      ],
      evidence: [
        crawlEvidence({ sourceProvider: "dataforseo" }),
      ].map((dto) => ({ ...dto })),
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(opportunity).toMatchObject({
      readiness: "reviewable",
      workShape: "create",
      primaryTarget: "topic",
      currentOwnedAsset: null,
    });
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
  });

  it("projects a confirmed Opportunity over the Finding-owned Action", () => {
    const opportunity = buildOpportunity({
      finding: { ...reviewableFinding, reviewState: "confirmed" },
      targets: [ownedUrlTarget()],
      evidence: [crawlEvidence()],
      action: { id: ids.action, sourceFindingId: ids.finding, status: "planned" },
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(opportunity).toMatchObject({
      readiness: "confirmed",
      actionId: ids.action,
      action: { artifactType: "content_brief", findingId: ids.finding },
    });
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
  });

  it("omits ignored findings and findings without supporting provenance", () => {
    expect(
      buildOpportunity({
        finding: { ...reviewableFinding, reviewState: "ignored" },
        targets: [ownedUrlTarget()],
        evidence: [crawlEvidence()],
        action: null,
        diagnosticRunId: ids.run,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      buildOpportunity({
        finding: reviewableFinding,
        targets: [ownedUrlTarget()],
        evidence: [crawlEvidence({ support: "context" })],
        action: null,
        diagnosticRunId: ids.run,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("pins exact-variant technical rules to rule version 2", () => {
    const opportunity = buildOpportunity({
      finding: {
        id: ids.finding,
        ruleId: "TECH-HTTP-001",
        reviewState: "unreviewed",
        active: true,
        title: "Return a 200 for the canonical URL",
      },
      targets: [
        ownedUrlTarget({
          relation: "affected_by_http_status",
          targetKind: "http_status",
          targetRef: "404",
          sitePageId: null,
          pageSnapshotId: null,
        }),
      ],
      evidence: [crawlEvidence()],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
    });
    expect(opportunity).toMatchObject({
      workShape: "fix",
      primaryRule: { ruleId: "TECH-HTTP-001", ruleVersion: 2 },
      lenses: ["site_health"],
    });
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
  });
});

describe("governed keyword and competitor relations", () => {
  const clusterKey = "customer onboarding";

  function clusterTarget(
    targetRef = clusterKey,
  ): OpportunityTargetInput {
    return {
      relation: "affected_by_keyword_cluster",
      targetKind: "keyword_cluster",
      targetRef,
      resolutionState: "definition_only",
      sitePageId: null,
      pageSnapshotId: null,
    };
  }

  function frozenGovernance() {
    return parseGovernanceProjectionV1({
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [
        {
          clusterKey,
          keywords: [
            {
              keywordEntityId: ids.searchKeyword,
              displayKeyword: "Customer onboarding software",
              normalizedKeyword: "customer onboarding software",
              marketCode: "US",
              languageTag: "en-US",
              revision: 3,
              status: "approved",
              queryKind: "search_query",
              intent: "commercial",
              buyerStage: "consideration",
              clusterKey,
              mappingDecision: "new_asset",
              mappedSitePageId: null,
              mappingReviewState: "confirmed",
              lastSeenAt: "2026-07-21T08:00:00.000Z",
              occurrenceRefs: [
                {
                  occurrenceId: ids.searchOccurrence,
                  snapshotId: ids.searchSnapshot,
                  observationId: ids.searchObservation,
                },
              ],
              metricRefs: [
                {
                  snapshotId: ids.searchSnapshot,
                  observationId: ids.searchObservation,
                  valuePointer: "/valueJson/monthlyVolume",
                },
              ],
            },
            {
              keywordEntityId: ids.generativeKeyword,
              displayKeyword: "How do I automate customer onboarding?",
              normalizedKeyword: "how do i automate customer onboarding?",
              marketCode: "US",
              languageTag: "en-US",
              revision: 2,
              status: "approved",
              queryKind: "generative_query",
              intent: "informational",
              buyerStage: "awareness",
              clusterKey,
              mappingDecision: "new_asset",
              mappedSitePageId: null,
              mappingReviewState: "confirmed",
              lastSeenAt: "2026-07-21T08:00:00.000Z",
              occurrenceRefs: [
                {
                  occurrenceId: ids.generativeOccurrence,
                  snapshotId: ids.generativeSnapshot,
                  observationId: ids.generativeObservation,
                },
              ],
              metricRefs: [],
            },
            {
              keywordEntityId: ids.secondSearchKeyword,
              displayKeyword: "Onboarding automation platform",
              normalizedKeyword: "onboarding automation platform",
              marketCode: "US",
              languageTag: "en-US",
              revision: 1,
              status: "approved",
              queryKind: "search_query",
              intent: "commercial",
              buyerStage: "consideration",
              clusterKey,
              mappingDecision: "new_asset",
              mappedSitePageId: null,
              mappingReviewState: "confirmed",
              lastSeenAt: "2026-07-21T08:00:00.000Z",
              occurrenceRefs: [
                {
                  occurrenceId: ids.secondSearchOccurrence,
                  // One aggregate provider observation may authoritatively
                  // contain more than one query at distinct source pointers.
                  snapshotId: ids.searchSnapshot,
                  observationId: ids.searchObservation,
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
          revision: 4,
          relationship: "direct",
          analysisScopes: ["content", "keyword_gap"],
          originRefs: [
            {
              occurrenceId: ids.competitorOrigin,
              originKind: "manual",
              snapshotId: null,
              observationId: null,
            },
          ],
        },
      ],
    });
  }

  function searchQueryEvidence() {
    return {
      queryKind: "search" as const,
      observationId: ids.searchObservation,
      snapshotId: ids.searchSnapshot,
      query: "Customer onboarding software",
      marketCode: "US",
      languageCode: "en-US",
      sourceProvider: "dataforseo",
      observedAt: "2026-07-21T08:00:00.000Z",
      freshness: "current" as const,
      limitation: "One immutable provider observation.",
      metrics: {
        monthlyVolume: 900,
        keywordDifficulty: 42,
        organicRank: null,
        impressions: null,
        clicks: null,
      },
    };
  }

  function generativeQueryEvidence() {
    return {
      queryKind: "generative" as const,
      observationId: ids.generativeObservation,
      snapshotId: ids.generativeSnapshot,
      query: "How do I automate customer onboarding?",
      marketCode: "US",
      languageCode: "en-US",
      sourceProvider: "answer-sample",
      observedAt: "2026-07-21T08:00:00.000Z",
      freshness: "current" as const,
      limitation: "Three immutable answer samples.",
      metrics: {
        sampleSize: 3,
        brandMentionCount: 1,
        brandCitationCount: 1,
        citedCompetitorCount: 2,
      },
    };
  }

  function secondSearchQueryEvidence() {
    return {
      ...searchQueryEvidence(),
      query: "Onboarding automation platform",
      metrics: {
        monthlyVolume: 500,
        keywordDifficulty: 35,
        organicRank: null,
        impressions: null,
        clicks: null,
      },
    };
  }

  function relationEvidence(): OpportunityGrowthRelationEvidenceInput {
    const scope = {
      projectId: ids.project,
      siteId: ids.site,
      diagnosticRunId: ids.run,
      diagnosticInputHash: DIAGNOSTIC_INPUT_HASH,
    };
    return {
      scope,
      governance: frozenGovernance(),
      queryRelations: [
        {
          ...scope,
          findingId: ids.finding,
          evidenceId: ids.keywordEvidence,
          keywordEntityId: ids.generativeKeyword,
          keywordRevision: 2,
          queryEvidence: generativeQueryEvidence(),
        },
        {
          ...scope,
          findingId: ids.finding,
          evidenceId: ids.keywordEvidence,
          keywordEntityId: ids.searchKeyword,
          keywordRevision: 3,
          queryEvidence: searchQueryEvidence(),
        },
        {
          ...scope,
          findingId: ids.finding,
          evidenceId: ids.keywordEvidence,
          keywordEntityId: ids.secondSearchKeyword,
          keywordRevision: 1,
          queryEvidence: secondSearchQueryEvidence(),
        },
        // Exact duplicates can arise when more than one Evidence link points at
        // the same immutable observation; the relation stays one canonical row.
        {
          ...scope,
          findingId: ids.finding,
          evidenceId: ids.keywordEvidence,
          keywordEntityId: ids.searchKeyword,
          keywordRevision: 3,
          queryEvidence: searchQueryEvidence(),
        },
      ],
      competitorRelations: [
        {
          ...scope,
          findingId: ids.finding,
          evidenceId: ids.competitorEvidence,
          competitorEntityId: ids.competitor,
          competitorRevision: 4,
          originOccurrenceId: ids.competitorOrigin,
        },
      ],
    };
  }

  function governedOpportunity(
    growthRelationEvidence: ReturnType<typeof relationEvidence> | null =
      relationEvidence(),
    target: OpportunityTargetInput = clusterTarget(),
  ) {
    return buildOpportunity({
      finding: { ...reviewableFinding, ruleId: "CONTENT-GAP-011" },
      targets: [target],
      evidence: [
        crawlEvidence({ sourceProvider: "dataforseo" }),
        systemEvidence(
          ids.keywordEvidence,
          "The frozen Keyword Library supports this cluster.",
          { support: "supports" },
        ),
        systemEvidence(
          ids.competitorEvidence,
          "Approved competitors are context for this gap.",
        ),
      ],
      action: null,
      projectId: ids.project,
      siteId: ids.site,
      diagnosticRunId: ids.run,
      diagnosticInputHash: DIAGNOSTIC_INPUT_HASH,
      now: NOW,
      ...(growthRelationEvidence === null ? {} : { growthRelationEvidence }),
    });
  }

  it("projects reviewed frozen query observations separately and stable competitor identities", () => {
    const opportunity = governedOpportunity();

    expect(opportunity?.searchQueries).toEqual([
      searchQueryEvidence(),
      secondSearchQueryEvidence(),
    ]);
    expect(opportunity?.generativeQueries).toEqual([
      generativeQueryEvidence(),
    ]);
    expect(opportunity?.competitorRefs).toEqual([ids.competitor]);
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
  });

  it("fails closed for cross-scope, cross-Finding, and non-snapshot relations", () => {
    const relations = relationEvidence();
    const opportunity = governedOpportunity({
      ...relations,
      queryRelations: [
        {
          ...relations.queryRelations[0]!,
          projectId: "30000000-0000-4000-8000-000000000061",
        },
        {
          ...relations.queryRelations[1]!,
          diagnosticRunId: "30000000-0000-4000-8000-000000000062",
        },
        {
          ...relations.queryRelations[1]!,
          queryEvidence: {
            ...searchQueryEvidence(),
            observationId: "30000000-0000-4000-8000-000000000063",
          },
        },
      ],
      competitorRelations: [
        {
          ...relations.competitorRelations[0]!,
          findingId: "30000000-0000-4000-8000-000000000064",
        },
        {
          ...relations.competitorRelations[0]!,
          siteId: "30000000-0000-4000-8000-000000000065",
        },
        {
          ...relations.competitorRelations[0]!,
          competitorRevision: 5,
        },
      ],
    });

    expect(opportunity?.searchQueries).toEqual([]);
    expect(opportunity?.generativeQueries).toEqual([]);
    expect(opportunity?.competitorRefs).toEqual([]);
  });

  it("rejects a stale governance envelope even for a lineage-free manual competitor origin", () => {
    const relations = relationEvidence();
    const stale = governedOpportunity({
      ...relations,
      scope: {
        ...relations.scope,
        diagnosticInputHash: "b".repeat(64),
      },
    });

    expect(stale).toMatchObject({
      searchQueries: [],
      generativeQueries: [],
      competitorRefs: [],
    });
  });

  it("drops conflicting payloads for one immutable governed query relation", () => {
    const relations = relationEvidence();
    const canonical = relations.queryRelations[1]!;
    const conflicting = {
      ...canonical,
      queryEvidence: {
        ...searchQueryEvidence(),
        metrics: {
          ...searchQueryEvidence().metrics,
          monthlyVolume: 901,
        },
      },
    };

    const firstOrder = governedOpportunity({
      ...relations,
      queryRelations: [canonical, conflicting],
      competitorRelations: [],
    });
    const reverseOrder = governedOpportunity({
      ...relations,
      queryRelations: [conflicting, canonical],
      competitorRelations: [],
    });

    expect(firstOrder?.searchQueries).toEqual([]);
    expect(reverseOrder?.searchQueries).toEqual([]);
  });

  it("requires approved/confirmed governance at the frozen revision", () => {
    const relations = relationEvidence();
    const governance = structuredClone(relations.governance) as unknown as {
      keywordClusters: Array<{
        keywords: Array<Record<string, unknown>>;
      }>;
      competitors: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    governance.keywordClusters[0]!.keywords[0]!["mappingReviewState"] =
      "unreviewed";
    governance.competitors[0]!["reviewStatus"] = "candidate";
    governance.competitors[0]!["relationship"] = null;
    governance.competitors[0]!["analysisScopes"] = [];

    const opportunity = governedOpportunity({
      ...relations,
      governance: parseGovernanceProjectionV1(governance),
    });

    expect(opportunity?.searchQueries).toEqual([
      secondSearchQueryEvidence(),
    ]);
    expect(opportunity?.generativeQueries).toEqual([
      generativeQueryEvidence(),
    ]);
    expect(opportunity?.competitorRefs).toEqual([]);
  });

  it("keeps honest empty relations without authority or a target relationship", () => {
    const noAuthority = governedOpportunity(null);
    const relations = relationEvidence();
    const malformedAuthority = governedOpportunity({
      ...relations,
      governance: {} as never,
    });
    const unrelatedTarget = governedOpportunity(
      relationEvidence(),
      clusterTarget("another cluster"),
    );

    expect(noAuthority).toMatchObject({
      searchQueries: [],
      generativeQueries: [],
      competitorRefs: [],
    });
    expect(malformedAuthority).toMatchObject({
      searchQueries: [],
      generativeQueries: [],
      competitorRefs: [],
    });
    expect(unrelatedTarget).toMatchObject({
      searchQueries: [],
      generativeQueries: [],
      // Competitor context is explicitly Finding-linked and does not become
      // false merely because the primary target is not a keyword cluster.
      competitorRefs: [ids.competitor],
    });
  });
});

describe("supportingFindingIds (decision F: the content cluster only)", () => {
  const clusterKey = "customer onboarding";
  const supportA = "30000000-0000-4000-8000-000000000021";
  const supportB = "30000000-0000-4000-8000-000000000022";

  function clusterTarget(): OpportunityTargetInput {
    return {
      relation: "affected_by_keyword_cluster",
      targetKind: "keyword_cluster",
      targetRef: clusterKey,
      resolutionState: "definition_only",
      sitePageId: null,
      pageSnapshotId: null,
    };
  }

  function clusterRows(
    rows: readonly TopicClusterSupportRow[],
  ): ReadonlyMap<string, readonly TopicClusterSupportRow[]> {
    return groupTopicClusterSupportRows(rows);
  }

  it("names the cluster key a keyword-cluster Finding is projected onto", () => {
    expect(primaryTopicClusterKey([clusterTarget()])).toBe(clusterKey);
    expect(primaryTopicClusterKey([ownedUrlTarget()])).toBeNull();
    expect(primaryTopicClusterKey([])).toBeNull();
  });

  it("populates supporting Findings from the TopicCluster read model", () => {
    const opportunity = buildOpportunity({
      finding: { ...reviewableFinding, ruleId: "CONTENT-GAP-011" },
      targets: [clusterTarget()],
      evidence: [crawlEvidence({ sourceProvider: "dataforseo" })],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
      topicClusterRows: clusterRows([
        {
          clusterKey,
          sitePageId: ids.sitePage,
          findingId: supportB,
          mappingConfirmed: true,
        },
        {
          clusterKey,
          sitePageId: ids.sitePage,
          findingId: supportA,
          mappingConfirmed: true,
        },
      ]),
    });
    expect(opportunity?.supportingFindingIds).toEqual([supportA, supportB]);
    expect(opportunity?.coverageAndLimitations).toContain(
      "Supporting Findings are projected from the reviewed keyword cluster label and the operator's keyword-to-page mapping; they are not a separate rule result.",
    );
    expect(GrowthOpportunity.parse(opportunity)).toEqual(opportunity);
  });

  it("says out loud when the cluster has no page assignment", () => {
    const opportunity = buildOpportunity({
      finding: { ...reviewableFinding, ruleId: "CONTENT-GAP-011" },
      targets: [clusterTarget()],
      evidence: [crawlEvidence({ sourceProvider: "dataforseo" })],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
      topicClusterRows: clusterRows([]),
    });
    expect(opportunity?.supportingFindingIds).toEqual([]);
    expect(opportunity?.coverageAndLimitations).toContain(
      "This keyword cluster is not mapped to any owned page yet, so no supporting Findings could be derived.",
    );
  });

  it("leaves every non-cluster rule with the empty list decision F fixed", () => {
    const opportunity = buildOpportunity({
      finding: reviewableFinding,
      targets: [ownedUrlTarget()],
      evidence: [crawlEvidence()],
      action: null,
      diagnosticRunId: ids.run,
      now: NOW,
      // A URL Opportunity is handed the same read model and must ignore it.
      topicClusterRows: clusterRows([
        {
          clusterKey: "https://example.com/customer-onboarding/",
          sitePageId: ids.sitePage,
          findingId: supportA,
          mappingConfirmed: true,
        },
      ]),
    });
    expect(opportunity?.supportingFindingIds).toEqual([]);
    expect(opportunity?.coverageAndLimitations).not.toContain(
      "Supporting Findings are projected from the reviewed keyword cluster label and the operator's keyword-to-page mapping; they are not a separate rule result.",
    );
  });
});
