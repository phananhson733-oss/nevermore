import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  CompetitorMonitorResponse,
  GrowthMapBacklinkReadModel,
  GrowthMapCompetitorDetailResponse,
  GrowthMapCompetitorLibraryResponse,
  GrowthMapKeywordDetailResponse,
  GrowthMapKeywordLibraryItem,
  GrowthMapKeywordLibraryResponse,
  GrowthMapKeywordRankHistory,
} from "../packages/contracts/src/index.ts";
import {
  E2E_CANONICAL_FINDING_ID,
  E2E_ONBOARDING_SITE_PAGE_ID,
  E2E_CONTENT_FINDING_ID,
  E2E_PROJECT_ID,
  E2E_SECOND_SITE_PAGE_ID,
  growthAuditDetailFixture,
  growthAuditPortfolioFixture,
  growthInternalLinkMapFixture,
  installGrowthVerticalApi,
  overviewWorkspaceFixture,
  overrideActionFixture,
  overrideArtifactFixture,
} from "./mock-api.ts";

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const ARTIFACT_DIR =
  process.env["FOUR_MODULE_ARTIFACT_DIR"] ??
  "/tmp/nevermore-four-module-workbench";

const SEO_KEYWORD_ID = "51000000-0000-4000-8000-000000000001";
const SEO_KEYWORD_OCCURRENCE_ID = "51000000-0000-4000-8000-000000000002";
const SEO_KEYWORD_SNAPSHOT_ID = "51000000-0000-4000-8000-000000000003";
const SEO_KEYWORD_OBSERVATION_ID = "51000000-0000-4000-8000-000000000004";
const SEO_KEYWORD_CLUSTER_ID = "51000000-0000-4000-8000-000000000005";
const VOC_KEYWORD_ID = "51000000-0000-4000-8000-000000000006";
const ROOT_TOPIC_ID = "51000000-0000-4000-8000-000000000007";
const CHILD_TOPIC_ID = "51000000-0000-4000-8000-000000000008";
const TOPIC_ACTOR_ID = "51000000-0000-4000-8000-000000000009";
const KEYWORD_RELATION_ID = "51000000-0000-4000-8000-000000000019";
const KEYWORD_RELATION_CANDIDATE_ID = "51000000-0000-4000-8000-000000000020";

const COMPETITOR_A_ID = "52000000-0000-4000-8000-000000000001";
const COMPETITOR_B_ID = "52000000-0000-4000-8000-000000000002";
const COMPETITOR_TOPIC_ID = "52000000-0000-4000-8000-000000000003";
const COMPETITOR_KEYWORD_ID = "52000000-0000-4000-8000-000000000004";
const COMPETITOR_CURRENT_SNAPSHOT_ID = "52000000-0000-4000-8000-000000000005";
const COMPETITOR_PREVIOUS_SNAPSHOT_ID = "52000000-0000-4000-8000-000000000006";
const COMPETITOR_SIGNAL_ID = "52000000-0000-4000-8000-000000000007";

const BACKLINK_PRIMARY_SNAPSHOT_ID = "53000000-0000-4000-8000-000000000001";
const BACKLINK_COMPETITOR_SNAPSHOT_ID = "53000000-0000-4000-8000-000000000002";
const BACKLINK_FACT_ID = "53000000-0000-4000-8000-000000000003";

function json(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

function listEnvelope(data: readonly unknown[]) {
  return {
    data,
    meta: { limit: 100, nextCursor: null, hasNext: false },
  };
}

function metric(
  valuePointer:
    | "/valueJson/searchVolume"
    | "/valueJson/keywordDifficulty"
    | "/valueJson/currentRank"
    | "/valueJson/currentUrl",
  value: number | string,
) {
  return {
    snapshotId: SEO_KEYWORD_SNAPSHOT_ID,
    observationId: SEO_KEYWORD_OBSERVATION_ID,
    valuePointer,
    value,
    observedAt: "2026-07-25T08:00:00.000Z",
    freshness: "unknown" as const,
    limitation: "DataForSEO 未提供独立数据时点；这里保留实际采集观测时间。",
  };
}

const seoKeyword = GrowthMapKeywordLibraryItem.parse({
  projectId: E2E_PROJECT_ID,
  keywordId: SEO_KEYWORD_ID,
  displayKeyword: "customer onboarding automation",
  normalizedKeyword: "customer onboarding automation",
  marketCode: "US",
  languageTag: "en-US",
  queryKind: "search_query",
  status: "approved",
  reviewOrigin: "user",
  revision: 3,
  intent: "commercial",
  buyerStage: "consideration",
  cluster: {
    clusterId: SEO_KEYWORD_CLUSTER_ID,
    name: "Customer onboarding",
  },
  classificationLimitations: {
    intent: null,
    buyerStage: null,
    cluster: null,
  },
  mappedTarget: {
    kind: "existing_page",
    sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
    normalizedUrl: "https://example.test/customer-onboarding",
    reviewState: "approved",
    revision: 3,
    reason: "该产品页已经承接此商业搜索意图。",
  },
  sourceOccurrences: [
    {
      occurrenceId: SEO_KEYWORD_OCCURRENCE_ID,
      sourceKind: "dataforseo_ranked",
      snapshotId: SEO_KEYWORD_SNAPSHOT_ID,
      sourceObservationId: SEO_KEYWORD_OBSERVATION_ID,
      sourcePointer: "/valueJson/keyword",
      collectedAt: "2026-07-25T08:00:00.000Z",
      providerDataAsOf: null,
      freshness: "unknown",
      limitation: "DataForSEO 未提供独立数据时点；范围由冻结采集任务限定。",
      scopeBasis: "provider_collection_scope",
      scopeLimitation:
        "example.test · US · en-US · location 2840 · 前 200 条排名结果。",
      marketCode: "US",
      languageTag: "en-US",
    },
  ],
  metrics: {
    volume: metric("/valueJson/searchVolume", 2400),
    kd: metric("/valueJson/keywordDifficulty", 31),
    currentRank: metric("/valueJson/currentRank", 7),
    currentUrl: metric(
      "/valueJson/currentUrl",
      "https://example.test/customer-onboarding",
    ),
    competitorDomain: null,
    competitorRank: null,
    limitations: {
      volume: null,
      kd: null,
      currentRank: null,
      currentUrl: null,
      competitorDomain: "当前记录是自有站点排名观测。",
      competitorRank: "当前记录是自有站点排名观测。",
    },
  },
  coverage: {
    availability: "partial",
    limitations: ["竞品排名需要在竞品库的同市场证据中单独查看。"],
  },
});

const vocKeyword = GrowthMapKeywordLibraryItem.parse({
  projectId: E2E_PROJECT_ID,
  keywordId: VOC_KEYWORD_ID,
  displayKeyword: "customer onboarding friction",
  normalizedKeyword: "customer onboarding friction",
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
    intent: "搜索意图尚未审核。",
    buyerStage: "购买阶段尚未审核。",
    cluster: "关键词尚未分配到已确认话题。",
  },
  mappedTarget: {
    kind: "unassigned",
    reviewState: "unreviewed",
    revision: 0,
    reason: null,
  },
  sourceOccurrences: [
    {
      occurrenceId: "51000000-0000-4000-8000-000000000011",
      sourceKind: "interview_summary",
      collectionRunId: "51000000-0000-4000-8000-000000000012",
      snapshotId: "51000000-0000-4000-8000-000000000013",
      sourceObservationId: "51000000-0000-4000-8000-000000000014",
      sourcePointer: "/valueJson/keyword",
      collectedAt: "2026-07-22T08:00:00.000Z",
      providerDataAsOf: "2026-07-18T00:00:00.000Z",
      freshness: "current",
      limitation: null,
      scopeBasis: "user_provided",
      scopeLimitation: "客户批准的去标识化研究范围，不包含逐字稿或受访者身份。",
      marketCode: "US",
      languageTag: "en-US",
      evidenceLabel: "第二季度客户入职访谈摘要",
      sourceRecordHash: "a".repeat(64),
    },
    {
      occurrenceId: "51000000-0000-4000-8000-000000000015",
      sourceKind: "user_review",
      collectionRunId: "51000000-0000-4000-8000-000000000016",
      snapshotId: "51000000-0000-4000-8000-000000000017",
      sourceObservationId: "51000000-0000-4000-8000-000000000018",
      sourcePointer: "/valueJson/keyword",
      collectedAt: "2026-07-22T08:05:00.000Z",
      providerDataAsOf: "2026-07-19T00:00:00.000Z",
      freshness: "current",
      limitation: null,
      scopeBasis: "provider_collection_scope",
      scopeLimitation: "有限的 G2 公开评价采集范围，不代表平台完整评价全集。",
      marketCode: "US",
      languageTag: "en-US",
      evidenceLabel: "RelayOps 的 G2 公开评价语料",
      sourceRecordHash: "b".repeat(64),
      reviewPlatform: "g2",
      sourceUrl: "https://www.g2.com/products/relayops/reviews",
    },
  ],
  metrics: {
    volume: null,
    kd: null,
    currentRank: null,
    currentUrl: null,
    competitorDomain: null,
    competitorRank: null,
    limitations: {
      volume: "VOC 证据不提供搜索量观测。",
      kd: "VOC 证据不提供关键词难度观测。",
      currentRank: "VOC 证据不提供绝对排名观测。",
      currentUrl: "VOC 证据不提供排名 URL 观测。",
      competitorDomain: "VOC 证据不提供竞品域名观测。",
      competitorRank: "VOC 证据不提供竞品排名观测。",
    },
  },
  coverage: {
    availability: "partial",
    limitations: ["VOC 来源不提供搜索量、难度或排名指标。"],
  },
});

function rankPoint(input: {
  id: number;
  provider: "dataforseo" | "gsc";
  value: number;
  observedAt: string;
}) {
  const suffix = String(input.id).padStart(12, "0");
  const providerDataAsOf = input.provider === "gsc" ? input.observedAt : null;
  return {
    occurrenceId: `54000000-0000-4000-8000-${suffix}`,
    snapshotId: `54100000-0000-4000-8000-${suffix}`,
    observationId: `54200000-0000-4000-8000-${suffix}`,
    provider: input.provider,
    metric:
      input.provider === "dataforseo"
        ? ("absolute_rank" as const)
        : ("gsc_28d_average_position" as const),
    value: input.value,
    valuePointer:
      input.provider === "dataforseo"
        ? ("/valueJson/currentRank" as const)
        : (`/valueJson/topQueries/${input.id}/position` as const),
    observedAt: input.observedAt,
    providerDataAsOf,
    grade: input.provider === "dataforseo" ? ("B" as const) : ("A" as const),
    limitation:
      input.provider === "dataforseo"
        ? "绝对排名按实际采集观测时间展示。"
        : "GSC 为 28 天曝光加权平均位置，不等同于绝对排名。",
  };
}

const seoKeywordRankHistory = GrowthMapKeywordRankHistory.parse({
  projectId: E2E_PROJECT_ID,
  keywordId: SEO_KEYWORD_ID,
  mappedPage: {
    sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
    normalizedUrl: "https://example.test/customer-onboarding",
  },
  window: {
    startedAt: "2026-04-29T00:00:00.000Z",
    endedAt: "2026-07-28T00:00:00.000Z",
    days: 90,
  },
  series: [
    {
      provider: "dataforseo",
      metric: "absolute_rank",
      points: [
        rankPoint({
          id: 1,
          provider: "dataforseo",
          value: 18,
          observedAt: "2026-05-05T08:00:00.000Z",
        }),
        rankPoint({
          id: 2,
          provider: "dataforseo",
          value: 12,
          observedAt: "2026-06-15T08:00:00.000Z",
        }),
        rankPoint({
          id: 3,
          provider: "dataforseo",
          value: 7,
          observedAt: "2026-07-25T08:00:00.000Z",
        }),
      ],
      interpretation: "DataForSEO 的离散绝对排名观测。",
    },
    {
      provider: "gsc",
      metric: "gsc_28d_average_position",
      points: [
        rankPoint({
          id: 4,
          provider: "gsc",
          value: 16.5,
          observedAt: "2026-05-31T08:00:00.000Z",
        }),
        rankPoint({
          id: 5,
          provider: "gsc",
          value: 9.8,
          observedAt: "2026-07-20T08:00:00.000Z",
        }),
      ],
      interpretation: "GSC 的 28 天曝光加权平均位置。",
    },
  ],
  changeMarkers: [
    {
      changeReceiptId: "54300000-0000-4000-8000-000000000001",
      publicationAttemptId: "54300000-0000-4000-8000-000000000002",
      attemptKind: "publish",
      artifactId: "54300000-0000-4000-8000-000000000003",
      artifactRevision: 2,
      targetRef: `site-page://${E2E_ONBOARDING_SITE_PAGE_ID}`,
      liveCanonicalUrl: "https://example.test/customer-onboarding",
      changedAt: "2026-07-01T12:00:00.000Z",
    },
  ],
  coverage: { availability: "available", limitations: [] },
  generatedAt: "2026-07-28T01:00:00.000Z",
});

const vocKeywordRankHistory = GrowthMapKeywordRankHistory.parse({
  projectId: E2E_PROJECT_ID,
  keywordId: VOC_KEYWORD_ID,
  mappedPage: null,
  window: {
    startedAt: "2026-04-29T00:00:00.000Z",
    endedAt: "2026-07-28T00:00:00.000Z",
    days: 90,
  },
  series: [],
  changeMarkers: [],
  coverage: {
    availability: "unavailable",
    limitations: ["VOC 证据不提供规范排名观测，不会补值或推断。"],
  },
  generatedAt: "2026-07-28T01:00:00.000Z",
});

function keywordRelationParticipant(
  keywordId: string,
  displayKeyword: string,
  governanceRevision: number,
) {
  return {
    keywordId,
    displayKeyword,
    normalizedKeyword: displayKeyword.toLowerCase(),
    governanceRevision,
    marketCode: "US",
    languageTag: "en-US",
    intent: "commercial",
    topicNodeId: ROOT_TOPIC_ID,
    topicModelRevision: 4,
    mappedSitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
  };
}

const keywordRelation = {
  projectId: E2E_PROJECT_ID,
  relationId: KEYWORD_RELATION_ID,
  candidate: {
    candidateId: KEYWORD_RELATION_CANDIDATE_ID,
    relationId: KEYWORD_RELATION_ID,
    projectId: E2E_PROJECT_ID,
    candidateRevision: 1,
    ruleVersion: "keyword-relation.1.0.0",
    keywordA: keywordRelationParticipant(
      SEO_KEYWORD_ID,
      "customer onboarding automation",
      3,
    ),
    keywordB: keywordRelationParticipant(
      VOC_KEYWORD_ID,
      "customer onboarding friction",
      0,
    ),
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
        limitation: "当前尚无同市场、同语言的规范 SERP 重合观测。",
      },
    },
    evidenceHash: "d".repeat(64),
    generatedAt: "2026-07-28T01:00:00.000Z",
  },
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

function competitor(
  competitorId: string,
  name: string,
  domain: string,
  suffix: string,
) {
  return {
    projectId: E2E_PROJECT_ID,
    competitorId,
    domain,
    name,
    reviewStatus: "approved" as const,
    relationship: "direct" as const,
    analysisScope: ["keyword_gap", "content", "serp_visibility"] as const,
    revision: 2,
    originOccurrences: [
      {
        occurrenceId: `52000000-0000-4000-8000-0000000000${suffix}`,
        observedAt: "2026-07-28T08:00:00.000Z",
        originKind: "manual" as const,
        manualEntryId: `52100000-0000-4000-8000-0000000000${suffix}`,
        evidenceRefs: [],
      },
    ],
    lastObservedAt: "2026-07-28T08:00:00.000Z",
    serpOverlap: {
      availability: "unavailable" as const,
      value: null,
      limitation: "尚无已确认的 SERP overlap 观测。",
    },
    aiCitationInsight: {
      availability: "unavailable" as const,
      value: null,
      limitation: "尚无已确认的 AI citation 观测。",
    },
    sharedKeywordInsight: {
      availability: "unavailable" as const,
      value: null,
      limitation: "尚无覆盖该域名的规范竞品域名观测。",
    },
    coverage: { availability: "available" as const, limitations: [] },
  };
}

const competitorA = competitor(
  COMPETITOR_A_ID,
  "AtlasFlow",
  "atlasflow.com",
  "11",
);
const competitorB = competitor(
  COMPETITOR_B_ID,
  "BeaconPath",
  "beaconpath.com",
  "12",
);

const competitorLibrary = GrowthMapCompetitorLibraryResponse.parse({
  projectId: E2E_PROJECT_ID,
  data: [competitorA, competitorB],
  meta: {
    limit: 50,
    nextCursor: null,
    hasNext: false,
    coverage: { availability: "available", limitations: [] },
  },
});

const competitorMonitor = CompetitorMonitorResponse.parse({
  projectId: E2E_PROJECT_ID,
  config: {
    enabled: true,
    frequency: "monthly",
    revision: 1,
    updatedAt: "2026-07-28T08:00:00.000Z",
  },
  scope: {
    market: "US",
    languageTag: "en-US",
    topicModelRevision: 4,
  },
  availability: "available",
  limitation: null,
  competitors: [
    {
      competitorId: COMPETITOR_A_ID,
      domain: "atlasflow.com",
      name: "AtlasFlow",
      relationship: "direct",
      analysisScopes: ["content", "serp_visibility"],
      eligibility: "eligible",
      collectionState: "collected",
      evaluationState: "available",
      lastCollectionAt: "2026-07-28T08:00:00.000Z",
      nextCollectionAt: "2026-08-28T08:00:00.000Z",
      limitation: null,
      recentSignals: [
        {
          kind: "rank_gain",
          signalId: COMPETITOR_SIGNAL_ID,
          competitorId: COMPETITOR_A_ID,
          detectedAt: "2026-07-28T08:00:00.000Z",
          currentSnapshotId: COMPETITOR_CURRENT_SNAPSHOT_ID,
          previousSnapshotId: COMPETITOR_PREVIOUS_SNAPSHOT_ID,
          topicNodeId: COMPETITOR_TOPIC_ID,
          topicLabel: "客户入职自动化",
          limitation: null,
          opportunityUpdate: {
            state: "ready",
            growthMapSection: "competitor_library",
            sourceRef: `competitor_monitor_signal:${COMPETITOR_SIGNAL_ID}`,
          },
          keywordId: COMPETITOR_KEYWORD_ID,
          keyword: "customer onboarding automation",
          previousRank: 18,
          currentRank: 9,
          improvement: 9,
        },
      ],
    },
    {
      competitorId: COMPETITOR_B_ID,
      domain: "beaconpath.com",
      name: "BeaconPath",
      relationship: "direct",
      analysisScopes: ["content", "serp_visibility"],
      eligibility: "eligible",
      collectionState: "collected",
      evaluationState: "baseline",
      lastCollectionAt: "2026-07-28T08:00:00.000Z",
      nextCollectionAt: "2026-08-28T08:00:00.000Z",
      limitation: "首次采集仅建立 baseline，不生成竞品动态提醒。",
      recentSignals: [],
    },
  ],
  generatedAt: "2026-07-28T08:00:00.000Z",
});

const backlinkModel = (() => {
  const primary = {
    snapshotId: BACKLINK_PRIMARY_SNAPSHOT_ID,
    subjectKind: "primary_site" as const,
    subjectId: "53000000-0000-4000-8000-000000000011",
    subjectName: "RelayOps",
    domain: "example.test",
    sourceKind: "provider_import" as const,
    provider: "ahrefs" as const,
    capturedAt: "2026-07-28T00:00:00.000Z",
    coverage: {
      availability: "available" as const,
      indexScope: "provider_index" as const,
      limitations: [],
    },
    backlinks: { semantics: "provider_index_total" as const, value: 120 },
    referringDomains: {
      semantics: "provider_index_total" as const,
      value: 40,
    },
    authorityMetric: { kind: "domain_rating" as const, value: 42 },
    trace: {
      sourceRef: "ahrefs:example.test:2026-07",
      checksum: "a".repeat(64),
      rowCount: 120,
      importPreviewId: null,
    },
  };
  const approvedCompetitor = {
    ...primary,
    snapshotId: BACKLINK_COMPETITOR_SNAPSHOT_ID,
    subjectKind: "approved_competitor" as const,
    subjectId: "53000000-0000-4000-8000-000000000012",
    subjectName: "Userpilot",
    domain: "userpilot.example",
    backlinks: { semantics: "provider_index_total" as const, value: 940 },
    referringDomains: {
      semantics: "provider_index_total" as const,
      value: 160,
    },
    authorityMetric: { kind: "domain_rating" as const, value: 68 },
    trace: {
      sourceRef: "ahrefs:userpilot.example:2026-07",
      checksum: "b".repeat(64),
      rowCount: 940,
      importPreviewId: null,
    },
  };
  return GrowthMapBacklinkReadModel.parse({
    projectId: E2E_PROJECT_ID,
    generatedAt: "2026-07-28T01:00:00.000Z",
    coverage: primary.coverage,
    sources: [primary, approvedCompetitor],
    primarySite: primary,
    approvedCompetitors: [approvedCompetitor],
    comparison: {
      state: "comparable",
      provider: "ahrefs",
      primarySiteSnapshotId: BACKLINK_PRIMARY_SNAPSHOT_ID,
      competitorSnapshotIds: [BACKLINK_COMPETITOR_SNAPSHOT_ID],
      limitation: null,
    },
    pages: [
      {
        sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
        canonicalUrl: "https://example.test/customer-onboarding",
        title: "Customer onboarding guide",
        backlinks: { semantics: "provider_index_total", value: 0 },
        referringDomains: { semantics: "provider_index_total", value: 0 },
        snapshotId: BACKLINK_PRIMARY_SNAPSHOT_ID,
      },
      {
        sitePageId: E2E_SECOND_SITE_PAGE_ID,
        canonicalUrl: "https://example.test/pricing",
        title: "Pricing overview",
        backlinks: { semantics: "provider_index_total", value: 18 },
        referringDomains: { semantics: "provider_index_total", value: 11 },
        snapshotId: BACKLINK_PRIMARY_SNAPSHOT_ID,
      },
    ],
    referringDomains: [
      {
        domain: "example.org",
        observedBacklinks: 2,
        authorityMetric: { kind: "domain_rating", value: 61 },
        topTargetUrl: "https://example.test/customer-onboarding",
        snapshotId: BACKLINK_PRIMARY_SNAPSHOT_ID,
        factIds: [BACKLINK_FACT_ID],
      },
    ],
    opportunities: [
      {
        opportunityKey: `backlink:page:${E2E_ONBOARDING_SITE_PAGE_ID}:${BACKLINK_PRIMARY_SNAPSHOT_ID}`,
        kind: "page_without_provider_backlinks",
        severity: "medium",
        title: "核心页面尚无 Provider 观测到的外链",
        summary: "Ahrefs 当前索引中，该页面的外链与引用域均为 0。",
        sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
        evidenceSnapshotIds: [BACKLINK_PRIMARY_SNAPSHOT_ID],
        executionRef: null,
      },
    ],
  });
})();

const blogAction = overrideActionFixture(51, {
  title: "审核并发布客户入职自动化英文 Blog",
  description: "基于已确认关键词、竞品差距与来源证据完成发布审核。",
  templateId: "create_english_blog.v1",
  expectedOutcome: "覆盖海外市场的商业搜索与 AI 引用场景。",
});
const technicalAction = overrideActionFixture(52, {
  title: "修复 12 个优先 URL 的 canonical 冲突",
  description: "按冻结审计证据修复规范链接并补回归测试。",
  templateId: "fix_canonical_conflict.v1",
});
const briefAction = overrideActionFixture(53, {
  title: "确认 Customer Onboarding 对比页 Content Brief",
  description: "把 Topic、搜索意图、竞品证据和内部链接建议固化为 Brief。",
  templateId: "create_content_brief.v1",
});

const blogArtifact = {
  ...overrideArtifactFixture(51, blogAction.id),
  artifactType: "english_blog_draft" as const,
  status: "draft" as const,
  generationMode: "structured_llm" as const,
  outputLocale: "en",
  current: {
    ...overrideArtifactFixture(51, blogAction.id).current,
    content: [
      "# How to Automate Customer Onboarding Without Losing the Human Touch",
      "",
      "Customer onboarding automation should remove repetitive coordination—not the moments where a customer needs judgment, reassurance, or a clear owner.",
      "",
      "## Start with the handoff, not the tool",
      "",
      "Map the exact transition from Sales to Customer Success, define the evidence required at each step, and automate only the repeatable work.",
      "",
      "## Keep one accountable owner",
      "",
      "A reliable workflow makes responsibility visible while preserving a human escalation path for complex launches.",
    ].join("\n"),
  },
};
const technicalArtifact = {
  ...overrideArtifactFixture(52, technicalAction.id),
  artifactType: "technical_ticket" as const,
  status: "draft" as const,
  current: {
    ...overrideArtifactFixture(52, technicalAction.id).current,
    content: [
      "# Canonical repair",
      "",
      "- Replace conflicting canonical targets on 12 approved URLs.",
      "- Add an exact canonical regression test.",
      "- Verify the re-crawl before marking complete.",
    ].join("\n"),
  },
};
const briefArtifact = {
  ...overrideArtifactFixture(53, briefAction.id),
  artifactType: "content_brief" as const,
  status: "ready" as const,
  current: {
    ...overrideArtifactFixture(53, briefAction.id).current,
    content: [
      "# Content Brief — Customer Onboarding Automation",
      "",
      "Primary keyword: customer onboarding automation",
      "Intent: Commercial · Consideration",
      "Audience: Customer Operations leaders at B2B SaaS companies",
      "Required evidence: approved references, competitor gaps, FAQ and internal links",
    ].join("\n"),
  },
};

const actions = [blogAction, technicalAction, briefAction];
const artifacts = [blogArtifact, technicalArtifact, briefArtifact];

async function useChineseUi(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "zh-CN",
      domain: "localhost",
      path: "/",
    },
  ]);
}

async function installArtifactApi(page: Page): Promise<void> {
  const overview = overviewWorkspaceFixture();
  const project = {
    ...overview.project,
    clientName: "RelayOps",
    projectName: "海外增长工作台",
  };
  const workspace = {
    ...overview,
    project,
    topActions: actions,
    deliveryFocus: {
      artifactId: blogArtifact.id,
      actionId: blogArtifact.actionId,
      artifactType: blogArtifact.artifactType,
      status: blogArtifact.status,
      updatedAt: blogArtifact.updatedAt,
    },
  };
  const findingTitles = new Map([
    ["TECH-CANONICAL-002", "客户入职页面的 canonical URL 存在冲突。"],
    ["SEARCH-CTR-004", "客户入职页面已有曝光，但自然搜索点击率偏低。"],
    ["CONTENT-COVERAGE-001", "客户入职页面存在可量化的内容覆盖缺口。"],
  ]);
  const localizedPortfolio = growthAuditPortfolioFixture();

  await page.route(`**${API_BASE}`, async (route) => {
    if (route.request().method() === "GET") {
      await json(route, { data: project });
      return;
    }
    await route.fallback();
  });

  await page.route(`**${API_BASE}/workspace?*`, async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === "GET" &&
      url.searchParams.get("view") === "overview"
    ) {
      await json(route, { data: workspace });
      return;
    }
    await route.fallback();
  });

  await page.route(`**${API_BASE}/audit/urls**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    if (url.pathname === `${API_BASE}/audit/urls`) {
      await json(route, {
        data: {
          ...localizedPortfolio,
          data: localizedPortfolio.data.map((item) => ({
            ...item,
            title:
              item.sitePageId === E2E_ONBOARDING_SITE_PAGE_ID
                ? "客户入职指南"
                : "价格方案",
            coverage: {
              ...item.coverage,
              limitations: ["该 URL 暂无客户分析数据，因此不展示点击率证据。"],
            },
            priority:
              item.priority.availability === "unavailable"
                ? {
                    ...item.priority,
                    limitation: "当前诊断运行没有 Finding 指向该 URL。",
                  }
                : item.priority,
            delta: {
              ...item.delta,
              limitation: "尚无可对比的不可变审计前后复查窗口。",
            },
          })),
          meta: {
            ...localizedPortfolio.meta,
            coverage: {
              ...localizedPortfolio.meta.coverage,
              limitations: ["本次审计中有一个客户分析数据源暂不可用。"],
            },
          },
        },
      });
      return;
    }
    const sitePageId = decodeURIComponent(
      url.pathname.slice(`${API_BASE}/audit/urls/`.length),
    );
    if (
      sitePageId !== E2E_ONBOARDING_SITE_PAGE_ID &&
      sitePageId !== E2E_SECOND_SITE_PAGE_ID
    ) {
      await route.fallback();
      return;
    }
    const detail = growthAuditDetailFixture(new Set(), sitePageId);
    await json(route, {
      data: {
        ...detail,
        data: {
          ...detail.data,
          title:
            sitePageId === E2E_ONBOARDING_SITE_PAGE_ID
              ? "客户入职指南"
              : "价格方案",
          coverage: {
            ...detail.data.coverage,
            limitations: ["该 URL 暂无客户分析数据，因此不展示点击率证据。"],
          },
          priority:
            detail.data.priority.availability === "unavailable"
              ? {
                  ...detail.data.priority,
                  limitation: "当前诊断运行没有 Finding 指向该 URL。",
                }
              : detail.data.priority,
          delta: {
            ...detail.data.delta,
            limitation: "尚无可对比的不可变审计前后复查窗口。",
          },
          findings: detail.data.findings.map((finding) => ({
            ...finding,
            title: findingTitles.get(finding.ruleId) ?? finding.title,
          })),
        },
      },
    });
  });

  await page.route(`**${API_BASE}/audit/internal-link-map**`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const selectedSitePageId =
      new URL(route.request().url()).searchParams.get("sitePageId") ??
      E2E_ONBOARDING_SITE_PAGE_ID;
    const map = growthInternalLinkMapFixture(selectedSitePageId);
    await json(route, {
      data: {
        ...map,
        graph: {
          ...map.graph,
          nodes: map.graph.nodes.map((node) => ({
            ...node,
            title: node.sitePageIds.includes(E2E_ONBOARDING_SITE_PAGE_ID)
              ? "客户入职指南"
              : node.sitePageIds.includes(E2E_SECOND_SITE_PAGE_ID)
                ? "价格方案"
                : node.title,
            executionRefs: node.sitePageIds.includes(
              E2E_ONBOARDING_SITE_PAGE_ID,
            )
              ? [
                  ...node.executionRefs,
                  {
                    findingId: E2E_CONTENT_FINDING_ID,
                    actionId: null,
                  },
                ]
              : node.executionRefs,
          })),
        },
      },
    });
  });

  await page.route(`**${API_BASE}/audit/keywords**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith(`/${SEO_KEYWORD_ID}/rank-history`)) {
      await json(route, { data: seoKeywordRankHistory });
      return;
    }
    if (pathname.endsWith(`/${VOC_KEYWORD_ID}/rank-history`)) {
      await json(route, { data: vocKeywordRankHistory });
      return;
    }
    const selected = pathname.endsWith(`/${SEO_KEYWORD_ID}`)
      ? seoKeyword
      : pathname.endsWith(`/${VOC_KEYWORD_ID}`)
        ? vocKeyword
        : null;
    if (selected !== null) {
      await json(route, {
        data: GrowthMapKeywordDetailResponse.parse({
          projectId: E2E_PROJECT_ID,
          data: selected,
        }),
      });
      return;
    }
    await json(route, {
      data: GrowthMapKeywordLibraryResponse.parse({
        projectId: E2E_PROJECT_ID,
        data: [seoKeyword, vocKeyword],
        meta: {
          limit: 50,
          nextCursor: null,
          hasNext: false,
          coverage: {
            availability: "partial",
            limitations: [
              "关键词指标按各自真实来源呈现，VOC 不会补成搜索量或排名。",
            ],
          },
          sourceCounts: null,
        },
      }),
    });
  });

  await page.route(`**${API_BASE}/audit/keyword-relations**`, async (route) => {
    const url = new URL(route.request().url());
    const listPath = `${API_BASE}/audit/keyword-relations`;
    if (route.request().method() === "GET" && url.pathname === listPath) {
      await json(route, {
        data: {
          projectId: E2E_PROJECT_ID,
          data: [keywordRelation],
          meta: {
            limit: 100,
            nextCursor: null,
            hasNext: false,
            coverage: { availability: "available", limitations: [] },
          },
        },
      });
      return;
    }
    if (route.request().method() === "POST" && url.pathname === listPath) {
      await json(route, {
        data: {
          projectId: E2E_PROJECT_ID,
          eligiblePairCount: 1,
          createdRelationCount: 0,
          createdCandidateCount: 0,
          generatedAt: "2026-07-28T01:00:00.000Z",
        },
      });
      return;
    }
    await route.fallback();
  });

  await page.route(`${`**${API_BASE}/audit/topic-model`}`, async (route) => {
    const topicNode = (
      topicNodeId: string,
      parentTopicNodeId: string | null,
      label: string,
    ) => ({
      projectId: E2E_PROJECT_ID,
      topicNodeId,
      topicModelRevision: 4,
      parentTopicNodeId,
      label,
      description: null,
      intentEnvelope: [],
      lifecycleState: "active",
    });
    await json(route, {
      data: {
        projectId: E2E_PROJECT_ID,
        latestConfirmed: {
          projectId: E2E_PROJECT_ID,
          topicModelRevision: 4,
          editRevision: 6,
          rootTopicNodeId: ROOT_TOPIC_ID,
          nodes: [
            topicNode(ROOT_TOPIC_ID, null, "客户入职"),
            topicNode(CHILD_TOPIC_ID, ROOT_TOPIC_ID, "流程自动化"),
          ],
          aliases: [],
          successorRelationships: [],
          createdAt: "2026-07-20T00:00:00.000Z",
          createdBy: TOPIC_ACTOR_ID,
          state: "confirmed",
          confirmedAt: "2026-07-21T00:00:00.000Z",
          confirmedBy: TOPIC_ACTOR_ID,
          contentHash: "c".repeat(64),
        },
        draft: null,
        generatedAt: "2026-07-28T00:00:00.000Z",
      },
    });
  });

  await page.route(
    `**${API_BASE}/audit/topic-model/insights`,
    async (route) => {
      await json(route, {
        data: {
          projectId: E2E_PROJECT_ID,
          topicModelRevision: 4,
          nodes: [
            {
              projectId: E2E_PROJECT_ID,
              topicNodeId: ROOT_TOPIC_ID,
              topicModelRevision: 4,
              label: "客户入职",
              keywordCount: 2,
              approvedKeywordCount: 1,
              reviewPendingKeywordCount: 1,
              existingPageKeywordCount: 2,
              newAssetKeywordCount: 0,
              unassignedKeywordCount: 0,
              mappedPageCount: 2,
              conflictingIntentCount: 2,
              coverageState: "conflict",
              limitation:
                "同一商业意图当前映射到 2 个页面，保存前需要客户明确确认。",
            },
            {
              projectId: E2E_PROJECT_ID,
              topicNodeId: CHILD_TOPIC_ID,
              topicModelRevision: 4,
              label: "流程自动化",
              keywordCount: 1,
              approvedKeywordCount: 1,
              reviewPendingKeywordCount: 0,
              existingPageKeywordCount: 1,
              newAssetKeywordCount: 0,
              unassignedKeywordCount: 0,
              mappedPageCount: 1,
              conflictingIntentCount: 0,
              coverageState: "covered",
              limitation: null,
            },
          ],
          coverage: {
            availability: "partial",
            limitations: ["部分话题仍有未审核 VOC 关键词。"],
          },
          generatedAt: "2026-07-28T00:00:00.000Z",
        },
      });
    },
  );

  await page.route(`**${API_BASE}/audit/competitors**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const listPath = `${API_BASE}/audit/competitors`;
    if (pathname === listPath) {
      await json(route, { data: competitorLibrary });
      return;
    }
    const competitorId = decodeURIComponent(
      pathname.slice(`${listPath}/`.length),
    );
    const item = competitorLibrary.data.find(
      (candidate) => candidate.competitorId === competitorId,
    );
    if (item === undefined) {
      await json(
        route,
        {
          type: "about:blank",
          title: "Not found",
          status: 404,
          code: "NOT_FOUND",
        },
        404,
      );
      return;
    }
    await json(route, {
      data: GrowthMapCompetitorDetailResponse.parse({
        projectId: E2E_PROJECT_ID,
        data: item,
      }),
    });
  });

  await page.route(`**${API_BASE}/audit/competitor-monitor`, async (route) => {
    if (route.request().method() === "GET") {
      await json(route, { data: competitorMonitor });
      return;
    }
    await route.fallback();
  });

  await page.route(`**${API_BASE}/audit/backlinks**`, async (route) => {
    await json(route, { data: backlinkModel });
  });

  await page.route(`**${API_BASE}/actions**`, async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === "GET" &&
      url.pathname === `${API_BASE}/actions`
    ) {
      await json(route, listEnvelope(actions));
      return;
    }
    await route.fallback();
  });

  await page.route(`**${API_BASE}/artifacts**`, async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === "GET" &&
      url.pathname === `${API_BASE}/artifacts`
    ) {
      await json(route, listEnvelope(artifacts));
      return;
    }
    await route.fallback();
  });

  await page.route(
    `**${API_BASE}/artifacts/execution-states**`,
    async (route) => {
      const requested = new URL(route.request().url()).searchParams.getAll(
        "artifactId",
      );
      const stateByArtifactId = new Map([
        [
          blogArtifact.id,
          {
            eventId: "55000000-0000-4000-8000-000000000001",
            projectId: E2E_PROJECT_ID,
            actionId: blogAction.id,
            artifactId: blogArtifact.id,
            revision: 1,
            expectedRevision: 0,
            transitionKind: "state_transition",
            state: "blocked",
            phase: "waiting_for_approval",
            nextStep: "等待客户确认英文 Blog 与发布日期。",
            blocker: {
              code: "approval.required",
              summary: "英文 Blog 发布前仍需客户确认。",
              unlockCondition: "批准当前版本并确认发布日期。",
              ownerId: "55000000-0000-4000-8000-000000000010",
              sourceKind: "approval",
              sourceRef: "approval:artifact-demo",
              observedAt: "2026-07-28T03:05:00.000Z",
              freshness: "current",
            },
            progress: null,
            idempotencyKey: "four-module-blog-blocked",
            actorId: "55000000-0000-4000-8000-000000000010",
            occurredAt: "2026-07-28T03:05:00.000Z",
          },
        ],
        [
          technicalArtifact.id,
          {
            eventId: "55000000-0000-4000-8000-000000000002",
            projectId: E2E_PROJECT_ID,
            actionId: technicalAction.id,
            artifactId: technicalArtifact.id,
            revision: 3,
            expectedRevision: 2,
            transitionKind: "state_update",
            state: "in_progress",
            phase: "implementation",
            nextStep: "完成回归测试与重新抓取。",
            blocker: null,
            progress: {
              stepDefinitionId: "55000000-0000-4000-8000-000000000011",
              stepDefinitionVersion: 1,
              completedSteps: 4,
              totalSteps: 6,
            },
            idempotencyKey: "four-module-tech-progress",
            actorId: "55000000-0000-4000-8000-000000000010",
            occurredAt: "2026-07-28T03:10:00.000Z",
          },
        ],
        [
          briefArtifact.id,
          {
            eventId: "55000000-0000-4000-8000-000000000003",
            projectId: E2E_PROJECT_ID,
            actionId: briefAction.id,
            artifactId: briefArtifact.id,
            revision: 2,
            expectedRevision: 1,
            transitionKind: "state_transition",
            state: "completed",
            phase: "completed",
            nextStep: null,
            blocker: null,
            progress: null,
            idempotencyKey: "four-module-brief-completed",
            actorId: "55000000-0000-4000-8000-000000000010",
            occurredAt: "2026-07-28T03:15:00.000Z",
          },
        ],
      ]);
      await json(route, {
        data: {
          projectId: E2E_PROJECT_ID,
          items: requested.map((artifactId) => ({
            actionId:
              artifacts.find((artifact) => artifact.id === artifactId)
                ?.actionId ?? blogAction.id,
            artifactId,
            current: stateByArtifactId.get(artifactId) ?? null,
          })),
        },
      });
    },
  );

  await page.route(
    `**${API_BASE}/actions/${blogAction.id}/execution-state**`,
    async (route) => {
      const current = {
        eventId: "55000000-0000-4000-8000-000000000001",
        projectId: E2E_PROJECT_ID,
        actionId: blogAction.id,
        artifactId: blogArtifact.id,
        revision: 1,
        expectedRevision: 0,
        transitionKind: "state_transition",
        state: "blocked",
        phase: "waiting_for_approval",
        nextStep: "等待客户确认英文 Blog 与发布日期。",
        blocker: {
          code: "approval.required",
          summary: "英文 Blog 发布前仍需客户确认。",
          unlockCondition: "批准当前版本并确认发布日期。",
          ownerId: "55000000-0000-4000-8000-000000000010",
          sourceKind: "approval",
          sourceRef: "approval:artifact-demo",
          observedAt: "2026-07-28T03:05:00.000Z",
          freshness: "current",
        },
        progress: null,
        idempotencyKey: "four-module-blog-blocked",
        actorId: "55000000-0000-4000-8000-000000000010",
        occurredAt: "2026-07-28T03:05:00.000Z",
      };
      await json(route, {
        data: {
          actionId: blogAction.id,
          artifactId: blogArtifact.id,
          current,
          history: [current],
        },
      });
    },
  );

  await page.route(`**${API_BASE}/content-shadow-runs**`, async (route) => {
    if (route.request().method() === "GET") {
      await json(route, listEnvelope([]));
      return;
    }
    await route.fallback();
  });
}

async function capture(
  page: Page,
  name: string,
  options: { readonly fullPage?: boolean } = {},
): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    }
  });
  await page.screenshot({
    path: join(ARTIFACT_DIR, `${name}.png`),
    fullPage: options.fullPage ?? false,
    animations: "disabled",
  });
}

async function captureCurrentViewport(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo({ left: 0, top: window.scrollY });
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      element.scrollLeft = 0;
    }
  });
  await page.screenshot({
    path: join(ARTIFACT_DIR, `${name}.png`),
    animations: "disabled",
  });
}

async function openFullEvidenceAndReview(page: Page): Promise<void> {
  const disclosure = page.locator("[data-full-evidence-disclosure]");
  await expect(disclosure).toBeVisible();
  if ((await disclosure.getAttribute("open")) === null) {
    await page.locator("[data-full-evidence-disclosure] > summary").click();
  }
  await expect(disclosure).toHaveAttribute("open", "");
}

test("完整四模块工作台：实际 Next 应用中文可视化与 URL 隔离验收", async ({
  page,
}) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1720, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await useChineseUi(page);
  await installGrowthVerticalApi(page);
  await installArtifactApi(page);

  await test.step("概览：四模块外壳与客户当前优先事项", async () => {
    await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
    const navigation = page.getByRole("navigation", { name: "项目分区" });
    await expect(navigation.getByRole("link")).toHaveCount(4);
    await expect(navigation).toContainText("概览");
    await expect(navigation).toContainText("增长地图");
    await expect(navigation).toContainText("执行中心");
    await expect(navigation).toContainText("效果追踪");
    await expect(page.locator("[data-overview-page]")).toBeVisible();
    await expect(
      page.getByText("客户入职页面的 canonical URL 存在冲突。"),
    ).toBeVisible();
    await capture(page, "01-overview");
    await capture(page, "01-overview-full", { fullPage: true });
  });

  await test.step("增长地图 / 页面与机会：两个 URL 往返时右侧证据同步", async () => {
    await page.goto(
      `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
    );
    await openFullEvidenceAndReview(page);
    const objectNavigation = page.getByRole("navigation", {
      name: "增长地图对象",
    });
    await expect(objectNavigation.getByRole("button")).toHaveCount(4);
    await expect(objectNavigation).toContainText("页面与机会");
    await expect(objectNavigation).toContainText("关键词库");
    await expect(objectNavigation).toContainText("竞品库");
    await expect(objectNavigation).toContainText("外链增长");

    const linkMap = page.locator("[data-internal-link-map]");
    await expect(linkMap).toHaveAttribute(
      "data-site-page-id",
      E2E_ONBOARDING_SITE_PAGE_ID,
    );
    await expect(
      page.getByRole("heading", { name: "/customer-onboarding" }),
    ).toBeVisible();
    await capture(page, "02-growth-map-pages-onboarding");

    const canonicalFinding = page
      .locator(`[data-finding-card="${E2E_CANONICAL_FINDING_ID}"]`)
      .getByRole("heading", {
        name: "客户入职页面的 canonical URL 存在冲突。",
        exact: true,
      });
    const contentFinding = page
      .locator(`[data-finding-card="${E2E_CONTENT_FINDING_ID}"]`)
      .getByRole("heading", {
        name: "客户入职页面存在可量化的内容覆盖缺口。",
        exact: true,
      });
    await expect(canonicalFinding).toBeVisible();
    await expect(contentFinding).toBeVisible();
    await contentFinding.scrollIntoViewIfNeeded();
    await captureCurrentViewport(page, "02a-growth-map-page-findings");

    const recommendationHeading = linkMap.getByRole("heading", {
      name: "建议从哪里补一条内链",
    });
    const reviewLink = linkMap.getByRole("link", {
      name: "审核后生成补链任务",
    });
    await expect(recommendationHeading).toBeVisible();
    await expect(reviewLink).toBeVisible();
    await reviewLink.scrollIntoViewIfNeeded();
    await captureCurrentViewport(
      page,
      "02b-growth-map-internal-link-recommendation",
    );

    await page.goto(
      `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_SECOND_SITE_PAGE_ID}`,
    );
    await openFullEvidenceAndReview(page);
    await expect(page).toHaveURL(
      new RegExp(`selectedSitePageId=${E2E_SECOND_SITE_PAGE_ID}`),
    );
    await expect(page.getByRole("heading", { name: "/pricing" })).toBeVisible();
    await expect(linkMap).toHaveAttribute(
      "data-site-page-id",
      E2E_SECOND_SITE_PAGE_ID,
    );
    await expect(
      linkMap.getByText("完整 Crawl 中未观察到任何入链。"),
    ).toBeVisible();
    await capture(page, "03-growth-map-pages-pricing");

    await page.goto(
      `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
    );
    await openFullEvidenceAndReview(page);
    await expect(linkMap).toHaveAttribute(
      "data-site-page-id",
      E2E_ONBOARDING_SITE_PAGE_ID,
    );
    await expect(
      linkMap.getByText("锚文本：Customer onboarding"),
    ).toBeVisible();
  });

  await test.step("增长地图 / 关键词库：排名证据与 VOC 来源分开呈现", async () => {
    await page.goto(
      `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${SEO_KEYWORD_ID}`,
    );
    const detail = page.locator('aside[aria-label="所选关键词详情"]');
    await expect(
      detail.getByRole("heading", {
        name: "customer onboarding automation",
        level: 2,
      }),
    ).toBeVisible();
    await expect(detail.getByTitle("2,400")).toBeVisible();
    await expect(
      page.getByText("本页 1 组候选，已收起 0 个支持词"),
    ).toBeVisible();
    await capture(page, "04-growth-map-keywords");

    await page
      .getByRole("button", {
        name: "查看“customer onboarding automation”的 1 组重复关系",
      })
      .click();
    const relationDialog = page.getByRole("dialog");
    await expect(
      relationDialog.getByRole("heading", { name: "审核重复词" }),
    ).toBeVisible();
    await expect(relationDialog).toContainText("同一已确认页面");
    await expect(relationDialog).toContainText("暂无规范 SERP 重合数据");
    await capture(page, "04a-growth-map-keyword-duplicate-review");
    await relationDialog
      .getByRole("button", { name: "关闭重复词审核" })
      .click();

    await detail.getByRole("button", { name: "查看来源与明细" }).click();
    const evidence = page.getByRole("dialog", { name: "来源与明细" });
    const rankHistory = evidence.getByRole("heading", {
      name: "90 天排名趋势",
      level: 3,
    });
    await expect(rankHistory).toBeVisible();
    await rankHistory.scrollIntoViewIfNeeded();
    await captureCurrentViewport(page, "05-growth-map-keywords-rank-history");
    await evidence
      .getByRole("button", { name: "关闭来源与明细" })
      .click();

    await detail.getByRole("button", { name: "审核 / 修改" }).click();
    const reviewDialog = page.getByRole("dialog");
    await expect(
      reviewDialog.getByRole("heading", {
        name: "审核“customer onboarding automation”",
      }),
    ).toBeVisible();
    const topicSelect = reviewDialog.getByRole("combobox", {
      name: "已发布 Topic",
    });
    await expect(topicSelect).toBeVisible();
    await topicSelect.selectOption(ROOT_TOPIC_ID);
    await reviewDialog.getByRole("button", { name: "保存审核" }).click();
    const conflictConfirmation = reviewDialog.getByTestId(
      "keyword-review-conflict-confirmation",
    );
    await expect(conflictConfirmation).toContainText("所选 Topic 存在意图冲突");
    await conflictConfirmation.scrollIntoViewIfNeeded();
    await captureCurrentViewport(
      page,
      "05a-growth-map-keyword-review-conflict-confirmation",
    );
    await conflictConfirmation
      .getByRole("button", { name: "确认冲突并保存" })
      .click();
    await expect(reviewDialog).toBeHidden();
    await expect(detail.getByText("审核结果已同步")).toBeVisible();

    await page
      .getByRole("button")
      .filter({ hasText: "customer onboarding friction" })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`selectedKeywordId=${VOC_KEYWORD_ID}`),
    );
    await expect(
      detail.getByRole("heading", {
        name: "customer onboarding friction",
        level: 2,
      }),
    ).toBeVisible();
    await expect(detail.getByText("访谈摘要").first()).toBeVisible();
    await expect(detail.getByText("用户评价").first()).toBeVisible();
    await detail.getByRole("button", { name: "查看来源与明细" }).click();
    const vocEvidence = page.getByRole("dialog", { name: "来源与明细" });
    await expect(vocEvidence.getByText("暂无排名趋势")).toBeVisible();
    const sourcesHeading = vocEvidence.getByRole("heading", {
      name: "来源记录",
      level: 3,
    });
    await sourcesHeading.scrollIntoViewIfNeeded();
    await captureCurrentViewport(page, "06-growth-map-keywords-voc-sources");
    await vocEvidence
      .getByRole("button", { name: "关闭来源与明细" })
      .click();
  });

  await test.step("增长地图 / 竞品库：动态信号与 baseline 按竞品隔离", async () => {
    await page.goto(
      `/p/${E2E_PROJECT_ID}/growth-map?object=competitors&selectedCompetitorId=${COMPETITOR_A_ID}`,
    );
    // Artifact-parity ledger: seven labelled columns plus the row-arrow slot,
    // and honest per-metric fallbacks instead of the removed "暂无可用数据".
    const ledgerHeader = page
      .getByRole("list", { name: "竞品列表" })
      .locator("xpath=preceding-sibling::*[1]");
    await expect(ledgerHeader.locator(":scope > span")).toHaveCount(8);
    await expect(ledgerHeader).toContainText("自然搜索重叠度");
    await expect(ledgerHeader).toContainText("共同关键词");
    await expect(ledgerHeader).toContainText("AI 引用");
    const atlasRow = page
      .getByRole("listitem")
      .filter({ hasText: "atlasflow.com" });
    await expect(atlasRow).toContainText("数据不足");
    await expect(atlasRow).toContainText("不可用");
    await expect(atlasRow).not.toContainText("暂无可用数据");
    // Both Competitors here carry manual origins only, so the shared-keyword
    // cell must stay on its own fallback rather than inherit the neighbouring
    // overlap cell's text. Scoping the assertion to the column keeps that
    // honest: a wrong number here can no longer hide behind a row-wide match.
    await expect(
      atlasRow.locator('[data-column="共同关键词"]'),
    ).toHaveText("数据不足");
    await expect(
      atlasRow.locator('[data-column="自然搜索重叠度"]'),
    ).toHaveText("数据不足");

    const drawer = page.getByTestId("competitor-profile-drawer");
    const monitor = page.getByTestId("competitor-monitor");
    const competitorDetail = page.getByTestId("competitor-detail-panel");

    // The row arrow now selects the compact Artifact-aligned profile rail. It
    // must not skip that summary and open the modal drawer implicitly.
    await expect(drawer).toHaveCount(0);
    await atlasRow.getByRole("button", { name: "查看竞品档案" }).click();
    await expect(drawer).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("selectedCompetitorId"))
      .toBe(COMPETITOR_A_ID);
    await expect(
      competitorDetail.getByRole("heading", { name: "AtlasFlow", level: 2 }),
    ).toBeVisible();
    await expect(competitorDetail).toContainText("为什么进入竞品池");

    // The explicit rail action is the only entry into the full profile. An
    // available monitor remains useful there and keeps its Competitor scope.
    await competitorDetail
      .getByRole("button", { name: "查看完整档案" })
      .click();
    await expect(drawer).toBeVisible();
    await expect(monitor).toHaveAttribute(
      "data-competitor-id",
      COMPETITOR_A_ID,
    );
    await expect(monitor).toContainText("customer onboarding automation");
    await expect(monitor).toContainText("排名 18 → 9，提升 9 位");
    await capture(page, "07-growth-map-competitor-atlasflow");

    // The drawer's scrim covers the ledger, so close it before switching rows.
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    const beaconRow = page
      .getByRole("listitem")
      .filter({ hasText: "beaconpath.com" });
    await beaconRow.getByRole("button", { name: "查看竞品档案" }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`selectedCompetitorId=${COMPETITOR_B_ID}`),
    );
    await expect(
      competitorDetail.getByRole("heading", {
        name: "BeaconPath",
        level: 2,
      }),
    ).toBeVisible();
    await competitorDetail
      .getByRole("button", { name: "查看完整档案" })
      .click();
    await expect(drawer).toBeVisible();
    // A first-collection baseline is not a customer-facing change signal, so
    // the unavailable monitor section is omitted instead of filling the
    // profile with a non-actionable card.
    await expect(monitor).toHaveCount(0);
    await expect(drawer).not.toContainText("首次真实采集只用于建立基线");
    await expect(drawer).not.toContainText("customer onboarding automation");
    await capture(page, "08-growth-map-competitor-beaconpath");
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });

  await test.step("增长地图 / 外链增长：Provider 总量、页面与竞品差距", async () => {
    await page.goto(`/p/${E2E_PROJECT_ID}/growth-map?object=backlinks`);
    const path = page.locator("[data-backlink-growth-path]");
    await expect(
      path.getByRole("heading", {
        name: "看清站外权重从哪里来，以及下一步该补哪里",
      }),
    ).toBeVisible();
    await expect(path.getByText("Provider 索引总量").first()).toBeVisible();
    await expect(path.getByText("Domain Rating").first()).toBeVisible();
    await expect(path.getByText("与已批准竞品按同口径比较")).toBeVisible();
    await capture(page, "09-growth-map-backlinks");
    await capture(page, "09-growth-map-backlinks-full", { fullPage: true });

    await path.getByRole("link", { name: /Pricing overview/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`object=pages&selectedSitePageId=${E2E_SECOND_SITE_PAGE_ID}`),
    );
    await expect(page.getByRole("heading", { name: "/pricing" })).toBeVisible();
  });

  await test.step("执行中心：文章、Brief、技术修复及真实阻断/进度", async () => {
    await page.goto(
      `/p/${E2E_PROJECT_ID}/execution?actionId=${blogAction.id}&artifactId=${blogArtifact.id}`,
    );
    const queue = page.locator("[data-studio-queue]");
    await expect(queue).toBeVisible();
    await expect(queue).toContainText("审核并发布客户入职自动化英文 Blog");
    await expect(queue).toContainText("修复 12 个优先 URL 的 canonical 冲突");
    await expect(queue).toContainText(
      "确认 Customer Onboarding 对比页 Content Brief",
    );
    await expect(page.locator("[data-studio-markdown-preview]")).toContainText(
      "How to Automate Customer Onboarding Without Losing the Human Touch",
    );
    await page
      .getByRole("tablist", { name: "Markdown 查看方式" })
      .getByRole("tab", { name: "编辑 Markdown", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "内容" })).toHaveValue(
      /How to Automate Customer Onboarding Without Losing the Human Touch/,
    );
    await expect(
      queue.locator('[data-artifact-execution-state="blocked"]'),
    ).toContainText("英文 Blog 发布前仍需客户确认。");
    await expect(
      queue.locator('[data-artifact-execution-state="in_progress"]'),
    ).toContainText("已完成 4 / 6 个步骤");
    await capture(page, "10-execution-center");
    await capture(page, "10-execution-center-full", { fullPage: true });
  });

  await test.step("效果追踪：两个 URL 的改前改后、目标词与 GEO 独立切换", async () => {
    await page.goto(`/p/${E2E_PROJECT_ID}/results`);
    const panel = page.getByRole("region", {
      name: "URL 效果与 UTM 审计",
    });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("tab")).toHaveCount(3);
    await expect(
      panel.getByRole("tabpanel", { name: "结果摘要" }),
    ).toContainText("回执不等于效果");
    await capture(page, "11-results-summary");
    await panel.getByRole("tab", { name: "页面改前 / 改后" }).click();
    const selector = panel.getByRole("complementary", {
      name: "选择要查看的 URL 效果记录",
    });
    const urlButtons = selector.getByRole("button");
    const onboarding = urlButtons.nth(0);
    const pricing = urlButtons.nth(1);
    await expect(onboarding).toHaveAttribute("aria-pressed", "true");
    await expect(
      panel.getByRole("heading", {
        name: "/customer-onboarding/",
        level: 2,
      }),
    ).toBeVisible();
    await expect(
      panel
        .getByRole("region", { name: "目标关键词排名" })
        .getByText("提升 5 位"),
    ).toBeVisible();
    await capture(page, "11-results-onboarding");
    await capture(page, "11-results-onboarding-full", { fullPage: true });

    await pricing.click();
    await expect(pricing).toHaveAttribute("aria-pressed", "true");
    await expect(
      panel.getByRole("heading", { name: "/pricing/", level: 2 }),
    ).toBeVisible();
    await expect(
      panel
        .getByRole("region", { name: "目标关键词排名" })
        .getByText("下降 1 位"),
    ).toBeVisible();
    const geo = panel.getByRole("region", { name: "GEO / AI 引用" });
    const citationRow = geo.getByRole("row").filter({ hasText: "AI 引用次数" });
    await expect(citationRow).toContainText("不可用");
    await expect(citationRow).not.toContainText("0");
    await capture(page, "12-results-pricing");

    await onboarding.click();
    await expect(onboarding).toHaveAttribute("aria-pressed", "true");
    await expect(
      panel
        .getByRole("region", { name: "目标关键词排名" })
        .getByText("提升 5 位"),
    ).toBeVisible();
    await expect(
      geo.getByText("best customer onboarding software"),
    ).toBeVisible();
    const baselineQuery = geo
      .locator("details")
      .filter({ hasText: "best customer onboarding software" });
    await baselineQuery
      .getByText("best customer onboarding software", { exact: true })
      .click();
    const structureEvidence = baselineQuery.getByRole("region", {
      name: "被引用与未引用内容的结构差异",
    });
    await expect(structureEvidence).toBeVisible();
    await expect(structureEvidence).toContainText("受限推断");
    await expect(structureEvidence).toContainText(
      "仅呈现有证据约束的观察或推断，不把结构差异解释为引用原因。",
    );
    await expect(geo).toContainText("不能解释为“为什么被引用”");
    await structureEvidence.scrollIntoViewIfNeeded();
    await captureCurrentViewport(page, "13-results-geo-evidence");
  });
});
