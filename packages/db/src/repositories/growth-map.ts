import { sql } from "drizzle-orm";
import {
  actions,
  analysisRefreshRuns,
  analysisRefreshSteps,
  asyncRuns,
  auditRuns,
  collectionRuns,
  dataSnapshots,
  diagnosticRuns,
  executionArtifacts,
  findings,
  findingTargets,
  normalizedObservations,
  pageSnapshots,
  sitePages,
  topicModelGenerationRuns,
} from "../schema.ts";
import type { ActionRow } from "./actions.ts";
import {
  analysisRefreshPlanHash,
  analysisRefreshPlanManifest,
  analysisRefreshPlanV2Manifest,
  legacyAnalysisRefreshPlanManifest,
} from "./analysis-refresh-runs.ts";
import {
  GROWTH_AUDIT_PROJECTION_VERSION,
  LEGACY_GROWTH_AUDIT_PROJECTION_VERSION,
} from "./audit-runs.ts";
import { Repository, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";
import type { ArtifactRow } from "./execution-artifacts.ts";
import type { FindingTargetRow } from "./finding-targets.ts";
import type { FindingRow } from "./findings.ts";
import type { ObservationRow } from "./observations.ts";

/** Growth Map reads remain deliberately smaller than the wire-contract limits. */
export const MAX_GROWTH_MAP_URL_PAGE_SIZE = 100;
export const MAX_GROWTH_MAP_SEARCH_LENGTH = 256;
export const MAX_GROWTH_MAP_SNAPSHOT_LOOKUP = 20;
export const MAX_GROWTH_MAP_ENTITY_LOOKUP = 200;

function publishedAnalysisRefreshPlan(
  manifest: ReturnType<typeof analysisRefreshPlanManifest>,
) {
  return {
    manifestJson: JSON.stringify(manifest),
    planHash: analysisRefreshPlanHash(manifest),
  };
}

const PUBLISHED_PLAN_V1 = publishedAnalysisRefreshPlan(
  legacyAnalysisRefreshPlanManifest(),
);
const PUBLISHED_PLAN_V2 = publishedAnalysisRefreshPlan(
  analysisRefreshPlanV2Manifest(),
);
const PUBLISHED_PLAN_V3 = publishedAnalysisRefreshPlan(
  analysisRefreshPlanManifest(),
);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface GrowthMapReadableRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly icp_profile_id: string;
  readonly icp_profile_version: number;
  readonly rule_set_version: string;
  readonly prompt_set_version: string;
  readonly output_locale: string;
  readonly input_manifest: Record<string, unknown>;
  readonly input_hash: string;
  readonly coverage: Record<string, unknown>;
  readonly created_at: string;
  readonly run_status: "completed" | "partial";
  readonly run_completed_at: string | null;
}

/**
 * One canonical SitePage admitted by the frozen DiagnosticRun. Crawl columns
 * are null only when the identity came exclusively from a frozen GSC/GA4 URL
 * Observation. No current SitePage is admitted merely because it now exists.
 */
export interface GrowthMapUrlInventoryRow {
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_page_id: string;
  readonly site_id: string;
  readonly normalized_url: string;
  readonly normalized_url_hash: string;
  /** Frozen detail may populate this only from the per-run FindingTarget ledger. */
  readonly template_key: string | null;
  readonly site_page_created_at: string;
  readonly page_snapshot_id: string | null;
  readonly crawl_snapshot_id: string | null;
  readonly page_snapshot_content_hash: string | null;
  readonly page_snapshot_canonical_extract: string | null;
  readonly page_snapshot_extract: Record<string, unknown> | null;
  readonly page_snapshot_captured_at: string | null;
}

export interface GrowthMapUrlInventoryOptions {
  readonly limit: number;
  readonly cursor: string | null;
  readonly search?: string;
  /** Hide frozen inventory rows that have no active, non-ignored Opportunity. */
  readonly opportunitiesOnly?: boolean;
}

export interface GrowthMapUrlInventoryPage {
  readonly rows: GrowthMapUrlInventoryRow[];
  readonly nextCursor: string | null;
}

/** Summary options mirror the list filters minus its page size. */
export interface GrowthMapUrlSummaryOptions {
  readonly cursor: string | null;
  readonly search?: string;
  readonly opportunitiesOnly?: boolean;
}

/**
 * Opportunity URLs collapsed onto the exact deterministic inputs a priority
 * derivation is allowed to read. Returning groups instead of per-URL rows keeps
 * the generation-wide banding bounded while leaving one implementation of the
 * derivation itself in the service layer.
 */
export interface GrowthMapOpportunityRankGroup {
  /** 0 critical, 1 high, 2 medium, 3 low; 4 means no readable severity. */
  readonly severityRank: number;
  readonly coverageCount: number;
  readonly findingCount: number;
  readonly urlCount: number;
}

/** Deterministic counts for one frozen generation, not a cross-run total. */
export interface GrowthMapUrlInventorySummary {
  readonly urlCount: number;
  readonly opportunityUrlCount: number;
  readonly listedUrlCount: number;
  readonly signalCount: number;
  readonly precedingUrlCount: number;
  readonly rankGroups: readonly GrowthMapOpportunityRankGroup[];
}

export interface GrowthMapObservationLookup {
  readonly snapshotIds: readonly string[];
  readonly sitePageIds: readonly string[];
}

type RawReadableRunRow = Omit<
  GrowthMapReadableRunRow,
  "created_at" | "run_completed_at"
> & {
  readonly created_at: string | Date;
  readonly run_completed_at: string | Date | null;
};

type RawUrlInventoryRow = Omit<
  GrowthMapUrlInventoryRow,
  "site_page_created_at" | "page_snapshot_captured_at"
> & {
  readonly site_page_created_at: string | Date;
  readonly page_snapshot_captured_at: string | Date | null;
};

interface GrowthMapOpportunityKeyset {
  readonly coverageCount: number;
  readonly priorityRank: number;
  readonly findingCount: number;
  readonly timestamp: string;
  readonly id: string;
}

type RawOpportunityUrlInventoryRow = RawUrlInventoryRow & {
  readonly opportunity_coverage_count: number;
  readonly opportunity_priority_rank: number;
  readonly opportunity_finding_count: number;
};

type RawUrlInventorySummaryRow = {
  readonly url_count: number | string;
  readonly opportunity_url_count: number | string;
  readonly listed_url_count: number | string;
  readonly signal_count: number | string;
  readonly preceding_url_count: number | string;
};

type RawOpportunityRankGroupRow = {
  readonly severity_rank: number | string;
  readonly coverage_count: number | string;
  readonly finding_count: number | string;
  readonly url_count: number | string;
};

type RawFindingCoverageRow = {
  readonly finding_id: string;
  readonly coverage_count: number | string;
};

/** PostgreSQL may hand back bigint counts as text; never coerce silently. */
function requiredCount(label: string, value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return parsed;
}

const CANONICAL_BASE64URL = /^[A-Za-z0-9_-]+$/u;

function encodeGrowthMapUrlCursor(keyset: GrowthMapOpportunityKeyset): string {
  return Buffer.from(JSON.stringify(keyset), "utf8").toString("base64url");
}

function decodeGrowthMapUrlCursor(
  cursor: string,
): GrowthMapOpportunityKeyset | null {
  if (!cursor || !CANONICAL_BASE64URL.test(cursor)) return null;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) return null;
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(",") !==
        "coverageCount,findingCount,id,priorityRank,timestamp" ||
      !Number.isSafeInteger(value["coverageCount"]) ||
      (value["coverageCount"] as number) < 0 ||
      !Number.isSafeInteger(value["priorityRank"]) ||
      (value["priorityRank"] as number) < 0 ||
      (value["priorityRank"] as number) > 4 ||
      !Number.isSafeInteger(value["findingCount"]) ||
      (value["findingCount"] as number) < 0 ||
      typeof value["timestamp"] !== "string" ||
      typeof value["id"] !== "string" ||
      decodeTimestampUuidCursor(
        encodeTimestampUuidCursor(value["timestamp"], value["id"]),
      ) === null
    ) {
      return null;
    }
    return value as unknown as GrowthMapOpportunityKeyset;
  } catch {
    return null;
  }
}

/** Public service guard for the composite coverage/priority URL keyset. */
export function isGrowthMapUrlCursorValid(cursor: string): boolean {
  return decodeGrowthMapUrlCursor(cursor) !== null;
}

function asIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeReadableRun(row: RawReadableRunRow): GrowthMapReadableRunRow {
  if (
    !(row.created_at instanceof Date) &&
    !(row.run_completed_at instanceof Date)
  ) {
    return row as GrowthMapReadableRunRow;
  }
  return {
    ...row,
    created_at: asIsoTimestamp(row.created_at),
    run_completed_at:
      row.run_completed_at === null
        ? null
        : asIsoTimestamp(row.run_completed_at),
  };
}

function normalizeUrlInventoryRow(
  row: RawUrlInventoryRow,
): GrowthMapUrlInventoryRow {
  if (
    !(row.site_page_created_at instanceof Date) &&
    !(row.page_snapshot_captured_at instanceof Date)
  ) {
    return row as GrowthMapUrlInventoryRow;
  }
  return {
    ...row,
    site_page_created_at: asIsoTimestamp(row.site_page_created_at),
    page_snapshot_captured_at:
      row.page_snapshot_captured_at === null
        ? null
        : asIsoTimestamp(row.page_snapshot_captured_at),
  };
}

function assertId(label: string, value: string): void {
  if (!UUID.test(value)) {
    throw new RangeError(`${label} must be a canonical UUID`);
  }
}

function uniqueBoundedIds(
  label: string,
  values: readonly string[],
  maximum: number,
): string[] {
  const unique = [...new Set(values)];
  if (unique.length > maximum) {
    throw new RangeError(`${label} accepts at most ${maximum} unique IDs`);
  }
  for (const id of unique) assertId(label, id);
  return unique;
}

function uuidList(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql`${value}::uuid`),
    sql`, `,
  );
}

function validateSearch(search: string | undefined): string | null {
  if (search === undefined) return null;
  if (
    search.length < 1 ||
    search.length > MAX_GROWTH_MAP_SEARCH_LENGTH ||
    search !== search.trim()
  ) {
    throw new RangeError(
      `search must be trimmed and contain 1 to ${MAX_GROWTH_MAP_SEARCH_LENGTH} characters`,
    );
  }
  return search;
}

/**
 * Shared immutable URL-membership relation for both portfolio and selected URL
 * reads. Keeping the CTE in one place prevents detail from silently widening
 * beyond the frozen DiagnosticRun inventory used by the list.
 */
function currentRunUrlInventoryCtes(
  scope: ProjectScope,
  diagnosticRunId: string,
) {
  return sql`
    with frozen_snapshot_manifest as (
      select
        frozen_manifest.snapshot_entry ->> 'snapshotId' as snapshot_id,
        frozen_manifest.snapshot_entry ->> 'provider' as provider
      from ${diagnosticRuns}
      inner join ${asyncRuns}
        on ${asyncRuns.id} = ${diagnosticRuns.id}
       and ${asyncRuns.workspace_id} = ${scope.workspaceId}
       and ${asyncRuns.project_id} = ${scope.projectId}
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(${diagnosticRuns.input_manifest} -> 'snapshots') = 'array'
            then ${diagnosticRuns.input_manifest} -> 'snapshots'
          else '[]'::jsonb
        end
      ) as frozen_manifest(snapshot_entry)
      where ${diagnosticRuns.workspace_id} = ${scope.workspaceId}
        and ${diagnosticRuns.project_id} = ${scope.projectId}
        and ${diagnosticRuns.id} = ${diagnosticRunId}
        and ${asyncRuns.kind} = 'diagnostic'
        and ${asyncRuns.status} in ('completed', 'partial')
    ), frozen_snapshots as (
      select ${dataSnapshots.id} as snapshot_id, ${dataSnapshots.provider} as provider
      from frozen_snapshot_manifest
      inner join ${dataSnapshots}
        on ${dataSnapshots.id}::text = frozen_snapshot_manifest.snapshot_id
       and ${dataSnapshots.provider} = frozen_snapshot_manifest.provider
      where ${dataSnapshots.workspace_id} = ${scope.workspaceId}
        and ${dataSnapshots.project_id} = ${scope.projectId}
    ), frozen_crawl_pages as (
      select
        ${pageSnapshots.site_page_id} as site_page_id,
        ${pageSnapshots.id} as page_snapshot_id,
        ${pageSnapshots.data_snapshot_id} as crawl_snapshot_id,
        ${pageSnapshots.content_hash} as page_snapshot_content_hash,
        ${pageSnapshots.canonical_extract} as page_snapshot_canonical_extract,
        ${pageSnapshots.extract} as page_snapshot_extract,
        ${pageSnapshots.captured_at} as page_snapshot_captured_at
      from frozen_snapshots
      inner join ${pageSnapshots}
        on ${pageSnapshots.data_snapshot_id} = frozen_snapshots.snapshot_id
      where frozen_snapshots.provider = 'crawl'
        and ${pageSnapshots.workspace_id} = ${scope.workspaceId}
        and ${pageSnapshots.project_id} = ${scope.projectId}
    ), inventory_site_page_ids as (
      select frozen_crawl_pages.site_page_id
      from frozen_crawl_pages
      union
      select ${normalizedObservations.site_page_id} as site_page_id
      from frozen_snapshots
      inner join ${normalizedObservations}
        on ${normalizedObservations.snapshot_id} = frozen_snapshots.snapshot_id
       and ${normalizedObservations.provider} = frozen_snapshots.provider
      where frozen_snapshots.provider in ('gsc', 'ga4')
        and ${normalizedObservations.workspace_id} = ${scope.workspaceId}
        and ${normalizedObservations.project_id} = ${scope.projectId}
        and ${normalizedObservations.site_page_id} is not null
        and ${normalizedObservations.subject_type} = 'url'
        and (
          (${normalizedObservations.provider} = 'gsc'
            and ${normalizedObservations.metric_key} = 'gsc.page.v1')
          or (${normalizedObservations.provider} = 'ga4'
            and ${normalizedObservations.metric_key} = 'ga4.landing.v1')
        )
    ), inventory as (
      select
        ${sitePages.workspace_id} as workspace_id,
        ${sitePages.project_id} as project_id,
        ${sitePages.id} as site_page_id,
        ${sitePages.site_id} as site_id,
        ${sitePages.normalized_url} as normalized_url,
        ${sitePages.normalized_url_hash} as normalized_url_hash,
        null::text as template_key,
        ${sitePages.created_at} as site_page_created_at,
        frozen_crawl_pages.page_snapshot_id,
        frozen_crawl_pages.crawl_snapshot_id,
        frozen_crawl_pages.page_snapshot_content_hash,
        frozen_crawl_pages.page_snapshot_canonical_extract,
        frozen_crawl_pages.page_snapshot_extract,
        frozen_crawl_pages.page_snapshot_captured_at
      from inventory_site_page_ids
      inner join ${sitePages}
        on ${sitePages.id} = inventory_site_page_ids.site_page_id
      left join frozen_crawl_pages
        on frozen_crawl_pages.site_page_id = ${sitePages.id}
      where ${sitePages.workspace_id} = ${scope.workspaceId}
        and ${sitePages.project_id} = ${scope.projectId}
    )
  `;
}

/**
 * Shared Opportunity aggregation for both the URL page and its generation-wide
 * summary.
 *
 * `finding_coverage` is one Finding's cross-page blast radius inside this run;
 * `opportunity_sort` reduces it to the per-SitePage keyset (widest blast
 * radius, then strongest severity, then most stacked Findings). Both exclude
 * inactive and ignored Findings so a human review decision actually removes a
 * URL from the Opportunity list instead of only hiding one Finding on it.
 */
function opportunitySortCtes(scope: ProjectScope, diagnosticRunId: string) {
  return sql`
    , finding_coverage as (
      select
        ${findingTargets.finding_id} as finding_id,
        count(distinct ${findingTargets.site_page_id})::integer as coverage_count
      from ${findingTargets}
      inner join ${findings}
        on ${findings.id} = ${findingTargets.finding_id}
       and ${findings.workspace_id} = ${scope.workspaceId}
       and ${findings.project_id} = ${scope.projectId}
       and ${findings.last_seen_run_id} = ${diagnosticRunId}::uuid
       and ${findings.active}
       and ${findings.review_state} <> 'ignored'
      where ${findingTargets.workspace_id} = ${scope.workspaceId}
        and ${findingTargets.project_id} = ${scope.projectId}
        and ${findingTargets.diagnostic_run_id} = ${diagnosticRunId}::uuid
        and ${findingTargets.resolution_state} = 'resolved'
        and ${findingTargets.site_page_id} is not null
      group by ${findingTargets.finding_id}
    ), opportunity_sort as (
      select
        ${findingTargets.site_page_id} as site_page_id,
        max(finding_coverage.coverage_count)::integer as coverage_count,
        min(
          case ${findings.severity}
            when 'critical' then 0
            when 'high' then 1
            when 'medium' then 2
            when 'low' then 3
            else 4
          end
        )::integer as priority_rank,
        count(distinct ${findingTargets.finding_id})::integer as finding_count
      from ${findingTargets}
      inner join ${findings}
        on ${findings.id} = ${findingTargets.finding_id}
       and ${findings.workspace_id} = ${scope.workspaceId}
       and ${findings.project_id} = ${scope.projectId}
       and ${findings.last_seen_run_id} = ${diagnosticRunId}::uuid
       and ${findings.active}
       and ${findings.review_state} <> 'ignored'
      inner join finding_coverage
        on finding_coverage.finding_id = ${findingTargets.finding_id}
      where ${findingTargets.workspace_id} = ${scope.workspaceId}
        and ${findingTargets.project_id} = ${scope.projectId}
        and ${findingTargets.diagnostic_run_id} = ${diagnosticRunId}::uuid
        and ${findingTargets.resolution_state} = 'resolved'
        and ${findingTargets.site_page_id} is not null
      group by ${findingTargets.site_page_id}
    )
  `;
}

/** Rows strictly after the cursor row in the composite Opportunity order. */
function afterOpportunityCursor(cursor: GrowthMapOpportunityKeyset | null) {
  if (cursor === null) return sql`true`;
  return sql`(
    coalesce(opportunity_sort.coverage_count, 0) < ${cursor.coverageCount}
    or (coalesce(opportunity_sort.coverage_count, 0) = ${cursor.coverageCount}
      and coalesce(opportunity_sort.priority_rank, 4) > ${cursor.priorityRank})
    or (coalesce(opportunity_sort.coverage_count, 0) = ${cursor.coverageCount}
      and coalesce(opportunity_sort.priority_rank, 4) = ${cursor.priorityRank}
      and coalesce(opportunity_sort.finding_count, 0) < ${cursor.findingCount})
    or (coalesce(opportunity_sort.coverage_count, 0) = ${cursor.coverageCount}
      and coalesce(opportunity_sort.priority_rank, 4) = ${cursor.priorityRank}
      and coalesce(opportunity_sort.finding_count, 0) = ${cursor.findingCount}
      and inventory.site_page_created_at > ${cursor.timestamp})
    or (coalesce(opportunity_sort.coverage_count, 0) = ${cursor.coverageCount}
      and coalesce(opportunity_sort.priority_rank, 4) = ${cursor.priorityRank}
      and coalesce(opportunity_sort.finding_count, 0) = ${cursor.findingCount}
      and inventory.site_page_created_at = ${cursor.timestamp}
      and inventory.site_page_id > ${cursor.id}::uuid)
  )`;
}

/**
 * Complete published Growth Audit relation shared by both latest-generation
 * and exact-generation reads. Callers may narrow or order this relation, but
 * must not reconstruct any part of its publication lineage independently.
 */
function publishedGrowthAuditRuns(
  scope: ProjectScope,
  diagnosticRunId: string | null,
) {
  return sql`
    with canonical_completed_collection_steps as (
      select
        collection_step.analysis_refresh_run_id,
        collection_step.step_key
      from ${analysisRefreshSteps} as collection_step
      inner join ${asyncRuns} as collection_child
        on collection_child.id = collection_step.child_async_run_id
       and collection_child.workspace_id = ${scope.workspaceId}
       and collection_child.project_id = ${scope.projectId}
       and collection_child.kind = 'collection'
       and collection_child.status in ('completed', 'partial')
       and collection_child.result_type = 'collection_run'
       and collection_child.result_id = collection_child.id
       and collection_child.completed_at is not null
      inner join ${collectionRuns} as collection_run
        on collection_run.id = collection_child.id
       and collection_run.workspace_id = ${scope.workspaceId}
       and collection_run.project_id = ${scope.projectId}
       and collection_run.provider = case collection_step.step_key
         when 'dataforseo_backlinks' then 'dataforseo'
         else collection_step.step_key
       end
      inner join ${dataSnapshots} as result_snapshot
        on result_snapshot.id = collection_step.result_snapshot_id
       and result_snapshot.workspace_id = ${scope.workspaceId}
       and result_snapshot.project_id = ${scope.projectId}
       and result_snapshot.collection_run_id = collection_child.id
       and result_snapshot.source_connection_id = collection_run.source_connection_id
       and result_snapshot.provider = case collection_step.step_key
         when 'dataforseo_backlinks' then 'dataforseo'
         else collection_step.step_key
       end
       and result_snapshot.availability in ('available', 'partial')
      where collection_step.workspace_id = ${scope.workspaceId}
        and collection_step.project_id = ${scope.projectId}
        and collection_step.step_key in (
          'crawl',
          'gsc',
          'ga4',
          'dataforseo',
          'dataforseo_backlinks'
        )
        and collection_step.state = 'completed'
        and (
          (
            collection_step.step_key = 'crawl'
            and collection_run.operation = 'site_graph'
            and collection_run.method_version = 'crawl.site_graph.v2'
            and result_snapshot.dataset_key = 'crawl.site_graph.v1'
            and result_snapshot.method_version = 'crawl.site_graph.v2'
          )
          or (
            collection_step.step_key = 'gsc'
            and collection_run.operation = 'search_analytics'
            and collection_run.method_version = 'gsc.page_query_daily.v1'
            and result_snapshot.dataset_key = 'gsc.page_query_daily.v1'
            and result_snapshot.method_version = 'gsc.page_query_daily.v1'
          )
          or (
            collection_step.step_key = 'ga4'
            and collection_run.operation = 'organic_landing'
            and collection_run.method_version = 'ga4.organic_landing_daily.v1'
            and result_snapshot.dataset_key = 'ga4.organic_landing_daily.v1'
            and result_snapshot.method_version = 'ga4.organic_landing_daily.v1'
          )
          or (
            collection_step.step_key = 'dataforseo'
            and collection_run.operation = 'search_landscape'
            and (
              (
                collection_run.method_version = 'dataforseo.search_landscape.v1'
                and result_snapshot.dataset_key = 'dataforseo.search_landscape.v1'
                and result_snapshot.schema_version = 'dataforseo.search_landscape.v1'
                and result_snapshot.method_version = 'dataforseo.search_landscape.v1'
              )
              or (
                collection_run.method_version = 'dataforseo.search_landscape.v2'
                and result_snapshot.dataset_key = 'dataforseo.search_landscape.v2'
                and result_snapshot.schema_version = 'dataforseo.search_landscape.v2'
                and result_snapshot.method_version = 'dataforseo.search_landscape.v2'
              )
              or (
                collection_run.method_version = 'dataforseo.search_landscape.v3'
                and result_snapshot.dataset_key = 'dataforseo.search_landscape.v3'
                and result_snapshot.schema_version = 'dataforseo.search_landscape.v3'
                and result_snapshot.method_version = 'dataforseo.search_landscape.v3'
              )
            )
          )
          or (
            collection_step.step_key = 'dataforseo_backlinks'
            and collection_run.operation = 'backlinks'
            and collection_run.method_version = 'dataforseo.backlinks.v1'
            and result_snapshot.dataset_key = 'dataforseo.backlinks.v1'
            and result_snapshot.schema_version = 'dataforseo.backlinks.v1'
            and result_snapshot.method_version = 'dataforseo.backlinks.v1'
          )
        )
    ), canonical_completed_topic_model_steps as (
      select topic_step.analysis_refresh_run_id
      from ${analysisRefreshSteps} as topic_step
      inner join ${asyncRuns} as topic_child
        on topic_child.id = topic_step.child_async_run_id
       and topic_child.workspace_id = ${scope.workspaceId}
       and topic_child.project_id = ${scope.projectId}
       and topic_child.kind = 'topic_model_generation'
       and topic_child.status = 'completed'
       and topic_child.result_type = 'topic_model_generation_run'
       and topic_child.result_id = topic_child.id
       and topic_child.completed_at is not null
      inner join ${topicModelGenerationRuns} as topic_model_run
        on topic_model_run.id = topic_child.id
       and topic_model_run.workspace_id = ${scope.workspaceId}
       and topic_model_run.project_id = ${scope.projectId}
       and topic_model_run.analysis_refresh_run_id = topic_step.analysis_refresh_run_id
      where topic_step.workspace_id = ${scope.workspaceId}
        and topic_step.project_id = ${scope.projectId}
        and topic_step.step_key = 'topic_model'
        and topic_step.state = 'completed'
    ), publishable_analysis_refreshes as (
      select
        ${asyncRuns.id} as id,
        ${asyncRuns.completed_at} as completed_at
      from ${asyncRuns}
      inner join ${analysisRefreshRuns} as publication_plan
        on publication_plan.id = ${asyncRuns.id}
       and publication_plan.workspace_id = ${scope.workspaceId}
       and publication_plan.project_id = ${scope.projectId}
      where ${asyncRuns.workspace_id} = ${scope.workspaceId}
        and ${asyncRuns.project_id} = ${scope.projectId}
        and ${asyncRuns.kind} = 'analysis_refresh'
        and ${asyncRuns.status} in ('completed', 'partial')
        and ${asyncRuns.result_type} = 'analysis_refresh_run'
        and ${asyncRuns.result_id} = ${asyncRuns.id}
        and ${asyncRuns.completed_at} is not null
        and exists (
          select 1
          from ${analysisRefreshSteps}
          where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
            and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
            and ${analysisRefreshSteps.project_id} = ${scope.projectId}
            and ${analysisRefreshSteps.ordinal} = 1
            and ${analysisRefreshSteps.step_key} = 'crawl'
            and ${analysisRefreshSteps.required}
            and ${analysisRefreshSteps.state} = 'completed'
            and exists (
              select 1
              from canonical_completed_collection_steps
              where canonical_completed_collection_steps.analysis_refresh_run_id = ${asyncRuns.id}
                and canonical_completed_collection_steps.step_key = 'crawl'
            )
        )
        and exists (
          select 1
          from ${analysisRefreshSteps}
          where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
            and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
            and ${analysisRefreshSteps.project_id} = ${scope.projectId}
            and ${analysisRefreshSteps.ordinal} = 2
            and ${analysisRefreshSteps.step_key} = 'gsc'
            and not ${analysisRefreshSteps.required}
            and ${analysisRefreshSteps.state} in ('completed', 'skipped', 'failed')
            and (
              ${analysisRefreshSteps.state} <> 'completed'
              or exists (
                select 1
                from canonical_completed_collection_steps
                where canonical_completed_collection_steps.analysis_refresh_run_id = ${asyncRuns.id}
                  and canonical_completed_collection_steps.step_key = 'gsc'
              )
            )
        )
        and exists (
          select 1
          from ${analysisRefreshSteps}
          where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
            and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
            and ${analysisRefreshSteps.project_id} = ${scope.projectId}
            and ${analysisRefreshSteps.ordinal} = 3
            and ${analysisRefreshSteps.step_key} = 'ga4'
            and not ${analysisRefreshSteps.required}
            and ${analysisRefreshSteps.state} in ('completed', 'skipped', 'failed')
            and (
              ${analysisRefreshSteps.state} <> 'completed'
              or exists (
                select 1
                from canonical_completed_collection_steps
                where canonical_completed_collection_steps.analysis_refresh_run_id = ${asyncRuns.id}
                  and canonical_completed_collection_steps.step_key = 'ga4'
              )
            )
        )
        and exists (
          select 1
          from ${analysisRefreshSteps}
          where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
            and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
            and ${analysisRefreshSteps.project_id} = ${scope.projectId}
            and ${analysisRefreshSteps.ordinal} = 4
            and ${analysisRefreshSteps.step_key} = 'dataforseo'
            and not ${analysisRefreshSteps.required}
            and ${analysisRefreshSteps.state} in ('completed', 'skipped', 'failed')
            and (
              ${analysisRefreshSteps.state} <> 'completed'
              or exists (
                select 1
                from canonical_completed_collection_steps
                where canonical_completed_collection_steps.analysis_refresh_run_id = ${asyncRuns.id}
                  and canonical_completed_collection_steps.step_key = 'dataforseo'
              )
            )
        )
        and (
          (
            publication_plan.plan_manifest = ${PUBLISHED_PLAN_V1.manifestJson}::jsonb
            and publication_plan.plan_hash = ${PUBLISHED_PLAN_V1.planHash}
            and exists (
              select 1
              from ${analysisRefreshSteps}
              where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
                and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
                and ${analysisRefreshSteps.project_id} = ${scope.projectId}
                and ${analysisRefreshSteps.ordinal} = 5
                and ${analysisRefreshSteps.step_key} = 'growth_audit'
                and ${analysisRefreshSteps.required}
                and ${analysisRefreshSteps.state} = 'completed'
            )
          )
          or (
            publication_plan.plan_manifest = ${PUBLISHED_PLAN_V2.manifestJson}::jsonb
            and publication_plan.plan_hash = ${PUBLISHED_PLAN_V2.planHash}
            and exists (
              select 1
              from ${analysisRefreshSteps}
              where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
                and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
                and ${analysisRefreshSteps.project_id} = ${scope.projectId}
                and ${analysisRefreshSteps.ordinal} = 5
                and ${analysisRefreshSteps.step_key} = 'dataforseo_backlinks'
                and not ${analysisRefreshSteps.required}
                and ${analysisRefreshSteps.state} in ('completed', 'skipped', 'failed')
                and (
                  ${analysisRefreshSteps.state} <> 'completed'
                  or exists (
                    select 1
                    from canonical_completed_collection_steps
                    where canonical_completed_collection_steps.analysis_refresh_run_id = ${asyncRuns.id}
                      and canonical_completed_collection_steps.step_key = 'dataforseo_backlinks'
                  )
                )
            )
            and exists (
              select 1
              from ${analysisRefreshSteps}
              where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
                and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
                and ${analysisRefreshSteps.project_id} = ${scope.projectId}
                and ${analysisRefreshSteps.ordinal} = 6
                and ${analysisRefreshSteps.step_key} = 'growth_audit'
                and ${analysisRefreshSteps.required}
                and ${analysisRefreshSteps.state} = 'completed'
            )
          )
          or (
            publication_plan.plan_manifest = ${PUBLISHED_PLAN_V3.manifestJson}::jsonb
            and publication_plan.plan_hash = ${PUBLISHED_PLAN_V3.planHash}
            and exists (
              select 1
              from ${analysisRefreshSteps}
              where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
                and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
                and ${analysisRefreshSteps.project_id} = ${scope.projectId}
                and ${analysisRefreshSteps.ordinal} = 5
                and ${analysisRefreshSteps.step_key} = 'dataforseo_backlinks'
                and not ${analysisRefreshSteps.required}
                and ${analysisRefreshSteps.state} in ('completed', 'skipped', 'failed')
                and (
                  ${analysisRefreshSteps.state} <> 'completed'
                  or exists (
                    select 1
                    from canonical_completed_collection_steps
                    where canonical_completed_collection_steps.analysis_refresh_run_id = ${asyncRuns.id}
                      and canonical_completed_collection_steps.step_key = 'dataforseo_backlinks'
                  )
                )
            )
            and exists (
              select 1
              from ${analysisRefreshSteps}
              where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
                and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
                and ${analysisRefreshSteps.project_id} = ${scope.projectId}
                and ${analysisRefreshSteps.ordinal} = 6
                and ${analysisRefreshSteps.step_key} = 'topic_model'
                and not ${analysisRefreshSteps.required}
                and ${analysisRefreshSteps.state} in ('completed', 'skipped', 'failed')
                and (
                  ${analysisRefreshSteps.state} <> 'completed'
                  or exists (
                    select 1
                    from canonical_completed_topic_model_steps
                    where canonical_completed_topic_model_steps.analysis_refresh_run_id = ${asyncRuns.id}
                  )
                )
            )
            and exists (
              select 1
              from ${analysisRefreshSteps}
              where ${analysisRefreshSteps.analysis_refresh_run_id} = ${asyncRuns.id}
                and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
                and ${analysisRefreshSteps.project_id} = ${scope.projectId}
                and ${analysisRefreshSteps.ordinal} = 7
                and ${analysisRefreshSteps.step_key} = 'growth_audit'
                and ${analysisRefreshSteps.required}
                and ${analysisRefreshSteps.state} = 'completed'
            )
          )
        )
    )
    select
      ${diagnosticRuns.id} as id,
      ${diagnosticRuns.workspace_id} as workspace_id,
      ${diagnosticRuns.project_id} as project_id,
      ${diagnosticRuns.site_id} as site_id,
      ${diagnosticRuns.icp_profile_id} as icp_profile_id,
      ${diagnosticRuns.icp_profile_version} as icp_profile_version,
      ${diagnosticRuns.rule_set_version} as rule_set_version,
      ${diagnosticRuns.prompt_set_version} as prompt_set_version,
      ${diagnosticRuns.output_locale} as output_locale,
      ${diagnosticRuns.input_manifest} as input_manifest,
      ${diagnosticRuns.input_hash} as input_hash,
      ${diagnosticRuns.coverage} as coverage,
      ${diagnosticRuns.created_at} as created_at,
      ${asyncRuns.status} as run_status,
      ${asyncRuns.completed_at} as run_completed_at
    from ${diagnosticRuns}
    inner join ${asyncRuns}
      on ${asyncRuns.id} = ${diagnosticRuns.id}
     and ${asyncRuns.workspace_id} = ${scope.workspaceId}
     and ${asyncRuns.project_id} = ${scope.projectId}
     and ${asyncRuns.kind} = 'diagnostic'
     and ${asyncRuns.status} in ('completed', 'partial')
     and ${asyncRuns.result_type} = 'diagnostic_run'
     and ${asyncRuns.result_id} = ${diagnosticRuns.id}
     and ${asyncRuns.completed_at} is not null
    inner join ${analysisRefreshSteps}
      on ${analysisRefreshSteps.child_async_run_id} = ${diagnosticRuns.id}
     and ${analysisRefreshSteps.workspace_id} = ${scope.workspaceId}
     and ${analysisRefreshSteps.project_id} = ${scope.projectId}
     and ${analysisRefreshSteps.step_key} = 'growth_audit'
     and ${analysisRefreshSteps.state} = 'completed'
    inner join ${analysisRefreshRuns}
      on ${analysisRefreshRuns.id} = ${analysisRefreshSteps.analysis_refresh_run_id}
     and ${analysisRefreshRuns.workspace_id} = ${scope.workspaceId}
     and ${analysisRefreshRuns.project_id} = ${scope.projectId}
     and ${analysisRefreshRuns.site_id} = ${diagnosticRuns.site_id}
     and ${analysisRefreshRuns.icp_profile_id} = ${diagnosticRuns.icp_profile_id}
    inner join publishable_analysis_refreshes
      on publishable_analysis_refreshes.id = ${analysisRefreshRuns.id}
    inner join ${auditRuns}
      on ${auditRuns.diagnostic_run_id} = ${diagnosticRuns.id}
     and ${auditRuns.workspace_id} = ${scope.workspaceId}
     and ${auditRuns.project_id} = ${scope.projectId}
     and ${
       diagnosticRunId === null
         ? sql`${auditRuns.projection_version} = ${GROWTH_AUDIT_PROJECTION_VERSION}`
         : sql`${auditRuns.projection_version} in (${GROWTH_AUDIT_PROJECTION_VERSION}, ${LEGACY_GROWTH_AUDIT_PROJECTION_VERSION})`
     }
     and ${auditRuns.scope_kind} = 'site'
     and ${auditRuns.scope_key} = ${diagnosticRuns.site_id}::text
    where ${diagnosticRuns.workspace_id} = ${scope.workspaceId}
      and ${diagnosticRuns.project_id} = ${scope.projectId}
      ${
        diagnosticRunId === null
          ? sql``
          : sql`and ${diagnosticRuns.id} = ${diagnosticRunId}::uuid`
      }
  `;
}

/**
 * Bounded, project-scoped read model for the URL-first Growth Map. Every URL
 * identity is selected from the current DiagnosticRun's immutable manifest;
 * Finding membership comes only from the per-run finding_targets ledger.
 */
export class GrowthMapReadRepository extends Repository {
  async findLatestReadableRun(
    scope: ProjectScope,
  ): Promise<GrowthMapReadableRunRow | null> {
    const result = await this.exec.execute<RawReadableRunRow>(sql`
      ${publishedGrowthAuditRuns(scope, null)}
      order by
        publishable_analysis_refreshes.completed_at desc,
        publishable_analysis_refreshes.id desc,
        ${diagnosticRuns.id} desc
      limit 1
    `);
    const row = result.rows[0];
    return row ? normalizeReadableRun(row) : null;
  }

  async findReadableRunById(
    scope: ProjectScope,
    diagnosticRunId: string,
  ): Promise<GrowthMapReadableRunRow | null> {
    assertId("diagnosticRunId", diagnosticRunId);
    const result = await this.exec.execute<RawReadableRunRow>(sql`
      ${publishedGrowthAuditRuns(scope, diagnosticRunId)}
      limit 1
    `);
    const row = result.rows[0];
    return row ? normalizeReadableRun(row) : null;
  }

  async listCurrentRunUrls(
    scope: ProjectScope,
    diagnosticRunId: string,
    options: GrowthMapUrlInventoryOptions,
  ): Promise<GrowthMapUrlInventoryPage> {
    assertId("diagnosticRunId", diagnosticRunId);
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_GROWTH_MAP_URL_PAGE_SIZE
    ) {
      throw new RangeError(
        `limit must be a safe integer between 1 and ${MAX_GROWTH_MAP_URL_PAGE_SIZE}`,
      );
    }
    const search = validateSearch(options.search);
    const cursor = options.cursor
      ? decodeGrowthMapUrlCursor(options.cursor)
      : null;
    if (options.cursor && !cursor) {
      throw new RangeError("cursor is not a canonical SitePage keyset");
    }

    const result = await this.exec.execute<RawOpportunityUrlInventoryRow>(sql`
      ${currentRunUrlInventoryCtes(scope, diagnosticRunId)}
      ${opportunitySortCtes(scope, diagnosticRunId)}
      select
        inventory.*,
        coalesce(opportunity_sort.coverage_count, 0)::integer as opportunity_coverage_count,
        coalesce(opportunity_sort.priority_rank, 4)::integer as opportunity_priority_rank,
        coalesce(opportunity_sort.finding_count, 0)::integer as opportunity_finding_count
      from inventory
      left join opportunity_sort
        on opportunity_sort.site_page_id = inventory.site_page_id
      where ${search === null ? sql`true` : sql`position(lower(${search}) in lower(normalized_url)) > 0`}
        and ${options.opportunitiesOnly === false ? sql`true` : sql`coalesce(opportunity_sort.finding_count, 0) > 0`}
        and ${afterOpportunityCursor(cursor)}
      order by
        opportunity_coverage_count desc,
        opportunity_priority_rank asc,
        opportunity_finding_count desc,
        inventory.site_page_created_at asc,
        inventory.site_page_id asc
      limit ${options.limit + 1}
    `);

    const hasNext = result.rows.length > options.limit;
    const rawRows = hasNext ? result.rows.slice(0, options.limit) : result.rows;
    const rows = rawRows.map(normalizeUrlInventoryRow);
    const last = rawRows.at(-1);
    return {
      rows,
      nextCursor:
        hasNext && last
          ? encodeGrowthMapUrlCursor({
              coverageCount: last.opportunity_coverage_count ?? 0,
              priorityRank: last.opportunity_priority_rank ?? 4,
              findingCount: last.opportunity_finding_count ?? 0,
              timestamp: asIsoTimestamp(last.site_page_created_at),
              id: last.site_page_id,
            })
          : null,
    };
  }

  /**
   * Count the whole frozen generation behind one cursor page.
   *
   * Keyset paging carries no offset and a page can never see beyond its own
   * rows, so every generation-wide number a customer reads has to be counted
   * here. `urlCount` and `opportunityUrlCount` ignore the list filters on
   * purpose: they describe the admitted inventory, while `listedUrlCount` and
   * `precedingUrlCount` describe the exact filtered list the caller is paging.
   */
  async summarizeCurrentRunUrls(
    scope: ProjectScope,
    diagnosticRunId: string,
    options: GrowthMapUrlSummaryOptions,
  ): Promise<GrowthMapUrlInventorySummary> {
    assertId("diagnosticRunId", diagnosticRunId);
    const search = validateSearch(options.search);
    const cursor = options.cursor
      ? decodeGrowthMapUrlCursor(options.cursor)
      : null;
    if (options.cursor && !cursor) {
      throw new RangeError("cursor is not a canonical SitePage keyset");
    }

    const totals = await this.exec.execute<RawUrlInventorySummaryRow>(sql`
      ${currentRunUrlInventoryCtes(scope, diagnosticRunId)}
      ${opportunitySortCtes(scope, diagnosticRunId)}
      , inventory_signals as (
        select distinct ${findingTargets.finding_id} as finding_id
        from ${findingTargets}
        inner join ${findings}
          on ${findings.id} = ${findingTargets.finding_id}
         and ${findings.workspace_id} = ${scope.workspaceId}
         and ${findings.project_id} = ${scope.projectId}
         and ${findings.last_seen_run_id} = ${diagnosticRunId}::uuid
         and ${findings.active}
         and ${findings.review_state} <> 'ignored'
        inner join inventory
          on inventory.site_page_id = ${findingTargets.site_page_id}
        where ${findingTargets.workspace_id} = ${scope.workspaceId}
          and ${findingTargets.project_id} = ${scope.projectId}
          and ${findingTargets.diagnostic_run_id} = ${diagnosticRunId}::uuid
          and ${findingTargets.resolution_state} = 'resolved'
          and ${findingTargets.site_page_id} is not null
      ), scored as (
        select
          coalesce(opportunity_sort.finding_count, 0)::integer as finding_count,
          (${search === null ? sql`true` : sql`position(lower(${search}) in lower(normalized_url)) > 0`}) as matches_search,
          (${options.opportunitiesOnly === false ? sql`true` : sql`coalesce(opportunity_sort.finding_count, 0) > 0`}) as is_listed,
          (${afterOpportunityCursor(cursor)}) as after_cursor
        from inventory
        left join opportunity_sort
          on opportunity_sort.site_page_id = inventory.site_page_id
      )
      select
        count(*)::integer as url_count,
        count(*) filter (where finding_count > 0)::integer as opportunity_url_count,
        count(*) filter (where matches_search and is_listed)::integer as listed_url_count,
        count(*) filter (
          where matches_search and is_listed and not after_cursor
        )::integer as preceding_url_count,
        (select count(*)::integer from inventory_signals) as signal_count
      from scored
    `);
    const totalsRow = totals.rows[0];
    if (!totalsRow) {
      throw new RangeError("Growth Map URL summary returned no aggregate row");
    }

    const groups = await this.exec.execute<RawOpportunityRankGroupRow>(sql`
      ${currentRunUrlInventoryCtes(scope, diagnosticRunId)}
      ${opportunitySortCtes(scope, diagnosticRunId)}
      select
        opportunity_sort.priority_rank::integer as severity_rank,
        opportunity_sort.coverage_count::integer as coverage_count,
        opportunity_sort.finding_count::integer as finding_count,
        count(*)::integer as url_count
      from inventory
      inner join opportunity_sort
        on opportunity_sort.site_page_id = inventory.site_page_id
      where opportunity_sort.finding_count > 0
      group by 1, 2, 3
      order by 1 asc, 2 desc, 3 desc
    `);

    return {
      urlCount: requiredCount("urlCount", totalsRow.url_count),
      opportunityUrlCount: requiredCount(
        "opportunityUrlCount",
        totalsRow.opportunity_url_count,
      ),
      listedUrlCount: requiredCount(
        "listedUrlCount",
        totalsRow.listed_url_count,
      ),
      signalCount: requiredCount("signalCount", totalsRow.signal_count),
      precedingUrlCount: requiredCount(
        "precedingUrlCount",
        totalsRow.preceding_url_count,
      ),
      rankGroups: groups.rows.map((row) => ({
        severityRank: requiredCount("severityRank", row.severity_rank),
        coverageCount: requiredCount("coverageCount", row.coverage_count),
        findingCount: requiredCount("findingCount", row.finding_count),
        urlCount: requiredCount("urlCount", row.url_count),
      })),
    };
  }

  /**
   * Cross-page blast radius of the given Findings inside one frozen run, using
   * the same definition the Opportunity keyset sorts by. A URL priority is only
   * allowed to weigh a Finding's reach through this shared count.
   */
  async listFindingCoverageCounts(
    scope: ProjectScope,
    diagnosticRunId: string,
    findingIdsInput: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    assertId("diagnosticRunId", diagnosticRunId);
    const findingIds = uniqueBoundedIds(
      "findingIds",
      findingIdsInput,
      MAX_GROWTH_MAP_ENTITY_LOOKUP,
    );
    if (findingIds.length === 0) return new Map();

    const result = await this.exec.execute<RawFindingCoverageRow>(sql`
      select
        ${findingTargets.finding_id} as finding_id,
        count(distinct ${findingTargets.site_page_id})::integer as coverage_count
      from ${findingTargets}
      where ${findingTargets.workspace_id} = ${scope.workspaceId}
        and ${findingTargets.project_id} = ${scope.projectId}
        and ${findingTargets.diagnostic_run_id} = ${diagnosticRunId}
        and ${findingTargets.resolution_state} = 'resolved'
        and ${findingTargets.site_page_id} is not null
        and ${findingTargets.finding_id} in (${uuidList(findingIds)})
      group by ${findingTargets.finding_id}
      order by ${findingTargets.finding_id} asc
    `);
    return new Map(
      result.rows.map((row) => [
        row.finding_id,
        requiredCount("coverageCount", row.coverage_count),
      ]),
    );
  }

  /**
   * Resolve one selected SitePage only when it belongs to the exact immutable
   * inventory of the requested readable DiagnosticRun. This is intentionally
   * not implemented as a search or an unbounded pagination scan.
   */
  async findCurrentRunUrl(
    scope: ProjectScope,
    diagnosticRunId: string,
    sitePageId: string,
  ): Promise<GrowthMapUrlInventoryRow | null> {
    assertId("diagnosticRunId", diagnosticRunId);
    assertId("sitePageId", sitePageId);

    const result = await this.exec.execute<RawUrlInventoryRow>(sql`
      ${currentRunUrlInventoryCtes(scope, diagnosticRunId)}
      select *
      from inventory
      where site_page_id = ${sitePageId}::uuid
      limit 1
    `);
    const row = result.rows[0];
    return row ? normalizeUrlInventoryRow(row) : null;
  }

  async listObservations(
    scope: ProjectScope,
    lookup: GrowthMapObservationLookup,
  ): Promise<ObservationRow[]> {
    const snapshotIds = uniqueBoundedIds(
      "snapshotIds",
      lookup.snapshotIds,
      MAX_GROWTH_MAP_SNAPSHOT_LOOKUP,
    );
    const sitePageIds = uniqueBoundedIds(
      "sitePageIds",
      lookup.sitePageIds,
      MAX_GROWTH_MAP_ENTITY_LOOKUP,
    );
    if (snapshotIds.length === 0 || sitePageIds.length === 0) return [];

    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select *
      from ${normalizedObservations}
      where ${normalizedObservations.workspace_id} = ${scope.workspaceId}
        and ${normalizedObservations.project_id} = ${scope.projectId}
        and ${normalizedObservations.snapshot_id} in (${uuidList(snapshotIds)})
        and ${normalizedObservations.site_page_id} in (${uuidList(sitePageIds)})
      order by
        ${normalizedObservations.site_page_id} asc,
        ${normalizedObservations.provider} asc,
        ${normalizedObservations.metric_key} asc,
        ${normalizedObservations.id} asc
    `);
    return result.rows as unknown as ObservationRow[];
  }

  async listResolvedTargets(
    scope: ProjectScope,
    diagnosticRunId: string,
    sitePageIdsInput: readonly string[],
  ): Promise<FindingTargetRow[]> {
    assertId("diagnosticRunId", diagnosticRunId);
    const sitePageIds = uniqueBoundedIds(
      "sitePageIds",
      sitePageIdsInput,
      MAX_GROWTH_MAP_ENTITY_LOOKUP,
    );
    if (sitePageIds.length === 0) return [];

    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select *
      from ${findingTargets}
      where ${findingTargets.workspace_id} = ${scope.workspaceId}
        and ${findingTargets.project_id} = ${scope.projectId}
        and ${findingTargets.diagnostic_run_id} = ${diagnosticRunId}
        and ${findingTargets.resolution_state} = 'resolved'
        and ${findingTargets.site_page_id} in (${uuidList(sitePageIds)})
      order by
        ${findingTargets.site_page_id} asc,
        ${findingTargets.finding_id} asc,
        ${findingTargets.relation_key} asc,
        ${findingTargets.id} asc
    `);
    return result.rows as unknown as FindingTargetRow[];
  }

  async listFindings(
    scope: ProjectScope,
    diagnosticRunId: string,
    findingIdsInput: readonly string[],
  ): Promise<FindingRow[]> {
    assertId("diagnosticRunId", diagnosticRunId);
    const findingIds = uniqueBoundedIds(
      "findingIds",
      findingIdsInput,
      MAX_GROWTH_MAP_ENTITY_LOOKUP,
    );
    if (findingIds.length === 0) return [];

    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select *
      from ${findings}
      where ${findings.workspace_id} = ${scope.workspaceId}
        and ${findings.project_id} = ${scope.projectId}
        and ${findings.id} in (${uuidList(findingIds)})
        and ${findings.last_seen_run_id} = ${diagnosticRunId}
      order by ${findings.id} asc
    `);
    return result.rows as unknown as FindingRow[];
  }

  async listActiveActions(
    scope: ProjectScope,
    findingIdsInput: readonly string[],
  ): Promise<ActionRow[]> {
    const findingIds = uniqueBoundedIds(
      "findingIds",
      findingIdsInput,
      MAX_GROWTH_MAP_ENTITY_LOOKUP,
    );
    if (findingIds.length === 0) return [];

    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select *
      from ${actions}
      where ${actions.workspace_id} = ${scope.workspaceId}
        and ${actions.project_id} = ${scope.projectId}
        and ${actions.source_finding_id} in (${uuidList(findingIds)})
        and ${actions.status} <> 'dismissed'
      order by ${actions.source_finding_id} asc, ${actions.created_at} asc, ${actions.id} asc
    `);
    return result.rows as unknown as ActionRow[];
  }

  async listArtifacts(
    scope: ProjectScope,
    actionIdsInput: readonly string[],
  ): Promise<ArtifactRow[]> {
    const actionIds = uniqueBoundedIds(
      "actionIds",
      actionIdsInput,
      MAX_GROWTH_MAP_ENTITY_LOOKUP,
    );
    if (actionIds.length === 0) return [];

    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select *
      from ${executionArtifacts}
      where ${executionArtifacts.workspace_id} = ${scope.workspaceId}
        and ${executionArtifacts.project_id} = ${scope.projectId}
        and ${executionArtifacts.action_id} in (${uuidList(actionIds)})
        and ${executionArtifacts.status} <> 'archived'
      order by
        ${executionArtifacts.action_id} asc,
        ${executionArtifacts.created_at} asc,
        ${executionArtifacts.id} asc
    `);
    return result.rows as unknown as ArtifactRow[];
  }
}
