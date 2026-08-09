import { sql } from "drizzle-orm";
import { canonicalUtcTimestamptz } from "../instant.ts";
import {
  clientProjects,
  collectionRuns,
  dataSnapshots,
  keywordEntities,
  keywordEntitySources,
  keywordOccurrences,
  keywordReviewDecisions,
  normalizedObservations,
  sitePages,
  topicModelRevisions,
  topicNodeRevisions,
} from "../schema.ts";
import {
  Repository,
  type ProjectScope,
} from "./base.ts";
import { normalizeKeywordIdentity } from "./keyword-occurrences.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MARKET = /^[A-Z]{2}$/u;
const MAX_POSTGRES_REVISION = 2_147_483_647;

export const MAX_MEASUREMENT_TARGET_KEYWORDS = 200;
export const MAX_MEASUREMENT_KEYWORD_RANK_FACTS = 20_000;

export interface MeasurementKeywordRankWindows {
  readonly beforeWindow: {
    readonly startAt: string;
    readonly endAt: string;
  };
  readonly afterWindow: {
    readonly startAt: string;
    readonly endAt: string;
  };
}

export interface MeasurementTargetKeywordRankObservationFact {
  readonly occurrenceId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly value: number;
  readonly observedAt: string;
  readonly limitation: string;
}

export interface MeasurementTargetKeywordRankFact {
  readonly keywordId: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly topicNodeId: string;
  readonly topicLabel: string;
  readonly topicModelRevision: number;
  readonly observations:
    readonly MeasurementTargetKeywordRankObservationFact[];
}

export interface MeasurementTargetKeywordRankAuthority {
  readonly sitePageId: string;
  readonly canonicalUrl: string;
  readonly topicModelRevision: number | null;
  readonly keywords: readonly MeasurementTargetKeywordRankFact[];
}

export type MeasurementTargetKeywordRankIntegrityCode =
  | "INVALID_INPUT"
  | "PAGE_NOT_FOUND"
  | "KEYWORD_AUTHORITY_DIVERGED"
  | "AUTHORITY_RESULT_INVALID"
  | "KEYWORD_LIMIT_EXCEEDED"
  | "RANK_FACT_LIMIT_EXCEEDED"
  | "RANK_LINEAGE_INVALID"
  | "RANK_IDENTITY_DUPLICATE";

export class MeasurementTargetKeywordRankIntegrityError extends Error {
  override readonly name =
    "MeasurementTargetKeywordRankIntegrityError";

  constructor(
    readonly code: MeasurementTargetKeywordRankIntegrityCode,
  ) {
    super(
      `Measurement target Keyword rank authority failed integrity validation: ${code}`,
    );
  }
}

interface TargetKeywordRankQueryRow
  extends Record<string, unknown> {
  readonly page_exists: boolean;
  readonly page_id: string | null;
  readonly page_url: string | null;
  readonly topic_model_revision: number | null;
  readonly missing_decision_count: number;
  readonly mirror_divergence_count: number;
  readonly invalid_decision_count: number;
  readonly keyword_id: string | null;
  readonly display_keyword: string | null;
  readonly normalized_keyword: string | null;
  readonly market_code: string | null;
  readonly language_tag: string | null;
  readonly topic_node_id: string | null;
  readonly topic_label: string | null;
  readonly decision_topic_model_revision: number | null;
  readonly occurrence_id: string | null;
  readonly occurrence_normalized_keyword: string | null;
  readonly occurrence_market: string | null;
  readonly occurrence_language_tag: string | null;
  readonly occurrence_source_kind: string | null;
  readonly occurrence_scope_basis: string | null;
  readonly occurrence_source_pointer: string | null;
  readonly occurrence_source_ref: string | null;
  readonly occurrence_provider_data_as_of: string | null;
  readonly snapshot_id: string | null;
  readonly snapshot_provider: string | null;
  readonly snapshot_dataset_key: string | null;
  readonly snapshot_schema_version: string | null;
  readonly snapshot_method_version: string | null;
  readonly collection_provider: string | null;
  readonly collection_operation: string | null;
  readonly collection_method_version: string | null;
  readonly snapshot_availability: string | null;
  readonly observation_id: string | null;
  readonly observation_provider: string | null;
  readonly observation_metric_key: string | null;
  readonly observation_availability: string | null;
  readonly observation_observed_at: string | null;
  readonly observation_grade: string | null;
  readonly observation_limitation: string | null;
  readonly observation_value_json: unknown;
}

function checkedInstant(value: string): string {
  try {
    return canonicalUtcTimestamptz(value);
  } catch {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "INVALID_INPUT",
    );
  }
}

function checkedWindows(
  windows: MeasurementKeywordRankWindows,
): MeasurementKeywordRankWindows {
  const beforeWindow = {
    startAt: checkedInstant(windows.beforeWindow.startAt),
    endAt: checkedInstant(windows.beforeWindow.endAt),
  };
  const afterWindow = {
    startAt: checkedInstant(windows.afterWindow.startAt),
    endAt: checkedInstant(windows.afterWindow.endAt),
  };
  if (
    Date.parse(beforeWindow.startAt) >=
      Date.parse(beforeWindow.endAt) ||
    Date.parse(afterWindow.startAt) >=
      Date.parse(afterWindow.endAt) ||
    Date.parse(beforeWindow.endAt) >
      Date.parse(afterWindow.startAt)
  ) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "INVALID_INPUT",
    );
  }
  return { beforeWindow, afterWindow };
}

function assertIdentity(name: string, value: string): void {
  if (!UUID.test(value)) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "INVALID_INPUT",
    );
  }
  if (name.length === 0) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "INVALID_INPUT",
    );
  }
}

function checkedCount(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_POSTGRES_REVISION
  ) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "AUTHORITY_RESULT_INVALID",
    );
  }
  return value;
}

function checkedRevision(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_POSTGRES_REVISION
  ) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "AUTHORITY_RESULT_INVALID",
    );
  }
  return value;
}

function record(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedText(
  value: string,
  maximum: number,
  code:
    | "AUTHORITY_RESULT_INVALID"
    | "RANK_LINEAGE_INVALID",
): string {
  const trimmed = value.trim();
  if (
    trimmed !== value ||
    trimmed.length < 1 ||
    trimmed.length > maximum
  ) {
    throw new MeasurementTargetKeywordRankIntegrityError(code);
  }
  return trimmed;
}

function positiveRank(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "RANK_LINEAGE_INVALID",
    );
  }
  return value;
}

function exactDataForSeoRankedLineage(
  row: TargetKeywordRankQueryRow,
): boolean {
  const legacy =
    row.snapshot_dataset_key ===
      "dataforseo.ranked_keywords.v1" &&
    row.snapshot_schema_version ===
      "dataforseo.ranked_keywords.v1" &&
    row.snapshot_method_version ===
      "dataforseo.ranked_keywords.v1" &&
    row.collection_operation === "keyword_gap_import" &&
    row.collection_method_version ===
      "dataforseo.ranked_keywords.v1";
  const composite =
    row.snapshot_dataset_key ===
      "dataforseo.search_landscape.v1" &&
    row.snapshot_schema_version ===
      "dataforseo.search_landscape.v1" &&
    row.snapshot_method_version ===
      "dataforseo.search_landscape.v1" &&
    row.collection_operation === "search_landscape" &&
    row.collection_method_version ===
      "dataforseo.search_landscape.v1";
  const compositeV2 =
    row.snapshot_dataset_key ===
      "dataforseo.search_landscape.v2" &&
    row.snapshot_schema_version ===
      "dataforseo.search_landscape.v2" &&
    row.snapshot_method_version ===
      "dataforseo.search_landscape.v2" &&
    row.collection_operation === "search_landscape" &&
    row.collection_method_version ===
      "dataforseo.search_landscape.v2";
  const compositeV3 =
    row.snapshot_dataset_key ===
      "dataforseo.search_landscape.v3" &&
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

function hasNoRankFact(row: TargetKeywordRankQueryRow): boolean {
  return [
    row.occurrence_id,
    row.snapshot_id,
    row.observation_id,
    row.observation_observed_at,
    row.observation_provider,
    row.observation_metric_key,
    row.observation_availability,
    row.observation_grade,
    row.observation_limitation,
    row.occurrence_normalized_keyword,
    row.occurrence_market,
    row.occurrence_language_tag,
    row.occurrence_source_kind,
    row.occurrence_scope_basis,
    row.occurrence_source_pointer,
    row.occurrence_source_ref,
    row.snapshot_provider,
    row.snapshot_dataset_key,
    row.snapshot_schema_version,
    row.snapshot_method_version,
    row.collection_provider,
    row.collection_operation,
    row.collection_method_version,
    row.snapshot_availability,
  ].every((value) => value === null);
}

function rankFact(
  row: TargetKeywordRankQueryRow,
  keyword: {
    readonly normalizedKeyword: string;
    readonly marketCode: string;
    readonly languageTag: string;
  },
  windows: MeasurementKeywordRankWindows,
  canonicalUrl: string,
): MeasurementTargetKeywordRankObservationFact | null {
  if (hasNoRankFact(row)) return null;
  if (
    typeof row.occurrence_id !== "string" ||
    typeof row.snapshot_id !== "string" ||
    typeof row.observation_id !== "string" ||
    typeof row.observation_observed_at !== "string" ||
    typeof row.observation_limitation !== "string" ||
    row.occurrence_normalized_keyword !== keyword.normalizedKeyword ||
    row.occurrence_market !== keyword.marketCode ||
    row.occurrence_language_tag !== keyword.languageTag ||
    row.occurrence_source_kind !== "dataforseo_ranked" ||
    row.occurrence_scope_basis !== "provider_collection_scope" ||
    row.occurrence_source_pointer !== "/valueJson/keyword" ||
    row.occurrence_source_ref !==
      `observation:${row.observation_id}#/valueJson/keyword` ||
    row.occurrence_provider_data_as_of !== null ||
    !exactDataForSeoRankedLineage(row) ||
    row.snapshot_availability === "unavailable" ||
    row.observation_provider !== "dataforseo" ||
    row.observation_metric_key !== "csv.keyword_gap.v1" ||
    row.observation_availability !== "available" ||
    row.observation_grade !== "B"
  ) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "RANK_LINEAGE_INVALID",
    );
  }
  for (const value of [
    row.occurrence_id,
    row.snapshot_id,
    row.observation_id,
  ]) {
    if (!UUID.test(value)) {
      throw new MeasurementTargetKeywordRankIntegrityError(
        "RANK_LINEAGE_INVALID",
      );
    }
  }

  const value = record(row.observation_value_json);
  if (
    value === null ||
    typeof value["keyword"] !== "string" ||
    normalizeKeywordIdentity(value["keyword"]) !==
      keyword.normalizedKeyword
  ) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "RANK_LINEAGE_INVALID",
    );
  }
  const rank = positiveRank(value["currentRank"]);
  if (rank === null) return null;
  const currentUrl = value["currentUrl"];
  if (currentUrl === null) return null;
  if (
    typeof currentUrl !== "string" ||
    currentUrl.trim() !== currentUrl ||
    currentUrl.length < 1 ||
    currentUrl.length > 2_048
  ) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "RANK_LINEAGE_INVALID",
    );
  }
  try {
    const observedUrl = new URL(currentUrl);
    if (
      (observedUrl.protocol !== "http:" &&
        observedUrl.protocol !== "https:") ||
      observedUrl.hash !== "" ||
      observedUrl.username !== "" ||
      observedUrl.password !== ""
    ) {
      throw new Error("unsupported ranking URL");
    }
    // DataForSEO ranks are Keyword-level observations and may point to another
    // page (or even another origin). A Results measurement is URL-scoped, so
    // only the exact canonical page is eligible; a different ranking URL is
    // valid provider evidence, but it is not evidence for this URL.
    if (observedUrl.href !== new URL(canonicalUrl).href) return null;
  } catch {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "RANK_LINEAGE_INVALID",
    );
  }

  let observedAt: string;
  try {
    observedAt = canonicalUtcTimestamptz(
      row.observation_observed_at,
    );
  } catch {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "RANK_LINEAGE_INVALID",
    );
  }
  const observedTime = Date.parse(observedAt);
  const insideBefore =
    observedTime >= Date.parse(windows.beforeWindow.startAt) &&
    observedTime < Date.parse(windows.beforeWindow.endAt);
  const insideAfter =
    observedTime >= Date.parse(windows.afterWindow.startAt) &&
    observedTime < Date.parse(windows.afterWindow.endAt);
  if (!insideBefore && !insideAfter) {
    throw new MeasurementTargetKeywordRankIntegrityError(
      "RANK_LINEAGE_INVALID",
    );
  }

  return {
    occurrenceId: row.occurrence_id,
    snapshotId: row.snapshot_id,
    observationId: row.observation_id,
    value: rank,
    observedAt,
    limitation: boundedText(
      row.observation_limitation,
      2_000,
      "RANK_LINEAGE_INVALID",
    ),
  };
}

/**
 * Read the exact confirmed target Keywords for one measured SitePage together
 * with immutable DataForSEO absolute-rank observations whose provider-reported
 * currentUrl exactly matches that page in the two frozen Measurement windows.
 * GSC average position is deliberately absent here.
 */
export class MeasurementTargetKeywordRanksRepository extends Repository {
  async readForMeasuredPage(
    scope: ProjectScope,
    input: MeasurementKeywordRankWindows & {
      readonly sitePageId: string;
      readonly canonicalUrl: string;
    },
  ): Promise<MeasurementTargetKeywordRankAuthority> {
    assertIdentity("workspaceId", scope.workspaceId);
    assertIdentity("projectId", scope.projectId);
    assertIdentity("sitePageId", input.sitePageId);
    const canonicalUrl = input.canonicalUrl.trim();
    if (
      canonicalUrl !== input.canonicalUrl ||
      canonicalUrl.length < 1 ||
      canonicalUrl.length > 2_048
    ) {
      throw new MeasurementTargetKeywordRankIntegrityError(
        "INVALID_INPUT",
      );
    }
    try {
      const parsed = new URL(canonicalUrl);
      if (
        (parsed.protocol !== "http:" &&
          parsed.protocol !== "https:") ||
        parsed.hash !== "" ||
        parsed.username !== "" ||
        parsed.password !== ""
      ) {
        throw new Error("unsupported URL");
      }
    } catch {
      throw new MeasurementTargetKeywordRankIntegrityError(
        "INVALID_INPUT",
      );
    }
    const windows = checkedWindows(input);

    const result =
      await this.exec.execute<TargetKeywordRankQueryRow>(sql`
        with
        active_project as materialized (
          select
            ${clientProjects.workspace_id} as workspace_id,
            ${clientProjects.id} as project_id
          from ${clientProjects}
          where ${clientProjects.workspace_id} =
                ${scope.workspaceId}::uuid
            and ${clientProjects.id} = ${scope.projectId}::uuid
            and ${clientProjects.archived_at} is null
        ),
        selected_page as materialized (
          select
            page.id as page_id,
            page.site_id,
            page.normalized_url as page_url
          from ${sitePages} page
          inner join active_project project
            on project.workspace_id = page.workspace_id
           and project.project_id = page.project_id
          where page.workspace_id = ${scope.workspaceId}::uuid
            and page.project_id = ${scope.projectId}::uuid
            and page.id = ${input.sitePageId}::uuid
            and page.normalized_url = ${canonicalUrl}
          limit 1
        ),
        latest_confirmed as materialized (
          select
            model.workspace_id,
            model.project_id,
            model.revision
          from ${topicModelRevisions} model
          inner join active_project project
            on project.workspace_id = model.workspace_id
           and project.project_id = model.project_id
          where model.status = 'confirmed'
          order by model.revision desc, model.id desc
          limit 1
        ),
        active_nodes as materialized (
          select
            node.topic_node_id,
            node.topic_model_revision,
            node.label
          from ${topicNodeRevisions} node
          inner join latest_confirmed model
            on model.workspace_id = node.workspace_id
           and model.project_id = node.project_id
           and model.revision = node.topic_model_revision
          where node.lifecycle_state = 'active'
        ),
        current_keyword_authority as materialized (
          select
            entity.id as entity_keyword_id,
            entity.workspace_id as entity_workspace_id,
            entity.project_id as entity_project_id,
            entity.display_keyword,
            entity.normalized_keyword,
            entity.market,
            entity.language_tag,
            entity.status as entity_status,
            entity.intent as entity_intent,
            entity.buyer_stage as entity_buyer_stage,
            entity.cluster_key as entity_cluster_key,
            entity.mapping_decision as entity_mapping_decision,
            entity.mapped_site_page_id as entity_mapped_site_page_id,
            entity.mapping_review_state as entity_review_state,
            entity.mapping_revision as entity_mapping_revision,
            decision.id as decision_id,
            decision.workspace_id as decision_workspace_id,
            decision.project_id as decision_project_id,
            decision.keyword_entity_id as decision_keyword_id,
            decision.governance_revision as decision_revision,
            decision.status as decision_status,
            decision.intent as decision_intent,
            decision.buyer_stage as decision_buyer_stage,
            decision.topic_node_id as decision_topic_node_id,
            decision.topic_model_revision as
              decision_topic_model_revision,
            decision.cluster_key_at_decision,
            decision.mapping_decision as decision_mapping_decision,
            decision.mapped_site_page_id as
              decision_mapped_site_page_id,
            decision.review_state as decision_review_state,
            decision.assignment_invalidated_by
          from ${keywordEntities} entity
          inner join active_project project
            on project.workspace_id = entity.workspace_id
           and project.project_id = entity.project_id
          left join lateral (
            select latest.*
            from ${keywordReviewDecisions} latest
            where latest.workspace_id = entity.workspace_id
              and latest.project_id = entity.project_id
              and latest.keyword_entity_id = entity.id
            order by
              latest.governance_revision desc,
              latest.id desc
            limit 1
          ) decision on true
        ),
        authority_integrity as materialized (
          select
            count(*) filter (
              where authority.decision_id is null
            )::integer as missing_decision_count,
            count(*) filter (
              where authority.decision_id is not null
                and (
                  authority.entity_workspace_id is distinct from
                    authority.decision_workspace_id
                  or authority.entity_project_id is distinct from
                    authority.decision_project_id
                  or authority.entity_keyword_id is distinct from
                    authority.decision_keyword_id
                  or authority.entity_mapping_revision is distinct from
                    authority.decision_revision
                  or authority.entity_status is distinct from
                    authority.decision_status
                  or authority.entity_intent is distinct from
                    authority.decision_intent
                  or authority.entity_buyer_stage is distinct from
                    authority.decision_buyer_stage
                  or authority.entity_cluster_key is distinct from
                    authority.cluster_key_at_decision
                  or authority.entity_mapping_decision is distinct from
                    authority.decision_mapping_decision
                  or authority.entity_mapped_site_page_id is distinct from
                    authority.decision_mapped_site_page_id
                  or authority.entity_review_state is distinct from
                    authority.decision_review_state
                )
            )::integer as mirror_divergence_count,
            count(*) filter (
              where authority.decision_id is not null
                and (
                  authority.decision_status not in (
                    'candidate',
                    'approved',
                    'excluded',
                    'parked'
                  )
                  or authority.decision_mapping_decision not in (
                    'unassigned',
                    'existing_page',
                    'new_asset'
                  )
                  or authority.decision_review_state not in (
                    'unreviewed',
                    'confirmed'
                  )
                  or (
                    authority.assignment_invalidated_by is not null
                    and authority.assignment_invalidated_by not in (
                      'topic_split',
                      'topic_merge',
                      'topic_retire'
                    )
                  )
                  or (
                    (authority.decision_topic_node_id is null) <>
                    (authority.decision_topic_model_revision is null)
                  )
                  or (
                    (authority.decision_mapping_decision =
                      'existing_page') <>
                    (
                      authority.decision_mapped_site_page_id
                        is not null
                    )
                  )
                  or (
                    authority.assignment_invalidated_by is not null
                    and authority.decision_review_state <> 'unreviewed'
                  )
                )
            )::integer as invalid_decision_count
          from current_keyword_authority authority
        ),
        eligible_keywords as materialized (
          select
            authority.entity_keyword_id as keyword_id,
            authority.display_keyword,
            authority.normalized_keyword,
            authority.market as market_code,
            authority.language_tag,
            authority.decision_topic_node_id as topic_node_id,
            authority.decision_topic_model_revision as
              decision_topic_model_revision,
            node.label as topic_label
          from current_keyword_authority authority
          inner join latest_confirmed model
            on authority.decision_topic_model_revision =
              model.revision
          inner join active_nodes node
            on node.topic_node_id =
              authority.decision_topic_node_id
           and node.topic_model_revision = model.revision
          inner join selected_page page
            on page.page_id =
              authority.decision_mapped_site_page_id
          where authority.decision_id is not null
            and authority.decision_status = 'approved'
            and authority.decision_review_state = 'confirmed'
            and authority.assignment_invalidated_by is null
            and authority.decision_mapping_decision =
              'existing_page'
          order by
            authority.normalized_keyword asc,
            authority.entity_keyword_id asc
          limit ${MAX_MEASUREMENT_TARGET_KEYWORDS + 1}
        ),
        rank_facts as materialized (
          select
            source.keyword_entity_id as keyword_id,
            occurrence.id as occurrence_id,
            occurrence.normalized_keyword as
              occurrence_normalized_keyword,
            occurrence.market as occurrence_market,
            occurrence.language_tag as occurrence_language_tag,
            occurrence.source_kind as occurrence_source_kind,
            occurrence.scope_basis as occurrence_scope_basis,
            occurrence.source_pointer as occurrence_source_pointer,
            occurrence.source_ref as occurrence_source_ref,
            occurrence.provider_data_as_of::text as
              occurrence_provider_data_as_of,
            snapshot.id as snapshot_id,
            snapshot.provider as snapshot_provider,
            snapshot.dataset_key as snapshot_dataset_key,
            snapshot.schema_version as snapshot_schema_version,
            snapshot.method_version as snapshot_method_version,
            collection.provider as collection_provider,
            collection.operation as collection_operation,
            collection.method_version as collection_method_version,
            snapshot.availability as snapshot_availability,
            observation.id as observation_id,
            observation.provider as observation_provider,
            observation.metric_key as observation_metric_key,
            observation.availability as
              observation_availability,
            observation.observed_at::text as
              observation_observed_at,
            observation.grade as observation_grade,
            observation.limitation as observation_limitation,
            observation.value_json as observation_value_json
          from ${keywordEntitySources} source
          inner join eligible_keywords keyword
            on keyword.keyword_id = source.keyword_entity_id
          inner join ${keywordOccurrences} occurrence
            on occurrence.id = source.keyword_occurrence_id
           and occurrence.workspace_id = source.workspace_id
           and occurrence.project_id = source.project_id
           and occurrence.source_kind = 'dataforseo_ranked'
          inner join ${normalizedObservations} observation
            on observation.id =
              occurrence.normalized_observation_id
           and observation.workspace_id = occurrence.workspace_id
           and observation.project_id = occurrence.project_id
          inner join ${dataSnapshots} snapshot
            on snapshot.id = occurrence.data_snapshot_id
           and snapshot.id = observation.snapshot_id
            and snapshot.workspace_id = occurrence.workspace_id
            and snapshot.project_id = occurrence.project_id
          inner join ${collectionRuns} collection
            on collection.id = snapshot.collection_run_id
           and collection.workspace_id = occurrence.workspace_id
           and collection.project_id = occurrence.project_id
          inner join selected_page page
            on page.site_id = snapshot.site_id
          where source.workspace_id = ${scope.workspaceId}::uuid
            and source.project_id = ${scope.projectId}::uuid
            and (
              (
                observation.observed_at >=
                  ${windows.beforeWindow.startAt}::timestamptz
                and observation.observed_at <
                  ${windows.beforeWindow.endAt}::timestamptz
              )
              or (
                observation.observed_at >=
                  ${windows.afterWindow.startAt}::timestamptz
                and observation.observed_at <
                  ${windows.afterWindow.endAt}::timestamptz
              )
            )
          order by
            source.keyword_entity_id asc,
            observation.observed_at asc,
            observation.id asc,
            occurrence.id asc
          limit ${MAX_MEASUREMENT_KEYWORD_RANK_FACTS + 1}
        )
        select
          (page.page_id is not null) as page_exists,
          page.page_id,
          page.page_url,
          model.revision::integer as topic_model_revision,
          integrity.missing_decision_count,
          integrity.mirror_divergence_count,
          integrity.invalid_decision_count,
          keyword.keyword_id,
          keyword.display_keyword,
          keyword.normalized_keyword,
          keyword.market_code,
          keyword.language_tag,
          keyword.topic_node_id,
          keyword.topic_label,
          keyword.decision_topic_model_revision,
          rank.occurrence_id,
          rank.occurrence_normalized_keyword,
          rank.occurrence_market,
          rank.occurrence_language_tag,
          rank.occurrence_source_kind,
          rank.occurrence_scope_basis,
          rank.occurrence_source_pointer,
          rank.occurrence_source_ref,
          rank.occurrence_provider_data_as_of,
          rank.snapshot_id,
          rank.snapshot_provider,
          rank.snapshot_dataset_key,
          rank.snapshot_schema_version,
          rank.snapshot_method_version,
          rank.collection_provider,
          rank.collection_operation,
          rank.collection_method_version,
          rank.snapshot_availability,
          rank.observation_id,
          rank.observation_provider,
          rank.observation_metric_key,
          rank.observation_availability,
          rank.observation_observed_at,
          rank.observation_grade,
          rank.observation_limitation,
          rank.observation_value_json
        from authority_integrity integrity
        left join selected_page page on true
        left join latest_confirmed model on true
        left join eligible_keywords keyword on true
        left join rank_facts rank
          on rank.keyword_id = keyword.keyword_id
        order by
          keyword.normalized_keyword asc nulls last,
          keyword.keyword_id asc nulls last,
          rank.observation_observed_at asc nulls last,
          rank.observation_id asc nulls last,
          rank.occurrence_id asc nulls last
        limit ${
          MAX_MEASUREMENT_KEYWORD_RANK_FACTS +
          MAX_MEASUREMENT_TARGET_KEYWORDS +
          2
        }
      `);

    const rows = result.rows;
    const first = rows[0];
    if (!first) {
      throw new MeasurementTargetKeywordRankIntegrityError(
        "AUTHORITY_RESULT_INVALID",
      );
    }
    if (
      first.page_exists !== true ||
      first.page_id !== input.sitePageId ||
      first.page_url !== canonicalUrl
    ) {
      throw new MeasurementTargetKeywordRankIntegrityError(
        "PAGE_NOT_FOUND",
      );
    }
    for (const row of rows) {
      if (
        row.page_exists !== true ||
        row.page_id !== first.page_id ||
        row.page_url !== first.page_url ||
        row.topic_model_revision !== first.topic_model_revision ||
        checkedCount(row.missing_decision_count) !==
          checkedCount(first.missing_decision_count) ||
        checkedCount(row.mirror_divergence_count) !==
          checkedCount(first.mirror_divergence_count) ||
        checkedCount(row.invalid_decision_count) !==
          checkedCount(first.invalid_decision_count)
      ) {
        throw new MeasurementTargetKeywordRankIntegrityError(
          "AUTHORITY_RESULT_INVALID",
        );
      }
    }
    if (
      checkedCount(first.missing_decision_count) !== 0 ||
      checkedCount(first.mirror_divergence_count) !== 0 ||
      checkedCount(first.invalid_decision_count) !== 0
    ) {
      throw new MeasurementTargetKeywordRankIntegrityError(
        "KEYWORD_AUTHORITY_DIVERGED",
      );
    }

    const topicModelRevision =
      first.topic_model_revision === null
        ? null
        : checkedRevision(first.topic_model_revision);
    const grouped = new Map<
      string,
      {
        keyword: Omit<
          MeasurementTargetKeywordRankFact,
          "observations"
        >;
        observations: MeasurementTargetKeywordRankObservationFact[];
        observationIdentities: Set<string>;
      }
    >();
    let rankFactCount = 0;

    for (const row of rows) {
      const keywordFields = [
        row.keyword_id,
        row.display_keyword,
        row.normalized_keyword,
        row.market_code,
        row.language_tag,
        row.topic_node_id,
        row.topic_label,
        row.decision_topic_model_revision,
      ];
      if (keywordFields.every((value) => value === null)) {
        if (!hasNoRankFact(row)) {
          throw new MeasurementTargetKeywordRankIntegrityError(
            "AUTHORITY_RESULT_INVALID",
          );
        }
        continue;
      }
      if (
        topicModelRevision === null ||
        typeof row.keyword_id !== "string" ||
        typeof row.display_keyword !== "string" ||
        typeof row.normalized_keyword !== "string" ||
        typeof row.market_code !== "string" ||
        typeof row.language_tag !== "string" ||
        typeof row.topic_node_id !== "string" ||
        typeof row.topic_label !== "string" ||
        typeof row.decision_topic_model_revision !== "number" ||
        !UUID.test(row.keyword_id) ||
        !UUID.test(row.topic_node_id) ||
        !MARKET.test(row.market_code) ||
        row.decision_topic_model_revision !== topicModelRevision ||
        normalizeKeywordIdentity(row.display_keyword) !==
          row.normalized_keyword
      ) {
        throw new MeasurementTargetKeywordRankIntegrityError(
          "AUTHORITY_RESULT_INVALID",
        );
      }
      const keywordId = row.keyword_id;
      const identity = {
        keywordId,
        displayKeyword: boundedText(
          row.display_keyword,
          500,
          "AUTHORITY_RESULT_INVALID",
        ),
        normalizedKeyword: boundedText(
          row.normalized_keyword,
          500,
          "AUTHORITY_RESULT_INVALID",
        ),
        marketCode: row.market_code,
        languageTag: boundedText(
          row.language_tag,
          255,
          "AUTHORITY_RESULT_INVALID",
        ),
        topicNodeId: row.topic_node_id,
        topicLabel: boundedText(
          row.topic_label,
          200,
          "AUTHORITY_RESULT_INVALID",
        ),
        topicModelRevision,
      } as const;

      const existing = grouped.get(keywordId);
      if (existing) {
        if (
          JSON.stringify(existing.keyword) !==
          JSON.stringify(identity)
        ) {
          throw new MeasurementTargetKeywordRankIntegrityError(
            "AUTHORITY_RESULT_INVALID",
          );
        }
      } else {
        if (grouped.size >= MAX_MEASUREMENT_TARGET_KEYWORDS) {
          throw new MeasurementTargetKeywordRankIntegrityError(
            "KEYWORD_LIMIT_EXCEEDED",
          );
        }
        grouped.set(keywordId, {
          keyword: identity,
          observations: [],
          observationIdentities: new Set(),
        });
      }

      const observation = rankFact(
        row,
        identity,
        windows,
        canonicalUrl,
      );
      if (!observation) continue;
      rankFactCount += 1;
      if (
        rankFactCount > MAX_MEASUREMENT_KEYWORD_RANK_FACTS
      ) {
        throw new MeasurementTargetKeywordRankIntegrityError(
          "RANK_FACT_LIMIT_EXCEEDED",
        );
      }
      const groupedKeyword = grouped.get(keywordId)!;
      const observationIdentity =
        `${observation.observationId}:/valueJson/currentRank`;
      if (
        groupedKeyword.observationIdentities.has(
          observationIdentity,
        )
      ) {
        throw new MeasurementTargetKeywordRankIntegrityError(
          "RANK_IDENTITY_DUPLICATE",
        );
      }
      groupedKeyword.observationIdentities.add(
        observationIdentity,
      );
      groupedKeyword.observations.push(observation);
    }

    const keywords = [...grouped.values()]
      .map(({ keyword, observations }) => ({
        ...keyword,
        observations: observations.sort((left, right) => {
          const instant =
            Date.parse(left.observedAt) -
            Date.parse(right.observedAt);
          if (instant !== 0) return instant;
          return left.observationId.localeCompare(
            right.observationId,
          );
        }),
      }))
      .sort((left, right) => {
        const normalized = left.normalizedKeyword.localeCompare(
          right.normalizedKeyword,
        );
        return normalized !== 0
          ? normalized
          : left.keywordId.localeCompare(right.keywordId);
      });

    return {
      sitePageId: first.page_id,
      canonicalUrl: first.page_url,
      topicModelRevision,
      keywords,
    };
  }
}
