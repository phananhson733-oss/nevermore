import { createHash } from "node:crypto";
import {
  CollectionRunsRepository,
  CompetitorsRepository,
  contentHash,
  ImportPreviewsRepository,
  ObservationsRepository,
  SourceConnectionsRepository,
  type CollectionRunRow,
  type CanonicalValue,
  type CompetitorOriginInput,
  type CsvKeywordGapCompetitorOriginInput,
  type DataSnapshotRow,
  type DbTx,
  type ImportPreviewRow,
  type ObservationRow,
  type ProjectScope,
} from "@sf/db";
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
  KEYWORD_GAP_TEMPLATE_ID,
  METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
  METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2,
  METRIC_DATAFORSEO_COMPETITOR_AI_CITATION,
  METRIC_DATAFORSEO_SERP_COMPETITOR,
  METRIC_CSV_KEYWORD_GAP,
  SourceError,
  parseDataForSeoSearchLandscapeScope,
  parseDataForSeoSearchLandscapeV2Scope,
  parseDataForSeoSearchLandscapeV3Scope,
  dataForSeoOrganicOverlapRatio,
  type DataForSeoSearchLandscapeScope,
  type DataForSeoSearchLandscapeV2Scope,
  type DataForSeoSearchLandscapeV3Scope,
} from "@sf/sources";

const CSV_PROVIDER = "csv";
const CSV_OPERATION = "keyword_gap_import";
const CSV_DATASET_KEY = "csv.keyword_gap.v1";
const DATAFORSEO_PROVIDER = "dataforseo";
const PROJECTION_PAGE_SIZE = 500;
const COMPETITOR_DOMAIN_POINTER = "/valueJson/competitorDomain" as const;
const NORMALIZED_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const CONTENT_HASH = /^[a-f0-9]{64}$/u;

function invalidProjection(message: string): SourceError {
  return new SourceError("INVALID_RESPONSE", message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidProjection(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw invalidProjection(`${label} is not exact.`);
  }
}

function canonicalCompetitorDomain(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value !== value.toLowerCase() ||
    !NORMALIZED_DOMAIN.test(value)
  ) {
    throw invalidProjection(
      "Canonical competitor Observation contains an invalid domain.",
    );
  }
  return value;
}

type SerpOverlapCompetitorOriginInput = Extract<
  CompetitorOriginInput,
  { readonly originKind: "serp_overlap" }
>;
type AiCitationCompetitorOriginInput = Extract<
  CompetitorOriginInput,
  { readonly originKind: "ai_citation" }
>;

function canonicalNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalidProjection(`${label} must be a non-negative number.`);
  }
  return value;
}

function canonicalPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidProjection(`${label} must be a positive integer.`);
  }
  return value as number;
}

function canonicalNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidProjection(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function assertCanonicalCsvLineage(
  snapshot: DataSnapshotRow,
  run: CollectionRunRow,
  preview: ImportPreviewRow,
): void {
  if (
    snapshot.provider !== CSV_PROVIDER ||
    snapshot.dataset_key !== CSV_DATASET_KEY ||
    snapshot.method_version !== CSV_DATASET_KEY
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
    run.source_connection_id !== snapshot.source_connection_id ||
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

function dataForSeoCollectionScope(
  snapshot: DataSnapshotRow,
):
  | DataForSeoSearchLandscapeScope
  | DataForSeoSearchLandscapeV2Scope
  | DataForSeoSearchLandscapeV3Scope {
  const isV1 =
    snapshot.provider === DATAFORSEO_PROVIDER &&
    snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY &&
    snapshot.schema_version === DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION &&
    snapshot.method_version === DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION;
  const isV2 =
    snapshot.provider === DATAFORSEO_PROVIDER &&
    snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY &&
    snapshot.schema_version === DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION &&
    snapshot.method_version === DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION;
  const isV3 =
    snapshot.provider === DATAFORSEO_PROVIDER &&
    snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY &&
    snapshot.schema_version === DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION &&
    snapshot.method_version === DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION;
  if ((!isV1 && !isV2 && !isV3) || snapshot.source_connection_id === null) {
    throw invalidProjection(
      "SERP overlap projection requires the exact DataForSEO search-landscape Snapshot identity.",
    );
  }
  try {
    return isV3
      ? parseDataForSeoSearchLandscapeV3Scope(
          snapshot.summary["collectionScope"],
        )
      : isV2
      ? parseDataForSeoSearchLandscapeV2Scope(
          snapshot.summary["collectionScope"],
        )
      : parseDataForSeoSearchLandscapeScope(
          snapshot.summary["collectionScope"],
        );
  } catch {
    throw invalidProjection(
      "SERP overlap projection requires its frozen DataForSEO search-landscape scope.",
    );
  }
}

function assertCanonicalDataForSeoLineage(
  snapshot: DataSnapshotRow,
  run: CollectionRunRow,
  connection: Awaited<
    ReturnType<SourceConnectionsRepository["findById"]>
  >,
  collectionScope:
    | DataForSeoSearchLandscapeScope
    | DataForSeoSearchLandscapeV2Scope
    | DataForSeoSearchLandscapeV3Scope,
): void {
  if (
    run.id !== snapshot.collection_run_id ||
    run.workspace_id !== snapshot.workspace_id ||
    run.project_id !== snapshot.project_id ||
    run.site_id !== snapshot.site_id ||
    run.provider !== DATAFORSEO_PROVIDER ||
    run.operation !== DATAFORSEO_SEARCH_LANDSCAPE_OPERATION ||
    run.method_version !== snapshot.method_version ||
    run.source_connection_id !== snapshot.source_connection_id ||
    run.import_preview_id !== null ||
    run.crawl_seed_site_page_id !== null ||
    run.crawl_seed_url !== null ||
    run.parameters_hash !==
      contentHash({
        provider: DATAFORSEO_PROVIDER,
        operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
        siteId: snapshot.site_id,
        collectionScope: collectionScope as unknown as CanonicalValue,
      } as CanonicalValue)
  ) {
    throw invalidProjection(
      "Canonical DataForSEO search-landscape Snapshot does not match its CollectionRun lineage.",
    );
  }
  if (
    !connection ||
    connection.id !== snapshot.source_connection_id ||
    connection.workspace_id !== snapshot.workspace_id ||
    connection.project_id !== snapshot.project_id ||
    connection.site_id !== snapshot.site_id ||
    connection.provider !== DATAFORSEO_PROVIDER
  ) {
    throw invalidProjection(
      "Canonical DataForSEO search-landscape Snapshot does not match its exact source connection.",
    );
  }
}

/**
 * Derive one immutable SERP-overlap origin. The projection deliberately keeps
 * the provider's integer intersections as Observation evidence only; it never
 * invents a competitor name, relationship, review status, or analysis scope.
 */
export function deriveSerpOverlapCompetitorOriginInput(
  snapshot: DataSnapshotRow,
  run: CollectionRunRow,
  observation: ObservationRow,
): SerpOverlapCompetitorOriginInput | null {
  const collectionScope = dataForSeoCollectionScope(snapshot);
  if (
    run.id !== snapshot.collection_run_id ||
    run.workspace_id !== snapshot.workspace_id ||
    run.project_id !== snapshot.project_id ||
    run.site_id !== snapshot.site_id ||
    run.provider !== DATAFORSEO_PROVIDER ||
    run.operation !== DATAFORSEO_SEARCH_LANDSCAPE_OPERATION ||
    run.method_version !== snapshot.method_version ||
    run.source_connection_id !== snapshot.source_connection_id ||
    run.import_preview_id !== null ||
    run.crawl_seed_site_page_id !== null ||
    run.crawl_seed_url !== null ||
    run.parameters_hash !==
      contentHash({
        provider: DATAFORSEO_PROVIDER,
        operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
        siteId: snapshot.site_id,
        collectionScope: collectionScope as unknown as CanonicalValue,
      } as CanonicalValue)
  ) {
    throw invalidProjection(
      "Canonical DataForSEO search-landscape Snapshot does not match its CollectionRun lineage.",
    );
  }
  if (
    observation.snapshot_id !== snapshot.id ||
    observation.workspace_id !== snapshot.workspace_id ||
    observation.project_id !== snapshot.project_id ||
    observation.provider !== DATAFORSEO_PROVIDER ||
    observation.observed_at !== snapshot.captured_at
  ) {
    throw invalidProjection(
      "SERP overlap Observation does not belong to its canonical DataForSEO Snapshot.",
    );
  }
  if (
    observation.metric_key !== METRIC_DATAFORSEO_COMPETITOR_DOMAIN &&
    observation.metric_key !== METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2 &&
    observation.metric_key !== METRIC_DATAFORSEO_SERP_COMPETITOR
  ) {
    return null;
  }
  if (
    observation.subject_type !== "site" ||
    observation.site_page_id !== null ||
    observation.origin !== "vendor_observation" ||
    observation.grade !== "B" ||
    observation.support !== "supports" ||
    observation.availability !== "available" ||
    observation.value_numeric !== null ||
    observation.value_text !== null ||
    observation.unit !== null
  ) {
    throw invalidProjection(
      "Canonical DataForSEO competitor-domain Observation trust or value shape is invalid.",
    );
  }
  const valueJson = asRecord(
    observation.value_json,
    "Canonical DataForSEO competitor-domain Observation valueJson",
  );
  const expectedKeys =
    observation.metric_key === METRIC_DATAFORSEO_COMPETITOR_DOMAIN
      ? ([
          "targetDomain",
          "competitorDomain",
          "intersections",
          "averagePosition",
          "summedPosition",
          "organicEstimatedTrafficVolume",
          "marketCode",
          "languageCode",
        ] as const)
      : observation.metric_key === METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2
        ? ([
            "targetDomain",
            "competitorDomain",
            "intersections",
            "targetOrganicKeywordCount",
            "serpOverlap",
            "averagePosition",
            "summedPosition",
            "organicEstimatedTrafficVolume",
            "marketCode",
            "languageCode",
          ] as const)
        : ([
          "targetDomain",
          "competitorDomain",
          "averagePosition",
          "medianPosition",
          "rating",
          "organicEstimatedTrafficVolume",
          "keywordsCount",
          "visibility",
          "relevantSerpItems",
          "seedCount",
          "marketCode",
          "languageCode",
        ] as const);
  if (
    Object.keys(valueJson).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(valueJson, key))
  ) {
    throw invalidProjection(
      "Canonical DataForSEO competitor-domain Observation valueJson is not exact.",
    );
  }
  const targetDomain = canonicalCompetitorDomain(valueJson["targetDomain"]);
  const domain = canonicalCompetitorDomain(valueJson["competitorDomain"]);
  canonicalNonNegativeNumber(
    valueJson["averagePosition"],
    "DataForSEO averagePosition",
  );
  canonicalNonNegativeNumber(
    valueJson["organicEstimatedTrafficVolume"],
    "DataForSEO organicEstimatedTrafficVolume",
  );
  if (
    observation.metric_key === METRIC_DATAFORSEO_COMPETITOR_DOMAIN ||
    observation.metric_key === METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2
  ) {
    canonicalPositiveInteger(
      valueJson["intersections"],
      "DataForSEO intersections",
    );
    canonicalNonNegativeNumber(
      valueJson["summedPosition"],
      "DataForSEO summedPosition",
    );
    if (observation.metric_key === METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2) {
      const targetOrganicKeywordCount = canonicalPositiveInteger(
        valueJson["targetOrganicKeywordCount"],
        "DataForSEO targetOrganicKeywordCount",
      );
      const serpOverlap = canonicalNonNegativeNumber(
        valueJson["serpOverlap"],
        "DataForSEO serpOverlap",
      );
      if (
        serpOverlap !==
        dataForSeoOrganicOverlapRatio(
          valueJson["intersections"] as number,
          targetOrganicKeywordCount,
        )
      ) {
        throw invalidProjection(
          "Canonical DataForSEO organic-overlap Observation contains a contradictory ratio.",
        );
      }
    }
  } else {
    canonicalNonNegativeNumber(
      valueJson["medianPosition"],
      "DataForSEO medianPosition",
    );
    canonicalNonNegativeNumber(valueJson["rating"], "DataForSEO rating");
    canonicalNonNegativeInteger(
      valueJson["keywordsCount"],
      "DataForSEO keywordsCount",
    );
    canonicalNonNegativeNumber(
      valueJson["visibility"],
      "DataForSEO visibility",
    );
    canonicalNonNegativeInteger(
      valueJson["relevantSerpItems"],
      "DataForSEO relevantSerpItems",
    );
    canonicalPositiveInteger(valueJson["seedCount"], "DataForSEO seedCount");
  }
  if (
    targetDomain !== collectionScope.target ||
    domain === targetDomain ||
    observation.subject_ref !== domain ||
    valueJson["marketCode"] !== collectionScope.marketCode ||
    valueJson["languageCode"] !== collectionScope.providerLanguageCode
  ) {
    throw invalidProjection(
      "Canonical DataForSEO competitor-domain Observation contradicts its frozen scope.",
    );
  }
  if (
    observation.metric_key === METRIC_DATAFORSEO_SERP_COMPETITOR &&
    (!("serpCompetitors" in collectionScope) ||
      valueJson["seedCount"] !==
        collectionScope.serpCompetitors.seeds.length)
  ) {
    throw invalidProjection(
      "Canonical DataForSEO SERP-competitor Observation contradicts its frozen seed scope.",
    );
  }
  return {
    originKind: "serp_overlap",
    domain,
    name: null,
    snapshotId: snapshot.id,
    observationId: observation.id,
    sourcePointer: COMPETITOR_DOMAIN_POINTER,
  };
}

/** Derive an observed v3 AI-citation aggregate without treating absence as zero. */
export function deriveAiCitationCompetitorOriginInput(
  snapshot: DataSnapshotRow,
  run: CollectionRunRow,
  observation: ObservationRow,
): AiCitationCompetitorOriginInput | null {
  const collectionScope = dataForSeoCollectionScope(snapshot);
  if (
    collectionScope.schemaVersion !==
      "dataforseo.search-landscape-scope.v3" ||
    run.id !== snapshot.collection_run_id ||
    run.workspace_id !== snapshot.workspace_id ||
    run.project_id !== snapshot.project_id ||
    run.site_id !== snapshot.site_id ||
    run.provider !== DATAFORSEO_PROVIDER ||
    run.operation !== DATAFORSEO_SEARCH_LANDSCAPE_OPERATION ||
    run.method_version !== DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION ||
    run.source_connection_id !== snapshot.source_connection_id ||
    run.import_preview_id !== null ||
    run.crawl_seed_site_page_id !== null ||
    run.crawl_seed_url !== null ||
    run.parameters_hash !==
      contentHash({
        provider: DATAFORSEO_PROVIDER,
        operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
        siteId: snapshot.site_id,
        collectionScope: collectionScope as unknown as CanonicalValue,
      } as CanonicalValue)
  ) {
    throw invalidProjection(
      "Canonical DataForSEO AI-citation Snapshot does not match its CollectionRun lineage.",
    );
  }
  if (
    observation.snapshot_id !== snapshot.id ||
    observation.workspace_id !== snapshot.workspace_id ||
    observation.project_id !== snapshot.project_id ||
    observation.provider !== DATAFORSEO_PROVIDER ||
    observation.observed_at !== snapshot.captured_at
  ) {
    throw invalidProjection(
      "AI-citation Observation does not belong to its canonical DataForSEO Snapshot.",
    );
  }
  if (observation.metric_key !== METRIC_DATAFORSEO_COMPETITOR_AI_CITATION) {
    return null;
  }
  const hasCanonicalTrust =
    observation.subject_type === "site" &&
    observation.site_page_id === null &&
    observation.origin === "vendor_observation" &&
    observation.grade === "B" &&
    observation.support === "supports" &&
    observation.value_numeric === null &&
    observation.value_text === null &&
    observation.unit === null;
  if (!hasCanonicalTrust) {
    throw invalidProjection(
      "Canonical DataForSEO AI-citation Observation trust or value shape is invalid.",
    );
  }
  if (observation.availability === "unavailable") return null;
  if (observation.availability !== "available") {
    throw invalidProjection(
      "Canonical DataForSEO AI-citation Observation availability is invalid.",
    );
  }
  const valueJson = asRecord(
    observation.value_json,
    "Canonical DataForSEO AI-citation Observation valueJson",
  );
  assertExactKeys(
    valueJson,
    [
      "targetDomain",
      "competitorDomain",
      "attemptedQueries",
      "observedQueries",
      "citedQueries",
      "unavailableQueries",
      "cohortCoverage",
      "querySetHash",
      "platform",
      "model",
      "marketCode",
      "languageTag",
      "queryOutcomes",
    ],
    "Canonical DataForSEO AI-citation Observation valueJson",
  );
  const targetDomain = canonicalCompetitorDomain(valueJson["targetDomain"]);
  const domain = canonicalCompetitorDomain(valueJson["competitorDomain"]);
  const attemptedQueries = canonicalNonNegativeInteger(
    valueJson["attemptedQueries"],
    "DataForSEO attemptedQueries",
  );
  const observedQueries = canonicalNonNegativeInteger(
    valueJson["observedQueries"],
    "DataForSEO observedQueries",
  );
  const citedQueries = canonicalNonNegativeInteger(
    valueJson["citedQueries"],
    "DataForSEO citedQueries",
  );
  const unavailableQueries = canonicalNonNegativeInteger(
    valueJson["unavailableQueries"],
    "DataForSEO unavailableQueries",
  );
  if (
    collectionScope.aiCitations.state !== "enabled" ||
    targetDomain !== collectionScope.target ||
    domain === targetDomain ||
    observation.subject_ref !== domain ||
    attemptedQueries !== 20 ||
    observedQueries + unavailableQueries !== attemptedQueries ||
    citedQueries > observedQueries ||
    valueJson["cohortCoverage"] !==
      (unavailableQueries === 0 ? "complete" : "partial") ||
    valueJson["querySetHash"] !== collectionScope.aiCitations.querySetHash ||
    typeof valueJson["querySetHash"] !== "string" ||
    !CONTENT_HASH.test(valueJson["querySetHash"]) ||
    valueJson["platform"] !== "chat_gpt" ||
    valueJson["model"] !== collectionScope.aiCitations.requestedModel ||
    valueJson["marketCode"] !== collectionScope.marketCode ||
    valueJson["languageTag"] !== collectionScope.languageTag
  ) {
    throw invalidProjection(
      "Canonical DataForSEO AI-citation Observation contradicts its frozen scope.",
    );
  }
  if (!Array.isArray(valueJson["queryOutcomes"])) {
    throw invalidProjection(
      "Canonical DataForSEO AI-citation queryOutcomes is invalid.",
    );
  }
  const queryOutcomes = valueJson["queryOutcomes"];
  if (queryOutcomes.length !== collectionScope.aiCitations.queries.length) {
    throw invalidProjection(
      "Canonical DataForSEO AI-citation queryOutcomes is incomplete.",
    );
  }
  let observedOutcomeCount = 0;
  let citedOutcomeCount = 0;
  const queryHashes = new Set<string>();
  for (const [index, value] of queryOutcomes.entries()) {
    const outcome = asRecord(value, `DataForSEO AI query outcome ${index}`);
    assertExactKeys(
      outcome,
      [
        "queryEntityId",
        "queryRevision",
        "queryHash",
        "availability",
        "cited",
      ],
      `DataForSEO AI query outcome ${index}`,
    );
    const query = collectionScope.aiCitations.queries[index];
    const available = outcome["availability"] === "available";
    const expectedQueryHash = query
      ? createHash("sha256").update(query.normalizedQuery).digest("hex")
      : null;
    if (
      !query ||
      outcome["queryEntityId"] !== query.entityId ||
      outcome["queryRevision"] !== query.revision ||
      typeof outcome["queryHash"] !== "string" ||
      !CONTENT_HASH.test(outcome["queryHash"]) ||
      outcome["queryHash"] !== expectedQueryHash ||
      queryHashes.has(outcome["queryHash"]) ||
      (outcome["availability"] !== "available" &&
        outcome["availability"] !== "unavailable") ||
      typeof outcome["cited"] !== "boolean" ||
      (!available && outcome["cited"])
    ) {
      throw invalidProjection(
        "Canonical DataForSEO AI-citation query outcome contradicts its frozen cohort.",
      );
    }
    queryHashes.add(outcome["queryHash"]);
    if (available) observedOutcomeCount += 1;
    if (outcome["cited"]) citedOutcomeCount += 1;
  }
  if (
    observedOutcomeCount !== observedQueries ||
    citedOutcomeCount !== citedQueries
  ) {
    throw invalidProjection(
      "Canonical DataForSEO AI-citation aggregate contradicts its query outcomes.",
    );
  }
  if (observedQueries === 0) return null;
  return {
    originKind: "ai_citation",
    domain,
    name: null,
    snapshotId: snapshot.id,
    observationId: observation.id,
    sourcePointer: COMPETITOR_DOMAIN_POINTER,
  };
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
  if (
    snapshot.provider !== CSV_PROVIDER &&
    snapshot.provider !== DATAFORSEO_PROVIDER
  ) {
    return 0;
  }
  // Historical ranked-keyword collections never carried competitor-domain
  // observations. Preserve that exact flow without interpreting its shared
  // csv.keyword_gap metric as a competitor origin.
  if (
    snapshot.provider === DATAFORSEO_PROVIDER &&
    snapshot.dataset_key === DATAFORSEO_DATASET_KEY &&
    snapshot.schema_version === DATAFORSEO_METHOD_VERSION &&
    snapshot.method_version === DATAFORSEO_METHOD_VERSION
  ) {
    return 0;
  }
  if (
    snapshot.workspace_id !== scope.workspaceId ||
    snapshot.project_id !== scope.projectId
  ) {
    throw invalidProjection(
      "Competitor projection Snapshot does not belong to the selected project.",
    );
  }
  const collectionScope =
    snapshot.provider === DATAFORSEO_PROVIDER
      ? dataForSeoCollectionScope(snapshot)
      : null;
  if (
    snapshot.provider === CSV_PROVIDER &&
    (snapshot.dataset_key !== CSV_DATASET_KEY ||
      snapshot.method_version !== CSV_DATASET_KEY)
  ) {
    throw invalidProjection(
      "Competitor Library projection requires the canonical CSV Snapshot.",
    );
  }

  const run = await new CollectionRunsRepository(tx).findById(
    snapshot.collection_run_id,
  );
  if (!run) {
    throw invalidProjection(
      "Canonical competitor Snapshot is missing its CollectionRun lineage.",
    );
  }

  if (collectionScope !== null) {
    const connection = await new SourceConnectionsRepository(tx).findById(
      scope,
      snapshot.source_connection_id!,
    );
    assertCanonicalDataForSeoLineage(
      snapshot,
      run,
      connection,
      collectionScope,
    );
  } else if (!run.import_preview_id) {
    throw invalidProjection(
      "Canonical CSV Snapshot is missing its CollectionRun ImportPreview lineage.",
    );
  }
  const preview =
    collectionScope === null
      ? await new ImportPreviewsRepository(tx).findById(
          scope,
          run.import_preview_id!,
        )
      : null;
  if (collectionScope === null && !preview) {
    throw invalidProjection(
      "Canonical CSV CollectionRun is missing its scoped consumed ImportPreview.",
    );
  }
  if (collectionScope === null) {
    assertCanonicalCsvLineage(snapshot, run, preview!);
  }

  if (collectionScope === null && snapshot.source_connection_id !== null) {
    const connection = await new SourceConnectionsRepository(tx).findById(
      scope,
      snapshot.source_connection_id,
    );
    if (
      !connection ||
      connection.id !== snapshot.source_connection_id ||
      connection.workspace_id !== snapshot.workspace_id ||
      connection.project_id !== snapshot.project_id ||
      connection.site_id !== snapshot.site_id ||
      connection.provider !== CSV_PROVIDER
    ) {
      throw invalidProjection(
        "Canonical CSV Snapshot does not match its exact source connection.",
      );
    }
  }

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
    const inputs: CompetitorOriginInput[] = [];
    for (const observation of page.rows) {
      const input =
        collectionScope === null
          ? deriveCsvCompetitorOriginInput(
              snapshot,
              run,
              preview!,
              observation,
            )
          : observation.metric_key ===
              METRIC_DATAFORSEO_COMPETITOR_AI_CITATION
            ? deriveAiCitationCompetitorOriginInput(
                snapshot,
                run,
                observation,
              )
            : deriveSerpOverlapCompetitorOriginInput(
                snapshot,
                run,
                observation,
              );
      if (input) {
        inputs.push(input);
      }
    }
    if (inputs.length > 0) {
      const results = await competitors.upsertOrigins(scope, inputs);
      projected += results.length;
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
