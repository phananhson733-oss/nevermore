import {
  GrowthOpportunity,
  RULE_OPPORTUNITY_PROJECTION,
  resolveRuleOpportunityWorkShape,
  type GrowthOpportunity as GrowthOpportunityDto,
  type OpportunityActionSummary,
  type OpportunityEvidenceTrace,
  type OpportunityOwnedAsset,
  type OpportunityRuleId,
  type PrimaryOpportunityTarget,
} from "@sf/contracts";
import { canonicalUtcTimestamptz } from "@sf/db";
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

const EXACT_VARIANT_RULE_IDS = new Set<OpportunityRuleId>([
  "TECH-HTTP-001",
  "TECH-CANONICAL-002",
  "TECH-LINKGRAPH-005",
]);

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

/** The frozen projection rule version: exact-variant technical rules are v2. */
export function opportunityRuleVersion(ruleId: OpportunityRuleId): 1 | 2 {
  return EXACT_VARIANT_RULE_IDS.has(ruleId) ? 2 : 1;
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
  readonly diagnosticRunId: string;
  readonly now: number;
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
    searchQueries: [],
    generativeQueries: [],
    competitorRefs: [],
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
