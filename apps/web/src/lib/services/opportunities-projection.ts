import {
  GenerativeQueryEvidence as GenerativeQueryEvidenceSchema,
  GrowthOpportunity,
  RULE_OPPORTUNITY_PROJECTION,
  SearchQueryEvidence as SearchQueryEvidenceSchema,
  resolveRuleOpportunityWorkShape,
  type GenerativeQueryEvidence as GenerativeQueryEvidenceDto,
  type GrowthOpportunity as GrowthOpportunityDto,
  type OpportunityActionSummary,
  type OpportunityEvidenceTrace,
  type OpportunityOwnedAsset,
  type OpportunityRuleId,
  type PrimaryOpportunityTarget,
  type SearchQueryEvidence as SearchQueryEvidenceDto,
} from "@sf/contracts";
import { canonicalUtcTimestamptz } from "@sf/db";
import {
  parseGovernanceProjectionV1,
  type GovernanceKeywordFactV1,
  type GovernanceProjectionV1,
} from "@sf/engine";
import type { EvidenceDto } from "./diagnostic-mappers";
import { isStale } from "./source-mappers";
import {
  resolveTopicClusterSupport,
  topicClusterSupportLimitations,
  type TopicClusterSupportRow,
} from "./topic-cluster-projection";

/**
 * Growth Opportunity read-model projection (Slice 1). These pure functions
 * mirror the Growth Map projection layer: they turn frozen Findings, resolved
 * FindingTargets, canonical Evidence, and the Finding-owned Action into the
 * traceable Opportunity contract. Confirmation always flows through the
 * Finding review mutation; this layer only reads a confirmed Action back and
 * never writes one.
 */

const OPPORTUNITY_RULES = new Set<string>(
  Object.keys(RULE_OPPORTUNITY_PROJECTION),
);

const REVIEWABLE_STATES = new Set(["unreviewed", "needs_more_data"]);

/** Trace availability the Opportunity contract accepts (never `unavailable`). */
const TRACEABLE_AVAILABILITY = new Set(["available", "partial"]);

const TARGET_KIND_TO_PRIMARY: Readonly<
  Record<string, PrimaryOpportunityTarget>
> = {
  url: "url",
  template: "template",
  site: "site",
  page_set: "template",
  keyword_cluster: "topic",
  http_status: "site",
  canonical_issue: "site",
  user_agent: "site",
};

export function isOpportunityRule(ruleId: string): ruleId is OpportunityRuleId {
  return OPPORTUNITY_RULES.has(ruleId);
}

/** Exact current governed executor version for each Opportunity rule. */
export function opportunityRuleVersion(ruleId: OpportunityRuleId): 1 | 2 | 3 {
  if (ruleId === "TECH-LINKGRAPH-005") return 3;
  if (
    ruleId === "TECH-HTTP-001" ||
    ruleId === "TECH-CANONICAL-002" ||
    ruleId === "CONTENT-GAP-011"
  ) {
    return 2;
  }
  return 1;
}

/** Minimal Finding projection input; decoupled from the DB row shape. */
export interface OpportunityFindingInput {
  readonly id: string;
  readonly ruleId: string;
  readonly reviewState: string;
  readonly active: boolean;
  readonly title: string;
}

/** Minimal FindingTarget projection input. */
export interface OpportunityTargetInput {
  readonly relation: string;
  readonly targetKind: string;
  readonly targetRef: string;
  readonly resolutionState: string;
  readonly sitePageId: string | null;
  readonly pageSnapshotId: string | null;
}

/** Minimal Action projection input; the Action stays Finding-owned. */
export interface OpportunityActionInput {
  readonly id: string;
  readonly sourceFindingId: string;
  readonly status: string;
}

/**
 * Scope repeated on each resolved relation row. The repetition is deliberate:
 * callers commonly batch query/competitor evidence for a whole page, and the
 * pure projector must be able to discard a leaked row rather than trusting the
 * batch container to have applied Project/Site/Run predicates correctly.
 */
export interface OpportunityGrowthRelationScope {
  readonly projectId: string;
  readonly siteId: string;
  readonly diagnosticRunId: string;
  /** Exact hash of the immutable input manifest used by this diagnostic run. */
  readonly diagnosticInputHash: string;
}

/**
 * One canonical query observation joined to the reviewed Keyword identity that
 * the current diagnostic run froze. `evidenceId` links the relation back to
 * Finding-owned Evidence; the Snapshot/Observation lineage remains inside the
 * typed query evidence rather than being reconstructed from prose.
 */
export interface OpportunityGovernedQueryRelationInput
  extends OpportunityGrowthRelationScope {
  readonly findingId: string;
  readonly evidenceId: string;
  readonly keywordEntityId: string;
  readonly keywordRevision: number;
  readonly queryEvidence:
    | SearchQueryEvidenceDto
    | GenerativeQueryEvidenceDto;
}

/**
 * One explicit Finding-to-competitor relation. The Opportunity emits the stable
 * Competitor Entity id, while `originOccurrenceId` proves that the exact
 * approved identity was present in this diagnostic run's frozen governance.
 */
export interface OpportunityGovernedCompetitorRelationInput
  extends OpportunityGrowthRelationScope {
  readonly findingId: string;
  readonly evidenceId: string;
  readonly competitorEntityId: string;
  readonly competitorRevision: number;
  readonly originOccurrenceId: string;
}

/**
 * Authority bundle for keyword and competitor relations. The governance value
 * is parsed again at this read boundary: malformed or non-current input fails
 * closed to honest empty relations and never suppresses an otherwise valid
 * Opportunity.
 */
export interface OpportunityGrowthRelationEvidenceInput {
  /**
   * Identity of the frozen governance envelope. This second scope check keeps
   * even lineage-free manual competitor origins tied to the current run input.
   */
  readonly scope: OpportunityGrowthRelationScope;
  readonly governance: GovernanceProjectionV1;
  readonly queryRelations: readonly OpportunityGovernedQueryRelationInput[];
  readonly competitorRelations: readonly OpportunityGovernedCompetitorRelationInput[];
}

export interface ProjectedOpportunityGrowthRelations {
  readonly searchQueries: SearchQueryEvidenceDto[];
  readonly generativeQueries: GenerativeQueryEvidenceDto[];
  readonly competitorRefs: string[];
}

export interface ResolvedPrimaryTarget {
  readonly primaryTarget: PrimaryOpportunityTarget;
  /** The raw FindingTarget kind, kept so callers do not re-derive it. */
  readonly targetKind: string;
  readonly targetRef: string;
  readonly ownedAsset: OpportunityOwnedAsset | null;
  readonly hasSuitableOwnedAsset: boolean;
}

function urlPathname(targetRef: string): string {
  try {
    return new URL(targetRef).pathname;
  } catch {
    return targetRef;
  }
}

/**
 * The deterministic dedup key for an Opportunity: `${target}:${ref}:${ruleId}`.
 * For URL targets the path is used so the same owned page reads identically
 * across absolute forms. This key is projected, never persisted.
 */
export function deriveOpportunityKey(input: {
  readonly primaryTarget: PrimaryOpportunityTarget;
  readonly targetRef: string;
  readonly ruleId: string;
}): string {
  const ref =
    input.primaryTarget === "url"
      ? urlPathname(input.targetRef)
      : input.targetRef;
  return `${input.primaryTarget}:${ref}:${input.ruleId}`;
}

function isValidUrl(value: string): boolean {
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
}

/**
 * Resolve the primary target and, when the Finding resolves to an owned,
 * crawled page, the suitable owned asset that decides improve vs create.
 * `hasSuitableOwnedAsset` is derived only from resolved crawl lineage, never
 * from an LLM judgement.
 */
export function resolvePrimaryTarget(
  targets: readonly OpportunityTargetInput[],
): ResolvedPrimaryTarget | null {
  const resolved = targets.filter(
    (target) => target.resolutionState === "resolved",
  );
  const directUrl = resolved.find(
    (target) => target.relation === "direct_url" && target.targetKind === "url",
  );
  const chosen = directUrl ?? resolved[0] ?? targets[0];
  if (!chosen) return null;

  const primaryTarget = TARGET_KIND_TO_PRIMARY[chosen.targetKind] ?? "site";
  const ownedAsset =
    chosen.targetKind === "url" &&
    chosen.resolutionState === "resolved" &&
    chosen.sitePageId !== null &&
    chosen.pageSnapshotId !== null &&
    isValidUrl(chosen.targetRef)
      ? {
          sitePageId: chosen.sitePageId,
          snapshotId: chosen.pageSnapshotId,
          url: chosen.targetRef,
          suitableForIntent: true,
        }
      : null;
  return {
    primaryTarget,
    targetKind: chosen.targetKind,
    targetRef: chosen.targetRef,
    ownedAsset,
    hasSuitableOwnedAsset: ownedAsset !== null,
  };
}

/**
 * The keyword cluster label this Finding is actually projected onto, or null
 * when its primary target is not a cluster. Callers batch their TopicCluster
 * read on exactly this key, so the read and the projection can never disagree
 * about which cluster an Opportunity belongs to.
 */
export function primaryTopicClusterKey(
  targets: readonly OpportunityTargetInput[],
): string | null {
  const primary = resolvePrimaryTarget(targets);
  if (!primary || primary.targetKind !== "keyword_cluster") return null;
  return primary.targetRef;
}

/** Project the Finding-linked canonical Evidence into traceable provenance. */
export function buildEvidenceSummary(
  evidence: readonly EvidenceDto[],
  ctx: { readonly diagnosticRunId: string; readonly now: number },
): OpportunityEvidenceTrace[] {
  const traces: OpportunityEvidenceTrace[] = [];
  for (const dto of evidence) {
    if (!TRACEABLE_AVAILABILITY.has(dto.availability)) continue;
    const observedAt = canonicalUtcTimestamptz(dto.observedAt);
    traces.push({
      traceKind: "evidence",
      evidenceId: dto.id,
      diagnosticRunId: ctx.diagnosticRunId,
      snapshotId: dto.snapshotId,
      collectionRunId: dto.collectionRunId,
      analysisInvocationId: dto.analysisInvocationId,
      sourceProvider: dto.sourceProvider,
      availability: dto.availability as "available" | "partial",
      support: dto.support as "supports" | "contradicts" | "context",
      observedAt,
      freshness: isStale(dto.sourceProvider, dto.observedAt, ctx.now)
        ? "stale"
        : "current",
      claim: dto.claim,
      limitation: dto.limitation,
    });
  }
  return traces;
}

export type OpportunityReadiness = "reviewable" | "confirmed" | "skip";

/** Readiness mirrors Growth Map: reviewable states can confirm; a confirmed
 *  Finding with an active Action is confirmed; everything else is not surfaced. */
export function resolveReadiness(input: {
  readonly finding: Pick<OpportunityFindingInput, "reviewState" | "active">;
  readonly action: OpportunityActionInput | null;
}): OpportunityReadiness {
  if (!input.finding.active) return "skip";
  if (input.finding.reviewState === "confirmed") {
    return input.action ? "confirmed" : "skip";
  }
  return REVIEWABLE_STATES.has(input.finding.reviewState)
    ? "reviewable"
    : "skip";
}

/** One canonical Action projection; the Artifact type is rule-fixed. */
export function buildActionSummary(
  action: OpportunityActionInput,
  ruleId: OpportunityRuleId,
): OpportunityActionSummary {
  return {
    actionId: action.id,
    findingId: action.sourceFindingId,
    status: action.status as OpportunityActionSummary["status"],
    artifactType: RULE_OPPORTUNITY_PROJECTION[ruleId].artifactType,
  };
}

function opportunityTitle(finding: OpportunityFindingInput): string {
  return finding.title.trim().slice(0, 500).trim() || finding.ruleId;
}

function uniqueLimitations(
  traces: readonly OpportunityEvidenceTrace[],
  extra: readonly string[],
): string[] {
  const seen = new Set<string>();
  for (const trace of traces) seen.add(trace.limitation);
  for (const limitation of extra) seen.add(limitation);
  return [...seen].slice(0, 200);
}

function emptyGrowthRelations(): ProjectedOpportunityGrowthRelations {
  return {
    searchQueries: [],
    generativeQueries: [],
    competitorRefs: [],
  };
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relationMatchesScope(
  relation: OpportunityGrowthRelationScope,
  scope: OpportunityGrowthRelationScope,
): boolean {
  return (
    relation.projectId === scope.projectId &&
    relation.siteId === scope.siteId &&
    relation.diagnosticRunId === scope.diagnosticRunId &&
    relation.diagnosticInputHash === scope.diagnosticInputHash
  );
}

function keywordSupportsPrimaryTarget(
  keyword: GovernanceKeywordFactV1,
  primary: ResolvedPrimaryTarget,
): boolean {
  if (primary.targetKind === "keyword_cluster") {
    return keyword.clusterKey === primary.targetRef;
  }
  return (
    primary.ownedAsset !== null &&
    keyword.mappingDecision === "existing_page" &&
    keyword.mappedSitePageId === primary.ownedAsset.sitePageId
  );
}

function queryHasFrozenLineage(
  keyword: GovernanceKeywordFactV1,
  query: SearchQueryEvidenceDto | GenerativeQueryEvidenceDto,
): boolean {
  return (
    keyword.occurrenceRefs.some(
      (ref) =>
        ref.snapshotId === query.snapshotId &&
        ref.observationId === query.observationId,
    ) ||
    keyword.metricRefs.some(
      (ref) =>
        ref.snapshotId === query.snapshotId &&
        ref.observationId === query.observationId,
    )
  );
}

function querySortKey(
  query: SearchQueryEvidenceDto | GenerativeQueryEvidenceDto,
): readonly string[] {
  return [
    query.query.normalize("NFKC").toLowerCase(),
    query.marketCode,
    query.languageCode,
    query.snapshotId,
    query.observationId,
  ];
}

function compareQueryEvidence(
  left: SearchQueryEvidenceDto | GenerativeQueryEvidenceDto,
  right: SearchQueryEvidenceDto | GenerativeQueryEvidenceDto,
): number {
  const leftKey = querySortKey(left);
  const rightKey = querySortKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const compared = compareAscii(leftKey[index]!, rightKey[index]!);
    if (compared !== 0) return compared;
  }
  return 0;
}

/**
 * Project reviewed Keyword/Competitor evidence into the three relation fields
 * already present on GrowthOpportunity.
 *
 * A relation is admitted only when all four authority layers agree:
 * - the row belongs to the current Project/Site/DiagnosticRun and Finding;
 * - it links to traceable Finding-owned Evidence;
 * - its entity id + revision + review state exist in the frozen governance;
 * - query observations (or competitor origins) match exact frozen lineage.
 *
 * Missing or malformed authority deliberately returns empty arrays. No live
 * library read, prose parsing, mock metric, or inferred competitor is accepted.
 */
export function projectOpportunityGrowthRelations(input: {
  readonly scope: OpportunityGrowthRelationScope | null;
  readonly findingId: string;
  readonly primary: ResolvedPrimaryTarget;
  readonly evidenceSummary: readonly OpportunityEvidenceTrace[];
  readonly relationEvidence: OpportunityGrowthRelationEvidenceInput | undefined;
}): ProjectedOpportunityGrowthRelations {
  if (input.scope === null || input.relationEvidence === undefined) {
    return emptyGrowthRelations();
  }
  if (
    input.scope.projectId.trim().length === 0 ||
    input.scope.siteId.trim().length === 0 ||
    input.scope.diagnosticRunId.trim().length === 0 ||
    !/^[a-f0-9]{64}$/u.test(input.scope.diagnosticInputHash) ||
    !relationMatchesScope(input.relationEvidence.scope, input.scope)
  ) {
    return emptyGrowthRelations();
  }

  let governance: GovernanceProjectionV1;
  try {
    governance = parseGovernanceProjectionV1(
      input.relationEvidence.governance,
    );
  } catch {
    return emptyGrowthRelations();
  }

  const linkedEvidenceIds = new Set<string>();
  for (const trace of input.evidenceSummary) {
    if (trace.traceKind === "evidence" && trace.support !== "contradicts") {
      linkedEvidenceIds.add(trace.evidenceId);
    }
  }
  const keywordById = new Map<string, GovernanceKeywordFactV1>();
  for (const cluster of governance.keywordClusters) {
    for (const keyword of cluster.keywords) {
      // A mismatched outer cluster/fact cluster is retained by the governance
      // contract for historical accuracy, but it is not an eligible current
      // Opportunity relation.
      if (keyword.clusterKey === cluster.clusterKey) {
        keywordById.set(keyword.keywordEntityId, keyword);
      }
    }
  }

  type QueryEvidence = SearchQueryEvidenceDto | GenerativeQueryEvidenceDto;
  const queryByIdentity = new Map<
    string,
    { readonly value: QueryEvidence; readonly serialized: string }
  >();
  const conflictingQueryIdentities = new Set<string>();

  for (const relation of input.relationEvidence.queryRelations) {
    if (
      !relationMatchesScope(relation, input.scope) ||
      relation.findingId !== input.findingId ||
      !linkedEvidenceIds.has(relation.evidenceId)
    ) {
      continue;
    }
    const keyword = keywordById.get(relation.keywordEntityId);
    if (
      !keyword ||
      keyword.revision !== relation.keywordRevision ||
      keyword.status !== "approved" ||
      keyword.mappingReviewState !== "confirmed" ||
      !keywordSupportsPrimaryTarget(keyword, input.primary)
    ) {
      continue;
    }

    const parsed =
      relation.queryEvidence.queryKind === "search"
        ? SearchQueryEvidenceSchema.safeParse(relation.queryEvidence)
        : relation.queryEvidence.queryKind === "generative"
          ? GenerativeQueryEvidenceSchema.safeParse(relation.queryEvidence)
          : null;
    if (!parsed?.success) continue;
    const query = parsed.data;
    const expectedKind =
      keyword.queryKind === "search_query" ? "search" : "generative";
    if (
      query.queryKind !== expectedKind ||
      query.query !== keyword.displayKeyword ||
      query.marketCode !== keyword.marketCode ||
      query.languageCode !== keyword.languageTag ||
      !queryHasFrozenLineage(keyword, query)
    ) {
      continue;
    }

    // One aggregate Observation may contain multiple governed queries at
    // distinct source pointers, so Observation id alone is not an identity.
    // Keyword Entity + exact lineage is stable and still detects conflicting
    // payloads for the same canonical query relation.
    const identity = JSON.stringify([
      relation.keywordEntityId,
      query.queryKind,
      query.snapshotId,
      query.observationId,
    ]);
    if (conflictingQueryIdentities.has(identity)) continue;
    const serialized = JSON.stringify(query);
    const existing = queryByIdentity.get(identity);
    if (existing && existing.serialized !== serialized) {
      // The same immutable Observation id cannot truthfully carry two payloads.
      // Drop both candidates so input order can never decide the projection.
      queryByIdentity.delete(identity);
      conflictingQueryIdentities.add(identity);
      continue;
    }
    if (!existing) queryByIdentity.set(identity, { value: query, serialized });
  }

  const searchQueries: SearchQueryEvidenceDto[] = [];
  const generativeQueries: GenerativeQueryEvidenceDto[] = [];
  for (const { value } of queryByIdentity.values()) {
    if (value.queryKind === "search") searchQueries.push(value);
    else generativeQueries.push(value);
  }
  searchQueries.sort(compareQueryEvidence);
  generativeQueries.sort(compareQueryEvidence);

  const competitorById = new Map(
    governance.competitors.map((competitor) => [
      competitor.competitorEntityId,
      competitor,
    ]),
  );
  const competitorRefs = new Set<string>();
  for (const relation of input.relationEvidence.competitorRelations) {
    if (
      !relationMatchesScope(relation, input.scope) ||
      relation.findingId !== input.findingId ||
      !linkedEvidenceIds.has(relation.evidenceId)
    ) {
      continue;
    }
    const competitor = competitorById.get(relation.competitorEntityId);
    if (
      !competitor ||
      competitor.revision !== relation.competitorRevision ||
      competitor.reviewStatus !== "approved" ||
      competitor.relationship === null ||
      competitor.analysisScopes.length === 0 ||
      !competitor.originRefs.some(
        (ref) => ref.occurrenceId === relation.originOccurrenceId,
      )
    ) {
      continue;
    }
    competitorRefs.add(competitor.competitorEntityId);
  }

  return {
    searchQueries: searchQueries.slice(0, 500),
    generativeQueries: generativeQueries.slice(0, 500),
    competitorRefs: [...competitorRefs].sort(compareAscii).slice(0, 100),
  };
}

/**
 * Assemble one traceable Opportunity and re-validate it against the contract.
 * Returns null when the Finding is not surfaceable (ignored, no resolved
 * target, or no supporting provenance), which the caller omits from the page.
 */
export function buildOpportunity(input: {
  readonly finding: OpportunityFindingInput;
  readonly targets: readonly OpportunityTargetInput[];
  readonly evidence: readonly EvidenceDto[];
  readonly action: OpportunityActionInput | null;
  /** Current read scope; required before any growth relation can be admitted. */
  readonly projectId?: string;
  readonly siteId?: string;
  readonly diagnosticRunId: string;
  /** Input-manifest identity for the current diagnostic run. */
  readonly diagnosticInputHash?: string;
  readonly now: number;
  /**
   * Frozen governance plus canonical, Finding-linked relation rows. Omission is
   * backward-compatible and intentionally projects honest empty relations.
   */
  readonly growthRelationEvidence?: OpportunityGrowthRelationEvidenceInput;
  /**
   * TopicCluster read-model rows keyed by cluster label. Only a Finding whose
   * primary target IS a keyword cluster can draw supporting Findings from it;
   * every other rule keeps the empty list decision F asked for.
   */
  readonly topicClusterRows?: ReadonlyMap<string, readonly TopicClusterSupportRow[]>;
}): GrowthOpportunityDto | null {
  if (!isOpportunityRule(input.finding.ruleId)) return null;
  const ruleId = input.finding.ruleId as OpportunityRuleId;

  const readiness = resolveReadiness({
    finding: input.finding,
    action: input.action,
  });
  if (readiness === "skip") return null;

  const primary = resolvePrimaryTarget(input.targets);
  if (!primary) return null;

  const evidenceSummary = buildEvidenceSummary(input.evidence, {
    diagnosticRunId: input.diagnosticRunId,
    now: input.now,
  });
  if (!evidenceSummary.some((trace) => trace.support === "supports")) {
    return null;
  }

  const projection = RULE_OPPORTUNITY_PROJECTION[ruleId];
  const workShape = resolveRuleOpportunityWorkShape(ruleId, {
    hasSuitableOwnedAsset: primary.hasSuitableOwnedAsset,
  });
  const clusterSupport =
    primary.targetKind === "keyword_cluster"
      ? resolveTopicClusterSupport(
          input.topicClusterRows?.get(primary.targetRef) ?? [],
          input.finding.id,
        )
      : null;
  const growthRelations = projectOpportunityGrowthRelations({
    scope:
      input.projectId === undefined ||
      input.siteId === undefined ||
      input.diagnosticInputHash === undefined
        ? null
        : {
            projectId: input.projectId,
            siteId: input.siteId,
            diagnosticRunId: input.diagnosticRunId,
            diagnosticInputHash: input.diagnosticInputHash,
          },
    findingId: input.finding.id,
    primary,
    evidenceSummary,
    relationEvidence: input.growthRelationEvidence,
  });
  const base = {
    opportunityKey: deriveOpportunityKey({
      primaryTarget: primary.primaryTarget,
      targetRef: primary.targetRef,
      ruleId,
    }),
    title: opportunityTitle(input.finding),
    workShape,
    primaryTarget: primary.primaryTarget,
    targetRef: primary.targetRef,
    evidenceSummary,
    searchQueries: growthRelations.searchQueries,
    generativeQueries: growthRelations.generativeQueries,
    competitorRefs: growthRelations.competitorRefs,
    currentOwnedAsset: primary.ownedAsset,
    supportingFindingIds: clusterSupport ? [...clusterSupport.findingIds] : [],
    lenses: [projection.lens],
    coverageAndLimitations: uniqueLimitations(
      evidenceSummary,
      clusterSupport ? topicClusterSupportLimitations(clusterSupport) : [],
    ),
  };

  const primaryRule = {
    ruleId,
    ruleVersion: opportunityRuleVersion(ruleId),
  } as const;

  let candidate: unknown;
  if (readiness === "confirmed" && input.action) {
    candidate = {
      ...base,
      readiness: "confirmed",
      primaryFindingId: input.finding.id,
      primaryRule,
      actionId: input.action.id,
      action: buildActionSummary(input.action, ruleId),
    };
  } else {
    candidate = {
      ...base,
      readiness: "reviewable",
      primaryFindingId: input.finding.id,
      primaryRule,
    };
  }

  const parsed = GrowthOpportunity.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
