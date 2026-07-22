import {
  GrowthMapCompetitorDetailResponse,
  GrowthMapCompetitorLibraryResponse,
  ProductProfileCompetitorCandidate,
  ProductProfileFieldProvenance,
  type GrowthMapCompetitorLibraryItem,
  type GrowthMapCompetitorOriginOccurrence,
  type GrowthMapCoverage,
  type ProductProfileEvidenceRef,
} from "@sf/contracts";
import {
  CompetitorsRepository,
  MAX_COMPETITOR_ORIGIN_PAGE_SIZE,
  MAX_COMPETITOR_PAGE_SIZE,
  ProjectsRepository,
  canonicalize,
  canonicalUtcTimestamptz,
  projectPredicate,
  sameTimestamptzInstant,
  schemaTables,
  type CompetitorEntityRow,
  type CompetitorOriginRow,
  type CanonicalValue,
  type Executor,
  type ProjectRow,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assertValidTimestampUuidListCursor } from "./list-cursor";

const {
  collectionRuns,
  competitorOriginOccurrences,
  dataSnapshots,
  icpProfiles,
  importPreviews,
  normalizedObservations,
} = schemaTables;

const MAX_LOOKUP_BATCH = 500;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NO_COMPETITORS =
  "No canonical Competitor Library entries are available on this cursor page.";
const ORIGIN_HISTORY_LIMITATION =
  "Only the most recent 100 immutable origin occurrences are included; older canonical origin history remains available in storage.";
const SERP_WRITER_LIMITATION =
  "SERP overlap is unavailable because Competitor Library v1 has no canonical SERP-overlap writer.";
const AI_CITATION_WRITER_LIMITATION =
  "AI citation insight is unavailable because Competitor Library v1 has no canonical AI-citation writer.";
const CANDIDATE_LIMITATION =
  "This Competitor is still a candidate and has not been approved for analysis.";
const EXCLUDED_LIMITATION =
  "This Competitor has been excluded from the approved analysis scope.";
const SOURCE_APPROVED_REVIEW_PENDING_LIMITATION =
  "A Product Profile source is approved, but this stable Competitor Library entity is still awaiting its own review.";

export interface GrowthMapCompetitorListOptions {
  readonly limit: number;
  readonly cursor: string | null;
}

interface CanonicalProfileRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly version: number;
  readonly status: string;
  readonly profile: unknown;
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
  readonly observed_at: string;
  readonly availability: string;
  readonly value_json: unknown;
  readonly origin: string;
  readonly method: string;
  readonly grade: string;
  readonly support: string;
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
  readonly method_version: string;
  readonly captured_at: string;
  readonly availability: string;
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

interface CanonicalImportPreviewRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly template_id: string;
  readonly status: string;
}

interface EntityOriginHistory {
  readonly entity: CompetitorEntityRow;
  readonly origins: readonly CompetitorOriginRow[];
  readonly truncated: boolean;
  readonly hasApprovedProductProfileSource: boolean;
}

interface CompetitorProjectionRows {
  readonly histories: readonly EntityOriginHistory[];
  readonly profilesById: ReadonlyMap<string, CanonicalProfileRow>;
  readonly observationsById: ReadonlyMap<string, CanonicalObservationRow>;
  readonly snapshotsById: ReadonlyMap<string, CanonicalSnapshotRow>;
  readonly collectionRunsById: ReadonlyMap<string, CanonicalCollectionRunRow>;
  readonly importPreviewsById: ReadonlyMap<string, CanonicalImportPreviewRow>;
}

function corruptCompetitorLibrary(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The Competitor Library projection failed its provenance checks.",
  );
}

function projectNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Project not found.");
}

function competitorNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Competitor not found.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function batches<T>(values: readonly T[]): T[][] {
  const output: T[][] = [];
  for (let offset = 0; offset < values.length; offset += MAX_LOOKUP_BATCH) {
    output.push(values.slice(offset, offset + MAX_LOOKUP_BATCH));
  }
  return output;
}

function isoInstant(value: string): string {
  try {
    return canonicalUtcTimestamptz(value);
  } catch {
    return corruptCompetitorLibrary();
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return (
      canonicalize(left as CanonicalValue) ===
      canonicalize(right as CanonicalValue)
    );
  } catch {
    return false;
  }
}

async function loadActiveProject(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
): Promise<ProjectRow> {
  const project = await new ProjectsRepository(exec).findById(scope, projectId);
  if (
    !project ||
    project.id !== projectId ||
    project.workspace_id !== scope.workspaceId ||
    project.archived_at !== null
  ) {
    return projectNotFound();
  }
  return project;
}

function validateEntity(
  entity: CompetitorEntityRow,
  scope: ProjectScope,
): void {
  if (
    entity.workspace_id !== scope.workspaceId ||
    entity.project_id !== scope.projectId ||
    !Number.isSafeInteger(entity.origin_count) ||
    entity.origin_count < 1 ||
    !Number.isSafeInteger(entity.revision) ||
    entity.revision < 0
  ) {
    corruptCompetitorLibrary();
  }
}

function validateOriginIdentity(
  origin: CompetitorOriginRow,
  entity: CompetitorEntityRow,
  scope: ProjectScope,
): void {
  if (
    origin.workspace_id !== scope.workspaceId ||
    origin.project_id !== scope.projectId ||
    origin.competitor_id !== entity.id
  ) {
    corruptCompetitorLibrary();
  }
}

async function loadOriginHistories(
  exec: Executor,
  scope: ProjectScope,
  entities: readonly CompetitorEntityRow[],
): Promise<EntityOriginHistory[]> {
  const repository = new CompetitorsRepository(exec);
  const loaded: Array<
    Omit<EntityOriginHistory, "hasApprovedProductProfileSource">
  > = [];
  for (const entity of entities) {
    validateEntity(entity, scope);
    const origins = await repository.listOrigins(
      scope,
      entity.id,
      MAX_COMPETITOR_ORIGIN_PAGE_SIZE,
    );
    const expected = Math.min(
      entity.origin_count,
      MAX_COMPETITOR_ORIGIN_PAGE_SIZE,
    );
    if (origins.length !== expected) return corruptCompetitorLibrary();
    loaded.push({
      entity,
      origins,
      truncated: entity.origin_count > origins.length,
    });
  }

  const needsHistoricalGovernanceLookup = loaded.filter(
    (history) =>
      history.truncated &&
      history.entity.review_status === "candidate" &&
      !history.origins.some(
        (origin) =>
          origin.origin_kind === "product_profile" &&
          origin.source_review_status === "approved",
      ),
  );
  const historicalApprovedSourceIds = new Set<string>();
  for (const batch of batches(
    needsHistoricalGovernanceLookup.map((history) => history.entity.id),
  )) {
    const rows = (await exec
      .select({ competitor_id: competitorOriginOccurrences.competitor_id })
      .from(competitorOriginOccurrences)
      .where(
        and(
          projectPredicate(competitorOriginOccurrences, scope),
          inArray(competitorOriginOccurrences.competitor_id, batch),
          eq(competitorOriginOccurrences.origin_kind, "product_profile"),
          eq(competitorOriginOccurrences.source_review_status, "approved"),
        ),
      )) as Array<{ readonly competitor_id: string }>;
    for (const row of rows) {
      if (!batch.includes(row.competitor_id)) return corruptCompetitorLibrary();
      historicalApprovedSourceIds.add(row.competitor_id);
    }
  }

  return loaded.map((history) => ({
    ...history,
    hasApprovedProductProfileSource:
      history.origins.some(
        (origin) =>
          origin.origin_kind === "product_profile" &&
          origin.source_review_status === "approved",
      ) || historicalApprovedSourceIds.has(history.entity.id),
  }));
}

async function loadProfiles(
  exec: Executor,
  scope: ProjectScope,
  ids: readonly string[],
): Promise<Map<string, CanonicalProfileRow>> {
  const selected = unique(ids);
  const byId = new Map<string, CanonicalProfileRow>();
  for (const batch of batches(selected)) {
    const rows = (await exec
      .select({
        id: icpProfiles.id,
        workspace_id: icpProfiles.workspace_id,
        project_id: icpProfiles.project_id,
        version: icpProfiles.version,
        status: icpProfiles.status,
        profile: icpProfiles.profile,
      })
      .from(icpProfiles)
      .where(
        and(
          projectPredicate(icpProfiles, scope),
          inArray(icpProfiles.id, batch),
        ),
      )
      .orderBy(asc(icpProfiles.id))) as CanonicalProfileRow[];
    for (const row of rows) {
      if (byId.has(row.id) || !batch.includes(row.id)) {
        return corruptCompetitorLibrary();
      }
      byId.set(row.id, row);
    }
  }
  if (byId.size !== selected.length) return corruptCompetitorLibrary();
  return byId;
}

async function loadObservations(
  exec: Executor,
  scope: ProjectScope,
  ids: readonly string[],
): Promise<Map<string, CanonicalObservationRow>> {
  const selected = unique(ids);
  const byId = new Map<string, CanonicalObservationRow>();
  for (const batch of batches(selected)) {
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
        observed_at: normalizedObservations.observed_at,
        availability: normalizedObservations.availability,
        value_json: normalizedObservations.value_json,
        origin: normalizedObservations.origin,
        method: normalizedObservations.method,
        grade: normalizedObservations.grade,
        support: normalizedObservations.support,
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
      if (byId.has(row.id) || !batch.includes(row.id)) {
        return corruptCompetitorLibrary();
      }
      byId.set(row.id, row);
    }
  }
  if (byId.size !== selected.length) return corruptCompetitorLibrary();
  return byId;
}

async function loadSnapshots(
  exec: Executor,
  scope: ProjectScope,
  ids: readonly string[],
): Promise<Map<string, CanonicalSnapshotRow>> {
  const selected = unique(ids);
  const byId = new Map<string, CanonicalSnapshotRow>();
  for (const batch of batches(selected)) {
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
        method_version: dataSnapshots.method_version,
        captured_at: dataSnapshots.captured_at,
        availability: dataSnapshots.availability,
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
      if (byId.has(row.id) || !batch.includes(row.id)) {
        return corruptCompetitorLibrary();
      }
      byId.set(row.id, row);
    }
  }
  if (byId.size !== selected.length) return corruptCompetitorLibrary();
  return byId;
}

async function loadCollectionRuns(
  exec: Executor,
  scope: ProjectScope,
  ids: readonly string[],
): Promise<Map<string, CanonicalCollectionRunRow>> {
  const selected = unique(ids);
  const byId = new Map<string, CanonicalCollectionRunRow>();
  for (const batch of batches(selected)) {
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
      if (byId.has(row.id) || !batch.includes(row.id)) {
        return corruptCompetitorLibrary();
      }
      byId.set(row.id, row);
    }
  }
  if (byId.size !== selected.length) return corruptCompetitorLibrary();
  return byId;
}

async function loadImportPreviews(
  exec: Executor,
  scope: ProjectScope,
  ids: readonly string[],
): Promise<Map<string, CanonicalImportPreviewRow>> {
  const selected = unique(ids);
  const byId = new Map<string, CanonicalImportPreviewRow>();
  for (const batch of batches(selected)) {
    const rows = (await exec
      .select({
        id: importPreviews.id,
        workspace_id: importPreviews.workspace_id,
        project_id: importPreviews.project_id,
        site_id: importPreviews.site_id,
        template_id: importPreviews.template_id,
        status: importPreviews.status,
      })
      .from(importPreviews)
      .where(
        and(
          projectPredicate(importPreviews, scope),
          inArray(importPreviews.id, batch),
        ),
      )
      .orderBy(asc(importPreviews.id))) as CanonicalImportPreviewRow[];
    for (const row of rows) {
      if (byId.has(row.id) || !batch.includes(row.id)) {
        return corruptCompetitorLibrary();
      }
      byId.set(row.id, row);
    }
  }
  if (byId.size !== selected.length) return corruptCompetitorLibrary();
  return byId;
}

async function loadProjectionRows(
  exec: Executor,
  scope: ProjectScope,
  entities: readonly CompetitorEntityRow[],
): Promise<CompetitorProjectionRows> {
  const histories = await loadOriginHistories(exec, scope, entities);
  const origins = histories.flatMap((history) => history.origins);
  const profilesById = await loadProfiles(
    exec,
    scope,
    origins.flatMap((origin) =>
      origin.product_profile_id === null ? [] : [origin.product_profile_id],
    ),
  );
  const observationsById = await loadObservations(
    exec,
    scope,
    origins.flatMap((origin) =>
      origin.normalized_observation_id === null
        ? []
        : [origin.normalized_observation_id],
    ),
  );
  const snapshotsById = await loadSnapshots(
    exec,
    scope,
    origins.flatMap((origin) =>
      origin.data_snapshot_id === null ? [] : [origin.data_snapshot_id],
    ),
  );
  const collectionRunsById = await loadCollectionRuns(
    exec,
    scope,
    [...snapshotsById.values()].map((snapshot) => snapshot.collection_run_id),
  );
  const importPreviewsById = await loadImportPreviews(
    exec,
    scope,
    origins.flatMap((origin) =>
      origin.import_preview_id === null ? [] : [origin.import_preview_id],
    ),
  );
  return {
    histories,
    profilesById,
    observationsById,
    snapshotsById,
    collectionRunsById,
    importPreviewsById,
  };
}

function projectProfileOrigin(
  origin: CompetitorOriginRow,
  entity: CompetitorEntityRow,
  rows: CompetitorProjectionRows,
): GrowthMapCompetitorOriginOccurrence {
  if (
    origin.product_profile_id === null ||
    origin.profile_version === null ||
    origin.candidate_id === null ||
    origin.field_provenance_path === null ||
    origin.evidence_refs === null ||
    origin.source_name === null ||
    origin.source_review_status === null ||
    origin.source_analysis_scope === null ||
    origin.data_snapshot_id !== null ||
    origin.normalized_observation_id !== null ||
    origin.import_preview_id !== null ||
    origin.source_pointer !== null ||
    origin.manual_entry_id !== null ||
    origin.observed_at !== null
  ) {
    return corruptCompetitorLibrary();
  }
  const profile = rows.profilesById.get(origin.product_profile_id);
  if (
    !profile ||
    profile.workspace_id !== entity.workspace_id ||
    profile.project_id !== entity.project_id ||
    profile.version !== origin.profile_version ||
    profile.status !== "complete" ||
    !isRecord(profile.profile) ||
    profile.profile["profileSchemaVersion"] !== "product-profile.0.3.0" ||
    !Array.isArray(profile.profile["competitorCandidates"]) ||
    !Array.isArray(profile.profile["fieldProvenance"])
  ) {
    return corruptCompetitorLibrary();
  }
  const candidates = profile.profile["competitorCandidates"];
  const candidateMatches = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        isRecord(candidate) && candidate["candidateId"] === origin.candidate_id,
    );
  if (candidateMatches.length !== 1) return corruptCompetitorLibrary();
  const candidateMatch = candidateMatches[0]!;
  const candidate = ProductProfileCompetitorCandidate.safeParse(
    candidateMatch.candidate,
  );
  if (
    !candidate.success ||
    candidate.data.domain !== entity.domain ||
    candidate.data.name !== origin.source_name ||
    candidate.data.reviewStatus !== origin.source_review_status ||
    candidate.data.relationship !== origin.source_relationship ||
    !sameJson(candidate.data.analysisScope, origin.source_analysis_scope) ||
    ![
      "/competitorCandidates",
      `/competitorCandidates/${candidateMatch.index}`,
    ].includes(origin.field_provenance_path)
  ) {
    return corruptCompetitorLibrary();
  }
  const provenanceMatches = profile.profile["fieldProvenance"].filter(
    (entry) =>
      isRecord(entry) && entry["path"] === origin.field_provenance_path,
  );
  if (provenanceMatches.length !== 1) return corruptCompetitorLibrary();
  const provenance = ProductProfileFieldProvenance.safeParse(
    provenanceMatches[0],
  );
  if (
    !provenance.success ||
    !sameJson(provenance.data.evidenceRefs, origin.evidence_refs)
  ) {
    return corruptCompetitorLibrary();
  }
  return {
    occurrenceId: origin.id,
    originKind: "product_profile",
    productProfileId: profile.id,
    profileVersion: profile.version,
    candidateId: candidate.data.candidateId,
    fieldProvenancePath: provenance.data.path,
    evidenceRefs: provenance.data.evidenceRefs as ProductProfileEvidenceRef[],
    observedAt: null,
  };
}

function projectCsvOrigin(
  origin: CompetitorOriginRow,
  entity: CompetitorEntityRow,
  rows: CompetitorProjectionRows,
): GrowthMapCompetitorOriginOccurrence {
  if (
    origin.source_name !== null ||
    origin.product_profile_id !== null ||
    origin.profile_version !== null ||
    origin.candidate_id !== null ||
    origin.field_provenance_path !== null ||
    origin.evidence_refs !== null ||
    origin.source_review_status !== null ||
    origin.source_relationship !== null ||
    origin.source_analysis_scope !== null ||
    origin.data_snapshot_id === null ||
    origin.normalized_observation_id === null ||
    origin.import_preview_id === null ||
    origin.source_pointer !== "/valueJson/competitorDomain" ||
    origin.manual_entry_id !== null ||
    origin.observed_at === null
  ) {
    return corruptCompetitorLibrary();
  }
  const observation = rows.observationsById.get(
    origin.normalized_observation_id,
  );
  const snapshot = rows.snapshotsById.get(origin.data_snapshot_id);
  const run = snapshot
    ? rows.collectionRunsById.get(snapshot.collection_run_id)
    : undefined;
  const preview = rows.importPreviewsById.get(origin.import_preview_id);
  if (
    !observation ||
    !snapshot ||
    !run ||
    !preview ||
    observation.workspace_id !== entity.workspace_id ||
    observation.project_id !== entity.project_id ||
    observation.snapshot_id !== snapshot.id ||
    observation.site_page_id !== null ||
    observation.provider !== "csv" ||
    observation.metric_key !== "csv.keyword_gap.v1" ||
    observation.subject_type !== "keyword_cluster" ||
    observation.availability !== "available" ||
    observation.origin !== "user_provided" ||
    observation.method !== "observed" ||
    observation.grade !== "C" ||
    observation.support !== "supports" ||
    !isRecord(observation.value_json) ||
    observation.value_json["competitorDomain"] !== entity.domain ||
    snapshot.workspace_id !== entity.workspace_id ||
    snapshot.project_id !== entity.project_id ||
    snapshot.provider !== "csv" ||
    snapshot.dataset_key !== "csv.keyword_gap.v1" ||
    snapshot.method_version !== "csv.keyword_gap.v1" ||
    !["available", "partial"].includes(snapshot.availability) ||
    run.workspace_id !== entity.workspace_id ||
    run.project_id !== entity.project_id ||
    run.id !== snapshot.collection_run_id ||
    run.site_id !== snapshot.site_id ||
    run.source_connection_id !== snapshot.source_connection_id ||
    run.provider !== "csv" ||
    run.operation !== "keyword_gap_import" ||
    run.method_version !== "csv.keyword_gap.v1" ||
    run.import_preview_id !== preview.id ||
    preview.id !== origin.import_preview_id ||
    preview.workspace_id !== entity.workspace_id ||
    preview.project_id !== entity.project_id ||
    preview.site_id !== snapshot.site_id ||
    preview.template_id !== "keyword_gap_v1" ||
    preview.status !== "consumed" ||
    !sameTimestamptzInstant(observation.observed_at, snapshot.captured_at) ||
    !sameTimestamptzInstant(observation.observed_at, origin.observed_at)
  ) {
    return corruptCompetitorLibrary();
  }
  return {
    occurrenceId: origin.id,
    originKind: "csv_keyword_gap",
    snapshotId: snapshot.id,
    observationId: observation.id,
    sourcePointer: "/valueJson/competitorDomain",
    importPreviewId: preview.id,
    evidenceRefs: [],
    observedAt: isoInstant(origin.observed_at),
  };
}

function projectManualOrigin(
  origin: CompetitorOriginRow,
): GrowthMapCompetitorOriginOccurrence {
  if (
    origin.id !== origin.manual_entry_id ||
    origin.product_profile_id !== null ||
    origin.profile_version !== null ||
    origin.candidate_id !== null ||
    origin.field_provenance_path !== null ||
    origin.evidence_refs !== null ||
    origin.source_review_status !== null ||
    origin.source_relationship !== null ||
    origin.source_analysis_scope !== null ||
    origin.data_snapshot_id !== null ||
    origin.normalized_observation_id !== null ||
    origin.import_preview_id !== null ||
    origin.source_pointer !== null ||
    origin.observed_at !== null
  ) {
    return corruptCompetitorLibrary();
  }
  return {
    occurrenceId: origin.id,
    originKind: "manual",
    manualEntryId: origin.id,
    evidenceRefs: [],
    observedAt: null,
  };
}

function projectOrigin(
  origin: CompetitorOriginRow,
  entity: CompetitorEntityRow,
  rows: CompetitorProjectionRows,
  scope: ProjectScope,
): GrowthMapCompetitorOriginOccurrence {
  validateOriginIdentity(origin, entity, scope);
  switch (origin.origin_kind) {
    case "product_profile":
      return projectProfileOrigin(origin, entity, rows);
    case "csv_keyword_gap":
      return projectCsvOrigin(origin, entity, rows);
    case "manual":
      return projectManualOrigin(origin);
    default:
      return corruptCompetitorLibrary();
  }
}

function itemCoverage(
  entity: CompetitorEntityRow,
  hasApprovedProductProfileSource: boolean,
  truncated: boolean,
): GrowthMapCoverage {
  const governance =
    entity.review_status === "candidate"
      ? CANDIDATE_LIMITATION
      : entity.review_status === "excluded"
        ? EXCLUDED_LIMITATION
        : null;
  return {
    availability: "partial",
    limitations: unique([
      SERP_WRITER_LIMITATION,
      AI_CITATION_WRITER_LIMITATION,
      ...(truncated ? [ORIGIN_HISTORY_LIMITATION] : []),
      ...(governance ? [governance] : []),
      ...(entity.review_status === "candidate" &&
      hasApprovedProductProfileSource
        ? [SOURCE_APPROVED_REVIEW_PENDING_LIMITATION]
        : []),
    ]),
  };
}

function projectItem(
  history: EntityOriginHistory,
  rows: CompetitorProjectionRows,
  scope: ProjectScope,
): GrowthMapCompetitorLibraryItem {
  const origins = history.origins.map((origin) =>
    projectOrigin(origin, history.entity, rows, scope),
  );
  const observedTimes = origins
    .flatMap((origin) => (origin.observedAt === null ? [] : [origin.observedAt]))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  const lastObservedAt =
    history.entity.last_observed_at === null
      ? null
      : isoInstant(history.entity.last_observed_at);
  const expectedLastObservedAt = observedTimes[0] ?? null;
  if (
    (lastObservedAt === null) !== (expectedLastObservedAt === null) ||
    (lastObservedAt !== null &&
      expectedLastObservedAt !== null &&
      !sameTimestamptzInstant(lastObservedAt, expectedLastObservedAt))
  ) {
    return corruptCompetitorLibrary();
  }
  return {
    projectId: scope.projectId,
    competitorId: history.entity.id,
    domain: history.entity.domain,
    name: history.entity.name,
    reviewStatus: history.entity.review_status,
    relationship: history.entity.relationship,
    analysisScope: history.entity.analysis_scope,
    revision: history.entity.revision,
    originOccurrences: origins,
    lastObservedAt,
    serpOverlap: {
      availability: "unavailable",
      value: null,
      limitation: SERP_WRITER_LIMITATION,
    },
    aiCitationInsight: {
      availability: "unavailable",
      value: null,
      limitation: AI_CITATION_WRITER_LIMITATION,
    },
    coverage: itemCoverage(
      history.entity,
      history.hasApprovedProductProfileSource,
      history.truncated,
    ),
  };
}

function pageCoverage(
  items: readonly GrowthMapCompetitorLibraryItem[],
): GrowthMapCoverage {
  if (items.length === 0) {
    return { availability: "unavailable", limitations: [NO_COMPETITORS] };
  }
  return {
    availability: "partial",
    limitations: unique(items.flatMap((item) => item.coverage.limitations)).slice(
      0,
      100,
    ),
  };
}

async function listInSnapshot(
  exec: Executor,
  workspaceScope: WorkspaceScope,
  projectId: string,
  options: GrowthMapCompetitorListOptions,
): Promise<ReturnType<typeof GrowthMapCompetitorLibraryResponse.parse>> {
  await loadActiveProject(exec, workspaceScope, projectId);
  const scope = { workspaceId: workspaceScope.workspaceId, projectId };
  const page = await new CompetitorsRepository(exec).listByProject(scope, {
    limit: options.limit,
    cursor: options.cursor,
  });
  const rows = await loadProjectionRows(exec, scope, page.rows);
  const data = rows.histories.map((history) =>
    projectItem(history, rows, scope),
  );
  try {
    return GrowthMapCompetitorLibraryResponse.parse({
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
    return corruptCompetitorLibrary();
  }
}

export async function listProjectAuditCompetitors(
  scope: WorkspaceScope,
  projectId: string,
  options: GrowthMapCompetitorListOptions,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapCompetitorLibraryResponse.parse>> {
  assertValidTimestampUuidListCursor(options.cursor);
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > MAX_COMPETITOR_PAGE_SIZE
  ) {
    throw new RangeError("Invalid Competitor Library list options");
  }
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
  competitorId: string,
): Promise<ReturnType<typeof GrowthMapCompetitorDetailResponse.parse>> {
  await loadActiveProject(exec, workspaceScope, projectId);
  const scope = { workspaceId: workspaceScope.workspaceId, projectId };
  const entity = await new CompetitorsRepository(exec).findById(
    scope,
    competitorId,
  );
  if (!entity) return competitorNotFound();
  const rows = await loadProjectionRows(exec, scope, [entity]);
  const history = rows.histories[0];
  if (!history) return corruptCompetitorLibrary();
  const data = projectItem(history, rows, scope);
  try {
    return GrowthMapCompetitorDetailResponse.parse({ projectId, data });
  } catch {
    return corruptCompetitorLibrary();
  }
}

export async function getProjectAuditCompetitor(
  scope: WorkspaceScope,
  projectId: string,
  competitorId: string,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapCompetitorDetailResponse.parse>> {
  if (!UUID.test(competitorId)) return competitorNotFound();
  if (exec) {
    return detailInSnapshot(exec, scope, projectId, competitorId);
  }
  return getDb().db.transaction(
    (tx) => detailInSnapshot(tx, scope, projectId, competitorId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
