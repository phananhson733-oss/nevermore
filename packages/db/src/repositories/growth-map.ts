import { sql } from "drizzle-orm";
import {
  actions,
  asyncRuns,
  dataSnapshots,
  diagnosticRuns,
  executionArtifacts,
  findings,
  findingTargets,
  normalizedObservations,
  pageSnapshots,
  sitePages,
} from "../schema.ts";
import type { ActionRow } from "./actions.ts";
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

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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
}

export interface GrowthMapUrlInventoryPage {
  readonly rows: GrowthMapUrlInventoryRow[];
  readonly nextCursor: string | null;
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

function asIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeReadableRun(row: RawReadableRunRow): GrowthMapReadableRunRow {
  if (!(row.created_at instanceof Date) && !(row.run_completed_at instanceof Date)) {
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
 * Bounded, project-scoped read model for the URL-first Growth Map. Every URL
 * identity is selected from the current DiagnosticRun's immutable manifest;
 * Finding membership comes only from the per-run finding_targets ledger.
 */
export class GrowthMapReadRepository extends Repository {
  async findLatestReadableRun(
    scope: ProjectScope,
  ): Promise<GrowthMapReadableRunRow | null> {
    const result = await this.exec.execute<RawReadableRunRow>(sql`
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
      where ${diagnosticRuns.workspace_id} = ${scope.workspaceId}
        and ${diagnosticRuns.project_id} = ${scope.projectId}
        and ${asyncRuns.kind} = 'diagnostic'
        and ${asyncRuns.status} in ('completed', 'partial')
      order by ${diagnosticRuns.created_at} desc, ${diagnosticRuns.id} desc
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
      ? decodeTimestampUuidCursor(options.cursor)
      : null;
    if (options.cursor && !cursor) {
      throw new RangeError("cursor is not a canonical SitePage keyset");
    }

    const result = await this.exec.execute<RawUrlInventoryRow>(sql`
      ${currentRunUrlInventoryCtes(scope, diagnosticRunId)}
      select *
      from inventory
      where ${search === null ? sql`true` : sql`position(lower(${search}) in lower(normalized_url)) > 0`}
        and ${
          cursor === null
            ? sql`true`
            : sql`(
                site_page_created_at > ${cursor.timestamp}
                or (site_page_created_at = ${cursor.timestamp}
                  and site_page_id > ${cursor.id}::uuid)
              )`
        }
      order by site_page_created_at asc, site_page_id asc
      limit ${options.limit + 1}
    `);

    const normalized = result.rows.map(normalizeUrlInventoryRow);
    const hasNext = normalized.length > options.limit;
    const rows = hasNext ? normalized.slice(0, options.limit) : normalized;
    const last = rows.at(-1);
    return {
      rows,
      nextCursor:
        hasNext && last
          ? encodeTimestampUuidCursor(
              last.site_page_created_at,
              last.site_page_id,
            )
          : null,
    };
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
