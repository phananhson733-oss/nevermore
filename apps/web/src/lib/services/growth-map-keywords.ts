import {
  ApproveKeywordReviewSuggestionRequest as ApproveKeywordReviewSuggestionRequestSchema,
  GrowthMapKeywordDetailResponse,
  GrowthMapKeywordLibraryResponse,
  KeywordGovernanceRevisionConflict,
  ReviewKeywordRequest as ReviewKeywordRequestSchema,
  type GrowthMapCoverage,
  type GrowthMapKeywordLibraryItem,
  type GrowthMapKeywordMappedTarget,
  type GrowthMapKeywordMetrics,
  type GrowthMapKeywordNumericMetric,
  type GrowthMapKeywordSourceOccurrence,
  type GrowthMapKeywordTextMetric,
  type KeywordGovernancePendingSuggestion,
  type ApproveKeywordReviewSuggestionRequest,
  type ReviewKeywordRequest,
  type SourceFreshness,
  GrowthMapKeywordSourceKind,
} from "@sf/contracts";
import {
  MAX_KEYWORD_ENTITY_BATCH,
  KeywordGovernanceConflictError,
  KeywordGovernanceIntegrityError,
  KeywordGovernanceRepository,
  KeywordGovernanceSuggestionGenerationRunsRepository,
  KeywordOccurrencesRepository,
  KeywordReviewSuggestionsRepository,
  KeywordsRepository,
  MAX_KEYWORD_DECISION_ORIGIN_BATCH,
  MAX_KEYWORD_ENTITY_PAGE_SIZE,
  MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
  ProjectsRepository,
  SitePagesRepository,
  canonicalUtcTimestamptz,
  normalizeKeywordIdentity,
  normalizedUrlHash,
  projectPredicate,
  sameTimestamptzInstant,
  schemaTables,
  type CurrentKeywordGovernance,
  type Executor,
  type KeywordDecisionOriginRow,
  type KeywordEntityRow,
  type KeywordOccurrenceRow,
  type KeywordReviewSuggestionReadinessResult,
  type KeywordReviewSuggestionRow,
  type LatestKeywordGovernanceSuggestionGeneration,
  type ProjectScope,
  type SitePageRow,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError, type Logger } from "@sf/observability";
import type { GovernanceKeywordFactV1 } from "@sf/engine";
import {
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
  canonicalizeUrl,
  parseDataForSeoCollectionScope,
  parseDataForSeoSearchLandscapeScope,
  parseDataForSeoSearchLandscapeV2Scope,
  parseDataForSeoSearchLandscapeV3Scope,
} from "@sf/sources";
import { and, asc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  loadPublishedGrowthMapGeneration,
  type PublishedGrowthMapGeneration,
} from "./growth-map-generation";
import {
  assertValidKeywordLibraryLiveListCursor,
  assertValidTimestampUuidListCursor,
} from "./list-cursor";
import { isStale } from "./source-mappers";

const { collectionRuns, dataSnapshots, keywordOccurrences, normalizedObservations } =
  schemaTables;

const MAX_LOOKUP_BATCH = 500;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const GSC_TOP_QUERY_POINTER =
  /^\/valueJson\/topQueries\/([0-9]+)\/query$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const PRODUCT_PROFILE_SOURCE_REF =
  /^product_profile:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})#profile-generative-query\.v1\/[A-Za-z0-9._-]+$/iu;
const KEYWORD_EVIDENCE_FRESHNESS_DAYS = {
  interview_summary: 180,
  user_review: 90,
} as const;
const USER_REVIEW_PLATFORMS = [
  "app_store",
  "g2",
  "capterra",
  "other",
] as const;

const NO_KEYWORDS =
  "No canonical Keyword Library entries are available on this cursor page.";
const OCCURRENCE_HISTORY_LIMITATION =
  "Only the most recent 100 source occurrences are included; older immutable occurrence history remains available in canonical storage.";
const MANUAL_FRESHNESS_LIMITATION =
  "Manual input has no independent provider data-as-of timestamp.";
const PRODUCT_PROFILE_FRESHNESS_LIMITATION =
  "Product Profile-derived GenerativeQuery has no independent provider data-as-of timestamp.";
const UNKNOWN_FRESHNESS_LIMITATION =
  "No provider data-as-of timestamp is available for this source occurrence.";
const NEWER_LIVE_REVIEW_LIMITATION =
  "A newer live Keyword review exists; rerun Analysis Refresh to publish it in the customer-visible Growth Map.";
const LEGACY_SEARCH_INTENT_LIMITATION =
  "This governed search intent predates durable provider or LLM invocation provenance; its original value is preserved as a pre-ledger classification.";
const UNAVAILABLE_SEARCH_INTENT_LIMITATION =
  "No user-confirmed, provider-observed, or durably generated search intent is available for this keyword.";
const SUGGESTION_GENERATING_LIMITATION =
  "The bounded Keyword suggestion job is still running.";
const SUGGESTION_INTENT_AUTHORITY_LIMITATION =
  "The generated suggestion has no verifiable search intent authority and requires manual review.";
const SUGGESTION_STALE_LIMITATION =
  "The Keyword governance authority changed after generation; regenerate before approval.";
const SUGGESTION_UNAVAILABLE_LIMITATION =
  "A safe Keyword governance suggestion is currently unavailable; retry generation or review this Keyword manually.";

const PROVIDER_SEARCH_INTENTS = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const;

const CLASSIFICATION_LIMITATIONS = {
  intent: "Search intent has not been classified.",
  buyerStage: "Buyer stage has not been classified.",
  cluster: "Keyword cluster has not been classified.",
  clusterWithoutId:
    "A cluster label exists, but no canonical cluster ID is available for this Keyword Library projection.",
} as const;

const METRIC_POINTERS = {
  volume: "/valueJson/searchVolume",
  kd: "/valueJson/keywordDifficulty",
  currentRank: "/valueJson/currentRank",
  currentUrl: "/valueJson/currentUrl",
  competitorDomain: "/valueJson/competitorDomain",
  competitorRank: "/valueJson/competitorRank",
} as const;

type MetricField = keyof typeof METRIC_POINTERS;

const MISSING_METRIC_LIMITATIONS: Record<MetricField, string> = {
  volume:
    "No canonical /valueJson/searchVolume metric is available for this keyword.",
  kd: "No canonical /valueJson/keywordDifficulty metric is available for this keyword.",
  currentRank:
    "No canonical /valueJson/currentRank metric is available for this keyword.",
  currentUrl:
    "No canonical /valueJson/currentUrl metric is available for this keyword.",
  competitorDomain:
    "No canonical /valueJson/competitorDomain metric is available for this keyword.",
  competitorRank:
    "No canonical /valueJson/competitorRank metric is available for this keyword.",
};

export interface GrowthMapKeywordListOptions {
  readonly limit: number;
  readonly cursor: string | null;
  readonly diagnosticRunId?: string | null;
  /** Restrict the live library page to one intake source. */
  readonly sourceKind?: GrowthMapKeywordSourceKind | null;
  /** Test/SSR clock seam; never serialized. */
  readonly now?: Date;
}

interface CanonicalObservationRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly site_page_id: string | null;
  readonly provider: string;
  readonly metric_key: string;
  readonly subject_type: string;
  readonly subject_ref: string;
  readonly observed_at: string;
  readonly availability: string;
  readonly value_json: unknown;
  readonly unit: string | null;
  readonly origin: string;
  readonly method: string;
  readonly grade: string;
  readonly support: string;
  readonly limitation: string;
}

interface CanonicalSnapshotRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly collection_run_id: string;
  readonly source_connection_id: string | null;
  readonly provider: string;
  readonly dataset_key: string;
  readonly schema_version: string;
  readonly method_version: string;
  readonly captured_at: string;
  readonly availability: string;
  readonly limitation: string;
  readonly summary: Record<string, unknown>;
}

interface CanonicalCollectionRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly source_connection_id: string | null;
  readonly provider: string;
  readonly operation: string;
  readonly method_version: string;
  readonly import_preview_id: string | null;
}

interface EntityOccurrenceHistory {
  readonly entity: KeywordEntityRow;
  readonly rows: readonly KeywordOccurrenceRow[];
  readonly truncated: boolean;
}

interface FrozenEntityOccurrenceHistory extends EntityOccurrenceHistory {
  readonly frozen: FrozenKeywordProjection;
}

interface FrozenKeywordProjection {
  readonly fact: GovernanceKeywordFactV1;
  readonly topicNodeId: string | null;
  readonly topicModelRevision: number | null;
}

interface KeywordProjectionRows {
  readonly histories: readonly EntityOccurrenceHistory[];
  readonly observationsById: ReadonlyMap<string, CanonicalObservationRow>;
  readonly snapshotsById: ReadonlyMap<string, CanonicalSnapshotRow>;
  readonly collectionRunsById: ReadonlyMap<string, CanonicalCollectionRunRow>;
  readonly sitePagesById: ReadonlyMap<string, SitePageRow>;
  /**
   * Which authority decided each keyword at the EXACT revision this projection
   * reports. A keyword absent from the map has no decision at that revision.
   */
  readonly reviewAuthoritiesByKeywordId: ReadonlyMap<
    string,
    KeywordDecisionOriginRow
  >;
}

/**
 * Read the deciding authority for a whole page in one project-scoped
 * statement.
 *
 * Automated keyword governance writes the same `approved` + `confirmed` pair a
 * human review writes, because the diagnostic freeze requires exactly that
 * pair. Without this the customer-visible library cannot tell an operator's
 * confirmation from a machine's, which would present an unreviewed keyword as
 * reviewed.
 */
async function loadReviewAuthorities(
  exec: Executor,
  scope: ProjectScope,
  refs: readonly { readonly keywordId: string; readonly revision: number }[],
): Promise<ReadonlyMap<string, KeywordDecisionOriginRow>> {
  const byKeywordId = new Map<string, KeywordDecisionOriginRow>();
  if (refs.length === 0) return byKeywordId;
  const repository = new KeywordGovernanceRepository(exec);
  for (const batch of batches(refs, MAX_KEYWORD_DECISION_ORIGIN_BATCH)) {
    const requestedRevisionByKeywordId = new Map(
      batch.map((ref) => [ref.keywordId, ref.revision] as const),
    );
    let rows: readonly KeywordDecisionOriginRow[];
    try {
      rows = await repository.listDecisionOriginsAt(
        scope,
        batch.map((ref) => ({
          keywordId: ref.keywordId,
          governanceRevision: ref.revision,
        })),
      );
    } catch (error) {
      if (error instanceof KeywordGovernanceIntegrityError) {
        return corruptKeywordLibrary();
      }
      throw error;
    }
    for (const row of rows) {
      if (
        byKeywordId.has(row.keywordId) ||
        row.governanceRevision !==
          requestedRevisionByKeywordId.get(row.keywordId)
      ) {
        return corruptKeywordLibrary();
      }
      byKeywordId.set(row.keywordId, row);
    }
  }
  return byKeywordId;
}

interface ProjectedOccurrence {
  readonly row: KeywordOccurrenceRow;
  readonly dto: GrowthMapKeywordSourceOccurrence;
  readonly observation: CanonicalObservationRow | null;
  readonly snapshot: CanonicalSnapshotRow | null;
}

interface InterviewSummaryEvidence {
  readonly kind: "interview_summary";
  readonly evidenceLabel: string;
  readonly sourceRecordHash: string;
}

interface UserReviewEvidence {
  readonly kind: "user_review";
  readonly evidenceLabel: string;
  readonly sourceRecordHash: string;
  readonly reviewPlatform: (typeof USER_REVIEW_PLATFORMS)[number];
  readonly sourceUrl: string | null;
}

type KeywordEvidence = InterviewSummaryEvidence | UserReviewEvidence;

function normalizePinnedDiagnosticRunId(
  diagnosticRunId: string | null | undefined,
): string | null {
  if (diagnosticRunId === undefined || diagnosticRunId === null) return null;
  if (
    diagnosticRunId.length === 0 ||
    diagnosticRunId.trim() !== diagnosticRunId ||
    !UUID.test(diagnosticRunId)
  ) {
    throw new RangeError("diagnosticRunId must be a canonical lowercase UUID");
  }
  return diagnosticRunId;
}

function corruptKeywordLibrary(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The Keyword Library projection failed its provenance checks.",
  );
}

function projectNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Project not found.");
}

function keywordNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Keyword not found.");
}

function keywordSuggestionNotFound(): never {
  throw new ProblemError(
    "NOT_FOUND",
    "Keyword review suggestion not found.",
  );
}

function keywordSuggestionConflict(): never {
  throw new ProblemError(
    "STALE_REVISION",
    "Keyword review suggestion is stale; refetch and retry.",
  );
}

function keywordRevisionConflict(
  projectId: string,
  keywordId: string,
  expectedRevision: number,
  currentRevision: number,
): never {
  const parsed = KeywordGovernanceRevisionConflict.safeParse({
    kind: "revision_conflict",
    resource: "keyword_review",
    projectId,
    resourceId: keywordId,
    expectedRevision,
    currentRevision,
  });
  if (!parsed.success) return corruptKeywordLibrary();
  throw new ProblemError(
    "STALE_REVISION",
    "Keyword review revision is stale; refetch and retry.",
    { current: parsed.data },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function batches<T>(values: readonly T[], size = MAX_LOOKUP_BATCH): T[][] {
  const output: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(values.slice(offset, offset + size));
  }
  return output;
}

function boundedText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Canonical source limitation is unavailable.";
  if (trimmed.length <= 2_000) return trimmed;
  return `${trimmed.slice(0, 1_997)}...`;
}

function joinedLimitation(
  ...parts: readonly (string | null | undefined)[]
): string | null {
  const values = unique(
    parts
      .map((part) => part?.trim() ?? "")
      .filter((part) => part.length > 0),
  );
  return values.length === 0 ? null : boundedText(values.join(" "));
}

function isoInstant(value: string): string {
  try {
    return canonicalUtcTimestamptz(value);
  } catch {
    return corruptKeywordLibrary();
  }
}

function validNow(now: Date): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("now must be a valid Date");
  }
  return now;
}

function exactOptionalTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return corruptKeywordLibrary();
  return isoInstant(value);
}

function flattenFrozenKeywords(
  clusters: PublishedGrowthMapGeneration["governance"]["keywordClusters"],
): readonly FrozenKeywordProjection[] {
  return clusters.flatMap((cluster) =>
    cluster.keywords.map((fact) => ({
      fact,
      topicNodeId: cluster.topicNodeId ?? null,
      topicModelRevision: cluster.topicModelRevision ?? null,
    })),
  );
}

function frozenKeywordIdentity(fact: GovernanceKeywordFactV1): string {
  return `${fact.normalizedKeyword}::${fact.marketCode}::${fact.languageTag}::${fact.queryKind}`;
}

function assertFrozenKeywordMirror(
  entity: KeywordEntityRow,
  fact: GovernanceKeywordFactV1,
  scope: ProjectScope,
): void {
  if (
    entity.workspace_id !== scope.workspaceId ||
    entity.project_id !== scope.projectId ||
    entity.id !== fact.keywordEntityId ||
    entity.display_keyword !== fact.displayKeyword ||
    entity.normalized_keyword !== fact.normalizedKeyword ||
    entity.market !== fact.marketCode ||
    entity.language_tag !== fact.languageTag ||
    entity.query_kind !== fact.queryKind
  ) {
    corruptKeywordLibrary();
  }
  if (entity.mapping_revision < fact.revision) {
    corruptKeywordLibrary();
  }
}

function summaryTimestamp(
  summary: Record<string, unknown>,
  key: string,
): string | null {
  const timing = summary["timing"];
  if (timing === undefined || timing === null) return null;
  if (!isRecord(timing)) return corruptKeywordLibrary();
  return exactOptionalTimestamp(timing[key]);
}

function observationTimestamp(
  observation: CanonicalObservationRow,
): string | null {
  if (!isRecord(observation.value_json)) return corruptKeywordLibrary();
  return exactOptionalTimestamp(observation.value_json["providerDataAsOf"]);
}

function canonicalProviderDataAsOf(
  occurrence: KeywordOccurrenceRow,
  observation: CanonicalObservationRow,
  snapshot: CanonicalSnapshotRow,
): string | null {
  const fromObservation = observationTimestamp(observation);
  const fromSnapshot = summaryTimestamp(snapshot.summary, "dataAsOf");
  if (
    fromObservation !== null &&
    fromSnapshot !== null &&
    !sameTimestamptzInstant(fromObservation, fromSnapshot)
  ) {
    return corruptKeywordLibrary();
  }
  const canonical = fromObservation ?? fromSnapshot;
  if ((canonical === null) !== (occurrence.provider_data_as_of === null)) {
    return corruptKeywordLibrary();
  }
  if (
    canonical !== null &&
    occurrence.provider_data_as_of !== null &&
    !sameTimestamptzInstant(canonical, occurrence.provider_data_as_of)
  ) {
    return corruptKeywordLibrary();
  }
  return canonical;
}

function sourceFreshness(
  provider: string,
  sourceKind: KeywordOccurrenceRow["source_kind"],
  providerDataAsOf: string | null,
  now: Date,
): SourceFreshness {
  if (providerDataAsOf === null) return "unknown";
  if (
    sourceKind === "interview_summary" ||
    sourceKind === "user_review"
  ) {
    const captured = Date.parse(providerDataAsOf);
    if (!Number.isFinite(captured)) return corruptKeywordLibrary();
    const maxAge =
      KEYWORD_EVIDENCE_FRESHNESS_DAYS[sourceKind] *
      24 *
      60 *
      60 *
      1_000;
    return now.getTime() - captured > maxAge ? "stale" : "current";
  }
  return isStale(provider, providerDataAsOf, now.getTime())
    ? "stale"
    : "current";
}

function freshnessLimitation(
  freshness: SourceFreshness,
  providerDataAsOf: string | null,
): string | null {
  if (freshness === "unknown") return UNKNOWN_FRESHNESS_LIMITATION;
  if (freshness === "stale") {
    return `Provider data is stale as of ${providerDataAsOf ?? "an unknown time"}.`;
  }
  return null;
}

function exactKeywordAtPointer(
  valueJson: unknown,
  pointer: string,
): string {
  if (!isRecord(valueJson)) return corruptKeywordLibrary();
  if (pointer === "/valueJson/keyword") {
    const keyword = valueJson["keyword"];
    return typeof keyword === "string" ? keyword : corruptKeywordLibrary();
  }
  const match = GSC_TOP_QUERY_POINTER.exec(pointer);
  if (!match) return corruptKeywordLibrary();
  const index = Number(match[1]);
  const topQueries = valueJson["topQueries"];
  if (!Number.isSafeInteger(index) || !Array.isArray(topQueries)) {
    return corruptKeywordLibrary();
  }
  const row = topQueries[index];
  if (!isRecord(row) || typeof row["query"] !== "string") {
    return corruptKeywordLibrary();
  }
  return row["query"];
}

async function loadActiveProject(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
): Promise<ProjectScope> {
  const project = await new ProjectsRepository(exec).findById(scope, projectId);
  if (
    !project ||
    project.workspace_id !== scope.workspaceId ||
    project.id !== projectId ||
    project.archived_at !== null
  ) {
    return projectNotFound();
  }
  return { workspaceId: scope.workspaceId, projectId };
}

async function loadFrozenEntities(
  exec: Executor,
  scope: ProjectScope,
  frozenKeywords: readonly FrozenKeywordProjection[],
): Promise<Map<string, KeywordEntityRow>> {
  const repository = new KeywordsRepository(exec);
  const ids = unique(frozenKeywords.map(({ fact }) => fact.keywordEntityId));
  const rows: KeywordEntityRow[] = [];
  for (const batch of batches(ids, MAX_KEYWORD_ENTITY_BATCH)) {
    rows.push(...(await repository.listByIds(scope, batch)));
  }
  if (rows.length !== ids.length) {
    return corruptKeywordLibrary();
  }

  const factsById = new Map(
    frozenKeywords.map(({ fact }) => [fact.keywordEntityId, fact] as const),
  );
  const byId = new Map<string, KeywordEntityRow>();
  const seenIdentities = new Set<string>();
  for (const row of rows) {
    const fact = factsById.get(row.id);
    if (!fact || byId.has(row.id)) {
      return corruptKeywordLibrary();
    }
    assertFrozenKeywordMirror(row, fact, scope);
    const identity = frozenKeywordIdentity(fact);
    if (seenIdentities.has(identity)) {
      return corruptKeywordLibrary();
    }
    seenIdentities.add(identity);
    byId.set(row.id, row);
  }
  return byId;
}

async function _loadOccurrenceHistories(
  exec: Executor,
  scope: ProjectScope,
  entities: readonly KeywordEntityRow[],
): Promise<EntityOccurrenceHistory[]> {
  const repository = new KeywordOccurrencesRepository(exec);
  const histories: EntityOccurrenceHistory[] = [];
  for (const entity of entities) {
    const page = await repository.listForEntity(scope, entity.id, {
      limit: MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
      cursor: null,
    });
    if (page.rows.length === 0) return corruptKeywordLibrary();
    histories.push({
      entity,
      rows: page.rows,
      truncated: page.nextCursor !== null,
    });
  }
  return histories;
}

async function loadExactFrozenOccurrenceHistories(
  exec: Executor,
  scope: ProjectScope,
  reads: readonly {
    readonly entity: KeywordEntityRow;
    readonly frozen: FrozenKeywordProjection;
  }[],
): Promise<readonly FrozenEntityOccurrenceHistory[]> {
  const requestedIds = unique(
    reads.flatMap((read) =>
      read.frozen.fact.occurrenceRefs.map((ref) => ref.occurrenceId),
    ),
  );
  if (reads.length === 0) {
    return [];
  }
  if (requestedIds.length === 0) {
    return corruptKeywordLibrary();
  }

  const byId = new Map<string, KeywordOccurrenceRow>();
  for (const batch of batches(requestedIds)) {
    const rows = (await exec
      .select({
        id: keywordOccurrences.id,
        workspace_id: keywordOccurrences.workspace_id,
        project_id: keywordOccurrences.project_id,
        data_snapshot_id: keywordOccurrences.data_snapshot_id,
        normalized_observation_id:
          keywordOccurrences.normalized_observation_id,
        display_keyword: keywordOccurrences.display_keyword,
        normalized_keyword: keywordOccurrences.normalized_keyword,
        market: keywordOccurrences.market,
        language_tag: keywordOccurrences.language_tag,
        query_kind: keywordOccurrences.query_kind,
        source_kind: keywordOccurrences.source_kind,
        scope_basis: keywordOccurrences.scope_basis,
        source_pointer: keywordOccurrences.source_pointer,
        source_ref: keywordOccurrences.source_ref,
        collected_at: keywordOccurrences.collected_at,
        provider_data_as_of: keywordOccurrences.provider_data_as_of,
        created_at: keywordOccurrences.created_at,
      })
      .from(keywordOccurrences)
      .where(
        and(
          projectPredicate(keywordOccurrences, scope),
          inArray(keywordOccurrences.id, batch),
        ),
      )
      .orderBy(asc(keywordOccurrences.id))) as KeywordOccurrenceRow[];
    for (const row of rows) {
      if (byId.has(row.id) || !batch.includes(row.id)) {
        return corruptKeywordLibrary();
      }
      byId.set(row.id, row);
    }
  }
  if (byId.size !== requestedIds.length) {
    return corruptKeywordLibrary();
  }

  return reads.map(({ entity, frozen }) => ({
    entity,
    frozen,
    rows: frozen.fact.occurrenceRefs
      .map((ref) => {
        const row = byId.get(ref.occurrenceId);
        if (
          !row ||
          row.data_snapshot_id !== ref.snapshotId ||
          row.normalized_observation_id !== ref.observationId
        ) {
          return corruptKeywordLibrary();
        }
        validateOccurrenceIdentity(row, entity, scope);
        return row;
      })
      .sort((left, right) =>
        right.created_at < left.created_at
          ? -1
          : right.created_at > left.created_at
            ? 1
            : right.id < left.id
              ? -1
              : right.id > left.id
                ? 1
                : 0,
      ),
    truncated: false,
  }));
}

async function loadCanonicalObservations(
  exec: Executor,
  scope: ProjectScope,
  ids: readonly string[],
): Promise<Map<string, CanonicalObservationRow>> {
  const byId = new Map<string, CanonicalObservationRow>();
  for (const batch of batches(unique(ids))) {
    const rows = (await exec
      .select({
        id: normalizedObservations.id,
        workspace_id: normalizedObservations.workspace_id,
        project_id: normalizedObservations.project_id,
        snapshot_id: normalizedObservations.snapshot_id,
        site_page_id: normalizedObservations.site_page_id,
        provider: normalizedObservations.provider,
        metric_key: normalizedObservations.metric_key,
        subject_type: normalizedObservations.subject_type,
        subject_ref: normalizedObservations.subject_ref,
        observed_at: normalizedObservations.observed_at,
        availability: normalizedObservations.availability,
        value_json: normalizedObservations.value_json,
        unit: normalizedObservations.unit,
        origin: normalizedObservations.origin,
        method: normalizedObservations.method,
        grade: normalizedObservations.grade,
        support: normalizedObservations.support,
        limitation: normalizedObservations.limitation,
      })
      .from(normalizedObservations)
      .where(
        and(
          projectPredicate(normalizedObservations, scope),
          inArray(normalizedObservations.id, batch),
        ),
      )
      .orderBy(asc(normalizedObservations.id))) as CanonicalObservationRow[];
    for (const row of rows) {
      if (
        byId.has(row.id) ||
        row.workspace_id !== scope.workspaceId ||
        row.project_id !== scope.projectId ||
        !batch.includes(row.id)
      ) {
        return corruptKeywordLibrary();
      }
      byId.set(row.id, row);
    }
  }
  if (byId.size !== unique(ids).length) return corruptKeywordLibrary();
  return byId;
}

async function loadCanonicalSnapshots(
  exec: Executor,
  scope: ProjectScope,
  ids: readonly string[],
): Promise<Map<string, CanonicalSnapshotRow>> {
  const byId = new Map<string, CanonicalSnapshotRow>();
  for (const batch of batches(unique(ids))) {
    const rows = (await exec
      .select({
        id: dataSnapshots.id,
        workspace_id: dataSnapshots.workspace_id,
        project_id: dataSnapshots.project_id,
        site_id: dataSnapshots.site_id,
        collection_run_id: dataSnapshots.collection_run_id,
        source_connection_id: dataSnapshots.source_connection_id,
        provider: dataSnapshots.provider,
        dataset_key: dataSnapshots.dataset_key,
        schema_version: dataSnapshots.schema_version,
        method_version: dataSnapshots.method_version,
        captured_at: dataSnapshots.captured_at,
        availability: dataSnapshots.availability,
        limitation: dataSnapshots.limitation,
        summary: dataSnapshots.summary,
      })
      .from(dataSnapshots)
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          inArray(dataSnapshots.id, batch),
        ),
      )
      .orderBy(asc(dataSnapshots.id))) as CanonicalSnapshotRow[];
    for (const row of rows) {
      if (
        byId.has(row.id) ||
        row.workspace_id !== scope.workspaceId ||
        row.project_id !== scope.projectId ||
        !batch.includes(row.id) ||
        !isRecord(row.summary)
      ) {
        return corruptKeywordLibrary();
      }
      byId.set(row.id, row);
    }
  }
  if (byId.size !== unique(ids).length) return corruptKeywordLibrary();
  return byId;
}

async function loadCanonicalCollectionRuns(
  exec: Executor,
  scope: ProjectScope,
  ids: readonly string[],
): Promise<Map<string, CanonicalCollectionRunRow>> {
  const byId = new Map<string, CanonicalCollectionRunRow>();
  for (const batch of batches(unique(ids))) {
    const rows = (await exec
      .select({
        id: collectionRuns.id,
        workspace_id: collectionRuns.workspace_id,
        project_id: collectionRuns.project_id,
        site_id: collectionRuns.site_id,
        source_connection_id: collectionRuns.source_connection_id,
        provider: collectionRuns.provider,
        operation: collectionRuns.operation,
        method_version: collectionRuns.method_version,
        import_preview_id: collectionRuns.import_preview_id,
      })
      .from(collectionRuns)
      .where(
        and(
          projectPredicate(collectionRuns, scope),
          inArray(collectionRuns.id, batch),
        ),
      )
      .orderBy(asc(collectionRuns.id))) as CanonicalCollectionRunRow[];
    for (const row of rows) {
      if (
        byId.has(row.id) ||
        row.workspace_id !== scope.workspaceId ||
        row.project_id !== scope.projectId ||
        !batch.includes(row.id)
      ) {
        return corruptKeywordLibrary();
      }
      byId.set(row.id, row);
    }
  }
  if (byId.size !== unique(ids).length) return corruptKeywordLibrary();
  return byId;
}

function validateSitePage(
  row: SitePageRow,
  scope: ProjectScope,
  expectedId: string,
): void {
  if (
    row.id !== expectedId ||
    row.workspace_id !== scope.workspaceId ||
    row.project_id !== scope.projectId ||
    row.normalized_url_hash !== normalizedUrlHash(row.normalized_url)
  ) {
    corruptKeywordLibrary();
  }
}

async function loadSitePages(
  exec: Executor,
  scope: ProjectScope,
  ids: readonly string[],
): Promise<Map<string, SitePageRow>> {
  const uniqueIds = unique(ids);
  const byId = new Map<string, SitePageRow>();
  const repository = new SitePagesRepository(exec);
  for (const batch of batches(uniqueIds)) {
    const rows = await repository.findByIds(scope, batch);
    for (const row of rows) {
      if (byId.has(row.id) || !batch.includes(row.id)) {
        return corruptKeywordLibrary();
      }
      validateSitePage(row, scope, row.id);
      byId.set(row.id, row);
    }
  }
  if (byId.size !== uniqueIds.length) return corruptKeywordLibrary();
  return byId;
}

async function _loadProjectionRows(
  exec: Executor,
  scope: ProjectScope,
  entities: readonly KeywordEntityRow[],
): Promise<KeywordProjectionRows> {
  const histories = await _loadOccurrenceHistories(exec, scope, entities);
  const occurrences = histories.flatMap((history) => history.rows);
  const observationIds = occurrences.flatMap((row) =>
    row.normalized_observation_id === null
      ? []
      : [row.normalized_observation_id],
  );
  const snapshotIds = occurrences.flatMap((row) =>
    row.data_snapshot_id === null ? [] : [row.data_snapshot_id],
  );
  const observationsById = await loadCanonicalObservations(
    exec,
    scope,
    observationIds,
  );
  const snapshotsById = await loadCanonicalSnapshots(exec, scope, snapshotIds);
  const collectionRunsById = await loadCanonicalCollectionRuns(
    exec,
    scope,
    [...snapshotsById.values()].map((snapshot) => snapshot.collection_run_id),
  );
  const sitePageIds = [
    ...entities.flatMap((entity) =>
      entity.mapped_site_page_id === null ? [] : [entity.mapped_site_page_id],
    ),
    ...[...observationsById.values()].flatMap((observation) =>
      observation.site_page_id === null ? [] : [observation.site_page_id],
    ),
  ];
  const sitePagesById = await loadSitePages(exec, scope, sitePageIds);
  // The live library reports each keyword at its current revision, so the
  // deciding authority is read at that same revision.
  const reviewAuthoritiesByKeywordId = await loadReviewAuthorities(
    exec,
    scope,
    entities.map((entity) => ({
      keywordId: entity.id,
      revision: entity.mapping_revision,
    })),
  );
  return {
    histories,
    observationsById,
    snapshotsById,
    collectionRunsById,
    sitePagesById,
    reviewAuthoritiesByKeywordId,
  };
}

async function loadFrozenProjectionRows(
  exec: Executor,
  scope: ProjectScope,
  reads: readonly {
    readonly entity: KeywordEntityRow;
    readonly frozen: FrozenKeywordProjection;
  }[],
): Promise<
  KeywordProjectionRows & {
    readonly histories: readonly FrozenEntityOccurrenceHistory[];
  }
> {
  const histories = await loadExactFrozenOccurrenceHistories(
    exec,
    scope,
    reads,
  );
  const occurrences = histories.flatMap((history) => history.rows);
  const observationIds = occurrences.flatMap((row) =>
    row.normalized_observation_id === null
      ? []
      : [row.normalized_observation_id],
  );
  const snapshotIds = occurrences.flatMap((row) =>
    row.data_snapshot_id === null ? [] : [row.data_snapshot_id],
  );
  const observationsById = await loadCanonicalObservations(
    exec,
    scope,
    observationIds,
  );
  const snapshotsById = await loadCanonicalSnapshots(exec, scope, snapshotIds);
  const collectionRunsById = await loadCanonicalCollectionRuns(
    exec,
    scope,
    [...snapshotsById.values()].map((snapshot) => snapshot.collection_run_id),
  );
  const sitePageIds = unique([
    ...reads.flatMap(({ frozen }) =>
      frozen.fact.mappedSitePageId === null
        ? []
        : [frozen.fact.mappedSitePageId],
    ),
    ...[...observationsById.values()].flatMap((observation) =>
      observation.site_page_id === null ? [] : [observation.site_page_id],
    ),
  ]);
  const sitePagesById = await loadSitePages(exec, scope, sitePageIds);
  // A published generation reports frozen facts AT the revision it froze, so
  // the deciding authority is read at that exact revision too. Resolving the
  // latest decision instead would attribute a later review to an older
  // generation.
  const reviewAuthoritiesByKeywordId = await loadReviewAuthorities(
    exec,
    scope,
    reads.map(({ frozen }) => ({
      keywordId: frozen.fact.keywordEntityId,
      revision: frozen.fact.revision,
    })),
  );
  return {
    histories,
    observationsById,
    snapshotsById,
    collectionRunsById,
    sitePagesById,
    reviewAuthoritiesByKeywordId,
  };
}

function validateEntity(
  entity: KeywordEntityRow,
  scope: ProjectScope,
): void {
  if (
    entity.workspace_id !== scope.workspaceId ||
    entity.project_id !== scope.projectId ||
    normalizeKeywordIdentity(entity.display_keyword) !== entity.normalized_keyword
  ) {
    corruptKeywordLibrary();
  }
}

function validateOccurrenceIdentity(
  occurrence: KeywordOccurrenceRow,
  entity: KeywordEntityRow,
  scope: ProjectScope,
): void {
  if (
    occurrence.workspace_id !== scope.workspaceId ||
    occurrence.project_id !== scope.projectId ||
    occurrence.normalized_keyword !== entity.normalized_keyword ||
    occurrence.market !== entity.market ||
    occurrence.language_tag !== entity.language_tag ||
    occurrence.query_kind !== entity.query_kind
  ) {
    corruptKeywordLibrary();
  }
}

function verifyObservationSitePage(
  observation: CanonicalObservationRow,
  pages: ReadonlyMap<string, SitePageRow>,
  scope: ProjectScope,
): void {
  if (observation.site_page_id === null) return;
  const page = pages.get(observation.site_page_id);
  if (!page) return corruptKeywordLibrary();
  validateSitePage(page, scope, observation.site_page_id);
  if (observation.subject_type !== "url") return;
  const subject = canonicalizeUrl(observation.subject_ref);
  const normalized = canonicalizeUrl(page.normalized_url);
  if (
    !subject ||
    !normalized ||
    subject.subjectUrl !== normalized.subjectUrl
  ) {
    corruptKeywordLibrary();
  }
}

function providerOccurrenceLineage(
  occurrence: KeywordOccurrenceRow,
  entity: KeywordEntityRow,
  rows: KeywordProjectionRows,
  scope: ProjectScope,
): {
  readonly observation: CanonicalObservationRow;
  readonly snapshot: CanonicalSnapshotRow;
  readonly collectionRun: CanonicalCollectionRunRow;
  readonly providerDataAsOf: string | null;
} {
  if (
    occurrence.data_snapshot_id === null ||
    occurrence.normalized_observation_id === null ||
    occurrence.source_pointer === null ||
    occurrence.source_ref !==
      `observation:${occurrence.normalized_observation_id}#${occurrence.source_pointer}`
  ) {
    return corruptKeywordLibrary();
  }
  const observation = rows.observationsById.get(
    occurrence.normalized_observation_id,
  );
  const snapshot = rows.snapshotsById.get(occurrence.data_snapshot_id);
  const collectionRun = snapshot
    ? rows.collectionRunsById.get(snapshot.collection_run_id)
    : undefined;
  if (
    !observation ||
    !snapshot ||
    !collectionRun ||
    observation.workspace_id !== scope.workspaceId ||
    observation.project_id !== scope.projectId ||
    snapshot.workspace_id !== scope.workspaceId ||
    snapshot.project_id !== scope.projectId ||
    collectionRun.workspace_id !== scope.workspaceId ||
    collectionRun.project_id !== scope.projectId ||
    collectionRun.id !== snapshot.collection_run_id ||
    collectionRun.site_id !== snapshot.site_id ||
    collectionRun.provider !== snapshot.provider ||
    collectionRun.source_connection_id !== snapshot.source_connection_id ||
    observation.snapshot_id !== snapshot.id ||
    snapshot.id !== occurrence.data_snapshot_id ||
    observation.availability !== "available" ||
    !["available", "partial"].includes(snapshot.availability) ||
    !sameTimestamptzInstant(observation.observed_at, snapshot.captured_at) ||
    !sameTimestamptzInstant(observation.observed_at, occurrence.collected_at) ||
    normalizeKeywordIdentity(
      exactKeywordAtPointer(observation.value_json, occurrence.source_pointer),
    ) !== entity.normalized_keyword
  ) {
    return corruptKeywordLibrary();
  }
  verifyObservationSitePage(observation, rows.sitePagesById, scope);
  const providerDataAsOf = canonicalProviderDataAsOf(
    occurrence,
    observation,
    snapshot,
  );
  return { observation, snapshot, collectionRun, providerDataAsOf };
}

type DataForSeoRankedLineageKind =
  | "legacy_ranked"
  | "search_landscape_v1"
  | "search_landscape_v2"
  | "search_landscape_v3";

function exactDataForSeoRankedLineage(
  snapshot: CanonicalSnapshotRow,
  collectionRun: CanonicalCollectionRunRow,
): DataForSeoRankedLineageKind | null {
  if (
    snapshot.provider !== "dataforseo" ||
    collectionRun.provider !== "dataforseo" ||
    collectionRun.import_preview_id !== null
  ) {
    return null;
  }
  if (
    snapshot.dataset_key === DATAFORSEO_DATASET_KEY &&
    snapshot.schema_version === DATAFORSEO_METHOD_VERSION &&
    snapshot.method_version === DATAFORSEO_METHOD_VERSION &&
    collectionRun.operation === "keyword_gap_import" &&
    collectionRun.method_version === DATAFORSEO_METHOD_VERSION
  ) {
    return "legacy_ranked";
  }
  if (
    snapshot.dataset_key ===
      DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY &&
    snapshot.schema_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION &&
    snapshot.method_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION &&
    collectionRun.operation ===
      DATAFORSEO_SEARCH_LANDSCAPE_OPERATION &&
    collectionRun.method_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION
  ) {
    return "search_landscape_v1";
  }
  if (
    snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY &&
    snapshot.schema_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION &&
    snapshot.method_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION &&
    collectionRun.operation === DATAFORSEO_SEARCH_LANDSCAPE_OPERATION &&
    collectionRun.method_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION
  ) {
    return "search_landscape_v2";
  }
  if (
    snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY &&
    snapshot.schema_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION &&
    snapshot.method_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION &&
    collectionRun.operation === DATAFORSEO_SEARCH_LANDSCAPE_OPERATION &&
    collectionRun.method_version ===
      DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION
  ) {
    return "search_landscape_v3";
  }
  return null;
}

function validateDataForSeoSummary(
  snapshot: CanonicalSnapshotRow,
  occurrence: KeywordOccurrenceRow,
  lineageKind: DataForSeoRankedLineageKind,
): string {
  let collectionScope:
    | ReturnType<typeof parseDataForSeoCollectionScope>
    | ReturnType<typeof parseDataForSeoSearchLandscapeScope>
    | ReturnType<typeof parseDataForSeoSearchLandscapeV2Scope>
    | ReturnType<typeof parseDataForSeoSearchLandscapeV3Scope>;
  try {
    collectionScope =
      lineageKind === "legacy_ranked"
        ? parseDataForSeoCollectionScope(
            snapshot.summary["collectionScope"],
          )
        : lineageKind === "search_landscape_v1"
          ? parseDataForSeoSearchLandscapeScope(
              snapshot.summary["collectionScope"],
            )
          : lineageKind === "search_landscape_v2"
            ? parseDataForSeoSearchLandscapeV2Scope(
                snapshot.summary["collectionScope"],
              )
            : parseDataForSeoSearchLandscapeV3Scope(
                snapshot.summary["collectionScope"],
              );
  } catch {
    return corruptKeywordLibrary();
  }
  const timing = snapshot.summary["timing"];
  if (
    !isRecord(timing) ||
    typeof timing["collectedAt"] !== "string" ||
    !sameTimestamptzInstant(timing["collectedAt"], snapshot.captured_at) ||
    timing["dataAsOf"] !== null ||
    timing["observedAt"] !== null ||
    timing["freshness"] !== "unknown" ||
    collectionScope.marketCode !== occurrence.market ||
    collectionScope.languageTag !== occurrence.language_tag
  ) {
    return corruptKeywordLibrary();
  }
  const location =
    collectionScope.location.kind === "code"
      ? `location code ${collectionScope.location.code}`
      : `location ${collectionScope.location.name}`;
  const scopeDetail =
    collectionScope.queryKind === "ranked_keywords"
      ? `capped at ${collectionScope.limit} rows`
      : "serpCompetitors" in collectionScope
        ? `search_landscape ${lineageKind === "search_landscape_v3" ? "v3" : "v2"} capped at ${collectionScope.rankedKeywords.limit} ranked-keyword rows, ${collectionScope.competitorsDomain.limit} competitor-domain rows, and at most ${collectionScope.serpCompetitors.limit} paid fallback rows from ${collectionScope.serpCompetitors.seeds.length} frozen seed(s)`
        : `search_landscape capped at ${collectionScope.rankedKeywords.limit} ranked-keyword rows and ${collectionScope.competitorsDomain.limit} competitor-domain rows`;
  return boundedText(
    `DataForSEO ${snapshot.dataset_key} scope is target ${collectionScope.target}, market ${collectionScope.marketCode}, language ${collectionScope.languageTag}, ${location}, ${scopeDetail}; it is not the complete keyword universe.`,
  );
}

function validateGscContext(
  snapshot: CanonicalSnapshotRow,
  occurrence: KeywordOccurrenceRow,
): string {
  const context = snapshot.summary["keywordLibraryContext"];
  if (
    !isRecord(context) ||
    context["basis"] !== "project_context" ||
    context["marketCode"] !== occurrence.market ||
    context["languageTag"] !== occurrence.language_tag
  ) {
    return corruptKeywordLibrary();
  }
  return boundedText(
    `GSC Search Analytics was not filtered by market or language; market ${occurrence.market} and language ${occurrence.language_tag} come from frozen project context.`,
  );
}

function exactEvidenceLabel(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 200
  ) {
    return corruptKeywordLibrary();
  }
  return value;
}

function exactEvidenceRecordHash(value: unknown): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    return corruptKeywordLibrary();
  }
  return value;
}

function exactReviewPlatform(
  value: unknown,
): UserReviewEvidence["reviewPlatform"] {
  if (
    typeof value !== "string" ||
    !USER_REVIEW_PLATFORMS.includes(
      value as UserReviewEvidence["reviewPlatform"],
    )
  ) {
    return corruptKeywordLibrary();
  }
  return value as UserReviewEvidence["reviewPlatform"];
}

function exactEvidenceHttpsUrl(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length > 2_048
  ) {
    return corruptKeywordLibrary();
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return corruptKeywordLibrary();
    return parsed.toString();
  } catch {
    return corruptKeywordLibrary();
  }
}

function validateKeywordEvidence(
  snapshot: CanonicalSnapshotRow,
  observation: CanonicalObservationRow,
  occurrence: KeywordOccurrenceRow,
): {
  readonly evidence: KeywordEvidence;
  readonly scopeLimitation: string;
} {
  if (!isRecord(observation.value_json)) return corruptKeywordLibrary();
  const scope = snapshot.summary["keywordEvidenceScope"];
  const timing = snapshot.summary["timing"];
  if (
    !isRecord(scope) ||
    !isRecord(timing) ||
    scope["sourceKind"] !== occurrence.source_kind ||
    scope["marketCode"] !== occurrence.market ||
    scope["languageTag"] !== occurrence.language_tag ||
    observation.value_json["marketCode"] !== occurrence.market ||
    observation.value_json["languageCode"] !== occurrence.language_tag ||
    typeof timing["collectedAt"] !== "string" ||
    !sameTimestamptzInstant(timing["collectedAt"], snapshot.captured_at)
  ) {
    return corruptKeywordLibrary();
  }

  const evidenceLabel = exactEvidenceLabel(
    observation.value_json["evidenceLabel"],
  );
  const sourceRecordHash = exactEvidenceRecordHash(
    observation.value_json["sourceRecordHash"],
  );
  if (occurrence.source_kind === "interview_summary") {
    if (
      scope["basis"] !== "customer_research" ||
      scope["reviewPlatform"] !== undefined ||
      observation.value_json["reviewPlatform"] !== undefined ||
      observation.value_json["sourceUrl"] !== undefined
    ) {
      return corruptKeywordLibrary();
    }
    return {
      evidence: {
        kind: "interview_summary",
        evidenceLabel,
        sourceRecordHash,
      },
      scopeLimitation: boundedText(
        `Interview-summary Keywords come from the frozen, customer-approved and de-identified research scope for market ${occurrence.market} and language ${occurrence.language_tag}; verbatim transcripts and participant identities are not projected into the Keyword Library.`,
      ),
    };
  }

  if (occurrence.source_kind !== "user_review") {
    return corruptKeywordLibrary();
  }
  const reviewPlatform = exactReviewPlatform(
    observation.value_json["reviewPlatform"],
  );
  if (
    scope["basis"] !== "public_review_platform" ||
    scope["reviewPlatform"] !== reviewPlatform
  ) {
    return corruptKeywordLibrary();
  }
  return {
    evidence: {
      kind: "user_review",
      evidenceLabel,
      sourceRecordHash,
      reviewPlatform,
      sourceUrl: exactEvidenceHttpsUrl(
        observation.value_json["sourceUrl"] ?? null,
      ),
    },
    scopeLimitation: boundedText(
      `User-review Keywords come from a bounded ${reviewPlatform} public-review collection for market ${occurrence.market} and language ${occurrence.language_tag}; this is not the platform's complete review corpus, and review bodies or author identities are not projected into the Keyword Library.`,
    ),
  };
}

function projectManualOccurrence(
  occurrence: KeywordOccurrenceRow,
): ProjectedOccurrence {
  if (
    occurrence.scope_basis !== "manual" ||
    occurrence.data_snapshot_id !== null ||
    occurrence.normalized_observation_id !== null ||
    occurrence.source_pointer !== null ||
    occurrence.provider_data_as_of !== null ||
    occurrence.source_ref !== `manual:${occurrence.id}`
  ) {
    return corruptKeywordLibrary();
  }
  return {
    row: occurrence,
    observation: null,
    snapshot: null,
    dto: {
      occurrenceId: occurrence.id,
      sourceKind: "manual",
      snapshotId: null,
      sourceObservationId: null,
      sourcePointer: null,
      collectedAt: isoInstant(occurrence.collected_at),
      providerDataAsOf: null,
      freshness: "unknown",
      limitation: MANUAL_FRESHNESS_LIMITATION,
      scopeBasis: "manual",
      scopeLimitation:
        "Manual scope reflects operator-supplied market and language, not provider collection scope.",
      marketCode: occurrence.market,
      languageTag: occurrence.language_tag,
    },
  };
}

function projectProductProfileOccurrence(
  occurrence: KeywordOccurrenceRow,
): ProjectedOccurrence {
  const match = PRODUCT_PROFILE_SOURCE_REF.exec(occurrence.source_ref);
  const productProfileId = occurrence.product_profile_id;
  if (
    occurrence.scope_basis !== "project_context" ||
    productProfileId === null ||
    !UUID.test(productProfileId) ||
    occurrence.data_snapshot_id !== null ||
    occurrence.normalized_observation_id !== null ||
    occurrence.source_pointer !== null ||
    occurrence.provider_data_as_of !== null ||
    !match ||
    match[1] !== productProfileId
  ) {
    return corruptKeywordLibrary();
  }
  return {
    row: occurrence,
    observation: null,
    snapshot: null,
    dto: {
      occurrenceId: occurrence.id,
      sourceKind: "product_profile",
      productProfileId,
      snapshotId: null,
      sourceObservationId: null,
      sourcePointer: null,
      collectedAt: isoInstant(occurrence.collected_at),
      providerDataAsOf: null,
      freshness: "unknown",
      limitation: PRODUCT_PROFILE_FRESHNESS_LIMITATION,
      scopeBasis: "project_context",
      scopeLimitation:
        "Product Profile scope reflects the confirmed profile and the primary Site market/language, not provider collection scope.",
      marketCode: occurrence.market,
      languageTag: occurrence.language_tag,
    },
  };
}

function projectProviderOccurrence(
  occurrence: KeywordOccurrenceRow,
  entity: KeywordEntityRow,
  rows: KeywordProjectionRows,
  scope: ProjectScope,
  now: Date,
): ProjectedOccurrence {
  const lineage = providerOccurrenceLineage(
    occurrence,
    entity,
    rows,
    scope,
  );
  const { collectionRun, observation, snapshot } = lineage;
  let scopeLimitation: string | null;
  let importPreviewId: string | null = null;
  let keywordEvidence: KeywordEvidence | null = null;

  switch (occurrence.source_kind) {
    case "csv_import": {
      if (
        occurrence.scope_basis !== "user_provided" ||
        occurrence.source_pointer !== "/valueJson/keyword" ||
        snapshot.provider !== "csv" ||
        snapshot.dataset_key !== "csv.keyword_gap.v1" ||
        observation.provider !== "csv" ||
        observation.metric_key !== "csv.keyword_gap.v1" ||
        observation.subject_type !== "keyword_cluster" ||
        observation.site_page_id !== null ||
        observation.origin !== "user_provided" ||
        observation.method !== "observed" ||
        observation.grade !== "C" ||
        collectionRun.provider !== "csv" ||
        collectionRun.operation !== "keyword_gap_import" ||
        collectionRun.method_version !== "csv.keyword_gap.v1"
      ) {
        return corruptKeywordLibrary();
      }
      const frozenImportPreviewId = collectionRun.import_preview_id;
      if (
        typeof frozenImportPreviewId !== "string" ||
        !UUID.test(frozenImportPreviewId)
      ) {
        return corruptKeywordLibrary();
      }
      importPreviewId = frozenImportPreviewId;
      scopeLimitation =
        "Market and language reflect the customer-provided CSV row and its frozen import fallbacks.";
      break;
    }
    case "dataforseo_ranked": {
      const lineageKind = exactDataForSeoRankedLineage(
        snapshot,
        collectionRun,
      );
      if (
        occurrence.scope_basis !== "provider_collection_scope" ||
        occurrence.source_pointer !== "/valueJson/keyword" ||
        lineageKind === null ||
        observation.provider !== "dataforseo" ||
        observation.metric_key !== "csv.keyword_gap.v1" ||
        observation.subject_type !== "keyword_cluster" ||
        observation.site_page_id !== null ||
        observation.origin !== "vendor_observation" ||
        observation.method !== "observed" ||
        observation.grade !== "B" ||
        lineage.providerDataAsOf !== null
      ) {
        return corruptKeywordLibrary();
      }
      scopeLimitation = validateDataForSeoSummary(
        snapshot,
        occurrence,
        lineageKind,
      );
      break;
    }
    case "gsc_top_query": {
      if (
        occurrence.scope_basis !== "project_context" ||
        !GSC_TOP_QUERY_POINTER.test(occurrence.source_pointer ?? "") ||
        snapshot.provider !== "gsc" ||
        snapshot.dataset_key !== "gsc.page_query_daily.v1" ||
        observation.provider !== "gsc" ||
        observation.metric_key !== "gsc.page.v1" ||
        observation.subject_type !== "url" ||
        observation.origin !== "first_party" ||
        observation.method !== "observed" ||
        observation.grade !== "A" ||
        collectionRun.provider !== "gsc" ||
        collectionRun.operation !== "search_analytics" ||
        collectionRun.method_version !== "gsc.page_query_daily.v1" ||
        collectionRun.import_preview_id !== null
      ) {
        return corruptKeywordLibrary();
      }
      scopeLimitation = validateGscContext(snapshot, occurrence);
      break;
    }
    case "interview_summary":
    case "user_review": {
      const isInterview = occurrence.source_kind === "interview_summary";
      const expectedDataset = isInterview
        ? "voc.interview_summary.v1"
        : "voc.user_review.v1";
      const expectedOrigin = isInterview
        ? "user_provided"
        : "direct_public";
      const expectedGrade = isInterview ? "C" : "B";
      const expectedScope = isInterview
        ? "user_provided"
        : "provider_collection_scope";
      if (
        occurrence.scope_basis !== expectedScope ||
        occurrence.source_pointer !== "/valueJson/keyword" ||
        snapshot.provider !== "voc" ||
        snapshot.dataset_key !== expectedDataset ||
        snapshot.source_connection_id !== null ||
        observation.provider !== "voc" ||
        observation.metric_key !== "voc.keyword_evidence.v1" ||
        observation.subject_type !== "keyword_cluster" ||
        observation.site_page_id !== null ||
        observation.origin !== expectedOrigin ||
        observation.method !== "observed" ||
        observation.grade !== expectedGrade ||
        collectionRun.provider !== "voc" ||
        collectionRun.operation !== "keyword_evidence_collection" ||
        collectionRun.method_version !== expectedDataset ||
        collectionRun.source_connection_id !== null ||
        collectionRun.import_preview_id !== null
      ) {
        return corruptKeywordLibrary();
      }
      const projected = validateKeywordEvidence(
        snapshot,
        observation,
        occurrence,
      );
      keywordEvidence = projected.evidence;
      scopeLimitation = projected.scopeLimitation;
      break;
    }
    case "manual":
      return corruptKeywordLibrary();
    default:
      return corruptKeywordLibrary();
  }

  const freshness = sourceFreshness(
    snapshot.provider,
    occurrence.source_kind,
    lineage.providerDataAsOf,
    now,
  );
  const limitation = joinedLimitation(
    observation.limitation,
    snapshot.limitation,
    snapshot.availability === "partial"
      ? "The immutable source Snapshot has partial coverage."
      : null,
    freshnessLimitation(freshness, lineage.providerDataAsOf),
  );
  const common = {
    occurrenceId: occurrence.id,
    snapshotId: snapshot.id,
    sourceObservationId: observation.id,
    sourcePointer: occurrence.source_pointer,
    collectedAt: isoInstant(occurrence.collected_at),
    providerDataAsOf: lineage.providerDataAsOf,
    freshness,
    limitation,
    scopeBasis: occurrence.scope_basis,
    scopeLimitation,
    marketCode: occurrence.market,
    languageTag: occurrence.language_tag,
  } as const;

  const dto: GrowthMapKeywordSourceOccurrence =
    occurrence.source_kind === "csv_import"
      ? {
          ...common,
          sourceKind: "csv_import",
          sourcePointer: "/valueJson/keyword",
          scopeBasis: "user_provided",
          importPreviewId: importPreviewId ?? corruptKeywordLibrary(),
        }
      : occurrence.source_kind === "dataforseo_ranked"
        ? {
            ...common,
            sourceKind: "dataforseo_ranked",
            sourcePointer: "/valueJson/keyword",
            providerDataAsOf: null,
            freshness: "unknown",
            scopeBasis: "provider_collection_scope",
          }
        : occurrence.source_kind === "gsc_top_query"
          ? {
            ...common,
            sourceKind: "gsc_top_query",
            sourcePointer:
              occurrence.source_pointer ?? corruptKeywordLibrary(),
            scopeBasis: "project_context",
            scopeLimitation: scopeLimitation ?? corruptKeywordLibrary(),
          }
          : occurrence.source_kind === "interview_summary"
            ? {
                ...common,
                sourceKind: "interview_summary",
                collectionRunId: collectionRun.id,
                sourcePointer: "/valueJson/keyword",
                scopeBasis: "user_provided",
                scopeLimitation:
                  scopeLimitation ?? corruptKeywordLibrary(),
                evidenceLabel:
                  keywordEvidence?.kind === "interview_summary"
                    ? keywordEvidence.evidenceLabel
                    : corruptKeywordLibrary(),
                sourceRecordHash:
                  keywordEvidence?.kind === "interview_summary"
                    ? keywordEvidence.sourceRecordHash
                    : corruptKeywordLibrary(),
              }
            : occurrence.source_kind === "user_review"
              ? {
                  ...common,
                  sourceKind: "user_review",
                  collectionRunId: collectionRun.id,
                  sourcePointer: "/valueJson/keyword",
                  scopeBasis: "provider_collection_scope",
                  scopeLimitation:
                    scopeLimitation ?? corruptKeywordLibrary(),
                  evidenceLabel:
                    keywordEvidence?.kind === "user_review"
                      ? keywordEvidence.evidenceLabel
                      : corruptKeywordLibrary(),
                  sourceRecordHash:
                    keywordEvidence?.kind === "user_review"
                      ? keywordEvidence.sourceRecordHash
                      : corruptKeywordLibrary(),
                  reviewPlatform:
                    keywordEvidence?.kind === "user_review"
                      ? keywordEvidence.reviewPlatform
                      : corruptKeywordLibrary(),
                  sourceUrl:
                    keywordEvidence?.kind === "user_review"
                      ? keywordEvidence.sourceUrl
                      : corruptKeywordLibrary(),
                }
              : corruptKeywordLibrary();
  return { row: occurrence, observation, snapshot, dto };
}

function projectOccurrence(
  occurrence: KeywordOccurrenceRow,
  entity: KeywordEntityRow,
  rows: KeywordProjectionRows,
  scope: ProjectScope,
  now: Date,
): ProjectedOccurrence {
  validateOccurrenceIdentity(occurrence, entity, scope);
  return occurrence.source_kind === "manual"
    ? projectManualOccurrence(occurrence)
    : occurrence.source_kind === "product_profile"
      ? projectProductProfileOccurrence(occurrence)
      : projectProviderOccurrence(occurrence, entity, rows, scope, now);
}

function mappingReviewState(
  value: KeywordEntityRow["mapping_review_state"],
): "unreviewed" | "approved" {
  if (value === "unreviewed") return "unreviewed";
  if (value === "confirmed") return "approved";
  return corruptKeywordLibrary();
}

function assertGovernanceMirror(
  entity: KeywordEntityRow,
  governance: CurrentKeywordGovernance,
  scope: ProjectScope,
): void {
  const current = governance.projection;
  const reviewed = governance.reviewedProjection;
  const decision = governance.decision;
  if (
    entity.workspace_id !== scope.workspaceId ||
    entity.project_id !== scope.projectId ||
    entity.id !== current.keywordId ||
    current.projectId !== scope.projectId ||
    current.currentDecisionId !== decision.decisionId ||
    current.governanceRevision !== decision.governanceRevision ||
    current.mappingRevision !== current.governanceRevision ||
    entity.mapping_revision !== current.governanceRevision ||
    entity.status !== current.status ||
    entity.intent !== current.intent ||
    entity.buyer_stage !== current.buyerStage ||
    entity.cluster_key !== governance.clusterKey ||
    entity.mapping_decision !== current.mappingDecision ||
    entity.mapped_site_page_id !== current.mappedSitePageId ||
    entity.mapping_review_state !== current.mappingReviewState ||
    !sameTimestamptzInstant(entity.updated_at, current.updatedAt) ||
    reviewed.projectId !== current.projectId ||
    reviewed.keywordId !== current.keywordId ||
    reviewed.governanceRevision !== current.governanceRevision ||
    reviewed.status !== current.status ||
    reviewed.intent !== current.intent ||
    reviewed.buyerStage !== current.buyerStage ||
    reviewed.topicNodeId !== current.topicNodeId ||
    reviewed.topicModelRevision !== current.topicModelRevision ||
    reviewed.clusterKey !== governance.clusterKey ||
    reviewed.mappingDecision !== current.mappingDecision ||
    reviewed.mappedSitePageId !== current.mappedSitePageId ||
    reviewed.mappingReviewState !== current.mappingReviewState ||
    reviewed.assignmentInvalidatedBy !==
      current.assignmentInvalidatedBy
  ) {
    return corruptKeywordLibrary();
  }
}

function mappedTarget(
  entity: KeywordEntityRow,
  rows: KeywordProjectionRows,
  scope: ProjectScope,
  governance?: CurrentKeywordGovernance,
): GrowthMapKeywordMappedTarget {
  const current = governance?.projection;
  const mappingDecision =
    current === undefined
      ? entity.mapping_decision
      : current.mappingDecision;
  const mappedSitePageId =
    current === undefined
      ? entity.mapped_site_page_id
      : current.mappedSitePageId;
  const targetGovernance = {
    reviewState: mappingReviewState(
      current === undefined
        ? entity.mapping_review_state
        : current.mappingReviewState,
    ),
    revision:
      current === undefined
        ? entity.mapping_revision
        : current.governanceRevision,
    reason: current?.reason ?? null,
  } as const;
  switch (mappingDecision) {
    case "unassigned":
      if (mappedSitePageId !== null) return corruptKeywordLibrary();
      return { ...targetGovernance, kind: "unassigned" };
    case "new_asset":
      if (mappedSitePageId !== null) return corruptKeywordLibrary();
      return { ...targetGovernance, kind: "new_asset" };
    case "existing_page": {
      if (mappedSitePageId === null) return corruptKeywordLibrary();
      const page = rows.sitePagesById.get(mappedSitePageId);
      if (!page) return corruptKeywordLibrary();
      validateSitePage(page, scope, mappedSitePageId);
      return {
        ...targetGovernance,
        kind: "existing_page",
        sitePageId: page.id,
        normalizedUrl: page.normalized_url,
      };
    }
    default:
      return corruptKeywordLibrary();
  }
}

function metricSource(
  projected: readonly ProjectedOccurrence[],
  pointer: (typeof METRIC_POINTERS)[MetricField],
): ProjectedOccurrence | null {
  const key = pointer.slice("/valueJson/".length);
  return (
    projected.find(
      (source) =>
        source.observation !== null &&
        (source.row.source_kind === "csv_import" ||
          source.row.source_kind === "dataforseo_ranked") &&
        isRecord(source.observation.value_json) &&
        Object.prototype.hasOwnProperty.call(source.observation.value_json, key),
    ) ?? null
  );
}

function metricProjectionLimitation(
  source: ProjectedOccurrence,
  pointer: string,
  value: unknown,
): string | null {
  return joinedLimitation(
    value === null
      ? `The canonical ${pointer} value is explicitly null.`
      : null,
    source.dto.freshness === "current" ? null : source.dto.limitation,
  );
}

function numericMetric(
  field: "volume" | "kd" | "currentRank" | "competitorRank",
  projected: readonly ProjectedOccurrence[],
): GrowthMapKeywordNumericMetric | null {
  const pointer = METRIC_POINTERS[field];
  const source = metricSource(projected, pointer);
  if (!source || !source.observation || !source.snapshot) return null;
  const valueJson = source.observation.value_json;
  if (!isRecord(valueJson)) return corruptKeywordLibrary();
  const key = pointer.slice("/valueJson/".length);
  const raw = valueJson[key];
  if (raw !== null && (typeof raw !== "number" || !Number.isFinite(raw))) {
    return corruptKeywordLibrary();
  }
  return {
    snapshotId: source.snapshot.id,
    observationId: source.observation.id,
    valuePointer: pointer,
    value: raw,
    observedAt: isoInstant(source.observation.observed_at),
    freshness: source.dto.freshness,
    limitation: metricProjectionLimitation(source, pointer, raw),
  };
}

function textMetric(
  field: "currentUrl" | "competitorDomain",
  projected: readonly ProjectedOccurrence[],
): GrowthMapKeywordTextMetric | null {
  const pointer = METRIC_POINTERS[field];
  const source = metricSource(projected, pointer);
  if (!source || !source.observation || !source.snapshot) return null;
  const valueJson = source.observation.value_json;
  if (!isRecord(valueJson)) return corruptKeywordLibrary();
  const key = pointer.slice("/valueJson/".length);
  const raw = valueJson[key];
  if (raw !== null && typeof raw !== "string") return corruptKeywordLibrary();
  return {
    snapshotId: source.snapshot.id,
    observationId: source.observation.id,
    valuePointer: pointer,
    value: raw,
    observedAt: isoInstant(source.observation.observed_at),
    freshness: source.dto.freshness,
    limitation: metricProjectionLimitation(source, pointer, raw),
  };
}

function projectMetrics(
  projected: readonly ProjectedOccurrence[],
): GrowthMapKeywordMetrics {
  const metrics = {
    volume: numericMetric("volume", projected),
    kd: numericMetric("kd", projected),
    currentRank: numericMetric("currentRank", projected),
    currentUrl: textMetric("currentUrl", projected),
    competitorDomain: textMetric("competitorDomain", projected),
    competitorRank: numericMetric("competitorRank", projected),
  };
  return {
    ...metrics,
    limitations: {
      volume: metrics.volume === null ? MISSING_METRIC_LIMITATIONS.volume : null,
      kd: metrics.kd === null ? MISSING_METRIC_LIMITATIONS.kd : null,
      currentRank:
        metrics.currentRank === null
          ? MISSING_METRIC_LIMITATIONS.currentRank
          : null,
      currentUrl:
        metrics.currentUrl === null
          ? MISSING_METRIC_LIMITATIONS.currentUrl
          : null,
      competitorDomain:
        metrics.competitorDomain === null
          ? MISSING_METRIC_LIMITATIONS.competitorDomain
          : null,
      competitorRank:
        metrics.competitorRank === null
          ? MISSING_METRIC_LIMITATIONS.competitorRank
          : null,
    },
  };
}

function projectRecollection(
  projected: readonly ProjectedOccurrence[],
  historyTruncated: boolean,
): GrowthMapKeywordLibraryItem["recollection"] {
  if (historyTruncated) return null;
  const dataForSeoSources = projected.filter(
    (source) => source.row.source_kind === "dataforseo_ranked",
  );
  if (dataForSeoSources.length === 0) return null;

  const hasExactKey = (key: "keywordDifficulty" | "providerSearchIntent") =>
    dataForSeoSources.some((source) => {
      if (!source.observation || !isRecord(source.observation.value_json)) {
        return corruptKeywordLibrary();
      }
      return Object.prototype.hasOwnProperty.call(
        source.observation.value_json,
        key,
      );
    });
  const fields: Array<
    "keyword_difficulty" | "provider_search_intent"
  > = [];
  if (!hasExactKey("keywordDifficulty")) {
    fields.push("keyword_difficulty");
  }
  if (!hasExactKey("providerSearchIntent")) {
    fields.push("provider_search_intent");
  }
  return fields.length === 0
    ? null
    : {
        reason: "historical_dataforseo_observation_missing_fields",
        fields,
      };
}

type ProviderSearchIntent = (typeof PROVIDER_SEARCH_INTENTS)[number];

interface ProviderSearchIntentCandidate {
  readonly source: ProjectedOccurrence;
  readonly value: ProviderSearchIntent | null;
}

function providerSearchIntentCandidate(
  projected: readonly ProjectedOccurrence[],
): ProviderSearchIntentCandidate | null {
  let candidate: ProviderSearchIntentCandidate | null = null;
  for (const source of projected) {
    if (source.row.source_kind !== "dataforseo_ranked") continue;
    if (!source.observation || !source.snapshot) {
      return corruptKeywordLibrary();
    }
    const valueJson = source.observation.value_json;
    if (!isRecord(valueJson)) return corruptKeywordLibrary();
    if (
      !Object.prototype.hasOwnProperty.call(
        valueJson,
        "providerSearchIntent",
      )
    ) {
      continue;
    }
    const raw = valueJson["providerSearchIntent"];
    if (
      raw !== null &&
      (typeof raw !== "string" ||
        !PROVIDER_SEARCH_INTENTS.includes(raw as ProviderSearchIntent))
    ) {
      return corruptKeywordLibrary();
    }
    if (candidate === null) {
      candidate = {
        source,
        value: raw as ProviderSearchIntent | null,
      };
    }
  }
  return candidate;
}

function projectSearchIntent(
  projected: readonly ProjectedOccurrence[],
  governedIntent: string | null,
  reviewAuthority: KeywordDecisionOriginRow | null,
): GrowthMapKeywordLibraryItem["searchIntent"] {
  // Validate every persisted provider-bearing row before applying authority
  // precedence. Otherwise a user decision could mask corrupted immutable
  // provider evidence that still ships with this projection.
  const provider = providerSearchIntentCandidate(projected);
  const reviewOrigin = reviewAuthority?.decisionOrigin ?? null;
  if (reviewOrigin === "user" && governedIntent !== null) {
    return {
      value: governedIntent,
      authority: "user_confirmed",
      snapshotId: null,
      observationId: null,
      analysisInvocationId: null,
      observedAt: null,
      limitation: null,
    };
  }
  if (provider?.value !== null && provider?.value !== undefined) {
    const { source, value } = provider;
    if (!source.observation || !source.snapshot) {
      return corruptKeywordLibrary();
    }
    return {
      value,
      authority: "provider_observed",
      snapshotId: source.snapshot.id,
      observationId: source.observation.id,
      analysisInvocationId: null,
      observedAt: isoInstant(source.observation.observed_at),
      limitation:
        source.dto.freshness === "current"
          ? null
          : source.dto.limitation ?? corruptKeywordLibrary(),
    };
  }
  if (
    reviewAuthority !== null &&
    reviewAuthority.analysisInvocationId !== null
  ) {
    if (
      reviewOrigin !== "system_suggestion" ||
      governedIntent === null ||
      !PROVIDER_SEARCH_INTENTS.includes(
        governedIntent as ProviderSearchIntent,
      )
    ) {
      return corruptKeywordLibrary();
    }
    return {
      value: governedIntent as ProviderSearchIntent,
      authority: "llm_generated",
      snapshotId: null,
      observationId: null,
      analysisInvocationId: reviewAuthority.analysisInvocationId,
      observedAt: null,
      limitation: null,
    };
  }
  if (governedIntent !== null) {
    return {
      value: governedIntent,
      authority: "governed_legacy",
      snapshotId: null,
      observationId: null,
      analysisInvocationId: null,
      observedAt: null,
      limitation: LEGACY_SEARCH_INTENT_LIMITATION,
    };
  }
  return {
    value: null,
    authority: "unavailable",
    snapshotId: null,
    observationId: null,
    analysisInvocationId: null,
    observedAt: null,
    limitation: UNAVAILABLE_SEARCH_INTENT_LIMITATION,
  };
}

function classificationLimitations(
  entity: KeywordEntityRow,
  governance?: CurrentKeywordGovernance,
  frozen?: FrozenKeywordProjection,
) {
  const intent =
    frozen !== undefined
      ? frozen.fact.intent
      : governance?.projection.intent ?? entity.intent;
  const buyerStage =
    frozen !== undefined
      ? frozen.fact.buyerStage
      : governance?.projection.buyerStage ?? entity.buyer_stage;
  const topicNodeId =
    frozen !== undefined
      ? frozen.topicNodeId
      : governance?.projection.topicNodeId ?? null;
  const clusterKey =
    frozen !== undefined
      ? frozen.fact.clusterKey
      : governance?.clusterKey ?? entity.cluster_key;
  return {
    intent: intent === null ? CLASSIFICATION_LIMITATIONS.intent : null,
    buyerStage:
      buyerStage === null
        ? CLASSIFICATION_LIMITATIONS.buyerStage
        : null,
    cluster:
      topicNodeId !== null
        ? null
        : clusterKey === null
        ? CLASSIFICATION_LIMITATIONS.cluster
        : CLASSIFICATION_LIMITATIONS.clusterWithoutId,
  };
}

function itemCoverage(input: {
  readonly classifications: ReturnType<typeof classificationLimitations>;
  readonly searchIntent: GrowthMapKeywordLibraryItem["searchIntent"];
  readonly metrics: GrowthMapKeywordMetrics;
  readonly occurrences: readonly ProjectedOccurrence[];
  readonly truncated: boolean;
  readonly newerLiveRevision: boolean;
}): GrowthMapCoverage {
  const limitations = unique(
    [
      ...Object.values(input.classifications),
      input.searchIntent.limitation,
      ...Object.values(input.metrics.limitations),
      ...[
        input.metrics.volume,
        input.metrics.kd,
        input.metrics.currentRank,
        input.metrics.currentUrl,
        input.metrics.competitorDomain,
        input.metrics.competitorRank,
      ].map((metric) => metric?.limitation ?? null),
      ...input.occurrences.map((occurrence) =>
        occurrence.dto.freshness === "current"
          ? null
          : occurrence.dto.limitation,
      ),
      input.truncated ? OCCURRENCE_HISTORY_LIMITATION : null,
      input.newerLiveRevision ? NEWER_LIVE_REVIEW_LIMITATION : null,
    ].filter((value): value is string => value !== null),
  ).slice(0, 100);
  return limitations.length === 0
    ? { availability: "available", limitations: [] }
    : { availability: "partial", limitations };
}

function projectItem(
  history: EntityOccurrenceHistory,
  rows: KeywordProjectionRows,
  scope: ProjectScope,
  now: Date,
  options?: {
    readonly governance?: CurrentKeywordGovernance;
    readonly frozen?: FrozenKeywordProjection;
  },
): GrowthMapKeywordLibraryItem {
  const { entity } = history;
  validateEntity(entity, scope);
  const governance = options?.governance;
  const frozen = options?.frozen;
  const frozenFact = frozen?.fact;
  if (governance !== undefined && frozenFact === undefined) {
    assertGovernanceMirror(entity, governance, scope);
  }
  if (frozenFact !== undefined && frozenFact.metricRefs.length > 0) {
    return corruptKeywordLibrary();
  }
  const projected = history.rows.map((occurrence) =>
    projectOccurrence(occurrence, entity, rows, scope, now),
  );
  const classifications = classificationLimitations(
    entity,
    governance,
    frozen,
  );
  const metrics = projectMetrics(projected);
  const recollection = projectRecollection(projected, history.truncated);
  const current = governance?.projection;
  const topicNodeId =
    frozen !== undefined ? frozen.topicNodeId : current?.topicNodeId ?? null;
  const topicModelRevision =
    frozen !== undefined
      ? frozen.topicModelRevision
      : current?.topicModelRevision ?? null;
  const clusterKey =
    frozen !== undefined
      ? frozenFact?.clusterKey ?? null
      : governance?.clusterKey ?? null;
  if (
    (topicNodeId === null) !== (topicModelRevision === null) ||
    (topicNodeId !== null && clusterKey === null)
  ) {
    return corruptKeywordLibrary();
  }
  const status =
    frozen !== undefined ? frozenFact!.status : current?.status ?? entity.status;
  // The live governance authority is definitive when the caller loaded it;
  // otherwise the page read supplies the same fact for the exact revision.
  const reviewAuthority =
    rows.reviewAuthoritiesByKeywordId.get(entity.id) ?? null;
  if (
    governance !== undefined &&
    (reviewAuthority === null ||
      reviewAuthority.decisionOrigin !== governance.decision.decisionOrigin)
  ) {
    return corruptKeywordLibrary();
  }
  const reviewOrigin = reviewAuthority?.decisionOrigin ?? null;
  const revision =
    frozen !== undefined
      ? frozenFact!.revision
      : current?.governanceRevision ?? entity.mapping_revision;
  const intent =
    frozen !== undefined ? frozenFact!.intent : current?.intent ?? entity.intent;
  const buyerStage =
    frozen !== undefined
      ? frozenFact!.buyerStage
      : current?.buyerStage ?? entity.buyer_stage;
  const searchIntent = projectSearchIntent(
    projected,
    intent,
    reviewAuthority,
  );
  const mappedEntity =
    frozenFact === undefined
      ? entity
      : {
          ...entity,
          mapping_decision: frozenFact.mappingDecision,
          mapped_site_page_id: frozenFact.mappedSitePageId,
          mapping_review_state: (
            frozenFact.mappingReviewState === "confirmed"
              ? "confirmed"
              : "unreviewed"
          ) as KeywordEntityRow["mapping_review_state"],
          mapping_revision: frozenFact.revision,
        };
  return {
    projectId: scope.projectId,
    keywordId: entity.id,
    displayKeyword: entity.display_keyword,
    normalizedKeyword: entity.normalized_keyword,
    marketCode: entity.market,
    languageTag: entity.language_tag,
    queryKind: entity.query_kind,
    status,
    reviewOrigin,
    revision,
    intent,
    searchIntent,
    buyerStage,
    cluster:
      topicNodeId === null ||
      topicModelRevision === null ||
      clusterKey === null
        ? null
        : { clusterId: topicNodeId, topicModelRevision, name: clusterKey },
    classificationLimitations: classifications,
    mappedTarget: mappedTarget(mappedEntity, rows, scope, governance),
    sourceOccurrences: projected.map((occurrence) => occurrence.dto),
    metrics,
    recollection,
    coverage: itemCoverage({
      classifications,
      searchIntent,
      metrics,
      occurrences: projected,
      truncated: history.truncated,
      newerLiveRevision:
        frozenFact !== undefined && entity.mapping_revision > frozenFact.revision,
    }),
  };
}

function pageCoverage(
  items: readonly GrowthMapKeywordLibraryItem[],
): GrowthMapCoverage {
  if (items.length === 0) {
    return { availability: "unavailable", limitations: [NO_KEYWORDS] };
  }
  const limitations = unique(
    items.flatMap((item) => item.coverage.limitations),
  ).slice(0, 100);
  return limitations.length === 0
    ? { availability: "available", limitations: [] }
    : { availability: "partial", limitations };
}

async function listInSnapshot(
  exec: Executor,
  workspaceScope: WorkspaceScope,
  projectId: string,
  options: GrowthMapKeywordListOptions,
): Promise<ReturnType<typeof GrowthMapKeywordLibraryResponse.parse>> {
  const scope = await loadActiveProject(exec, workspaceScope, projectId);
  const pinnedDiagnosticRunId = normalizePinnedDiagnosticRunId(
    options.diagnosticRunId,
  );
  const generation = await loadPublishedGrowthMapGeneration(
    exec,
    scope,
    pinnedDiagnosticRunId,
  );
  if (
    pinnedDiagnosticRunId !== null &&
    generation.run.id !== pinnedDiagnosticRunId
  ) {
    return corruptKeywordLibrary();
  }
  const frozenKeywords = flattenFrozenKeywords(
    generation.governance.keywordClusters,
  );
  const factsById = new Map(
    frozenKeywords.map((frozen) => [frozen.fact.keywordEntityId, frozen] as const),
  );
  await loadFrozenEntities(exec, scope, frozenKeywords);
  const page = await new KeywordsRepository(exec).listByIdsPage(
    scope,
    [...factsById.keys()],
    {
      limit: options.limit,
      cursor: options.cursor,
    },
  );
  const reads = page.rows.map((entity) => {
    const frozen = factsById.get(entity.id);
    if (!frozen) return corruptKeywordLibrary();
    return { entity, frozen };
  });
  const rows = await loadFrozenProjectionRows(exec, scope, reads);
  const now = validNow(options.now ?? new Date());
  const histories = rows.histories as readonly FrozenEntityOccurrenceHistory[];
  const data = histories.map((history) =>
    projectItem(history, rows, scope, now, {
      frozen: history.frozen,
    }),
  );
  try {
    return GrowthMapKeywordLibraryResponse.parse({
      projectId,
      diagnosticRunId: generation.run.id,
      data,
      meta: {
        limit: options.limit,
        nextCursor: page.nextCursor,
        hasNext: page.nextCursor !== null,
        coverage: pageCoverage(data),
        sourceCounts: null,
      },
    });
  } catch {
    return corruptKeywordLibrary();
  }
}

async function listCurrentLibrary(
  exec: Executor,
  workspaceScope: WorkspaceScope,
  projectId: string,
  options: GrowthMapKeywordListOptions,
): Promise<ReturnType<typeof GrowthMapKeywordLibraryResponse.parse>> {
  const scope = await loadActiveProject(exec, workspaceScope, projectId);
  const repository = new KeywordsRepository(exec);
  const page = await repository.listByProject(scope, {
    limit: options.limit,
    cursor: options.cursor,
    sourceKind: options.sourceKind ?? null,
  });
  const sourceCounts = await repository.countBySourceKind(scope);
  const rows = await _loadProjectionRows(exec, scope, page.rows);
  const now = validNow(options.now ?? new Date());
  const data = rows.histories.map((history) =>
    projectItem(history, rows, scope, now),
  );
  try {
    return GrowthMapKeywordLibraryResponse.parse({
      projectId,
      diagnosticRunId: null,
      data,
      meta: {
        limit: options.limit,
        nextCursor: page.nextCursor,
        hasNext: page.nextCursor !== null,
        coverage: pageCoverage(data),
        sourceCounts,
      },
    });
  } catch {
    return corruptKeywordLibrary();
  }
}

async function detailInSnapshot(
  exec: Executor,
  workspaceScope: WorkspaceScope,
  projectId: string,
  keywordId: string,
  diagnosticRunId: string | null,
  now: Date,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  const scope = await loadActiveProject(exec, workspaceScope, projectId);
  const pinnedDiagnosticRunId = normalizePinnedDiagnosticRunId(
    diagnosticRunId,
  );
  const generation = await loadPublishedGrowthMapGeneration(
    exec,
    scope,
    pinnedDiagnosticRunId,
  );
  if (
    pinnedDiagnosticRunId !== null &&
    generation.run.id !== pinnedDiagnosticRunId
  ) {
    return corruptKeywordLibrary();
  }
  const frozen = flattenFrozenKeywords(
    generation.governance.keywordClusters,
  ).find((candidate) => candidate.fact.keywordEntityId === keywordId);
  if (!frozen) return keywordNotFound();
  const entities = await loadFrozenEntities(exec, scope, [frozen]);
  const entity = entities.get(keywordId);
  if (!entity) return corruptKeywordLibrary();
  const rows = await loadFrozenProjectionRows(exec, scope, [
    { entity, frozen },
  ]);
  const history = (rows.histories as readonly FrozenEntityOccurrenceHistory[])[0];
  if (!history) return corruptKeywordLibrary();
  const data = projectItem(
    history,
    rows,
    scope,
    validNow(now),
    { frozen: history.frozen },
  );
  try {
    return GrowthMapKeywordDetailResponse.parse({
      projectId,
      diagnosticRunId: pinnedDiagnosticRunId,
      data: { ...data, pendingSuggestion: null },
    });
  } catch {
    return corruptKeywordLibrary();
  }
}

type StoredSuggestionReadiness = Exclude<
  KeywordReviewSuggestionReadinessResult,
  { readonly kind: "not_found" }
>;

function suggestionIntentLineage(
  suggestion: KeywordReviewSuggestionRow,
): KeywordGovernancePendingSuggestion["intentLineage"] {
  switch (suggestion.intent_authority) {
    case "provider_observed":
      return {
        authority: "provider_observed",
        snapshotId:
          suggestion.intent_snapshot_id ?? corruptKeywordLibrary(),
        observationId:
          suggestion.intent_observation_id ?? corruptKeywordLibrary(),
        analysisInvocationId: null,
        observedAt:
          suggestion.intent_observed_at === null
            ? corruptKeywordLibrary()
            : canonicalUtcTimestamptz(suggestion.intent_observed_at),
      };
    case "llm_generated":
      return {
        authority: "llm_generated",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: suggestion.analysis_invocation_id,
        observedAt: null,
      };
    case "unavailable":
      return {
        authority: "unavailable",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: null,
        observedAt: null,
      };
    default:
      return corruptKeywordLibrary();
  }
}

function projectStoredPendingSuggestion(
  scope: ProjectScope,
  keywordId: string,
  currentRevision: number,
  readiness: StoredSuggestionReadiness,
): KeywordGovernancePendingSuggestion {
  const suggestion = readiness.suggestion;
  if (
    suggestion.workspace_id !== scope.workspaceId ||
    suggestion.project_id !== scope.projectId ||
    suggestion.keyword_entity_id !== keywordId ||
    suggestion.status !== "pending" ||
    (readiness.kind === "ready" &&
      suggestion.expected_governance_revision !== currentRevision)
  ) {
    return corruptKeywordLibrary();
  }
  const state =
    readiness.kind === "stale"
      ? "stale"
      : suggestion.intent_authority === "unavailable"
        ? "pending_needs_review"
        : "pending_ready";
  return {
    suggestionId: suggestion.id,
    suggestionVersion: suggestion.suggestion_version,
    state,
    expectedGovernanceRevision:
      suggestion.expected_governance_revision,
    status: suggestion.suggested_status,
    intent: suggestion.suggested_intent,
    buyerStage: suggestion.suggested_buyer_stage,
    topicNodeId: suggestion.suggested_topic_node_id,
    topicModelRevision: suggestion.suggested_topic_model_revision,
    topicLabel: readiness.topicLabel,
    mappingDecision: suggestion.suggested_mapping_decision,
    mappedSitePageId: suggestion.suggested_mapped_site_page_id,
    mappedSitePageTitle: readiness.mappedSitePageTitle,
    reason: suggestion.suggested_reason,
    readinessReason:
      state === "pending_ready"
        ? "all_authorities_confirmed"
        : state === "pending_needs_review"
          ? "insufficient_authority"
          : "governance_revision_changed",
    limitation:
      state === "pending_ready"
        ? null
        : state === "pending_needs_review"
          ? SUGGESTION_INTENT_AUTHORITY_LIMITATION
          : SUGGESTION_STALE_LIMITATION,
    lineage: {
      generationVersion: suggestion.generation_version,
      promptSetVersion: suggestion.prompt_set_version,
      authority: "llm_generated",
      analysisInvocationId: suggestion.analysis_invocation_id,
    },
    intentLineage: suggestionIntentLineage(suggestion),
    createdAt: canonicalUtcTimestamptz(suggestion.created_at),
  };
}

function projectEmptyGenerationSuggestion(
  generation: LatestKeywordGovernanceSuggestionGeneration,
  state: "generating" | "stale" | "unavailable",
): KeywordGovernancePendingSuggestion {
  return {
    suggestionId: generation.suggestionId,
    suggestionVersion: "keyword-governance-suggestion.v1",
    state,
    expectedGovernanceRevision:
      generation.expectedGovernanceRevision,
    status: null,
    intent: null,
    buyerStage: null,
    topicNodeId: null,
    topicModelRevision: null,
    topicLabel: null,
    mappingDecision: null,
    mappedSitePageId: null,
    mappedSitePageTitle: null,
    reason: null,
    readinessReason:
      state === "generating"
        ? "generation_in_progress"
        : state === "stale"
          ? "governance_revision_changed"
          : "authority_unavailable",
    limitation:
      state === "generating"
        ? SUGGESTION_GENERATING_LIMITATION
        : state === "stale"
          ? SUGGESTION_STALE_LIMITATION
          : SUGGESTION_UNAVAILABLE_LIMITATION,
    lineage: null,
    intentLineage: null,
    createdAt: canonicalUtcTimestamptz(generation.createdAt),
  };
}

async function loadPendingSuggestion(
  exec: Executor,
  scope: ProjectScope,
  keywordId: string,
  currentRevision: number,
): Promise<KeywordGovernancePendingSuggestion | null> {
  let pending: KeywordReviewSuggestionReadinessResult;
  let latest: LatestKeywordGovernanceSuggestionGeneration | null;
  try {
    pending = await new KeywordReviewSuggestionsRepository(
      exec,
    ).findCurrentPendingReadiness(scope, keywordId);
    if (pending.kind !== "not_found") {
      return projectStoredPendingSuggestion(
        scope,
        keywordId,
        currentRevision,
        pending,
      );
    }
    latest = await new KeywordGovernanceSuggestionGenerationRunsRepository(
      exec,
    ).findLatestGenerationForKeyword(scope, keywordId);
  } catch {
    return corruptKeywordLibrary();
  }
  if (latest === null) return null;
  if (
    latest.keywordId !== keywordId ||
    latest.suggestionId !== latest.generationRunId
  ) {
    return corruptKeywordLibrary();
  }
  if (
    latest.expectedGovernanceRevision !== currentRevision ||
    !latest.authorityCurrent ||
    latest.status === "cancelled"
  ) {
    return projectEmptyGenerationSuggestion(latest, "stale");
  }
  if (
    (latest.status === "queued" || latest.status === "running") &&
    latest.expectedGovernanceRevision === currentRevision &&
    !latest.hasSuggestion
  ) {
    return projectEmptyGenerationSuggestion(latest, "generating");
  }
  if (latest.status === "failed") {
    return projectEmptyGenerationSuggestion(latest, "unavailable");
  }
  if (latest.status === "completed" && !latest.hasSuggestion) {
    return corruptKeywordLibrary();
  }
  if (latest.status === "completed" && latest.hasSuggestion) return null;
  return corruptKeywordLibrary();
}

async function reviewDetailInSnapshot(
  exec: Executor,
  workspaceScope: WorkspaceScope,
  projectId: string,
  keywordId: string,
  now: Date,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  const scope = await loadActiveProject(exec, workspaceScope, projectId);
  let governance: CurrentKeywordGovernance | null;
  try {
    governance = await new KeywordGovernanceRepository(exec).findCurrent(
      scope,
      keywordId,
    );
  } catch (error) {
    if (error instanceof KeywordGovernanceIntegrityError) {
      return corruptKeywordLibrary();
    }
    throw error;
  }
  if (!governance) return keywordNotFound();
  const entity = await new KeywordsRepository(exec).findById(scope, keywordId);
  if (!entity) return corruptKeywordLibrary();
  const rows = await _loadProjectionRows(exec, scope, [entity]);
  const history = rows.histories[0];
  if (!history) return corruptKeywordLibrary();
  const data = projectItem(history, rows, scope, validNow(now), {
    governance,
  });
  const pendingSuggestion =
    data.reviewOrigin === "user"
      ? null
      : await loadPendingSuggestion(
          exec,
          scope,
          keywordId,
          governance.projection.governanceRevision,
        );
  try {
    return GrowthMapKeywordDetailResponse.parse({
      projectId,
      diagnosticRunId: null,
      data: { ...data, pendingSuggestion },
    });
  } catch {
    return corruptKeywordLibrary();
  }
}

export async function listProjectAuditKeywords(
  scope: WorkspaceScope,
  projectId: string,
  options: GrowthMapKeywordListOptions,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapKeywordLibraryResponse.parse>> {
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > MAX_KEYWORD_ENTITY_PAGE_SIZE
  ) {
    throw new RangeError("Invalid Keyword Library list options");
  }
  if (options.now !== undefined) validNow(options.now);
  if (
    options.sourceKind != null &&
    !GrowthMapKeywordSourceKind.options.includes(options.sourceKind)
  ) {
    throw new RangeError("Invalid Keyword Library source kind");
  }
  const useLegacyLatestPublishedRead =
    options.diagnosticRunId === undefined;
  const diagnosticRunId = normalizePinnedDiagnosticRunId(
    options.diagnosticRunId,
  );
  if (
    options.sourceKind != null &&
    (diagnosticRunId !== null || useLegacyLatestPublishedRead)
  ) {
    throw new RangeError(
      "sourceKind is only supported for the live Keyword Library read",
    );
  }
  // The live library pages over the value-ordered keyset; frozen and legacy
  // reads keep the original intake-time keyset, so each path validates the
  // cursor language it actually binds.
  if (diagnosticRunId === null && !useLegacyLatestPublishedRead) {
    assertValidKeywordLibraryLiveListCursor(options.cursor);
  } else {
    assertValidTimestampUuidListCursor(options.cursor);
  }
  const read = (selected: Executor) =>
    diagnosticRunId === null && !useLegacyLatestPublishedRead
      ? listCurrentLibrary(selected, scope, projectId, options)
      : listInSnapshot(selected, scope, projectId, {
          ...options,
          diagnosticRunId,
        });
  if (exec) return read(exec);
  return getDb().db.transaction(
    read,
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}


export async function getProjectAuditKeyword(
  scope: WorkspaceScope,
  projectId: string,
  keywordId: string,
  diagnosticRunId?: string | null,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  const now = new Date();
  const pinnedDiagnosticRunId = normalizePinnedDiagnosticRunId(
    diagnosticRunId,
  );
  if (exec) {
    return detailInSnapshot(
      exec,
      scope,
      projectId,
      keywordId,
      pinnedDiagnosticRunId,
      now,
    );
  }
  return getDb().db.transaction(
    (tx) =>
      detailInSnapshot(
        tx,
        scope,
        projectId,
        keywordId,
        pinnedDiagnosticRunId,
        now,
      ),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function getProjectAuditKeywordReviewDetail(
  scope: WorkspaceScope,
  projectId: string,
  keywordId: string,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  const now = new Date();
  if (exec) {
    return reviewDetailInSnapshot(exec, scope, projectId, keywordId, now);
  }
  return getDb().db.transaction(
    (tx) => reviewDetailInSnapshot(tx, scope, projectId, keywordId, now),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export interface KeywordReviewScope extends WorkspaceScope {
  /** Server-resolved operator identity; never accepted from the request body. */
  readonly actorId: string;
  /** Request-scoped structured logger; never receives customer or provider text. */
  readonly logger?: Pick<Logger, "error">;
}

interface DatabaseFault {
  readonly sqlState: string;
  readonly constraint: string | null;
}

const SQLSTATE = /^[0-9A-Z]{5}$/u;
const CONSTRAINT_NAME = /^[a-z][a-z0-9_]{0,62}$/u;
const PAGE_CONSTRAINT = /(?:mapped_site_page|mapped_si_fkey|site_page.*(?:scope|fkey)|page_scope)/u;
const TOPIC_CONSTRAINT = /(?:topic_node|topic_nod_fkey|topic_model_revision|topic_mod_fkey|topic_assignment)/u;
const INTEGRITY_CONSTRAINT = /(?:keyword.*(?:projection|revision|ledger)|keyword_review_decisions_(?:check|.*projection)|keyword_entities_(?:check|.*revision))/u;

function databaseFault(error: unknown): DatabaseFault | null {
  let candidate = error;
  const visited = new Set<object>();
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      if (typeof candidate !== "object" || candidate === null) return null;
      if (visited.has(candidate)) return null;
      visited.add(candidate);
      const record = candidate as {
        readonly code?: unknown;
        readonly constraint?: unknown;
        readonly cause?: unknown;
      };
      if (typeof record.code === "string" && SQLSTATE.test(record.code)) {
        const constraint =
          typeof record.constraint === "string" &&
          CONSTRAINT_NAME.test(record.constraint)
            ? record.constraint
            : null;
        return { sqlState: record.code, constraint };
      }
      candidate = record.cause;
    } catch {
      return null;
    }
  }
  return null;
}

function logKeywordReviewDatabaseFault(
  scope: KeywordReviewScope,
  projectId: string,
  keywordId: string,
  expectedRevision: number,
  operation:
    | "keyword_update"
    | "decision_insert"
    | "suggestion_approve",
  fault: DatabaseFault,
): void {
  try {
    scope.logger?.error("keyword_review_persistence_failed", {
      operation,
      sqlState: fault.sqlState,
      ...(fault.constraint === null
        ? {}
        : { constraint: fault.constraint }),
      workspaceId: scope.workspaceId,
      projectId,
      keywordId,
      governanceRevision: expectedRevision,
    });
  } catch {
    // Persistence classification must not depend on the logging sink.
  }
}

function mapKeywordReviewPersistenceError(
  error: unknown,
  scope: KeywordReviewScope,
  projectId: string,
  keywordId: string,
  expectedRevision: number,
  operation: "keyword_update" | "decision_insert" | "suggestion_approve",
): never {
  const fault = databaseFault(error);
  if (fault === null) throw error;
  logKeywordReviewDatabaseFault(
    scope,
    projectId,
    keywordId,
    expectedRevision,
    operation,
    fault,
  );
  if (
    (fault.sqlState === "23503" || fault.sqlState === "23514") &&
    fault.constraint !== null &&
    PAGE_CONSTRAINT.test(fault.constraint)
  ) {
    throw new ProblemError("NOT_FOUND", "Mapped page not found.");
  }
  if (
    (fault.sqlState === "23503" || fault.sqlState === "23514") &&
    fault.constraint !== null &&
    TOPIC_CONSTRAINT.test(fault.constraint)
  ) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "The selected Topic assignment is not active in the confirmed model revision.",
    );
  }
  if (
    fault.sqlState === "23514" &&
    fault.constraint !== null &&
    INTEGRITY_CONSTRAINT.test(fault.constraint)
  ) {
    return corruptKeywordLibrary();
  }
  throw new Error("Keyword review persistence failed");
}

function mapKeywordReviewError(
  error: unknown,
  scope: KeywordReviewScope,
  projectId: string,
  keywordId: string,
  expectedRevision: number,
): never {
  if (error instanceof KeywordGovernanceConflictError) {
    switch (error.code) {
      case "KEYWORD_NOT_FOUND":
        return keywordNotFound();
      case "SUGGESTION_NOT_FOUND":
        return keywordNotFound();
      case "REVISION_CONFLICT":
        if (
          error.expectedRevision === null ||
          error.currentRevision === null ||
          error.expectedRevision !== expectedRevision
        ) {
          return corruptKeywordLibrary();
        }
        return keywordRevisionConflict(
          projectId,
          keywordId,
          error.expectedRevision,
          error.currentRevision,
        );
      case "SITE_PAGE_NOT_FOUND":
        throw new ProblemError(
          "NOT_FOUND",
          "Mapped page not found.",
        );
      case "TOPIC_ASSIGNMENT_INVALID":
        throw new ProblemError(
          "VALIDATION_ERROR",
          "The selected Topic assignment is not active in the confirmed model revision.",
        );
    }
  }
  if (error instanceof KeywordGovernanceIntegrityError) {
    return corruptKeywordLibrary();
  }
  const fault = databaseFault(error);
  const operation =
    fault?.sqlState === "23503" ? "decision_insert" : "keyword_update";
  return mapKeywordReviewPersistenceError(
    error,
    scope,
    projectId,
    keywordId,
    expectedRevision,
    operation,
  );
}

function mapKeywordSuggestionApprovalError(
  error: unknown,
  scope: KeywordReviewScope,
  projectId: string,
  keywordId: string,
  expectedRevision: number,
): never {
  if (error instanceof KeywordGovernanceConflictError) {
    switch (error.code) {
      case "KEYWORD_NOT_FOUND":
        return keywordNotFound();
      case "SUGGESTION_NOT_FOUND":
        return keywordSuggestionNotFound();
      case "REVISION_CONFLICT":
        if (
          error.expectedRevision !== expectedRevision ||
          (error.currentRevision !== null &&
            (!Number.isSafeInteger(error.currentRevision) ||
              error.currentRevision < 0))
        ) {
          return corruptKeywordLibrary();
        }
        if (
          error.currentRevision !== null &&
          error.currentRevision !== expectedRevision
        ) {
          return keywordRevisionConflict(
            projectId,
            keywordId,
            expectedRevision,
            error.currentRevision,
          );
        }
        return keywordSuggestionConflict();
      case "SITE_PAGE_NOT_FOUND":
        throw new ProblemError("NOT_FOUND", "Mapped page not found.");
      case "TOPIC_ASSIGNMENT_INVALID":
        throw new ProblemError(
          "VALIDATION_ERROR",
          "The suggested Topic assignment is no longer active in the confirmed model revision.",
        );
    }
  }
  if (error instanceof KeywordGovernanceIntegrityError) {
    return corruptKeywordLibrary();
  }
  return mapKeywordReviewPersistenceError(
    error,
    scope,
    projectId,
    keywordId,
    expectedRevision,
    "suggestion_approve",
  );
}

async function reviewKeywordInSnapshot(
  exec: Executor,
  scope: KeywordReviewScope,
  projectId: string,
  keywordId: string,
  review: ReviewKeywordRequest,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  try {
    await new KeywordGovernanceRepository(exec).reviewKeyword(
      { workspaceId: scope.workspaceId, projectId },
      keywordId,
      scope.actorId,
      review,
    );
  } catch (error) {
    mapKeywordReviewError(
      error,
      scope,
      projectId,
      keywordId,
      review.expectedGovernanceRevision,
    );
  }

  // PATCH returns the authoritative live review projection (r+1), not the
  // last published frozen customer snapshot.
  return reviewDetailInSnapshot(
    exec,
    { workspaceId: scope.workspaceId },
    projectId,
    keywordId,
    new Date(),
  );
}

/** Review one Keyword's Topic/page governance without editing source history. */
export async function reviewProjectAuditKeyword(
  scope: KeywordReviewScope,
  projectId: string,
  keywordId: string,
  body: ReviewKeywordRequest,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  if (!UUID.test(keywordId)) return keywordNotFound();
  const parsed = ReviewKeywordRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Keyword review failed validation.",
    );
  }
  if (exec) {
    return reviewKeywordInSnapshot(
      exec,
      scope,
      projectId,
      keywordId,
      parsed.data,
    );
  }
  return getDb().db.transaction((tx) =>
    reviewKeywordInSnapshot(
      tx,
      scope,
      projectId,
      keywordId,
      parsed.data,
    ),
  );
}

async function approveKeywordSuggestionInSnapshot(
  exec: Executor,
  scope: KeywordReviewScope,
  projectId: string,
  keywordId: string,
  suggestionId: string,
  approval: ApproveKeywordReviewSuggestionRequest,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  try {
    await new KeywordGovernanceRepository(exec).approveSuggestion(
      { workspaceId: scope.workspaceId, projectId },
      keywordId,
      suggestionId,
      scope.actorId,
      approval,
    );
  } catch (error) {
    mapKeywordSuggestionApprovalError(
      error,
      scope,
      projectId,
      keywordId,
      approval.expectedGovernanceRevision,
    );
  }
  return reviewDetailInSnapshot(
    exec,
    { workspaceId: scope.workspaceId },
    projectId,
    keywordId,
    new Date(),
  );
}

/** Accept one immutable generated suggestion as the authenticated user's review. */
export async function approveProjectAuditKeywordReviewSuggestion(
  scope: KeywordReviewScope,
  projectId: string,
  keywordId: string,
  suggestionId: string,
  body: ApproveKeywordReviewSuggestionRequest,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  if (!UUID.test(keywordId)) return keywordNotFound();
  if (!UUID.test(suggestionId)) return keywordSuggestionNotFound();
  const parsed = ApproveKeywordReviewSuggestionRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Keyword review suggestion approval failed validation.",
    );
  }
  const run = (selected: Executor) =>
    approveKeywordSuggestionInSnapshot(
      selected,
      scope,
      projectId,
      keywordId,
      suggestionId,
      parsed.data,
    );
  if (exec) return run(exec);
  return getDb().db.transaction(run);
}
