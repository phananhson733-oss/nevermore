import { sql } from "drizzle-orm";
import { canonicalUtcTimestamptz } from "../instant.ts";
import {
  dataSnapshots,
  normalizedObservations,
  sitePages,
  sourceConnections,
} from "../schema.ts";
import { Repository, type ProjectScope } from "./base.ts";

export const MAX_CONTENT_DECAY_CHECKPOINTS = 6;
export const MAX_CONTENT_DECAY_PAGE_LOOKUP = 100;
const MAX_CONTENT_DECAY_OBSERVATIONS =
  MAX_CONTENT_DECAY_CHECKPOINTS * MAX_CONTENT_DECAY_PAGE_LOOKUP * 2;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export type ContentDecayMonitorIntegrityCode =
  | "CHECKPOINT_LIMIT_EXCEEDED"
  | "CHECKPOINT_LINEAGE_INVALID"
  | "OBSERVATION_LIMIT_EXCEEDED"
  | "OBSERVATION_LINEAGE_INVALID";

export class ContentDecayMonitorIntegrityError extends Error {
  override readonly name = "ContentDecayMonitorIntegrityError";

  constructor(readonly code: ContentDecayMonitorIntegrityCode) {
    super(`Content decay monitor failed integrity validation: ${code}`);
  }
}

export interface ContentDecayCheckpointRow {
  readonly snapshotId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly sourceConnectionId: string | null;
  readonly provider: string;
  readonly datasetKey: string;
  readonly methodVersion: string;
  readonly availability: string;
  readonly capturedAt: string;
  readonly sourceWindow: {
    readonly start: string;
    readonly end: string;
  };
  readonly providerTimeZone: string | null;
}

export interface ContentDecayObservationRow {
  readonly observationId: string;
  readonly snapshotId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sitePageId: string | null;
  readonly normalizedUrl: string;
  readonly subjectRef: string;
  readonly provider: string;
  readonly metricKey: string;
  readonly availability: string;
  readonly observedAt: string;
  readonly current28d: {
    readonly clicks: number | null;
    readonly impressions: number | null;
    readonly position: number | null;
  } | null;
}

interface RawCheckpointRow extends Record<string, unknown> {
  readonly snapshot_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly source_connection_id: string | null;
  readonly provider: string;
  readonly dataset_key: string;
  readonly method_version: string;
  readonly availability: string;
  readonly captured_at: string | Date;
  readonly source_window: unknown;
  readonly provider_timezone: unknown;
}

interface RawObservationRow extends Record<string, unknown> {
  readonly observation_id: string;
  readonly snapshot_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_page_id: string | null;
  readonly normalized_url: string;
  readonly subject_ref: string;
  readonly provider: string;
  readonly metric_key: string;
  readonly availability: string;
  readonly observed_at: string | Date;
  readonly value_json: unknown;
}

function assertUuid(label: string, value: string): void {
  if (!UUID.test(value)) {
    throw new RangeError(`${label} must be a canonical UUID`);
  }
}

function assertScope(scope: ProjectScope): void {
  assertUuid("workspaceId", scope.workspaceId);
  assertUuid("projectId", scope.projectId);
}

function uniqueBoundedIds(
  label: string,
  values: readonly string[],
  maximum: number,
): string[] {
  const unique = [...new Set(values)].sort();
  if (unique.length > maximum) {
    throw new RangeError(`${label} accepts at most ${maximum} unique IDs`);
  }
  unique.forEach((value) => assertUuid(label, value));
  return unique;
}

function uuidList(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql`${value}::uuid`),
    sql`, `,
  );
}

function instant(
  value: string | Date,
  code:
    | "CHECKPOINT_LINEAGE_INVALID"
    | "OBSERVATION_LINEAGE_INVALID",
): string {
  try {
    return canonicalUtcTimestamptz(
      value instanceof Date ? value.toISOString() : value,
    );
  } catch {
    throw new ContentDecayMonitorIntegrityError(code);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function snapshotWindow(value: unknown): {
  readonly start: string;
  readonly end: string;
} {
  const object = record(value);
  const start = object?.["start"];
  const end = object?.["end"];
  if (
    typeof start !== "string" ||
    typeof end !== "string" ||
    !DATE.test(start) ||
    !DATE.test(end)
  ) {
    throw new ContentDecayMonitorIntegrityError(
      "CHECKPOINT_LINEAGE_INVALID",
    );
  }
  return { start, end };
}

function checkpoint(
  row: RawCheckpointRow,
  scope: ProjectScope,
  siteId: string,
): ContentDecayCheckpointRow {
  if (
    row.workspace_id !== scope.workspaceId ||
    row.project_id !== scope.projectId ||
    row.site_id !== siteId ||
    row.provider !== "gsc" ||
    row.dataset_key !== "gsc.page_query_daily.v1" ||
    row.method_version !== "gsc.page_query_daily.v1" ||
    (row.availability !== "available" &&
      row.availability !== "partial" &&
      row.availability !== "unavailable")
  ) {
    throw new ContentDecayMonitorIntegrityError(
      "CHECKPOINT_LINEAGE_INVALID",
    );
  }
  return {
    snapshotId: row.snapshot_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    siteId: row.site_id,
    sourceConnectionId: row.source_connection_id,
    provider: row.provider,
    datasetKey: row.dataset_key,
    methodVersion: row.method_version,
    availability: row.availability,
    capturedAt: instant(
      row.captured_at,
      "CHECKPOINT_LINEAGE_INVALID",
    ),
    sourceWindow: snapshotWindow(row.source_window),
    providerTimeZone:
      typeof row.provider_timezone === "string"
        ? row.provider_timezone
        : null,
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function current28d(value: unknown): ContentDecayObservationRow["current28d"] {
  const outer = record(value);
  const current = record(outer?.["current28d"]);
  if (!current) return null;
  return {
    clicks: nullableNumber(current["clicks"]),
    impressions: nullableNumber(current["impressions"]),
    position: nullableNumber(current["position"]),
  };
}

function observation(
  row: RawObservationRow,
  scope: ProjectScope,
): ContentDecayObservationRow {
  if (
    row.workspace_id !== scope.workspaceId ||
    row.project_id !== scope.projectId ||
    row.provider !== "gsc" ||
    row.metric_key !== "gsc.page.v1"
  ) {
    throw new ContentDecayMonitorIntegrityError(
      "OBSERVATION_LINEAGE_INVALID",
    );
  }
  return {
    observationId: row.observation_id,
    snapshotId: row.snapshot_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    sitePageId: row.site_page_id,
    normalizedUrl: row.normalized_url,
    subjectRef: row.subject_ref,
    provider: row.provider,
    metricKey: row.metric_key,
    availability: row.availability,
    observedAt: instant(
      row.observed_at,
      "OBSERVATION_LINEAGE_INVALID",
    ),
    current28d: current28d(row.value_json),
  };
}

/**
 * Persistent GSC fact reader for the content-decay decision boundary.
 *
 * Monthly canonicalization happens in SQL before observation loading, so a
 * daily sync cannot make one month contribute many overlapping checkpoints.
 * Availability is deliberately evaluated after canonicalization: a newer
 * partial authority must make that month incomplete, never expose an older
 * available snapshot as an apparently complete substitute.
 * The pure engine boundary repeats the selection and value validation as a
 * defence against malformed repository inputs and for scheduler reuse.
 */
export class ContentDecayMonitorRepository extends Repository {
  async listMonthlyCheckpoints(
    scope: ProjectScope,
    input: {
      readonly siteId: string;
      readonly startedAt: string;
      readonly endedAt: string;
    },
  ): Promise<ContentDecayCheckpointRow[]> {
    assertScope(scope);
    assertUuid("siteId", input.siteId);
    const startedAt = instant(
      input.startedAt,
      "CHECKPOINT_LINEAGE_INVALID",
    );
    const endedAt = instant(
      input.endedAt,
      "CHECKPOINT_LINEAGE_INVALID",
    );
    if (Date.parse(startedAt) >= Date.parse(endedAt)) {
      throw new ContentDecayMonitorIntegrityError(
        "CHECKPOINT_LINEAGE_INVALID",
      );
    }

    const result = await this.exec.execute<RawCheckpointRow>(sql`
      with ranked_monthly_checkpoints as materialized (
        select
          ${dataSnapshots.id} as snapshot_id,
          ${dataSnapshots.workspace_id} as workspace_id,
          ${dataSnapshots.project_id} as project_id,
          ${dataSnapshots.site_id} as site_id,
          ${dataSnapshots.source_connection_id} as source_connection_id,
          ${dataSnapshots.provider} as provider,
          ${dataSnapshots.dataset_key} as dataset_key,
          ${dataSnapshots.method_version} as method_version,
          ${dataSnapshots.availability} as availability,
          ${dataSnapshots.captured_at} as captured_at,
          ${dataSnapshots.source_window} as source_window,
          ${sourceConnections.config} ->> 'timeZone' as provider_timezone,
          row_number() over (
            partition by substring(
              ${dataSnapshots.source_window} ->> 'end',
              1,
              7
            )
            order by
              ${dataSnapshots.source_window} ->> 'end' desc,
              ${dataSnapshots.captured_at} desc,
              ${dataSnapshots.id} asc
          ) as authority_rank
        from ${dataSnapshots}
        left join ${sourceConnections}
          on ${sourceConnections.id} =
            ${dataSnapshots.source_connection_id}
         and ${sourceConnections.workspace_id} =
            ${scope.workspaceId}::uuid
         and ${sourceConnections.project_id} =
            ${scope.projectId}::uuid
         and ${sourceConnections.site_id} = ${input.siteId}::uuid
         and ${sourceConnections.provider} = 'gsc'
        where ${dataSnapshots.workspace_id} =
              ${scope.workspaceId}::uuid
          and ${dataSnapshots.project_id} =
              ${scope.projectId}::uuid
          and ${dataSnapshots.site_id} = ${input.siteId}::uuid
          and ${dataSnapshots.provider} = 'gsc'
          and ${dataSnapshots.dataset_key} =
              'gsc.page_query_daily.v1'
          and ${dataSnapshots.method_version} =
              'gsc.page_query_daily.v1'
          and ${dataSnapshots.captured_at} >= ${startedAt}::timestamptz
          and ${dataSnapshots.captured_at} <= ${endedAt}::timestamptz
          and jsonb_typeof(${dataSnapshots.source_window}) = 'object'
          and ${dataSnapshots.source_window} ? 'start'
          and ${dataSnapshots.source_window} ? 'end'
          and ${dataSnapshots.source_window} ->> 'start'
              ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and ${dataSnapshots.source_window} ->> 'end'
              ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      )
      select
        snapshot_id,
        workspace_id,
        project_id,
        site_id,
        source_connection_id,
        provider,
        dataset_key,
        method_version,
        availability,
        captured_at,
        source_window,
        provider_timezone
      from ranked_monthly_checkpoints
      where authority_rank = 1
      order by
        source_window ->> 'end' desc,
        captured_at desc,
        snapshot_id asc
      limit ${MAX_CONTENT_DECAY_CHECKPOINTS + 1}
    `);
    if (result.rows.length > MAX_CONTENT_DECAY_CHECKPOINTS) {
      throw new ContentDecayMonitorIntegrityError(
        "CHECKPOINT_LIMIT_EXCEEDED",
      );
    }
    return result.rows.map((row) => checkpoint(row, scope, input.siteId));
  }

  async listPageObservations(
    scope: ProjectScope,
    snapshotIdsInput: readonly string[],
    sitePageIdsInput: readonly string[],
  ): Promise<ContentDecayObservationRow[]> {
    assertScope(scope);
    const snapshotIds = uniqueBoundedIds(
      "snapshotIds",
      snapshotIdsInput,
      MAX_CONTENT_DECAY_CHECKPOINTS,
    );
    const sitePageIds = uniqueBoundedIds(
      "sitePageIds",
      sitePageIdsInput,
      MAX_CONTENT_DECAY_PAGE_LOOKUP,
    );
    if (snapshotIds.length === 0 || sitePageIds.length === 0) return [];

    const result = await this.exec.execute<RawObservationRow>(sql`
      select
        ${normalizedObservations.id} as observation_id,
        ${normalizedObservations.snapshot_id} as snapshot_id,
        ${normalizedObservations.workspace_id} as workspace_id,
        ${normalizedObservations.project_id} as project_id,
        ${normalizedObservations.site_page_id} as site_page_id,
        ${sitePages.normalized_url} as normalized_url,
        ${normalizedObservations.subject_ref} as subject_ref,
        ${normalizedObservations.provider} as provider,
        ${normalizedObservations.metric_key} as metric_key,
        ${normalizedObservations.availability} as availability,
        ${normalizedObservations.observed_at} as observed_at,
        ${normalizedObservations.value_json} as value_json
      from ${normalizedObservations}
      inner join ${dataSnapshots}
        on ${dataSnapshots.id} =
          ${normalizedObservations.snapshot_id}
       and ${dataSnapshots.workspace_id} =
          ${scope.workspaceId}::uuid
       and ${dataSnapshots.project_id} =
          ${scope.projectId}::uuid
       and ${dataSnapshots.provider} = 'gsc'
       and ${dataSnapshots.dataset_key} =
          'gsc.page_query_daily.v1'
       and ${dataSnapshots.method_version} =
          'gsc.page_query_daily.v1'
      inner join ${sitePages}
        on ${sitePages.id} = ${normalizedObservations.site_page_id}
       and ${sitePages.workspace_id} = ${scope.workspaceId}::uuid
       and ${sitePages.project_id} = ${scope.projectId}::uuid
      where ${normalizedObservations.workspace_id} =
            ${scope.workspaceId}::uuid
        and ${normalizedObservations.project_id} =
            ${scope.projectId}::uuid
        and ${normalizedObservations.snapshot_id} in (
          ${uuidList(snapshotIds)}
        )
        and ${normalizedObservations.site_page_id} in (
          ${uuidList(sitePageIds)}
        )
        and ${normalizedObservations.provider} = 'gsc'
        and ${normalizedObservations.metric_key} = 'gsc.page.v1'
        and ${normalizedObservations.subject_type} = 'url'
      order by
        ${normalizedObservations.snapshot_id} asc,
        ${normalizedObservations.site_page_id} asc,
        ${normalizedObservations.observed_at} desc,
        ${normalizedObservations.id} asc
      limit ${MAX_CONTENT_DECAY_OBSERVATIONS + 1}
    `);
    if (result.rows.length > MAX_CONTENT_DECAY_OBSERVATIONS) {
      throw new ContentDecayMonitorIntegrityError(
        "OBSERVATION_LIMIT_EXCEEDED",
      );
    }
    return result.rows.map((row) => observation(row, scope));
  }
}
