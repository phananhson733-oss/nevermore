import {
  KeywordOccurrencesRepository,
  ObservationsRepository,
  canonicalUtcTimestamptz,
  normalizeKeywordIdentity,
  type CanonicalKeywordOccurrenceInput,
  type DataSnapshotRow,
  type DbTx,
  type ObservationRow,
  type ProjectScope,
} from "@sf/db";
import {
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
  METRIC_CSV_KEYWORD_GAP,
  METRIC_GSC_PAGE,
  SourceError,
  parseDataForSeoCollectionScope,
  parseDataForSeoSearchLandscapeScope,
  parseDataForSeoSearchLandscapeV2Scope,
  parseDataForSeoSearchLandscapeV3Scope,
} from "@sf/sources";

const CSV_DATASET_KEY = "csv.keyword_gap.v1";
const GSC_DATASET_KEY = "gsc.page_query_daily.v1";
const PROJECTION_PAGE_SIZE = 500;
const MAX_KEYWORD_LENGTH = 500;
const MARKET = /^[A-Z]{2}$/u;

type CanonicalSourceKind =
  | "csv_import"
  | "dataforseo_ranked"
  | "gsc_top_query";

type ProjectionConfiguration =
  | {
      readonly kind: "csv";
      readonly sourceKind: "csv_import";
      readonly scopeBasis: "user_provided";
    }
  | {
      readonly kind: "dataforseo";
      readonly sourceKind: "dataforseo_ranked";
      readonly scopeBasis: "provider_collection_scope";
      readonly market: string;
      readonly languageTag: string;
    }
  | {
      readonly kind: "gsc";
      readonly sourceKind: "gsc_top_query";
      readonly scopeBasis: "project_context";
      readonly market: string;
      readonly languageTag: string;
    };

function invalidProjection(message: string): SourceError {
  return new SourceError("INVALID_RESPONSE", message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidProjection(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function canonicalMarket(value: unknown, label: string): string {
  if (typeof value !== "string" || !MARKET.test(value)) {
    throw invalidProjection(`${label} must be an uppercase ISO alpha-2 code.`);
  }
  return value;
}

function canonicalLanguageTag(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value) {
    throw invalidProjection(`${label} must be a canonical BCP-47 tag.`);
  }
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    if (!canonical) throw new Error("missing language tag");
    return canonical;
  } catch {
    throw invalidProjection(`${label} must be a canonical BCP-47 tag.`);
  }
}

function keyword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > MAX_KEYWORD_LENGTH
  ) {
    throw invalidProjection(
      "Canonical keyword Observation contains an invalid keyword.",
    );
  }
  return value;
}

function optionalInstant(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw invalidProjection(`${label} must be a canonical provider timestamp.`);
  }
  try {
    return canonicalUtcTimestamptz(value);
  } catch {
    throw invalidProjection(`${label} must be a canonical provider timestamp.`);
  }
}

function providerDataAsOf(
  summary: Record<string, unknown>,
  valueJson: Record<string, unknown>,
): string | null {
  const timingValue = summary["timing"];
  const snapshotTimestamp =
    timingValue === undefined || timingValue === null
      ? null
      : optionalInstant(
          asRecord(timingValue, "Snapshot timing"),
          "dataAsOf",
          "Snapshot timing.dataAsOf",
        );
  const observationTimestamp = optionalInstant(
    valueJson,
    "providerDataAsOf",
    "Observation providerDataAsOf",
  );
  if (
    snapshotTimestamp !== null &&
    observationTimestamp !== null &&
    snapshotTimestamp !== observationTimestamp
  ) {
    throw invalidProjection(
      "Canonical keyword provider timestamps contradict each other.",
    );
  }
  return observationTimestamp ?? snapshotTimestamp;
}

function gscContext(
  summary: Record<string, unknown>,
): Pick<
  Extract<ProjectionConfiguration, { kind: "gsc" }>,
  "market" | "languageTag"
> | null {
  if (!Object.hasOwn(summary, "keywordLibraryContext")) return null;
  const context = asRecord(
    summary["keywordLibraryContext"],
    "Snapshot keywordLibraryContext",
  );
  const keys = Object.keys(context);
  if (
    keys.length !== 3 ||
    !keys.includes("basis") ||
    !keys.includes("marketCode") ||
    !keys.includes("languageTag") ||
    context["basis"] !== "project_context"
  ) {
    throw invalidProjection(
      "Snapshot keywordLibraryContext is invalid or not project_context.",
    );
  }
  return {
    market: canonicalMarket(
      context["marketCode"],
      "Snapshot keywordLibraryContext.marketCode",
    ),
    languageTag: canonicalLanguageTag(
      context["languageTag"],
      "Snapshot keywordLibraryContext.languageTag",
    ),
  };
}

function projectionConfiguration(
  snapshot: DataSnapshotRow,
): ProjectionConfiguration | null {
  if (snapshot.provider === "csv") {
    if (snapshot.dataset_key !== CSV_DATASET_KEY) {
      throw invalidProjection(
        "CSV Keyword Library projection requires the canonical Snapshot dataset.",
      );
    }
    return {
      kind: "csv",
      sourceKind: "csv_import",
      scopeBasis: "user_provided",
    };
  }
  if (snapshot.provider === "dataforseo") {
    const isLegacyRankedKeywords =
      snapshot.dataset_key === DATAFORSEO_DATASET_KEY &&
      snapshot.schema_version === DATAFORSEO_METHOD_VERSION &&
      snapshot.method_version === DATAFORSEO_METHOD_VERSION;
    const isSearchLandscapeV1 =
      snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY &&
      snapshot.schema_version ===
        DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION &&
      snapshot.method_version ===
        DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION;
    const isSearchLandscapeV2 =
      snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY &&
      snapshot.schema_version ===
        DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION &&
      snapshot.method_version ===
        DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION;
    const isSearchLandscapeV3 =
      snapshot.dataset_key === DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY &&
      snapshot.schema_version ===
        DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION &&
      snapshot.method_version ===
        DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION;
    if (
      !isLegacyRankedKeywords &&
      !isSearchLandscapeV1 &&
      !isSearchLandscapeV2 &&
      !isSearchLandscapeV3
    ) {
      throw invalidProjection(
        "DataForSEO Keyword Library projection requires an exact ranked-keywords or search-landscape Snapshot dataset/method identity.",
      );
    }
    let scope;
    try {
      scope = isSearchLandscapeV3
        ? parseDataForSeoSearchLandscapeV3Scope(
            snapshot.summary["collectionScope"],
          )
        : isSearchLandscapeV2
          ? parseDataForSeoSearchLandscapeV2Scope(
            snapshot.summary["collectionScope"],
          )
        : isSearchLandscapeV1
          ? parseDataForSeoSearchLandscapeScope(
              snapshot.summary["collectionScope"],
            )
        : parseDataForSeoCollectionScope(
            snapshot.summary["collectionScope"],
          );
    } catch {
      throw invalidProjection(
        "DataForSEO Keyword Library projection requires a frozen provider collection scope.",
      );
    }
    return {
      kind: "dataforseo",
      sourceKind: "dataforseo_ranked",
      scopeBasis: "provider_collection_scope",
      market: scope.marketCode,
      languageTag: scope.languageTag,
    };
  }
  if (snapshot.provider === "gsc") {
    if (snapshot.dataset_key !== GSC_DATASET_KEY) {
      throw invalidProjection(
        "GSC Keyword Library projection requires the canonical Snapshot dataset.",
      );
    }
    const context = gscContext(snapshot.summary);
    return context
      ? {
          kind: "gsc",
          sourceKind: "gsc_top_query",
          scopeBasis: "project_context",
          ...context,
        }
      : null;
  }
  return null;
}

function assertObservationLineage(
  snapshot: DataSnapshotRow,
  observation: ObservationRow,
): void {
  if (
    observation.snapshot_id !== snapshot.id ||
    observation.workspace_id !== snapshot.workspace_id ||
    observation.project_id !== snapshot.project_id ||
    observation.provider !== snapshot.provider
  ) {
    throw invalidProjection(
      "Keyword projection Observation does not belong to its canonical Snapshot.",
    );
  }
}

function commonInput(
  snapshot: DataSnapshotRow,
  observation: ObservationRow,
  valueJson: Record<string, unknown>,
  displayKeyword: string,
  sourceKind: CanonicalSourceKind,
  scopeBasis:
    | "user_provided"
    | "provider_collection_scope"
    | "project_context",
  sourcePointer: `/valueJson/${string}`,
  market: string,
  languageTag: string,
): CanonicalKeywordOccurrenceInput {
  return {
    manualEntryId: null,
    dataSnapshotId: snapshot.id,
    normalizedObservationId: observation.id,
    displayKeyword,
    normalizedKeyword: normalizeKeywordIdentity(displayKeyword),
    market,
    languageTag,
    queryKind: "search_query",
    sourceKind,
    scopeBasis,
    sourcePointer,
    sourceRef: `observation:${observation.id}#${sourcePointer}`,
    collectedAt: observation.observed_at,
    providerDataAsOf: providerDataAsOf(snapshot.summary, valueJson),
  } as CanonicalKeywordOccurrenceInput;
}

function deriveWithConfiguration(
  snapshot: DataSnapshotRow,
  observation: ObservationRow,
  configuration: ProjectionConfiguration,
): CanonicalKeywordOccurrenceInput[] {
  assertObservationLineage(snapshot, observation);
  const expectedMetric =
    configuration.kind === "gsc"
      ? METRIC_GSC_PAGE
      : METRIC_CSV_KEYWORD_GAP;
  if (observation.metric_key !== expectedMetric) return [];
  if (observation.availability !== "available") return [];
  const valueJson = asRecord(
    observation.value_json,
    "Canonical keyword Observation valueJson",
  );

  if (configuration.kind === "gsc") {
    const topQueries = valueJson["topQueries"];
    if (!Array.isArray(topQueries) || topQueries.length > 10) {
      throw invalidProjection(
        "Canonical GSC Observation contains invalid topQueries.",
      );
    }
    return topQueries.map((value, index) => {
      const query = keyword(
        asRecord(value, `GSC topQueries[${index}]`)["query"],
      );
      return commonInput(
        snapshot,
        observation,
        valueJson,
        query,
        configuration.sourceKind,
        configuration.scopeBasis,
        `/valueJson/topQueries/${index}/query`,
        configuration.market,
        configuration.languageTag,
      );
    });
  }

  const displayKeyword = keyword(valueJson["keyword"]);
  const market =
    configuration.kind === "dataforseo"
      ? configuration.market
      : canonicalMarket(valueJson["marketCode"], "CSV Observation marketCode");
  const languageTag =
    configuration.kind === "dataforseo"
      ? configuration.languageTag
      : canonicalLanguageTag(
          valueJson["languageCode"],
          "CSV Observation languageCode",
        );
  return [
    commonInput(
      snapshot,
      observation,
      valueJson,
      displayKeyword,
      configuration.sourceKind,
      configuration.scopeBasis,
      "/valueJson/keyword",
      market,
      languageTag,
    ),
  ];
}

/** Derive immutable occurrence inputs only from canonical persisted lineage. */
export function deriveKeywordOccurrenceInputs(
  snapshot: DataSnapshotRow,
  observation: ObservationRow,
): CanonicalKeywordOccurrenceInput[] {
  const configuration = projectionConfiguration(snapshot);
  return configuration
    ? deriveWithConfiguration(snapshot, observation, configuration)
    : [];
}

/**
 * Page through the just-persisted Observations and converge occurrences,
 * stable entities and source membership through the database's atomic upsert.
 */
export async function projectCollectionSnapshotKeywords(
  tx: DbTx,
  scope: ProjectScope,
  snapshot: DataSnapshotRow,
): Promise<number> {
  const configuration = projectionConfiguration(snapshot);
  if (!configuration) return 0;

  const observations = new ObservationsRepository(tx);
  const keywords = new KeywordOccurrencesRepository(tx);
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
      for (const input of deriveWithConfiguration(
        snapshot,
        observation,
        configuration,
      )) {
        await keywords.upsertIntoLibrary(scope, input);
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
        "Keyword projection Observation cursor did not advance.",
      );
    }
    cursor = nextCursor;
  }
  return projected;
}
