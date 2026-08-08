import {
  RULE_OPPORTUNITY_PROJECTION,
  SearchQueryEvidence as SearchQueryEvidenceSchema,
  type GrowthOpportunity as GrowthOpportunityDto,
  type SearchQueryEvidence as SearchQueryEvidenceDto,
} from "@sf/contracts";
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
  type ActionRow,
  type CanonicalValue,
  type Executor,
  type FindingRow,
  type FindingTargetRow,
  type GrowthMapReadableRunRow,
  type ObservationRow,
  type ProjectScope,
  type TopicClusterSupportingFindingRow,
  type WorkspaceScope,
} from "@sf/db";
import {
  CONTEXTUAL_RULE_SET_VERSION,
  GOVERNED_LEGACY_RULE_SET_VERSION,
  LEGACY_RULE_SET_VERSION,
  LINKGRAPH_LEGACY_RULE_SET_VERSION,
  parseContextProjectionV1,
  parseGovernanceProjectionV1,
  PROMPT_SET_VERSION,
  type GovernanceKeywordFactV1,
  type GovernanceProjectionV1,
} from "@sf/engine";
import type { UiLocale } from "@sf/i18n";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import {
  toEvidenceDto,
  type EvidenceDto,
} from "./diagnostic-mappers";
import { assertValidTimestampUuidListCursor } from "./list-cursor";
import {
  buildOpportunity,
  isOpportunityRule,
  primaryTopicClusterKey,
  type OpportunityActionInput,
  type OpportunityFindingInput,
  type OpportunityGovernedCompetitorRelationInput,
  type OpportunityGovernedQueryRelationInput,
  type OpportunityGrowthRelationEvidenceInput,
  type OpportunityGrowthRelationScope,
  type OpportunityTargetInput,
} from "./opportunities-projection";
import { isStale } from "./source-mappers";
import {
  groupTopicClusterSupportRows,
  type TopicClusterSupportRow,
} from "./topic-cluster-projection";

/**
 * Growth Opportunity read-model service (Slice 1). It projects the latest
 * readable diagnostic run's Findings, resolved FindingTargets, canonical
 * Evidence, and Finding-owned Actions into the traceable Opportunity contract.
 * It is strictly read-only: confirmation flows through the existing
 * `PATCH .../findings/{primaryFindingId}` mutation, never a new endpoint here.
 */

export const MAX_OPPORTUNITY_PAGE_SIZE = 100;
const DEFAULT_OPPORTUNITY_PAGE_SIZE = 50;
const OPPORTUNITY_RULE_IDS = Object.freeze(
  Object.keys(RULE_OPPORTUNITY_PROJECTION),
);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA_256 = /^[a-f0-9]{64}$/u;
const FRESHNESS_POLICY_PROVIDERS = new Set(["crawl", "gsc", "ga4", "csv"]);
const CONTENT_GAP_COMPETITOR_SCOPES = new Set([
  "keyword_gap",
  "content",
  "serp_visibility",
]);
const LEGACY_MANIFEST_KEYS = [
  "deliveryLocale",
  "icp",
  "projectId",
  "promptSetVersion",
  "ruleSetVersion",
  "siteId",
  "snapshots",
] as const;
const GOVERNED_MANIFEST_KEYS = [
  ...LEGACY_MANIFEST_KEYS,
  "governance",
] as const;
const CURRENT_CONTEXT_MANIFEST_KEYS = [
  ...GOVERNED_MANIFEST_KEYS,
  "contextProjection",
] as const;
const ICP_MANIFEST_KEYS = ["contentHash", "id", "version"] as const;

interface FrozenRelationSnapshot {
  readonly snapshotId: string;
  readonly provider: string;
  readonly capturedAt: string;
}

interface FrozenGrowthRelationAuthority {
  readonly scope: OpportunityGrowthRelationScope;
  readonly governance: GovernanceProjectionV1;
  readonly snapshotsById: ReadonlyMap<string, FrozenRelationSnapshot>;
}

/** Request-bound opportunity read scope; UI locale controls chrome copy only. */
export interface OpportunityReadScope extends WorkspaceScope {
  readonly uiLocale: UiLocale;
}

export interface OpportunityListOptions {
  readonly limit: number;
  readonly cursor: string | null;
  /** Test/SSR clock seam; never serialized into the response. */
  readonly now?: Date;
}

export interface ProjectOpportunityListResult {
  readonly projectId: string;
  readonly siteId: string;
  readonly diagnosticRunId: string;
  readonly data: GrowthOpportunityDto[];
  readonly meta: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasNext: boolean;
  };
}

export interface ProjectOpportunityDetailResult {
  readonly projectId: string;
  readonly siteId: string;
  readonly diagnosticRunId: string;
  readonly data: GrowthOpportunityDto;
}

function noReadableRun(): never {
  throw new ProblemError(
    "NOT_FOUND",
    "No completed growth audit is available for this project.",
  );
}

function validNow(now: Date): number {
  const ms = now.getTime();
  if (!Number.isFinite(ms)) throw new RangeError("now must be a valid Date");
  return ms;
}

function toFindingInput(row: FindingRow): OpportunityFindingInput {
  return {
    id: row.id,
    ruleId: row.rule_id,
    reviewState: row.review_state,
    active: row.active,
    title: row.summary,
    severity: row.severity,
    reviewRevision: row.review_revision,
  };
}

function toTargetInput(row: FindingTargetRow): OpportunityTargetInput {
  return {
    relation: row.relation,
    targetKind: row.target_kind,
    targetRef: row.target_ref,
    resolutionState: row.resolution_state,
    sitePageId: row.site_page_id,
    pageSnapshotId: row.page_snapshot_id,
  };
}

function toActionInput(row: ActionRow): OpportunityActionInput {
  return {
    id: row.id,
    sourceFindingId: row.source_finding_id,
    status: row.status,
  };
}

function toTopicClusterSupportRow(
  row: TopicClusterSupportingFindingRow,
): TopicClusterSupportRow {
  return {
    clusterKey: row.cluster_key,
    sitePageId: row.site_page_id,
    findingId: row.finding_id,
    mappingConfirmed: row.mapping_review_state === "confirmed",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function readFrozenGrowthRelationAuthority(
  projectId: string,
  run: GrowthMapReadableRunRow,
): FrozenGrowthRelationAuthority | null {
  if (!SHA_256.test(run.input_hash)) return null;
  const manifest = run.input_manifest;
  try {
    if (
      contentHash(manifest as unknown as CanonicalValue) !== run.input_hash
    ) {
      return null;
    }
  } catch {
    return null;
  }
  if (
    manifest["projectId"] !== projectId ||
    manifest["siteId"] !== run.site_id ||
    manifest["ruleSetVersion"] !== run.rule_set_version ||
    manifest["promptSetVersion"] !== run.prompt_set_version ||
    manifest["deliveryLocale"] !== run.output_locale ||
    run.prompt_set_version !== PROMPT_SET_VERSION ||
    !Array.isArray(manifest["snapshots"])
  ) {
    return null;
  }

  const rawIcp = manifest["icp"];
  if (
    !isRecord(rawIcp) ||
    !hasExactKeys(rawIcp, ICP_MANIFEST_KEYS) ||
    rawIcp["id"] !== run.icp_profile_id ||
    rawIcp["version"] !== run.icp_profile_version ||
    typeof rawIcp["contentHash"] !== "string" ||
    !SHA_256.test(rawIcp["contentHash"])
  ) {
    return null;
  }

  let governance: GovernanceProjectionV1;
  try {
    if (run.rule_set_version === CONTEXTUAL_RULE_SET_VERSION) {
      if (!hasExactKeys(manifest, CURRENT_CONTEXT_MANIFEST_KEYS)) return null;
      governance = parseGovernanceProjectionV1(manifest["governance"]);
      parseContextProjectionV1(manifest["contextProjection"]);
    } else if (
      run.rule_set_version === GOVERNED_LEGACY_RULE_SET_VERSION ||
      run.rule_set_version === LINKGRAPH_LEGACY_RULE_SET_VERSION
    ) {
      if (!hasExactKeys(manifest, GOVERNED_MANIFEST_KEYS)) return null;
      governance = parseGovernanceProjectionV1(manifest["governance"]);
    } else if (run.rule_set_version === LEGACY_RULE_SET_VERSION) {
      // This generation predates governance, so it has no authority from which
      // Opportunity query/competitor relations could be projected.
      if (!hasExactKeys(manifest, LEGACY_MANIFEST_KEYS)) return null;
      return null;
    } else {
      return null;
    }
  } catch {
    return null;
  }

  const snapshotsById = new Map<string, FrozenRelationSnapshot>();
  for (const raw of manifest["snapshots"]) {
    if (!isRecord(raw)) return null;
    const snapshotId = raw["snapshotId"];
    const provider = raw["provider"];
    const capturedAt = raw["capturedAt"];
    const availability = raw["availability"];
    if (
      typeof snapshotId !== "string" ||
      !UUID.test(snapshotId) ||
      typeof provider !== "string" ||
      provider.trim().length === 0 ||
      provider !== provider.trim() ||
      typeof capturedAt !== "string" ||
      !Number.isFinite(Date.parse(capturedAt)) ||
      (availability !== "available" && availability !== "partial") ||
      snapshotsById.has(snapshotId)
    ) {
      return null;
    }
    snapshotsById.set(snapshotId, { snapshotId, provider, capturedAt });
  }

  return {
    scope: {
      projectId,
      siteId: run.site_id,
      diagnosticRunId: run.id,
      diagnosticInputHash: run.input_hash,
    },
    governance,
    snapshotsById,
  };
}

/**
 * A Finding identity spans runs, so its full evidence history is too broad for
 * an Opportunity projected from the latest readable run. Keep the run
 * predicate on the relation table and verify the selected Evidence rows again
 * before mapping them.
 */
async function loadCurrentRunEvidenceByFinding(
  exec: Executor,
  scope: ProjectScope,
  diagnosticRunId: string,
  findingIds: readonly string[],
): Promise<Map<string, EvidenceDto[]>> {
  const result = new Map<string, EvidenceDto[]>();
  const uniqueFindingIds = [...new Set(findingIds)];
  for (const findingId of uniqueFindingIds) result.set(findingId, []);
  if (uniqueFindingIds.length === 0) return result;

  const repository = new EvidenceRepository(exec);
  const links = await repository.listForFindings(scope, uniqueFindingIds, {
    diagnosticRunId,
  });
  const evidenceIds = [...new Set(links.map((link) => link.evidence_id))];
  const rows = await repository.findByIds(scope, evidenceIds);
  const byId = new Map<string, EvidenceDto>();
  for (const row of rows) {
    if (row.diagnostic_run_id !== diagnosticRunId) continue;
    try {
      byId.set(row.id, toEvidenceDto(row));
    } catch {
      // A persisted unknown/invalid typed SubjectRef cannot be promoted into
      // the public contract or used as Opportunity authority.
    }
  }
  for (const link of links) {
    const evidence = byId.get(link.evidence_id);
    if (evidence) result.get(link.finding_id)?.push(evidence);
  }
  return result;
}

type ParsedNullableMetric = {
  readonly valid: boolean;
  readonly value: number | null;
};

function nullableMetric(
  value: Record<string, unknown>,
  key: string,
  accepts: (metric: number) => boolean,
): ParsedNullableMetric {
  if (!Object.hasOwn(value, key) || value[key] === null) {
    return { valid: true, value: null };
  }
  const metric = value[key];
  return typeof metric === "number" &&
    Number.isFinite(metric) &&
    accepts(metric)
    ? { valid: true, value: metric }
    : { valid: false, value: null };
}

function exactSearchQueryEvidence(
  keyword: GovernanceKeywordFactV1,
  observation: ObservationRow,
  snapshot: FrozenRelationSnapshot,
  now: number,
): SearchQueryEvidenceDto | null {
  if (
    keyword.queryKind !== "search_query" ||
    (observation.provider !== "csv" &&
      observation.provider !== "dataforseo") ||
    observation.provider !== snapshot.provider ||
    observation.metric_key !== "csv.keyword_gap.v1" ||
    observation.subject_type !== "keyword_cluster" ||
    observation.site_page_id !== null ||
    observation.availability !== "available" ||
    observation.method !== "observed" ||
    observation.support !== "context" ||
    !sameInstant(observation.observed_at, snapshot.capturedAt) ||
    (observation.provider === "csv"
      ? observation.origin !== "user_provided" ||
        observation.grade !== "C"
      : observation.origin !== "vendor_observation" ||
        observation.grade !== "B") ||
    !isRecord(observation.value_json)
  ) {
    return null;
  }

  const value = observation.value_json;
  if (
    value["keyword"] !== keyword.displayKeyword ||
    value["clusterKey"] !== keyword.clusterKey ||
    value["marketCode"] !== keyword.marketCode ||
    value["languageCode"] !== keyword.languageTag
  ) {
    return null;
  }

  const monthlyVolume = nullableMetric(
    value,
    "searchVolume",
    (metric) => metric >= 0,
  );
  const keywordDifficulty = nullableMetric(
    value,
    "keywordDifficulty",
    (metric) => metric >= 0 && metric <= 100,
  );
  const organicRank = nullableMetric(
    value,
    "currentRank",
    (metric) => metric > 0,
  );
  if (
    !monthlyVolume.valid ||
    !keywordDifficulty.valid ||
    !organicRank.valid
  ) {
    return null;
  }

  const freshness = FRESHNESS_POLICY_PROVIDERS.has(observation.provider)
    ? isStale(observation.provider, snapshot.capturedAt, now)
      ? "stale"
      : "current"
    : "unknown";
  const parsed = SearchQueryEvidenceSchema.safeParse({
    queryKind: "search",
    observationId: observation.id,
    snapshotId: observation.snapshot_id,
    query: keyword.displayKeyword,
    marketCode: keyword.marketCode,
    languageCode: keyword.languageTag,
    sourceProvider: observation.provider,
    observedAt: observation.observed_at,
    freshness,
    limitation: observation.limitation,
    metrics: {
      monthlyVolume: monthlyVolume.value,
      keywordDifficulty: keywordDifficulty.value,
      organicRank: organicRank.value,
      // The registered csv.keyword_gap.v1 projection has no GSC traffic
      // counters. Extra JSON members cannot be promoted into those fields.
      impressions: null,
      clicks: null,
    },
  });
  return parsed.success ? parsed.data : null;
}

function sameInstant(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime === rightTime
  );
}

function queryEvidenceRows(
  authority: FrozenGrowthRelationAuthority,
  findingId: string,
  evidence: readonly EvidenceDto[],
  observationsById: ReadonlyMap<string, ObservationRow>,
  now: number,
): OpportunityGovernedQueryRelationInput[] {
  const evidenceBySnapshotProvider = new Map<string, EvidenceDto[]>();
  for (const item of evidence) {
    if (
      item.snapshotId === null ||
      item.collectionRunId === null ||
      item.analysisInvocationId !== null ||
      item.method !== "observed" ||
      item.support !== "supports" ||
      (item.availability !== "available" && item.availability !== "partial")
    ) {
      continue;
    }
    const key = JSON.stringify([item.snapshotId, item.sourceProvider]);
    const rows = evidenceBySnapshotProvider.get(key) ?? [];
    rows.push(item);
    evidenceBySnapshotProvider.set(key, rows);
  }

  const relations: OpportunityGovernedQueryRelationInput[] = [];
  for (const cluster of authority.governance.keywordClusters) {
    for (const keyword of cluster.keywords) {
      // Governance currently freezes generative query identity/classification,
      // but the source registry has no normalized answer-sample observation
      // carrying the four GenerativeQueryEvidence metrics. Such facts remain
      // honestly empty until that canonical observation authority exists.
      if (
        keyword.clusterKey !== cluster.clusterKey ||
        keyword.status !== "approved" ||
        keyword.mappingReviewState !== "confirmed" ||
        keyword.queryKind !== "search_query"
      ) {
        continue;
      }
      for (const occurrence of keyword.occurrenceRefs) {
        if (
          occurrence.snapshotId === null ||
          occurrence.observationId === null
        ) {
          continue;
        }
        const snapshot = authority.snapshotsById.get(occurrence.snapshotId);
        const observation = observationsById.get(occurrence.observationId);
        if (!snapshot || !observation) continue;
        if (
          observation.project_id !== authority.scope.projectId ||
          observation.snapshot_id !== occurrence.snapshotId ||
          observation.id !== occurrence.observationId
        ) {
          continue;
        }
        const queryEvidence = exactSearchQueryEvidence(
          keyword,
          observation,
          snapshot,
          now,
        );
        if (!queryEvidence) continue;
        const linkedEvidence =
          evidenceBySnapshotProvider.get(
            JSON.stringify([observation.snapshot_id, observation.provider]),
          ) ?? [];
        for (const linked of linkedEvidence) {
          if (
            linked.origin !== observation.origin ||
            linked.grade !== observation.grade ||
            !sameInstant(linked.observedAt, observation.observed_at)
          ) {
            continue;
          }
          relations.push({
            ...authority.scope,
            findingId,
            evidenceId: linked.id,
            keywordEntityId: keyword.keywordEntityId,
            keywordRevision: keyword.revision,
            queryEvidence,
          });
        }
      }
    }
  }
  return relations;
}

function competitorEvidenceRows(
  authority: FrozenGrowthRelationAuthority,
  finding: FindingRow,
  targets: readonly OpportunityTargetInput[],
  evidence: readonly EvidenceDto[],
): OpportunityGovernedCompetitorRelationInput[] {
  if (finding.rule_id !== "CONTENT-GAP-011") return [];
  const clusterKey = primaryTopicClusterKey(targets);
  if (clusterKey === null) return [];
  const linkedEvidence = evidence.filter(
    (item) =>
      item.sourceProvider === "system" &&
      item.origin === "derived" &&
      item.method === "computed" &&
      item.support === "context" &&
      (item.availability === "available" ||
        item.availability === "partial") &&
      item.snapshotId === null &&
      item.collectionRunId === null &&
      item.analysisInvocationId === null &&
      item.subjectRefs.some(
        (subject) =>
          subject.type === "keyword_cluster" && subject.value === clusterKey,
      ),
  );
  if (linkedEvidence.length === 0) return [];

  const eligibleCompetitors = new Map(
    authority.governance.competitors
      .filter(
        (competitor) =>
          competitor.reviewStatus === "approved" &&
          competitor.relationship !== null &&
          competitor.analysisScopes.some((scope) =>
            CONTENT_GAP_COMPETITOR_SCOPES.has(scope),
          ),
      )
      .map((competitor) => [competitor.competitorEntityId, competitor] as const),
  );
  const relations: OpportunityGovernedCompetitorRelationInput[] = [];
  for (const linked of linkedEvidence) {
    // This typed identity set is the sole binding authority. Never widen from
    // every approved competitor and never recover identifiers from claim text.
    const explicitlyBoundCompetitorIds = new Set(
      linked.subjectRefs
        .filter(
          (subject) =>
            subject.type === "competitor" && UUID.test(subject.value),
        )
        .map((subject) => subject.value),
    );
    for (const competitorEntityId of [...explicitlyBoundCompetitorIds].sort()) {
      const competitor = eligibleCompetitors.get(competitorEntityId);
      if (!competitor) continue;
      for (const origin of competitor.originRefs) {
        relations.push({
          ...authority.scope,
          findingId: finding.id,
          evidenceId: linked.id,
          competitorEntityId: competitor.competitorEntityId,
          competitorRevision: competitor.revision,
          originOccurrenceId: origin.occurrenceId,
        });
      }
    }
  }
  return relations;
}

async function loadGrowthRelationEvidenceByFinding(
  exec: Executor,
  scope: ProjectScope,
  run: GrowthMapReadableRunRow,
  findings: readonly FindingRow[],
  targetsByFinding: ReadonlyMap<string, readonly OpportunityTargetInput[]>,
  evidenceByFinding: ReadonlyMap<string, readonly EvidenceDto[]>,
  now: number,
): Promise<Map<string, OpportunityGrowthRelationEvidenceInput>> {
  const authority = readFrozenGrowthRelationAuthority(scope.projectId, run);
  if (!authority) return new Map();

  // A query relation also needs a current Finding-owned Evidence row from the
  // same Snapshot. Intersect before reading observations so unrelated frozen
  // library history cannot widen this bounded Opportunity read.
  const findingEvidenceSnapshotIds = new Set(
    [...evidenceByFinding.values()].flatMap((rows) =>
      rows.flatMap((row) => (row.snapshotId === null ? [] : [row.snapshotId])),
    ),
  );
  const snapshotIds = [
    ...new Set(
      authority.governance.keywordClusters.flatMap((cluster) =>
        cluster.keywords.flatMap((keyword) =>
          keyword.occurrenceRefs.flatMap((occurrence) =>
            occurrence.snapshotId !== null &&
            authority.snapshotsById.has(occurrence.snapshotId) &&
            findingEvidenceSnapshotIds.has(occurrence.snapshotId)
              ? [occurrence.snapshotId]
              : [],
          ),
        ),
      ),
    ),
  ].sort();
  const observations =
    snapshotIds.length === 0
      ? []
      : await new ObservationsRepository(exec).listBySnapshotIds(
          scope,
          snapshotIds,
        );
  const observationsById = new Map<string, ObservationRow>();
  const conflictingIds = new Set<string>();
  for (const observation of observations) {
    if (
      observation.workspace_id !== scope.workspaceId ||
      observation.project_id !== scope.projectId ||
      !authority.snapshotsById.has(observation.snapshot_id) ||
      conflictingIds.has(observation.id)
    ) {
      continue;
    }
    if (observationsById.has(observation.id)) {
      observationsById.delete(observation.id);
      conflictingIds.add(observation.id);
      continue;
    }
    observationsById.set(observation.id, observation);
  }

  const result = new Map<string, OpportunityGrowthRelationEvidenceInput>();
  for (const finding of findings) {
    const evidence = evidenceByFinding.get(finding.id) ?? [];
    const targets = targetsByFinding.get(finding.id) ?? [];
    result.set(finding.id, {
      scope: authority.scope,
      governance: authority.governance,
      queryRelations: queryEvidenceRows(
        authority,
        finding.id,
        evidence,
        observationsById,
        now,
      ),
      competitorRelations: competitorEvidenceRows(
        authority,
        finding,
        targets,
        evidence,
      ),
    });
  }
  return result;
}

/**
 * One bounded TopicCluster read for a whole Opportunity page. The cluster keys
 * come from `primaryTopicClusterKey`, so this never loads a cluster no
 * Opportunity on the page is actually projected onto, and a page without a
 * single topic Opportunity issues no query at all.
 */
async function loadTopicClusterRows(
  exec: Executor,
  scope: ProjectScope,
  diagnosticRunId: string,
  clusterKeys: readonly string[],
): Promise<Map<string, readonly TopicClusterSupportRow[]>> {
  if (clusterKeys.length === 0) return new Map();
  const rows = await new TopicClusterReadRepository(exec).listSupportingFindings(
    scope,
    diagnosticRunId,
    clusterKeys,
  );
  return groupTopicClusterSupportRows(rows.map(toTopicClusterSupportRow));
}

function groupTargets(
  targets: readonly FindingTargetRow[],
): Map<string, FindingTargetRow[]> {
  const byFinding = new Map<string, FindingTargetRow[]>();
  for (const target of targets) {
    const rows = byFinding.get(target.finding_id) ?? [];
    rows.push(target);
    byFinding.set(target.finding_id, rows);
  }
  return byFinding;
}

function firstActiveActionByFinding(
  actions: readonly ActionRow[],
): Map<string, ActionRow> {
  const byFinding = new Map<string, ActionRow>();
  for (const action of actions) {
    if (!byFinding.has(action.source_finding_id)) {
      byFinding.set(action.source_finding_id, action);
    }
  }
  return byFinding;
}

async function loadReadableRun(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
): Promise<{
  projectScope: ProjectScope;
  projectDeliveryLocale: string;
  run: GrowthMapReadableRunRow;
}> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const project = await new ProjectsRepository(exec).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  const run = await new GrowthMapReadRepository(exec).findLatestReadableRun(
    projectScope,
  );
  if (!run) noReadableRun();
  return {
    projectScope,
    projectDeliveryLocale: project.default_delivery_locale,
    run,
  };
}

async function listOpportunitiesInSnapshot(
  exec: Executor,
  scope: OpportunityReadScope,
  projectId: string,
  opts: OpportunityListOptions,
): Promise<ProjectOpportunityListResult> {
  const now = validNow(opts.now ?? new Date());
  const { projectScope, projectDeliveryLocale, run } = await loadReadableRun(
    exec,
    scope,
    projectId,
  );

  const page = await new FindingsRepository(exec).list(projectScope, {
    limit: opts.limit,
    cursor: opts.cursor,
    activeOnly: true,
    lastSeenRunId: run.id,
    ruleIds: OPPORTUNITY_RULE_IDS,
  });
  const runFindings = page.rows.filter(
    (finding) =>
      finding.last_seen_run_id === run.id && isOpportunityRule(finding.rule_id),
  );
  const findingIds = runFindings.map((finding) => finding.id);

  const targets = await new FindingTargetsRepository(exec).listForFindings(
    projectScope,
    run.id,
    findingIds,
  );
  const evidenceByFinding = await loadCurrentRunEvidenceByFinding(
    exec,
    projectScope,
    run.id,
    findingIds,
  );
  const actionRows = await new GrowthMapReadRepository(exec).listActiveActions(
    projectScope,
    findingIds,
  );
  const targetsByFinding = groupTargets(targets);
  const actionByFinding = firstActiveActionByFinding(actionRows);
  const targetInputsByFinding = new Map<string, OpportunityTargetInput[]>(
    runFindings.map((finding) => [
      finding.id,
      (targetsByFinding.get(finding.id) ?? []).map(toTargetInput),
    ]),
  );
  const topicClusterRows = await loadTopicClusterRows(
    exec,
    projectScope,
    run.id,
    [
      ...new Set(
        [...targetInputsByFinding.values()]
          .map(primaryTopicClusterKey)
          .filter((key): key is string => key !== null),
      ),
    ],
  );
  const growthRelationsByFinding =
    await loadGrowthRelationEvidenceByFinding(
      exec,
      projectScope,
      run,
      runFindings,
      targetInputsByFinding,
      evidenceByFinding,
      now,
    );

  const data: GrowthOpportunityDto[] = [];
  for (const finding of runFindings) {
    const action = actionByFinding.get(finding.id);
    const growthRelationEvidence = growthRelationsByFinding.get(finding.id);
    const opportunity = buildOpportunity({
      finding: toFindingInput(finding),
      targets: targetInputsByFinding.get(finding.id) ?? [],
      evidence: evidenceByFinding.get(finding.id) ?? [],
      action: action ? toActionInput(action) : null,
      deliveryLocale: projectDeliveryLocale,
      projectId,
      siteId: run.site_id,
      diagnosticRunId: run.id,
      diagnosticInputHash: run.input_hash,
      now,
      topicClusterRows,
      ...(growthRelationEvidence === undefined
        ? {}
        : { growthRelationEvidence }),
    });
    if (opportunity) data.push(opportunity);
  }

  return {
    projectId,
    siteId: run.site_id,
    diagnosticRunId: run.id,
    data,
    meta: {
      limit: opts.limit,
      nextCursor: page.nextCursor,
      hasNext: page.nextCursor !== null,
    },
  };
}

/** `listProjectOpportunities` (Slice 1). One bounded cursor page of Opportunities. */
export async function listProjectOpportunities(
  scope: OpportunityReadScope,
  projectId: string,
  opts: OpportunityListOptions,
  exec?: Executor,
): Promise<ProjectOpportunityListResult> {
  assertValidTimestampUuidListCursor(opts.cursor);
  if (
    !Number.isSafeInteger(opts.limit) ||
    opts.limit < 1 ||
    opts.limit > MAX_OPPORTUNITY_PAGE_SIZE
  ) {
    throw new RangeError("Invalid opportunity list options");
  }
  if (exec) return listOpportunitiesInSnapshot(exec, scope, projectId, opts);
  return getDb().db.transaction(
    (tx) => listOpportunitiesInSnapshot(tx, scope, projectId, opts),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function getOpportunityInSnapshot(
  exec: Executor,
  scope: OpportunityReadScope,
  projectId: string,
  opportunityId: string,
  now: number,
): Promise<ProjectOpportunityDetailResult> {
  const { projectScope, projectDeliveryLocale, run } = await loadReadableRun(
    exec,
    scope,
    projectId,
  );

  const finding = await new FindingsRepository(exec).findById(
    projectScope,
    opportunityId,
  );
  if (
    !finding ||
    !finding.active ||
    finding.last_seen_run_id !== run.id ||
    !isOpportunityRule(finding.rule_id)
  ) {
    throw new ProblemError(
      "NOT_FOUND",
      "This opportunity is not part of the latest growth audit.",
    );
  }

  const targets = await new FindingTargetsRepository(exec).listForFindings(
    projectScope,
    run.id,
    [finding.id],
  );
  const evidenceByFinding = await loadCurrentRunEvidenceByFinding(
    exec,
    projectScope,
    run.id,
    [finding.id],
  );
  const action = await new ActionsRepository(exec).findActiveByFinding(
    projectScope,
    finding.id,
  );

  const targetInputs = targets.map(toTargetInput);
  const clusterKey = primaryTopicClusterKey(targetInputs);
  const topicClusterRows = await loadTopicClusterRows(
    exec,
    projectScope,
    run.id,
    clusterKey === null ? [] : [clusterKey],
  );
  const growthRelationEvidence = (
    await loadGrowthRelationEvidenceByFinding(
      exec,
      projectScope,
      run,
      [finding],
      new Map([[finding.id, targetInputs]]),
      evidenceByFinding,
      now,
    )
  ).get(finding.id);

  const opportunity = buildOpportunity({
    finding: toFindingInput(finding),
    targets: targetInputs,
    evidence: evidenceByFinding.get(finding.id) ?? [],
    action: action ? toActionInput(action) : null,
    deliveryLocale: projectDeliveryLocale,
    projectId,
    siteId: run.site_id,
    diagnosticRunId: run.id,
    diagnosticInputHash: run.input_hash,
    now,
    topicClusterRows,
    ...(growthRelationEvidence === undefined
      ? {}
      : { growthRelationEvidence }),
  });
  if (!opportunity) {
    throw new ProblemError(
      "NOT_FOUND",
      "This finding is not an actionable opportunity.",
    );
  }

  return {
    projectId,
    siteId: run.site_id,
    diagnosticRunId: run.id,
    data: opportunity,
  };
}

/** `getProjectOpportunity` (Slice 1). One Opportunity keyed by its primary Finding. */
export async function getProjectOpportunity(
  scope: OpportunityReadScope,
  projectId: string,
  opportunityId: string,
  exec?: Executor,
): Promise<ProjectOpportunityDetailResult> {
  const now = validNow(new Date());
  if (exec) {
    return getOpportunityInSnapshot(exec, scope, projectId, opportunityId, now);
  }
  return getDb().db.transaction(
    (tx) => getOpportunityInSnapshot(tx, scope, projectId, opportunityId, now),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Documented default page size for the opportunities read surface. */
export { DEFAULT_OPPORTUNITY_PAGE_SIZE };
