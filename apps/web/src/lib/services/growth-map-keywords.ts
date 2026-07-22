import {
  GrowthMapKeywordDetailResponse,
  GrowthMapKeywordLibraryResponse,
  type GrowthMapCoverage,
  type GrowthMapKeywordLibraryItem,
  type GrowthMapKeywordMappedTarget,
  type GrowthMapKeywordMetrics,
  type GrowthMapKeywordNumericMetric,
  type GrowthMapKeywordSourceOccurrence,
  type GrowthMapKeywordTextMetric,
  type SourceFreshness,
} from "@sf/contracts";
import {
  KeywordOccurrencesRepository,
  KeywordsRepository,
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
  type Executor,
  type KeywordEntityRow,
  type KeywordOccurrenceRow,
  type ProjectScope,
  type SitePageRow,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import {
  DATAFORSEO_DATASET_KEY,
  canonicalizeUrl,
  parseDataForSeoCollectionScope,
} from "@sf/sources";
import { and, asc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assertValidTimestampUuidListCursor } from "./list-cursor";
import { isStale } from "./source-mappers";

const { collectionRuns, dataSnapshots, normalizedObservations } = schemaTables;

const MAX_LOOKUP_BATCH = 500;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const GSC_TOP_QUERY_POINTER =
  /^\/valueJson\/topQueries\/([0-9]+)\/query$/u;

const NO_KEYWORDS =
  "No canonical Keyword Library entries are available on this cursor page.";
const OCCURRENCE_HISTORY_LIMITATION =
  "Only the most recent 100 source occurrences are included; older immutable occurrence history remains available in canonical storage.";
const MANUAL_FRESHNESS_LIMITATION =
  "Manual input has no independent provider data-as-of timestamp.";
const UNKNOWN_FRESHNESS_LIMITATION =
  "No provider data-as-of timestamp is available for this source occurrence.";

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
  readonly provider: string;
  readonly dataset_key: string;
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

interface KeywordProjectionRows {
  readonly histories: readonly EntityOccurrenceHistory[];
  readonly observationsById: ReadonlyMap<string, CanonicalObservationRow>;
  readonly snapshotsById: ReadonlyMap<string, CanonicalSnapshotRow>;
  readonly collectionRunsById: ReadonlyMap<string, CanonicalCollectionRunRow>;
  readonly sitePagesById: ReadonlyMap<string, SitePageRow>;
}

interface ProjectedOccurrence {
  readonly row: KeywordOccurrenceRow;
  readonly dto: GrowthMapKeywordSourceOccurrence;
  readonly observation: CanonicalObservationRow | null;
  readonly snapshot: CanonicalSnapshotRow | null;
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
  providerDataAsOf: string | null,
  now: Date,
): SourceFreshness {
  if (providerDataAsOf === null) return "unknown";
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

async function loadOccurrenceHistories(
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
        provider: dataSnapshots.provider,
        dataset_key: dataSnapshots.dataset_key,
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

async function loadProjectionRows(
  exec: Executor,
  scope: ProjectScope,
  entities: readonly KeywordEntityRow[],
): Promise<KeywordProjectionRows> {
  const histories = await loadOccurrenceHistories(exec, scope, entities);
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
  return {
    histories,
    observationsById,
    snapshotsById,
    collectionRunsById,
    sitePagesById,
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

function validateDataForSeoSummary(
  snapshot: CanonicalSnapshotRow,
  occurrence: KeywordOccurrenceRow,
): string {
  let collectionScope: ReturnType<typeof parseDataForSeoCollectionScope>;
  try {
    collectionScope = parseDataForSeoCollectionScope(
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
  return boundedText(
    `DataForSEO ${snapshot.dataset_key} scope is target ${collectionScope.target}, market ${collectionScope.marketCode}, language ${collectionScope.languageTag}, ${location}, capped at ${collectionScope.limit} rows; it is not the complete keyword universe.`,
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
      if (
        occurrence.scope_basis !== "provider_collection_scope" ||
        occurrence.source_pointer !== "/valueJson/keyword" ||
        snapshot.provider !== "dataforseo" ||
        snapshot.dataset_key !== DATAFORSEO_DATASET_KEY ||
        observation.provider !== "dataforseo" ||
        observation.metric_key !== "csv.keyword_gap.v1" ||
        observation.subject_type !== "keyword_cluster" ||
        observation.site_page_id !== null ||
        observation.origin !== "vendor_observation" ||
        observation.method !== "observed" ||
        observation.grade !== "B" ||
        collectionRun.provider !== "dataforseo" ||
        collectionRun.operation !== "keyword_gap_import" ||
        collectionRun.method_version !== "dataforseo.ranked_keywords.v1" ||
        collectionRun.import_preview_id !== null ||
        lineage.providerDataAsOf !== null
      ) {
        return corruptKeywordLibrary();
      }
      scopeLimitation = validateDataForSeoSummary(snapshot, occurrence);
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
        collectionRun.method_version !== "gsc.search_analytics.v1" ||
        collectionRun.import_preview_id !== null
      ) {
        return corruptKeywordLibrary();
      }
      scopeLimitation = validateGscContext(snapshot, occurrence);
      break;
    }
    case "manual":
      return corruptKeywordLibrary();
    default:
      return corruptKeywordLibrary();
  }

  const freshness = sourceFreshness(
    snapshot.provider,
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
        : {
            ...common,
            sourceKind: "gsc_top_query",
            sourcePointer:
              occurrence.source_pointer ?? corruptKeywordLibrary(),
            scopeBasis: "project_context",
            scopeLimitation: scopeLimitation ?? corruptKeywordLibrary(),
          };
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
    : projectProviderOccurrence(occurrence, entity, rows, scope, now);
}

function mappingReviewState(
  value: KeywordEntityRow["mapping_review_state"],
): "unreviewed" | "approved" {
  if (value === "unreviewed") return "unreviewed";
  if (value === "confirmed") return "approved";
  return corruptKeywordLibrary();
}

function mappedTarget(
  entity: KeywordEntityRow,
  rows: KeywordProjectionRows,
  scope: ProjectScope,
): GrowthMapKeywordMappedTarget {
  const governance = {
    reviewState: mappingReviewState(entity.mapping_review_state),
    revision: entity.mapping_revision,
    reason: null,
  } as const;
  switch (entity.mapping_decision) {
    case "unassigned":
      if (entity.mapped_site_page_id !== null) return corruptKeywordLibrary();
      return { ...governance, kind: "unassigned" };
    case "new_asset":
      if (entity.mapped_site_page_id !== null) return corruptKeywordLibrary();
      return { ...governance, kind: "new_asset" };
    case "existing_page": {
      if (entity.mapped_site_page_id === null) return corruptKeywordLibrary();
      const page = rows.sitePagesById.get(entity.mapped_site_page_id);
      if (!page) return corruptKeywordLibrary();
      validateSitePage(page, scope, entity.mapped_site_page_id);
      return {
        ...governance,
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

function classificationLimitations(entity: KeywordEntityRow) {
  return {
    intent: entity.intent === null ? CLASSIFICATION_LIMITATIONS.intent : null,
    buyerStage:
      entity.buyer_stage === null
        ? CLASSIFICATION_LIMITATIONS.buyerStage
        : null,
    cluster:
      entity.cluster_key === null
        ? CLASSIFICATION_LIMITATIONS.cluster
        : CLASSIFICATION_LIMITATIONS.clusterWithoutId,
  };
}

function itemCoverage(input: {
  readonly classifications: ReturnType<typeof classificationLimitations>;
  readonly metrics: GrowthMapKeywordMetrics;
  readonly occurrences: readonly ProjectedOccurrence[];
  readonly truncated: boolean;
}): GrowthMapCoverage {
  const limitations = unique(
    [
      ...Object.values(input.classifications),
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
): GrowthMapKeywordLibraryItem {
  const { entity } = history;
  validateEntity(entity, scope);
  const projected = history.rows.map((occurrence) =>
    projectOccurrence(occurrence, entity, rows, scope, now),
  );
  const classifications = classificationLimitations(entity);
  const metrics = projectMetrics(projected);
  return {
    projectId: scope.projectId,
    keywordId: entity.id,
    displayKeyword: entity.display_keyword,
    normalizedKeyword: entity.normalized_keyword,
    marketCode: entity.market,
    languageTag: entity.language_tag,
    queryKind: entity.query_kind,
    status: entity.status,
    revision: entity.mapping_revision,
    intent: entity.intent,
    buyerStage: entity.buyer_stage,
    // `cluster_key` is a reviewed label, not a canonical cluster UUID. Do not
    // fabricate an ID simply to fill the public reference shape.
    cluster: null,
    classificationLimitations: classifications,
    mappedTarget: mappedTarget(entity, rows, scope),
    sourceOccurrences: projected.map((occurrence) => occurrence.dto),
    metrics,
    coverage: itemCoverage({
      classifications,
      metrics,
      occurrences: projected,
      truncated: history.truncated,
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
  const page = await new KeywordsRepository(exec).listByProject(scope, {
    limit: options.limit,
    cursor: options.cursor,
  });
  const rows = await loadProjectionRows(exec, scope, page.rows);
  const now = validNow(options.now ?? new Date());
  const data = rows.histories.map((history) =>
    projectItem(history, rows, scope, now),
  );
  try {
    return GrowthMapKeywordLibraryResponse.parse({
      projectId,
      data,
      meta: {
        limit: options.limit,
        nextCursor: page.nextCursor,
        hasNext: page.nextCursor !== null,
        coverage: pageCoverage(data),
      },
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
  assertValidTimestampUuidListCursor(options.cursor);
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > MAX_KEYWORD_ENTITY_PAGE_SIZE
  ) {
    throw new RangeError("Invalid Keyword Library list options");
  }
  if (options.now !== undefined) validNow(options.now);
  if (exec) return listInSnapshot(exec, scope, projectId, options);
  return getDb().db.transaction(
    (tx) => listInSnapshot(tx, scope, projectId, options),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function detailInSnapshot(
  exec: Executor,
  workspaceScope: WorkspaceScope,
  projectId: string,
  keywordId: string,
  now: Date,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  const scope = await loadActiveProject(exec, workspaceScope, projectId);
  const entity = await new KeywordsRepository(exec).findById(scope, keywordId);
  if (!entity) return keywordNotFound();
  const rows = await loadProjectionRows(exec, scope, [entity]);
  const history = rows.histories[0];
  if (!history) return corruptKeywordLibrary();
  const data = projectItem(history, rows, scope, validNow(now));
  try {
    return GrowthMapKeywordDetailResponse.parse({ projectId, data });
  } catch {
    return corruptKeywordLibrary();
  }
}

export async function getProjectAuditKeyword(
  scope: WorkspaceScope,
  projectId: string,
  keywordId: string,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapKeywordDetailResponse.parse>> {
  const now = new Date();
  if (exec) return detailInSnapshot(exec, scope, projectId, keywordId, now);
  return getDb().db.transaction(
    (tx) => detailInSnapshot(tx, scope, projectId, keywordId, now),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
