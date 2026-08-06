import { sql } from "drizzle-orm";
import { canonicalUtcTimestamptz } from "../instant.ts";
import { Repository, type ProjectScope } from "./base.ts";

export const MAX_BACKLINK_AUTHORITY_SNAPSHOTS = 204;
export const MAX_BACKLINK_PAGE_METRICS = 500;
export const MAX_BACKLINK_FACTS = 10_000;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;

export type BacklinkAuthorityIntegrityCode =
  | "AUTHORITY_LIMIT_EXCEEDED"
  | "PAGE_METRIC_LIMIT_EXCEEDED"
  | "FACT_LIMIT_EXCEEDED"
  | "AUTHORITY_ROW_INVALID"
  | "PAGE_METRIC_ROW_INVALID"
  | "FACT_ROW_INVALID";

export class BacklinkAuthorityIntegrityError extends Error {
  override readonly name = "BacklinkAuthorityIntegrityError";

  constructor(readonly code: BacklinkAuthorityIntegrityCode) {
    super(`Backlink authority failed integrity validation: ${code}`);
  }
}

export interface BacklinkAuthoritySnapshotRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly competitor_id: string | null;
  readonly subject_kind: "primary_site" | "approved_competitor";
  readonly subject_name: string;
  readonly domain: string;
  readonly source_kind:
    | "provider_import"
    | "manual_csv"
    | "search_derived";
  readonly provider:
    | "ahrefs"
    | "moz"
    | "dataforseo"
    | "manual_csv"
    | "search_derived";
  readonly captured_at: string;
  readonly availability: "available" | "partial" | "unavailable";
  readonly index_scope:
    | "provider_index"
    | "observed_subset"
    | "unavailable";
  readonly total_backlinks: number | null;
  readonly total_referring_domains: number | null;
  readonly observed_backlinks: number | null;
  readonly observed_referring_domains: number | null;
  readonly authority_metric_kind:
    | "domain_rating"
    | "domain_authority"
    | "dataforseo_rank"
    | null;
  readonly authority_metric_value: number | null;
  readonly source_ref: string;
  readonly checksum: string;
  readonly row_count: number;
  readonly import_preview_id: string | null;
  readonly limitation: string | null;
}

export interface BacklinkPageMetricRow {
  readonly snapshot_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_page_id: string;
  readonly normalized_url: string;
  readonly title: string | null;
  readonly backlink_count: number;
  readonly referring_domain_count: number;
  readonly metric_semantics:
    | "provider_index_total"
    | "observed_fact_count";
}

export interface BacklinkFactRow {
  readonly id: string;
  readonly snapshot_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly referring_domain: string;
  readonly source_url: string;
  readonly target_url: string;
  readonly target_site_page_id: string | null;
  readonly source_authority_metric_kind:
    | "domain_rating"
    | "domain_authority"
    | "dataforseo_rank"
    | null;
  readonly source_authority_metric_value: number | null;
  readonly anchor_text: string | null;
  readonly first_seen_at: string | null;
  readonly last_seen_at: string | null;
  readonly is_new: boolean;
  readonly is_lost: boolean;
  readonly verification_status:
    | "not_checked"
    | "verified"
    | "absent"
    | "blocked"
    | "inconclusive";
  /** Populated only for a positively verified source-page link. */
  readonly verified_at: string | null;
  readonly verification_final_url: string | null;
  readonly verification_http_status: number | null;
  readonly verification_limitation: string | null;
}

function assertUuid(label: string, value: string): void {
  if (!UUID.test(value)) throw new RangeError(`${label} must be a UUID`);
}

function assertScope(scope: ProjectScope): void {
  assertUuid("workspaceId", scope.workspaceId);
  assertUuid("projectId", scope.projectId);
}

function numberOrNull(value: unknown): number | null {
  if (value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new BacklinkAuthorityIntegrityError("AUTHORITY_ROW_INVALID");
  }
  return numeric;
}

function numericMetricOrNull(value: unknown): number | null {
  if (value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw new BacklinkAuthorityIntegrityError("AUTHORITY_ROW_INVALID");
  }
  return numeric;
}

function exactString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new BacklinkAuthorityIntegrityError("AUTHORITY_ROW_INVALID");
  }
  return value;
}

function normalizeSnapshot(
  row: Record<string, unknown>,
  scope: ProjectScope,
): BacklinkAuthoritySnapshotRow {
  const id = exactString(row["id"]);
  const workspaceId = exactString(row["workspace_id"]);
  const projectId = exactString(row["project_id"]);
  const siteId = exactString(row["site_id"]);
  const competitorId =
    row["competitor_id"] === null
      ? null
      : exactString(row["competitor_id"]);
  const subjectKind = exactString(row["subject_kind"]);
  const sourceKind = exactString(row["source_kind"]);
  const provider = exactString(row["provider"]);
  const availability = exactString(row["availability"]);
  const indexScope = exactString(row["index_scope"]);
  const capturedAt = canonicalUtcTimestamptz(
    row["captured_at"] instanceof Date
      ? row["captured_at"].toISOString()
      : exactString(row["captured_at"]),
  );
  const authorityMetricKind =
    row["authority_metric_kind"] === null
      ? null
      : exactString(row["authority_metric_kind"]);
  const importPreviewId =
    row["import_preview_id"] === null
      ? null
      : exactString(row["import_preview_id"]);
  const limitation =
    row["limitation"] === null ? null : exactString(row["limitation"]);
  const checksum = exactString(row["checksum"]);
  const rowCount = numberOrNull(row["row_count"]);

  if (
    workspaceId !== scope.workspaceId ||
    projectId !== scope.projectId ||
    !UUID.test(id) ||
    !UUID.test(siteId) ||
    (competitorId !== null && !UUID.test(competitorId)) ||
    !["primary_site", "approved_competitor"].includes(subjectKind) ||
    !["provider_import", "manual_csv", "search_derived"].includes(
      sourceKind,
    ) ||
    ![
      "ahrefs",
      "moz",
      "dataforseo",
      "manual_csv",
      "search_derived",
    ].includes(provider) ||
    !["available", "partial", "unavailable"].includes(availability) ||
    !["provider_index", "observed_subset", "unavailable"].includes(
      indexScope,
    ) ||
    ![
      null,
      "domain_rating",
      "domain_authority",
      "dataforseo_rank",
    ].includes(authorityMetricKind) ||
    (importPreviewId !== null && !UUID.test(importPreviewId)) ||
    !SHA256.test(checksum) ||
    rowCount === null ||
    (subjectKind === "primary_site") !== (competitorId === null)
  ) {
    throw new BacklinkAuthorityIntegrityError("AUTHORITY_ROW_INVALID");
  }

  return {
    id,
    workspace_id: workspaceId,
    project_id: projectId,
    site_id: siteId,
    competitor_id: competitorId,
    subject_kind: subjectKind as BacklinkAuthoritySnapshotRow["subject_kind"],
    subject_name: exactString(row["subject_name"]),
    domain: exactString(row["domain"]),
    source_kind: sourceKind as BacklinkAuthoritySnapshotRow["source_kind"],
    provider: provider as BacklinkAuthoritySnapshotRow["provider"],
    captured_at: capturedAt,
    availability:
      availability as BacklinkAuthoritySnapshotRow["availability"],
    index_scope: indexScope as BacklinkAuthoritySnapshotRow["index_scope"],
    total_backlinks: numberOrNull(row["total_backlinks"]),
    total_referring_domains: numberOrNull(
      row["total_referring_domains"],
    ),
    observed_backlinks: numberOrNull(row["observed_backlinks"]),
    observed_referring_domains: numberOrNull(
      row["observed_referring_domains"],
    ),
    authority_metric_kind:
      authorityMetricKind as BacklinkAuthoritySnapshotRow["authority_metric_kind"],
    authority_metric_value: numericMetricOrNull(
      row["authority_metric_value"],
    ),
    source_ref: exactString(row["source_ref"]),
    checksum,
    row_count: rowCount,
    import_preview_id: importPreviewId,
    limitation,
  };
}

function snapshotIdList(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql`${value}::uuid`),
    sql`, `,
  );
}

/**
 * Read/write boundary for immutable Backlink facts. Source connection records
 * are deliberately not involved: only GSC/GA4/GitHub are customer-managed
 * connections, while backlink providers/imports are built-in Growth Map
 * evidence sources.
 */
export class BacklinkGrowthMapRepository extends Repository {
  async listLatestAuthoritySnapshots(
    scope: ProjectScope,
  ): Promise<BacklinkAuthoritySnapshotRow[]> {
    assertScope(scope);
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      with scoped_snapshots as materialized (
        select
          snapshot.*,
          case
            when snapshot.subject_kind = 'primary_site'
              then project.project_name
            else competitor.name
          end as subject_name,
          case
            when snapshot.subject_kind = 'primary_site'
              then site.host
            else competitor.domain
          end as domain,
          row_number() over (
            partition by
              snapshot.subject_kind,
              coalesce(snapshot.competitor_id, snapshot.site_id),
              snapshot.source_kind,
              snapshot.provider
            order by snapshot.captured_at desc, snapshot.id asc
          ) as authority_rank
        from app.backlink_authority_snapshots snapshot
        inner join app.client_projects project
          on project.workspace_id = snapshot.workspace_id
         and project.id = snapshot.project_id
         and project.archived_at is null
        inner join app.sites site
          on site.workspace_id = snapshot.workspace_id
         and site.project_id = snapshot.project_id
         and site.id = snapshot.site_id
         and site.is_primary
        left join app.competitor_entities competitor
          on competitor.workspace_id = snapshot.workspace_id
         and competitor.project_id = snapshot.project_id
         and competitor.id = snapshot.competitor_id
         and competitor.review_status = 'approved'
        where snapshot.workspace_id = ${scope.workspaceId}::uuid
          and snapshot.project_id = ${scope.projectId}::uuid
          and (
            (
              snapshot.subject_kind = 'primary_site'
              and snapshot.competitor_id is null
            )
            or (
              snapshot.subject_kind = 'approved_competitor'
              and competitor.id is not null
            )
          )
      )
      select
        id,
        workspace_id,
        project_id,
        site_id,
        competitor_id,
        subject_kind,
        subject_name,
        domain,
        source_kind,
        provider,
        captured_at,
        availability,
        index_scope,
        total_backlinks,
        total_referring_domains,
        observed_backlinks,
        observed_referring_domains,
        authority_metric_kind,
        authority_metric_value,
        source_ref,
        checksum,
        row_count,
        import_preview_id,
        limitation
      from scoped_snapshots
      where authority_rank = 1
      order by
        case when subject_kind = 'primary_site' then 0 else 1 end,
        domain asc,
        captured_at desc,
        id asc
      limit ${MAX_BACKLINK_AUTHORITY_SNAPSHOTS + 1}
    `);
    if (result.rows.length > MAX_BACKLINK_AUTHORITY_SNAPSHOTS) {
      throw new BacklinkAuthorityIntegrityError(
        "AUTHORITY_LIMIT_EXCEEDED",
      );
    }
    return result.rows.map((row) => normalizeSnapshot(row, scope));
  }

  async listPageMetrics(
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<BacklinkPageMetricRow[]> {
    assertScope(scope);
    assertUuid("snapshotId", snapshotId);
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        metric.snapshot_id,
        metric.workspace_id,
        metric.project_id,
        metric.site_page_id,
        page.normalized_url,
        metric.title,
        metric.backlink_count,
        metric.referring_domain_count,
        metric.metric_semantics
      from app.backlink_page_metrics metric
      inner join app.backlink_authority_snapshots snapshot
        on snapshot.workspace_id = metric.workspace_id
       and snapshot.project_id = metric.project_id
       and snapshot.id = metric.snapshot_id
       and snapshot.subject_kind = 'primary_site'
       and snapshot.site_id = metric.site_id
      inner join app.site_pages page
        on page.workspace_id = metric.workspace_id
       and page.project_id = metric.project_id
       and page.site_id = metric.site_id
       and page.id = metric.site_page_id
      where metric.workspace_id = ${scope.workspaceId}::uuid
        and metric.project_id = ${scope.projectId}::uuid
        and metric.snapshot_id = ${snapshotId}::uuid
      order by
        metric.referring_domain_count desc,
        page.normalized_url asc,
        metric.site_page_id asc
      limit ${MAX_BACKLINK_PAGE_METRICS + 1}
    `);
    if (result.rows.length > MAX_BACKLINK_PAGE_METRICS) {
      throw new BacklinkAuthorityIntegrityError(
        "PAGE_METRIC_LIMIT_EXCEEDED",
      );
    }
    return result.rows.map((row) => {
      const workspaceId = exactString(row["workspace_id"]);
      const projectId = exactString(row["project_id"]);
      const returnedSnapshotId = exactString(row["snapshot_id"]);
      const sitePageId = exactString(row["site_page_id"]);
      const backlinkCount = numberOrNull(row["backlink_count"]);
      const referringDomainCount = numberOrNull(
        row["referring_domain_count"],
      );
      const semantics = exactString(row["metric_semantics"]);
      if (
        workspaceId !== scope.workspaceId ||
        projectId !== scope.projectId ||
        returnedSnapshotId !== snapshotId ||
        !UUID.test(sitePageId) ||
        backlinkCount === null ||
        referringDomainCount === null ||
        !["provider_index_total", "observed_fact_count"].includes(semantics)
      ) {
        throw new BacklinkAuthorityIntegrityError(
          "PAGE_METRIC_ROW_INVALID",
        );
      }
      return {
        snapshot_id: returnedSnapshotId,
        workspace_id: workspaceId,
        project_id: projectId,
        site_page_id: sitePageId,
        normalized_url: exactString(row["normalized_url"]),
        title:
          row["title"] === null ? null : exactString(row["title"]),
        backlink_count: backlinkCount,
        referring_domain_count: referringDomainCount,
        metric_semantics:
          semantics as BacklinkPageMetricRow["metric_semantics"],
      };
    });
  }

  async listFacts(
    scope: ProjectScope,
    snapshotIds: readonly string[],
  ): Promise<BacklinkFactRow[]> {
    assertScope(scope);
    const ids = [...new Set(snapshotIds)].sort();
    if (ids.length === 0) return [];
    if (ids.length > MAX_BACKLINK_AUTHORITY_SNAPSHOTS) {
      throw new RangeError("Too many backlink snapshots requested");
    }
    ids.forEach((id) => assertUuid("snapshotId", id));
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        fact.id,
        fact.snapshot_id,
        fact.workspace_id,
        fact.project_id,
        fact.referring_domain,
        fact.source_url,
        fact.target_url,
        fact.target_site_page_id,
        fact.source_authority_metric_kind,
        fact.source_authority_metric_value,
        fact.anchor_text,
        fact.first_seen_at,
        fact.last_seen_at,
        fact.is_new,
        fact.is_lost,
        fact.verification_status,
        fact.verified_at,
        fact.verification_final_url,
        fact.verification_http_status,
        fact.verification_limitation
      from app.backlink_facts fact
      inner join app.backlink_authority_snapshots snapshot
        on snapshot.workspace_id = fact.workspace_id
       and snapshot.project_id = fact.project_id
       and snapshot.id = fact.snapshot_id
      left join app.competitor_entities competitor
        on competitor.workspace_id = snapshot.workspace_id
       and competitor.project_id = snapshot.project_id
       and competitor.id = snapshot.competitor_id
       and competitor.review_status = 'approved'
      where fact.workspace_id = ${scope.workspaceId}::uuid
        and fact.project_id = ${scope.projectId}::uuid
        and fact.snapshot_id in (${snapshotIdList(ids)})
        and (
          snapshot.subject_kind = 'primary_site'
          or (
            snapshot.subject_kind = 'approved_competitor'
            and competitor.id is not null
          )
        )
      order by
        fact.snapshot_id asc,
        fact.referring_domain asc,
        fact.target_url asc,
        fact.id asc
      limit ${MAX_BACKLINK_FACTS + 1}
    `);
    if (result.rows.length > MAX_BACKLINK_FACTS) {
      throw new BacklinkAuthorityIntegrityError("FACT_LIMIT_EXCEEDED");
    }
    const requested = new Set(ids);
    return result.rows.map((row) => {
      const id = exactString(row["id"]);
      const snapshotId = exactString(row["snapshot_id"]);
      const workspaceId = exactString(row["workspace_id"]);
      const projectId = exactString(row["project_id"]);
      const targetSitePageId =
        row["target_site_page_id"] === null
          ? null
          : exactString(row["target_site_page_id"]);
      const metricKind =
        row["source_authority_metric_kind"] === null
          ? null
          : exactString(row["source_authority_metric_kind"]);
      const metricValue = numericMetricOrNull(
        row["source_authority_metric_value"],
      );
      const nullableFactString = (value: unknown): string | null => {
        if (value === null) return null;
        if (
          typeof value !== "string" ||
          value.length === 0 ||
          value.trim() !== value
        ) {
          throw new BacklinkAuthorityIntegrityError("FACT_ROW_INVALID");
        }
        return value;
      };
      const nullableFactInstant = (value: unknown): string | null => {
        if (value === null) return null;
        const serialized =
          value instanceof Date
            ? value.toISOString()
            : nullableFactString(value);
        if (serialized === null) {
          throw new BacklinkAuthorityIntegrityError("FACT_ROW_INVALID");
        }
        try {
          return canonicalUtcTimestamptz(serialized);
        } catch {
          throw new BacklinkAuthorityIntegrityError("FACT_ROW_INVALID");
        }
      };
      const anchorText = nullableFactString(row["anchor_text"]);
      const firstSeenAt = nullableFactInstant(row["first_seen_at"]);
      const lastSeenAt = nullableFactInstant(row["last_seen_at"]);
      const isNew = row["is_new"];
      const isLost = row["is_lost"];
      const verificationStatus = exactString(row["verification_status"]);
      const verifiedAt = nullableFactInstant(row["verified_at"]);
      const verificationFinalUrl = nullableFactString(
        row["verification_final_url"],
      );
      const rawHttpStatus = row["verification_http_status"];
      const verificationHttpStatus =
        rawHttpStatus === null
          ? null
          : typeof rawHttpStatus === "number"
            ? rawHttpStatus
            : Number(rawHttpStatus);
      const verificationLimitation = nullableFactString(
        row["verification_limitation"],
      );
      if (
        workspaceId !== scope.workspaceId ||
        projectId !== scope.projectId ||
        !requested.has(snapshotId) ||
        !UUID.test(id) ||
        (targetSitePageId !== null && !UUID.test(targetSitePageId)) ||
        ![
          null,
          "domain_rating",
          "domain_authority",
          "dataforseo_rank",
        ].includes(metricKind) ||
        (metricKind === null) !== (metricValue === null) ||
        typeof isNew !== "boolean" ||
        typeof isLost !== "boolean" ||
        ![
          "not_checked",
          "verified",
          "absent",
          "blocked",
          "inconclusive",
        ].includes(verificationStatus) ||
        (verificationHttpStatus !== null &&
          (!Number.isInteger(verificationHttpStatus) ||
            verificationHttpStatus < 100 ||
            verificationHttpStatus > 599)) ||
        (verificationStatus === "verified") !== (verifiedAt !== null) ||
        (verificationStatus === "not_checked" &&
          (verificationFinalUrl !== null ||
            verificationHttpStatus !== null ||
            verificationLimitation !== null))
      ) {
        throw new BacklinkAuthorityIntegrityError("FACT_ROW_INVALID");
      }
      return {
        id,
        snapshot_id: snapshotId,
        workspace_id: workspaceId,
        project_id: projectId,
        referring_domain: exactString(row["referring_domain"]),
        source_url: exactString(row["source_url"]),
        target_url: exactString(row["target_url"]),
        target_site_page_id: targetSitePageId,
        source_authority_metric_kind:
          metricKind as BacklinkFactRow["source_authority_metric_kind"],
        source_authority_metric_value: metricValue,
        anchor_text: anchorText,
        first_seen_at: firstSeenAt,
        last_seen_at: lastSeenAt,
        is_new: isNew,
        is_lost: isLost,
        verification_status:
          verificationStatus as BacklinkFactRow["verification_status"],
        verified_at: verifiedAt,
        verification_final_url: verificationFinalUrl,
        verification_http_status: verificationHttpStatus,
        verification_limitation: verificationLimitation,
      };
    });
  }
}
