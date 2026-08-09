import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  CompetitorMonitorItem,
  CompetitorMonitorResponse,
  GrowthMapCompetitorLibraryItem,
  GrowthMapCompetitorOriginOccurrence,
  GrowthMapKeywordLibraryItem,
  GrowthMapKeywordRankHistory,
  GrowthMapKeywordRelation,
  GrowthMapInternalLinkMap,
  GrowthMapKeywordNumericMetric,
  GrowthOpportunity,
  GrowthMapTopicModelInsights,
  GrowthMapUrlFinding,
  GrowthMapUrlMetricObservation,
  GrowthMapUrlPortfolioItem,
  TopicModelWorkspaceProjection,
} from "@sf/contracts";
import { ApiError } from "@/lib/api";
import type { Artifact } from "@/lib/api/hooks-studio";
import {
  GROWTH_MAP_OBJECT_MODES,
  GROWTH_MAP_PAGE_VIEWS,
  GROWTH_MAP_DETAIL_STATES,
  GROWTH_MAP_PAGE_TYPES,
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
  buildGrowthMapOpportunityViewItems,
  buildGrowthMapKeywordDeliveryProjection,
  buildGrowthMapTopicClusterView,
  findMetricObservation,
  growthMapLocationHref,
  growthMapOpportunitySelectionId,
  growthMapUncoveredKeywordCountPresentation,
  growthMapPageTypeFilterOptions,
  growthMapPageTypeLabel,
  growthMapPrimaryOpportunity,
  growthMapKeywordReviewPresentation,
  GROWTH_MAP_KEYWORD_REVIEW_ORIGINS,
  growthMapDetailAllowsFindingReview,
  competitorDetailReadState,
  competitorAiCitationDisplay,
  competitorKeywordGapParticipation,
  competitorMonitorDisplayState,
  competitorOrganicOverlapDisplay,
  competitorLibraryReadState,
  competitorPoolEntryReason,
  competitorSharedKeywordDisplay,
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
  normalizeGrowthMapPageView,
  presentGrowthMapReviewProblem,
  resolveVisibleGrowthMapOpportunitySelection,
  resolveVisibleGrowthMapClusterSelection,
  resolveVisibleGrowthMapUrlSelection,
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
  actionB: "66666666-6666-4666-8666-666666666667",
  artifact: "77777777-7777-4777-8777-777777777777",
  artifactB: "77777777-7777-4777-8777-777777777778",
  artifactC: "77777777-7777-4777-8777-777777777779",
  artifactD: "77777777-7777-4777-8777-777777777780",
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
    sharedKeywordInsight: {
      availability: "unavailable",
      value: null,
      limitation: "Shared keyword counts are unavailable.",
    },
    coverage: {
      availability: "available",
      limitations: [],
    },
    ...overrides,
  } as GrowthMapCompetitorLibraryItem;
}

function productProfileOrigin(): GrowthMapCompetitorOriginOccurrence {
  return {
    occurrenceId: IDS.snapshot,
    observedAt: "2026-07-28T08:00:00.000Z",
    originKind: "product_profile",
    productProfileId: IDS.project,
    profileVersion: 3,
    candidateId: IDS.candidate,
    fieldProvenancePath: "/competitorCandidates/0",
    evidenceRefs: [],
  };
}

function manualOrigin(): GrowthMapCompetitorOriginOccurrence {
  return {
    occurrenceId: IDS.observation,
    observedAt: null,
    originKind: "manual",
    manualEntryId: IDS.evidence,
    evidenceRefs: [],
  };
}

function serpOverlapOrigin(): GrowthMapCompetitorOriginOccurrence {
  return {
    occurrenceId: IDS.relation,
    observedAt: "2026-07-28T08:00:00.000Z",
    originKind: "serp_overlap",
    snapshotId: IDS.snapshot,
    observationId: IDS.observation,
    evidenceRefs: [],
  };
}

function csvKeywordGapOrigin(): GrowthMapCompetitorOriginOccurrence {
  return {
    occurrenceId: IDS.finding,
    observedAt: null,
    originKind: "csv_keyword_gap",
    snapshotId: IDS.snapshot,
    observationId: IDS.observation,
    sourcePointer: "/valueJson/competitorDomain",
    importPreviewId: IDS.candidate,
    evidenceRefs: [],
  };
}

function availableSerpOverlap(): GrowthMapCompetitorLibraryItem["serpOverlap"] {
  return {
    availability: "available",
    value: 0.17,
    snapshotId: IDS.snapshot,
    observationId: IDS.observation,
    valuePointer: "/valueJson/serpOverlap",
    observedAt: "2026-07-28T08:00:00.000Z",
    limitation: null,
  };
}

function availableAiCitationInsight(
  overrides: Partial<
    Extract<
      GrowthMapCompetitorLibraryItem["aiCitationInsight"],
      { availability: "available" }
    >
  > = {},
): Extract<
  GrowthMapCompetitorLibraryItem["aiCitationInsight"],
  { availability: "available" }
> {
  return {
    availability: "available",
    value: 8,
    attemptedQueries: 20,
    observedQueries: 20,
    unavailableQueries: 0,
    cohortCoverage: "complete",
    querySetHash: "a".repeat(64),
    platform: "chat_gpt",
    model: "gpt-5",
    marketCode: "US",
    languageTag: "en-US",
    snapshotId: IDS.snapshot,
    observationId: IDS.observation,
    valuePointer: "/valueJson/citedQueries",
    observedAt: "2026-07-28T08:00:00.000Z",
    limitation: null,
    ...overrides,
  };
}

const SHARED_KEYWORD_SCOPE_LIMITATION =
  "Count of shared ranking keywords over the top-20 window for one market and one search language.";

function availableSharedKeywordInsight(): GrowthMapCompetitorLibraryItem["sharedKeywordInsight"] {
  return {
    availability: "available",
    value: 17,
    snapshotId: IDS.snapshot,
    observationId: IDS.observation,
    valuePointer: "/valueJson/intersections",
    observedAt: "2026-07-28T08:00:00.000Z",
    limitation: SHARED_KEYWORD_SCOPE_LIMITATION,
  };
}

function keywordRelation(): GrowthMapKeywordRelation {
  const participant = (keywordId: string, displayKeyword: string) => ({
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
    keywordB: participant(IDS.keywordB, "Customer onboarding automation"),
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
        topicNode(IDS.topicChild, IDS.topicRoot, "Onboarding automation"),
      ],
      aliases: [],
      successorRelationships: [],
      createdAt: "2026-07-20T00:00:00.000Z",
      createdBy: IDS.actor,
      state: "confirmed",
      confirmedAt: "2026-07-21T00:00:00.000Z",
      confirmedBy: IDS.actor,
      confirmationMode: "user",
      contentHash: "c".repeat(64),
      generationSummary: null,
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
        topicNode(IDS.topicRoot, null, "Customer operations", 2),
        topicNode(IDS.topicChild, IDS.topicRoot, "Onboarding automation", 2),
        topicNode(IDS.topicGrandchild, IDS.topicChild, "Workflow templates", 2),
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

function growthOpportunity(
  overrides: Record<string, unknown> = {},
): GrowthOpportunity {
  return {
    opportunityKey: "opportunity:customer-onboarding",
    title: "Improve customer onboarding",
    workShape: "improve",
    primaryTarget: "url",
    targetRef: "https://example.test/customer-onboarding/",
    evidenceSummary: [
      {
        traceKind: "observation",
        observationId: IDS.observation,
        snapshotId: IDS.snapshot,
        sourceProvider: "gsc",
        availability: "available",
        support: "supports",
        observedAt: "2026-07-21T08:00:00Z",
        freshness: "current",
        claim: "Demand is observed.",
        limitation: "This is a bounded test observation.",
      },
    ],
    searchQueries: [],
    generativeQueries: [],
    competitorRefs: [],
    currentOwnedAsset: null,
    supportingFindingIds: [],
    lenses: ["search_ai_visibility"],
    coverageAndLimitations: [],
    readiness: "candidate",
    ...overrides,
  } as GrowthOpportunity;
}

function artifact(
  id: string,
  actionId: string,
  artifactType: Artifact["artifactType"],
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id,
    actionId,
    artifactType,
    status: "ready",
    generationMode: "structured_llm",
    outputLocale: "en",
    currentRevision: 2,
    validationState: "valid",
    current: null,
    activeRun: null,
    adoption: null,
    createdAt: "2026-08-09T08:00:00.000Z",
    updatedAt: "2026-08-09T09:00:00.000Z",
    ...overrides,
  };
}

describe("Growth Map view model", () => {
  it("projects every current content delivery only through the exact mapped SitePage and owned-asset intersection", () => {
    const keyword = keywordItem(IDS.keywordA, "customer onboarding", {
      cluster: {
        clusterId: IDS.topicChild,
        name: "Customer onboarding",
        topicModelRevision: 1,
      } as GrowthMapKeywordLibraryItem["cluster"],
      mappedTarget: {
        kind: "existing_page",
        reviewState: "approved",
        revision: 3,
        reason: "Approved page mapping.",
        sitePageId: IDS.sitePage,
        normalizedUrl: "https://example.test/customer-onboarding/",
      },
    });
    const page = urlPortfolioItem(IDS.sitePage, {
      normalizedUrl: "https://example.test/customer-onboarding/",
    });
    const contentBrief = growthOpportunity({
      opportunityKey: "content-brief-opportunity",
      title: "A content brief",
      currentOwnedAsset: {
        sitePageId: IDS.sitePage,
        snapshotId: IDS.snapshot,
        url: page.normalizedUrl,
        suitableForIntent: true,
      },
      readiness: "confirmed",
      primaryFindingId: IDS.finding,
      primaryRule: { ruleId: "CONTENT-GAP-006", ruleVersion: 1 },
      primaryFindingSeverity: "high",
      executionPreview: null,
      actionId: IDS.action,
      action: {
        actionId: IDS.action,
        findingId: IDS.finding,
        status: "in_progress",
        artifactType: "content_brief",
      },
    });
    const metadataRewrite = growthOpportunity({
      opportunityKey: "metadata-opportunity",
      title: "B metadata rewrite",
      currentOwnedAsset: {
        sitePageId: IDS.sitePage,
        snapshotId: IDS.snapshot,
        url: page.normalizedUrl,
        suitableForIntent: true,
      },
      readiness: "confirmed",
      primaryFindingId: IDS.supportingFinding,
      primaryRule: { ruleId: "SEARCH-CTR-004", ruleVersion: 1 },
      primaryFindingSeverity: "high",
      executionPreview: null,
      actionId: IDS.actionB,
      action: {
        actionId: IDS.actionB,
        findingId: IDS.supportingFinding,
        status: "planned",
        artifactType: "metadata_rewrite",
      },
    });
    const projection = buildGrowthMapKeywordDeliveryProjection({
      keyword,
      publishedDiagnosticRunId: IDS.snapshot,
      urls: [page],
      opportunities: [metadataRewrite, contentBrief],
      artifacts: [
        artifact(
          IDS.artifactC,
          IDS.action,
          "english_blog_draft",
          { status: "draft", currentRevision: 4 },
        ),
        artifact(IDS.artifactB, IDS.actionB, "metadata_rewrite"),
        artifact(IDS.artifact, IDS.action, "content_brief"),
        artifact(IDS.artifactD, IDS.action, "technical_ticket"),
      ],
    });

    expect(projection).toMatchObject({
      kind: "ready",
      publishedDiagnosticRunId: IDS.snapshot,
      mappedPage: { sitePageId: IDS.sitePage },
      artifactCount: 3,
    });
    if (projection.kind !== "ready") return;
    expect(projection.opportunities.map((item) => item.id)).toEqual([
      IDS.finding,
      IDS.supportingFinding,
    ]);
    expect(
      projection.opportunities[0]?.artifacts.map((item) => ({
        id: item.id,
        type: item.artifactType,
        status: item.status,
        revision: item.currentRevision,
      })),
    ).toEqual([
      {
        id: IDS.artifact,
        type: "content_brief",
        status: "ready",
        revision: 2,
      },
      {
        id: IDS.artifactC,
        type: "english_blog_draft",
        status: "draft",
        revision: 4,
      },
    ]);
    expect(projection.opportunities[0]?.executionRef).toEqual({
      actionId: IDS.action,
      artifactIds: [IDS.artifact, IDS.artifactC],
    });
    expect(projection.opportunities[1]?.executionRef).toEqual({
      actionId: IDS.actionB,
      artifactIds: [IDS.artifactB],
    });
  });

  it("orders current Artifacts before confirmed Actions awaiting generation and reviewable previews", () => {
    const keyword = keywordItem(IDS.keywordA, "customer onboarding", {
      mappedTarget: {
        kind: "existing_page",
        reviewState: "approved",
        revision: 3,
        reason: "Approved page mapping.",
        sitePageId: IDS.sitePage,
        normalizedUrl: "https://example.test/customer-onboarding/",
      },
    });
    const page = urlPortfolioItem(IDS.sitePage);
    const ownedAsset = {
      sitePageId: IDS.sitePage,
      snapshotId: IDS.snapshot,
      url: page.normalizedUrl,
      suitableForIntent: true,
    };
    const reviewable = growthOpportunity({
      title: "A reviewable preview",
      currentOwnedAsset: ownedAsset,
      readiness: "reviewable",
      primaryFindingId: IDS.finding,
      primaryRule: { ruleId: "CONTENT-GAP-006", ruleVersion: 1 },
      primaryFindingSeverity: "critical",
      executionPreview: {
        artifactType: "content_brief",
        contentLocale: "en",
        title: "Preview",
        description: "Review first.",
        expectedOutcome: "A reviewed content path.",
      },
    });
    const awaitingGeneration = growthOpportunity({
      title: "B confirmed Action",
      currentOwnedAsset: ownedAsset,
      readiness: "confirmed",
      primaryFindingId: IDS.supportingFinding,
      primaryRule: { ruleId: "SEARCH-CTR-004", ruleVersion: 1 },
      primaryFindingSeverity: "high",
      executionPreview: null,
      actionId: IDS.actionB,
      action: {
        actionId: IDS.actionB,
        findingId: IDS.supportingFinding,
        status: "planned",
        artifactType: "metadata_rewrite",
      },
    });
    const ready = growthOpportunity({
      title: "C current Artifact",
      currentOwnedAsset: ownedAsset,
      readiness: "confirmed",
      primaryFindingId: IDS.internalLinkFinding,
      primaryRule: { ruleId: "CONTENT-GAP-006", ruleVersion: 1 },
      primaryFindingSeverity: "low",
      executionPreview: null,
      actionId: IDS.action,
      action: {
        actionId: IDS.action,
        findingId: IDS.internalLinkFinding,
        status: "in_progress",
        artifactType: "content_brief",
      },
    });

    const projection = buildGrowthMapKeywordDeliveryProjection({
      keyword,
      publishedDiagnosticRunId: IDS.snapshot,
      urls: [page],
      opportunities: [reviewable, awaitingGeneration, ready],
      artifacts: [artifact(IDS.artifact, IDS.action, "content_brief")],
    });

    expect(projection.kind).toBe("ready");
    if (projection.kind !== "ready") return;
    expect(
      projection.opportunities.map((item) => [
        item.opportunity.readiness,
        item.artifacts.length,
      ]),
    ).toEqual([
      ["confirmed", 1],
      ["confirmed", 0],
      ["reviewable", 0],
    ]);
  });

  it("never promotes a Topic peer, primary-Finding page, or technical output into Keyword delivery", () => {
    const keyword = keywordItem(IDS.keywordA, "customer onboarding", {
      cluster: {
        clusterId: IDS.topicChild,
        name: "Customer onboarding",
        topicModelRevision: 1,
      } as GrowthMapKeywordLibraryItem["cluster"],
      mappedTarget: {
        kind: "existing_page",
        reviewState: "approved",
        revision: 3,
        reason: "Approved page mapping.",
        sitePageId: IDS.sitePage,
        normalizedUrl: "https://example.test/customer-onboarding/",
      },
    });
    const mappedPage = urlPortfolioItem(IDS.sitePage, {
      normalizedUrl: "https://example.test/customer-onboarding/",
      findingIds: [IDS.finding],
      clusterKey: "customer-onboarding",
    });
    const topicPeerPage = urlPortfolioItem(IDS.sitePageB, {
      normalizedUrl: "https://example.test/onboarding-checklist/",
      clusterKey: "customer-onboarding",
    });
    const findingOnly = growthOpportunity({
      title: "Finding target without owned asset",
      readiness: "reviewable",
      primaryFindingId: IDS.finding,
      primaryRule: { ruleId: "CONTENT-GAP-006", ruleVersion: 1 },
      primaryFindingSeverity: "high",
      executionPreview: {
        artifactType: "content_brief",
        contentLocale: "en",
        title: "Brief",
        description: "A bounded brief preview.",
        expectedOutcome: "Publish the page.",
      },
    });
    const topicPeer = growthOpportunity({
      title: "Same Topic, different owned page",
      currentOwnedAsset: {
        sitePageId: IDS.sitePageB,
        snapshotId: IDS.snapshot,
        url: topicPeerPage.normalizedUrl,
        suitableForIntent: true,
      },
      readiness: "reviewable",
      primaryFindingId: IDS.supportingFinding,
      primaryRule: { ruleId: "CONTENT-GAP-006", ruleVersion: 1 },
      primaryFindingSeverity: "high",
      executionPreview: {
        artifactType: "content_brief",
        contentLocale: "en",
        title: "Peer brief",
        description: "A different page.",
        expectedOutcome: "Publish the peer page.",
      },
    });
    const technical = growthOpportunity({
      title: "Technical work on the mapped page",
      currentOwnedAsset: {
        sitePageId: IDS.sitePage,
        snapshotId: IDS.snapshot,
        url: mappedPage.normalizedUrl,
        suitableForIntent: true,
      },
      readiness: "confirmed",
      primaryFindingId: IDS.supportingFinding,
      primaryRule: { ruleId: "TECH-HTTP-001", ruleVersion: 1 },
      primaryFindingSeverity: "high",
      executionPreview: null,
      actionId: IDS.action,
      action: {
        actionId: IDS.action,
        findingId: IDS.supportingFinding,
        status: "planned",
        artifactType: "technical_ticket",
      },
    });

    expect(
      buildGrowthMapKeywordDeliveryProjection({
        keyword,
        publishedDiagnosticRunId: IDS.snapshot,
        urls: [mappedPage, topicPeerPage],
        opportunities: [findingOnly, topicPeer, technical],
        artifacts: [artifact(IDS.artifact, IDS.action, "technical_ticket")],
      }),
    ).toEqual({ kind: "none", reason: "no_content_opportunity" });
  });

  it("fails Keyword delivery closed when mapping, run, or complete inventories are unavailable", () => {
    const mappedKeyword = keywordItem(IDS.keywordA, "customer onboarding", {
      mappedTarget: {
        kind: "existing_page",
        reviewState: "approved",
        revision: 3,
        reason: "Approved page mapping.",
        sitePageId: IDS.sitePage,
        normalizedUrl: "https://example.test/customer-onboarding/",
      },
    });
    const base = {
      keyword: mappedKeyword,
      publishedDiagnosticRunId: IDS.snapshot,
      urls: [urlPortfolioItem(IDS.sitePage)],
      opportunities: [] as readonly GrowthOpportunity[],
      artifacts: [] as readonly Artifact[],
    };

    expect(
      buildGrowthMapKeywordDeliveryProjection({
        ...base,
        publishedDiagnosticRunId: null,
      }),
    ).toEqual({ kind: "none", reason: "published_run_unavailable" });
    expect(
      buildGrowthMapKeywordDeliveryProjection({ ...base, urls: null }),
    ).toEqual({ kind: "none", reason: "url_inventory_unavailable" });
    expect(
      buildGrowthMapKeywordDeliveryProjection({
        ...base,
        opportunities: null,
      }),
    ).toEqual({ kind: "none", reason: "opportunity_inventory_unavailable" });
    expect(
      buildGrowthMapKeywordDeliveryProjection({ ...base, artifacts: null }),
    ).toEqual({ kind: "none", reason: "artifact_inventory_unavailable" });
    expect(
      buildGrowthMapKeywordDeliveryProjection({
        ...base,
        keyword: keywordItem(IDS.keywordA, "unassigned"),
      }),
    ).toEqual({ kind: "none", reason: "keyword_unassigned" });
    expect(
      buildGrowthMapKeywordDeliveryProjection({
        ...base,
        keyword: keywordItem(IDS.keywordA, "new asset", {
          mappedTarget: {
            kind: "new_asset",
            reviewState: "approved",
            revision: 2,
            reason: "Create a new asset.",
          },
        }),
      }),
    ).toEqual({ kind: "none", reason: "keyword_new_asset" });
    expect(
      buildGrowthMapKeywordDeliveryProjection({
        ...base,
        urls: [urlPortfolioItem(IDS.sitePageB)],
      }),
    ).toEqual({ kind: "none", reason: "mapped_page_unavailable" });
    expect(
      buildGrowthMapKeywordDeliveryProjection({
        ...base,
        urls: [
          urlPortfolioItem(IDS.sitePage, {
            diagnosticRunId: IDS.observation,
          }),
        ],
      }),
    ).toEqual({ kind: "none", reason: "inventory_scope_mismatch" });
  });

  it("projects Opportunity rows from the complete URL inventory with the primary Finding severity as priority", () => {
    const reviewable = growthOpportunity({
      opportunityKey: "reviewable-opportunity",
      title: "Critical onboarding issue",
      readiness: "reviewable",
      primaryFindingId: IDS.finding,
      primaryRule: { ruleId: "SEARCH-CTR-004", ruleVersion: 1 },
      primaryFindingSeverity: "critical",
      executionPreview: null,
    });
    const candidate = growthOpportunity({
      opportunityKey: "candidate-opportunity",
      title: "Candidate content gap",
      currentOwnedAsset: {
        sitePageId: IDS.sitePageC,
        snapshotId: IDS.snapshot,
        url: "https://example.test/exact-owned-asset/",
        suitableForIntent: true,
      },
    });
    const confirmed = growthOpportunity({
      opportunityKey: "confirmed-opportunity",
      title: "Confirmed but ambiguous priority",
      readiness: "confirmed",
      primaryFindingId: IDS.supportingFinding,
      primaryRule: { ruleId: "SEARCH-CTR-004", ruleVersion: 1 },
      primaryFindingSeverity: "high",
      executionPreview: null,
      actionId: IDS.action,
      action: {
        actionId: IDS.action,
        findingId: IDS.supportingFinding,
        status: "planned",
        artifactType: "content_brief",
      },
    });
    const exactPriority = {
      availability: "available" as const,
      value: "critical" as const,
      basis: { findingIds: [IDS.finding] },
      limitation: null,
    };
    const portfolio = [
      urlPortfolioItem(IDS.sitePage, {
        normalizedUrl: "https://example.test/customer-onboarding/",
        findingIds: [IDS.finding],
        priority: exactPriority as GrowthMapUrlPortfolioItem["priority"],
      }),
      urlPortfolioItem(IDS.sitePageB, {
        normalizedUrl: "https://example.test/customer-onboarding-alt/",
        findingIds: [IDS.finding],
        priority: exactPriority as GrowthMapUrlPortfolioItem["priority"],
      }),
      urlPortfolioItem(IDS.sitePageC, {
        normalizedUrl: "https://example.test/exact-owned-asset/",
        findingIds: [IDS.supportingFinding, IDS.internalLinkFinding],
        priority: {
          availability: "available",
          value: "high",
          basis: {
            findingIds: [IDS.supportingFinding, IDS.internalLinkFinding],
          },
          limitation: null,
        } as GrowthMapUrlPortfolioItem["priority"],
      }),
    ];

    const projected = buildGrowthMapOpportunityViewItems(
      [confirmed, candidate, reviewable],
      portfolio,
    );

    expect(projected.map((item) => item.id)).toEqual([
      IDS.finding,
      IDS.supportingFinding,
      "candidate-opportunity",
    ]);
    expect(projected[0]).toMatchObject({
      id: IDS.finding,
      priority: { availability: "available", value: "critical" },
    });
    expect(projected[0]?.targetPages.map((page) => page.sitePageId)).toEqual([
      IDS.sitePage,
      IDS.sitePageB,
    ]);
    expect(projected[1]).toMatchObject({
      id: IDS.supportingFinding,
      priority: { availability: "available", value: "high" },
    });
    expect(projected[2]).toMatchObject({
      id: "candidate-opportunity",
      priority: { availability: "unavailable", value: null },
    });
    expect(projected[2]?.targetPages.map((page) => page.sitePageId)).toEqual([
      IDS.sitePageC,
    ]);
    expect(growthMapOpportunitySelectionId(reviewable)).toBe(IDS.finding);
    expect(growthMapOpportunitySelectionId(candidate)).toBe(
      "candidate-opportunity",
    );
  });

  it("keeps the primary-Finding severity as priority after confirmation and never ranks candidates", () => {
    const confirmedOpportunity = growthOpportunity({
      readiness: "confirmed",
      primaryFindingId: IDS.finding,
      primaryRule: { ruleId: "SEARCH-CTR-004", ruleVersion: 1 },
      primaryFindingSeverity: "medium",
      executionPreview: null,
      actionId: IDS.action,
      action: {
        actionId: IDS.action,
        findingId: IDS.finding,
        status: "planned",
        artifactType: "content_brief",
      },
    });
    // Confirmed Findings drop out of url_opportunity_rank.v1, so the URL no
    // longer carries the Finding in its priority basis; the Opportunity must
    // keep its own severity-based priority regardless.
    const portfolio = [
      urlPortfolioItem(IDS.sitePage, {
        findingIds: [IDS.finding],
        priority: {
          availability: "unavailable",
          value: null,
          basis: { findingIds: [] },
          limitation: "No reviewable Finding remains on this URL.",
        } as GrowthMapUrlPortfolioItem["priority"],
      }),
    ];

    expect(
      buildGrowthMapOpportunityViewItems([confirmedOpportunity], portfolio)[0]
        ?.priority,
    ).toMatchObject({ availability: "available", value: "medium" });

    expect(
      buildGrowthMapOpportunityViewItems([growthOpportunity()], portfolio)[0]
        ?.priority,
    ).toMatchObject({ availability: "unavailable", value: null });
  });

  it("falls stale Opportunity selections back to the first visible item", () => {
    expect(
      resolveVisibleGrowthMapOpportunitySelection("opportunity-b", [
        "opportunity-a",
        "opportunity-b",
      ]),
    ).toBe("opportunity-b");
    expect(
      resolveVisibleGrowthMapOpportunitySelection("stale", [
        "opportunity-a",
        "opportunity-b",
      ]),
    ).toBe("opportunity-a");
    expect(resolveVisibleGrowthMapOpportunitySelection(null, [])).toBeNull();
  });

  it("resolves URL and Topic selections only inside their visible complete inventory", () => {
    expect(
      resolveVisibleGrowthMapUrlSelection(IDS.sitePageB, [
        IDS.sitePage,
        IDS.sitePageB,
      ]),
    ).toBe(IDS.sitePageB);
    expect(
      resolveVisibleGrowthMapUrlSelection("stale", [
        IDS.sitePage,
        IDS.sitePageB,
      ]),
    ).toBe(IDS.sitePage);
    expect(
      resolveVisibleGrowthMapClusterSelection(IDS.topicChild, [
        IDS.topicRoot,
        IDS.topicChild,
      ]),
    ).toBe(IDS.topicChild);
    expect(
      resolveVisibleGrowthMapClusterSelection("stale", [
        IDS.topicRoot,
        IDS.topicChild,
      ]),
    ).toBe(IDS.topicRoot);
  });

  it("builds Topic rows only from the complete pinned URL, Keyword, Opportunity, and confirmed-revision inventories", () => {
    const workspace = confirmedTopicWorkspace();
    if (workspace.latestConfirmed === null) throw new Error("fixture");
    const confirmed = {
      ...workspace.latestConfirmed,
      aliases: [
        {
          aliasId: IDS.relation,
          projectId: IDS.project,
          topicNodeId: IDS.topicChild,
          clusterKey: "onboarding-automation",
          validFromTopicModelRevision: 1,
          validThroughTopicModelRevision: null,
          isCurrent: true,
        },
      ],
    };
    const observedVolume = (value: number): GrowthMapKeywordNumericMetric => ({
      snapshotId: IDS.snapshot,
      observationId: IDS.observation,
      valuePointer: "/valueJson/searchVolume",
      observedAt: "2026-07-21T08:00:00.000Z",
      freshness: "current",
      limitation: null,
      value,
    });
    const keywordA = keywordItem(IDS.keywordA, "onboarding automation", {
      cluster: {
        clusterId: IDS.topicChild,
        name: "Onboarding automation",
        topicModelRevision: 1,
      } as GrowthMapKeywordLibraryItem["cluster"],
      mappedTarget: {
        kind: "existing_page",
        reviewState: "approved",
        revision: 2,
        reason: "Confirmed page mapping.",
        sitePageId: IDS.sitePage,
        normalizedUrl: "https://example.test/customer-onboarding/",
      },
      metrics: {
        ...keywordItem(IDS.keywordA, "onboarding automation").metrics,
        volume: observedVolume(1_300),
      },
    });
    const keywordB = keywordItem(IDS.keywordB, "automate onboarding", {
      cluster: {
        clusterId: IDS.topicChild,
        name: "Onboarding automation",
        topicModelRevision: 1,
      } as GrowthMapKeywordLibraryItem["cluster"],
      mappedTarget: {
        kind: "existing_page",
        reviewState: "approved",
        revision: 2,
        reason: "Confirmed page mapping.",
        sitePageId: IDS.sitePageB,
        normalizedUrl: "https://example.test/onboarding-workflows/",
      },
      metrics: {
        ...keywordItem(IDS.keywordB, "automate onboarding").metrics,
        volume: observedVolume(720),
      },
    });
    const urlA = urlPortfolioItem(IDS.sitePage, {
      normalizedUrl: "https://example.test/customer-onboarding/",
      clusterKey: "onboarding-automation",
      findingIds: [],
    });
    const urlB = urlPortfolioItem(IDS.sitePageB, {
      normalizedUrl: "https://example.test/onboarding-workflows/",
      clusterKey: "onboarding-automation",
      findingIds: [IDS.finding],
    });
    const projection = buildGrowthMapTopicClusterView({
      diagnosticRunId: IDS.snapshot,
      keywordDiagnosticRunId: IDS.snapshot,
      workspace: { ...workspace, latestConfirmed: confirmed },
      insights: topicInsights(),
      urls: [urlA, urlB],
      keywords: [keywordA, keywordB],
      opportunities: [
        growthOpportunity({
          opportunityKey: "topic-opportunity",
          readiness: "reviewable",
          primaryFindingId: IDS.finding,
          primaryFindingSeverity: "high",
          executionPreview: null,
        }),
      ],
    });

    expect(projection.kind).toBe("ready");
    if (projection.kind !== "ready") return;
    expect(projection.topicModelRevision).toBe(1);
    expect(projection.rows.find((row) => row.topicNodeId === IDS.topicChild)).toMatchObject({
      label: "Onboarding automation",
      depth: 1,
      keywordCount: 2,
      searchVolume: {
        value: 2020,
        observedKeywordCount: 2,
        totalKeywordCount: 2,
        limitation: null,
      },
      coverageState: "conflict",
      pageCount: 2,
      primaryCta: {
        availability: "unavailable",
        value: null,
      },
      primaryPage: { sitePageId: IDS.sitePageB },
      topOpportunity: { id: IDS.finding },
    });
    expect(
      projection.rows.find((row) => row.topicNodeId === IDS.topicRoot),
    ).toMatchObject({
      keywordCount: 0,
      searchVolume: {
        value: null,
        observedKeywordCount: 0,
        totalKeywordCount: 0,
        limitation: "unavailable",
      },
    });
  });

  it("fails Topic aggregation closed on Diagnostic Run, Topic revision, or stable Topic-reference drift", () => {
    const base = {
      diagnosticRunId: IDS.snapshot,
      keywordDiagnosticRunId: IDS.snapshot,
      workspace: confirmedTopicWorkspace(),
      insights: topicInsights(),
      urls: [urlPortfolioItem(IDS.sitePage)],
      keywords: [] as readonly GrowthMapKeywordLibraryItem[],
      opportunities: [] as readonly GrowthOpportunity[],
    };
    expect(
      buildGrowthMapTopicClusterView({
        ...base,
        keywordDiagnosticRunId: IDS.observation,
      }),
    ).toMatchObject({ kind: "unavailable", reason: "diagnostic_run_mismatch" });
    expect(
      buildGrowthMapTopicClusterView({
        ...base,
        urls: [
          urlPortfolioItem(IDS.sitePage, {
            diagnosticRunId: IDS.observation,
          }),
        ],
      }),
    ).toMatchObject({ kind: "unavailable", reason: "diagnostic_run_mismatch" });
    expect(
      buildGrowthMapTopicClusterView({
        ...base,
        insights: { ...topicInsights(), topicModelRevision: 2 },
      }),
    ).toMatchObject({ kind: "unavailable", reason: "topic_revision_mismatch" });
    expect(
      buildGrowthMapTopicClusterView({
        ...base,
        keywords: [
          keywordItem(IDS.keywordA, "stale topic revision", {
            cluster: {
              clusterId: IDS.topicChild,
              name: "Onboarding automation",
              topicModelRevision: 2,
            } as GrowthMapKeywordLibraryItem["cluster"],
          }),
        ],
      }),
    ).toMatchObject({ kind: "unavailable", reason: "topic_revision_mismatch" });
    expect(
      buildGrowthMapTopicClusterView({
        ...base,
        keywords: [
          keywordItem(IDS.keywordA, "unknown topic", {
            cluster: {
              clusterId: IDS.topicGrandchild,
              name: "Unknown",
              topicModelRevision: 1,
            } as GrowthMapKeywordLibraryItem["cluster"],
          }),
        ],
      }),
    ).toMatchObject({ kind: "unavailable", reason: "topic_reference_mismatch" });
  });

  it("normalizes the three canonical Pages views and defaults to Opportunity", () => {
    expect(GROWTH_MAP_PAGE_VIEWS).toEqual(["url", "cluster", "opportunity"]);
    expect(normalizeGrowthMapPageView(null)).toBe("opportunity");
    expect(normalizeGrowthMapPageView("unknown")).toBe("opportunity");
    expect(normalizeGrowthMapPageView("url")).toBe("url");
    expect(normalizeGrowthMapPageView("cluster")).toBe("cluster");
    expect(normalizeGrowthMapPageView("opportunity")).toBe("opportunity");
  });

  it("labels a truncated uncovered-Keyword count as a loaded lower bound", () => {
    const uncovered = keywordItem(IDS.keywordA, "uncovered keyword", {
      mappedTarget: {
        kind: "unassigned",
        reviewState: "unreviewed",
        revision: 0,
        reason: null,
      },
    });

    expect(growthMapUncoveredKeywordCountPresentation(null, false)).toEqual({
      kind: "unavailable",
      count: null,
    });
    expect(growthMapUncoveredKeywordCountPresentation([], false)).toEqual({
      kind: "empty",
      count: null,
    });
    expect(
      growthMapUncoveredKeywordCountPresentation([uncovered], false),
    ).toEqual({ kind: "exact", count: 1 });
    expect(
      growthMapUncoveredKeywordCountPresentation([uncovered], true),
    ).toEqual({ kind: "lower_bound", count: 1 });
  });

  it("keeps canonical view selections and scrubs state hidden by the next Pages view", () => {
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=pages&view=url&q=pricing&cursor=opaque&selectedClusterId=cluster-a&selectedOpportunityId=opportunity-a",
        { pageView: "url", selectedSitePageId: "page-a" },
      ),
    ).toBe(
      "/p/project/growth-map?object=pages&view=url&q=pricing&selectedSitePageId=page-a",
    );
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=pages&view=url&q=pricing&selectedSitePageId=page-a&findingId=finding-a",
        { pageView: "cluster", selectedClusterId: "cluster-b" },
      ),
    ).toBe(
      "/p/project/growth-map?object=pages&view=cluster&q=pricing&selectedClusterId=cluster-b",
    );
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=pages&view=cluster&q=pricing&selectedClusterId=cluster-b",
        { pageView: "opportunity", selectedOpportunityId: "opportunity-b" },
      ),
    ).toBe(
      "/p/project/growth-map?object=pages&view=opportunity&q=pricing&selectedOpportunityId=opportunity-b",
    );
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=pages&view=opportunity&findingId=hidden-finding",
        {},
      ),
    ).toBe("/p/project/growth-map?object=pages&view=opportunity");
  });

  it("keeps the Opportunity selection when drilling into an exact URL and back", () => {
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=pages&q=canonical&selectedOpportunityId=opportunity-a",
        {
          selectedSitePageId: "page-b",
          selectedFindingId: "finding-b",
        },
      ),
    ).toBe(
      "/p/project/growth-map?object=pages&q=canonical&selectedOpportunityId=opportunity-a&selectedSitePageId=page-b&findingId=finding-b",
    );
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "object=pages&q=canonical&selectedOpportunityId=opportunity-a&selectedSitePageId=page-b&findingId=finding-b",
        {
          selectedSitePageId: null,
          selectedFindingId: null,
        },
      ),
    ).toBe(
      "/p/project/growth-map?object=pages&q=canonical&selectedOpportunityId=opportunity-a",
    );
  });

  it("ships an accessible keyboard-ready three-way Pages view switcher", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("data-page-view-tab");
    expect(source).toContain("function PageViewTabs(");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain("onKeyDown={handleKeyDown}");
    expect(source).toContain("data-growth-map-url-drilldown");
    expect(source).toContain('t("opportunity.backToList")');
  });

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
      buildInternalLinkMapProjection(internalLinkMapFixture(), IDS.sitePageB),
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
            topicModelRevision: 1,
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
            topicModelRevision: 1,
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
    for (const search of ["gb", "en-gb", "awareness", "/guides/onboarding"]) {
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

  it("formats canonical organic overlap as a percentage and never as a cohort count", () => {
    expect(competitorOrganicOverlapDisplay(availableSerpOverlap())).toEqual({
      state: "available",
      percentage: 17,
      limitation: null,
    });
    expect(
      competitorOrganicOverlapDisplay({
        availability: "unavailable",
        value: null,
        limitation: "No canonical organic-overlap observation is available.",
      }),
    ).toEqual({
      state: "unavailable",
      limitation: "No canonical organic-overlap observation is available.",
    });
  });

  it("formats complete and partial AI citation cohorts without turning unavailable queries into zeroes", () => {
    expect(
      competitorAiCitationDisplay(availableAiCitationInsight()),
    ).toEqual({
      state: "available",
      primary: "8/20",
      attemptedQueries: 20,
      observedQueries: 20,
      unavailableQueries: 0,
      cohortCoverage: "complete",
      limitation: null,
    });
    expect(
      competitorAiCitationDisplay(
        availableAiCitationInsight({
          observedQueries: 17,
          unavailableQueries: 3,
          cohortCoverage: "partial",
          limitation: "Three provider responses were unavailable.",
        }),
      ),
    ).toEqual({
      state: "available",
      primary: "8/17",
      attemptedQueries: 20,
      observedQueries: 17,
      unavailableQueries: 3,
      cohortCoverage: "partial",
      limitation: "Three provider responses were unavailable.",
    });
    expect(
      competitorAiCitationDisplay({
        availability: "unavailable",
        value: null,
        limitation: "No observed AI responses are available.",
      }),
    ).toEqual({
      state: "unavailable",
      limitation: "No observed AI responses are available.",
    });
  });

  it("attributes pool entry to customer confirmation whenever a Product Profile or manual origin exists", () => {
    expect(
      competitorPoolEntryReason(
        competitorItem(IDS.competitorA, "alpha.example", {
          originOccurrences: [productProfileOrigin()],
        }),
      ),
    ).toBe("customer_confirmed");
    expect(
      competitorPoolEntryReason(
        competitorItem(IDS.competitorA, "alpha.example", {
          originOccurrences: [manualOrigin()],
        }),
      ),
    ).toBe("customer_confirmed");
    // Customer confirmation outranks an available metric.
    expect(
      competitorPoolEntryReason(
        competitorItem(IDS.competitorA, "alpha.example", {
          originOccurrences: [manualOrigin(), serpOverlapOrigin()],
          serpOverlap: availableSerpOverlap(),
        }),
      ),
    ).toBe("customer_confirmed");
  });

  it("falls back from collection-pending to metrics only when SERP overlap is genuinely available", () => {
    expect(
      competitorPoolEntryReason(
        competitorItem(IDS.competitorA, "alpha.example", {
          originOccurrences: [serpOverlapOrigin()],
        }),
      ),
    ).toBe("collection_pending");
    expect(
      competitorPoolEntryReason(
        competitorItem(IDS.competitorA, "alpha.example", {
          originOccurrences: [csvKeywordGapOrigin()],
        }),
      ),
    ).toBe("collection_pending");
    expect(
      competitorPoolEntryReason(
        competitorItem(IDS.competitorA, "alpha.example", {
          originOccurrences: [serpOverlapOrigin()],
          serpOverlap: availableSerpOverlap(),
        }),
      ),
    ).toBe("metrics");
  });

  it("admits only approved keyword_gap scope into Keyword-gap participation", () => {
    expect(
      competitorKeywordGapParticipation(
        competitorItem(IDS.competitorA, "alpha.example", {
          reviewStatus: "approved",
          relationship: "direct",
          analysisScope: ["keyword_gap", "content"],
        }),
      ),
    ).toBe("participating");
    expect(
      competitorKeywordGapParticipation(
        competitorItem(IDS.competitorA, "alpha.example", {
          reviewStatus: "approved",
          relationship: "direct",
          analysisScope: ["content"],
        }),
      ),
    ).toBe("not_participating");
    expect(
      competitorKeywordGapParticipation(
        competitorItem(IDS.competitorA, "alpha.example", {
          reviewStatus: "candidate",
        }),
      ),
    ).toBe("awaiting_confirmation");
    expect(
      competitorKeywordGapParticipation(
        competitorItem(IDS.competitorA, "alpha.example", {
          reviewStatus: "excluded",
        }),
      ),
    ).toBe("not_participating");
  });

  it("counts shared keywords only from an available insight and otherwise keeps the API limitation", () => {
    // The count and its scope note both come from the contract insight; the
    // cell never derives either from the origins.
    expect(
      competitorSharedKeywordDisplay(
        competitorItem(IDS.competitorA, "alpha.example", {
          originOccurrences: [serpOverlapOrigin(), manualOrigin()],
          sharedKeywordInsight: availableSharedKeywordInsight(),
        }),
      ),
    ).toEqual({
      state: "counted",
      value: 17,
      limitation: SHARED_KEYWORD_SCOPE_LIMITATION,
    });
    // A serp_overlap origin alone proves collection covers the domain, not
    // that a count was observed: still no number, and the limitation is the
    // server's own sentence rather than a front-end guess.
    expect(
      competitorSharedKeywordDisplay(
        competitorItem(IDS.competitorA, "alpha.example", {
          originOccurrences: [serpOverlapOrigin(), manualOrigin()],
          sharedKeywordInsight: {
            availability: "unavailable",
            value: null,
            limitation: "No readable competitor-domain observation is attached.",
          },
        }),
      ),
    ).toEqual({
      state: "collecting",
      limitation: "No readable competitor-domain observation is attached.",
    });
    expect(
      competitorSharedKeywordDisplay(
        competitorItem(IDS.competitorA, "alpha.example", {
          originOccurrences: [manualOrigin(), csvKeywordGapOrigin()],
          sharedKeywordInsight: {
            availability: "unavailable",
            value: null,
            limitation: "No search-results collection origin covers this domain.",
          },
        }),
      ),
    ).toEqual({
      state: "no_data",
      limitation: "No search-results collection origin covers this domain.",
    });
    expect(
      competitorSharedKeywordDisplay(
        competitorItem(IDS.competitorA, "alpha.example"),
      ).state,
    ).toBe("no_data");
  });

  it("derives the review success copy from the server response and guards the closed-dialog race", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    // Approved copy lists the exact server-returned scope set; no static
    // capability claims survive in the i18n catalogs or the component.
    expect(source).toContain('t("success.approved", {');
    expect(source).toMatch(
      /successState\.analysisScope\s+\.map\(\(scope\) => t\(`analysisScope\.\$\{scope\}`\)\)\s+\.join\(" · "\)/,
    );
    expect(source).not.toContain("approvedScopeLimited");
    // A late PATCH response while the dialog is closed must not resurrect
    // the success view, and every open-state transition starts clean.
    expect(source).toContain("if (!openRef.current) return;");
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s+setSuccessState\(null\);\s+\}, \[open\]\);/,
    );
    expect(source).toMatch(
      /setSuccessState\(\{\s+reviewStatus: response\.data\.reviewStatus,\s+analysisScope: response\.data\.analysisScope,\s+\}\);/,
    );
  });

  it("collapses only an active supporting Keyword and keeps its name under the primary row", () => {
    const projection = buildKeywordRelationPageProjection(
      [
        keywordItem(IDS.keywordA, "Customer onboarding", {
          sourceOccurrences: [
            { sourceKind: "csv_import" },
          ] as GrowthMapKeywordLibraryItem["sourceOccurrences"],
        }),
        keywordItem(IDS.keywordB, "Customer onboarding automation", {
          sourceOccurrences: [
            { sourceKind: "csv_import" },
            { sourceKind: "manual" },
            { sourceKind: "manual" },
          ] as GrowthMapKeywordLibraryItem["sourceOccurrences"],
        }),
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
    expect(projection.collapsedSupportingKeywordIds).toEqual([IDS.keywordB]);
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
        keywordItem(IDS.keywordB, "Customer onboarding automation"),
      ],
      [...irrelevantFirstPage, keywordRelation()],
    );

    expect(
      projection.visibleItems.map((entry) => entry.item.keywordId),
    ).toEqual([IDS.keywordA]);
    expect(projection.collapsedSupportingKeywordIds).toEqual([IDS.keywordB]);
    expect(projection.relationsByKeywordId.get(IDS.keywordA)).toHaveLength(101);
    expect(projection.visibleItems[0]?.supportingKeywords).toEqual([
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
        keywordItem(IDS.keywordB, "Customer onboarding automation"),
      ],
      [stale],
    );

    expect(
      projection.visibleItems.map((entry) => entry.item.keywordId),
    ).toEqual([IDS.keywordA, IDS.keywordB]);
    expect(projection.collapsedSupportingKeywordIds).toEqual([]);
    expect(
      projection.relationsByKeywordId.get(IDS.keywordB)?.[0]?.displayState,
    ).toBe("stale");
  });

  it("keeps a supporting row visible when its primary is outside this cursor page", () => {
    const relation = keywordRelation();
    const projection = buildKeywordRelationPageProjection(
      [keywordItem(IDS.keywordB, "Customer onboarding automation")],
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
      buildKeywordRelationDecisionCommand(relation, "keep_separate", null, " "),
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
    expect(projection.roots[0]?.insight?.label).toBe("Customer onboarding");
    expect(projection.roots[0]?.children[0]?.children[0]?.insight).toBeNull();
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
    expect(projection.activeNodes.map((node) => node.topicNodeId)).toEqual([
      IDS.topicRoot,
      IDS.topicSuccessor,
    ]);
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
      buildPatchTopicModelDraftCommand(draft, "  Retire obsolete scope.  ", [
        retire,
      ]),
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
    expect(buildPatchTopicModelDraftCommand(draft, " ", [retire])).toBeNull();
    expect(buildTopicNodeUpdateIntent(IDS.topicChild, {})).toBeNull();
    expect(
      buildTopicNodeSplitIntent(IDS.topicChild, [
        { ...input, label: "Only one successor" },
      ]),
    ).toBeNull();
    expect(buildTopicNodeMergeIntent([IDS.topicChild], input)).toBeNull();
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
    expect(source).toMatch(/collectAllCursorItems(?:<[^>]+>)?\(/);
    expect(source).toMatch(
      /getGrowthMapKeywordRelations\(projectId,\s*\{\s*keywordIds:\s*normalizedKeywordIds,\s*cursor:\s*pageCursor,\s*limit:\s*100,/,
    );
    expect(source).not.toContain("useGrowthMapKeywordRelations(projectId");
    expect(source).toContain("buildKeywordRelationPageProjection(");
    expect(source).toContain("useRefreshGrowthMapKeywordRelations(projectId)");
    expect(source).toContain("useDecideGrowthMapKeywordRelation(projectId)");
    expect(source).toMatch(
      /filterGrowthMapKeywordEntries\(relationProjection\.visibleItems,\s*\{\s*search: keywordSearch,\s*sourceKind: "all",/,
    );
    expect(source).toContain("entries={filteredEntries}");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("buildKeywordRelationDecisionCommand(");
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
      keywordLibraryReadState({
        isPending: true,
        isError: false,
        itemCount: 0,
      }),
    ).toBe("loading");
    expect(
      keywordLibraryReadState({
        isPending: false,
        isError: true,
        itemCount: 0,
      }),
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
      keywordLibraryReadState({
        isPending: false,
        isError: false,
        itemCount: 2,
      }),
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

    expect(selectCompetitorMonitorItem(response, IDS.competitorB)?.domain).toBe(
      "beta.example",
    );
    expect(selectCompetitorMonitorItem(response, IDS.competitorA)?.domain).toBe(
      "alpha.example",
    );
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
    expect(competitorMonitorDisplayState(ready, ready.competitors[1]!)).toBe(
      "baseline",
    );
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
      /useGrowthMapKeywords\(projectId,\s*\{\s*cursor,\s*limit: 50,\s*diagnosticRunId,\s*sourceKind:\s*sourceFilter === "all" \? null : sourceFilter,\s*\}\)/,
    );
    expect(source).toContain(
      "const reviewDetailQuery = useGrowthMapKeywordReviewDetail(",
    );
    expect(source).toContain("projectId,");
    expect(source).toContain("detail.keywordId,");
    expect(source).toContain("open,");
    expect(source).toContain(
      "const reviewDetail = reviewDetailQuery.data?.data ?? null;",
    );
    expect(source).not.toContain(
      "useGrowthMapKeywordReviewDetail(projectId, detail.keywordId, diagnosticRunId",
    );
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
    expect(source).toContain("const mutation = useReviewGrowthMapCompetitor(");
    expect(source).toContain('data-testid="competitor-review-open"');
    expect(source).toContain('data-testid="competitor-review-form"');
    expect(source).toContain('data-testid="competitor-review-analysis-scope"');
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
      'mode !== "backlinks" && generationQuery.isPending',
    );
    expect(source).toContain("diagnosticRunId={diagnosticRunId!}");
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
    expect(source).not.toContain('locationParams.get("diagnosticRunId")');
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
    expect(
      resolveGrowthMapCursorPredecessor(predecessors, "page-2"),
    ).toBeNull();
    expect(
      resolveGrowthMapCursorPredecessor(predecessors, "external-page"),
    ).toBeUndefined();
    expect(
      resolveGrowthMapCursorPredecessor(predecessors, null),
    ).toBeUndefined();
  });

  it("routes Competitor Library source management to the canonical project Sources page", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("href={`/p/${projectId}/sources`}");
    expect(source).not.toContain("function UnavailableLibrary");
  });

  it("keeps customer-facing source summaries visible and raw library lineage in native disclosures", () => {
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<details className={styles.traceDisclosure}>");
    expect(source).toContain('<summary>{t("viewSourceDetails")}</summary>');
    expect(source).toContain('<summary>{t("viewOriginDetails")}</summary>');
    expect(source).toContain('<summary>{t("viewRecordDetails")}</summary>');
    expect(source).not.toContain("<details open");
    expect(source).not.toContain("truncateId(occurrence.occurrenceId)");
    expect(source).not.toContain("truncateId(evidence.evidenceRefId)");
  });

  it("clears URL-specific state when leaving the page portfolio", () => {
    expect(
      growthMapLocationHref(
        "/p/project/growth-map",
        "q=pricing&cursor=opaque&view=opportunity&selectedSitePageId=page-a&selectedClusterId=cluster-a&selectedOpportunityId=opportunity-a",
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
        {
          ...observedZero,
          value: null,
          freshness: "unknown",
          limitation: "The source returned no value.",
        },
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
            limitation:
              "The latest connected source is outside the current window.",
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
    const source = readFileSync(
      new URL("./_growth-map.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain('mode === "idle" && error !== null');
    expect(source).toContain(
      "shouldShowGrowthMapReviewError(mode, problemError)",
    );
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

function urlFinding(
  findingId: string,
  overrides: Partial<GrowthMapUrlFinding> = {},
): GrowthMapUrlFinding {
  return {
    projectId: IDS.project,
    siteId: IDS.project,
    findingId,
    diagnosticRunId: IDS.snapshot,
    ruleId: "TECH-CANONICAL-001",
    ruleVersion: 1,
    title: findingId,
    severity: "medium",
    reviewState: "unreviewed",
    reviewRevision: 0,
    active: true,
    regressed: false,
    evidenceIds: [IDS.evidence],
    targetRelation: { relation: "affects_url", sitePageId: IDS.sitePage },
    executionPreview: null,
    executionRef: null,
    ...overrides,
  } as GrowthMapUrlFinding;
}

describe("growth map page type presentation", () => {
  it("names every stable page_type.v1 slug the read model can send", () => {
    expect(GROWTH_MAP_PAGE_TYPES).toEqual([
      "home",
      "product",
      "solution",
      "commercial",
      "comparison",
      "integration",
      "template",
      "blog",
      "resource",
      "documentation",
      "trust",
    ]);
  });

  it("reads a null page type as unclassified, never as not collected", () => {
    expect(growthMapPageTypeLabel(null)).toEqual({ kind: "unclassified" });
  });

  it("maps a known slug to its own translated label", () => {
    expect(growthMapPageTypeLabel("documentation")).toEqual({
      kind: "known",
      slug: "documentation",
    });
  });

  it("passes an unknown slug through instead of inventing a label", () => {
    expect(growthMapPageTypeLabel("changelog")).toEqual({
      kind: "raw",
      value: "changelog",
    });
  });

  it("orders the filter options by the canonical slug order", () => {
    expect(
      growthMapPageTypeFilterOptions([
        urlPortfolioItem(IDS.sitePage, { pageType: "blog" }),
        urlPortfolioItem(IDS.sitePageB, { pageType: "home" }),
        urlPortfolioItem(IDS.sitePageC, { pageType: null }),
      ]),
    ).toEqual(["home", "blog"]);
  });

  it("keeps unknown slugs last and deduplicated", () => {
    expect(
      growthMapPageTypeFilterOptions([
        urlPortfolioItem(IDS.sitePage, { pageType: "changelog" }),
        urlPortfolioItem(IDS.sitePageB, { pageType: "blog" }),
        urlPortfolioItem(IDS.sitePageC, { pageType: "changelog" }),
      ]),
    ).toEqual(["blog", "changelog"]);
  });
});

describe("growth map primary opportunity", () => {
  it("has nothing to open when the URL projects no Finding", () => {
    expect(growthMapPrimaryOpportunity([])).toEqual({
      kind: "none",
      reason: "no_findings",
      closedFindingCount: 0,
    });
  });

  it("selects by severity, not by the server's id ordering", () => {
    const low = urlFinding(IDS.finding, { severity: "low" });
    const critical = urlFinding(IDS.supportingFinding, {
      severity: "critical",
    });

    expect(growthMapPrimaryOpportunity([low, critical])).toEqual({
      kind: "review",
      finding: critical,
    });
  });

  it("keeps the projected order when two Findings share a severity", () => {
    const first = urlFinding(IDS.finding, { severity: "high" });
    const second = urlFinding(IDS.supportingFinding, { severity: "high" });

    expect(growthMapPrimaryOpportunity([first, second])).toEqual({
      kind: "review",
      finding: first,
    });
  });

  it("targets Execution only when the selected Finding names a canonical Action", () => {
    const executionRef = { actionId: IDS.action, artifactIds: [IDS.artifact] };
    const critical = urlFinding(IDS.supportingFinding, {
      severity: "critical",
      executionRef,
    });

    expect(growthMapPrimaryOpportunity([critical])).toEqual({
      kind: "execution",
      finding: critical,
      executionRef,
    });
  });

  it("stays in the review panel when the highest severity Finding has no Action", () => {
    const critical = urlFinding(IDS.supportingFinding, {
      severity: "critical",
    });
    const highWithAction = urlFinding(IDS.finding, {
      severity: "high",
      executionRef: { actionId: IDS.action, artifactIds: [] },
    });

    expect(growthMapPrimaryOpportunity([critical, highWithAction])).toEqual({
      kind: "review",
      finding: critical,
    });
  });

  it("never promotes a Finding a person ignored, matching the row priority pill", () => {
    const ignoredCritical = urlFinding(IDS.finding, {
      severity: "critical",
      reviewState: "ignored",
    });
    const openHigh = urlFinding(IDS.supportingFinding, { severity: "high" });

    expect(growthMapPrimaryOpportunity([ignoredCritical, openHigh])).toEqual({
      kind: "review",
      finding: openHigh,
    });
  });

  it("never promotes a Finding the run no longer reports as active", () => {
    const resolvedCritical = urlFinding(IDS.finding, {
      severity: "critical",
      active: false,
    });
    const openLow = urlFinding(IDS.supportingFinding, { severity: "low" });

    expect(growthMapPrimaryOpportunity([resolvedCritical, openLow])).toEqual({
      kind: "review",
      finding: openLow,
    });
  });

  it("keeps a confirmed Finding rankable until it is actually resolved", () => {
    const confirmed = urlFinding(IDS.finding, {
      severity: "high",
      reviewState: "confirmed",
    });

    expect(growthMapPrimaryOpportunity([confirmed])).toEqual({
      kind: "review",
      finding: confirmed,
    });
  });

  it("refuses to open Execution for an ignored Finding that still names an Action", () => {
    const ignored = urlFinding(IDS.finding, {
      severity: "critical",
      reviewState: "ignored",
      executionRef: { actionId: IDS.action, artifactIds: [IDS.artifact] },
    });

    expect(growthMapPrimaryOpportunity([ignored])).toEqual({
      kind: "none",
      reason: "all_closed",
      closedFindingCount: 1,
    });
  });

  it("degrades to a named reason when every Finding is ignored or inactive", () => {
    const ignored = urlFinding(IDS.finding, {
      severity: "critical",
      reviewState: "ignored",
    });
    const inactive = urlFinding(IDS.supportingFinding, {
      severity: "high",
      active: false,
    });

    expect(growthMapPrimaryOpportunity([ignored, inactive])).toEqual({
      kind: "none",
      reason: "all_closed",
      closedFindingCount: 2,
    });
  });
});

describe("growth map keyword governance origin presentation", () => {
  it("keeps the plain status label when a person made the decision", () => {
    expect(
      growthMapKeywordReviewPresentation({
        status: "approved",
        reviewOrigin: "user",
      }),
    ).toEqual({
      statusLabelKey: "status.approved",
      originLabelKey: null,
      awaitingHumanReview: false,
    });
  });

  it("keeps the plain status label when no decision was ever recorded", () => {
    expect(
      growthMapKeywordReviewPresentation({
        status: "candidate",
        reviewOrigin: null,
      }),
    ).toEqual({
      statusLabelKey: "status.candidate",
      originLabelKey: null,
      awaitingHumanReview: false,
    });
  });

  it("reads a read model that does not carry the field yet as no decision", () => {
    expect(
      growthMapKeywordReviewPresentation(
        keywordItem(IDS.keywordA, "pipeline software"),
      ),
    ).toEqual({
      statusLabelKey: "status.approved",
      originLabelKey: null,
      awaitingHumanReview: false,
    });
  });

  it("never presents a system-approved keyword with the human confirmation label", () => {
    const presentation = growthMapKeywordReviewPresentation({
      status: "approved",
      reviewOrigin: "system_suggestion",
    });

    expect(presentation).toEqual({
      statusLabelKey: "reviewOrigin.approvedBySystem",
      originLabelKey: "reviewOrigin.pendingHumanReview",
      awaitingHumanReview: true,
    });
    expect(presentation.statusLabelKey).not.toBe("status.approved");
  });

  it("separates a migration baseline approval from a human confirmation", () => {
    expect(
      growthMapKeywordReviewPresentation({
        status: "approved",
        reviewOrigin: "migration_baseline",
      }),
    ).toEqual({
      statusLabelKey: "reviewOrigin.approvedByMigration",
      originLabelKey: "reviewOrigin.pendingHumanReview",
      awaitingHumanReview: true,
    });
  });

  it("discloses a machine origin on the other governance states too", () => {
    expect(
      growthMapKeywordReviewPresentation({
        status: "excluded",
        reviewOrigin: "system_suggestion",
      }),
    ).toEqual({
      statusLabelKey: "status.excluded",
      originLabelKey: "reviewOrigin.system_suggestion",
      awaitingHumanReview: true,
    });
    expect(
      growthMapKeywordReviewPresentation({
        status: "parked",
        reviewOrigin: "migration_baseline",
      }),
    ).toEqual({
      statusLabelKey: "status.parked",
      originLabelKey: "reviewOrigin.migration_baseline",
      awaitingHumanReview: true,
    });
  });

  it("names every decision origin the governance table can persist", () => {
    expect(GROWTH_MAP_KEYWORD_REVIEW_ORIGINS).toEqual([
      "migration_baseline",
      "system_suggestion",
      "user",
    ]);
  });
});
