import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  CompetitorMonitorItem,
  CompetitorMonitorResponse,
  GrowthMapCompetitorLibraryItem,
  GrowthMapKeywordLibraryItem,
  GrowthMapKeywordRankHistory,
  GrowthMapKeywordRelation,
  GrowthMapInternalLinkMap,
  GrowthMapKeywordNumericMetric,
  GrowthMapTopicModelInsights,
  GrowthMapUrlFinding,
  GrowthMapUrlMetricObservation,
  GrowthMapUrlPortfolioItem,
  TopicModelWorkspaceProjection,
} from "@sf/contracts";
import { ApiError } from "@/lib/api";
import {
  GROWTH_MAP_OBJECT_MODES,
  GROWTH_MAP_DETAIL_STATES,
  buildBeginTopicModelDraftCommand,
  buildConfirmTopicModelCommand,
  buildKeywordRankChartModel,
  buildKeywordGovernanceReviewCommand,
  filterGrowthMapCompetitorItems,
  filterGrowthMapKeywordEntries,
  filterGrowthMapUrlItems,
  buildKeywordRelationDecisionCommand,
  buildKeywordRelationPageProjection,
  buildInternalLinkMapProjection,
  buildPatchTopicModelDraftCommand,
  buildTopicMapProjection,
  buildTopicNodeCreateIntent,
  buildTopicNodeMergeIntent,
  buildTopicNodeRenameIntent,
  buildTopicNodeRetireIntent,
  buildTopicNodeSplitIntent,
  buildTopicNodeUpdateIntent,
  buildGrowthMapReviewCommand,
  findMetricObservation,
  growthMapLocationHref,
  growthMapDetailAllowsFindingReview,
  competitorDetailReadState,
  competitorMonitorDisplayState,
  competitorLibraryReadState,
  growthMapPlatformLimitationKey,
  rememberGrowthMapCursorPredecessor,
  resolveGrowthMapCursorPredecessor,
  keywordMetricPresentation,
  keywordDetailReadState,
  keywordTopicNeedsConflictConfirmation,
  keywordLibraryReadState,
  metricValueLabelKey,
  metricPresentation,
  normalizeGrowthMapObjectMode,
  presentGrowthMapReviewProblem,
  resolveVisibleSitePageSelection,
  resolveVisibleSitePageSelectionForFinding,
  resolveVisibleCompetitorSelection,
  resolveVisibleKeywordSelection,
  safeExternalPageUrl,
  selectCompetitorMonitorItem,
  shouldShowGrowthMapReviewError,
  topicNodeAllowedParentIds,
  uniqueMetricSources,
} from "./_growth-map-view-model.ts";

const IDS = {
  action: "66666666-6666-4666-8666-666666666666",
  artifact: "77777777-7777-4777-8777-777777777777",
  evidence: "00000000-0000-4000-8000-000000000000",
  finding: "44444444-4444-4444-8444-444444444444",
  supportingFinding: "55555555-5555-4555-8555-555555555555",
  observation: "11111111-1111-4111-8111-111111111111",
  snapshot: "22222222-2222-4222-8222-222222222222",
  sitePage: "33333333-3333-4333-8333-333333333333",
  sitePageB: "33333333-3333-4333-8333-333333333334",
  sitePageC: "33333333-3333-4333-8333-333333333335",
  relation: "88888888-8888-4888-8888-888888888888",
  candidate: "99999999-9999-4999-8999-999999999999",
  keywordA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  keywordB: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  keywordC: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  decision: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  actor: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
  topic: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
  topicRoot: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7",
  topicChild: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8",
  topicGrandchild: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
  topicSuccessor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  project: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  internalLinkFinding: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
  internalLinkSourceFinding: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
  internalLinkTopic: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5",
  competitorA: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  competitorB: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
} as const;

function competitorMonitorItem(
  overrides: Partial<CompetitorMonitorItem> = {},
): CompetitorMonitorItem {
  return {
    competitorId: IDS.competitorA,
    domain: "alpha.example",
    name: "Alpha",
    relationship: "direct",
    analysisScopes: ["keyword_gap", "content"],
    eligibility: "eligible",
    collectionState: "collected",
    evaluationState: "available",
    lastCollectionAt: "2026-07-28T08:00:00.000Z",
    nextCollectionAt: "2026-08-28T08:00:00.000Z",
    limitation: null,
    recentSignals: [],
    ...overrides,
  };
}

function competitorMonitorResponse(
  overrides: Partial<CompetitorMonitorResponse> = {},
): CompetitorMonitorResponse {
  return {
    projectId: IDS.project,
    config: {
      enabled: true,
      frequency: "monthly",
      revision: 1,
      updatedAt: "2026-07-28T08:00:00.000Z",
    },
    scope: {
      market: "US",
      languageTag: "en-US",
      topicModelRevision: 3,
    },
    availability: "available",
    limitation: null,
    competitors: [
      competitorMonitorItem(),
      competitorMonitorItem({
        competitorId: IDS.competitorB,
        domain: "beta.example",
        name: "Beta",
        evaluationState: "baseline",
        limitation:
          "A first immutable snapshot exists; one comparable monthly snapshot is still required.",
      }),
    ],
    generatedAt: "2026-07-28T08:00:00.000Z",
    ...overrides,
  };
}

function internalLinkMapFixture(): GrowthMapInternalLinkMap {
  const customerUrl = "https://example.test/customer-onboarding/";
  const pricingUrl = "https://example.test/pricing/";
  const resourcesUrl = "https://example.test/resources/";
  const inboundEdge: GrowthMapInternalLinkMap["graph"]["edges"][number] = {
    sourceCanonicalUrl: pricingUrl,
    targetCanonicalUrl: customerUrl,
    sourceSitePageIds: [IDS.sitePageB],
    targetSitePageIds: [IDS.sitePage],
    facts: [
      {
        observationId: IDS.observation,
        sourceSitePageId: IDS.sitePageB,
        anchorText: "Customer onboarding",
        rel: null,
      },
    ],
    reciprocal: false,
  };

  return {
    projectId: IDS.project,
    diagnosticRunId: IDS.snapshot,
    crawlSnapshot: {
      snapshotId: IDS.snapshot,
      capturedAt: "2026-07-28T08:00:00.000Z",
      availability: "available",
      limitation: null,
    },
    coverage: {
      availability: "available",
      crawlCompleteness: "complete",
      limitations: [],
    },
    graph: {
      nodes: [
        {
          canonicalUrl: customerUrl,
          sitePageIds: [IDS.sitePage],
          title: "Customer onboarding",
          inboundCount: 1,
          outboundCount: 0,
          status: "one_way",
          executionRefs: [
            {
              findingId: IDS.internalLinkFinding,
              actionId: IDS.action,
            },
          ],
        },
        {
          canonicalUrl: pricingUrl,
          sitePageIds: [IDS.sitePageB],
          title: "Pricing",
          inboundCount: 0,
          outboundCount: 1,
          status: "one_way",
          executionRefs: [],
        },
        {
          canonicalUrl: resourcesUrl,
          sitePageIds: [IDS.sitePageC],
          title: "Resources",
          inboundCount: 0,
          outboundCount: 0,
          status: "orphan",
          executionRefs: [
            {
              findingId: IDS.internalLinkFinding,
              actionId: IDS.action,
            },
            {
              findingId: IDS.internalLinkSourceFinding,
              actionId: null,
            },
          ],
        },
      ],
      edges: [inboundEdge],
      totalEdgeCount: 1,
      edgesTruncated: false,
    },
    selectedPage: {
      selectedSitePageId: IDS.sitePage,
      canonicalUrl: customerUrl,
      inboundSources: [inboundEdge],
      recommendationCoverage: {
        availability: "available",
        limitations: [],
      },
      recommendations: [
        {
          sourceCanonicalUrl: resourcesUrl,
          sourceSitePageIds: [IDS.sitePageC],
          targetCanonicalUrl: customerUrl,
          targetSitePageIds: [IDS.sitePage],
          basis: {
            kind: "same_confirmed_topic",
            topicNodeId: IDS.internalLinkTopic,
            topicModelRevision: 3,
            topicLabel: "Customer onboarding",
          },
          explanation:
            "来源页与目标页属于同一个已确认 Topic，且冻结 Crawl 中未观察到该方向的内链。",
        },
      ],
      totalRecommendationCount: 1,
      recommendationsTruncated: false,
    },
    generatedAt: "2026-07-28T08:05:00.000Z",
  };
}

function keywordItem(
  keywordId: string,
  displayKeyword: string,
  overrides: Partial<GrowthMapKeywordLibraryItem> = {},
): GrowthMapKeywordLibraryItem {
  return {
    projectId: IDS.project,
    keywordId,
    displayKeyword,
    normalizedKeyword: displayKeyword.toLowerCase(),
    marketCode: "US",
    languageTag: "en-US",
    queryKind: "search_query",
    status: "approved",
    revision: 1,
    intent: "Commercial",
    buyerStage: "Consideration",
    cluster: null,
    classificationLimitations: {
      intent: null,
      buyerStage: null,
      cluster: null,
    },
    mappedTarget: { kind: "unassigned" },
    sourceOccurrences: [],
    metrics: {
      volume: null,
      kd: null,
      currentRank: null,
      currentUrl: null,
      limitations: {
        volume: null,
        kd: null,
        currentRank: null,
        currentUrl: null,
      },
    },
    coverage: {
      availability: "available",
      limitations: [],
    },
    ...overrides,
  } as GrowthMapKeywordLibraryItem;
}

function urlPortfolioItem(
  sitePageId: string,
  overrides: Partial<GrowthMapUrlPortfolioItem> = {},
): GrowthMapUrlPortfolioItem {
  return {
    projectId: IDS.project,
    siteId: IDS.project,
    diagnosticRunId: IDS.snapshot,
    crawlSnapshotId: IDS.snapshot,
    sitePageId,
    pageSnapshotId: null,
    pageSnapshotCapturedAt: null,
    identitySources: [],
    normalizedUrl: `https://example.test/${sitePageId}/`,
    title: sitePageId,
    pageType: "product",
    templateKey: null,
    clusterKey: null,
    ownerId: null,
    coverage: {
      availability: "available",
      limitations: [],
    },
    metricObservations: [],
    findingIds: [],
    reviewableFindingIds: [],
    priority: {
      availability: "available",
      value: "high",
      basis: {
        findingIds: [IDS.finding],
      },
      limitation: null,
    },
    delta: {
      availability: "unavailable",
      limitation: "No prior diagnostic run is available for comparison.",
    },
    ...overrides,
  } as GrowthMapUrlPortfolioItem;
}

function competitorItem(
  competitorId: string,
  domain: string,
  overrides: Partial<GrowthMapCompetitorLibraryItem> = {},
): GrowthMapCompetitorLibraryItem {
  return {
    projectId: IDS.project,
    competitorId,
    domain,
    name: domain,
    reviewStatus: "candidate",
    relationship: null,
    analysisScope: [],
    revision: 1,
    originOccurrences: [],
    lastObservedAt: null,
    serpOverlap: {
      availability: "unavailable",
      value: null,
      limitation: "SERP overlap data is unavailable.",
    },
    aiCitationInsight: {
      availability: "unavailable",
      value: null,
      limitation: "AI citation insight is unavailable.",
    },
    coverage: {
      availability: "available",
      limitations: [],
    },
    ...overrides,
  } as GrowthMapCompetitorLibraryItem;
}

function keywordRelation(): GrowthMapKeywordRelation {
  const participant = (
    keywordId: string,
    displayKeyword: string,
  ) => ({
    keywordId,
    displayKeyword,
    normalizedKeyword: displayKeyword.toLowerCase(),
    governanceRevision: 2,
    marketCode: "US",
    languageTag: "en-US",
    intent: "Commercial",
    topicNodeId: IDS.topic,
    topicModelRevision: 1,
    mappedSitePageId: IDS.sitePage,
  });
  const candidate = {
    candidateId: IDS.candidate,
    relationId: IDS.relation,
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    candidateRevision: 1,
    ruleVersion: "keyword-relation.1.0.0" as const,
    keywordA: participant(IDS.keywordA, "Customer onboarding"),
    keywordB: participant(
      IDS.keywordB,
      "Customer onboarding automation",
    ),
    signals: {
      sameConfirmedMappedPage: true as const,
      sameReviewedIntent: true as const,
      sameMarket: true as const,
      sameLanguage: true as const,
      sameConfirmedTopic: true,
      lexicalTokenOverlap: 0.67,
      serpOverlap: {
        availability: "unavailable" as const,
        value: null,
        limitation:
          "Canonical SERP-overlap observations are not available yet.",
      },
    },
    evidenceHash: "a".repeat(64),
    generatedAt: "2026-07-28T00:00:00.000Z",
  };
  return {
    projectId: candidate.projectId,
    relationId: IDS.relation,
    candidate,
    candidateState: "current",
    staleReasons: [],
    currentRelationRevision: 1,
    decision: {
      decisionId: IDS.decision,
      relationId: IDS.relation,
      candidateId: IDS.candidate,
      projectId: candidate.projectId,
      relationRevision: 1,
      decisionKind: "primary_supporting",
      primaryKeywordId: IDS.keywordA,
      supportingKeywordId: IDS.keywordB,
      reason: "Use one primary Keyword and retain supporting evidence.",
      decidedBy: IDS.actor,
      decidedAt: "2026-07-28T00:05:00.000Z",
    },
    decisionState: "active",
    displayState: "folded",
    isEffectivelyFolded: true,
    primaryKeywordId: IDS.keywordA,
    supportingKeywordId: IDS.keywordB,
  };
}

function topicNode(
  topicNodeId: string,
  parentTopicNodeId: string | null,
  label: string,
  topicModelRevision = 1,
  lifecycleState: "active" | "superseded" = "active",
) {
  return {
    projectId: IDS.project,
    topicNodeId,
    topicModelRevision,
    parentTopicNodeId,
    label,
    description: `${label} description`,
    intentEnvelope: ["Commercial"],
    lifecycleState,
  };
}

function confirmedTopicWorkspace(): TopicModelWorkspaceProjection {
  return {
    projectId: IDS.project,
    latestConfirmed: {
      projectId: IDS.project,
      topicModelRevision: 1,
      editRevision: 2,
      rootTopicNodeId: IDS.topicRoot,
      nodes: [
        topicNode(IDS.topicRoot, null, "Customer onboarding"),
        topicNode(
          IDS.topicChild,
          IDS.topicRoot,
          "Onboarding automation",
        ),
      ],
      aliases: [],
      successorRelationships: [],
      createdAt: "2026-07-20T00:00:00.000Z",
      createdBy: IDS.actor,
      state: "confirmed",
      confirmedAt: "2026-07-21T00:00:00.000Z",
      confirmedBy: IDS.actor,
      contentHash: "c".repeat(64),
    },
    draft: null,
    generatedAt: "2026-07-21T00:01:00.000Z",
  };
}

function draftTopicWorkspace(): TopicModelWorkspaceProjection {
  const confirmed = confirmedTopicWorkspace();
  return {
    ...confirmed,
    draft: {
      projectId: IDS.project,
      topicModelRevision: 2,
      editRevision: 4,
      rootTopicNodeId: IDS.topicRoot,
      nodes: [
        topicNode(
          IDS.topicRoot,
          null,
          "Customer operations",
          2,
        ),
        topicNode(
          IDS.topicChild,
          IDS.topicRoot,
          "Onboarding automation",
          2,
        ),
        topicNode(
          IDS.topicGrandchild,
          IDS.topicChild,
          "Workflow templates",
          2,
        ),
      ],
      aliases: [],
      successorRelationships: [],
      createdAt: "2026-07-22T00:00:00.000Z",
      createdBy: IDS.actor,
      state: "draft",
      updatedAt: "2026-07-22T00:05:00.000Z",
    },
    generatedAt: "2026-07-22T00:06:00.000Z",
  };
}

function topicInsights(): GrowthMapTopicModelInsights {
  return {
    projectId: IDS.project,
    topicModelRevision: 1,
    nodes: [
      {
        projectId: IDS.project,
        topicNodeId: IDS.topicRoot,
        topicModelRevision: 1,
        label: "Customer onboarding",
        keywordCount: 2,
        approvedKeywordCount: 1,
        reviewPendingKeywordCount: 1,
        existingPageKeywordCount: 0,
        newAssetKeywordCount: 1,
        unassignedKeywordCount: 1,
        mappedPageCount: 0,
        conflictingIntentCount: 0,
        coverageState: "uncovered",
        limitation: "No existing page covers the confirmed Topic.",
      },
      {
        projectId: IDS.project,
        topicNodeId: IDS.topicChild,
        topicModelRevision: 1,
        label: "Onboarding automation",
        keywordCount: 2,
        approvedKeywordCount: 2,
        reviewPendingKeywordCount: 0,
        existingPageKeywordCount: 2,
        newAssetKeywordCount: 0,
        unassignedKeywordCount: 0,
        mappedPageCount: 2,
        conflictingIntentCount: 1,
        coverageState: "conflict",
        limitation: "Two mapped pages compete for the same intent.",
      },
    ],
    coverage: {
      availability: "partial",
      limitations: ["One or more Topics require review."],
    },
    generatedAt: "2026-07-21T00:01:00.000Z",
  };
}

function rankHistory(): GrowthMapKeywordRankHistory {
  return {
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    keywordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    mappedPage: {
      sitePageId: IDS.sitePage,
      normalizedUrl: "https://example.com/customer-onboarding/",
    },
    window: {
      startedAt: "2026-04-22T00:00:00.000Z",
      endedAt: "2026-07-21T00:00:00.000Z",
      days: 90,
    },
    series: [
      {
        provider: "dataforseo",
        metric: "absolute_rank",
        interpretation: "Absolute Google organic rank observed by DataForSEO.",
        points: [
          {
            occurrenceId: "10000000-0000-4000-8000-000000000001",
            snapshotId: "10000000-0000-4000-8000-000000000002",
            observationId: "10000000-0000-4000-8000-000000000003",
            provider: "dataforseo",
            metric: "absolute_rank",
            value: 18,
            valuePointer: "/valueJson/currentRank",
            observedAt: "2026-04-22T00:00:00.000Z",
            providerDataAsOf: null,
            grade: "B",
            limitation: "The provider does not expose data-as-of time.",
          },
          {
            occurrenceId: "10000000-0000-4000-8000-000000000004",
            snapshotId: "10000000-0000-4000-8000-000000000005",
            observationId: "10000000-0000-4000-8000-000000000006",
            provider: "dataforseo",
            metric: "absolute_rank",
            value: 6,
            valuePointer: "/valueJson/currentRank",
            observedAt: "2026-07-21T00:00:00.000Z",
            providerDataAsOf: null,
            grade: "B",
            limitation: "The provider does not expose data-as-of time.",
          },
        ],
      },
      {
        provider: "gsc",
        metric: "gsc_28d_average_position",
        interpretation:
          "GSC rolling 28-day impression-weighted average position.",
        points: [
          {
            occurrenceId: "20000000-0000-4000-8000-000000000001",
            snapshotId: "20000000-0000-4000-8000-000000000002",
            observationId: "20000000-0000-4000-8000-000000000003",
            provider: "gsc",
            metric: "gsc_28d_average_position",
            value: 12.5,
            valuePointer: "/valueJson/topQueries/0/position",
            observedAt: "2026-06-06T00:00:00.000Z",
            providerDataAsOf: "2026-06-05T00:00:00.000Z",
            grade: "A",
            limitation: "This is a rolling average.",
          },
        ],
      },
    ],
    changeMarkers: [
      {
        changeReceiptId: "30000000-0000-4000-8000-000000000001",
        publicationAttemptId: "30000000-0000-4000-8000-000000000002",
        attemptKind: "publish",
        artifactId: IDS.artifact,
        artifactRevision: 3,
        targetRef: "customer-onboarding",
        liveCanonicalUrl: "https://example.com/customer-onboarding/",
        changedAt: "2026-06-06T00:00:00.000Z",
      },
    ],
    coverage: {
      availability: "partial",
      limitations: ["GSC is a rolling average."],
    },
    generatedAt: "2026-07-21T00:00:00.000Z",
  };
}

function apiError(
  code: string,
  overrides: {
    readonly title?: string;
    readonly detail?: string;
    readonly current?: Readonly<Record<string, unknown>> | null;
  } = {},
): ApiError {
  return new ApiError({
    type: "about:blank",
    title: overrides.title ?? "Canonical problem title",
    status: 409,
    code,
    detail: overrides.detail ?? "Canonical problem detail.",
    requestId: "request-1",
    ...(overrides.current === undefined ? {} : { current: overrides.current }),
  });
}

function reviewFinding(
  overrides: Partial<GrowthMapUrlFinding> = {},
): GrowthMapUrlFinding {
  return {
    findingId: IDS.finding,
    reviewRevision: 0,
    ...overrides,
  } as GrowthMapUrlFinding;
}

function metric(
  overrides: Partial<GrowthMapUrlMetricObservation> = {},
): GrowthMapUrlMetricObservation {
  return {
    provider: "gsc",
    metricKey: "gsc.page.v1",
    valueSource: {
      kind: "value_json",
      pointer: "/current28d/clicks",
    },
    subjectRef: "https://example.com/customer-onboarding/",
    value: 2450,
    unit: null,
    availability: "available",
    snapshotId: IDS.snapshot,
    observationId: IDS.observation,
    sitePageId: IDS.sitePage,
    observedAt: "2026-07-21T08:00:00Z",
    freshness: "current",
    limitation: null,
    ...overrides,
  } as GrowthMapUrlMetricObservation;
}

describe("Growth Map view model", () => {
  it("keeps Internal Link Map inside the selected URL with real edges and Finding/Action references", () => {
    const projection = buildInternalLinkMapProjection(
      internalLinkMapFixture(),
      IDS.sitePage,
    );

    expect(projection.kind).toBe("ready");
    if (projection.kind !== "ready") return;
    expect(projection.selectedNode).toMatchObject({
      canonicalUrl: "https://example.test/customer-onboarding/",
      inboundCount: 1,
      outboundCount: 0,
      status: "one_way",
    });
    expect(projection.graph).toMatchObject({
      totalNodeCount: 3,
      totalEdgeCount: 1,
      returnedEdgeCount: 1,
      edgesTruncated: false,
    });
    expect(projection.neighborhood.edges).toHaveLength(1);
    expect(
      projection.neighborhood.nodes.map((node) => node.canonicalUrl),
    ).toEqual([
      "https://example.test/customer-onboarding/",
      "https://example.test/pricing/",
      "https://example.test/resources/",
    ]);
    expect(projection.inboundSources[0]?.facts[0]).toMatchObject({
      observationId: IDS.observation,
      anchorText: "Customer onboarding",
    });
    expect(projection.recommendations[0]?.executionRefs).toEqual([
      {
        role: "target",
        findingId: IDS.internalLinkFinding,
        actionId: IDS.action,
      },
      {
        role: "source",
        findingId: IDS.internalLinkFinding,
        actionId: IDS.action,
      },
      {
        role: "source",
        findingId: IDS.internalLinkSourceFinding,
        actionId: null,
      },
    ]);
  });

  it("never shows the first URL's Internal Link Map after a different URL is selected", () => {
    expect(
      buildInternalLinkMapProjection(
        internalLinkMapFixture(),
        IDS.sitePageB,
      ),
    ).toEqual({
      kind: "selection_unavailable",
      coverage: {
        availability: "available",
        crawlCompleteness: "complete",
        limitations: [],
      },
    });
  });

  it("preserves unavailable Internal Link authority without synthesizing zero counts", () => {
    const unavailable: GrowthMapInternalLinkMap = {
      projectId: IDS.project,
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
      generatedAt: "2026-07-28T08:05:00.000Z",
    };

    expect(buildInternalLinkMapProjection(unavailable, IDS.sitePage)).toEqual({
      kind: "unavailable",
      coverage: unavailable.coverage,
    });
  });

  it("keeps Audit Evidence and Opportunity Review as selected-object detail states", () => {
    expect(GROWTH_MAP_DETAIL_STATES).toEqual([
      "audit_evidence",
      "opportunity_review",
    ]);
    expect(growthMapDetailAllowsFindingReview("audit_evidence")).toBe(false);
    expect(growthMapDetailAllowsFindingReview("opportunity_review")).toBe(true);
  });

  it("has exactly three second-level object modes and defaults to pages", () => {
    expect(GROWTH_MAP_OBJECT_MODES).toEqual([
      "pages",
      "keywords",
      "competitors",
      "backlinks",
    ]);
    expect(normalizeGrowthMapObjectMode(null)).toBe("pages");
    expect(normalizeGrowthMapObjectMode("unknown")).toBe("pages");
    expect(normalizeGrowthMapObjectMode("competitors")).toBe("competitors");
    expect(normalizeGrowthMapObjectMode("backlinks")).toBe("backlinks");
  });

  it("replaces selectedSitePageId on every URL selection while preserving current state", () => {
    const first = growthMapLocationHref(
      "/p/project/growth-map",
      "object=pages&q=onboarding&selectedSitePageId=old",
      { selectedSitePageId: "page-a" },
    );
    const second = growthMapLocationHref(
      "/p/project/growth-map",
      first.split("?")[1] ?? "",
      { selectedSitePageId: "page-b" },
    );

    expect(first).toBe(
      "/p/project/growth-map?object=pages&q=onboarding&selectedSitePageId=page-a",
    );
    expect(second).toBe(
      "/p/project/growth-map?object=pages&q=onboarding&selectedSitePageId=page-b",
    );
  });

  it("replaces selectedKeywordId on every Keyword selection while preserving its cursor", () => {
    const first = growthMapLocationHref(
      "/p/project/growth-map",
      "object=keywords&cursor=opaque&selectedKeywordId=old",
      { selectedKeywordId: "keyword-a" },
    );
    const second = growthMapLocationHref(
      "/p/project/growth-map",
      first.split("?")[1] ?? "",
      { selectedKeywordId: "keyword-b" },
    );

    expect(first).toBe(
      "/p/project/growth-map?object=keywords&cursor=opaque&selectedKeywordId=keyword-a",
    );
    expect(second).toBe(
      "/p/project/growth-map?object=keywords&cursor=opaque&selectedKeywordId=keyword-b",
    );
  });

  it("replaces selectedCompetitorId on every Competitor selection while preserving its cursor", () => {
    const first = growthMapLocationHref(
      "/p/project/growth-map",
      "object=competitors&cursor=opaque&selectedCompetitorId=old",
      { selectedCompetitorId: "competitor-a" },
    );
    const second = growthMapLocationHref(
      "/p/project/growth-map",
      first.split("?")[1] ?? "",
      { selectedCompetitorId: "competitor-b" },
    );

    expect(first).toBe(
      "/p/project/growth-map?object=competitors&cursor=opaque&selectedCompetitorId=competitor-a",
    );
    expect(second).toBe(
      "/p/project/growth-map?object=competitors&cursor=opaque&selectedCompetitorId=competitor-b",
    );
  });

  it("keeps same-page Growth Map selection out of asynchronous RSC navigation", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('window.history.replaceState(null, "", href)');
    expect(source).toContain("window.location.search.slice(1)");
    expect(source).not.toContain("useRouter");
    expect(source).not.toContain("useOptimistic");
    expect(source).not.toContain("useTransition");
    expect(source).not.toContain("data-navigation-pending");
    expect(source).not.toContain("_growth-map-navigation");
  });

  it("keeps Competitor detail constrained to the visible cursor page", () => {
    expect(
      resolveVisibleCompetitorSelection("competitor-b", [
        "competitor-a",
        "competitor-b",
      ]),
    ).toBe("competitor-b");
    expect(
      resolveVisibleCompetitorSelection("filtered-out", [
        "competitor-a",
        "competitor-b",
      ]),
    ).toBe("competitor-a");
    expect(resolveVisibleCompetitorSelection("stale", [])).toBeNull();
  });

  it("keeps Keyword detail constrained to the visible cursor page", () => {
    expect(
      resolveVisibleKeywordSelection("keyword-b", ["keyword-a", "keyword-b"]),
    ).toBe("keyword-b");
    expect(
      resolveVisibleKeywordSelection("filtered-out", [
        "keyword-a",
        "keyword-b",
      ]),
    ).toBe("keyword-a");
    expect(resolveVisibleKeywordSelection("stale", [])).toBeNull();
  });

  it("filters the current URL page by pageType and priority without mutating input order", () => {
    const items = [
      urlPortfolioItem(IDS.sitePage, {
        pageType: "product",
        priority: {
          availability: "available",
          value: "high",
          basis: {
            derivationVersion: "max_finding_severity.v1",
            projectId: IDS.project,
            siteId: IDS.project,
            diagnosticRunId: IDS.snapshot,
            sitePageId: IDS.sitePage,
            findingIds: [IDS.finding],
          },
          limitation: null,
        },
      }),
      urlPortfolioItem(IDS.sitePageB, {
        pageType: "blog",
        priority: {
          availability: "available",
          value: "medium",
          basis: {
            derivationVersion: "max_finding_severity.v1",
            projectId: IDS.project,
            siteId: IDS.project,
            diagnosticRunId: IDS.snapshot,
            sitePageId: IDS.sitePageB,
            findingIds: [IDS.finding],
          },
          limitation: null,
        },
      }),
      urlPortfolioItem(IDS.sitePageC, {
        pageType: null,
        priority: {
          availability: "unavailable",
          value: null,
          limitation: "No confirmed priority is available.",
        },
      }),
    ] as const;

    const filtered = filterGrowthMapUrlItems(items, {
      pageType: "product",
      priority: "high",
    });

    expect(filtered.map((item) => item.sitePageId)).toEqual([IDS.sitePage]);
    expect(items.map((item) => item.sitePageId)).toEqual([
      IDS.sitePage,
      IDS.sitePageB,
      IDS.sitePageC,
    ]);
    expect(filtered).not.toBe(items);
  });

  it("treats all pageType and priority filters as pass-through", () => {
    const items = [
      urlPortfolioItem(IDS.sitePage),
      urlPortfolioItem(IDS.sitePageB, { pageType: "blog" }),
    ] as const;

    expect(
      filterGrowthMapUrlItems(items, {
        pageType: "all",
        priority: "all",
      }).map((item) => item.sitePageId),
    ).toEqual([IDS.sitePage, IDS.sitePageB]);
  });

  it("filters Keyword relation rows by NFKC/case-insensitive search and sourceKind", () => {
    const items = buildKeywordRelationPageProjection(
      [
        keywordItem(IDS.keywordA, "Customer Onboarding", {
          cluster: {
            clusterId: IDS.topic,
            name: "Activation Playbook",
          },
          intent: "Commercial",
          sourceOccurrences: [
            {
              sourceKind: "gsc_top_query",
            },
          ] as GrowthMapKeywordLibraryItem["sourceOccurrences"],
        }),
        keywordItem(IDS.keywordB, "オンボーディング", {
          marketCode: "GB",
          languageTag: "en-GB",
          cluster: {
            clusterId: IDS.topicChild,
            name: "Ｐｌａｙｂｏｏｋ",
          },
          intent: "Informational",
          buyerStage: "Awareness",
          mappedTarget: {
            kind: "existing_page",
            reviewState: "approved",
            revision: 1,
            reason: null,
            sitePageId: IDS.sitePage,
            normalizedUrl: "https://example.test/guides/onboarding/",
          },
          sourceOccurrences: [
            {
              sourceKind: "manual",
            },
          ] as GrowthMapKeywordLibraryItem["sourceOccurrences"],
        }),
      ],
      [],
    ).visibleItems;

    expect(
      filterGrowthMapKeywordEntries(items, {
        search: "playbook",
        sourceKind: "all",
      }).map((entry) => entry.item.keywordId),
    ).toEqual([IDS.keywordA, IDS.keywordB]);
    expect(
      filterGrowthMapKeywordEntries(items, {
        search: "commercial",
        sourceKind: "gsc_top_query",
      }).map((entry) => entry.item.keywordId),
    ).toEqual([IDS.keywordA]);
    for (const search of [
      "gb",
      "en-gb",
      "awareness",
      "/guides/onboarding",
    ]) {
      expect(
        filterGrowthMapKeywordEntries(items, {
          search,
          sourceKind: "all",
        }).map((entry) => entry.item.keywordId),
      ).toEqual([IDS.keywordB]);
    }
    expect(items.map((entry) => entry.item.keywordId)).toEqual([
      IDS.keywordA,
      IDS.keywordB,
    ]);
  });

  it("treats empty Keyword relation search as pass-through", () => {
    const items = buildKeywordRelationPageProjection(
      [keywordItem(IDS.keywordA, "Customer onboarding")],
      [],
    ).visibleItems;

    expect(
      filterGrowthMapKeywordEntries(items, {
        search: "   ",
        sourceKind: "all",
      }).map((entry) => entry.item.keywordId),
    ).toEqual([IDS.keywordA]);
  });

  it("filters Competitor Library rows by name/domain search and reviewStatus", () => {
    const items = [
      competitorItem(IDS.competitorA, "alpha.example", {
        name: "Acme Labs",
        reviewStatus: "approved",
      }),
      competitorItem(IDS.competitorB, "beta.example", {
        name: "Beta Research",
        reviewStatus: "candidate",
      }),
    ] as const;

    expect(
      filterGrowthMapCompetitorItems(items, {
        search: "acme",
        reviewStatus: "all",
      }).map((item) => item.competitorId),
    ).toEqual([IDS.competitorA]);
    expect(
      filterGrowthMapCompetitorItems(items, {
        search: "EXAMPLE",
        reviewStatus: "candidate",
      }).map((item) => item.competitorId),
    ).toEqual([IDS.competitorB]);
    expect(items.map((item) => item.competitorId)).toEqual([
      IDS.competitorA,
      IDS.competitorB,
    ]);
  });

  it("treats empty Competitor Library search and all status as pass-through", () => {
    const items = [
      competitorItem(IDS.competitorA, "alpha.example"),
      competitorItem(IDS.competitorB, "beta.example"),
    ] as const;

    expect(
      filterGrowthMapCompetitorItems(items, {
        search: "",
        reviewStatus: "all",
      }).map((item) => item.competitorId),
    ).toEqual([IDS.competitorA, IDS.competitorB]);
  });

  it("collapses only an active supporting Keyword and keeps its name under the primary row", () => {
    const projection = buildKeywordRelationPageProjection(
      [
        keywordItem(IDS.keywordA, "Customer onboarding", {
          sourceOccurrences: [
            { sourceKind: "csv_import" },
          ] as GrowthMapKeywordLibraryItem["sourceOccurrences"],
        }),
        keywordItem(
          IDS.keywordB,
          "Customer onboarding automation",
          {
            sourceOccurrences: [
              { sourceKind: "csv_import" },
              { sourceKind: "manual" },
              { sourceKind: "manual" },
            ] as GrowthMapKeywordLibraryItem["sourceOccurrences"],
          },
        ),
        keywordItem(IDS.keywordC, "Customer onboarding checklist", {
          sourceOccurrences: [
            { sourceKind: "manual" },
          ] as GrowthMapKeywordLibraryItem["sourceOccurrences"],
        }),
      ],
      [keywordRelation()],
    );

    expect(
      projection.visibleItems.map((entry) => entry.item.keywordId),
    ).toEqual([IDS.keywordA, IDS.keywordC]);
    expect(projection.collapsedSupportingKeywordIds).toEqual([
      IDS.keywordB,
    ]);
    expect(projection.loadedSourceCounts).toEqual({
      all: 3,
      csv_import: 2,
      dataforseo_ranked: 0,
      gsc_top_query: 0,
      interview_summary: 0,
      user_review: 0,
      manual: 2,
    });
    expect(projection.visibleItems[0]).toMatchObject({
      relations: [{ relationId: IDS.relation }],
      supportingKeywords: [
        {
          relationId: IDS.relation,
          keywordId: IDS.keywordB,
          displayKeyword: "Customer onboarding automation",
        },
      ],
    });
  });

  it("applies a relevant fold that arrives after the first 100 relation rows", () => {
    const irrelevantFirstPage = Array.from(
      { length: 100 },
      (_, index): GrowthMapKeywordRelation => {
        const current = keywordRelation();
        const suffix = (index + 1).toString(16).padStart(12, "0");
        const relationId = `88888888-8888-4888-8888-${suffix}`;
        const candidateId = `99999999-9999-4999-8999-${suffix}`;
        return {
          ...current,
          relationId,
          candidate: {
            ...current.candidate,
            relationId,
            candidateId,
          },
          decision: {
            ...current.decision!,
            decisionId: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
            relationId,
            candidateId,
            decisionKind: "keep_separate",
            primaryKeywordId: null,
            supportingKeywordId: null,
          },
          displayState: "kept_separate",
          isEffectivelyFolded: false,
          primaryKeywordId: null,
          supportingKeywordId: null,
        };
      },
    );
    const projection = buildKeywordRelationPageProjection(
      [
        keywordItem(IDS.keywordA, "Customer onboarding"),
        keywordItem(
          IDS.keywordB,
          "Customer onboarding automation",
        ),
      ],
      [...irrelevantFirstPage, keywordRelation()],
    );

    expect(
      projection.visibleItems.map((entry) => entry.item.keywordId),
    ).toEqual([IDS.keywordA]);
    expect(projection.collapsedSupportingKeywordIds).toEqual([
      IDS.keywordB,
    ]);
    expect(
      projection.relationsByKeywordId.get(IDS.keywordA),
    ).toHaveLength(101);
    expect(
      projection.visibleItems[0]?.supportingKeywords,
    ).toEqual([
      {
        relationId: IDS.relation,
        keywordId: IDS.keywordB,
        displayKeyword: "Customer onboarding automation",
      },
    ]);
  });

  it("restores a stale supporting Keyword instead of applying an obsolete fold", () => {
    const folded = keywordRelation();
    const stale: GrowthMapKeywordRelation = {
      ...folded,
      candidateState: "stale",
      staleReasons: ["mapping_changed"],
      decisionState: "stale",
      displayState: "stale",
      isEffectivelyFolded: false,
      primaryKeywordId: null,
      supportingKeywordId: null,
    };
    const projection = buildKeywordRelationPageProjection(
      [
        keywordItem(IDS.keywordA, "Customer onboarding"),
        keywordItem(
          IDS.keywordB,
          "Customer onboarding automation",
        ),
      ],
      [stale],
    );

    expect(
      projection.visibleItems.map((entry) => entry.item.keywordId),
    ).toEqual([IDS.keywordA, IDS.keywordB]);
    expect(projection.collapsedSupportingKeywordIds).toEqual([]);
    expect(
      projection.relationsByKeywordId.get(IDS.keywordB)?.[0]
        ?.displayState,
    ).toBe("stale");
  });

  it("keeps a supporting row visible when its primary is outside this cursor page", () => {
    const relation = keywordRelation();
    const projection = buildKeywordRelationPageProjection(
      [
        keywordItem(
          IDS.keywordB,
          "Customer onboarding automation",
        ),
      ],
      [relation],
    );

    expect(projection.visibleItems).toHaveLength(1);
    expect(projection.visibleItems[0]?.offPagePrimary).toEqual({
      relationId: IDS.relation,
      keywordId: IDS.keywordA,
      displayKeyword: "Customer onboarding",
    });
    expect(projection.collapsedSupportingKeywordIds).toEqual([]);
  });

  it("builds all four strict CAS decisions from current server facts", () => {
    const relation = {
      ...keywordRelation(),
      currentRelationRevision: 3,
    };
    expect(
      buildKeywordRelationDecisionCommand(
        relation,
        "primary_supporting",
        IDS.keywordB,
        "  Use the longer phrase as primary.  ",
      ),
    ).toEqual({
      expectedRelationRevision: 3,
      candidateId: IDS.candidate,
      decisionKind: "primary_supporting",
      primaryKeywordId: IDS.keywordB,
      supportingKeywordId: IDS.keywordA,
      reason: "Use the longer phrase as primary.",
    });

    for (const decisionKind of [
      "keep_separate",
      "park_secondary",
      "needs_research",
    ] as const) {
      expect(
        buildKeywordRelationDecisionCommand(
          relation,
          decisionKind,
          IDS.keywordA,
          "Customer reviewed this duplicate candidate.",
        ),
      ).toMatchObject({
        expectedRelationRevision: 3,
        candidateId: IDS.candidate,
        decisionKind,
        primaryKeywordId: null,
        supportingKeywordId: null,
      });
    }
  });

  it("refuses stale, invalid-primary, or empty relation decisions", () => {
    const relation = keywordRelation();
    expect(
      buildKeywordRelationDecisionCommand(
        relation,
        "primary_supporting",
        IDS.keywordC,
        "Use a primary.",
      ),
    ).toBeNull();
    expect(
      buildKeywordRelationDecisionCommand(
        relation,
        "keep_separate",
        null,
        " ",
      ),
    ).toBeNull();
    expect(
      buildKeywordRelationDecisionCommand(
        { ...relation, candidateState: "stale" },
        "needs_research",
        null,
        "Needs more evidence.",
      ),
    ).toBeNull();
  });

  it("projects a confirmed Topic tree with real coverage gaps and conflicts", () => {
    const projection = buildTopicMapProjection(
      confirmedTopicWorkspace(),
      topicInsights(),
      IDS.topicChild,
    );

    expect(projection.structureAuthority).toBe("confirmed");
    expect(projection.confirmedInsightRevision).toBe(1);
    expect(projection.selectedNodeId).toBe(IDS.topicChild);
    expect(projection.roots).toHaveLength(1);
    expect(projection.roots[0]).toMatchObject({
      node: { topicNodeId: IDS.topicRoot, label: "Customer onboarding" },
      depth: 0,
      insight: { coverageState: "uncovered", keywordCount: 2 },
      children: [
        {
          node: { topicNodeId: IDS.topicChild },
          depth: 1,
          insight: { coverageState: "conflict", mappedPageCount: 2 },
        },
      ],
    });
    expect(projection.summary).toEqual({
      keywordCount: 4,
      mappedPageCount: 2,
      coverageGapCount: 1,
      conflictCount: 1,
    });
  });

  it("shows draft structure while keeping insights on the confirmed revision", () => {
    const projection = buildTopicMapProjection(
      draftTopicWorkspace(),
      topicInsights(),
      IDS.topicGrandchild,
    );

    expect(projection.structureAuthority).toBe("draft");
    expect(projection.confirmedInsightRevision).toBe(1);
    expect(projection.roots[0]?.node.label).toBe("Customer operations");
    expect(projection.roots[0]?.insight?.label).toBe(
      "Customer onboarding",
    );
    expect(
      projection.roots[0]?.children[0]?.children[0]?.insight,
    ).toBeNull();
    expect(projection.summary.keywordCount).toBe(4);
  });

  it("represents a missing confirmed Topic Model as unavailable instead of zero data", () => {
    const workspace: TopicModelWorkspaceProjection = {
      projectId: IDS.project,
      latestConfirmed: null,
      draft: null,
      generatedAt: "2026-07-21T00:00:00.000Z",
    };
    const insights: GrowthMapTopicModelInsights = {
      projectId: IDS.project,
      topicModelRevision: null,
      nodes: [],
      coverage: {
        availability: "unavailable",
        limitations: ["No confirmed Topic Model is available."],
      },
      generatedAt: "2026-07-21T00:00:00.000Z",
    };

    const projection = buildTopicMapProjection(workspace, insights);
    expect(projection.structureAuthority).toBe("unavailable");
    expect(projection.confirmedInsightRevision).toBeNull();
    expect(projection.roots).toEqual([]);
    expect(projection.selectedNodeId).toBeNull();
    expect(
      buildBeginTopicModelDraftCommand(
        workspace,
        "Create the first governed Topic Map.",
      ),
    ).toEqual({
      expectedLatestConfirmedRevision: 0,
      reason: "Create the first governed Topic Map.",
    });
  });

  it("keeps retired nodes outside the active tree with successor history intact", () => {
    const workspace = draftTopicWorkspace();
    const draft = workspace.draft;
    if (draft === null) throw new Error("Expected a draft fixture.");
    const retiredWorkspace: TopicModelWorkspaceProjection = {
      ...workspace,
      draft: {
        ...draft,
        nodes: [
          draft.nodes[0]!,
          {
            ...draft.nodes[1]!,
            lifecycleState: "superseded",
          },
          topicNode(
            IDS.topicSuccessor,
            IDS.topicRoot,
            "Lifecycle automation",
            2,
          ),
        ],
        successorRelationships: [
          {
            kind: "split_into",
            sourceTopicNodeId: IDS.topicChild,
            successorTopicNodeId: IDS.topicSuccessor,
            topicModelRevision: 2,
          },
        ],
      },
    };

    const projection = buildTopicMapProjection(
      retiredWorkspace,
      topicInsights(),
      IDS.topicChild,
    );
    expect(
      projection.activeNodes.map((node) => node.topicNodeId),
    ).toEqual([IDS.topicRoot, IDS.topicSuccessor]);
    expect(projection.supersededNodes).toMatchObject([
      { topicNodeId: IDS.topicChild, lifecycleState: "superseded" },
    ]);
    expect(projection.selectedNodeId).toBe(IDS.topicChild);
  });

  it("excludes a Topic and its descendants from legal parent choices", () => {
    const draft = draftTopicWorkspace().draft;
    if (draft === null) throw new Error("Expected a draft fixture.");

    expect(topicNodeAllowedParentIds(draft, IDS.topicChild)).toEqual([
      IDS.topicRoot,
    ]);
    expect(topicNodeAllowedParentIds(draft, IDS.topicRoot)).toEqual([]);
  });

  it("builds all six strict Topic intents and exact draft CAS commands", () => {
    const input = {
      parentTopicNodeId: IDS.topicRoot,
      label: "Implementation",
      description: "Setup and adoption.",
      intentEnvelope: ["Commercial"],
    } as const;
    const create = buildTopicNodeCreateIntent(input);
    const update = buildTopicNodeUpdateIntent(IDS.topicChild, {
      parentTopicNodeId: IDS.topicRoot,
      description: "Updated scope.",
      intentEnvelope: ["Informational"],
    });
    const rename = buildTopicNodeRenameIntent(
      IDS.topicChild,
      "Workflow automation",
    );
    const split = buildTopicNodeSplitIntent(IDS.topicChild, [
      { ...input, label: "Implementation" },
      { ...input, label: "Optimization" },
    ]);
    const merge = buildTopicNodeMergeIntent(
      [IDS.topicChild, IDS.topicGrandchild],
      { ...input, label: "Automation platform" },
    );
    const retire = buildTopicNodeRetireIntent(IDS.topicChild);

    expect(
      [create, update, rename, split, merge, retire].map(
        (intent) => intent?.kind,
      ),
    ).toEqual(["create", "update", "rename", "split", "merge", "retire"]);
    expect(retire).toEqual({
      kind: "retire",
      topicNodeId: IDS.topicChild,
      affectedKeywordReviewState: "unreviewed",
    });
    expect(split).toMatchObject({
      affectedKeywordReviewState: "unreviewed",
      successors: [{ label: "Implementation" }, { label: "Optimization" }],
    });
    expect(merge).toMatchObject({
      sourceTopicNodeIds: [IDS.topicChild, IDS.topicGrandchild],
      affectedKeywordReviewState: "unreviewed",
    });

    const workspace = draftTopicWorkspace();
    const draft = workspace.draft;
    if (draft === null || retire === null) {
      throw new Error("Expected valid Topic command fixtures.");
    }
    expect(
      buildBeginTopicModelDraftCommand(
        confirmedTopicWorkspace(),
        "  Begin a reviewed revision.  ",
      ),
    ).toEqual({
      expectedLatestConfirmedRevision: 1,
      reason: "Begin a reviewed revision.",
    });
    expect(
      buildPatchTopicModelDraftCommand(
        draft,
        "  Retire obsolete scope.  ",
        [retire],
      ),
    ).toEqual({
      topicModelRevision: 2,
      expectedEditRevision: 4,
      reason: "Retire obsolete scope.",
      intents: [retire],
    });
    expect(
      buildConfirmTopicModelCommand(
        draft,
        "  Publish the reviewed structure.  ",
      ),
    ).toEqual({
      topicModelRevision: 2,
      expectedEditRevision: 4,
      reason: "Publish the reviewed structure.",
    });
    expect(
      buildPatchTopicModelDraftCommand(draft, " ", [retire]),
    ).toBeNull();
    expect(buildTopicNodeUpdateIntent(IDS.topicChild, {})).toBeNull();
    expect(
      buildTopicNodeSplitIntent(IDS.topicChild, [
        { ...input, label: "Only one successor" },
      ]),
    ).toBeNull();
    expect(
      buildTopicNodeMergeIntent([IDS.topicChild], input),
    ).toBeNull();
  });

  it("keeps Topic Map as Keyword Library Step 0 inside the existing Growth Map", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<TopicMapGateway projectId={projectId} />");
    expect(source).toContain("useGrowthMapTopicModelWorkspace(projectId)");
    expect(source).toContain("useGrowthMapTopicModelInsights(projectId)");
    expect(source).toContain("useBeginGrowthMapTopicModelDraft(projectId)");
    expect(source).toContain("usePatchGrowthMapTopicModelDraft(projectId)");
    expect(source).toContain("useConfirmGrowthMapTopicModelDraft(projectId)");
    for (const action of [
      "buildTopicNodeCreateIntent(",
      "buildTopicNodeUpdateIntent(",
      "buildTopicNodeRenameIntent(",
      "buildTopicNodeSplitIntent(",
      "buildTopicNodeMergeIntent(",
      "buildTopicNodeRetireIntent(",
    ]) {
      expect(source).toContain(action);
    }
    expect(source).toContain('role="tree"');
    expect(source).toContain("handleTopicTreeKeyDown");
    expect(source).toContain('event.key === "ArrowDown"');
    expect(source).toContain('event.key === "ArrowLeft"');
    expect(source).toContain("tabStopNodeId");
    expect(source).toContain(
      "`no-draft:${workspace?.latestConfirmed?.topicModelRevision ?? 0}`",
    );
    expect(source).toContain("draftChangedNotice");
    expect(source).toContain('role="dialog"');
  });

  it("keeps duplicate governance inside the current Keyword Library with an accessible versioned review dialog", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /useCompleteGrowthMapKeywordRelations\(\s*projectId,/,
    );
    expect(source).toMatch(
      /collectAllCursorItems(?:<[^>]+>)?\(/,
    );
    expect(source).toMatch(
      /getGrowthMapKeywordRelations\(projectId,\s*\{\s*keywordIds:\s*normalizedKeywordIds,\s*cursor:\s*pageCursor,\s*limit:\s*100,/,
    );
    expect(source).not.toContain(
      "useGrowthMapKeywordRelations(projectId",
    );
    expect(source).toContain("buildKeywordRelationPageProjection(");
    expect(source).toContain(
      "useRefreshGrowthMapKeywordRelations(projectId)",
    );
    expect(source).toContain(
      "useDecideGrowthMapKeywordRelation(projectId)",
    );
    expect(source).toMatch(
      /filterGrowthMapKeywordEntries\(relationProjection\.visibleItems,\s*\{\s*search: keywordSearch,\s*sourceKind: sourceFilter,/,
    );
    expect(source).toContain("entries={filteredEntries}");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain(
      "buildKeywordRelationDecisionCommand(",
    );
    for (const decisionKind of [
      "primary_supporting",
      "keep_separate",
      "park_secondary",
      "needs_research",
    ]) {
      expect(source).toContain(`"${decisionKind}"`);
    }
    expect(source).toMatch(
      /automaticRelationRefreshProjectRef\.current = projectId;\s+refreshRelations\(\);/,
    );
  });

  it("keeps Keyword Library loading, error, empty, and real rows distinct", () => {
    expect(
      keywordLibraryReadState({ isPending: true, isError: false, itemCount: 0 }),
    ).toBe("loading");
    expect(
      keywordLibraryReadState({ isPending: false, isError: true, itemCount: 0 }),
    ).toBe("error");
    expect(
      keywordLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 0,
        cursor: null,
      }),
    ).toBe("empty");
    expect(
      keywordLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 0,
        cursor: "next-page",
      }),
    ).toBe("cursor_empty");
    expect(
      keywordLibraryReadState({ isPending: false, isError: false, itemCount: 2 }),
    ).toBe("ready");
  });

  it("does not represent unselected, loading, or failed Keyword detail as data", () => {
    expect(
      keywordDetailReadState({
        selectedKeywordId: null,
        isPending: false,
        isError: false,
      }),
    ).toBe("unselected");
    expect(
      keywordDetailReadState({
        selectedKeywordId: "keyword-a",
        isPending: true,
        isError: false,
      }),
    ).toBe("loading");
    expect(
      keywordDetailReadState({
        selectedKeywordId: "keyword-a",
        isPending: false,
        isError: true,
      }),
    ).toBe("error");
    expect(
      keywordDetailReadState({
        selectedKeywordId: "keyword-a",
        isPending: false,
        isError: false,
      }),
    ).toBe("ready");
  });

  it("builds a Keyword review only from the latest confirmed Topic identity and revision", () => {
    const detail = {
      projectId: IDS.project,
      keywordId: IDS.keywordA,
      revision: 7,
    } as GrowthMapKeywordLibraryItem;
    const insights = topicInsights();
    const command = buildKeywordGovernanceReviewCommand(detail, insights, {
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: IDS.topicChild,
      mappingDecision: "existing_page",
      mappedSitePageId: IDS.sitePage,
      reason: "Confirm the governed Topic and canonical landing page.",
    });

    expect(command).toEqual({
      expectedGovernanceRevision: 7,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: IDS.topicChild,
      topicModelRevision: 1,
      mappingDecision: "existing_page",
      mappedSitePageId: IDS.sitePage,
      reason: "Confirm the governed Topic and canonical landing page.",
    });
    expect(
      keywordTopicNeedsConflictConfirmation(insights, IDS.topicChild),
    ).toBe(true);
  });

  it("rejects stale or invented Topic assignments and mappings without a confirmed Topic", () => {
    const detail = {
      projectId: IDS.project,
      keywordId: IDS.keywordA,
      revision: 7,
    } as GrowthMapKeywordLibraryItem;
    const base = {
      status: "approved" as const,
      intent: "commercial",
      buyerStage: "consideration",
      mappingDecision: "new_asset" as const,
      mappedSitePageId: "",
      reason: "Confirm the governed Topic before execution.",
    };

    expect(
      buildKeywordGovernanceReviewCommand(detail, topicInsights(), {
        ...base,
        topicNodeId: IDS.topicGrandchild,
      }),
    ).toBeNull();
    expect(
      buildKeywordGovernanceReviewCommand(detail, null, {
        ...base,
        topicNodeId: "",
      }),
    ).toBeNull();
    expect(
      keywordTopicNeedsConflictConfirmation(
        topicInsights(),
        IDS.topicGrandchild,
      ),
    ).toBe(false);

    expect(
      buildKeywordGovernanceReviewCommand(detail, null, {
        ...base,
        status: "parked",
        topicNodeId: "",
        mappingDecision: "unassigned",
      }),
    ).toEqual({
      expectedGovernanceRevision: 7,
      status: "parked",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: null,
      topicModelRevision: null,
      mappingDecision: "unassigned",
      mappedSitePageId: null,
      reason: "Confirm the governed Topic before execution.",
    });
  });

  it("builds two separate rank series from real points without filling gaps", () => {
    const model = buildKeywordRankChartModel(rankHistory());

    expect(model).not.toBeNull();
    expect(model?.series.map((series) => series.provider)).toEqual([
      "dataforseo",
      "gsc",
    ]);
    expect(model?.series[0]?.points).toHaveLength(2);
    expect(model?.series[1]?.points).toHaveLength(1);
    expect(model?.series[0]?.polylinePoints?.split(" ")).toHaveLength(2);
    expect(model?.series[1]?.polylinePoints).toBeNull();
    expect(
      model?.series.flatMap((series) =>
        series.points.map((point) => point.observedAt),
      ),
    ).toEqual([
      "2026-04-22T00:00:00.000Z",
      "2026-07-21T00:00:00.000Z",
      "2026-06-06T00:00:00.000Z",
    ]);
  });

  it("places a smaller rank visually higher and keeps time gaps proportional", () => {
    const model = buildKeywordRankChartModel(rankHistory());
    const absolute = model?.series[0]?.points ?? [];

    expect(absolute[1]?.value).toBeLessThan(absolute[0]?.value ?? 0);
    expect(absolute[1]?.y).toBeLessThan(absolute[0]?.y ?? 0);
    expect(absolute[0]?.x).toBe(model?.plot.left);
    expect(absolute[1]?.x).toBe(model?.plot.right);
  });

  it("projects verified Change Receipts as independent markers", () => {
    const model = buildKeywordRankChartModel(rankHistory());

    expect(model?.changeMarkers).toEqual([
      expect.objectContaining({
        changeReceiptId: "30000000-0000-4000-8000-000000000001",
        attemptKind: "publish",
        artifactRevision: 3,
      }),
    ]);
    expect(model?.changeMarkers[0]?.x).toBeGreaterThan(model?.plot.left ?? 0);
    expect(model?.changeMarkers[0]?.x).toBeLessThan(model?.plot.right ?? 0);
  });

  it("returns no chart model when no canonical rank observations exist", () => {
    const history = rankHistory();
    expect(
      buildKeywordRankChartModel({
        ...history,
        series: [],
        changeMarkers: [],
        coverage: {
          availability: "unavailable",
          limitations: ["No canonical observations."],
        },
      }),
    ).toBeNull();
  });

  it("keeps Competitor Library loading, error, empty, and real rows distinct", () => {
    expect(
      competitorLibraryReadState({
        isPending: true,
        isError: false,
        itemCount: 0,
      }),
    ).toBe("loading");
    expect(
      competitorLibraryReadState({
        isPending: false,
        isError: true,
        itemCount: 0,
      }),
    ).toBe("error");
    expect(
      competitorLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 0,
        cursor: null,
      }),
    ).toBe("empty");
    expect(
      competitorLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 0,
        cursor: "next-page",
      }),
    ).toBe("cursor_empty");
    expect(
      competitorLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 2,
      }),
    ).toBe("ready");
  });

  it("does not represent unselected, loading, or failed Competitor detail as data", () => {
    expect(
      competitorDetailReadState({
        selectedCompetitorId: null,
        isPending: false,
        isError: false,
      }),
    ).toBe("unselected");
    expect(
      competitorDetailReadState({
        selectedCompetitorId: "competitor-a",
        isPending: true,
        isError: false,
      }),
    ).toBe("loading");
    expect(
      competitorDetailReadState({
        selectedCompetitorId: "competitor-a",
        isPending: false,
        isError: true,
      }),
    ).toBe("error");
    expect(
      competitorDetailReadState({
        selectedCompetitorId: "competitor-a",
        isPending: false,
        isError: false,
      }),
    ).toBe("ready");
  });

  it("selects monitor evidence by the exact Competitor ID without falling back to another row", () => {
    const response = competitorMonitorResponse();

    expect(
      selectCompetitorMonitorItem(response, IDS.competitorB)?.domain,
    ).toBe("beta.example");
    expect(
      selectCompetitorMonitorItem(response, IDS.competitorA)?.domain,
    ).toBe("alpha.example");
    expect(
      selectCompetitorMonitorItem(
        response,
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ),
    ).toBeNull();
    expect(selectCompetitorMonitorItem(response, null)).toBeNull();
  });

  it("keeps honest Competitor monitor states distinct instead of converting missing evidence to zero", () => {
    const ready = competitorMonitorResponse();
    const item = ready.competitors[0]!;

    expect(competitorMonitorDisplayState(ready, item)).toBe("available");
    expect(
      competitorMonitorDisplayState(
        competitorMonitorResponse({ config: null }),
        item,
      ),
    ).toBe("not_configured");
    expect(
      competitorMonitorDisplayState(
        competitorMonitorResponse({
          config: {
            enabled: false,
            frequency: "monthly",
            revision: 2,
            updatedAt: "2026-07-28T08:00:00.000Z",
          },
        }),
        item,
      ),
    ).toBe("paused");
    expect(
      competitorMonitorDisplayState(
        ready,
        competitorMonitorItem({
          collectionState: "collecting",
          evaluationState: "pending",
        }),
      ),
    ).toBe("collecting");
    expect(
      competitorMonitorDisplayState(
        ready,
        competitorMonitorItem({
          collectionState: "never_collected",
          evaluationState: "pending",
        }),
      ),
    ).toBe("awaiting_baseline");
    expect(
      competitorMonitorDisplayState(ready, ready.competitors[1]!),
    ).toBe("baseline");
    expect(
      competitorMonitorDisplayState(
        ready,
        competitorMonitorItem({
          limitation: "Only part of the comparable keyword set was observed.",
        }),
      ),
    ).toBe("partial");
    expect(
      competitorMonitorDisplayState(
        competitorMonitorResponse({
          scope: null,
          availability: "unavailable",
          limitation:
            "The primary Site market and confirmed Topic are unavailable.",
          competitors: [],
        }),
        null,
      ),
    ).toBe("unavailable");
    expect(competitorMonitorDisplayState(ready, null)).toBe("unavailable");
  });

  it("recognizes only stable platform limitations for localized chrome", () => {
    const cases = [
      [
        "No canonical Keyword Library entries are available on this cursor page.",
        "keywordNoEntries",
      ],
      [
        "No canonical Competitor Library entries are available on this cursor page.",
        "competitorNoEntries",
      ],
      [
        "Only the most recent 100 immutable origin occurrences are included; older canonical origin history remains available in storage.",
        "competitorOriginHistoryLimited",
      ],
      [
        "SERP overlap is unavailable because Competitor Library v1 has no canonical SERP-overlap writer.",
        "competitorSerpWriterUnavailable",
      ],
      [
        "AI citation insight is unavailable because Competitor Library v1 has no canonical AI-citation writer.",
        "competitorAiCitationWriterUnavailable",
      ],
      [
        "This Competitor is still a candidate and has not been approved for analysis.",
        "competitorCandidate",
      ],
      [
        "This Competitor has been excluded from the approved analysis scope.",
        "competitorExcluded",
      ],
      [
        "A Product Profile source is approved, but this stable Competitor Library entity is still awaiting its own review.",
        "competitorSourceApprovedReviewPending",
      ],
      [
        "No canonical rank observations are available in the exact trailing 90-day UTC window.",
        "rankNoObservations",
      ],
      [
        "GSC position is a rolling 28-day impression-weighted average, not an absolute SERP rank.",
        "rankGscRollingAverage",
      ],
    ] as const;

    for (const [limitation, key] of cases) {
      expect(growthMapPlatformLimitationKey(limitation)).toBe(key);
    }
    expect(
      growthMapPlatformLimitationKey("Customer-authored limitation text."),
    ).toBeNull();
  });

  it("keeps rank-history loading and error states inside the selected Keyword detail", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "const rankHistoryQuery = useGrowthMapKeywordRankHistory(",
    );
    expect(source).toContain("<KeywordRankHistorySection");
    expect(source).toMatch(
      /const readState = keywordDetailReadState\(\{\s+selectedKeywordId,\s+isPending: detailQuery\.isPending,\s+isError: detailQuery\.isError,/,
    );
    expect(source).not.toMatch(
      /keywordDetailReadState\(\{[\s\S]{0,180}rankHistoryQuery/,
    );
  });

  it("pins the Keyword library and published page evidence while keeping live governance review separate", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "const detailQuery = useGrowthMapKeywordReviewDetail(\n    projectId,\n    selectedKeywordId,",
    );
    expect(source).toContain(
      "function KeywordLibraryPane({\n  projectId,\n  locationSearch,\n  navigation,\n  diagnosticRunId,",
    );
    expect(source).toMatch(
      /useGrowthMapKeywords\(projectId,\s*\{\s*cursor,\s*limit: 50,\s*diagnosticRunId,\s*\}\)/,
    );
    expect(source).toContain(
      "const reviewDetailQuery = useGrowthMapKeywordReviewDetail(",
    );
    expect(source).toContain("projectId,");
    expect(source).toContain("detail.keywordId,");
    expect(source).toContain("open,");
    expect(source).toContain("const reviewDetail = reviewDetailQuery.data?.data ?? null;");
    expect(source).not.toContain("useGrowthMapKeywordReviewDetail(projectId, detail.keywordId, diagnosticRunId");
    expect(source).toContain(
      "buildKeywordGovernanceReviewCommand(\n      reviewDetail,",
    );
    expect(source).not.toContain(
      "buildKeywordGovernanceReviewCommand(\n      detail,",
    );
  });

  it("wires an accessible Competitor review dialog to live governance without mutating the published generation", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("function CompetitorReviewDialog({");
    expect(source).toContain(
      "const reviewDetailQuery = useGrowthMapCompetitorReviewDetail(",
    );
    expect(source).toMatch(
      /useGrowthMapCompetitorReviewDetail\(\s*projectId,\s*detail\.competitorId,\s*open,/,
    );
    expect(source).not.toMatch(
      /useGrowthMapCompetitorReviewDetail\([\s\S]{0,120}diagnosticRunId/,
    );
    expect(source).toContain(
      "const mutation = useReviewGrowthMapCompetitor(",
    );
    expect(source).toContain('data-testid="competitor-review-open"');
    expect(source).toContain('data-testid="competitor-review-form"');
    expect(source).toContain(
      'data-testid="competitor-review-analysis-scope"',
    );
    expect(source).toContain("<CompetitorReviewDialog");
    expect(source).toMatch(
      /const command: ReviewCompetitorRequest = \{\s*expectedRevision: reviewDetail\.revision,\s*name: name\.trim\(\) \|\| null,\s*reviewStatus,\s*relationship: reviewedRelationship,\s*analysisScope: \[\.\.\.reviewedAnalysisScope\],/,
    );
  });

  it("clears inapplicable Competitor governance and blocks incomplete approval", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /if \(nextStatus !== "approved"\) \{\s*setRelationship\(""\);\s*setAnalysisScope\(\[\]\);/,
    );
    expect(source).toMatch(
      /if \(reviewStatus === "approved"\) \{\s*if \(relationship === ""\) \{\s*setLocalError\(t\("validation\.relationshipRequired"\)\);\s*return;/,
    );
    expect(source).toMatch(
      /if \(analysisScope\.length === 0\) \{\s*setLocalError\(t\("validation\.analysisScopeRequired"\)\);\s*return;/,
    );
    expect(source).toContain(
      "COMPETITOR_REVIEW_ANALYSIS_SCOPES.filter((value) =>",
    );
    expect(source).toContain("selected.has(value)");
  });

  it("pins page evidence while reading current Keyword and Competitor libraries", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "const generationQuery = useGrowthMapUrls(projectId, { limit: 1 });",
    );
    expect(source).toContain(
      "const diagnosticRunId = generationQuery.data?.diagnosticRunId ?? null;",
    );
    expect(source).toContain(
      "mode !== \"backlinks\" && generationQuery.isPending",
    );
    expect(source).toContain(
      "diagnosticRunId={diagnosticRunId!}",
    );
    expect(source).toContain(
      "const detailQuery = useGrowthMapUrlDetail(\n    projectId,\n    selectedSitePageId,\n    diagnosticRunId,",
    );
    expect(source).toMatch(
      /useGrowthMapCompetitors\(projectId,\s*\{\s*cursor,\s*limit: 50,\s*diagnosticRunId,\s*\}\)/,
    );
    expect(source).toContain(
      "const detailQuery = useGrowthMapCompetitorReviewDetail(\n    projectId,\n    selectedCompetitorId,",
    );
    expect(source).toContain(
      "const pinnedSitePagesQuery = useGrowthMapUrls(projectId, {\n    limit: 100,\n    diagnosticRunId,",
    );
    expect(source).not.toContain(
      'locationParams.get("diagnosticRunId")',
    );
  });

  it("repairs only an explicit stale Keyword deep link after the cursor page loads", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /navigation\.isPending \|\|\s+locationSearch !== canonicalLocationSearch[\s\S]*?!listQuery\.isSuccess \|\|\s+canonicalRequestedKeywordId === null \|\|\s+canonicalRequestedKeywordId === canonicalSelectedKeywordId/,
    );
    expect(source).toMatch(
      /growthMapLocationHref\(pathname, canonicalLocationSearch, \{\s+selectedKeywordId: canonicalSelectedKeywordId/,
    );
  });

  it("repairs only an explicit stale Competitor deep link after the cursor page loads", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /navigation\.isPending \|\|\s+locationSearch !== canonicalLocationSearch[\s\S]*?!listQuery\.isSuccess \|\|\s+canonicalRequestedCompetitorId === null \|\|\s+canonicalRequestedCompetitorId === canonicalSelectedCompetitorId/,
    );
    expect(source).toMatch(
      /growthMapLocationHref\(pathname, canonicalLocationSearch, \{\s+selectedCompetitorId: canonicalSelectedCompetitorId/,
    );
  });

  it("keys cursor predecessors by the current URL cursor so browser history cannot use a stale stack", () => {
    let predecessors: ReadonlyMap<string, string | null> = new Map();
    predecessors = rememberGrowthMapCursorPredecessor(
      predecessors,
      null,
      "page-2",
    );
    predecessors = rememberGrowthMapCursorPredecessor(
      predecessors,
      "page-2",
      "page-3",
    );

    expect(resolveGrowthMapCursorPredecessor(predecessors, "page-3")).toBe(
      "page-2",
    );
    expect(resolveGrowthMapCursorPredecessor(predecessors, "page-2")).toBeNull();
    expect(
      resolveGrowthMapCursorPredecessor(predecessors, "external-page"),
    ).toBeUndefined();
    expect(resolveGrowthMapCursorPredecessor(predecessors, null)).toBeUndefined();
  });

  it("routes Competitor Library source management to the canonical project Sources page", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('href={`/p/${projectId}/sources`}');
    expect(source).not.toContain("function UnavailableLibrary");
  });

  it("keeps customer-facing source summaries visible and raw library lineage in native disclosures", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('<details className={styles.traceDisclosure}>');
    expect(source).toContain('<summary>{t("viewSourceDetails")}</summary>');
    expect(source).toContain('<summary>{t("viewOriginDetails")}</summary>');
    expect(source).toContain('<summary>{t("viewRecordDetails")}</summary>');
    expect(source).not.toContain("<details open");
    expect(source).not.toContain("truncateId(occurrence.occurrenceId)");
    expect(source).not.toContain("truncateId(evidence.evidenceRefId)");
  });

  it("selects the visible URL that owns an exact Finding deep link", () => {
    expect(
      resolveVisibleSitePageSelectionForFinding(
        null,
        "finding-b",
        [
          { sitePageId: "page-a", findingIds: ["finding-a"] },
          { sitePageId: "page-b", findingIds: ["finding-b"] },
        ],
      ),
    ).toBe("page-b");

    expect(
      resolveVisibleSitePageSelectionForFinding(
        "page-a",
        "finding-b",
        [
          { sitePageId: "page-a", findingIds: ["finding-a"] },
          { sitePageId: "page-b", findingIds: ["finding-b"] },
        ],
      ),
    ).toBe("page-a");
  });

  it("never lets a stale URL selection drive detail outside the visible page", () => {
    expect(
      resolveVisibleSitePageSelection("page-b", ["page-a", "page-b"]),
    ).toBe("page-b");
    expect(
      resolveVisibleSitePageSelection("filtered-out", ["page-a", "page-b"]),
    ).toBe("page-a");
    expect(resolveVisibleSitePageSelection("stale", [])).toBeNull();
  });

  it("clears URL-specific state when leaving the page portfolio", () => {
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "q=pricing&cursor=opaque&selectedSitePageId=page-a",
        { mode: "keywords" },
      ),
    ).toBe("/p/project/growth-map?object=keywords");
  });

  it("clears Keyword-only state and its opaque cursor when switching objects", () => {
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=keywords&cursor=keyword-page&selectedKeywordId=keyword-a",
        { mode: "pages" },
      ),
    ).toBe("/p/project/growth-map?object=pages");
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=keywords&cursor=keyword-page&selectedKeywordId=keyword-a",
        { mode: "competitors" },
      ),
    ).toBe("/p/project/growth-map?object=competitors");
  });

  it("keeps active Competitor state but clears it when switching objects", () => {
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=competitors&cursor=competitor-page&selectedCompetitorId=competitor-a",
        { mode: "competitors" },
      ),
    ).toBe(
      "/p/project/growth-map?object=competitors&cursor=competitor-page&selectedCompetitorId=competitor-a",
    );
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=competitors&cursor=competitor-page&selectedCompetitorId=competitor-a",
        { mode: "keywords" },
      ),
    ).toBe("/p/project/growth-map?object=keywords");
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=competitors&cursor=competitor-page&selectedCompetitorId=competitor-a",
        { mode: "pages" },
      ),
    ).toBe("/p/project/growth-map?object=pages");
  });

  it("selects a metric only by persisted provider and JSON pointer", () => {
    const clicks = metric();
    const position = metric({
      valueSource: {
        kind: "value_json",
        pointer: "/current28d/position",
      },
      value: 12.8,
    });
    expect(
      findMetricObservation([position, clicks], {
        provider: "gsc",
        pointer: "/current28d/clicks",
      }),
    ).toBe(clicks);
    expect(
      findMetricObservation([clicks], {
        provider: "ga4",
        pointer: "/sessions",
      }),
    ).toBeNull();
  });

  it("keeps missing observations missing and preserves a genuinely observed zero", () => {
    expect(metricPresentation(null)).toEqual({ state: "missing" });
    expect(
      metricPresentation(
        metric({
          availability: "unavailable",
          value: null,
          limitation: "GSC did not return page-level metrics.",
        }),
      ),
    ).toEqual({
      state: "unavailable",
      limitation: "GSC did not return page-level metrics.",
    });
    expect(
      metricPresentation(
        metric({
          availability: "partial",
          value: null,
          limitation: "Only a subset of the requested window was returned.",
        }),
      ),
    ).toEqual({
      state: "partial",
      limitation: "Only a subset of the requested window was returned.",
    });
    expect(metricPresentation(metric({ value: 0 }))).toEqual({
      state: "observed",
      value: 0,
      unit: null,
    });
  });

  it("presents only canonical Keyword metric values and preserves their limitations", () => {
    const observedZero = {
      snapshotId: IDS.snapshot,
      observationId: IDS.observation,
      valuePointer: "/valueJson/searchVolume",
      observedAt: "2026-07-21T08:00:00Z",
      freshness: "current",
      limitation: null,
      value: 0,
    } as GrowthMapKeywordNumericMetric;

    expect(keywordMetricPresentation(observedZero, null)).toEqual({
      state: "observed",
      value: 0,
      observedAt: "2026-07-21T08:00:00Z",
      freshness: "current",
      limitation: null,
    });
    expect(
      keywordMetricPresentation(
        null,
        "No canonical Keyword Difficulty observation is available.",
      ),
    ).toEqual({
      state: "unavailable",
      limitation: "No canonical Keyword Difficulty observation is available.",
    });
    expect(
      keywordMetricPresentation(
        { ...observedZero, value: null, freshness: "unknown", limitation: "The source returned no value." },
        null,
      ),
    ).toEqual({
      state: "unavailable",
      limitation: "The source returned no value.",
    });
  });

  it("labels missing and unavailable observations as No data without hiding partial, stale, or zero", () => {
    expect(metricValueLabelKey(metricPresentation(null))).toBe("noData");
    expect(
      metricValueLabelKey(
        metricPresentation(
          metric({
            availability: "unavailable",
            value: null,
            limitation: "GSC did not return page-level metrics.",
          }),
        ),
      ),
    ).toBe("noData");
    expect(
      metricValueLabelKey(
        metricPresentation(
          metric({
            availability: "partial",
            value: null,
            limitation: "Only part of the requested window was returned.",
          }),
        ),
      ),
    ).toBe("coverage.partial");
    expect(
      metricValueLabelKey(
        metricPresentation(metric({ value: 0, freshness: "current" })),
      ),
    ).toBeNull();
    expect(
      metricValueLabelKey(
        metricPresentation(
          metric({
            value: 0,
            freshness: "stale",
            limitation: "The latest connected source is outside the current window.",
          }),
        ),
      ),
    ).toBeNull();
  });

  it("builds exactly one canonical Finding review command without batching supporting IDs", () => {
    const command = buildGrowthMapReviewCommand({
      target: { kind: "finding", finding: reviewFinding() },
      reviewableFindingIds: [IDS.finding, IDS.supportingFinding],
      intent: { reviewState: "confirmed" },
    });

    expect(command).toEqual({
      findingId: IDS.finding,
      body: { reviewState: "confirmed", baseRevision: 0 },
    });
    expect(command).not.toHaveProperty("findingIds");
    expect(command).not.toHaveProperty("primaryFindingId");
    expect(JSON.stringify(command)).not.toContain(IDS.supportingFinding);
  });

  it("never creates a review command for observed Evidence or a non-reviewable Finding", () => {
    expect(
      buildGrowthMapReviewCommand({
        target: { kind: "observed_evidence", evidenceId: IDS.evidence },
        reviewableFindingIds: [IDS.finding],
        intent: { reviewState: "confirmed" },
      }),
    ).toBeNull();
    expect(
      buildGrowthMapReviewCommand({
        target: { kind: "finding", finding: reviewFinding() },
        reviewableFindingIds: [],
        intent: { reviewState: "confirmed" },
      }),
    ).toBeNull();
  });

  it("maps Dismiss and Needs Data to the canonical single-Finding request bodies", () => {
    const target = { kind: "finding", finding: reviewFinding() } as const;
    const reviewableFindingIds = [IDS.finding] as const;

    expect(
      buildGrowthMapReviewCommand({
        target,
        reviewableFindingIds,
        intent: { reviewState: "ignored", reason: "Not applicable here" },
      }),
    ).toEqual({
      findingId: IDS.finding,
      body: {
        reviewState: "ignored",
        baseRevision: 0,
        reason: "Not applicable here",
      },
    });
    expect(
      buildGrowthMapReviewCommand({
        target,
        reviewableFindingIds,
        intent: {
          reviewState: "needs_more_data",
          note: "Connect the missing source",
        },
      }),
    ).toEqual({
      findingId: IDS.finding,
      body: {
        reviewState: "needs_more_data",
        baseRevision: 0,
        note: "Connect the missing source",
      },
    });
  });

  it("preserves canonical conflict code, title, and detail with refresh recovery", () => {
    expect(
      presentGrowthMapReviewProblem(
        apiError("VERSION_CONFLICT", {
          title: "Version conflict",
          detail: "Finding was modified; refetch and retry.",
        }),
        null,
      ),
    ).toEqual({
      kind: "canonical",
      code: "VERSION_CONFLICT",
      title: "Version conflict",
      detail: "Finding was modified; refetch and retry.",
      recovery: "refresh",
      executionRef: null,
    });
  });

  it("uses a validated response executionRef for FINDING_ACTION_ACTIVE recovery", () => {
    expect(
      presentGrowthMapReviewProblem(
        apiError("FINDING_ACTION_ACTIVE", {
          title: "Finding action active",
          detail:
            "Dismiss the linked action in the plan before changing this finding.",
          current: {
            executionRef: {
              actionId: IDS.action,
              artifactIds: [IDS.artifact],
            },
          },
        }),
        null,
      ),
    ).toEqual({
      kind: "canonical",
      code: "FINDING_ACTION_ACTIVE",
      title: "Finding action active",
      detail:
        "Dismiss the linked action in the plan before changing this finding.",
      recovery: "resolve_active_action",
      executionRef: {
        actionId: IDS.action,
        artifactIds: [IDS.artifact],
      },
    });
  });

  it("builds an Action-only recovery link when current exposes a canonical actionId", () => {
    expect(
      presentGrowthMapReviewProblem(
        apiError("FINDING_ACTION_ACTIVE", {
          current: { actionId: IDS.action },
        }),
        null,
      ),
    ).toMatchObject({
      recovery: "resolve_active_action",
      executionRef: {
        actionId: IDS.action,
        artifactIds: [],
      },
    });
  });

  it("falls back to the Finding executionRef when active-action metadata is absent or malformed", () => {
    const fallback = {
      actionId: IDS.action,
      artifactIds: [IDS.artifact],
    };

    expect(
      presentGrowthMapReviewProblem(
        apiError("FINDING_ACTION_ACTIVE", {
          current: {
            executionRef: {
              actionId: "javascript:alert(1)",
              artifactIds: ["not-an-id"],
            },
          },
        }),
        fallback,
      ),
    ).toMatchObject({
      recovery: "resolve_active_action",
      executionRef: fallback,
    });
  });

  it("does not expose raw unknown exceptions or unregistered problem details", () => {
    const rawError = new Error("database-password=do-not-render");
    rawError.stack = "sensitive stack trace";
    expect(presentGrowthMapReviewProblem(rawError, null)).toEqual({
      kind: "fallback",
      recovery: "retry",
      executionRef: null,
    });

    expect(
      presentGrowthMapReviewProblem(
        apiError("UNREGISTERED_REVIEW_FAILURE", {
          title: "raw upstream title",
          detail: "provider-secret-detail",
        }),
        null,
      ),
    ).toEqual({
      kind: "fallback",
      recovery: "retry",
      executionRef: null,
    });
  });

  it("keeps a mutation error visible in every open review form mode", () => {
    const problem = presentGrowthMapReviewProblem(
      apiError("FINDING_ACTION_ACTIVE"),
      null,
    );
    expect(shouldShowGrowthMapReviewError("idle", problem)).toBe(true);
    expect(shouldShowGrowthMapReviewError("dismiss", problem)).toBe(true);
    expect(shouldShowGrowthMapReviewError("needs_more_data", problem)).toBe(
      true,
    );
    expect(shouldShowGrowthMapReviewError("dismiss", null)).toBe(false);
  });

  it("renders mutation feedback outside the idle-only branch and clears it after a successful refresh", () => {
    const source = readFileSync(new URL("./_growth-map.tsx", import.meta.url), "utf8");

    expect(source).not.toContain('mode === "idle" && error !== null');
    expect(source).toContain("shouldShowGrowthMapReviewError(mode, problemError)");
    expect(source).toMatch(
      /await refreshGrowthMap\(\);\s+setError\(null\);\s+setProblemError\(null\);\s+setSaved\(true\);/,
    );
  });

  it("deduplicates source facts by canonical Observation id", () => {
    const clicks = metric();
    const position = metric({
      valueSource: {
        kind: "value_json",
        pointer: "/current28d/position",
      },
      value: 12.8,
    });
    const other = metric({
      observationId: "44444444-4444-4444-8444-444444444444",
      snapshotId: "55555555-5555-4555-8555-555555555555",
      value: 91,
    });

    expect(uniqueMetricSources([clicks, position, other])).toEqual([
      clicks,
      other,
    ]);
  });

  it("only exposes http(s) page URLs as external links", () => {
    expect(safeExternalPageUrl("https://example.com/page")).toBe(
      "https://example.com/page",
    );
    expect(safeExternalPageUrl("http://example.com/page")).toBe(
      "http://example.com/page",
    );
    expect(safeExternalPageUrl("javascript:alert(1)")).toBeNull();
  });
});
