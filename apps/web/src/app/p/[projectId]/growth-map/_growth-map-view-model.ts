import type {
  BeginTopicModelDraftRequest,
  CompetitorMonitorItem,
  CompetitorMonitorResponse,
  ConfirmTopicModelRequest,
  GrowthMapTopicModelInsights,
  GrowthMapTopicNodeInsight,
  GrowthMapInternalLinkMap,
  GrowthMapFindingTargetRelation,
  GrowthMapExecutionRef,
  GrowthMapKeywordContentChangeMarker,
  GrowthMapKeywordLibraryItem,
  GrowthMapKeywordStatus,
  GrowthMapKeywordNumericMetric,
  GrowthMapKeywordRankHistory,
  GrowthMapKeywordRankMetric,
  GrowthMapKeywordRankPoint,
  GrowthMapKeywordRankProvider,
  GrowthMapKeywordRelation,
  GrowthMapKeywordTextMetric,
  GrowthOpportunity,
  GrowthMapUrlPortfolioItem,
  GrowthMapUrlFinding,
  GrowthMapUrlIdentitySource,
  GrowthMapUrlMetricObservation,
  GrowthMapCompetitorLibraryItem,
  GrowthMapCompetitorAiCitationInsight,
  GrowthMapCompetitorOriginKind,
  GrowthMapCompetitorOriginOccurrence,
  GrowthMapCompetitorSerpOverlap,
  InternalLinkMapCoverage,
  InternalLinkMapEdge,
  InternalLinkMapExecutionRef,
  InternalLinkMapNode,
  InternalLinkRecommendation,
  InternalLinkRecommendationCoverage,
  DecideKeywordRelationRequest,
  KeywordGovernancePendingSuggestion,
  KeywordRelationDecisionKind,
  KeywordMappingDecision,
  PatchTopicModelDraftRequest,
  ReviewKeywordRequest,
  TopicModelRevision,
  TopicModelWorkspaceProjection,
  TopicNodeDraftIntent,
  TopicNodeRevision,
} from "@sf/contracts";
import {
  BeginTopicModelDraftRequest as BeginTopicModelDraftRequestSchema,
  ConfirmTopicModelRequest as ConfirmTopicModelRequestSchema,
  GrowthMapExecutionRef as GrowthMapExecutionRefSchema,
  PatchTopicModelDraftRequest as PatchTopicModelDraftRequestSchema,
  ReviewKeywordRequest as ReviewKeywordRequestSchema,
  TopicNodeDraftIntent as TopicNodeDraftIntentSchema,
} from "@sf/contracts";
import { ApiError } from "@/lib/api";
import type { Artifact } from "@/lib/api/hooks-studio";
import type {
  ReviewFindingRequest,
  ReviewFindingVars,
} from "@/lib/api/hooks-diagnosis";

export const GROWTH_MAP_OBJECT_MODES = [
  "pages",
  "keywords",
  "competitors",
  "backlinks",
] as const;

export type GrowthMapObjectMode = (typeof GROWTH_MAP_OBJECT_MODES)[number];

export const GROWTH_MAP_PAGE_VIEWS = [
  "url",
  "cluster",
  "opportunity",
] as const;

export type GrowthMapPageView = (typeof GROWTH_MAP_PAGE_VIEWS)[number];

export const GROWTH_MAP_DETAIL_STATES = [
  "audit_evidence",
  "opportunity_review",
] as const;

export type GrowthMapDetailState = (typeof GROWTH_MAP_DETAIL_STATES)[number];

const INTERNAL_LINK_NEIGHBOR_NODE_LIMIT = 12;
const INTERNAL_LINK_NEIGHBOR_EDGE_LIMIT = 20;
const INTERNAL_LINK_INBOUND_SOURCE_LIMIT = 8;
const INTERNAL_LINK_RECOMMENDATION_LIMIT = 8;

export interface InternalLinkExecutionReference extends InternalLinkMapExecutionRef {
  readonly role: "target" | "source";
}

export interface InternalLinkRecommendationProjection extends InternalLinkRecommendation {
  readonly executionRefs: readonly InternalLinkExecutionReference[];
}

export type InternalLinkMapProjection =
  | {
      readonly kind: "unavailable" | "selection_unavailable";
      readonly coverage: InternalLinkMapCoverage;
    }
  | {
      readonly kind: "ready";
      readonly coverage: InternalLinkMapCoverage;
      readonly selectedNode: InternalLinkMapNode;
      readonly graph: {
        readonly totalNodeCount: number;
        readonly returnedEdgeCount: number;
        readonly totalEdgeCount: number;
        readonly edgesTruncated: boolean;
      };
      readonly neighborhood: {
        readonly nodes: readonly InternalLinkMapNode[];
        readonly edges: readonly InternalLinkMapEdge[];
        readonly totalNodeCount: number;
        readonly totalEdgeCount: number;
        readonly nodesTruncated: boolean;
        readonly edgesTruncated: boolean;
      };
      readonly inboundSources: readonly InternalLinkMapEdge[];
      readonly totalInboundSourceCount: number;
      readonly inboundSourcesTruncated: boolean;
      readonly recommendationCoverage: InternalLinkRecommendationCoverage;
      readonly recommendations: readonly InternalLinkRecommendationProjection[];
      readonly totalRecommendationCount: number;
      readonly recommendationsTruncated: boolean;
    };

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function executionReferencesForRecommendation(
  recommendation: InternalLinkRecommendation,
  nodeByUrl: ReadonlyMap<string, InternalLinkMapNode>,
): readonly InternalLinkExecutionReference[] {
  const refs: InternalLinkExecutionReference[] = [];
  const seen = new Set<string>();
  for (const [role, node] of [
    ["target", nodeByUrl.get(recommendation.targetCanonicalUrl)],
    ["source", nodeByUrl.get(recommendation.sourceCanonicalUrl)],
  ] as const) {
    for (const ref of node?.executionRefs ?? []) {
      const key = `${role}:${ref.findingId}:${ref.actionId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ role, ...ref });
    }
  }
  return refs;
}

/**
 * Project one exact URL's Internal Link Map without allowing the previous
 * selection to bleed into a newly selected row. Only frozen graph edges and
 * confirmed-Topic recommendations survive this boundary.
 */
export function buildInternalLinkMapProjection(
  map: GrowthMapInternalLinkMap,
  selectedSitePageId: string,
): InternalLinkMapProjection {
  if (map.coverage.availability === "unavailable") {
    return { kind: "unavailable", coverage: map.coverage };
  }
  if (
    map.selectedPage === null ||
    map.selectedPage.selectedSitePageId !== selectedSitePageId
  ) {
    return { kind: "selection_unavailable", coverage: map.coverage };
  }

  const nodeByUrl = new Map(
    map.graph.nodes.map((node) => [node.canonicalUrl, node]),
  );
  const selectedNode = nodeByUrl.get(map.selectedPage.canonicalUrl);
  if (
    selectedNode === undefined ||
    !selectedNode.sitePageIds.includes(selectedSitePageId)
  ) {
    return { kind: "selection_unavailable", coverage: map.coverage };
  }

  const neighborhoodEdges = map.graph.edges.filter(
    (edge) =>
      edge.sourceCanonicalUrl === selectedNode.canonicalUrl ||
      edge.targetCanonicalUrl === selectedNode.canonicalUrl,
  );
  const neighborhoodUrls = [selectedNode.canonicalUrl];
  for (const edge of neighborhoodEdges) {
    appendUnique(neighborhoodUrls, edge.sourceCanonicalUrl);
    appendUnique(neighborhoodUrls, edge.targetCanonicalUrl);
  }
  for (const recommendation of map.selectedPage.recommendations) {
    appendUnique(neighborhoodUrls, recommendation.sourceCanonicalUrl);
    appendUnique(neighborhoodUrls, recommendation.targetCanonicalUrl);
  }
  const neighborhoodNodes = neighborhoodUrls
    .map((url) => nodeByUrl.get(url))
    .filter((node): node is InternalLinkMapNode => node !== undefined);
  const visibleNeighborhoodNodes = neighborhoodNodes.slice(
    0,
    INTERNAL_LINK_NEIGHBOR_NODE_LIMIT,
  );
  const visibleNeighborhoodEdges = neighborhoodEdges
    .filter(
      (edge) =>
        visibleNeighborhoodNodes.some(
          (node) => node.canonicalUrl === edge.sourceCanonicalUrl,
        ) &&
        visibleNeighborhoodNodes.some(
          (node) => node.canonicalUrl === edge.targetCanonicalUrl,
        ),
    )
    .slice(0, INTERNAL_LINK_NEIGHBOR_EDGE_LIMIT);
  const inboundSources = map.selectedPage.inboundSources.slice(
    0,
    INTERNAL_LINK_INBOUND_SOURCE_LIMIT,
  );
  const recommendations = map.selectedPage.recommendations
    .slice(0, INTERNAL_LINK_RECOMMENDATION_LIMIT)
    .map((recommendation) => ({
      ...recommendation,
      executionRefs: executionReferencesForRecommendation(
        recommendation,
        nodeByUrl,
      ),
    }));

  return {
    kind: "ready",
    coverage: map.coverage,
    selectedNode,
    graph: {
      totalNodeCount: map.graph.nodes.length,
      returnedEdgeCount: map.graph.edges.length,
      totalEdgeCount: map.graph.totalEdgeCount,
      edgesTruncated: map.graph.edgesTruncated,
    },
    neighborhood: {
      nodes: visibleNeighborhoodNodes,
      edges: visibleNeighborhoodEdges,
      totalNodeCount: neighborhoodNodes.length,
      totalEdgeCount: neighborhoodEdges.length,
      nodesTruncated:
        neighborhoodNodes.length > visibleNeighborhoodNodes.length,
      edgesTruncated:
        neighborhoodEdges.length > visibleNeighborhoodEdges.length,
    },
    inboundSources,
    totalInboundSourceCount: map.selectedPage.inboundSources.length,
    inboundSourcesTruncated:
      map.selectedPage.inboundSources.length > inboundSources.length,
    recommendationCoverage: map.selectedPage.recommendationCoverage,
    recommendations,
    totalRecommendationCount: map.selectedPage.totalRecommendationCount,
    recommendationsTruncated:
      map.selectedPage.recommendationsTruncated ||
      map.selectedPage.recommendations.length > recommendations.length,
  };
}

/** Confirmation is a property of Opportunity Review, never Audit Evidence. */
export function growthMapDetailAllowsFindingReview(
  state: GrowthMapDetailState,
): boolean {
  return state === "opportunity_review";
}

export function normalizeGrowthMapObjectMode(
  value: string | null | undefined,
): GrowthMapObjectMode {
  return GROWTH_MAP_OBJECT_MODES.includes(value as GrowthMapObjectMode)
    ? (value as GrowthMapObjectMode)
    : "pages";
}

export function normalizeGrowthMapPageView(
  value: string | null | undefined,
): GrowthMapPageView {
  return GROWTH_MAP_PAGE_VIEWS.includes(value as GrowthMapPageView)
    ? (value as GrowthMapPageView)
    : "opportunity";
}

function resolveVisibleGrowthMapPageViewSelection(
  requestedId: string | null | undefined,
  visibleIds: readonly string[],
): string | null {
  return requestedId != null && visibleIds.includes(requestedId)
    ? requestedId
    : (visibleIds[0] ?? null);
}

export function resolveVisibleGrowthMapOpportunitySelection(
  requestedOpportunityId: string | null | undefined,
  visibleOpportunityIds: readonly string[],
): string | null {
  return resolveVisibleGrowthMapPageViewSelection(
    requestedOpportunityId,
    visibleOpportunityIds,
  );
}

export function resolveVisibleGrowthMapUrlSelection(
  requestedSitePageId: string | null | undefined,
  visibleSitePageIds: readonly string[],
): string | null {
  return resolveVisibleGrowthMapPageViewSelection(
    requestedSitePageId,
    visibleSitePageIds,
  );
}

export function resolveVisibleGrowthMapClusterSelection(
  requestedTopicNodeId: string | null | undefined,
  visibleTopicNodeIds: readonly string[],
): string | null {
  return resolveVisibleGrowthMapPageViewSelection(
    requestedTopicNodeId,
    visibleTopicNodeIds,
  );
}

type GrowthMapAvailableUrlPriority = Extract<
  GrowthMapUrlPortfolioItem["priority"],
  { readonly availability: "available" }
>;

export type GrowthMapOpportunityPriority =
  | {
      readonly availability: "available";
      readonly value: GrowthMapAvailableUrlPriority["value"];
      readonly limitation: null;
    }
  | {
      readonly availability: "unavailable";
      readonly value: null;
      readonly limitation: string;
    };

export interface GrowthMapOpportunityViewItem {
  readonly id: string;
  readonly opportunity: GrowthOpportunity;
  readonly targetPages: readonly GrowthMapUrlPortfolioItem[];
  readonly priority: GrowthMapOpportunityPriority;
}

export function growthMapOpportunitySelectionId(
  opportunity: GrowthOpportunity,
): string {
  return opportunity.readiness === "candidate"
    ? opportunity.opportunityKey
    : opportunity.primaryFindingId;
}

function growthMapOpportunityTargetPages(
  opportunity: GrowthOpportunity,
  portfolio: readonly GrowthMapUrlPortfolioItem[],
): readonly GrowthMapUrlPortfolioItem[] {
  const primaryFindingId =
    opportunity.readiness === "candidate" ? null : opportunity.primaryFindingId;
  const ownedAsset = opportunity.currentOwnedAsset;
  return portfolio.filter(
    (page) =>
      (primaryFindingId !== null &&
        page.findingIds.includes(primaryFindingId)) ||
      (ownedAsset !== null &&
        (page.sitePageId === ownedAsset.sitePageId ||
          page.normalizedUrl === ownedAsset.url)),
  );
}

/**
 * Opportunity priority maps the primary Finding severity straight onto the
 * band the server recorded for the diagnostic run. It deliberately does not
 * borrow url_opportunity_rank.v1: that band aggregates every reviewable
 * Finding stacked on a URL, drops Findings once they are confirmed, and does
 * not exist at all for new-asset Opportunities without a crawled page — all
 * of which made most Opportunities unrankable here.
 */
function growthMapOpportunityPriority(
  opportunity: GrowthOpportunity,
): GrowthMapOpportunityPriority {
  if (opportunity.readiness === "candidate") {
    return {
      availability: "unavailable",
      value: null,
      limitation:
        "Candidate Opportunities do not have one primary Finding priority basis.",
    };
  }
  return {
    availability: "available",
    value: opportunity.primaryFindingSeverity,
    limitation: null,
  };
}

const OPPORTUNITY_PRIORITY_RANK: Readonly<
  Record<GrowthMapAvailableUrlPriority["value"], number>
> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const OPPORTUNITY_READINESS_RANK: Readonly<
  Record<GrowthOpportunity["readiness"], number>
> = {
  reviewable: 0,
  candidate: 1,
  confirmed: 2,
};

export function buildGrowthMapOpportunityViewItems(
  opportunities: readonly GrowthOpportunity[],
  portfolio: readonly GrowthMapUrlPortfolioItem[],
): readonly GrowthMapOpportunityViewItem[] {
  return opportunities
    .map((opportunity) => {
      const targetPages = growthMapOpportunityTargetPages(
        opportunity,
        portfolio,
      );
      return {
        id: growthMapOpportunitySelectionId(opportunity),
        opportunity,
        targetPages,
        priority: growthMapOpportunityPriority(opportunity),
      } satisfies GrowthMapOpportunityViewItem;
    })
    .sort((left, right) => {
      const leftPriority =
        left.priority.availability === "available"
          ? OPPORTUNITY_PRIORITY_RANK[left.priority.value]
          : Number.POSITIVE_INFINITY;
      const rightPriority =
        right.priority.availability === "available"
          ? OPPORTUNITY_PRIORITY_RANK[right.priority.value]
          : Number.POSITIVE_INFINITY;
      return (
        leftPriority - rightPriority ||
        OPPORTUNITY_READINESS_RANK[left.opportunity.readiness] -
          OPPORTUNITY_READINESS_RANK[right.opportunity.readiness] ||
        left.opportunity.title.localeCompare(right.opportunity.title) ||
        left.id.localeCompare(right.id)
      );
    });
}

export interface GrowthMapTopicClusterViewRow {
  readonly topicNodeId: string;
  readonly parentTopicNodeId: string | null;
  readonly label: string;
  readonly description: string | null;
  readonly depth: number;
  readonly keywords: readonly GrowthMapKeywordLibraryItem[];
  readonly keywordCount: number;
  readonly pages: readonly GrowthMapUrlPortfolioItem[];
  readonly pageCount: number;
  readonly searchVolume: {
    readonly value: number | null;
    readonly observedKeywordCount: number;
    readonly totalKeywordCount: number;
    readonly limitation: "partial_search_volume" | "unavailable" | null;
  };
  readonly coverageState: GrowthMapTopicNodeInsight["coverageState"];
  readonly coverageLimitation: string | null;
  readonly primaryCta: {
    readonly availability: "unavailable";
    readonly value: null;
    readonly limitation: "cta_mapping_not_exposed";
  };
  readonly primaryPage: GrowthMapUrlPortfolioItem | null;
  readonly topOpportunity: GrowthMapOpportunityViewItem | null;
}

export type GrowthMapTopicClusterView =
  | {
      readonly kind: "ready";
      readonly diagnosticRunId: string;
      readonly topicModelRevision: number;
      readonly rows: readonly GrowthMapTopicClusterViewRow[];
    }
  | {
      readonly kind: "unavailable";
      readonly reason:
        | "confirmed_topic_unavailable"
        | "diagnostic_run_mismatch"
        | "topic_revision_mismatch"
        | "topic_reference_mismatch"
        | "inventory_reference_mismatch";
    };

export type GrowthMapUncoveredKeywordCountPresentation =
  | { readonly kind: "unavailable" | "empty"; readonly count: null }
  | { readonly kind: "exact" | "lower_bound"; readonly count: number };

const KEYWORD_DELIVERY_CONTENT_ARTIFACT_TYPES = new Set<
  Artifact["artifactType"]
>(["content_brief", "english_blog_draft", "metadata_rewrite"]);

const KEYWORD_DELIVERY_ARTIFACT_RANK: Record<
  Artifact["artifactType"],
  number
> = {
  content_brief: 0,
  english_blog_draft: 1,
  metadata_rewrite: 2,
  technical_ticket: 3,
};

export type KeywordDeliveryArtifactSnapshot = Pick<
  Artifact,
  "id" | "actionId" | "artifactType" | "status" | "currentRevision"
>;

export interface GrowthMapKeywordDeliveryOpportunity {
  readonly id: string;
  readonly opportunity: GrowthOpportunity;
  readonly targetPages: readonly GrowthMapUrlPortfolioItem[];
  readonly artifacts: readonly KeywordDeliveryArtifactSnapshot[];
  readonly executionRef: GrowthMapExecutionRef | null;
}

export type GrowthMapKeywordDeliveryProjection =
  | {
      readonly kind: "none";
      readonly reason:
        | "artifact_inventory_unavailable"
        | "inventory_scope_mismatch"
        | "keyword_new_asset"
        | "keyword_unassigned"
        | "mapped_page_unavailable"
        | "no_content_opportunity"
        | "opportunity_inventory_unavailable"
        | "published_run_unavailable"
        | "url_inventory_unavailable";
    }
  | {
      readonly kind: "ready";
      readonly publishedDiagnosticRunId: string;
      readonly mappedPage: GrowthMapUrlPortfolioItem;
      readonly opportunities: readonly GrowthMapKeywordDeliveryOpportunity[];
      readonly artifactCount: number;
    };

function keywordDeliveryArtifactType(
  opportunity: GrowthOpportunity,
): Artifact["artifactType"] | null {
  if (opportunity.readiness === "confirmed") {
    return KEYWORD_DELIVERY_CONTENT_ARTIFACT_TYPES.has(
      opportunity.action.artifactType,
    )
      ? opportunity.action.artifactType
      : null;
  }
  if (opportunity.readiness !== "reviewable") return null;
  if (opportunity.executionPreview === null) return null;
  return KEYWORD_DELIVERY_CONTENT_ARTIFACT_TYPES.has(
    opportunity.executionPreview.artifactType,
  )
    ? opportunity.executionPreview.artifactType
    : null;
}

function keywordDeliveryArtifactCompare(
  left: KeywordDeliveryArtifactSnapshot,
  right: KeywordDeliveryArtifactSnapshot,
): number {
  return (
    KEYWORD_DELIVERY_ARTIFACT_RANK[left.artifactType] -
      KEYWORD_DELIVERY_ARTIFACT_RANK[right.artifactType] ||
    left.id.localeCompare(right.id)
  );
}

function keywordDeliveryStageRank(
  opportunity: GrowthMapKeywordDeliveryOpportunity,
): number {
  if (opportunity.artifacts.length > 0) return 0;
  if (opportunity.opportunity.readiness === "confirmed") return 1;
  return 2;
}

/**
 * Project only the content-bearing deliverables a keyword can honestly claim:
 * one exact mapped page, one published URL inventory, and Opportunities that
 * own that exact page. Topic peers, Finding-only previews, and technical
 * outputs stay out of this rail.
 */
export function buildGrowthMapKeywordDeliveryProjection(input: {
  readonly keyword: GrowthMapKeywordLibraryItem;
  readonly publishedDiagnosticRunId: string | null;
  readonly urls: readonly GrowthMapUrlPortfolioItem[] | null;
  readonly opportunities: readonly GrowthOpportunity[] | null;
  readonly artifacts: readonly Artifact[] | null;
}): GrowthMapKeywordDeliveryProjection {
  if (input.publishedDiagnosticRunId === null) {
    return { kind: "none", reason: "published_run_unavailable" };
  }
  if (input.urls === null) {
    return { kind: "none", reason: "url_inventory_unavailable" };
  }
  if (input.opportunities === null) {
    return { kind: "none", reason: "opportunity_inventory_unavailable" };
  }
  if (input.artifacts === null) {
    return { kind: "none", reason: "artifact_inventory_unavailable" };
  }
  const mappedTarget = input.keyword.mappedTarget;
  if (mappedTarget.kind === "unassigned") {
    return { kind: "none", reason: "keyword_unassigned" };
  }
  if (mappedTarget.kind === "new_asset") {
    return { kind: "none", reason: "keyword_new_asset" };
  }
  if (
    input.urls.some(
      (url) =>
        url.projectId !== input.keyword.projectId ||
        url.diagnosticRunId !== input.publishedDiagnosticRunId,
    )
  ) {
    return { kind: "none", reason: "inventory_scope_mismatch" };
  }

  const mappedPage =
    input.urls.find((url) => url.sitePageId === mappedTarget.sitePageId) ?? null;
  if (mappedPage === null) {
    return { kind: "none", reason: "mapped_page_unavailable" };
  }

  const eligibleOpportunities = input.opportunities.filter((opportunity) => {
    const artifactType = keywordDeliveryArtifactType(opportunity);
    return (
      artifactType !== null &&
      opportunity.currentOwnedAsset?.sitePageId === mappedPage.sitePageId
    );
  });
  if (eligibleOpportunities.length === 0) {
    return { kind: "none", reason: "no_content_opportunity" };
  }

  const sortedArtifacts = input.artifacts
    .filter((artifact) =>
      KEYWORD_DELIVERY_CONTENT_ARTIFACT_TYPES.has(artifact.artifactType),
    )
    .map((artifact) => ({
      id: artifact.id,
      actionId: artifact.actionId,
      artifactType: artifact.artifactType,
      status: artifact.status,
      currentRevision: artifact.currentRevision,
    }))
    .sort(keywordDeliveryArtifactCompare);
  const artifactsByActionId = new Map<string, KeywordDeliveryArtifactSnapshot[]>();
  for (const artifact of sortedArtifacts) {
    const bucket = artifactsByActionId.get(artifact.actionId) ?? [];
    bucket.push(artifact);
    artifactsByActionId.set(artifact.actionId, bucket);
  }

  const projectedOpportunities = buildGrowthMapOpportunityViewItems(
    eligibleOpportunities,
    [mappedPage],
  )
    .map((item): GrowthMapKeywordDeliveryOpportunity => {
      const actionId =
        item.opportunity.readiness === "confirmed"
          ? item.opportunity.actionId
          : null;
      const artifacts =
        actionId === null ? [] : (artifactsByActionId.get(actionId) ?? []);
      const executionRef =
        actionId === null
          ? null
          : GrowthMapExecutionRefSchema.parse({
              actionId,
              artifactIds: artifacts.map((artifact) => artifact.id),
            });
      return {
        id: item.id,
        opportunity: item.opportunity,
        targetPages: item.targetPages,
        artifacts,
        executionRef,
      };
    })
    .sort(
      (left, right) =>
        keywordDeliveryStageRank(left) - keywordDeliveryStageRank(right),
    );

  return {
    kind: "ready",
    publishedDiagnosticRunId: input.publishedDiagnosticRunId,
    mappedPage,
    opportunities: projectedOpportunities,
    artifactCount: projectedOpportunities.reduce(
      (sum, opportunity) => sum + opportunity.artifacts.length,
      0,
    ),
  };
}

/**
 * A bounded live Keyword page can prove a lower bound, never a whole-library
 * total. Preserve that distinction in the headline instead of presenting the
 * first cursor page as an exact project count.
 */
export function growthMapUncoveredKeywordCountPresentation(
  items: readonly GrowthMapKeywordLibraryItem[] | null,
  hasNext: boolean,
): GrowthMapUncoveredKeywordCountPresentation {
  if (items === null) return { kind: "unavailable", count: null };
  if (items.length === 0) return { kind: "empty", count: null };
  const count = items.filter(
    (keyword) => keyword.mappedTarget.kind === "unassigned",
  ).length;
  return { kind: hasNext ? "lower_bound" : "exact", count };
}

/**
 * Join only complete, identity-checked inputs. URL and Opportunity lists are
 * pinned to one Diagnostic Run by their cursor collectors; Keywords are read
 * through that same run-pinned endpoint; Topic structure and insights must
 * name one exact confirmed revision. A draft never participates.
 */
export function buildGrowthMapTopicClusterView(input: {
  readonly diagnosticRunId: string;
  readonly keywordDiagnosticRunId: string;
  readonly workspace: TopicModelWorkspaceProjection;
  readonly insights: GrowthMapTopicModelInsights;
  readonly urls: readonly GrowthMapUrlPortfolioItem[];
  readonly keywords: readonly GrowthMapKeywordLibraryItem[];
  readonly opportunities: readonly GrowthOpportunity[];
}): GrowthMapTopicClusterView {
  if (input.keywordDiagnosticRunId !== input.diagnosticRunId) {
    return { kind: "unavailable", reason: "diagnostic_run_mismatch" };
  }
  const confirmed = input.workspace.latestConfirmed;
  if (confirmed === null) {
    return { kind: "unavailable", reason: "confirmed_topic_unavailable" };
  }
  if (
    input.insights.topicModelRevision !== confirmed.topicModelRevision ||
    input.insights.projectId !== input.workspace.projectId
  ) {
    return { kind: "unavailable", reason: "topic_revision_mismatch" };
  }
  if (
    input.urls.some(
      (url) =>
        url.projectId !== input.workspace.projectId ||
        url.diagnosticRunId !== input.diagnosticRunId,
    )
  ) {
    return { kind: "unavailable", reason: "diagnostic_run_mismatch" };
  }

  const activeNodes = confirmed.nodes.filter(
    (node) => node.lifecycleState === "active",
  );
  const activeById = new Map(
    activeNodes.map((node) => [node.topicNodeId, node]),
  );
  const insightById = new Map(
    input.insights.nodes.map((insight) => [insight.topicNodeId, insight]),
  );
  if (
    activeNodes.some((node) => !insightById.has(node.topicNodeId)) ||
    input.insights.nodes.some((insight) => !activeById.has(insight.topicNodeId))
  ) {
    return { kind: "unavailable", reason: "topic_reference_mismatch" };
  }
  if (
    input.keywords.some((keyword) => {
      if (keyword.cluster === null) return false;
      return keyword.cluster.topicModelRevision !== confirmed.topicModelRevision;
    })
  ) {
    return { kind: "unavailable", reason: "topic_revision_mismatch" };
  }
  if (
    input.keywords.some(
      (keyword) =>
        keyword.projectId !== input.workspace.projectId ||
        (keyword.cluster !== null &&
          !activeById.has(keyword.cluster.clusterId)),
    )
  ) {
    return { kind: "unavailable", reason: "topic_reference_mismatch" };
  }

  const urlById = new Map(input.urls.map((url) => [url.sitePageId, url]));
  if (
    input.keywords.some(
      (keyword) =>
        keyword.mappedTarget.kind === "existing_page" &&
        !urlById.has(keyword.mappedTarget.sitePageId),
    )
  ) {
    return { kind: "unavailable", reason: "inventory_reference_mismatch" };
  }

  const currentAliasTopicByKey = new Map(
    confirmed.aliases
      .filter(
        (alias) =>
          alias.isCurrent &&
          alias.validFromTopicModelRevision <= confirmed.topicModelRevision &&
          alias.validThroughTopicModelRevision === null &&
          activeById.has(alias.topicNodeId),
      )
      .map((alias) => [alias.clusterKey, alias.topicNodeId]),
  );
  const keywordsByTopic = new Map<string, GrowthMapKeywordLibraryItem[]>();
  const pagesByTopic = new Map<string, Map<string, GrowthMapUrlPortfolioItem>>();
  for (const keyword of input.keywords) {
    if (keyword.cluster === null) continue;
    const topicId = keyword.cluster.clusterId;
    const topicKeywords = keywordsByTopic.get(topicId) ?? [];
    topicKeywords.push(keyword);
    keywordsByTopic.set(topicId, topicKeywords);
    if (keyword.mappedTarget.kind === "existing_page") {
      const page = urlById.get(keyword.mappedTarget.sitePageId);
      if (page !== undefined) {
        const topicPages = pagesByTopic.get(topicId) ?? new Map();
        topicPages.set(page.sitePageId, page);
        pagesByTopic.set(topicId, topicPages);
      }
    }
  }
  for (const page of input.urls) {
    if (page.clusterKey === null) continue;
    const topicId = currentAliasTopicByKey.get(page.clusterKey);
    if (topicId === undefined) continue;
    const topicPages = pagesByTopic.get(topicId) ?? new Map();
    topicPages.set(page.sitePageId, page);
    pagesByTopic.set(topicId, topicPages);
  }

  const depthById = new Map<string, number>();
  const depthFor = (topicNodeId: string, seen = new Set<string>()): number => {
    const known = depthById.get(topicNodeId);
    if (known !== undefined) return known;
    if (seen.has(topicNodeId)) return 0;
    seen.add(topicNodeId);
    const parentId = activeById.get(topicNodeId)?.parentTopicNodeId ?? null;
    const depth =
      parentId !== null && activeById.has(parentId)
        ? depthFor(parentId, seen) + 1
        : 0;
    depthById.set(topicNodeId, depth);
    return depth;
  };
  const opportunityItems = buildGrowthMapOpportunityViewItems(
    input.opportunities,
    input.urls,
  );

  const rows = activeNodes.map((node): GrowthMapTopicClusterViewRow => {
    const keywords = keywordsByTopic.get(node.topicNodeId) ?? [];
    const pages = Array.from(pagesByTopic.get(node.topicNodeId)?.values() ?? []);
    const observedVolumes = keywords
      .map((keyword) => keyword.metrics.volume?.value ?? null)
      .filter((value): value is number => value !== null);
    const pageIds = new Set(pages.map((page) => page.sitePageId));
    const insight = insightById.get(node.topicNodeId)!;
    const topOpportunity =
      opportunityItems.find((item) =>
        item.targetPages.some((page) => pageIds.has(page.sitePageId)),
      ) ?? null;
    const primaryPage =
      topOpportunity === null
        ? null
        : [...topOpportunity.targetPages]
            .filter((page) => pageIds.has(page.sitePageId))
            .sort(
              (left, right) =>
                left.normalizedUrl.localeCompare(right.normalizedUrl) ||
                left.sitePageId.localeCompare(right.sitePageId),
            )[0] ?? null;
    return {
      topicNodeId: node.topicNodeId,
      parentTopicNodeId: node.parentTopicNodeId,
      label: node.label,
      description: node.description,
      depth: depthFor(node.topicNodeId),
      keywords,
      keywordCount: keywords.length,
      pages,
      pageCount: pages.length,
      searchVolume: {
        value:
          observedVolumes.length === 0
            ? null
            : observedVolumes.reduce((sum, value) => sum + value, 0),
        observedKeywordCount: observedVolumes.length,
        totalKeywordCount: keywords.length,
        limitation:
          keywords.length === 0
            ? "unavailable"
            : observedVolumes.length === keywords.length
              ? null
              : observedVolumes.length === 0
                ? "unavailable"
                : "partial_search_volume",
      },
      coverageState: insight.coverageState,
      coverageLimitation: insight.limitation,
      primaryCta: {
        availability: "unavailable",
        value: null,
        limitation: "cta_mapping_not_exposed",
      },
      primaryPage,
      topOpportunity,
    };
  });

  return {
    kind: "ready",
    diagnosticRunId: input.diagnosticRunId,
    topicModelRevision: confirmed.topicModelRevision,
    rows,
  };
}

export function resolveVisibleKeywordSelection(
  requestedKeywordId: string | null | undefined,
  visibleKeywordIds: readonly string[],
): string | null {
  if (
    requestedKeywordId != null &&
    visibleKeywordIds.includes(requestedKeywordId)
  ) {
    return requestedKeywordId;
  }
  return visibleKeywordIds[0] ?? null;
}

export interface KeywordRelationSupportingKeyword {
  readonly relationId: string;
  readonly keywordId: string;
  readonly displayKeyword: string;
}

export interface KeywordRelationVisibleItem {
  readonly item: GrowthMapKeywordLibraryItem;
  readonly relations: readonly GrowthMapKeywordRelation[];
  /**
   * Active supporting Keywords hidden from this page are still named beneath
   * their visible primary row, so folding never makes evidence disappear.
   */
  readonly supportingKeywords: readonly KeywordRelationSupportingKeyword[];
  /**
   * A supporting Keyword remains visible when its primary is outside the
   * current cursor page. This pointer explains why it was not collapsed.
   */
  readonly offPagePrimary: KeywordRelationSupportingKeyword | null;
}

export interface KeywordRelationPageProjection {
  readonly visibleItems: readonly KeywordRelationVisibleItem[];
  readonly collapsedSupportingKeywordIds: readonly string[];
  /**
   * Keyword identities in the loaded cursor range, counted once per source
   * kind before duplicate-governance rows are folded from the visible list.
   */
  readonly loadedSourceCounts: Readonly<
    Record<GrowthMapKeywordSourceFilter, number>
  >;
  readonly relationsByKeywordId: ReadonlyMap<
    string,
    readonly GrowthMapKeywordRelation[]
  >;
}

export type GrowthMapUrlPageTypeFilter =
  | "all"
  | NonNullable<GrowthMapUrlPortfolioItem["pageType"]>;

export type GrowthMapUrlPriorityFilter =
  | "all"
  | Extract<
      GrowthMapUrlPortfolioItem["priority"],
      { readonly availability: "available" }
    >["value"];

export interface GrowthMapUrlPageFilters {
  readonly pageType: GrowthMapUrlPageTypeFilter;
  readonly priority: GrowthMapUrlPriorityFilter;
}

export type GrowthMapKeywordSourceFilter =
  | "all"
  | GrowthMapKeywordLibraryItem["sourceOccurrences"][number]["sourceKind"];

export const GROWTH_MAP_KEYWORD_SOURCE_KINDS = [
  "csv_import",
  "dataforseo_ranked",
  "gsc_top_query",
  "interview_summary",
  "user_review",
  "manual",
  "product_profile",
] as const satisfies readonly Exclude<GrowthMapKeywordSourceFilter, "all">[];

export interface KeywordRelationVisibleItemFilters {
  readonly search: string;
  readonly sourceKind: GrowthMapKeywordSourceFilter;
}

export type GrowthMapCompetitorStatusFilter =
  | "all"
  | GrowthMapCompetitorLibraryItem["reviewStatus"];

export interface CompetitorLibraryItemFilters {
  readonly search: string;
  readonly reviewStatus: GrowthMapCompetitorStatusFilter;
}

function normalizeFilterText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function includesNormalizedText(
  value: string | null | undefined,
  search: string,
): boolean {
  return (
    value !== null &&
    value !== undefined &&
    normalizeFilterText(value).includes(search)
  );
}

export function filterGrowthMapUrlItems(
  items: readonly GrowthMapUrlPortfolioItem[],
  filters: GrowthMapUrlPageFilters,
): readonly GrowthMapUrlPortfolioItem[] {
  if (filters.pageType === "all" && filters.priority === "all") {
    return items.filter(() => true);
  }
  return items.filter((item) => {
    const pageTypeMatches =
      filters.pageType === "all" || item.pageType === filters.pageType;
    const priorityMatches =
      filters.priority === "all" ||
      (item.priority.availability === "available" &&
        item.priority.value === filters.priority);
    return pageTypeMatches && priorityMatches;
  });
}

export function filterGrowthMapKeywordEntries(
  items: readonly KeywordRelationVisibleItem[],
  filters: KeywordRelationVisibleItemFilters,
): readonly KeywordRelationVisibleItem[] {
  const normalizedSearch = normalizeFilterText(filters.search);
  const hasSearch = normalizedSearch.length > 0;
  const filterBySourceKind = filters.sourceKind !== "all";
  if (!hasSearch && !filterBySourceKind) {
    return items.filter(() => true);
  }
  return items.filter(({ item }) => {
    const searchMatches =
      !hasSearch ||
      includesNormalizedText(item.displayKeyword, normalizedSearch) ||
      includesNormalizedText(item.marketCode, normalizedSearch) ||
      includesNormalizedText(item.languageTag, normalizedSearch) ||
      includesNormalizedText(item.cluster?.name, normalizedSearch) ||
      includesNormalizedText(item.intent, normalizedSearch) ||
      includesNormalizedText(item.buyerStage, normalizedSearch) ||
      (item.mappedTarget.kind === "existing_page" &&
        includesNormalizedText(
          item.mappedTarget.normalizedUrl,
          normalizedSearch,
        ));
    const sourceKindMatches =
      !filterBySourceKind ||
      item.sourceOccurrences.some(
        (occurrence) => occurrence.sourceKind === filters.sourceKind,
      );
    return searchMatches && sourceKindMatches;
  });
}

export function filterGrowthMapCompetitorItems(
  items: readonly GrowthMapCompetitorLibraryItem[],
  filters: CompetitorLibraryItemFilters,
): readonly GrowthMapCompetitorLibraryItem[] {
  const normalizedSearch = normalizeFilterText(filters.search);
  const hasSearch = normalizedSearch.length > 0;
  const filterByReviewStatus = filters.reviewStatus !== "all";
  if (!hasSearch && !filterByReviewStatus) {
    return items.filter(() => true);
  }
  return items.filter((item) => {
    const searchMatches =
      !hasSearch ||
      includesNormalizedText(item.name, normalizedSearch) ||
      includesNormalizedText(item.domain, normalizedSearch);
    const reviewStatusMatches =
      !filterByReviewStatus || item.reviewStatus === filters.reviewStatus;
    return searchMatches && reviewStatusMatches;
  });
}

function relationParticipant(
  relation: GrowthMapKeywordRelation,
  keywordId: string,
) {
  if (relation.candidate.keywordA.keywordId === keywordId) {
    return relation.candidate.keywordA;
  }
  if (relation.candidate.keywordB.keywordId === keywordId) {
    return relation.candidate.keywordB;
  }
  return null;
}

/**
 * Integrate duplicate governance into the current Keyword Library cursor page.
 *
 * Only an active, effective fold hides a supporting row, and only when the
 * primary row is also present on this page. Stale decisions therefore restore
 * the supporting Keyword automatically. Off-page primaries never create an
 * apparently empty page: the supporting row stays visible with its assignment.
 */
export function buildKeywordRelationPageProjection(
  items: readonly GrowthMapKeywordLibraryItem[],
  relations: readonly GrowthMapKeywordRelation[],
): KeywordRelationPageProjection {
  const loadedSourceCounts: Record<GrowthMapKeywordSourceFilter, number> = {
    all: items.length,
    csv_import: 0,
    dataforseo_ranked: 0,
    gsc_top_query: 0,
    interview_summary: 0,
    user_review: 0,
    manual: 0,
    product_profile: 0,
  };
  for (const item of items) {
    const sourceKinds = new Set(
      item.sourceOccurrences.map((occurrence) => occurrence.sourceKind),
    );
    for (const sourceKind of sourceKinds) {
      loadedSourceCounts[sourceKind] += 1;
    }
  }
  const itemIds = new Set(items.map((item) => item.keywordId));
  const relationsByKeywordId = new Map<string, GrowthMapKeywordRelation[]>();
  const supportingByPrimaryId = new Map<
    string,
    KeywordRelationSupportingKeyword[]
  >();
  const offPagePrimaryBySupportingId = new Map<
    string,
    KeywordRelationSupportingKeyword
  >();
  const collapsedSupportingKeywordIds = new Set<string>();

  for (const relation of relations) {
    const pair = [
      relation.candidate.keywordA.keywordId,
      relation.candidate.keywordB.keywordId,
    ] as const;
    for (const keywordId of pair) {
      if (!itemIds.has(keywordId)) continue;
      const current = relationsByKeywordId.get(keywordId) ?? [];
      if (!current.some((item) => item.relationId === relation.relationId)) {
        current.push(relation);
        relationsByKeywordId.set(keywordId, current);
      }
    }

    if (
      !relation.isEffectivelyFolded ||
      relation.primaryKeywordId === null ||
      relation.supportingKeywordId === null
    ) {
      continue;
    }
    const supporting = relationParticipant(
      relation,
      relation.supportingKeywordId,
    );
    const primary = relationParticipant(relation, relation.primaryKeywordId);
    if (supporting === null || primary === null) continue;

    const supportingRows =
      supportingByPrimaryId.get(relation.primaryKeywordId) ?? [];
    if (
      !supportingRows.some((item) => item.relationId === relation.relationId)
    ) {
      supportingRows.push({
        relationId: relation.relationId,
        keywordId: supporting.keywordId,
        displayKeyword: supporting.displayKeyword,
      });
      supportingByPrimaryId.set(relation.primaryKeywordId, supportingRows);
    }

    if (
      itemIds.has(relation.primaryKeywordId) &&
      itemIds.has(relation.supportingKeywordId)
    ) {
      collapsedSupportingKeywordIds.add(relation.supportingKeywordId);
    } else if (
      itemIds.has(relation.supportingKeywordId) &&
      !itemIds.has(relation.primaryKeywordId)
    ) {
      offPagePrimaryBySupportingId.set(relation.supportingKeywordId, {
        relationId: relation.relationId,
        keywordId: primary.keywordId,
        displayKeyword: primary.displayKeyword,
      });
    }
  }

  return {
    visibleItems: items
      .filter((item) => !collapsedSupportingKeywordIds.has(item.keywordId))
      .map((item) => ({
        item,
        relations: relationsByKeywordId.get(item.keywordId) ?? [],
        supportingKeywords: supportingByPrimaryId.get(item.keywordId) ?? [],
        offPagePrimary:
          offPagePrimaryBySupportingId.get(item.keywordId) ?? null,
      })),
    collapsedSupportingKeywordIds: [...collapsedSupportingKeywordIds],
    loadedSourceCounts,
    relationsByKeywordId,
  };
}

/**
 * Build the exact compare-and-swap command for all four customer decisions.
 * Candidate identity and relation revision always come from the current server
 * projection; the caller supplies only the chosen meaning and review reason.
 */
export function buildKeywordRelationDecisionCommand(
  relation: GrowthMapKeywordRelation,
  decisionKind: KeywordRelationDecisionKind,
  primaryKeywordId: string | null,
  reason: string,
): DecideKeywordRelationRequest | null {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3 || relation.candidateState !== "current") {
    return null;
  }
  if (decisionKind !== "primary_supporting") {
    return {
      expectedRelationRevision: relation.currentRelationRevision,
      candidateId: relation.candidate.candidateId,
      decisionKind,
      primaryKeywordId: null,
      supportingKeywordId: null,
      reason: normalizedReason,
    };
  }

  const keywordA = relation.candidate.keywordA.keywordId;
  const keywordB = relation.candidate.keywordB.keywordId;
  if (primaryKeywordId !== keywordA && primaryKeywordId !== keywordB) {
    return null;
  }
  return {
    expectedRelationRevision: relation.currentRelationRevision,
    candidateId: relation.candidate.candidateId,
    decisionKind,
    primaryKeywordId,
    supportingKeywordId: primaryKeywordId === keywordA ? keywordB : keywordA,
    reason: normalizedReason,
  };
}

type DraftTopicModelRevision = Extract<TopicModelRevision, { state: "draft" }>;

export interface TopicMapTreeNode {
  readonly node: TopicNodeRevision;
  readonly depth: number;
  readonly insight: GrowthMapTopicNodeInsight | null;
  readonly children: readonly TopicMapTreeNode[];
  readonly successorNodeIds: readonly string[];
}

export interface TopicMapProjection {
  /** Draft structure is editable; otherwise this is the immutable published map. */
  readonly structureAuthority: "draft" | "confirmed" | "unavailable";
  /** Coverage always names the latest confirmed revision and never the draft. */
  readonly confirmedInsightRevision: number | null;
  readonly roots: readonly TopicMapTreeNode[];
  readonly activeNodes: readonly TopicNodeRevision[];
  readonly supersededNodes: readonly TopicNodeRevision[];
  readonly selectedNodeId: string | null;
  readonly summary: {
    readonly keywordCount: number;
    readonly mappedPageCount: number;
    readonly coverageGapCount: number;
    readonly conflictCount: number;
  };
}

/**
 * Build one tree from the editable draft when present, while attaching only
 * immutable latest-confirmed coverage facts. New draft nodes therefore show
 * no invented counts and published insights never silently follow draft edits.
 */
export function buildTopicMapProjection(
  workspace: TopicModelWorkspaceProjection,
  insights: GrowthMapTopicModelInsights | null,
  requestedNodeId?: string | null,
): TopicMapProjection {
  const structure = workspace.draft ?? workspace.latestConfirmed;
  const activeNodes =
    structure?.nodes.filter((node) => node.lifecycleState === "active") ?? [];
  const supersededNodes =
    structure?.nodes.filter((node) => node.lifecycleState === "superseded") ??
    [];
  const activeIds = new Set(activeNodes.map((node) => node.topicNodeId));
  const insightAuthorityMatches =
    insights !== null &&
    insights.topicModelRevision !== null &&
    insights.topicModelRevision ===
      workspace.latestConfirmed?.topicModelRevision;
  const insightById = new Map(
    (insightAuthorityMatches ? insights.nodes : []).map((node) => [
      node.topicNodeId,
      node,
    ]),
  );
  const successorById = new Map<string, string[]>();
  for (const relationship of structure?.successorRelationships ?? []) {
    const successors = successorById.get(relationship.sourceTopicNodeId) ?? [];
    successors.push(relationship.successorTopicNodeId);
    successorById.set(relationship.sourceTopicNodeId, successors);
  }
  const childrenByParentId = new Map<string | null, TopicNodeRevision[]>();
  for (const node of activeNodes) {
    const parentId =
      node.parentTopicNodeId !== null && activeIds.has(node.parentTopicNodeId)
        ? node.parentTopicNodeId
        : null;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(node);
    childrenByParentId.set(parentId, siblings);
  }
  const buildBranch = (
    node: TopicNodeRevision,
    depth: number,
  ): TopicMapTreeNode => ({
    node,
    depth,
    insight: insightById.get(node.topicNodeId) ?? null,
    children: (childrenByParentId.get(node.topicNodeId) ?? []).map((child) =>
      buildBranch(child, depth + 1),
    ),
    successorNodeIds: successorById.get(node.topicNodeId) ?? [],
  });
  const roots = (childrenByParentId.get(null) ?? []).map((node) =>
    buildBranch(node, 0),
  );
  const selectedNodeId =
    requestedNodeId !== null &&
    requestedNodeId !== undefined &&
    structure?.nodes.some((node) => node.topicNodeId === requestedNodeId)
      ? requestedNodeId
      : (structure?.rootTopicNodeId ??
        roots[0]?.node.topicNodeId ??
        supersededNodes[0]?.topicNodeId ??
        null);
  const insightNodes = insightAuthorityMatches ? insights.nodes : [];

  return {
    structureAuthority:
      workspace.draft !== null
        ? "draft"
        : workspace.latestConfirmed !== null
          ? "confirmed"
          : "unavailable",
    confirmedInsightRevision: insightAuthorityMatches
      ? insights.topicModelRevision
      : null,
    roots,
    activeNodes,
    supersededNodes,
    selectedNodeId,
    summary: {
      keywordCount: insightNodes.reduce(
        (sum, node) => sum + node.keywordCount,
        0,
      ),
      mappedPageCount: insightNodes.reduce(
        (sum, node) => sum + node.mappedPageCount,
        0,
      ),
      coverageGapCount: insightNodes.filter((node) =>
        ["empty", "uncovered", "partial"].includes(node.coverageState),
      ).length,
      conflictCount: insightNodes.filter(
        (node) => node.coverageState === "conflict",
      ).length,
    },
  };
}

/** Exclude the node and all descendants from its legal parent choices. */
export function topicNodeAllowedParentIds(
  draft: DraftTopicModelRevision,
  topicNodeId: string,
): readonly string[] {
  const activeNodes = draft.nodes.filter(
    (node) => node.lifecycleState === "active",
  );
  const childrenByParent = new Map<string, string[]>();
  for (const node of activeNodes) {
    if (node.parentTopicNodeId === null) continue;
    const children = childrenByParent.get(node.parentTopicNodeId) ?? [];
    children.push(node.topicNodeId);
    childrenByParent.set(node.parentTopicNodeId, children);
  }
  const excluded = new Set<string>();
  const excludeBranch = (nodeId: string) => {
    if (excluded.has(nodeId)) return;
    excluded.add(nodeId);
    for (const child of childrenByParent.get(nodeId) ?? []) {
      excludeBranch(child);
    }
  };
  excludeBranch(topicNodeId);
  return activeNodes
    .map((node) => node.topicNodeId)
    .filter((nodeId) => !excluded.has(nodeId));
}

export interface TopicNodeDraftInput {
  readonly parentTopicNodeId: string | null;
  readonly label: string;
  readonly description: string | null;
  readonly intentEnvelope: readonly string[];
}

function parseTopicNodeDraftIntent(
  input: unknown,
): TopicNodeDraftIntent | null {
  const parsed = TopicNodeDraftIntentSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function buildTopicNodeCreateIntent(
  input: TopicNodeDraftInput,
): TopicNodeDraftIntent | null {
  return parseTopicNodeDraftIntent({ kind: "create", ...input });
}

export function buildTopicNodeUpdateIntent(
  topicNodeId: string,
  changes: {
    readonly parentTopicNodeId?: string | null;
    readonly description?: string | null;
    readonly intentEnvelope?: readonly string[];
  },
): TopicNodeDraftIntent | null {
  return parseTopicNodeDraftIntent({
    kind: "update",
    topicNodeId,
    ...(changes.parentTopicNodeId === undefined
      ? {}
      : { parentTopicNodeId: changes.parentTopicNodeId }),
    ...(changes.description === undefined
      ? {}
      : { description: changes.description }),
    ...(changes.intentEnvelope === undefined
      ? {}
      : { intentEnvelope: changes.intentEnvelope }),
  });
}

export function buildTopicNodeRenameIntent(
  topicNodeId: string,
  label: string,
): TopicNodeDraftIntent | null {
  return parseTopicNodeDraftIntent({ kind: "rename", topicNodeId, label });
}

export function buildTopicNodeRetireIntent(
  topicNodeId: string,
): TopicNodeDraftIntent | null {
  return parseTopicNodeDraftIntent({
    kind: "retire",
    topicNodeId,
    affectedKeywordReviewState: "unreviewed",
  });
}

export function buildTopicNodeSplitIntent(
  sourceTopicNodeId: string,
  successors: readonly TopicNodeDraftInput[],
): TopicNodeDraftIntent | null {
  return parseTopicNodeDraftIntent({
    kind: "split",
    sourceTopicNodeId,
    successors,
    affectedKeywordReviewState: "unreviewed",
  });
}

export function buildTopicNodeMergeIntent(
  sourceTopicNodeIds: readonly string[],
  successor: TopicNodeDraftInput,
): TopicNodeDraftIntent | null {
  return parseTopicNodeDraftIntent({
    kind: "merge",
    sourceTopicNodeIds,
    successor,
    affectedKeywordReviewState: "unreviewed",
  });
}

export function buildBeginTopicModelDraftCommand(
  workspace: TopicModelWorkspaceProjection,
  reason: string,
): BeginTopicModelDraftRequest | null {
  const parsed = BeginTopicModelDraftRequestSchema.safeParse({
    expectedLatestConfirmedRevision:
      workspace.latestConfirmed?.topicModelRevision ?? 0,
    reason,
  });
  return parsed.success ? parsed.data : null;
}

export function buildPatchTopicModelDraftCommand(
  draft: DraftTopicModelRevision,
  reason: string,
  intents: readonly TopicNodeDraftIntent[],
): PatchTopicModelDraftRequest | null {
  const parsed = PatchTopicModelDraftRequestSchema.safeParse({
    topicModelRevision: draft.topicModelRevision,
    expectedEditRevision: draft.editRevision,
    reason,
    intents,
  });
  return parsed.success ? parsed.data : null;
}

export function buildConfirmTopicModelCommand(
  draft: DraftTopicModelRevision,
  reason: string,
): ConfirmTopicModelRequest | null {
  const parsed = ConfirmTopicModelRequestSchema.safeParse({
    topicModelRevision: draft.topicModelRevision,
    expectedEditRevision: draft.editRevision,
    reason,
  });
  return parsed.success ? parsed.data : null;
}

/** A Competitor detail can only be driven by an entity on the visible page. */
export function resolveVisibleCompetitorSelection(
  requestedCompetitorId: string | null | undefined,
  visibleCompetitorIds: readonly string[],
): string | null {
  if (
    requestedCompetitorId != null &&
    visibleCompetitorIds.includes(requestedCompetitorId)
  ) {
    return requestedCompetitorId;
  }
  return visibleCompetitorIds[0] ?? null;
}

export type KeywordLibraryReadState =
  | "loading"
  | "error"
  | "empty"
  | "cursor_empty"
  | "ready";

export function keywordLibraryReadState(input: {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly itemCount: number;
  readonly cursor?: string | null;
}): KeywordLibraryReadState {
  if (input.isPending) return "loading";
  if (input.isError) return "error";
  if (input.itemCount > 0) return "ready";
  return input.cursor == null || input.cursor === "" ? "empty" : "cursor_empty";
}

/**
 * Cursor APIs expose only a forward token. Keying each known predecessor by
 * the current URL cursor keeps browser back/forward from consuming a stale
 * positional stack while still allowing an in-session Previous action.
 */
export function rememberGrowthMapCursorPredecessor(
  predecessors: ReadonlyMap<string, string | null>,
  currentCursor: string | null,
  nextCursor: string,
): ReadonlyMap<string, string | null> {
  const next = new Map(predecessors);
  next.set(nextCursor, currentCursor);
  return next;
}

export function resolveGrowthMapCursorPredecessor(
  predecessors: ReadonlyMap<string, string | null>,
  currentCursor: string | null,
): string | null | undefined {
  return currentCursor === null ? undefined : predecessors.get(currentCursor);
}

export type KeywordDetailReadState =
  | "unselected"
  | "loading"
  | "error"
  | "ready";

export function keywordDetailReadState(input: {
  readonly selectedKeywordId: string | null;
  readonly isPending: boolean;
  readonly isError: boolean;
}): KeywordDetailReadState {
  if (input.selectedKeywordId === null) return "unselected";
  if (input.isPending) return "loading";
  if (input.isError) return "error";
  return "ready";
}

export interface KeywordGovernanceReviewDraft {
  readonly status: GrowthMapKeywordStatus;
  readonly intent: string;
  readonly buyerStage: string;
  readonly topicNodeId: string;
  readonly mappingDecision: KeywordMappingDecision;
  readonly mappedSitePageId: string;
  readonly reason: string;
}

/**
 * Prefill the exception editor from one complete, currently approvable system
 * suggestion. Non-ready or structurally incomplete suggestions stay read-only
 * and must never become an editable draft through client-side guessing.
 */
export function keywordSuggestionReviewDraft(
  suggestion: KeywordGovernancePendingSuggestion | null,
): KeywordGovernanceReviewDraft | null {
  if (
    suggestion === null ||
    suggestion.state !== "pending_ready" ||
    suggestion.readinessReason !== "all_authorities_confirmed" ||
    suggestion.status === null ||
    suggestion.mappingDecision === null ||
    suggestion.reason === null
  ) {
    return null;
  }

  const topicNodeId = suggestion.topicNodeId ?? "";
  const mappedSitePageId = suggestion.mappedSitePageId ?? "";
  if (
    (suggestion.topicNodeId === null) !==
      (suggestion.topicModelRevision === null) ||
    (suggestion.topicNodeId === null) !== (suggestion.topicLabel === null) ||
    (suggestion.mappedSitePageId === null) !==
      (suggestion.mappedSitePageTitle === null) ||
    (suggestion.mappingDecision !== "unassigned" &&
      topicNodeId.length === 0) ||
    (suggestion.mappingDecision === "existing_page") !==
      (mappedSitePageId.length > 0) ||
    (suggestion.status === "excluded" &&
      (topicNodeId.length > 0 ||
        suggestion.mappingDecision !== "unassigned" ||
        mappedSitePageId.length > 0))
  ) {
    return null;
  }

  return {
    status: suggestion.status,
    intent: suggestion.intent ?? "",
    buyerStage: suggestion.buyerStage ?? "",
    topicNodeId,
    mappingDecision: suggestion.mappingDecision,
    mappedSitePageId,
    reason: suggestion.reason,
  };
}

/**
 * Build the existing Keyword review command from customer-editable fields.
 * Topic labels never enter the write contract: the selected stable identity
 * must exist in the latest confirmed Topic insight projection, and the exact
 * confirmed model revision is copied from that authority.
 */
export function buildKeywordGovernanceReviewCommand(
  detail: GrowthMapKeywordLibraryItem,
  topicInsights: GrowthMapTopicModelInsights | null,
  draft: KeywordGovernanceReviewDraft,
): ReviewKeywordRequest | null {
  const topicNodeId = draft.topicNodeId.trim() || null;
  const intent = draft.intent.trim() || null;
  const buyerStage = draft.buyerStage.trim() || null;
  const mappedSitePageId =
    draft.mappingDecision === "existing_page"
      ? draft.mappedSitePageId.trim() || null
      : null;

  let topicModelRevision: number | null = null;
  if (topicNodeId !== null) {
    if (
      topicInsights === null ||
      topicInsights.projectId !== detail.projectId ||
      topicInsights.topicModelRevision === null ||
      !topicInsights.nodes.some(
        (node) =>
          node.topicNodeId === topicNodeId &&
          node.topicModelRevision === topicInsights.topicModelRevision,
      )
    ) {
      return null;
    }
    topicModelRevision = topicInsights.topicModelRevision;
  }

  if (draft.mappingDecision !== "unassigned" && topicNodeId === null) {
    return null;
  }

  const parsed = ReviewKeywordRequestSchema.safeParse({
    expectedGovernanceRevision: detail.revision,
    status: draft.status,
    intent,
    buyerStage,
    topicNodeId,
    topicModelRevision,
    mappingDecision: draft.mappingDecision,
    mappedSitePageId,
    reason: draft.reason,
  });
  return parsed.success ? parsed.data : null;
}

/** Conflict coverage requires an explicit second customer confirmation. */
export function keywordTopicNeedsConflictConfirmation(
  topicInsights: GrowthMapTopicModelInsights | null,
  topicNodeId: string,
): boolean {
  if (
    topicInsights === null ||
    topicNodeId.length === 0 ||
    topicInsights.topicModelRevision === null
  ) {
    return false;
  }
  return topicInsights.nodes.some(
    (node) =>
      node.topicNodeId === topicNodeId &&
      node.topicModelRevision === topicInsights.topicModelRevision &&
      node.coverageState === "conflict",
  );
}

const KEYWORD_RANK_CHART_DIMENSIONS = {
  width: 640,
  height: 248,
  left: 48,
  right: 624,
  top: 20,
  bottom: 204,
} as const;

export interface KeywordRankChartPoint extends GrowthMapKeywordRankPoint {
  readonly x: number;
  readonly y: number;
}

export interface KeywordRankChartSeries {
  readonly provider: GrowthMapKeywordRankProvider;
  readonly metric: GrowthMapKeywordRankMetric;
  readonly interpretation: string;
  readonly points: readonly KeywordRankChartPoint[];
  readonly polylinePoints: string | null;
}

export interface KeywordRankChartChangeMarker extends GrowthMapKeywordContentChangeMarker {
  readonly x: number;
}

export interface KeywordRankChartModel {
  readonly width: number;
  readonly height: number;
  readonly plot: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly maxRank: number;
  readonly yTicks: readonly { readonly value: number; readonly y: number }[];
  readonly series: readonly KeywordRankChartSeries[];
  readonly changeMarkers: readonly KeywordRankChartChangeMarker[];
}

/**
 * Project only canonical observations into chart coordinates. No points are
 * interpolated or backfilled, so an unobserved time range remains visually
 * empty. Rank 1 maps to the top and larger rank numbers map lower.
 */
export function buildKeywordRankChartModel(
  history: GrowthMapKeywordRankHistory,
): KeywordRankChartModel | null {
  const canonicalPoints = history.series.flatMap((series) => series.points);
  if (canonicalPoints.length === 0) return null;

  const plot = {
    left: KEYWORD_RANK_CHART_DIMENSIONS.left,
    right: KEYWORD_RANK_CHART_DIMENSIONS.right,
    top: KEYWORD_RANK_CHART_DIMENSIONS.top,
    bottom: KEYWORD_RANK_CHART_DIMENSIONS.bottom,
  } as const;
  const startedAt = Date.parse(history.window.startedAt);
  const endedAt = Date.parse(history.window.endedAt);
  const timeSpan = endedAt - startedAt;
  const maxRank = Math.max(1, ...canonicalPoints.map((point) => point.value));
  const rankSpan = Math.max(1, maxRank - 1);
  const xFor = (observedAt: string) =>
    plot.left +
    ((Date.parse(observedAt) - startedAt) / timeSpan) *
      (plot.right - plot.left);
  const yFor = (rank: number) =>
    plot.top + ((rank - 1) / rankSpan) * (plot.bottom - plot.top);

  const tickValues = Array.from(
    new Set([1, Math.ceil((maxRank + 1) / 2), maxRank]),
  ).sort((left, right) => left - right);

  return {
    width: KEYWORD_RANK_CHART_DIMENSIONS.width,
    height: KEYWORD_RANK_CHART_DIMENSIONS.height,
    plot,
    maxRank,
    yTicks: tickValues.map((value) => ({ value, y: yFor(value) })),
    series: history.series.map((series) => {
      const points = series.points.map((point) => ({
        ...point,
        x: xFor(point.observedAt),
        y: yFor(point.value),
      }));
      return {
        provider: series.provider,
        metric: series.metric,
        interpretation: series.interpretation,
        points,
        polylinePoints:
          points.length < 2
            ? null
            : points.map((point) => `${point.x},${point.y}`).join(" "),
      };
    }),
    changeMarkers: history.changeMarkers.map((marker) => ({
      ...marker,
      x: xFor(marker.changedAt),
    })),
  };
}

export type CompetitorLibraryReadState = KeywordLibraryReadState;

export function competitorLibraryReadState(input: {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly itemCount: number;
  readonly cursor?: string | null;
}): CompetitorLibraryReadState {
  return keywordLibraryReadState(input);
}

export type CompetitorDetailReadState = KeywordDetailReadState;

export function competitorDetailReadState(input: {
  readonly selectedCompetitorId: string | null;
  readonly isPending: boolean;
  readonly isError: boolean;
}): CompetitorDetailReadState {
  return keywordDetailReadState({
    selectedKeywordId: input.selectedCompetitorId,
    isPending: input.isPending,
    isError: input.isError,
  });
}

const COMPETITOR_ORIGIN_DISPLAY_ORDER = [
  "product_profile",
  "manual",
  "serp_overlap",
  "ai_citation",
  "csv_keyword_gap",
] as const satisfies readonly GrowthMapCompetitorOriginKind[];

export interface CompetitorOriginSummary {
  readonly originKind: GrowthMapCompetitorOriginKind;
  readonly occurrenceCount: number;
  readonly latestObservedAt: string | null;
}

/**
 * Collapse immutable per-run lineage into customer-facing discovery routes.
 * The underlying occurrences remain untouched in the API response; this
 * projection prevents repeated snapshots of one source kind from becoming a
 * long list of technical records in the Competitor profile.
 */
export function competitorOriginSummaries(
  origins: readonly GrowthMapCompetitorOriginOccurrence[],
): readonly CompetitorOriginSummary[] {
  const summaries = new Map<
    GrowthMapCompetitorOriginKind,
    { occurrenceCount: number; latestObservedAt: string | null }
  >();
  for (const origin of origins) {
    const current = summaries.get(origin.originKind);
    const latestObservedAt =
      current?.latestObservedAt === null ||
      current?.latestObservedAt === undefined ||
      (origin.observedAt !== null &&
        origin.observedAt > current.latestObservedAt)
        ? origin.observedAt
        : current.latestObservedAt;
    summaries.set(origin.originKind, {
      occurrenceCount: (current?.occurrenceCount ?? 0) + 1,
      latestObservedAt,
    });
  }
  return COMPETITOR_ORIGIN_DISPLAY_ORDER.flatMap((originKind) => {
    const summary = summaries.get(originKind);
    return summary === undefined ? [] : [{ originKind, ...summary }];
  });
}

export type CompetitorMonitorDisplayState =
  | "not_configured"
  | "paused"
  | "collecting"
  | "awaiting_baseline"
  | "baseline"
  | "available"
  | "partial"
  | "unavailable";

/**
 * Resolve monitor evidence for one exact Competitor selection. A missing ID is
 * deliberately not replaced with the first row because that would project one
 * Competitor's evidence into another Competitor's detail panel.
 */
export function selectCompetitorMonitorItem(
  response: CompetitorMonitorResponse | null | undefined,
  selectedCompetitorId: string | null | undefined,
): CompetitorMonitorItem | null {
  if (response === null || response === undefined || !selectedCompetitorId) {
    return null;
  }
  return (
    response.competitors.find(
      (competitor) => competitor.competitorId === selectedCompetitorId,
    ) ?? null
  );
}

/**
 * Present monitor readiness without converting missing lineage, a missing
 * baseline, or partial collection into a synthetic zero-result comparison.
 */
export function competitorMonitorDisplayState(
  response: CompetitorMonitorResponse,
  item: CompetitorMonitorItem | null,
): CompetitorMonitorDisplayState {
  if (response.availability === "unavailable") return "unavailable";
  if (response.config === null) return "not_configured";
  if (!response.config.enabled) return "paused";
  if (item === null || item.eligibility !== "eligible") return "unavailable";
  if (
    item.collectionState === "collecting" ||
    item.evaluationState === "pending"
  ) {
    return item.collectionState === "never_collected"
      ? "awaiting_baseline"
      : "collecting";
  }
  if (item.collectionState === "never_collected") return "awaiting_baseline";
  if (
    item.collectionState === "unavailable" ||
    item.evaluationState === "unavailable"
  ) {
    return "unavailable";
  }
  if (item.evaluationState === "baseline") return "baseline";
  return item.limitation === null ? "available" : "partial";
}

/**
 * The explicit full profile should not allocate a large monitoring card to
 * configuration, baseline, or unavailable states. Available results remain
 * visible when monitoring is paused so the customer can re-enable collection;
 * all other states stay truthful in the API without becoming empty UI.
 */
export function shouldShowCompetitorMonitor(
  response: CompetitorMonitorResponse | null | undefined,
  item: CompetitorMonitorItem | null,
): boolean {
  if (response === null || response === undefined || item === null) return false;
  const state = competitorMonitorDisplayState(response, item);
  if (state === "available" || state === "partial") return true;
  return (
    state === "paused" &&
    item.eligibility === "eligible" &&
    item.collectionState === "collected" &&
    item.evaluationState === "available"
  );
}

export type CompetitorPoolEntryReason =
  | "customer_confirmed"
  | "collection_pending"
  | "metrics";

/**
 * Why one Competitor entered the pool, in strict priority order. Any Product
 * Profile or manual origin is a customer confirmation and always wins; without
 * one, a missing canonical SERP-overlap observation means collection is still
 * pending. The "metrics" branch is reserved for a future canonical
 * SERP-overlap writer and is unreachable in Competitor Library v1.
 */
export function competitorPoolEntryReason(
  item: Pick<
    GrowthMapCompetitorLibraryItem,
    "originOccurrences" | "serpOverlap"
  >,
): CompetitorPoolEntryReason {
  const customerConfirmed = item.originOccurrences.some(
    (origin) =>
      origin.originKind === "product_profile" || origin.originKind === "manual",
  );
  if (customerConfirmed) return "customer_confirmed";
  if (item.serpOverlap.availability !== "available") {
    return "collection_pending";
  }
  return "metrics";
}

export type CompetitorKeywordGapParticipation =
  | "participating"
  | "awaiting_confirmation"
  | "not_participating";

/**
 * The single Keyword-gap participation ruling shared by the Competitor detail
 * panel and the full-profile drawer: only an approved review with an explicit
 * keyword_gap scope participates, a candidate is awaiting the customer's
 * confirmation, and everything else stays out of the formal comparison.
 */
export function competitorKeywordGapParticipation(
  item: Pick<GrowthMapCompetitorLibraryItem, "reviewStatus" | "analysisScope">,
): CompetitorKeywordGapParticipation {
  if (
    item.reviewStatus === "approved" &&
    item.analysisScope.includes("keyword_gap")
  ) {
    return "participating";
  }
  if (item.reviewStatus === "candidate") return "awaiting_confirmation";
  return "not_participating";
}

export type CompetitorOrganicOverlapDisplay =
  | {
      readonly state: "available";
      readonly percentage: number;
      readonly limitation: string | null;
    }
  | {
      readonly state: "unavailable";
      readonly limitation: string;
    };

/**
 * Convert the persisted canonical overlap ratio into its display percentage.
 * This boundary deliberately has no cohort denominator: the 20-query cohort
 * belongs only to AI citations and must never leak into organic overlap.
 */
export function competitorOrganicOverlapDisplay(
  insight: GrowthMapCompetitorSerpOverlap,
): CompetitorOrganicOverlapDisplay {
  if (insight.availability === "unavailable") {
    return { state: "unavailable", limitation: insight.limitation };
  }
  return {
    state: "available",
    percentage: insight.value * 100,
    limitation: insight.limitation,
  };
}

export type CompetitorAiCitationDisplay =
  | {
      readonly state: "available";
      readonly primary: string;
      readonly attemptedQueries: 20;
      readonly observedQueries: number;
      readonly unavailableQueries: number;
      readonly cohortCoverage: "complete" | "partial";
      readonly limitation: string | null;
    }
  | {
      readonly state: "unavailable";
      readonly limitation: string;
    };

/**
 * Show citations over observed answers. A partial provider cohort therefore
 * reads 8/17, while the separate attempted/unavailable fields keep the fixed
 * 20-query denominator explicit instead of treating missing answers as zero.
 */
export function competitorAiCitationDisplay(
  insight: GrowthMapCompetitorAiCitationInsight,
): CompetitorAiCitationDisplay {
  if (insight.availability === "unavailable") {
    return { state: "unavailable", limitation: insight.limitation };
  }
  return {
    state: "available",
    primary: `${insight.value}/${insight.observedQueries}`,
    attemptedQueries: insight.attemptedQueries,
    observedQueries: insight.observedQueries,
    unavailableQueries: insight.unavailableQueries,
    cohortCoverage: insight.cohortCoverage,
    limitation: insight.limitation,
  };
}

export type CompetitorSharedKeywordDisplay =
  | {
      readonly state: "counted";
      readonly value: number;
      readonly limitation: string | null;
    }
  | {
      readonly state: "collecting" | "no_data";
      readonly limitation: string;
    };

/**
 * The shared-keyword cell shows a count only when the API marks that insight
 * available, and then it is the canonical observed count carried by the
 * contract — never derived here. An unavailable insight keeps the API's own
 * limitation and only distinguishes whether a serp_overlap origin already
 * covers this domain ("collecting") or nothing does ("no data"); 0 is never
 * borrowed for a missing observation.
 */
export function competitorSharedKeywordDisplay(
  item: Pick<
    GrowthMapCompetitorLibraryItem,
    "originOccurrences" | "sharedKeywordInsight"
  >,
): CompetitorSharedKeywordDisplay {
  const insight = item.sharedKeywordInsight;
  if (insight.availability === "available") {
    return {
      state: "counted",
      value: insight.value,
      limitation: insight.limitation,
    };
  }
  return {
    state: item.originOccurrences.some(
      (origin) => origin.originKind === "serp_overlap",
    )
      ? "collecting"
      : "no_data",
    limitation: insight.limitation,
  };
}

export type GrowthMapPlatformLimitationKey =
  | "keywordNoEntries"
  | "competitorNoEntries"
  | "competitorOriginHistoryLimited"
  | "competitorSerpWriterUnavailable"
  | "competitorAiCitationWriterUnavailable"
  | "competitorCandidate"
  | "competitorExcluded"
  | "competitorSourceApprovedReviewPending"
  | "rankNoObservations"
  | "rankNoCanonicalPage"
  | "rankSinglePoint"
  | "rankMissingProviderTimestamp"
  | "rankDataForSeoAbsolute"
  | "rankGscRollingAverage";

const PLATFORM_LIMITATION_KEYS: Readonly<
  Record<string, GrowthMapPlatformLimitationKey>
> = {
  "No canonical Keyword Library entries are available on this cursor page.":
    "keywordNoEntries",
  "No canonical Keyword Library entries are available.": "keywordNoEntries",
  "No canonical Competitor Library entries are available on this cursor page.":
    "competitorNoEntries",
  "No canonical Competitor Library entries are available.":
    "competitorNoEntries",
  "Only the most recent 100 immutable origin occurrences are included; older canonical origin history remains available in storage.":
    "competitorOriginHistoryLimited",
  "SERP overlap is unavailable because Competitor Library v1 has no canonical SERP-overlap writer.":
    "competitorSerpWriterUnavailable",
  "AI citation insight is unavailable because Competitor Library v1 has no canonical AI-citation writer.":
    "competitorAiCitationWriterUnavailable",
  "This Competitor is still a candidate and has not been approved for analysis.":
    "competitorCandidate",
  "This Competitor has been excluded from the approved analysis scope.":
    "competitorExcluded",
  "A Product Profile source is approved, but this stable Competitor Library entity is still awaiting its own review.":
    "competitorSourceApprovedReviewPending",
  "No canonical rank observations are available in the exact trailing 90-day UTC window.":
    "rankNoObservations",
  "This Keyword is not mapped to one canonical existing page, so verified content-change markers are unavailable.":
    "rankNoCanonicalPage",
  "At least one rank series has fewer than two observations, so a trend cannot yet be established.":
    "rankSinglePoint",
  "At least one rank observation has no provider data-as-of timestamp.":
    "rankMissingProviderTimestamp",
  "DataForSEO rank is an absolute provider observation and does not include a provider data-as-of timestamp.":
    "rankDataForSeoAbsolute",
  "GSC position is a rolling 28-day impression-weighted average, not an absolute SERP rank.":
    "rankGscRollingAverage",
};

/** Translate only known platform chrome; customer/source wording stays verbatim. */
export function growthMapPlatformLimitationKey(
  limitation: string,
): GrowthMapPlatformLimitationKey | null {
  return PLATFORM_LIMITATION_KEYS[limitation] ?? null;
}

interface GrowthMapLocationPatch {
  readonly mode?: GrowthMapObjectMode;
  readonly pageView?: GrowthMapPageView;
  readonly selectedSitePageId?: string | null;
  readonly selectedClusterId?: string | null;
  readonly selectedOpportunityId?: string | null;
  readonly selectedKeywordId?: string | null;
  readonly selectedCompetitorId?: string | null;
  readonly selectedFindingId?: string | null;
  readonly search?: string | null;
  readonly cursor?: string | null;
}

/**
 * Build a stable Growth Map deep link. Selecting a URL replaces the canonical
 * `selectedSitePageId` value on every click; object-mode changes intentionally
 * clear page-only state so a hidden selection never controls another view.
 * The Pages tab owns three canonical subviews. A view change clears selections
 * that would otherwise remain hidden, while Opportunity-to-URL drill-down may
 * keep its exact page and Finding alongside the selected Opportunity.
 */
export function growthMapLocationHref(
  pathname: string,
  currentSearch: string,
  patch: GrowthMapLocationPatch,
): string {
  const params = new URLSearchParams(currentSearch);

  if (patch.mode !== undefined) {
    const currentMode = normalizeGrowthMapObjectMode(params.get("object"));
    if (currentMode !== patch.mode) {
      params.delete("q");
      params.delete("cursor");
      params.delete("selectedSitePageId");
      params.delete("selectedOpportunityId");
      params.delete("selectedKeywordId");
      params.delete("selectedCompetitorId");
      params.delete("findingId");
    }

    if (patch.mode === "pages") params.set("object", "pages");
    else params.set("object", patch.mode);

    if (patch.mode !== "pages") {
      params.delete("q");
      params.delete("selectedSitePageId");
      params.delete("selectedOpportunityId");
      params.delete("findingId");
    }
    if (patch.mode === "pages") {
      params.delete("selectedKeywordId");
      params.delete("selectedCompetitorId");
    }
    if (patch.mode === "keywords") {
      params.delete("selectedCompetitorId");
    }
    if (patch.mode === "competitors") {
      params.delete("selectedKeywordId");
    }
    if (patch.mode === "backlinks") {
      params.delete("selectedKeywordId");
      params.delete("selectedCompetitorId");
    }
  }

  const resultingMode = normalizeGrowthMapObjectMode(params.get("object"));
  if (resultingMode !== "pages") {
    params.delete("selectedSitePageId");
    params.delete("selectedOpportunityId");
    params.delete("findingId");
    params.delete("view");
    params.delete("selectedClusterId");
  }

  if (patch.pageView !== undefined && resultingMode === "pages") {
    const currentView = normalizeGrowthMapPageView(params.get("view"));
    if (currentView !== patch.pageView) {
      params.delete("selectedSitePageId");
      params.delete("selectedClusterId");
      params.delete("selectedOpportunityId");
      params.delete("findingId");
    }
    params.set("view", patch.pageView);
  }

  if (patch.selectedSitePageId !== undefined) {
    if (patch.selectedSitePageId === null) {
      params.delete("selectedSitePageId");
    } else {
      params.set("selectedSitePageId", patch.selectedSitePageId);
    }
  }

  if (patch.selectedClusterId !== undefined) {
    if (patch.selectedClusterId === null) {
      params.delete("selectedClusterId");
    } else {
      params.set("selectedClusterId", patch.selectedClusterId);
    }
  }

  if (patch.selectedOpportunityId !== undefined) {
    if (patch.selectedOpportunityId === null) {
      params.delete("selectedOpportunityId");
    } else {
      params.set("selectedOpportunityId", patch.selectedOpportunityId);
    }
  }

  if (patch.selectedKeywordId !== undefined) {
    if (patch.selectedKeywordId === null) {
      params.delete("selectedKeywordId");
    } else {
      params.set("selectedKeywordId", patch.selectedKeywordId);
    }
  }

  if (patch.selectedCompetitorId !== undefined) {
    if (patch.selectedCompetitorId === null) {
      params.delete("selectedCompetitorId");
    } else {
      params.set("selectedCompetitorId", patch.selectedCompetitorId);
    }
  }

  if (patch.selectedFindingId !== undefined) {
    if (patch.selectedFindingId === null) params.delete("findingId");
    else params.set("findingId", patch.selectedFindingId);
  }

  if (patch.search !== undefined) {
    const normalized = patch.search?.trim() ?? "";
    if (normalized === "") params.delete("q");
    else params.set("q", normalized);
  }

  if (patch.cursor !== undefined && resultingMode !== "pages") {
    if (patch.cursor === null || patch.cursor === "") params.delete("cursor");
    else params.set("cursor", patch.cursor);
  }

  if (resultingMode === "pages") {
    // Every Pages subview is built from a complete pinned inventory, so a
    // library/page cursor is never part of its canonical address.
    params.delete("cursor");
    const rawView = params.get("view");
    const pageView = normalizeGrowthMapPageView(rawView);
    if (
      rawView !== null &&
      !GROWTH_MAP_PAGE_VIEWS.includes(rawView as GrowthMapPageView)
    ) {
      params.delete("view");
    }
    if (pageView === "url") {
      params.delete("selectedClusterId");
      params.delete("selectedOpportunityId");
    } else if (pageView === "cluster") {
      params.delete("selectedSitePageId");
      params.delete("selectedOpportunityId");
      params.delete("findingId");
    } else {
      params.delete("selectedClusterId");
    }
    if (!params.has("selectedSitePageId")) {
      params.delete("findingId");
    }
  }

  const query = params.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

type GrowthMapKeywordMetric =
  | GrowthMapKeywordNumericMetric
  | GrowthMapKeywordTextMetric;

/**
 * Mirrors `app.keyword_review_decisions.decision_origin`. `user` is the only
 * value that means a person looked at this keyword; `system_suggestion` and
 * `migration_baseline` are machine writes that have never been human-reviewed.
 */
export const GROWTH_MAP_KEYWORD_REVIEW_ORIGINS = [
  "migration_baseline",
  "system_suggestion",
  "user",
] as const;

export type GrowthMapKeywordReviewOrigin =
  (typeof GROWTH_MAP_KEYWORD_REVIEW_ORIGINS)[number];

/**
 * Read structurally, not off `GrowthMapKeywordLibraryItem`, so this keeps
 * compiling while `reviewOrigin` is being added to the read model. A read
 * model that does not carry the field yet is the same claim as "no decision
 * was ever recorded" — never "a person confirmed it".
 */
export interface GrowthMapKeywordReviewOriginInput {
  readonly status: GrowthMapKeywordStatus;
  readonly reviewOrigin?: GrowthMapKeywordReviewOrigin | null;
}

export interface GrowthMapKeywordReviewPresentation {
  /** i18n key under `growthMap.keywordLibrary` for the status pill label. */
  readonly statusLabelKey: string;
  /** i18n key under `growthMap.keywordLibrary` for the origin qualifier. */
  readonly originLabelKey: string | null;
  /** True when the current status was written by a machine, not a person. */
  readonly awaitingHumanReview: boolean;
}

const KEYWORD_MACHINE_APPROVAL_LABEL_KEY: Readonly<
  Record<Exclude<GrowthMapKeywordReviewOrigin, "user">, string>
> = {
  system_suggestion: "reviewOrigin.approvedBySystem",
  migration_baseline: "reviewOrigin.approvedByMigration",
};

/**
 * `approved` reads as "a person confirmed this keyword", so a machine-written
 * approval must never borrow that label. An auto-approved or migration-baseline
 * keyword is presented as approved *by the system and still awaiting human
 * review*, which is the claim the governance table actually supports.
 */
export function growthMapKeywordReviewPresentation(
  input: GrowthMapKeywordReviewOriginInput,
): GrowthMapKeywordReviewPresentation {
  const origin = input.reviewOrigin ?? null;
  if (origin === null || origin === "user") {
    return {
      statusLabelKey: `status.${input.status}`,
      originLabelKey: null,
      awaitingHumanReview: false,
    };
  }
  return input.status === "approved"
    ? {
        statusLabelKey: KEYWORD_MACHINE_APPROVAL_LABEL_KEY[origin],
        originLabelKey: "reviewOrigin.pendingHumanReview",
        awaitingHumanReview: true,
      }
    : {
        statusLabelKey: `status.${input.status}`,
        originLabelKey: `reviewOrigin.${origin}`,
        awaitingHumanReview: true,
      };
}

export type KeywordMetricPresentation =
  | {
      readonly state: "unavailable";
      readonly limitation: string | null;
    }
  | {
      readonly state: "observed";
      readonly value: number | string;
      readonly observedAt: string;
      readonly freshness: GrowthMapKeywordMetric["freshness"];
      readonly limitation: string | null;
    };

/**
 * Preserve the canonical projection exactly: an observed zero remains a value,
 * while a missing/null metric stays unavailable with the service limitation.
 */
export function keywordMetricPresentation(
  metric: GrowthMapKeywordMetric | null | undefined,
  absenceLimitation: string | null,
): KeywordMetricPresentation {
  if (metric == null) {
    return { state: "unavailable", limitation: absenceLimitation };
  }
  if (metric.value === null) {
    return {
      state: "unavailable",
      limitation: metric.limitation ?? absenceLimitation,
    };
  }
  return {
    state: "observed",
    value: metric.value,
    observedAt: metric.observedAt,
    freshness: metric.freshness,
    limitation: metric.limitation,
  };
}

export interface MetricSelector {
  readonly provider: GrowthMapUrlMetricObservation["provider"];
  readonly pointer: string;
}

/** Match only one explicit provider + persisted JSON pointer; no fallback guess. */
export function findMetricObservation(
  observations: readonly GrowthMapUrlMetricObservation[],
  selector: MetricSelector,
): GrowthMapUrlMetricObservation | null {
  return (
    observations.find(
      (observation) =>
        observation.provider === selector.provider &&
        observation.valueSource.kind === "value_json" &&
        observation.valueSource.pointer === selector.pointer,
    ) ?? null
  );
}

export type MetricPresentation =
  | { readonly state: "missing" }
  | {
      readonly state: "partial" | "unavailable";
      readonly limitation: string | null;
    }
  | {
      readonly state: "observed";
      readonly value: number;
      readonly unit: string | null;
    };

/** Missing and unavailable values remain distinct from a genuinely observed 0. */
export function metricPresentation(
  observation: GrowthMapUrlMetricObservation | null | undefined,
): MetricPresentation {
  if (observation == null) return { state: "missing" };
  if (observation.availability !== "available") {
    return {
      state: observation.availability,
      limitation: observation.limitation,
    };
  }
  if (observation.value === null)
    return { state: "unavailable", limitation: null };
  return {
    state: "observed",
    value: observation.value,
    unit: observation.unit,
  };
}

export type MetricValueLabelKey = "noData" | "coverage.partial";

/**
 * Customer-facing empty-state copy is deliberately coarser than provenance:
 * absent and explicitly unavailable observations both read "No data", while
 * partial data keeps its distinct warning and real numeric zero stays visible.
 */
export function metricValueLabelKey(
  presentation: Exclude<MetricPresentation, { readonly state: "observed" }>,
): MetricValueLabelKey;
export function metricValueLabelKey(
  presentation: MetricPresentation,
): MetricValueLabelKey | null;
export function metricValueLabelKey(
  presentation: MetricPresentation,
): MetricValueLabelKey | null {
  switch (presentation.state) {
    case "missing":
    case "unavailable":
      return "noData";
    case "partial":
      return "coverage.partial";
    case "observed":
      return null;
  }
}

export type GrowthMapReviewIntent =
  | { readonly reviewState: "confirmed"; readonly note?: string }
  | { readonly reviewState: "ignored"; readonly reason: string }
  | { readonly reviewState: "needs_more_data"; readonly note: string };

export type GrowthMapFindingReviewMode = "idle" | "dismiss" | "needs_more_data";

export type GrowthMapReviewProblemPresentation =
  | {
      readonly kind: "canonical";
      readonly code: string;
      readonly title: string;
      readonly detail: string;
      readonly recovery: "refresh" | "resolve_active_action" | "retry";
      readonly executionRef: GrowthMapExecutionRef | null;
    }
  | {
      readonly kind: "fallback";
      readonly recovery: "retry";
      readonly executionRef: null;
    };

const CANONICAL_REVIEW_PROBLEM_CODES: ReadonlySet<string> = new Set([
  "BAD_REQUEST",
  "AUTH_REQUIRED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "FINDING_ACTION_ACTIVE",
  "VALIDATION_ERROR",
  "PROJECT_ARCHIVED",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
]);

function parseExecutionRef(value: unknown): GrowthMapExecutionRef | null {
  const parsed = GrowthMapExecutionRefSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function executionRefFromProblemCurrent(
  current: Readonly<Record<string, unknown>> | null | undefined,
): GrowthMapExecutionRef | null {
  if (current == null) return null;
  const nested = parseExecutionRef(current.executionRef);
  if (nested !== null) return nested;
  return parseExecutionRef({
    actionId: current.actionId,
    artifactIds: current.artifactIds ?? [],
  });
}

/**
 * Preserve only registered, customer-safe review Problems. Unknown thrown
 * values and unregistered Problem codes deliberately lose their raw text so a
 * stack, provider response, or secret can never become customer-visible.
 */
export function presentGrowthMapReviewProblem(
  error: unknown,
  findingExecutionRef: GrowthMapExecutionRef | null,
): GrowthMapReviewProblemPresentation {
  if (
    !(error instanceof ApiError) ||
    !CANONICAL_REVIEW_PROBLEM_CODES.has(error.code)
  ) {
    return { kind: "fallback", recovery: "retry", executionRef: null };
  }

  const recovery =
    error.code === "VERSION_CONFLICT"
      ? "refresh"
      : error.code === "FINDING_ACTION_ACTIVE"
        ? "resolve_active_action"
        : "retry";
  const executionRef =
    recovery === "resolve_active_action"
      ? (executionRefFromProblemCurrent(error.problem.current) ??
        parseExecutionRef(findingExecutionRef))
      : null;

  return {
    kind: "canonical",
    code: error.problem.code,
    title: error.problem.title,
    detail: error.problem.detail,
    recovery,
    executionRef,
  };
}

/** Mutation feedback belongs to the review command, not to the form mode. */
export function shouldShowGrowthMapReviewError(
  mode: GrowthMapFindingReviewMode,
  problem: GrowthMapReviewProblemPresentation | null,
): boolean {
  void mode;
  return problem !== null;
}

export type GrowthMapReviewTarget =
  | {
      readonly kind: "observed_evidence";
      readonly evidenceId: string;
    }
  | {
      readonly kind: "finding";
      readonly finding: GrowthMapUrlFinding;
    };

interface GrowthMapReviewCommandInput {
  readonly target: GrowthMapReviewTarget;
  readonly reviewableFindingIds: readonly string[];
  readonly intent: GrowthMapReviewIntent;
}

/**
 * Build the canonical PATCH command for exactly one allow-listed Finding.
 * Audit Evidence has no review command, and the page's other/supporting
 * Finding IDs are intentionally absent from the result.
 */
export function buildGrowthMapReviewCommand({
  target,
  reviewableFindingIds,
  intent,
}: GrowthMapReviewCommandInput): ReviewFindingVars | null {
  if (
    target.kind !== "finding" ||
    !reviewableFindingIds.includes(target.finding.findingId)
  ) {
    return null;
  }

  let body: ReviewFindingRequest;
  switch (intent.reviewState) {
    case "confirmed":
      body = {
        reviewState: "confirmed",
        baseRevision: target.finding.reviewRevision,
        ...(intent.note === undefined ? {} : { note: intent.note }),
      };
      break;
    case "ignored":
      body = {
        reviewState: "ignored",
        baseRevision: target.finding.reviewRevision,
        reason: intent.reason,
      };
      break;
    case "needs_more_data":
      body = {
        reviewState: "needs_more_data",
        baseRevision: target.finding.reviewRevision,
        note: intent.note,
      };
      break;
  }

  return {
    findingId: target.finding.findingId,
    body,
  };
}

/** One Observation may expose several scalar pointers; name the source once. */
export function uniqueMetricSources(
  observations: readonly GrowthMapUrlMetricObservation[],
): readonly GrowthMapUrlMetricObservation[] {
  const seen = new Set<string>();
  return observations.filter((observation) => {
    if (seen.has(observation.observationId)) return false;
    seen.add(observation.observationId);
    return true;
  });
}

export type GrowthMapMetricLabelKey =
  | "crawlStatus"
  | "crawlFinalStatus"
  | "crawlWordCount"
  | "crawlResponseMs"
  | "gscClicks28d"
  | "gscImpressions28d"
  | "gscPosition28d"
  | "gscPreviousClicks28d"
  | "gscPreviousImpressions28d"
  | "gscPreviousPosition28d"
  | "ga4Sessions"
  | "ga4EngagedSessions"
  | "ga4EngagementRate"
  | "ga4KeyEvents"
  | "observedValue";

const METRIC_LABELS: Readonly<Record<string, GrowthMapMetricLabelKey>> = {
  "crawl:/status": "crawlStatus",
  "crawl:/finalStatus": "crawlFinalStatus",
  "crawl:/wordCount": "crawlWordCount",
  "crawl:/responseMs": "crawlResponseMs",
  "gsc:/current28d/clicks": "gscClicks28d",
  "gsc:/current28d/impressions": "gscImpressions28d",
  "gsc:/current28d/position": "gscPosition28d",
  "gsc:/previous28d/clicks": "gscPreviousClicks28d",
  "gsc:/previous28d/impressions": "gscPreviousImpressions28d",
  "gsc:/previous28d/position": "gscPreviousPosition28d",
  "ga4:/sessions": "ga4Sessions",
  "ga4:/engagedSessions": "ga4EngagedSessions",
  "ga4:/engagementRate": "ga4EngagementRate",
  "ga4:/keyEvents": "ga4KeyEvents",
};

export function metricLabelKey(
  observation: GrowthMapUrlMetricObservation,
): GrowthMapMetricLabelKey {
  const source =
    observation.valueSource.kind === "value_json"
      ? observation.valueSource.pointer
      : "value_numeric";
  return METRIC_LABELS[`${observation.provider}:${source}`] ?? "observedValue";
}

export type FindingTargetLabelKey =
  | "directUrl"
  | "template"
  | "site"
  | "pageSet"
  | "httpStatus"
  | "canonicalIssue"
  | "keywordCluster"
  | "userAgent";

const TARGET_LABELS: Readonly<
  Record<GrowthMapFindingTargetRelation["relation"], FindingTargetLabelKey>
> = {
  direct_url: "directUrl",
  affected_by_template: "template",
  affected_by_site: "site",
  affected_by_page_set: "pageSet",
  affected_by_http_status: "httpStatus",
  affected_by_canonical_issue: "canonicalIssue",
  affected_by_keyword_cluster: "keywordCluster",
  affected_by_user_agent: "userAgent",
};

export function findingTargetLabelKey(
  target: GrowthMapFindingTargetRelation,
): FindingTargetLabelKey {
  return TARGET_LABELS[target.relation];
}

export function identitySourceKey(source: GrowthMapUrlIdentitySource): string {
  return source.kind === "page_snapshot"
    ? `page_snapshot:${source.pageSnapshotId}`
    : `url_observation:${source.observationId}`;
}

/** A readable URL presentation that does not infer page role or page title. */
export function urlPresentation(normalizedUrl: string): {
  readonly hostname: string;
  readonly path: string;
} {
  const url = new URL(normalizedUrl);
  return {
    hostname: url.hostname,
    path: `${url.pathname}${url.search}${url.hash}` || "/",
  };
}

export function safeExternalPageUrl(normalizedUrl: string): string | null {
  const url = new URL(normalizedUrl);
  return url.protocol === "http:" || url.protocol === "https:"
    ? normalizedUrl
    : null;
}

/**
 * The eleven `page_type.v1` slugs the URL read model can send, in the order the
 * filter offers them. The list is a presentation contract only: classification
 * itself is derived server-side, and a slug the client does not know is shown
 * verbatim rather than dropped or relabelled.
 */
export const GROWTH_MAP_PAGE_TYPES = [
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
] as const;

export type GrowthMapKnownPageType = (typeof GROWTH_MAP_PAGE_TYPES)[number];

export type GrowthMapPageTypeLabel =
  | { readonly kind: "unclassified" }
  | { readonly kind: "known"; readonly slug: GrowthMapKnownPageType }
  | { readonly kind: "raw"; readonly value: string };

function isKnownGrowthMapPageType(
  value: string,
): value is GrowthMapKnownPageType {
  return (GROWTH_MAP_PAGE_TYPES as readonly string[]).includes(value);
}

/**
 * A null page type means no classification rule matched this URL. It never
 * means the page was not collected, so the caller must not reuse the
 * "not collected" copy for it.
 */
export function growthMapPageTypeLabel(
  pageType: string | null,
): GrowthMapPageTypeLabel {
  if (pageType === null) return { kind: "unclassified" };
  return isKnownGrowthMapPageType(pageType)
    ? { kind: "known", slug: pageType }
    : { kind: "raw", value: pageType };
}

/** Offer only page types the loaded rows actually carry, in canonical order. */
export function growthMapPageTypeFilterOptions(
  items: readonly GrowthMapUrlPortfolioItem[],
): readonly string[] {
  const present = new Set(
    items.flatMap((item) => (item.pageType === null ? [] : [item.pageType])),
  );
  const known = GROWTH_MAP_PAGE_TYPES.filter((slug) => present.has(slug));
  const unknown = [...present]
    .filter((value) => !isKnownGrowthMapPageType(value))
    .sort((left, right) => left.localeCompare(right));
  return [...known, ...unknown];
}

export const FINDING_SEVERITY_RANK: Readonly<
  Record<GrowthMapUrlFinding["severity"], number>
> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type GrowthMapPrimaryOpportunity =
  | {
      readonly kind: "none";
      /**
       * `no_findings`: the URL projects no Finding at all.
       * `all_closed`: every projected Finding is ignored or no longer active,
       * so there is nothing left to promote as the top opportunity.
       */
      readonly reason: "no_findings" | "all_closed";
      readonly closedFindingCount: number;
    }
  | {
      readonly kind: "execution";
      readonly finding: GrowthMapUrlFinding;
      readonly executionRef: GrowthMapExecutionRef;
    }
  | { readonly kind: "review"; readonly finding: GrowthMapUrlFinding };

/**
 * The exact set the server ranks a URL's priority from (`active` and not
 * `ignored`, see `GrowthMapReadRepository.listCurrentRunUrls`). A confirmed
 * Finding is an accepted problem and keeps ranking until it is resolved; an
 * ignored or inactive one must stop ranking, which is what the human review
 * decision is for.
 */
function isRankableGrowthMapFinding(finding: GrowthMapUrlFinding): boolean {
  return finding.active && finding.reviewState !== "ignored";
}

/**
 * The detail read model orders Findings by canonical id, which says nothing
 * about how urgent they are. The primary action therefore ranks by severity
 * and keeps the projected order as the tie-break, then targets Execution only
 * when that exact Finding already names a canonical Action.
 *
 * Selection runs over the same rankable set the row's priority pill is derived
 * from. Ranking over every Finding instead would promote a Finding a person
 * already ignored — or one the run no longer reports — as "the top
 * opportunity", contradicting the pill on the same screen.
 */
export function growthMapPrimaryOpportunity(
  findings: readonly GrowthMapUrlFinding[],
): GrowthMapPrimaryOpportunity {
  const rankable = findings.filter(isRankableGrowthMapFinding);
  const selected = rankable.reduce<GrowthMapUrlFinding | null>(
    (best, candidate) =>
      best === null ||
      FINDING_SEVERITY_RANK[candidate.severity] <
        FINDING_SEVERITY_RANK[best.severity]
        ? candidate
        : best,
    null,
  );
  if (selected === null) {
    return {
      kind: "none",
      reason: findings.length === 0 ? "no_findings" : "all_closed",
      closedFindingCount: findings.length,
    };
  }
  return selected.executionRef === null
    ? { kind: "review", finding: selected }
    : {
        kind: "execution",
        finding: selected,
        executionRef: selected.executionRef,
      };
}
