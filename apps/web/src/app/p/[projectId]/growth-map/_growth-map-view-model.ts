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
  GrowthMapUrlFinding,
  GrowthMapUrlIdentitySource,
  GrowthMapUrlMetricObservation,
  InternalLinkMapCoverage,
  InternalLinkMapEdge,
  InternalLinkMapExecutionRef,
  InternalLinkMapNode,
  InternalLinkRecommendation,
  InternalLinkRecommendationCoverage,
  DecideKeywordRelationRequest,
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

export const GROWTH_MAP_DETAIL_STATES = [
  "audit_evidence",
  "opportunity_review",
] as const;

export type GrowthMapDetailState = (typeof GROWTH_MAP_DETAIL_STATES)[number];

const INTERNAL_LINK_NEIGHBOR_NODE_LIMIT = 12;
const INTERNAL_LINK_NEIGHBOR_EDGE_LIMIT = 20;
const INTERNAL_LINK_INBOUND_SOURCE_LIMIT = 8;
const INTERNAL_LINK_RECOMMENDATION_LIMIT = 8;

export interface InternalLinkExecutionReference
  extends InternalLinkMapExecutionRef {
  readonly role: "target" | "source";
}

export interface InternalLinkRecommendationProjection
  extends InternalLinkRecommendation {
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

/**
 * A selected detail must always correspond to a row in the visible bounded
 * page. Stale/filter-mismatched URL state resolves to the first visible row.
 */
export function resolveVisibleSitePageSelection(
  requestedSitePageId: string | null | undefined,
  visibleSitePageIds: readonly string[],
): string | null {
  if (
    requestedSitePageId != null &&
    visibleSitePageIds.includes(requestedSitePageId)
  ) {
    return requestedSitePageId;
  }
  return visibleSitePageIds[0] ?? null;
}

/** A Keyword detail can only be driven by an entity on the visible cursor page. */
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
  readonly relationsByKeywordId: ReadonlyMap<
    string,
    readonly GrowthMapKeywordRelation[]
  >;
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
  const itemIds = new Set(items.map((item) => item.keywordId));
  const relationsByKeywordId = new Map<
    string,
    GrowthMapKeywordRelation[]
  >();
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
    const primary = relationParticipant(
      relation,
      relation.primaryKeywordId,
    );
    if (supporting === null || primary === null) continue;

    const supportingRows =
      supportingByPrimaryId.get(relation.primaryKeywordId) ?? [];
    if (
      !supportingRows.some(
        (item) => item.relationId === relation.relationId,
      )
    ) {
      supportingRows.push({
        relationId: relation.relationId,
        keywordId: supporting.keywordId,
        displayKeyword: supporting.displayKeyword,
      });
      supportingByPrimaryId.set(
        relation.primaryKeywordId,
        supportingRows,
      );
    }

    if (
      itemIds.has(relation.primaryKeywordId) &&
      itemIds.has(relation.supportingKeywordId)
    ) {
      collapsedSupportingKeywordIds.add(
        relation.supportingKeywordId,
      );
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
      .filter(
        (item) =>
          !collapsedSupportingKeywordIds.has(item.keywordId),
      )
      .map((item) => ({
        item,
        relations: relationsByKeywordId.get(item.keywordId) ?? [],
        supportingKeywords:
          supportingByPrimaryId.get(item.keywordId) ?? [],
        offPagePrimary:
          offPagePrimaryBySupportingId.get(item.keywordId) ?? null,
      })),
    collapsedSupportingKeywordIds: [
      ...collapsedSupportingKeywordIds,
    ],
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
  if (
    normalizedReason.length < 3 ||
    relation.candidateState !== "current"
  ) {
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
    supportingKeywordId:
      primaryKeywordId === keywordA ? keywordB : keywordA,
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
    const successors =
      successorById.get(relationship.sourceTopicNodeId) ?? [];
    successors.push(relationship.successorTopicNodeId);
    successorById.set(relationship.sourceTopicNodeId, successors);
  }
  const childrenByParentId = new Map<string | null, TopicNodeRevision[]>();
  for (const node of activeNodes) {
    const parentId =
      node.parentTopicNodeId !== null &&
      activeIds.has(node.parentTopicNodeId)
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
    children: (childrenByParentId.get(node.topicNodeId) ?? []).map(
      (child) => buildBranch(child, depth + 1),
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

export interface KeywordRankChartChangeMarker
  extends GrowthMapKeywordContentChangeMarker {
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

/**
 * Finding deep links select their exact visible owning URL unless the user has
 * already made an explicit, valid URL choice. The caller may narrow the list
 * with the Finding's canonical URL so the owner is not hidden by pagination.
 */
export function resolveVisibleSitePageSelectionForFinding(
  requestedSitePageId: string | null | undefined,
  requestedFindingId: string | null | undefined,
  visibleItems: readonly {
    readonly sitePageId: string;
    readonly findingIds: readonly string[];
  }[],
): string | null {
  const ids = visibleItems.map((item) => item.sitePageId);
  if (
    requestedSitePageId != null &&
    ids.includes(requestedSitePageId)
  ) {
    return requestedSitePageId;
  }
  if (requestedFindingId) {
    const owner = visibleItems.find((item) =>
      item.findingIds.includes(requestedFindingId),
    );
    if (owner) return owner.sitePageId;
  }
  return ids[0] ?? null;
}

interface GrowthMapLocationPatch {
  readonly mode?: GrowthMapObjectMode;
  readonly selectedSitePageId?: string | null;
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
      params.delete("selectedKeywordId");
      params.delete("selectedCompetitorId");
      params.delete("findingId");
    }

    if (patch.mode === "pages") params.set("object", "pages");
    else params.set("object", patch.mode);

    if (patch.mode !== "pages") {
      params.delete("q");
      params.delete("selectedSitePageId");
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

  if (patch.selectedSitePageId !== undefined) {
    if (patch.selectedSitePageId === null) {
      params.delete("selectedSitePageId");
    } else {
      params.set("selectedSitePageId", patch.selectedSitePageId);
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

  if (patch.cursor !== undefined) {
    if (patch.cursor === null || patch.cursor === "") params.delete("cursor");
    else params.set("cursor", patch.cursor);
  }

  const query = params.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

type GrowthMapKeywordMetric =
  | GrowthMapKeywordNumericMetric
  | GrowthMapKeywordTextMetric;

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
  if (observation.value === null) return { state: "unavailable", limitation: null };
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

export type GrowthMapFindingReviewMode =
  | "idle"
  | "dismiss"
  | "needs_more_data";

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
