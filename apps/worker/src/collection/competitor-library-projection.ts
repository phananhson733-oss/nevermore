import {
  CollectionRunsRepository,
  CompetitorsRepository,
  ImportPreviewsRepository,
  ObservationsRepository,
  type CollectionRunRow,
  type CsvKeywordGapCompetitorOriginInput,
  type DataSnapshotRow,
  type DbTx,
  type ImportPreviewRow,
  type ObservationRow,
  type ProjectScope,
} from "@sf/db";
import {
  KEYWORD_GAP_TEMPLATE_ID,
  METRIC_CSV_KEYWORD_GAP,
  SourceError,
} from "@sf/sources";

const CSV_PROVIDER = "csv";
const CSV_OPERATION = "keyword_gap_import";
const CSV_DATASET_KEY = "csv.keyword_gap.v1";
const PROJECTION_PAGE_SIZE = 500;
const COMPETITOR_DOMAIN_POINTER = "/valueJson/competitorDomain" as const;
const NORMALIZED_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function invalidProjection(message: string): SourceError {
  return new SourceError("INVALID_RESPONSE", message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidProjection(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function canonicalCompetitorDomain(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value !== value.toLowerCase() ||
    !NORMALIZED_DOMAIN.test(value)
  ) {
    throw invalidProjection(
      "Canonical CSV Observation contains an invalid competitor domain.",
    );
  }
  return value;
}

function assertCanonicalCsvLineage(
  snapshot: DataSnapshotRow,
  run: CollectionRunRow,
  preview: ImportPreviewRow,
): void {
  if (
    snapshot.provider !== CSV_PROVIDER ||
    snapshot.dataset_key !== CSV_DATASET_KEY ||
    snapshot.method_version !== CSV_DATASET_KEY ||
    snapshot.source_connection_id !== null
  ) {
    throw invalidProjection(
      "Competitor Library projection requires the canonical CSV Snapshot.",
    );
  }
  if (
    run.id !== snapshot.collection_run_id ||
    run.workspace_id !== snapshot.workspace_id ||
    run.project_id !== snapshot.project_id ||
    run.site_id !== snapshot.site_id ||
    run.provider !== CSV_PROVIDER ||
    run.operation !== CSV_OPERATION ||
    run.method_version !== CSV_DATASET_KEY ||
    run.source_connection_id !== null ||
    run.import_preview_id === null ||
    run.crawl_seed_site_page_id !== null ||
    run.crawl_seed_url !== null
  ) {
    throw invalidProjection(
      "Canonical CSV Snapshot does not match its CollectionRun lineage.",
    );
  }
  if (
    preview.id !== run.import_preview_id ||
    preview.workspace_id !== snapshot.workspace_id ||
    preview.project_id !== snapshot.project_id ||
    preview.site_id !== snapshot.site_id ||
    preview.template_id !== KEYWORD_GAP_TEMPLATE_ID ||
    preview.status !== "consumed" ||
    preview.consumed_at === null
  ) {
    throw invalidProjection(
      "Canonical CSV CollectionRun does not name its exact consumed ImportPreview.",
    );
  }
}

function assertObservationLineage(
  snapshot: DataSnapshotRow,
  observation: ObservationRow,
): void {
  if (
    observation.snapshot_id !== snapshot.id ||
    observation.workspace_id !== snapshot.workspace_id ||
    observation.project_id !== snapshot.project_id ||
    observation.provider !== CSV_PROVIDER ||
    observation.observed_at !== snapshot.captured_at
  ) {
    throw invalidProjection(
      "Competitor projection Observation does not belong to its canonical CSV Snapshot.",
    );
  }
}

/**
 * Derive one CSV competitor source without adding a name, score, relationship,
 * review decision, or any other fact absent from the canonical Observation.
 */
export function deriveCsvCompetitorOriginInput(
  snapshot: DataSnapshotRow,
  run: CollectionRunRow,
  preview: ImportPreviewRow,
  observation: ObservationRow,
): CsvKeywordGapCompetitorOriginInput | null {
  assertCanonicalCsvLineage(snapshot, run, preview);
  assertObservationLineage(snapshot, observation);
  if (
    observation.metric_key !== METRIC_CSV_KEYWORD_GAP ||
    observation.subject_type !== "keyword_cluster" ||
    observation.origin !== "user_provided" ||
    observation.grade !== "C" ||
    observation.availability !== "available"
  ) {
    return null;
  }
  const valueJson = asRecord(
    observation.value_json,
    "Canonical CSV competitor Observation valueJson",
  );
  if (valueJson["competitorDomain"] === null) return null;
  const domain = canonicalCompetitorDomain(valueJson["competitorDomain"]);
  return {
    originKind: "csv_keyword_gap",
    domain,
    name: null,
    snapshotId: snapshot.id,
    observationId: observation.id,
    importPreviewId: preview.id,
    sourcePointer: COMPETITOR_DOMAIN_POINTER,
  };
}

/**
 * Converge exact CSV competitor origins while the collection completion
 * transaction still owns the canonical Snapshot and Observation writes.
 */
export async function projectCollectionSnapshotCompetitors(
  tx: DbTx,
  scope: ProjectScope,
  snapshot: DataSnapshotRow,
): Promise<number> {
  // The shared keyword metric is also emitted by DataForSEO. Provider identity
  // is therefore the first gate: no vendor, SERP, AI, or GSC Snapshot is ever
  // inspected as a Competitor Library source.
  if (snapshot.provider !== CSV_PROVIDER) return 0;
  if (
    snapshot.workspace_id !== scope.workspaceId ||
    snapshot.project_id !== scope.projectId
  ) {
    throw invalidProjection(
      "Competitor projection Snapshot does not belong to the selected project.",
    );
  }
  if (
    snapshot.dataset_key !== CSV_DATASET_KEY ||
    snapshot.method_version !== CSV_DATASET_KEY
  ) {
    throw invalidProjection(
      "Competitor Library projection requires the canonical CSV Snapshot.",
    );
  }

  const run = await new CollectionRunsRepository(tx).findById(
    snapshot.collection_run_id,
  );
  if (!run?.import_preview_id) {
    throw invalidProjection(
      "Canonical CSV Snapshot is missing its CollectionRun ImportPreview lineage.",
    );
  }
  const preview = await new ImportPreviewsRepository(tx).findById(
    scope,
    run.import_preview_id,
  );
  if (!preview) {
    throw invalidProjection(
      "Canonical CSV CollectionRun is missing its scoped consumed ImportPreview.",
    );
  }
  assertCanonicalCsvLineage(snapshot, run, preview);

  const observations = new ObservationsRepository(tx);
  const competitors = new CompetitorsRepository(tx);
  let cursor: string | null = null;
  let projected = 0;
  let hasMore = true;
  while (hasMore) {
    const page = await observations.listBySnapshotIdsPage(
      scope,
      [snapshot.id],
      { limit: PROJECTION_PAGE_SIZE, cursor },
    );
    for (const observation of page.rows) {
      const input = deriveCsvCompetitorOriginInput(
        snapshot,
        run,
        preview,
        observation,
      );
      if (input) {
        await competitors.upsertOrigin(scope, input);
        projected += 1;
      }
    }
    const nextCursor = page.nextCursor;
    if (nextCursor === null) {
      hasMore = false;
      continue;
    }
    if (nextCursor === cursor) {
      throw invalidProjection(
        "Competitor projection Observation cursor did not advance.",
      );
    }
    cursor = nextCursor;
  }
  return projected;
}
