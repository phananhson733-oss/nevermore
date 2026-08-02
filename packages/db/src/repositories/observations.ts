import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { normalizedObservations } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `normalized_observations` is append-only (spec §7.6). Adapters emit
 * `NormalizedObservation`s (from `@sf/sources`) which the worker persists in the
 * SAME transaction as the snapshot. Exactly one `value_*` is set when
 * `availability = 'available'`, all null otherwise (spec §7.6, AC-017) — the
 * `app_observation_value_*` CHECK constraints in schema.sql enforce this.
 *
 * `value_numeric` is a Postgres `numeric`; drizzle reads/writes it as a string
 * to avoid float precision loss. The engine parses it back to a number.
 */

export interface ObservationRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly snapshot_id: string;
  /** Exact SitePage lineage; null means unavailable or canonically ambiguous. */
  readonly site_page_id: string | null;
  readonly provider: string;
  readonly metric_key: string;
  readonly subject_type: string;
  readonly subject_ref: string;
  readonly observed_at: string;
  readonly availability: string;
  readonly value_numeric: string | null;
  readonly value_text: string | null;
  readonly value_json: unknown;
  readonly unit: string | null;
  readonly origin: string;
  readonly method: string;
  readonly grade: string;
  readonly support: string;
  readonly limitation: string;
}

/** A normalized observation ready for insertion (camelCase; adapter output shape). */
export interface ObservationInsert {
  /** Resolved by collection persistence, never inferred by a read projection. */
  readonly sitePageId?: string | null;
  readonly metricKey: string;
  readonly subjectType: string;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly availability: string;
  readonly valueNumeric: number | null;
  readonly valueText: string | null;
  readonly valueJson: unknown | null;
  readonly unit: string | null;
  readonly origin: string;
  /** Evidence method (spec §7.7). Source-adapter output is always `observed`. */
  readonly method?: string;
  readonly grade: string;
  readonly support: string;
  readonly limitation: string;
}

export interface ObservationListPage {
  readonly rows: ObservationRow[];
  readonly nextCursor: string | null;
}

export interface ObservationListPageOptions {
  readonly limit: number;
  /** Last observation id returned by the preceding ascending-id page. */
  readonly cursor: string | null;
}

export interface ObservationSubjectLookup {
  readonly snapshotId: string;
  readonly provider: string;
  readonly metricKey: string;
  readonly subjectType: string;
  readonly subjectRef: string;
}

export interface GscSnapshotMetricSummary {
  readonly landingPageCount: number;
  readonly clicks: string;
  readonly impressions: string;
}

export interface Ga4SnapshotMetricSummary {
  readonly landingPageCount: number;
  readonly sessions: string;
  /** `null` means the property has no compatible/mapped key-event metric. */
  readonly keyEvents: string | null;
}

const INSERT_CHUNK = 500;

export class ObservationsRepository extends Repository {
  /**
   * Batch-insert observations for one snapshot (spec §7.6). Chunked so a very
   * large crawl/GSC snapshot does not exceed the driver's bind-parameter limit.
   * The snapshot provider is explicit: different providers may intentionally
   * share one logical metric key (CSV and DataForSEO both emit keyword-gap
   * observations), so a metric prefix is not a trustworthy provenance source.
   */
  async insertMany(
    scope: ProjectScope,
    snapshotId: string,
    provider: string,
    observations: readonly ObservationInsert[],
  ): Promise<number> {
    if (observations.length === 0) return 0;
    let inserted = 0;
    for (let i = 0; i < observations.length; i += INSERT_CHUNK) {
      const chunk = observations.slice(i, i + INSERT_CHUNK);
      const values = chunk.map((o) => ({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        snapshot_id: snapshotId,
        site_page_id: o.sitePageId ?? null,
        provider,
        metric_key: o.metricKey,
        subject_type: o.subjectType,
        subject_ref: o.subjectRef,
        observed_at: o.observedAt,
        availability: o.availability,
        value_numeric: o.valueNumeric === null ? null : String(o.valueNumeric),
        value_text: o.valueText,
        value_json: o.valueJson ?? null,
        unit: o.unit,
        origin: o.origin,
        method: o.method ?? "observed",
        grade: o.grade,
        support: o.support,
        limitation: o.limitation,
      }));
      await this.exec.insert(normalizedObservations).values(values);
      inserted += chunk.length;
    }
    return inserted;
  }

  /** Load all observations for a set of snapshots, project-scoped (diagnostic input). */
  async listBySnapshotIds(
    scope: ProjectScope,
    snapshotIds: readonly string[],
  ): Promise<ObservationRow[]> {
    if (snapshotIds.length === 0) return [];
    return (await this.exec
      .select()
      .from(normalizedObservations)
      .where(
        and(
          projectPredicate(normalizedObservations, scope),
          inArray(normalizedObservations.snapshot_id, [...snapshotIds]),
        ),
      )) as ObservationRow[];
  }

  /**
   * Load one exact observation without materializing its snapshot. The snapshot
   * and subject predicates remain inside the mandatory project scope so callers
   * can safely read a frozen diagnostic input rather than a later provider row.
   */
  async findBySnapshotMetricSubject(
    scope: ProjectScope,
    lookup: ObservationSubjectLookup,
  ): Promise<ObservationRow | null> {
    const rows = (await this.exec
      .select()
      .from(normalizedObservations)
      .where(
        and(
          projectPredicate(normalizedObservations, scope),
          eq(normalizedObservations.snapshot_id, lookup.snapshotId),
          eq(normalizedObservations.provider, lookup.provider),
          eq(normalizedObservations.metric_key, lookup.metricKey),
          eq(normalizedObservations.subject_type, lookup.subjectType),
          eq(normalizedObservations.subject_ref, lookup.subjectRef),
        ),
      )
      .limit(2)) as ObservationRow[];
    return rows.length === 1 ? rows[0]! : null;
  }

  /**
   * Bounded, project-scoped export reader. The UUID primary key is a stable,
   * unique keyset within a repeatable-read snapshot, so a caller never needs
   * to materialize every observation for a logical data snapshot at once.
   */
  async listBySnapshotIdsPage(
    scope: ProjectScope,
    snapshotIds: readonly string[],
    options: ObservationListPageOptions,
  ): Promise<ObservationListPage> {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
      throw new RangeError("limit must be a positive safe integer");
    }
    if (snapshotIds.length === 0) {
      return { rows: [], nextCursor: null };
    }
    const rows = (await this.exec
      .select()
      .from(normalizedObservations)
      .where(
        and(
          projectPredicate(normalizedObservations, scope),
          inArray(normalizedObservations.snapshot_id, [...snapshotIds]),
          options.cursor === null
            ? undefined
            : gt(normalizedObservations.id, options.cursor),
        ),
      )
      .orderBy(asc(normalizedObservations.id))
      .limit(options.limit + 1)) as ObservationRow[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    return {
      rows: page,
      nextCursor: hasNext ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** Count observations for one snapshot (used by tests / summaries). */
  async countBySnapshot(
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<number> {
    const rows = (await this.exec
      .select({ id: normalizedObservations.id })
      .from(normalizedObservations)
      .where(
        and(
          projectPredicate(normalizedObservations, scope),
          eq(normalizedObservations.snapshot_id, snapshotId),
        ),
      )) as { id: string }[];
    return rows.length;
  }

  /**
   * Aggregate the business metrics shown on the Sources screen from one exact
   * immutable GSC snapshot. Raw provider row counts remain snapshot provenance;
   * they are not a customer-facing search-performance metric.
   */
  async summarizeGscSnapshot(
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<GscSnapshotMetricSummary | null> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        count(*) filter (
          where jsonb_typeof(observation.value_json -> 'current28d') = 'object'
            and jsonb_typeof(observation.value_json -> 'current28d' -> 'clicks') = 'number'
            and jsonb_typeof(observation.value_json -> 'current28d' -> 'impressions') = 'number'
        )::integer as landing_page_count,
        sum(
          case
            when jsonb_typeof(observation.value_json -> 'current28d' -> 'clicks') = 'number'
              then (observation.value_json -> 'current28d' ->> 'clicks')::numeric
            else null
          end
        )::text as clicks,
        sum(
          case
            when jsonb_typeof(observation.value_json -> 'current28d' -> 'impressions') = 'number'
              then (observation.value_json -> 'current28d' ->> 'impressions')::numeric
            else null
          end
        )::text as impressions
      from app.normalized_observations observation
      where observation.workspace_id = ${scope.workspaceId}::uuid
        and observation.project_id = ${scope.projectId}::uuid
        and observation.snapshot_id = ${snapshotId}::uuid
        and observation.provider = 'gsc'
        and observation.metric_key = 'gsc.page.v1'
        and observation.subject_type = 'url'
        and observation.availability = 'available'
    `);
    const row = result.rows[0];
    const landingPageCount = Number(row?.["landing_page_count"] ?? 0);
    const clicks = row?.["clicks"];
    const impressions = row?.["impressions"];
    if (
      !Number.isSafeInteger(landingPageCount) ||
      landingPageCount <= 0 ||
      typeof clicks !== "string" ||
      typeof impressions !== "string"
    ) {
      return null;
    }
    return { landingPageCount, clicks, impressions };
  }

  /** Aggregate current-window organic sessions from one exact GA4 snapshot. */
  async summarizeGa4Snapshot(
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<Ga4SnapshotMetricSummary | null> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        count(*) filter (
          where jsonb_typeof(observation.value_json -> 'sessions') = 'number'
        )::integer as landing_page_count,
        sum(
          case
            when jsonb_typeof(observation.value_json -> 'sessions') = 'number'
              then (observation.value_json ->> 'sessions')::numeric
            else null
          end
        )::text as sessions,
        sum(
          case
            when jsonb_typeof(observation.value_json -> 'keyEvents') = 'number'
              then (observation.value_json ->> 'keyEvents')::numeric
            else null
          end
        )::text as key_events
      from app.normalized_observations observation
      where observation.workspace_id = ${scope.workspaceId}::uuid
        and observation.project_id = ${scope.projectId}::uuid
        and observation.snapshot_id = ${snapshotId}::uuid
        and observation.provider = 'ga4'
        and observation.metric_key = 'ga4.landing.v1'
        and observation.subject_type = 'url'
        and observation.availability = 'available'
    `);
    const row = result.rows[0];
    const landingPageCount = Number(row?.["landing_page_count"] ?? 0);
    const sessions = row?.["sessions"];
    const keyEvents = row?.["key_events"];
    if (
      !Number.isSafeInteger(landingPageCount) ||
      landingPageCount <= 0 ||
      typeof sessions !== "string" ||
      (keyEvents !== null && typeof keyEvents !== "string")
    ) {
      return null;
    }
    return { landingPageCount, sessions, keyEvents };
  }
}
