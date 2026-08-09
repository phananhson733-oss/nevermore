import { sql } from "drizzle-orm";
import { canonicalUtcTimestamptz } from "../instant.ts";
import {
  clientProjects,
  collectionRuns,
  dataSnapshots,
  keywordEntities,
  keywordEntitySources,
  keywordOccurrences,
  normalizedObservations,
  publicationAttempts,
  publicationReceipts,
  sitePages,
} from "../schema.ts";
import {
  Repository,
  type ProjectScope,
} from "./base.ts";
import { normalizeKeywordIdentity } from "./keyword-occurrences.ts";

export type KeywordRankMetric =
  | "absolute_rank"
  | "gsc_28d_average_position";

export interface KeywordRankObservationFact {
  readonly occurrenceId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly provider: "dataforseo" | "gsc";
  readonly metric: KeywordRankMetric;
  readonly value: number;
  readonly valuePointer: string;
  readonly observedAt: string;
  readonly providerDataAsOf: string | null;
  readonly grade: "A" | "B";
  readonly limitation: string;
}

export interface KeywordContentChangeFact {
  readonly changeReceiptId: string;
  readonly publicationAttemptId: string;
  readonly attemptKind: "publish" | "rollback";
  readonly artifactId: string;
  readonly artifactRevision: number;
  readonly targetRef: string;
  readonly liveCanonicalUrl: string;
  readonly changedAt: string;
}

export type KeywordRankHistoryIntegrityCode =
  | "INVALID_WINDOW"
  | "HISTORY_LIMIT_EXCEEDED"
  | "OBSERVATION_LINEAGE_INVALID"
  | "OBSERVATION_VALUE_INVALID"
  | "OBSERVATION_IDENTITY_DUPLICATE"
  | "SITE_PAGE_LINEAGE_INVALID"
  | "CHANGE_MARKER_LIMIT_EXCEEDED"
  | "CHANGE_MARKER_LINEAGE_INVALID";

export class KeywordRankHistoryIntegrityError extends Error {
  override readonly name = "KeywordRankHistoryIntegrityError";

  constructor(readonly code: KeywordRankHistoryIntegrityCode) {
    super(`Keyword rank history failed integrity validation: ${code}`);
  }
}

interface ObservationQueryRow extends Record<string, unknown> {
  readonly occurrence_id: string;
  readonly snapshot_id: string;
  readonly observation_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly normalized_keyword: string;
  readonly occurrence_normalized_keyword: string;
  readonly source_kind: string;
  readonly source_pointer: string | null;
  readonly provider_data_as_of: string | null;
  readonly snapshot_provider: string;
  readonly dataset_key: string;
  readonly snapshot_schema_version: string;
  readonly snapshot_method_version: string;
  readonly collection_provider: string;
  readonly collection_operation: string;
  readonly collection_method_version: string;
  readonly snapshot_availability: string;
  readonly provider: string;
  readonly metric_key: string;
  readonly observed_at: string;
  readonly availability: string;
  readonly value_json: unknown;
  readonly grade: string;
  readonly limitation: string;
}

interface ChangeQueryRow extends Record<string, unknown> {
  readonly change_receipt_id: string;
  readonly publication_attempt_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly attempt_kind: string;
  readonly artifact_id: string;
  readonly artifact_revision: number;
  readonly target_ref: string;
  readonly live_canonical_url: string | null;
  readonly verification_state: string;
  readonly limitation: string | null;
  readonly changed_at: string;
  readonly page_id: string;
  readonly page_url: string;
}

export interface KeywordRankHistoryWindow {
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface KeywordContentChangeLookup
  extends KeywordRankHistoryWindow {
  readonly sitePageId: string;
  readonly normalizedUrl: string;
}

export const MAX_KEYWORD_RANK_HISTORY_POINTS = 500;
export const MAX_KEYWORD_CONTENT_CHANGE_MARKERS = 200;
const GSC_QUERY_POINTER =
  /^\/valueJson\/topQueries\/([0-9]+)\/query$/u;

function checkedWindow(
  window: KeywordRankHistoryWindow,
): KeywordRankHistoryWindow {
  let startedAt: string;
  let endedAt: string;
  try {
    startedAt = canonicalUtcTimestamptz(window.startedAt);
    endedAt = canonicalUtcTimestamptz(window.endedAt);
  } catch {
    throw new KeywordRankHistoryIntegrityError("INVALID_WINDOW");
  }
  if (Date.parse(startedAt) >= Date.parse(endedAt)) {
    throw new KeywordRankHistoryIntegrityError("INVALID_WINDOW");
  }
  return { startedAt, endedAt };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : null;
}

function boundedLimitation(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 2_000) {
    throw new KeywordRankHistoryIntegrityError(
      "OBSERVATION_LINEAGE_INVALID",
    );
  }
  return trimmed;
}

function exactDataForSeoRankedLineage(
  row: ObservationQueryRow,
): boolean {
  const legacy =
    row.dataset_key === "dataforseo.ranked_keywords.v1" &&
    row.snapshot_schema_version ===
      "dataforseo.ranked_keywords.v1" &&
    row.snapshot_method_version ===
      "dataforseo.ranked_keywords.v1" &&
    row.collection_operation === "keyword_gap_import" &&
    row.collection_method_version ===
      "dataforseo.ranked_keywords.v1";
  const composite =
    row.dataset_key === "dataforseo.search_landscape.v1" &&
    row.snapshot_schema_version ===
      "dataforseo.search_landscape.v1" &&
    row.snapshot_method_version ===
      "dataforseo.search_landscape.v1" &&
    row.collection_operation === "search_landscape" &&
    row.collection_method_version ===
      "dataforseo.search_landscape.v1";
  const compositeV2 =
    row.dataset_key === "dataforseo.search_landscape.v2" &&
    row.snapshot_schema_version ===
      "dataforseo.search_landscape.v2" &&
    row.snapshot_method_version ===
      "dataforseo.search_landscape.v2" &&
    row.collection_operation === "search_landscape" &&
    row.collection_method_version ===
      "dataforseo.search_landscape.v2";
  const compositeV3 =
    row.dataset_key === "dataforseo.search_landscape.v3" &&
    row.snapshot_schema_version ===
      "dataforseo.search_landscape.v3" &&
    row.snapshot_method_version ===
      "dataforseo.search_landscape.v3" &&
    row.collection_operation === "search_landscape" &&
    row.collection_method_version ===
      "dataforseo.search_landscape.v3";
  return (
    row.snapshot_provider === "dataforseo" &&
    row.collection_provider === "dataforseo" &&
    (legacy || composite || compositeV2 || compositeV3)
  );
}

function checkedInstant(
  value: string,
  code:
    | "OBSERVATION_LINEAGE_INVALID"
    | "CHANGE_MARKER_LINEAGE_INVALID",
): string {
  try {
    return canonicalUtcTimestamptz(value);
  } catch {
    throw new KeywordRankHistoryIntegrityError(code);
  }
}

function parseObservation(
  row: ObservationQueryRow,
  scope: ProjectScope,
): KeywordRankObservationFact | null {
  if (
    row.workspace_id !== scope.workspaceId ||
    row.project_id !== scope.projectId ||
    row.occurrence_normalized_keyword !== row.normalized_keyword ||
    row.snapshot_availability === "unavailable" ||
    row.availability !== "available"
  ) {
    throw new KeywordRankHistoryIntegrityError(
      "OBSERVATION_LINEAGE_INVALID",
    );
  }
  const value = record(row.value_json);
  if (!value) {
    throw new KeywordRankHistoryIntegrityError(
      "OBSERVATION_VALUE_INVALID",
    );
  }
  const observedAt = checkedInstant(
    row.observed_at,
    "OBSERVATION_LINEAGE_INVALID",
  );
  const providerDataAsOf =
    row.provider_data_as_of === null
      ? null
      : checkedInstant(
          row.provider_data_as_of,
          "OBSERVATION_LINEAGE_INVALID",
        );
  if (
    providerDataAsOf !== null &&
    Date.parse(providerDataAsOf) > Date.parse(observedAt)
  ) {
    throw new KeywordRankHistoryIntegrityError(
      "OBSERVATION_LINEAGE_INVALID",
    );
  }

  if (row.source_kind === "dataforseo_ranked") {
    if (
      row.source_pointer !== "/valueJson/keyword" ||
      row.provider !== "dataforseo" ||
      !exactDataForSeoRankedLineage(row) ||
      row.metric_key !== "csv.keyword_gap.v1" ||
      row.grade !== "B" ||
      providerDataAsOf !== null ||
      typeof value["keyword"] !== "string" ||
      normalizeKeywordIdentity(value["keyword"]) !== row.normalized_keyword
    ) {
      throw new KeywordRankHistoryIntegrityError(
        "OBSERVATION_LINEAGE_INVALID",
      );
    }
    const rank = positiveNumber(value["currentRank"]);
    if (value["currentRank"] === null) return null;
    if (rank === null) {
      throw new KeywordRankHistoryIntegrityError(
        "OBSERVATION_VALUE_INVALID",
      );
    }
    return {
      occurrenceId: row.occurrence_id,
      snapshotId: row.snapshot_id,
      observationId: row.observation_id,
      provider: "dataforseo",
      metric: "absolute_rank",
      value: rank,
      valuePointer: "/valueJson/currentRank",
      observedAt,
      providerDataAsOf,
      grade: "B",
      limitation: boundedLimitation(row.limitation),
    };
  }

  if (row.source_kind === "gsc_top_query") {
    const pointer = row.source_pointer
      ? GSC_QUERY_POINTER.exec(row.source_pointer)
      : null;
    if (
      !pointer ||
      row.snapshot_provider !== "gsc" ||
      row.provider !== "gsc" ||
      row.dataset_key !== "gsc.page_query_daily.v1" ||
      row.metric_key !== "gsc.page.v1" ||
      row.grade !== "A"
    ) {
      throw new KeywordRankHistoryIntegrityError(
        "OBSERVATION_LINEAGE_INVALID",
      );
    }
    const index = Number(pointer[1]);
    const topQueries = value["topQueries"];
    const query =
      Number.isSafeInteger(index) && Array.isArray(topQueries)
        ? record(topQueries[index])
        : null;
    if (
      !query ||
      typeof query["query"] !== "string" ||
      normalizeKeywordIdentity(query["query"]) !== row.normalized_keyword
    ) {
      throw new KeywordRankHistoryIntegrityError(
        "OBSERVATION_VALUE_INVALID",
      );
    }
    const position = positiveNumber(query["position"]);
    if (query["position"] === null) return null;
    if (position === null) {
      throw new KeywordRankHistoryIntegrityError(
        "OBSERVATION_VALUE_INVALID",
      );
    }
    return {
      occurrenceId: row.occurrence_id,
      snapshotId: row.snapshot_id,
      observationId: row.observation_id,
      provider: "gsc",
      metric: "gsc_28d_average_position",
      value: position,
      valuePointer: `/valueJson/topQueries/${index}/position`,
      observedAt,
      providerDataAsOf,
      grade: "A",
      limitation: boundedLimitation(row.limitation),
    };
  }

  throw new KeywordRankHistoryIntegrityError(
    "OBSERVATION_LINEAGE_INVALID",
  );
}

function pathTarget(normalizedUrl: string): string {
  try {
    const parsed = new URL(normalizedUrl);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.hash !== ""
    ) {
      throw new Error("invalid canonical URL");
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    throw new KeywordRankHistoryIntegrityError(
      "SITE_PAGE_LINEAGE_INVALID",
    );
  }
}

export class KeywordRankHistoryRepository extends Repository {
  async listRankObservations(
    scope: ProjectScope,
    keywordId: string,
    window: KeywordRankHistoryWindow,
  ): Promise<KeywordRankObservationFact[]> {
    const checked = checkedWindow(window);
    const result = await this.exec.execute<ObservationQueryRow>(sql`
      select
        ${keywordOccurrences.id} as occurrence_id,
        ${dataSnapshots.id} as snapshot_id,
        ${normalizedObservations.id} as observation_id,
        ${keywordEntities.workspace_id} as workspace_id,
        ${keywordEntities.project_id} as project_id,
        ${keywordEntities.normalized_keyword} as normalized_keyword,
        ${keywordOccurrences.normalized_keyword} as occurrence_normalized_keyword,
        ${keywordOccurrences.source_kind} as source_kind,
        ${keywordOccurrences.source_pointer} as source_pointer,
        ${keywordOccurrences.provider_data_as_of}::text as provider_data_as_of,
        ${dataSnapshots.provider} as snapshot_provider,
        ${dataSnapshots.dataset_key} as dataset_key,
        ${dataSnapshots.schema_version} as snapshot_schema_version,
        ${dataSnapshots.method_version} as snapshot_method_version,
        ${collectionRuns.provider} as collection_provider,
        ${collectionRuns.operation} as collection_operation,
        ${collectionRuns.method_version} as collection_method_version,
        ${dataSnapshots.availability} as snapshot_availability,
        ${normalizedObservations.provider} as provider,
        ${normalizedObservations.metric_key} as metric_key,
        ${normalizedObservations.observed_at}::text as observed_at,
        ${normalizedObservations.availability} as availability,
        ${normalizedObservations.value_json} as value_json,
        ${normalizedObservations.grade} as grade,
        ${normalizedObservations.limitation} as limitation
      from ${keywordEntitySources}
      inner join ${keywordEntities}
        on ${keywordEntities.id} = ${keywordEntitySources.keyword_entity_id}
       and ${keywordEntities.workspace_id} = ${keywordEntitySources.workspace_id}
       and ${keywordEntities.project_id} = ${keywordEntitySources.project_id}
      inner join ${keywordOccurrences}
        on ${keywordOccurrences.id} = ${keywordEntitySources.keyword_occurrence_id}
       and ${keywordOccurrences.workspace_id} = ${keywordEntitySources.workspace_id}
       and ${keywordOccurrences.project_id} = ${keywordEntitySources.project_id}
      inner join ${normalizedObservations}
        on ${normalizedObservations.id} = ${keywordOccurrences.normalized_observation_id}
       and ${normalizedObservations.workspace_id} = ${keywordOccurrences.workspace_id}
       and ${normalizedObservations.project_id} = ${keywordOccurrences.project_id}
      inner join ${dataSnapshots}
        on ${dataSnapshots.id} = ${keywordOccurrences.data_snapshot_id}
       and ${dataSnapshots.id} = ${normalizedObservations.snapshot_id}
       and ${dataSnapshots.workspace_id} = ${keywordOccurrences.workspace_id}
       and ${dataSnapshots.project_id} = ${keywordOccurrences.project_id}
      inner join ${collectionRuns}
        on ${collectionRuns.id} = ${dataSnapshots.collection_run_id}
       and ${collectionRuns.workspace_id} = ${keywordOccurrences.workspace_id}
       and ${collectionRuns.project_id} = ${keywordOccurrences.project_id}
      inner join ${clientProjects}
        on ${clientProjects.id} = ${keywordEntities.project_id}
       and ${clientProjects.workspace_id} = ${keywordEntities.workspace_id}
      where ${keywordEntities.workspace_id} = ${scope.workspaceId}::uuid
        and ${keywordEntities.project_id} = ${scope.projectId}::uuid
        and ${keywordEntities.id} = ${keywordId}::uuid
        and ${clientProjects.archived_at} is null
        and ${normalizedObservations.observed_at} >= ${checked.startedAt}::timestamptz
        and ${normalizedObservations.observed_at} <= ${checked.endedAt}::timestamptz
        and ${keywordOccurrences.source_kind} in (
          'dataforseo_ranked',
          'gsc_top_query'
        )
      order by
        ${normalizedObservations.observed_at} asc,
        ${normalizedObservations.id} asc,
        ${keywordOccurrences.id} asc
      limit ${MAX_KEYWORD_RANK_HISTORY_POINTS + 1}
    `);
    if (result.rows.length > MAX_KEYWORD_RANK_HISTORY_POINTS) {
      throw new KeywordRankHistoryIntegrityError(
        "HISTORY_LIMIT_EXCEEDED",
      );
    }
    const facts: KeywordRankObservationFact[] = [];
    const identities = new Set<string>();
    for (const row of result.rows) {
      const fact = parseObservation(row, scope);
      if (!fact) continue;
      const identity = `${fact.observationId}:${fact.valuePointer}`;
      if (identities.has(identity)) {
        throw new KeywordRankHistoryIntegrityError(
          "OBSERVATION_IDENTITY_DUPLICATE",
        );
      }
      identities.add(identity);
      facts.push(fact);
    }
    return facts;
  }

  async listContentChanges(
    scope: ProjectScope,
    input: KeywordContentChangeLookup,
  ): Promise<KeywordContentChangeFact[]> {
    const checked = checkedWindow(input);
    const normalizedUrl = input.normalizedUrl.trim();
    if (
      normalizedUrl !== input.normalizedUrl ||
      normalizedUrl.length > 2_048
    ) {
      throw new KeywordRankHistoryIntegrityError(
        "SITE_PAGE_LINEAGE_INVALID",
      );
    }
    const pathname = pathTarget(normalizedUrl);
    const result = await this.exec.execute<ChangeQueryRow>(sql`
      select
        ${publicationReceipts.id} as change_receipt_id,
        ${publicationAttempts.id} as publication_attempt_id,
        ${publicationReceipts.workspace_id} as workspace_id,
        ${publicationReceipts.project_id} as project_id,
        ${publicationReceipts.site_id} as site_id,
        ${publicationAttempts.attempt_kind} as attempt_kind,
        ${publicationAttempts.artifact_id} as artifact_id,
        ${publicationAttempts.approved_artifact_revision} as artifact_revision,
        ${publicationAttempts.target_ref} as target_ref,
        ${publicationReceipts.live_canonical_url} as live_canonical_url,
        ${publicationReceipts.verification_state} as verification_state,
        ${publicationReceipts.limitation} as limitation,
        ${publicationReceipts.observed_at}::text as changed_at,
        ${sitePages.id} as page_id,
        ${sitePages.normalized_url} as page_url
      from ${sitePages}
      inner join ${clientProjects}
        on ${clientProjects.id} = ${sitePages.project_id}
       and ${clientProjects.workspace_id} = ${sitePages.workspace_id}
      inner join ${publicationAttempts}
        on ${publicationAttempts.workspace_id} = ${sitePages.workspace_id}
       and ${publicationAttempts.project_id} = ${sitePages.project_id}
       and ${publicationAttempts.site_id} = ${sitePages.site_id}
      inner join ${publicationReceipts}
        on ${publicationReceipts.workspace_id} = ${publicationAttempts.workspace_id}
       and ${publicationReceipts.project_id} = ${publicationAttempts.project_id}
       and ${publicationReceipts.site_id} = ${publicationAttempts.site_id}
       and ${publicationReceipts.publication_attempt_id} = ${publicationAttempts.id}
      where ${sitePages.workspace_id} = ${scope.workspaceId}::uuid
        and ${sitePages.project_id} = ${scope.projectId}::uuid
        and ${sitePages.id} = ${input.sitePageId}::uuid
        and ${sitePages.normalized_url} = ${normalizedUrl}
        and ${clientProjects.archived_at} is null
        and ${publicationReceipts.receipt_kind} = 'change_receipt'
        and ${publicationReceipts.verification_state} = 'verified_live'
        and ${publicationReceipts.observed_at} >= ${checked.startedAt}::timestamptz
        and ${publicationReceipts.observed_at} <= ${checked.endedAt}::timestamptz
        and ${publicationReceipts.live_canonical_url} = ${normalizedUrl}
        and (
          ${publicationAttempts.target_ref} = ${normalizedUrl}
          or ${publicationAttempts.target_ref} = ${pathname}
        )
      order by
        ${publicationReceipts.observed_at} asc,
        ${publicationReceipts.id} asc
      limit ${MAX_KEYWORD_CONTENT_CHANGE_MARKERS + 1}
    `);
    if (
      result.rows.length > MAX_KEYWORD_CONTENT_CHANGE_MARKERS
    ) {
      throw new KeywordRankHistoryIntegrityError(
        "CHANGE_MARKER_LIMIT_EXCEEDED",
      );
    }
    return result.rows.map((row) => {
      if (
        row.workspace_id !== scope.workspaceId ||
        row.project_id !== scope.projectId ||
        row.page_id !== input.sitePageId ||
        row.page_url !== normalizedUrl ||
        (row.attempt_kind !== "publish" &&
          row.attempt_kind !== "rollback") ||
        row.verification_state !== "verified_live" ||
        row.limitation !== null ||
        row.live_canonical_url !== normalizedUrl ||
        !Number.isSafeInteger(row.artifact_revision) ||
        row.artifact_revision < 1
      ) {
        throw new KeywordRankHistoryIntegrityError(
          "CHANGE_MARKER_LINEAGE_INVALID",
        );
      }
      return {
        changeReceiptId: row.change_receipt_id,
        publicationAttemptId: row.publication_attempt_id,
        attemptKind: row.attempt_kind,
        artifactId: row.artifact_id,
        artifactRevision: row.artifact_revision,
        targetRef: row.target_ref,
        liveCanonicalUrl: row.live_canonical_url,
        changedAt: checkedInstant(
          row.changed_at,
          "CHANGE_MARKER_LINEAGE_INVALID",
        ),
      };
    });
  }
}
