import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGrowthMapCompetitorMonitorMutationOptions,
  buildGrowthMapCompetitorDetailQueryOptions,
  buildGrowthMapCompetitorReviewDetailQueryOptions,
  buildGrowthMapCompetitorMonitorQueryOptions,
  buildGrowthMapCompetitorsQueryOptions,
  buildReviewGrowthMapCompetitorMutationOptions,
  buildGrowthMapKeywordDetailQueryOptions,
  buildGrowthMapKeywordReviewDetailQueryOptions,
  buildGrowthMapKeywordRelationsQueryOptions,
  buildGrowthMapKeywordRankHistoryQueryOptions,
  buildGrowthMapKeywordsQueryOptions,
  buildGrowthMapTopicModelInsightsQueryOptions,
  buildGrowthMapTopicModelWorkspaceQueryOptions,
  buildGrowthMapInternalLinkMapQueryOptions,
  buildGrowthMapUrlDetailQueryOptions,
  buildGrowthMapUrlsQueryOptions,
  beginGrowthMapTopicModelDraft,
  confirmGrowthMapTopicModelDraft,
  decideGrowthMapKeywordRelation,
  getGrowthMapCompetitorDetail,
  getGrowthMapCompetitorReviewDetail,
  getGrowthMapCompetitorMonitor,
  getGrowthMapCompetitors,
  getGrowthMapKeywordDetail,
  getGrowthMapKeywordReviewDetail,
  getGrowthMapKeywordRelations,
  getGrowthMapKeywordRankHistory,
  getGrowthMapKeywords,
  getGrowthMapTopicModelInsights,
  getGrowthMapTopicModelWorkspace,
  getGrowthMapInternalLinkMap,
  getGrowthMapUrlDetail,
  getGrowthMapUrls,
  growthMapCompetitorDetailQueryKey,
  growthMapCompetitorReviewDetailQueryKey,
  growthMapCompetitorMonitorQueryKey,
  growthMapCompetitorsQueryKey,
  growthMapKeywordDetailQueryKey,
  growthMapKeywordReviewDetailQueryKey,
  growthMapKeywordRelationsQueryKey,
  growthMapKeywordRankHistoryQueryKey,
  growthMapKeywordsQueryKey,
  growthMapTopicModelInsightsQueryKey,
  growthMapTopicModelWorkspaceQueryKey,
  growthMapInternalLinkMapQueryKey,
  growthMapUrlDetailQueryKey,
  growthMapUrlsQueryKey,
  invalidateGrowthMapAfterTopicModelConfirmation,
  invalidateGrowthMapAfterCompetitorReview,
  invalidateGrowthMapAfterKeywordReview,
  invalidateGrowthMapKeywordRelations,
  invalidateGrowthMapTopicModelAfterConflict,
  invalidateGrowthMapTopicModelDraft,
  patchGrowthMapTopicModelDraft,
  refreshGrowthMapAfterFindingReview,
  refreshGrowthMapKeywordRelations,
  reviewGrowthMapKeyword,
  reviewGrowthMapCompetitor,
  updateGrowthMapCompetitorMonitor,
} from "./hooks-growth-map";
import { ApiError } from "./client";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const SITE_PAGE_A = "00000000-0000-4000-8000-000000000002";
const SITE_PAGE_B = "00000000-0000-4000-8000-000000000003";
const SITE_ID = "00000000-0000-4000-8000-000000000004";
const DIAGNOSTIC_RUN_ID = "00000000-0000-4000-8000-000000000005";
const CRAWL_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000006";
const GSC_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000007";
const OBSERVATION_A = "00000000-0000-4000-8000-000000000008";
const OBSERVATION_B = "00000000-0000-4000-8000-000000000009";
const KEYWORD_A = "00000000-0000-4000-8000-000000000010";
const KEYWORD_B = "00000000-0000-4000-8000-000000000011";
const KEYWORD_DIAGNOSTIC_RUN =
  "00000000-0000-4000-8000-000000000012";
const KEYWORD_OCCURRENCE = "00000000-0000-4000-8000-000000000013";
const KEYWORD_SNAPSHOT = "00000000-0000-4000-8000-000000000014";
const KEYWORD_OBSERVATION = "00000000-0000-4000-8000-000000000015";
const IMPORT_PREVIEW = "00000000-0000-4000-8000-000000000016";
const COMPETITOR_A = "00000000-0000-4000-8000-000000000017";
const COMPETITOR_B = "00000000-0000-4000-8000-000000000018";
const COMPETITOR_PROFILE_ORIGIN = "00000000-0000-4000-8000-000000000019";
const COMPETITOR_CSV_ORIGIN = "00000000-0000-4000-8000-000000000020";
const COMPETITOR_MANUAL_ORIGIN = "00000000-0000-4000-8000-000000000021";
const PRODUCT_PROFILE = "00000000-0000-4000-8000-000000000022";
const COMPETITOR_CANDIDATE = "00000000-0000-4000-8000-000000000023";
const PROFILE_EVIDENCE_REF = "00000000-0000-4000-8000-000000000024";
const COMPETITOR_SNAPSHOT = "00000000-0000-4000-8000-000000000025";
const COMPETITOR_OBSERVATION = "00000000-0000-4000-8000-000000000026";
const COMPETITOR_IMPORT_PREVIEW = "00000000-0000-4000-8000-000000000027";
const COMPETITOR_EVIDENCE = "00000000-0000-4000-8000-000000000028";
const MANUAL_ENTRY = "00000000-0000-4000-8000-000000000029";
const RANK_OCCURRENCE = "00000000-0000-4000-8000-000000000030";
const RANK_SNAPSHOT = "00000000-0000-4000-8000-000000000031";
const RANK_OBSERVATION = "00000000-0000-4000-8000-000000000032";
const KEYWORD_RELATION = "00000000-0000-4000-8000-000000000033";
const KEYWORD_RELATION_CANDIDATE =
  "00000000-0000-4000-8000-000000000034";
const KEYWORD_RELATION_DECISION =
  "00000000-0000-4000-8000-000000000035";
const KEYWORD_RELATION_ACTOR =
  "00000000-0000-4000-8000-000000000036";
const KEYWORD_RELATION_PAGE =
  "00000000-0000-4000-8000-000000000037";
const KEYWORD_RELATION_TOPIC =
  "00000000-0000-4000-8000-000000000038";
const TOPIC_NODE_ROOT = "00000000-0000-4000-8000-000000000039";
const TOPIC_NODE_CHILD = "00000000-0000-4000-8000-000000000040";
const TOPIC_ACTOR = "00000000-0000-4000-8000-000000000041";
const INTERNAL_LINK_FINDING =
  "00000000-0000-4000-8000-000000000042";
const INTERNAL_LINK_ACTION =
  "00000000-0000-4000-8000-000000000043";
const INTERNAL_LINK_TOPIC =
  "00000000-0000-4000-8000-000000000044";
const COMPETITOR_MONITOR_SIGNAL =
  "00000000-0000-4000-8000-000000000045";
const URL_FINDING = "00000000-0000-4000-8000-000000000046";
const URL_EVIDENCE = "00000000-0000-4000-8000-000000000047";
const OBSERVED_AT = "2026-07-21T00:00:00.000Z";
const UI_LOCALE = "en" as const;

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function portfolioResponse() {
  return {
    projectId: PROJECT_ID,
    siteId: SITE_ID,
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: CRAWL_SNAPSHOT_ID,
    data: [],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: { availability: "available", limitations: [] },
      summary: {
        urlCount: 0,
        opportunityUrlCount: 0,
        listedUrlCount: 0,
        signalCount: 0,
        priorityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
        precedingUrlCount: 0,
      },
    },
  } as const;
}

function detailResponse(sitePageId: string) {
  const observationId =
    sitePageId === SITE_PAGE_A ? OBSERVATION_A : OBSERVATION_B;
  const normalizedUrl =
    sitePageId === SITE_PAGE_A
      ? "https://example.test/customer-onboarding/"
      : "https://example.test/pricing/";
  return {
    projectId: PROJECT_ID,
    siteId: SITE_ID,
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: CRAWL_SNAPSHOT_ID,
    data: {
      projectId: PROJECT_ID,
      siteId: SITE_ID,
      diagnosticRunId: DIAGNOSTIC_RUN_ID,
      crawlSnapshotId: CRAWL_SNAPSHOT_ID,
      sitePageId,
      pageSnapshotId: null,
      pageSnapshotCapturedAt: null,
      identitySources: [
        {
          kind: "url_observation",
          provider: "gsc",
          snapshotId: GSC_SNAPSHOT_ID,
          observationId,
          sitePageId,
          subjectRef: normalizedUrl,
          observedAt: OBSERVED_AT,
        },
      ],
      normalizedUrl,
      title: null,
      pageType: null,
      templateKey: null,
      clusterKey: null,
      ownerId: null,
      coverage: {
        availability: "unavailable",
        limitations: ["No immutable Crawl Page Snapshot is available."],
      },
      metricObservations: [],
      findingIds: [],
      reviewableFindingIds: [],
      priority: {
        availability: "unavailable",
        value: null,
        limitation: "No current-run URL Finding is available.",
      },
      delta: {
        availability: "unavailable",
        value: null,
        limitation: "Two immutable recheck anchors are not available.",
      },
      findings: [],
    },
  } as const;
}

function detailResponseWithExecutionPreview(sitePageId: string) {
  const response = detailResponse(sitePageId);
  const finding = {
    projectId: PROJECT_ID,
    siteId: SITE_ID,
    findingId: URL_FINDING,
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    ruleId: "TECH-HTTP-001",
    ruleVersion: 2,
    title: "Fix the non-200 response",
    severity: "high",
    reviewState: "unreviewed",
    reviewRevision: 0,
    active: true,
    regressed: false,
    evidenceIds: [URL_EVIDENCE],
    targetRelation: {
      relation: "direct_url",
      targetKind: "url",
      targetRef: response.data.normalizedUrl,
      sitePageId,
      pageSnapshotId: null,
    },
    executionPreview: {
      templateId: "fix_http_status.v1",
      templateVersion: 1,
      artifactType: "technical_ticket",
      effort: "medium",
      risk: "medium",
      contentLocale: "en",
      title: "Fix non-200 indexable URLs",
      description:
        "Repair or redirect indexable URLs that return error statuses.",
      expectedOutcome:
        "Priority URLs return an intentional indexable or redirect status.",
    },
    executionRef: null,
  } as const;
  return {
    ...response,
    data: {
      ...response.data,
      findingIds: [URL_FINDING],
      reviewableFindingIds: [URL_FINDING],
      priority: {
        availability: "available",
        value: "high",
        basis: {
          derivationVersion: "max_finding_severity.v1",
          projectId: PROJECT_ID,
          siteId: SITE_ID,
          diagnosticRunId: DIAGNOSTIC_RUN_ID,
          sitePageId,
          findingIds: [URL_FINDING],
        },
        limitation: null,
      },
      findings: [finding],
    },
  } as const;
}

function internalLinkMapResponse(sitePageId: string) {
  const selectedUrl =
    sitePageId === SITE_PAGE_A
      ? "https://example.test/customer-onboarding/"
      : "https://example.test/pricing/";
  const otherPageId =
    sitePageId === SITE_PAGE_A ? SITE_PAGE_B : SITE_PAGE_A;
  const otherUrl =
    sitePageId === SITE_PAGE_A
      ? "https://example.test/pricing/"
      : "https://example.test/customer-onboarding/";
  const urls = [selectedUrl, otherUrl].sort();
  const selectedNode = {
    canonicalUrl: selectedUrl,
    sitePageIds: [sitePageId],
    title: null,
    inboundCount: 0,
    outboundCount: 0,
    status: "orphan" as const,
    executionRefs: [
      {
        findingId: INTERNAL_LINK_FINDING,
        actionId: INTERNAL_LINK_ACTION,
      },
    ],
  };
  const otherNode = {
    canonicalUrl: otherUrl,
    sitePageIds: [otherPageId],
    title: null,
    inboundCount: 0,
    outboundCount: 0,
    status: "orphan" as const,
    executionRefs: [],
  };
  return {
    projectId: PROJECT_ID,
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    crawlSnapshot: {
      snapshotId: CRAWL_SNAPSHOT_ID,
      capturedAt: OBSERVED_AT,
      availability: "available" as const,
      limitation: null,
    },
    coverage: {
      availability: "available" as const,
      crawlCompleteness: "complete" as const,
      limitations: [],
    },
    graph: {
      nodes: urls.map((url) =>
        url === selectedUrl ? selectedNode : otherNode,
      ),
      edges: [],
      totalEdgeCount: 0,
      edgesTruncated: false,
    },
    selectedPage: {
      selectedSitePageId: sitePageId,
      canonicalUrl: selectedUrl,
      inboundSources: [],
      recommendationCoverage: {
        availability: "available" as const,
        limitations: [],
      },
      recommendations: [
        {
          sourceCanonicalUrl: otherUrl,
          sourceSitePageIds: [otherPageId],
          targetCanonicalUrl: selectedUrl,
          targetSitePageIds: [sitePageId],
          basis: {
            kind: "same_confirmed_topic" as const,
            topicNodeId: INTERNAL_LINK_TOPIC,
            topicModelRevision: 2,
            topicLabel: "Customer onboarding",
          },
          explanation: "同属一个已确认 Topic，且未观察到该方向的内链。",
        },
      ],
      totalRecommendationCount: 1,
      recommendationsTruncated: false,
    },
    generatedAt: OBSERVED_AT,
  } as const;
}

function keywordItem(keywordId = KEYWORD_A) {
  const displayKeyword =
    keywordId === KEYWORD_A
      ? "customer onboarding software"
      : "customer onboarding platform";
  return {
    projectId: PROJECT_ID,
    keywordId,
    displayKeyword,
    normalizedKeyword: displayKeyword,
    marketCode: "US",
    languageTag: "en-US",
    queryKind: "search_query",
    status: "candidate",
    reviewOrigin: null,
    revision: 0,
    intent: null,
    buyerStage: null,
    cluster: null,
    classificationLimitations: {
      intent: "Intent has not been classified from a canonical source.",
      buyerStage: "Buyer stage has not been classified from a canonical source.",
      cluster: "No reviewed Keyword cluster is available.",
    },
    mappedTarget: {
      kind: "unassigned",
      reviewState: "unreviewed",
      revision: 0,
      reason: null,
    },
    sourceOccurrences: [
      {
        occurrenceId: KEYWORD_OCCURRENCE,
        collectedAt: "2026-07-21T02:00:00.000Z",
        providerDataAsOf: OBSERVED_AT,
        freshness: "current",
        limitation: null,
        scopeBasis: "user_provided",
        scopeLimitation: "Coverage is limited to the uploaded CSV rows.",
        marketCode: "US",
        languageTag: "en-US",
        sourceKind: "csv_import",
        snapshotId: KEYWORD_SNAPSHOT,
        sourceObservationId: KEYWORD_OBSERVATION,
        sourcePointer: "/valueJson/keyword",
        importPreviewId: IMPORT_PREVIEW,
      },
    ],
    metrics: {
      volume: {
        snapshotId: KEYWORD_SNAPSHOT,
        observationId: KEYWORD_OBSERVATION,
        valuePointer: "/valueJson/searchVolume",
        observedAt: OBSERVED_AT,
        freshness: "current",
        limitation: null,
        value: 0,
      },
      kd: null,
      currentRank: null,
      currentUrl: null,
      competitorDomain: null,
      competitorRank: null,
      limitations: {
        volume: null,
        kd: "No canonical Keyword Difficulty observation is available.",
        currentRank: "No canonical current-rank observation is available.",
        currentUrl: "No canonical current-URL observation is available.",
        competitorDomain: "No competitor-domain observation is available.",
        competitorRank: "No competitor-rank observation is available.",
      },
    },
    coverage: {
      availability: "partial",
      limitations: ["Classification and several canonical metrics are unavailable."],
    },
  } as const;
}

function keywordLibraryResponse() {
  return {
    projectId: PROJECT_ID,
    data: [keywordItem()],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: {
        availability: "partial",
        limitations: ["Only source-verified Keyword occurrences are returned."],
      },
    },
  } as const;
}

function keywordDetailResponse(keywordId = KEYWORD_A) {
  return {
    projectId: PROJECT_ID,
    data: keywordItem(keywordId),
  } as const;
}

function keywordRankHistory(keywordId = KEYWORD_A) {
  return {
    projectId: PROJECT_ID,
    keywordId,
    mappedPage: null,
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
            occurrenceId: RANK_OCCURRENCE,
            snapshotId: RANK_SNAPSHOT,
            observationId: RANK_OBSERVATION,
            provider: "dataforseo",
            metric: "absolute_rank",
            value: 12,
            valuePointer: "/valueJson/currentRank",
            observedAt: "2026-07-20T00:00:00.000Z",
            providerDataAsOf: null,
            grade: "B",
            limitation:
              "DataForSEO does not provide a provider data-as-of timestamp.",
          },
        ],
      },
    ],
    changeMarkers: [],
    coverage: {
      availability: "partial",
      limitations: [
        "At least one rank series has fewer than two observations, so a trend cannot yet be established.",
      ],
    },
    generatedAt: "2026-07-21T00:00:00.000Z",
  } as const;
}

function keywordRelationCandidate() {
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
    topicNodeId: KEYWORD_RELATION_TOPIC,
    topicModelRevision: 1,
    mappedSitePageId: KEYWORD_RELATION_PAGE,
  });
  return {
    candidateId: KEYWORD_RELATION_CANDIDATE,
    relationId: KEYWORD_RELATION,
    projectId: PROJECT_ID,
    candidateRevision: 1,
    ruleVersion: "keyword-relation.1.0.0",
    keywordA: participant(KEYWORD_A, "Customer onboarding software"),
    keywordB: participant(KEYWORD_B, "Customer onboarding platform"),
    signals: {
      sameConfirmedMappedPage: true,
      sameReviewedIntent: true,
      sameMarket: true,
      sameLanguage: true,
      sameConfirmedTopic: true,
      lexicalTokenOverlap: 0.67,
      serpOverlap: {
        availability: "unavailable",
        value: null,
        limitation:
          "Canonical SERP-overlap observations are not available yet.",
      },
    },
    evidenceHash: "a".repeat(64),
    generatedAt: "2026-07-21T00:00:00.000Z",
  } as const;
}

function undecidedKeywordRelation() {
  return {
    projectId: PROJECT_ID,
    relationId: KEYWORD_RELATION,
    candidate: keywordRelationCandidate(),
    candidateState: "current",
    staleReasons: [],
    currentRelationRevision: 0,
    decision: null,
    decisionState: "none",
    displayState: "possible_duplicate",
    isEffectivelyFolded: false,
    primaryKeywordId: null,
    supportingKeywordId: null,
  } as const;
}

function foldedKeywordRelation() {
  return {
    ...undecidedKeywordRelation(),
    currentRelationRevision: 1,
    decision: {
      decisionId: KEYWORD_RELATION_DECISION,
      relationId: KEYWORD_RELATION,
      candidateId: KEYWORD_RELATION_CANDIDATE,
      projectId: PROJECT_ID,
      relationRevision: 1,
      decisionKind: "primary_supporting",
      primaryKeywordId: KEYWORD_A,
      supportingKeywordId: KEYWORD_B,
      reason: "Use one primary Keyword and retain supporting evidence.",
      decidedBy: KEYWORD_RELATION_ACTOR,
      decidedAt: "2026-07-21T00:05:00.000Z",
    },
    decisionState: "active",
    displayState: "folded",
    isEffectivelyFolded: true,
    primaryKeywordId: KEYWORD_A,
    supportingKeywordId: KEYWORD_B,
  } as const;
}

function keywordRelationListResponse() {
  return {
    projectId: PROJECT_ID,
    data: [undecidedKeywordRelation()],
    meta: {
      limit: 100,
      nextCursor: null,
      hasNext: false,
      coverage: { availability: "available", limitations: [] },
    },
  } as const;
}

function topicNode(
  topicNodeId: string,
  parentTopicNodeId: string | null,
  label: string,
) {
  return {
    projectId: PROJECT_ID,
    topicNodeId,
    topicModelRevision: 1,
    parentTopicNodeId,
    label,
    description: null,
    intentEnvelope: [],
    lifecycleState: "active",
  } as const;
}

function confirmedTopicModel() {
  return {
    projectId: PROJECT_ID,
    topicModelRevision: 1,
    editRevision: 2,
    rootTopicNodeId: TOPIC_NODE_ROOT,
    nodes: [
      topicNode(TOPIC_NODE_ROOT, null, "Customer onboarding"),
      topicNode(TOPIC_NODE_CHILD, TOPIC_NODE_ROOT, "Automation"),
    ],
    aliases: [],
    successorRelationships: [],
    createdAt: "2026-07-20T00:00:00.000Z",
    createdBy: TOPIC_ACTOR,
    state: "confirmed",
    confirmedAt: "2026-07-21T00:00:00.000Z",
    confirmedBy: TOPIC_ACTOR,
    contentHash: "b".repeat(64),
  } as const;
}

function draftTopicModel(editRevision = 2) {
  return {
    ...confirmedTopicModel(),
    topicModelRevision: 2,
    editRevision,
    nodes: confirmedTopicModel().nodes.map((node) => ({
      ...node,
      topicModelRevision: 2,
    })),
    state: "draft",
    updatedAt: "2026-07-22T00:00:00.000Z",
    confirmedAt: undefined,
    confirmedBy: undefined,
    contentHash: undefined,
  } as const;
}

function topicWorkspace(
  options: { readonly draftEditRevision?: number | null } = {},
) {
  const draft =
    options.draftEditRevision === undefined
      ? null
      : draftTopicModel(options.draftEditRevision ?? 0);
  return {
    projectId: PROJECT_ID,
    latestConfirmed: confirmedTopicModel(),
    draft,
    generatedAt: "2026-07-22T00:00:01.000Z",
  } as const;
}

function topicInsights() {
  return {
    projectId: PROJECT_ID,
    topicModelRevision: 1,
    nodes: [
      {
        projectId: PROJECT_ID,
        topicNodeId: TOPIC_NODE_ROOT,
        topicModelRevision: 1,
        label: "Customer onboarding",
        keywordCount: 2,
        approvedKeywordCount: 1,
        reviewPendingKeywordCount: 1,
        existingPageKeywordCount: 1,
        newAssetKeywordCount: 0,
        unassignedKeywordCount: 1,
        mappedPageCount: 1,
        conflictingIntentCount: 0,
        coverageState: "partial",
        limitation: "One Keyword is awaiting mapping review.",
      },
      {
        projectId: PROJECT_ID,
        topicNodeId: TOPIC_NODE_CHILD,
        topicModelRevision: 1,
        label: "Automation",
        keywordCount: 0,
        approvedKeywordCount: 0,
        reviewPendingKeywordCount: 0,
        existingPageKeywordCount: 0,
        newAssetKeywordCount: 0,
        unassignedKeywordCount: 0,
        mappedPageCount: 0,
        conflictingIntentCount: 0,
        coverageState: "empty",
        limitation: "No governed Keywords are assigned to this Topic.",
      },
    ],
    coverage: {
      availability: "partial",
      limitations: ["One or more Topics have incomplete coverage."],
    },
    generatedAt: "2026-07-22T00:00:01.000Z",
  } as const;
}

function competitorItem(competitorId = COMPETITOR_A) {
  const primary = competitorId === COMPETITOR_A;
  return {
    projectId: PROJECT_ID,
    competitorId,
    domain: primary ? "example-competitor.com" : "other-competitor.com",
    name: primary ? "Example Competitor" : "Other Competitor",
    reviewStatus: "candidate",
    relationship: null,
    analysisScope: [],
    revision: 0,
    originOccurrences: [
      {
        occurrenceId: COMPETITOR_PROFILE_ORIGIN,
        originKind: "product_profile",
        productProfileId: PRODUCT_PROFILE,
        profileVersion: 2,
        candidateId: COMPETITOR_CANDIDATE,
        fieldProvenancePath: "/competitorCandidates/0",
        observedAt: null,
        evidenceRefs: [
          {
            evidenceRefId: PROFILE_EVIDENCE_REF,
            kind: "snapshot",
            snapshotId: CRAWL_SNAPSHOT_ID,
          },
        ],
      },
      {
        occurrenceId: COMPETITOR_CSV_ORIGIN,
        originKind: "csv_keyword_gap",
        snapshotId: COMPETITOR_SNAPSHOT,
        observationId: COMPETITOR_OBSERVATION,
        sourcePointer: "/valueJson/competitorDomain",
        importPreviewId: COMPETITOR_IMPORT_PREVIEW,
        observedAt: OBSERVED_AT,
        evidenceRefs: [
          { kind: "evidence", evidenceId: COMPETITOR_EVIDENCE },
        ],
      },
      {
        occurrenceId: COMPETITOR_MANUAL_ORIGIN,
        originKind: "manual",
        manualEntryId: MANUAL_ENTRY,
        observedAt: null,
        evidenceRefs: [],
      },
    ],
    lastObservedAt: OBSERVED_AT,
    serpOverlap: {
      availability: "unavailable",
      value: null,
      limitation:
        "SERP overlap is unavailable because Competitor Library v1 has no canonical SERP-overlap writer.",
    },
    aiCitationInsight: {
      availability: "unavailable",
      value: null,
      limitation:
        "AI citation insight is unavailable because Competitor Library v1 has no canonical AI-citation writer.",
    },
    coverage: {
      availability: "partial",
      limitations: [
        "This Competitor is still a candidate and has not been approved for analysis.",
        "A Product Profile source is approved, but this stable Competitor Library entity is still awaiting its own review.",
      ],
    },
  } as const;
}

function competitorLibraryResponse() {
  return {
    projectId: PROJECT_ID,
    data: [competitorItem()],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: {
        availability: "partial",
        limitations: competitorItem().coverage.limitations,
      },
    },
  } as const;
}

function competitorDetailResponse(competitorId = COMPETITOR_A) {
  return {
    projectId: PROJECT_ID,
    data: competitorItem(competitorId),
  } as const;
}

function competitorMonitorResponse() {
  return {
    projectId: PROJECT_ID,
    config: {
      enabled: true,
      frequency: "monthly",
      revision: 1,
      updatedAt: OBSERVED_AT,
    },
    scope: {
      market: "US",
      languageTag: "en-US",
      topicModelRevision: 1,
    },
    availability: "available",
    limitation: null,
    competitors: [
      {
        competitorId: COMPETITOR_A,
        domain: "example-competitor.com",
        name: "Example Competitor",
        relationship: "direct",
        analysisScopes: ["content", "serp_visibility"],
        eligibility: "eligible",
        collectionState: "collected",
        evaluationState: "available",
        lastCollectionAt: OBSERVED_AT,
        nextCollectionAt: "2026-08-21T00:00:00.000Z",
        limitation: null,
        recentSignals: [
          {
            signalId: COMPETITOR_MONITOR_SIGNAL,
            kind: "rank_gain",
            competitorId: COMPETITOR_A,
            detectedAt: OBSERVED_AT,
            currentSnapshotId: COMPETITOR_SNAPSHOT,
            previousSnapshotId: RANK_SNAPSHOT,
            topicNodeId: TOPIC_NODE_ROOT,
            topicLabel: "Customer onboarding",
            keywordId: KEYWORD_A,
            keyword: "customer onboarding automation",
            previousRank: 13,
            currentRank: 7,
            improvement: 6,
            limitation: null,
            opportunityUpdate: {
              state: "ready",
              growthMapSection: "competitor_library",
              sourceRef:
                `competitor_monitor_signal:${COMPETITOR_MONITOR_SIGNAL}`,
            },
          },
        ],
      },
      {
        competitorId: COMPETITOR_B,
        domain: "other-competitor.com",
        name: "Other Competitor",
        relationship: "indirect",
        analysisScopes: ["content"],
        eligibility: "eligible",
        collectionState: "collected",
        evaluationState: "baseline",
        lastCollectionAt: OBSERVED_AT,
        nextCollectionAt: "2026-08-21T00:00:00.000Z",
        limitation: "首次采集仅建立 baseline，不生成竞品动态提醒。",
        recentSignals: [],
      },
    ],
    generatedAt: "2026-07-22T00:00:01.000Z",
  } as const;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Growth Map browser API boundary", () => {
  it("normalizes list params into one stable key and safely encoded URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(portfolioResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const params = {
      search: "  onboarding / setup  ",
      cursor: "next+/=",
      limit: 25,
    } as const;
    const options = buildGrowthMapUrlsQueryOptions(PROJECT_ID, UI_LOCALE, params);
    await getGrowthMapUrls(PROJECT_ID, params);

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "urls",
      {
        search: "onboarding / setup",
        cursor: "next+/=",
        limit: 25,
        diagnosticRunId: null,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/urls?limit=25&cursor=next%2B%2F%3D&search=onboarding+%2F+setup`,
      expect.any(Object),
    );
  });

  it("uses explicit defaults and omits empty optional list params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(portfolioResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const options = buildGrowthMapUrlsQueryOptions(PROJECT_ID, UI_LOCALE, {
      search: "   ",
    });
    await getGrowthMapUrls(PROJECT_ID, { search: "   " });

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "urls",
      {
        search: null,
        cursor: null,
        limit: 50,
        diagnosticRunId: null,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/urls?limit=50`,
      expect.any(Object),
    );
  });

  it("keys detail by SitePage id and disables incomplete identities", () => {
    expect(
      growthMapUrlDetailQueryKey(PROJECT_ID, UI_LOCALE, SITE_PAGE_A),
    ).not.toEqual(
      growthMapUrlDetailQueryKey(PROJECT_ID, UI_LOCALE, SITE_PAGE_B),
    );
    expect(
      buildGrowthMapUrlDetailQueryOptions(PROJECT_ID, UI_LOCALE, null).enabled,
    ).toBe(false);
    expect(
      buildGrowthMapUrlDetailQueryOptions("", UI_LOCALE, SITE_PAGE_A).enabled,
    ).toBe(false);
    expect(
      buildGrowthMapUrlDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        SITE_PAGE_A,
      ).enabled,
    ).toBe(true);
  });

  it("pins URL list and detail requests and cache keys to one Diagnostic run", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(portfolioResponse()))
      .mockResolvedValueOnce(ok(detailResponse(SITE_PAGE_A)));
    vi.stubGlobal("fetch", fetchMock);

    const listOptions = buildGrowthMapUrlsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      { limit: 1, diagnosticRunId: DIAGNOSTIC_RUN_ID },
    );
    const detailOptions = buildGrowthMapUrlDetailQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      SITE_PAGE_A,
      DIAGNOSTIC_RUN_ID,
    );
    await getGrowthMapUrls(PROJECT_ID, {
      limit: 1,
      diagnosticRunId: DIAGNOSTIC_RUN_ID,
    });
    await getGrowthMapUrlDetail(
      PROJECT_ID,
      SITE_PAGE_A,
      DIAGNOSTIC_RUN_ID,
    );

    expect(listOptions.queryKey).toContainEqual({
      search: null,
      cursor: null,
      limit: 1,
      diagnosticRunId: DIAGNOSTIC_RUN_ID,
    });
    expect(detailOptions.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "url",
      SITE_PAGE_A,
      DIAGNOSTIC_RUN_ID,
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/mvp/projects/${PROJECT_ID}/audit/urls?limit=1&diagnosticRunId=${DIAGNOSTIC_RUN_ID}`,
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/mvp/projects/${PROJECT_ID}/audit/urls/${SITE_PAGE_A}?diagnosticRunId=${DIAGNOSTIC_RUN_ID}`,
      expect.any(Object),
    );
  });

  it("re-validates a presentational execution preview independently from canonical execution state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(ok(detailResponseWithExecutionPreview(SITE_PAGE_A)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getGrowthMapUrlDetail(PROJECT_ID, SITE_PAGE_A);

    expect(result.data.findings[0]).toMatchObject({
      findingId: URL_FINDING,
      executionPreview: {
        contentLocale: "en",
        title: "Fix non-200 indexable URLs",
        artifactType: "technical_ticket",
      },
      executionRef: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/urls/${SITE_PAGE_A}`,
      expect.any(Object),
    );
  });

  it("fails before transport for a non-canonical URL generation pin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getGrowthMapUrls(PROJECT_ID, {
        diagnosticRunId:
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(),
      }),
    ).rejects.toThrow("canonical lowercase UUID");
    await expect(
      getGrowthMapUrlDetail(PROJECT_ID, SITE_PAGE_A, "not-a-run"),
    ).rejects.toThrow("canonical lowercase UUID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isolates portfolio and exact-detail caches by active UI locale", () => {
    expect(growthMapUrlsQueryKey(PROJECT_ID, "en", { limit: 25 })).not.toEqual(
      growthMapUrlsQueryKey(PROJECT_ID, "zh-CN", { limit: 25 }),
    );
    expect(
      growthMapUrlDetailQueryKey(PROJECT_ID, "en", SITE_PAGE_A),
    ).not.toEqual(
      growthMapUrlDetailQueryKey(PROJECT_ID, "zh-CN", SITE_PAGE_A),
    );
  });

  it("switching SitePage id performs a distinct detail request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(detailResponse(SITE_PAGE_A)))
      .mockResolvedValueOnce(ok(detailResponse(SITE_PAGE_B)));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(
      client,
      buildGrowthMapUrlDetailQueryOptions(PROJECT_ID, UI_LOCALE, SITE_PAGE_A),
    );

    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    observer.setOptions(
      buildGrowthMapUrlDetailQueryOptions(PROJECT_ID, UI_LOCALE, SITE_PAGE_B),
    );
    await observer.refetch();
    unsubscribe();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/audit/urls/${SITE_PAGE_A}`,
      `/api/mvp/projects/${PROJECT_ID}/audit/urls/${SITE_PAGE_B}`,
    ]);
  });

  it("does not construct a fetch for an empty selected id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapUrlDetail(PROJECT_ID, null)).rejects.toThrow(
      "sitePageId",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keys selected Internal Link Maps exactly while keeping the graph overview readable", () => {
    expect(
      growthMapInternalLinkMapQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        SITE_PAGE_A,
      ),
    ).not.toEqual(
      growthMapInternalLinkMapQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        SITE_PAGE_B,
      ),
    );
    const overviewOptions = buildGrowthMapInternalLinkMapQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      null,
    );
    expect(overviewOptions.enabled).toBe(true);
    expect(overviewOptions.staleTime).toBe(0);
    expect(
      buildGrowthMapInternalLinkMapQueryOptions(
        "",
        UI_LOCALE,
        SITE_PAGE_A,
      ).enabled,
    ).toBe(false);
  });

  it("switching URL performs a distinct Internal Link Map request without reusing the first page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(internalLinkMapResponse(SITE_PAGE_A)))
      .mockResolvedValueOnce(ok(internalLinkMapResponse(SITE_PAGE_B)));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(
      client,
      buildGrowthMapInternalLinkMapQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        SITE_PAGE_A,
      ),
    );

    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    observer.setOptions(
      buildGrowthMapInternalLinkMapQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        SITE_PAGE_B,
      ),
    );
    await observer.refetch();
    unsubscribe();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/audit/internal-link-map?sitePageId=${SITE_PAGE_A}`,
      `/api/mvp/projects/${PROJECT_ID}/audit/internal-link-map?sitePageId=${SITE_PAGE_B}`,
    ]);
  });

  it("fetches the documented Internal Link Map graph overview without a selected SitePage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          ...internalLinkMapResponse(SITE_PAGE_A),
          selectedPage: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getGrowthMapInternalLinkMap(PROJECT_ID, null);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/internal-link-map`,
      expect.any(Object),
    );
  });

  it("exports deterministic query-key helpers for list identity", () => {
    expect(growthMapUrlsQueryKey(PROJECT_ID, UI_LOCALE, { limit: 25 })).toEqual(
      growthMapUrlsQueryKey(PROJECT_ID, UI_LOCALE, {
        limit: 25,
        search: "",
        cursor: null,
      }),
    );
  });

  it("invalidates the URL portfolio, exact detail, and exact link-map refs after one Finding review", async () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);

    await refreshGrowthMapAfterFindingReview(
      client,
      PROJECT_ID,
      UI_LOCALE,
      SITE_PAGE_A,
    );

    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenNthCalledWith(1, {
      queryKey: ["growth-map", PROJECT_ID, UI_LOCALE, "urls"],
      refetchType: "active",
    });
    expect(invalidate).toHaveBeenNthCalledWith(2, {
      queryKey: [
        "growth-map",
        PROJECT_ID,
        UI_LOCALE,
        "url",
        SITE_PAGE_A,
      ],
      refetchType: "active",
    });
    expect(invalidate).toHaveBeenNthCalledWith(3, {
      queryKey: growthMapInternalLinkMapQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        SITE_PAGE_A,
      ),
      refetchType: "active",
    });
  });

  it("rejects an over-budget search before any browser request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getGrowthMapUrls(PROJECT_ID, { search: "x".repeat(257) }),
    ).rejects.toThrow("256");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on an untraceable server projection instead of fabricating rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        projectId: PROJECT_ID,
        data: [{ normalizedUrl: "https://example.test/invented/" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapUrls(PROJECT_ID)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes Keyword cursor params into one stable key and safely encoded URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(keywordLibraryResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const params = { cursor: "next+/=", limit: 25 } as const;
    const options = buildGrowthMapKeywordsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      params,
    );
    await getGrowthMapKeywords(PROJECT_ID, params);

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "keywords",
      { cursor: "next+/=", limit: 25, diagnosticRunId: null },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords?limit=25&cursor=next%2B%2F%3D`,
      expect.any(Object),
    );
  });

  it("uses the documented Keyword page default and omits an empty cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(keywordLibraryResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const options = buildGrowthMapKeywordsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      { cursor: "" },
    );
    await getGrowthMapKeywords(PROJECT_ID, { cursor: "" });

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "keywords",
      { cursor: null, limit: 50, diagnosticRunId: null },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords?limit=50`,
      expect.any(Object),
    );
  });

  it("includes a normalized diagnosticRunId pin in the published Keyword list key and path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(keywordLibraryResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const options = buildGrowthMapKeywordsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      {
        cursor: "",
        diagnosticRunId: KEYWORD_DIAGNOSTIC_RUN,
      },
    );
    await getGrowthMapKeywords(PROJECT_ID, {
      cursor: "",
      diagnosticRunId: KEYWORD_DIAGNOSTIC_RUN,
    });

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "keywords",
      {
        cursor: null,
        limit: 50,
        diagnosticRunId: KEYWORD_DIAGNOSTIC_RUN,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords?limit=50&diagnosticRunId=${KEYWORD_DIAGNOSTIC_RUN}`,
      expect.any(Object),
    );
  });

  it("keys Keyword detail by exact id and active UI locale", () => {
    expect(
      growthMapKeywordDetailQueryKey(PROJECT_ID, UI_LOCALE, KEYWORD_A),
    ).not.toEqual(
      growthMapKeywordDetailQueryKey(PROJECT_ID, UI_LOCALE, KEYWORD_B),
    );
    expect(
      growthMapKeywordDetailQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
        KEYWORD_DIAGNOSTIC_RUN,
      ),
    ).not.toEqual(
      growthMapKeywordDetailQueryKey(PROJECT_ID, UI_LOCALE, KEYWORD_A),
    );
    expect(
      growthMapKeywordsQueryKey(PROJECT_ID, "en", { limit: 25 }),
    ).not.toEqual(
      growthMapKeywordsQueryKey(PROJECT_ID, "zh-CN", { limit: 25 }),
    );
    expect(
      buildGrowthMapKeywordDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        null,
      ).enabled,
    ).toBe(false);
    expect(
      buildGrowthMapKeywordDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
      ).enabled,
    ).toBe(true);
    expect(
      growthMapKeywordReviewDetailQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
      ),
    ).not.toEqual(
      growthMapKeywordDetailQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
      ),
    );
    expect(
      buildGrowthMapKeywordReviewDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        null,
      ).enabled,
    ).toBe(false);
  });

  it("switching Keyword id performs a distinct detail request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(keywordDetailResponse(KEYWORD_A)))
      .mockResolvedValueOnce(ok(keywordDetailResponse(KEYWORD_B)));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(
      client,
      buildGrowthMapKeywordDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
      ),
    );

    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    observer.setOptions(
      buildGrowthMapKeywordDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_B,
      ),
    );
    await observer.refetch();
    unsubscribe();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_A}`,
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_B}`,
    ]);
  });

  it("includes a normalized diagnosticRunId pin in the published Keyword detail key and path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(keywordDetailResponse(KEYWORD_A)));
    vi.stubGlobal("fetch", fetchMock);

    const options = buildGrowthMapKeywordDetailQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      KEYWORD_A,
      KEYWORD_DIAGNOSTIC_RUN,
    );
    await getGrowthMapKeywordDetail(
      PROJECT_ID,
      KEYWORD_A,
      KEYWORD_DIAGNOSTIC_RUN,
    );

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "keyword",
      KEYWORD_A,
      KEYWORD_DIAGNOSTIC_RUN,
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_A}?diagnosticRunId=${KEYWORD_DIAGNOSTIC_RUN}`,
      expect.any(Object),
    );
  });

  it("reads live review detail from the exact review endpoint instead of the published customer path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(keywordDetailResponse(KEYWORD_A)));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getGrowthMapKeywordReviewDetail(
      PROJECT_ID,
      KEYWORD_A,
    );

    expect(response.data.keywordId).toBe(KEYWORD_A);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_A}?view=review`,
      expect.any(Object),
    );
  });

  it("never adds diagnosticRunId to the live review detail path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(keywordDetailResponse(KEYWORD_A)));
    vi.stubGlobal("fetch", fetchMock);

    await getGrowthMapKeywordReviewDetail(PROJECT_ID, KEYWORD_A);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(
      "diagnosticRunId",
    );
  });

  it("does not construct a Keyword detail request without an exact id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapKeywordDetail(PROJECT_ID, null)).rejects.toThrow(
      "keywordId",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the exact existing Keyword review CAS body without client-owned facts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        projectId: PROJECT_ID,
        data: {
          ...keywordItem(),
          status: "approved",
          revision: 1,
          intent: "commercial",
          buyerStage: "consideration",
          cluster: {
            clusterId: TOPIC_NODE_CHILD,
            name: "Onboarding automation",
          },
          classificationLimitations: {
            intent: null,
            buyerStage: null,
            cluster: null,
          },
          mappedTarget: {
            kind: "existing_page",
            reviewState: "approved",
            revision: 1,
            reason: "Confirm the governed Topic and canonical page.",
            sitePageId: SITE_PAGE_A,
            normalizedUrl: "https://example.test/customer-onboarding/",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      expectedGovernanceRevision: 0,
      status: "approved",
      intent: "commercial",
      buyerStage: "consideration",
      topicNodeId: TOPIC_NODE_CHILD,
      topicModelRevision: 1,
      mappingDecision: "existing_page",
      mappedSitePageId: SITE_PAGE_A,
      reason: "Confirm the governed Topic and canonical page.",
    } as const;

    const response = await reviewGrowthMapKeyword(
      PROJECT_ID,
      KEYWORD_A,
      body,
    );

    expect(response.data.revision).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_A}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );
  });

  it("refreshes only the live review-detail cache after a review conflict", async () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);

    await invalidateGrowthMapAfterKeywordReview(
      client,
      PROJECT_ID,
      UI_LOCALE,
      KEYWORD_A,
    );

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: growthMapKeywordReviewDetailQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
      ),
      refetchType: "active",
    });
  });

  it("fetches and validates the selected Keyword's fixed 90-day rank history", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(keywordRankHistory()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getGrowthMapKeywordRankHistory(PROJECT_ID, KEYWORD_A);
    const options = buildGrowthMapKeywordRankHistoryQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      KEYWORD_A,
    );

    expect(result.keywordId).toBe(KEYWORD_A);
    expect(result.window.days).toBe(90);
    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "keyword",
      KEYWORD_A,
      "rank-history",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_A}/rank-history`,
      expect.any(Object),
    );
  });

  it("isolates rank-history caches per Keyword and disables an empty identity", () => {
    expect(
      growthMapKeywordRankHistoryQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
      ),
    ).not.toEqual(
      growthMapKeywordRankHistoryQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_B,
      ),
    );
    expect(
      buildGrowthMapKeywordRankHistoryQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        null,
      ).enabled,
    ).toBe(false);
  });

  it("switching Keyword id performs a distinct rank-history request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(keywordRankHistory(KEYWORD_A)))
      .mockResolvedValueOnce(ok(keywordRankHistory(KEYWORD_B)));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(
      client,
      buildGrowthMapKeywordRankHistoryQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_A,
      ),
    );

    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    observer.setOptions(
      buildGrowthMapKeywordRankHistoryQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        KEYWORD_B,
      ),
    );
    await observer.refetch();
    unsubscribe();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_A}/rank-history`,
      `/api/mvp/projects/${PROJECT_ID}/audit/keywords/${KEYWORD_B}/rank-history`,
    ]);
  });

  it("does not construct rank-history fetches without an exact Keyword id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getGrowthMapKeywordRankHistory(PROJECT_ID, null),
    ).rejects.toThrow("keywordId");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when rank history violates the fixed-window contract", async () => {
    const invalid = {
      ...keywordRankHistory(),
      window: {
        startedAt: "2026-06-21T00:00:00.000Z",
        endedAt: "2026-07-21T00:00:00.000Z",
        days: 30,
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(ok(invalid));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getGrowthMapKeywordRankHistory(PROJECT_ID, KEYWORD_A),
    ).rejects.toThrow();
  });

  it("batch-loads Keyword Relations with one stable sorted current-page query", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(ok(keywordRelationListResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const query = {
      keywordIds: [KEYWORD_B, KEYWORD_A],
      limit: 100,
    } as const;

    const options = buildGrowthMapKeywordRelationsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      query,
    );
    const result = await getGrowthMapKeywordRelations(
      PROJECT_ID,
      query,
    );

    expect(result.data[0]?.relationId).toBe(KEYWORD_RELATION);
    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "keyword-relations",
      {
        keywordIds: [KEYWORD_A, KEYWORD_B],
        cursor: null,
        limit: 100,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keyword-relations?limit=100&keywordId=${KEYWORD_A}&keywordId=${KEYWORD_B}`,
      expect.any(Object),
    );
  });

  it("disables an empty relation batch and rejects duplicate IDs before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      buildGrowthMapKeywordRelationsQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        { keywordIds: [] },
      ).enabled,
    ).toBe(false);
    await expect(
      getGrowthMapKeywordRelations(PROJECT_ID, { keywordIds: [] }),
    ).rejects.toThrow("keywordId");
    expect(() =>
      growthMapKeywordRelationsQueryKey(PROJECT_ID, UI_LOCALE, {
        keywordIds: [KEYWORD_A, KEYWORD_A],
      }),
    ).toThrow("unique");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes candidates without sending caller-owned server facts", async () => {
    const response = {
      projectId: PROJECT_ID,
      eligiblePairCount: 1,
      createdRelationCount: 1,
      createdCandidateCount: 1,
      generatedAt: "2026-07-21T00:10:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(ok(response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      refreshGrowthMapKeywordRelations(PROJECT_ID),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keyword-relations`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(
      new Headers(init.headers).has("Content-Type"),
    ).toBe(false);
  });

  it("sends one strict CAS decision and rejects widened decision input", async () => {
    const body = {
      expectedRelationRevision: 0,
      candidateId: KEYWORD_RELATION_CANDIDATE,
      decisionKind: "primary_supporting",
      primaryKeywordId: KEYWORD_A,
      supportingKeywordId: KEYWORD_B,
      reason: "Use the first Keyword as primary.",
    } as const;
    const response = {
      data: foldedKeywordRelation(),
      replayed: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(ok(response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      decideGrowthMapKeywordRelation(PROJECT_ID, {
        relationId: KEYWORD_RELATION,
        body,
      }),
    ).resolves.toMatchObject({
      data: { displayState: "folded" },
      replayed: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/keyword-relations/${KEYWORD_RELATION}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );

    await expect(
      decideGrowthMapKeywordRelation(PROJECT_ID, {
        relationId: KEYWORD_RELATION,
        body: { ...body, decidedBy: KEYWORD_RELATION_ACTOR } as never,
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates only active relation batches after refresh, decision, or 409 recovery", async () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);

    await invalidateGrowthMapKeywordRelations(
      client,
      PROJECT_ID,
      UI_LOCALE,
    );

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        "growth-map",
        PROJECT_ID,
        UI_LOCALE,
        "keyword-relations",
      ],
      refetchType: "active",
    });
  });

  it("reads the Topic Model workspace and confirmed-only insights with distinct stable keys", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(topicWorkspace()))
      .mockResolvedValueOnce(ok(topicInsights()));
    vi.stubGlobal("fetch", fetchMock);

    const workspaceOptions =
      buildGrowthMapTopicModelWorkspaceQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
      );
    const insightsOptions =
      buildGrowthMapTopicModelInsightsQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
      );
    const [workspace, insights] = await Promise.all([
      getGrowthMapTopicModelWorkspace(PROJECT_ID),
      getGrowthMapTopicModelInsights(PROJECT_ID),
    ]);

    expect(workspace.latestConfirmed?.topicModelRevision).toBe(1);
    expect(insights.topicModelRevision).toBe(1);
    expect(workspaceOptions.queryKey).toEqual(
      growthMapTopicModelWorkspaceQueryKey(PROJECT_ID, UI_LOCALE),
    );
    expect(insightsOptions.queryKey).toEqual(
      growthMapTopicModelInsightsQueryKey(PROJECT_ID, UI_LOCALE),
    );
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/audit/topic-model`,
      `/api/mvp/projects/${PROJECT_ID}/audit/topic-model/insights`,
    ]);
  });

  it("sends strict begin, retire-patch, and confirm Topic Model CAS commands", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(topicWorkspace({ draftEditRevision: 2 })))
      .mockResolvedValueOnce(ok(topicWorkspace({ draftEditRevision: 3 })))
      .mockResolvedValueOnce(ok(topicWorkspace()));
    vi.stubGlobal("fetch", fetchMock);
    const beginBody = {
      expectedLatestConfirmedRevision: 1,
      reason: "Start a reviewed Topic Map revision.",
    } as const;
    const patchBody: Parameters<
      typeof patchGrowthMapTopicModelDraft
    >[1] = {
      topicModelRevision: 2,
      expectedEditRevision: 2,
      reason: "Retire an obsolete Topic while retaining history.",
      intents: [
        {
          kind: "retire",
          topicNodeId: TOPIC_NODE_CHILD,
          affectedKeywordReviewState: "unreviewed",
        },
      ],
    };
    const confirmBody = {
      topicModelRevision: 2,
      expectedEditRevision: 3,
      reason: "Publish the reviewed Topic Map revision.",
    } as const;

    await beginGrowthMapTopicModelDraft(PROJECT_ID, beginBody);
    await patchGrowthMapTopicModelDraft(PROJECT_ID, patchBody);
    await confirmGrowthMapTopicModelDraft(PROJECT_ID, confirmBody);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/audit/topic-model/draft`,
      `/api/mvp/projects/${PROJECT_ID}/audit/topic-model/draft`,
      `/api/mvp/projects/${PROJECT_ID}/audit/topic-model/draft/confirm`,
    ]);
    expect(
      fetchMock.mock.calls.map(
        ([, init]) => (init as RequestInit).method,
      ),
    ).toEqual(["POST", "PATCH", "POST"]);
    expect(
      fetchMock.mock.calls.map(
        ([, init]) => JSON.parse(String((init as RequestInit).body)),
      ),
    ).toEqual([beginBody, patchBody, confirmBody]);

    await expect(
      beginGrowthMapTopicModelDraft(PROJECT_ID, {
        ...beginBody,
        actorId: TOPIC_ACTOR,
      } as never),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps draft invalidation isolated and refreshes confirmed consumers only after publication", async () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);

    await invalidateGrowthMapTopicModelDraft(
      client,
      PROJECT_ID,
      UI_LOCALE,
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: growthMapTopicModelWorkspaceQueryKey(
        PROJECT_ID,
        UI_LOCALE,
      ),
      refetchType: "active",
    });

    invalidate.mockClear();
    await invalidateGrowthMapTopicModelAfterConflict(
      client,
      PROJECT_ID,
      UI_LOCALE,
    );
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: growthMapTopicModelWorkspaceQueryKey(
        PROJECT_ID,
        UI_LOCALE,
      ),
      refetchType: "active",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: growthMapTopicModelInsightsQueryKey(
        PROJECT_ID,
        UI_LOCALE,
      ),
      refetchType: "active",
    });

    invalidate.mockClear();
    await invalidateGrowthMapAfterTopicModelConfirmation(
      client,
      PROJECT_ID,
      UI_LOCALE,
    );
    expect(invalidate).toHaveBeenCalledTimes(5);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: growthMapTopicModelInsightsQueryKey(
        PROJECT_ID,
        UI_LOCALE,
      ),
      refetchType: "active",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["growth-map", PROJECT_ID, UI_LOCALE, "keywords"],
      refetchType: "active",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["growth-map", PROJECT_ID, UI_LOCALE, "keyword"],
      refetchType: "active",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        "growth-map",
        PROJECT_ID,
        UI_LOCALE,
        "keyword-relations",
      ],
      refetchType: "active",
    });
  });

  it("fails closed on an invalid Keyword Library projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        projectId: PROJECT_ID,
        data: [{ keywordId: KEYWORD_A, displayKeyword: "invented score" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapKeywords(PROJECT_ID)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes Competitor cursor params into one stable key and encoded URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(competitorLibraryResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const params = { cursor: "next+/=", limit: 25 } as const;
    const options = buildGrowthMapCompetitorsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      params,
    );
    await getGrowthMapCompetitors(PROJECT_ID, params);

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "competitors",
      { cursor: "next+/=", limit: 25, diagnosticRunId: null },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/competitors?limit=25&cursor=next%2B%2F%3D`,
      expect.any(Object),
    );
  });

  it("uses the Competitor page default and omits an empty cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(competitorLibraryResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const options = buildGrowthMapCompetitorsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      { cursor: "" },
    );
    await getGrowthMapCompetitors(PROJECT_ID, { cursor: "" });

    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "competitors",
      { cursor: null, limit: 50, diagnosticRunId: null },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/competitors?limit=50`,
      expect.any(Object),
    );
  });

  it("keys Competitor detail by exact id and active UI locale", () => {
    expect(
      growthMapCompetitorDetailQueryKey(PROJECT_ID, UI_LOCALE, COMPETITOR_A),
    ).not.toEqual(
      growthMapCompetitorDetailQueryKey(PROJECT_ID, UI_LOCALE, COMPETITOR_B),
    );
    expect(
      growthMapCompetitorsQueryKey(PROJECT_ID, "en", { limit: 25 }),
    ).not.toEqual(
      growthMapCompetitorsQueryKey(PROJECT_ID, "zh-CN", { limit: 25 }),
    );
    expect(
      buildGrowthMapCompetitorDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        null,
      ).enabled,
    ).toBe(false);
    expect(
      buildGrowthMapCompetitorDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        COMPETITOR_A,
      ).enabled,
    ).toBe(true);
  });

  it("pins Competitor list and detail requests and cache keys to one Diagnostic run", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(competitorLibraryResponse()))
      .mockResolvedValueOnce(ok(competitorDetailResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const listOptions = buildGrowthMapCompetitorsQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      { limit: 1, diagnosticRunId: DIAGNOSTIC_RUN_ID },
    );
    const detailOptions = buildGrowthMapCompetitorDetailQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      COMPETITOR_A,
      DIAGNOSTIC_RUN_ID,
    );
    await getGrowthMapCompetitors(PROJECT_ID, {
      limit: 1,
      diagnosticRunId: DIAGNOSTIC_RUN_ID,
    });
    await getGrowthMapCompetitorDetail(
      PROJECT_ID,
      COMPETITOR_A,
      DIAGNOSTIC_RUN_ID,
    );

    expect(listOptions.queryKey).toContainEqual({
      cursor: null,
      limit: 1,
      diagnosticRunId: DIAGNOSTIC_RUN_ID,
    });
    expect(detailOptions.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "competitor",
      COMPETITOR_A,
      DIAGNOSTIC_RUN_ID,
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/mvp/projects/${PROJECT_ID}/audit/competitors?limit=1&diagnosticRunId=${DIAGNOSTIC_RUN_ID}`,
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/mvp/projects/${PROJECT_ID}/audit/competitors/${COMPETITOR_A}?diagnosticRunId=${DIAGNOSTIC_RUN_ID}`,
      expect.any(Object),
    );
  });

  it("reads live Competitor review authority from an isolated key and review path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(competitorDetailResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const options = buildGrowthMapCompetitorReviewDetailQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
      COMPETITOR_A,
    );
    const response = await getGrowthMapCompetitorReviewDetail(
      PROJECT_ID,
      COMPETITOR_A,
    );

    expect(response.data.competitorId).toBe(COMPETITOR_A);
    expect(options.queryKey).toEqual([
      "growth-map",
      PROJECT_ID,
      UI_LOCALE,
      "competitor-review",
      COMPETITOR_A,
    ]);
    expect(options.queryKey).not.toEqual(
      growthMapCompetitorDetailQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        COMPETITOR_A,
        DIAGNOSTIC_RUN_ID,
      ),
    );
    expect(
      buildGrowthMapCompetitorReviewDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        null,
      ).enabled,
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/competitors/${COMPETITOR_A}?view=review`,
      expect.any(Object),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(
      "diagnosticRunId",
    );
  });

  it("sends the exact Competitor governance CAS body to PATCH without a query", async () => {
    const updated = {
      projectId: PROJECT_ID,
      data: {
        ...competitorItem(),
        name: "Reviewed Competitor",
        reviewStatus: "approved",
        relationship: "direct",
        analysisScope: ["keyword_gap", "content"],
        revision: 1,
      },
    } as const;
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(updated));
    vi.stubGlobal("fetch", fetchMock);
    const body: Parameters<typeof reviewGrowthMapCompetitor>[2] = {
      expectedRevision: 0,
      name: "Reviewed Competitor",
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["keyword_gap", "content"],
    };

    const response = await reviewGrowthMapCompetitor(
      PROJECT_ID,
      COMPETITOR_A,
      body,
    );

    expect(response.data.revision).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/competitors/${COMPETITOR_A}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("?");

    await expect(
      reviewGrowthMapCompetitor(PROJECT_ID, COMPETITOR_A, {
        ...body,
        relationship: null,
      }),
    ).rejects.toThrow("relationship");
    await expect(
      reviewGrowthMapCompetitor(PROJECT_ID, COMPETITOR_A, {
        ...body,
        analysisScope: [],
      }),
    ).rejects.toThrow("analysis scope");
    await expect(
      reviewGrowthMapCompetitor(PROJECT_ID, COMPETITOR_A, {
        ...body,
        reviewStatus: "candidate",
      }),
    ).rejects.toThrow("must not retain");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updates only live Competitor review cache after a successful review", async () => {
    const publishedDetail = competitorDetailResponse();
    const publishedList = competitorLibraryResponse();
    const updated = {
      projectId: PROJECT_ID,
      data: {
        ...competitorItem(),
        name: "Reviewed Competitor",
        reviewStatus: "approved",
        relationship: "direct",
        analysisScope: ["keyword_gap"],
        revision: 1,
      },
    } as const;
    const body: Parameters<typeof reviewGrowthMapCompetitor>[2] = {
      expectedRevision: 0,
      name: "Reviewed Competitor",
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["keyword_gap"],
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(updated));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const reviewKey = growthMapCompetitorReviewDetailQueryKey(
      PROJECT_ID,
      UI_LOCALE,
      COMPETITOR_A,
    );
    const publishedDetailKey = growthMapCompetitorDetailQueryKey(
      PROJECT_ID,
      UI_LOCALE,
      COMPETITOR_A,
      DIAGNOSTIC_RUN_ID,
    );
    const publishedListKey = growthMapCompetitorsQueryKey(
      PROJECT_ID,
      UI_LOCALE,
      { limit: 50, diagnosticRunId: DIAGNOSTIC_RUN_ID },
    );
    client.setQueryData(reviewKey, publishedDetail);
    client.setQueryData(publishedDetailKey, publishedDetail);
    client.setQueryData(publishedListKey, publishedList);
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);
    const observer = new MutationObserver(
      client,
      buildReviewGrowthMapCompetitorMutationOptions(
        client,
        PROJECT_ID,
        UI_LOCALE,
        COMPETITOR_A,
      ),
    );

    await expect(observer.mutate(body)).resolves.toEqual(updated);

    expect(client.getQueryData(reviewKey)).toEqual(updated);
    expect(client.getQueryData(publishedDetailKey)).toEqual(publishedDetail);
    expect(client.getQueryData(publishedListKey)).toEqual(publishedList);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates only live Competitor review cache after a CAS conflict", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: "https://example.test/problems/version-conflict",
          title: "Version conflict",
          status: 409,
          code: "VERSION_CONFLICT",
          detail: "The Competitor review revision has changed.",
          requestId: "request-competitor-review-conflict",
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);
    const observer = new MutationObserver(
      client,
      buildReviewGrowthMapCompetitorMutationOptions(
        client,
        PROJECT_ID,
        UI_LOCALE,
        COMPETITOR_A,
      ),
    );
    const body: Parameters<typeof reviewGrowthMapCompetitor>[2] = {
      expectedRevision: 0,
      name: null,
      reviewStatus: "candidate",
      relationship: null,
      analysisScope: [],
    };

    const result = observer.mutate(body);

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ status: 409 });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: growthMapCompetitorReviewDetailQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        COMPETITOR_A,
      ),
      refetchType: "active",
    });
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: growthMapCompetitorDetailQueryKey(
          PROJECT_ID,
          UI_LOCALE,
          COMPETITOR_A,
          DIAGNOSTIC_RUN_ID,
        ),
      }),
    );
  });

  it("refreshes only the live Competitor review detail key directly", async () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);

    await invalidateGrowthMapAfterCompetitorReview(
      client,
      PROJECT_ID,
      UI_LOCALE,
      COMPETITOR_A,
    );

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: growthMapCompetitorReviewDetailQueryKey(
        PROJECT_ID,
        UI_LOCALE,
        COMPETITOR_A,
      ),
      refetchType: "active",
    });
  });

  it("reads one locale-scoped monitor projection for all visible Competitors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(ok(competitorMonitorResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getGrowthMapCompetitorMonitor(PROJECT_ID);
    const options = buildGrowthMapCompetitorMonitorQueryOptions(
      PROJECT_ID,
      UI_LOCALE,
    );

    expect(result.competitors.map((item) => item.competitorId)).toEqual([
      COMPETITOR_A,
      COMPETITOR_B,
    ]);
    expect(options.queryKey).toEqual(
      growthMapCompetitorMonitorQueryKey(PROJECT_ID, UI_LOCALE),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/competitor-monitor`,
      expect.any(Object),
    );
  });

  it("updates strict monthly monitor config and refreshes only the current-locale canonical cache", async () => {
    const previous = competitorMonitorResponse();
    const updated = {
      enabled: false,
      frequency: "monthly",
      revision: 2,
      updatedAt: "2026-07-22T00:00:00.000Z",
    } as const;
    const body = {
      expectedRevision: 1,
      enabled: false,
      frequency: "monthly",
    } as const;
    const fetchMock = vi.fn().mockResolvedValue(ok(updated));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const activeKey = growthMapCompetitorMonitorQueryKey(
      PROJECT_ID,
      UI_LOCALE,
    );
    const otherLocaleKey = growthMapCompetitorMonitorQueryKey(
      PROJECT_ID,
      "zh-CN",
    );
    client.setQueryData(activeKey, previous);
    client.setQueryData(otherLocaleKey, previous);
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);
    const observer = new MutationObserver(
      client,
      buildGrowthMapCompetitorMonitorMutationOptions(
        client,
        PROJECT_ID,
        UI_LOCALE,
      ),
    );

    await expect(observer.mutate(body)).resolves.toEqual(updated);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/mvp/projects/${PROJECT_ID}/audit/competitor-monitor`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
    expect(client.getQueryData(activeKey)).toEqual(previous);
    expect(client.getQueryData(otherLocaleKey)).toEqual(previous);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: activeKey,
      refetchType: "active",
    });

    await expect(
      updateGrowthMapCompetitorMonitor(PROJECT_ID, {
        ...body,
        actorId: TOPIC_ACTOR,
      } as never),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the canonical monitor cache intact and surfaces ApiError on a revision conflict", async () => {
    const previous = competitorMonitorResponse();
    const body = {
      expectedRevision: 1,
      enabled: false,
      frequency: "monthly",
    } as const;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://example.test/problems/version-conflict",
          title: "Version conflict",
          status: 409,
          code: "VERSION_CONFLICT",
          detail: "The competitor monitor revision has changed.",
          requestId: "request-competitor-monitor-conflict",
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const key = growthMapCompetitorMonitorQueryKey(
      PROJECT_ID,
      UI_LOCALE,
    );
    client.setQueryData(key, previous);
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);
    const observer = new MutationObserver(
      client,
      buildGrowthMapCompetitorMonitorMutationOptions(
        client,
        PROJECT_ID,
        UI_LOCALE,
      ),
    );

    const result = observer.mutate(body);

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
    });
    expect(client.getQueryData(key)).toEqual(previous);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: key,
      refetchType: "active",
    });
  });

  it("switching Competitor id performs a distinct detail request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(competitorDetailResponse(COMPETITOR_A)))
      .mockResolvedValueOnce(ok(competitorDetailResponse(COMPETITOR_B)));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(
      client,
      buildGrowthMapCompetitorDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        COMPETITOR_A,
      ),
    );

    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    observer.setOptions(
      buildGrowthMapCompetitorDetailQueryOptions(
        PROJECT_ID,
        UI_LOCALE,
        COMPETITOR_B,
      ),
    );
    await observer.refetch();
    unsubscribe();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/audit/competitors/${COMPETITOR_A}`,
      `/api/mvp/projects/${PROJECT_ID}/audit/competitors/${COMPETITOR_B}`,
    ]);
  });

  it("does not construct a Competitor detail request without an exact id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapCompetitorDetail(PROJECT_ID, null)).rejects.toThrow(
      "competitorId",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on an invalid Competitor Library projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        projectId: PROJECT_ID,
        data: [{ competitorId: COMPETITOR_A, syntheticScore: 98 }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGrowthMapCompetitors(PROJECT_ID)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
