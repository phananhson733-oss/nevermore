import { sql } from "drizzle-orm";
import type {
  UpdateCompetitorMonitorRequest,
} from "@sf/contracts";
import { canonicalUtcTimestamptz } from "../instant.ts";
import {
  competitorMonitorEvaluations,
  competitorMonitorRuns,
  competitorMonitorSignals,
} from "../schema.ts";
import {
  Repository,
  type ProjectScope,
} from "./base.ts";

export interface CompetitorMonitorSettingRow {
  readonly enabled: boolean;
  readonly frequency: "monthly";
  readonly revision: number;
  readonly updated_at: string;
}

export interface CompetitorMonitorContextRow {
  readonly site_id: string;
  readonly market_codes: string[];
  readonly language_codes: string[];
  readonly topic_model_revision: number | null;
  readonly source_available: boolean;
}

export interface CompetitorMonitorLibraryRow {
  readonly competitor_id: string;
  readonly domain: string;
  readonly name: string | null;
  readonly relationship:
    | "direct"
    | "indirect"
    | "status_quo"
    | "benchmark"
    | "publisher";
  readonly analysis_scopes: Array<
    | "positioning"
    | "product_capability"
    | "keyword_gap"
    | "content"
    | "serp_visibility"
  >;
  readonly monitor_run_id: string | null;
  readonly run_status: string | null;
  readonly evaluation_state:
    | "baseline"
    | "available"
    | "unavailable"
    | null;
  readonly last_collection_at: string | null;
  readonly next_collection_at: string | null;
  readonly evaluation_limitation: string | null;
}

export interface CompetitorMonitorSignalRow {
  readonly id: string;
  readonly competitor_id: string;
  readonly monitor_run_id: string;
  readonly signal_kind: "new_content_overlap" | "rank_gain";
  readonly topic_node_id: string;
  readonly topic_label: string;
  readonly keyword_entity_id: string | null;
  readonly keyword: string | null;
  readonly content_url: string | null;
  readonly matched_keyword_ids: string[] | null;
  readonly overlap_ratio: number | null;
  readonly previous_rank: number | null;
  readonly current_rank: number | null;
  readonly improvement: number | null;
  readonly previous_snapshot_id: string;
  readonly current_snapshot_id: string;
  readonly limitation: string | null;
  readonly detected_at: string;
  readonly run_signal_count: number;
}

export interface CompetitorMonitorDuePlan {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly sourceConnectionId: string;
  readonly actorId: string;
  readonly competitorId: string;
  readonly domain: string;
  readonly analysisScopes: readonly string[];
  readonly settingsRevision: number;
  readonly topicModelRevision: number;
  readonly market: string;
  readonly languageTag: string;
  readonly scheduledFor: string;
  readonly previousMonitorRunId: string | null;
  readonly previousSnapshotId: string | null;
}

export interface CompetitorMonitorRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly competitor_id: string;
  readonly analysis_scopes: readonly string[];
  readonly topic_model_revision: number;
  readonly target_domain: string;
  readonly market: string;
  readonly language_tag: string;
  readonly previous_monitor_run_id: string | null;
  readonly previous_snapshot_id: string | null;
}

export interface CompetitorRankFactRow {
  readonly normalized_keyword: string;
  readonly current_rank: number | null;
  readonly current_url: string | null;
}

export interface CompetitorSnapshotMetadataRow {
  readonly id: string;
  readonly captured_at: string;
  readonly availability: "available" | "partial" | "unavailable";
}

export interface ConfirmedTopicKeywordRow {
  readonly topic_node_id: string;
  readonly topic_label: string;
  readonly keyword_entity_id: string;
  readonly display_keyword: string;
  readonly normalized_keyword: string;
}

export interface InsertCompetitorMonitorSignal {
  readonly id: string;
  readonly kind: "new_content_overlap" | "rank_gain";
  readonly topicNodeId: string;
  readonly keywordEntityId: string | null;
  readonly contentUrl: string | null;
  readonly matchedKeywordIds: readonly string[] | null;
  readonly overlapRatio: number | null;
  readonly previousRank: number | null;
  readonly currentRank: number | null;
  readonly improvement: number | null;
  readonly limitation: string | null;
}

const MAX_DUE_PLANS = 100;
const MAX_LIBRARY_ROWS = 500;
const MAX_SIGNALS_PER_MONITOR_RUN = 100;
const MAX_SIGNAL_ROWS =
  MAX_LIBRARY_ROWS * MAX_SIGNALS_PER_MONITOR_RUN;
const MAX_RANK_FACTS = 1_001;
const MAX_TOPIC_KEYWORDS = 10_001;

function canonicalInstant(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return canonicalUtcTimestamptz(
    value instanceof Date ? value.toISOString() : String(value),
  );
}

function positiveLimit(value: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} must be between 1 and ${max}`);
  }
  return value;
}

/** Calendar cadence with end-of-month clamping, always in UTC. */
export function addCalendarMonthUtc(value: string): string {
  const canonical = canonicalUtcTimestamptz(value);
  const current = new Date(canonical);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const day = current.getUTCDate();
  const targetYear = month === 11 ? year + 1 : year;
  const targetMonth = (month + 1) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(canonical);
  result.setUTCFullYear(targetYear, targetMonth, Math.min(day, lastDay));
  return result.toISOString();
}

export class CompetitorMonitorRepository extends Repository {
  async findSettings(
    scope: ProjectScope,
  ): Promise<CompetitorMonitorSettingRow | null> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select enabled, frequency, revision, updated_at
      from app.competitor_monitor_settings
      where workspace_id = ${scope.workspaceId}::uuid
        and project_id = ${scope.projectId}::uuid
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      enabled: row["enabled"] === true,
      frequency: "monthly",
      revision: Number(row["revision"]),
      updated_at: canonicalInstant(row["updated_at"]) as string,
    };
  }

  /** Null means stale CAS, absent/archived project, or a foreign scope. */
  async saveSettings(
    scope: ProjectScope,
    actorId: string,
    input: UpdateCompetitorMonitorRequest,
  ): Promise<CompetitorMonitorSettingRow | null> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      insert into app.competitor_monitor_settings (
        workspace_id,
        project_id,
        enabled,
        frequency,
        revision,
        updated_by,
        created_at,
        updated_at
      )
      select
        ${scope.workspaceId}::uuid,
        project.id,
        ${input.enabled},
        ${input.frequency},
        1,
        ${actorId}::uuid,
        now(),
        now()
      from app.client_projects project
      where project.workspace_id = ${scope.workspaceId}::uuid
        and project.id = ${scope.projectId}::uuid
        and project.archived_at is null
        and ${input.expectedRevision} = 0
      on conflict (project_id) do update set
        enabled = excluded.enabled,
        frequency = excluded.frequency,
        revision = app.competitor_monitor_settings.revision + 1,
        updated_by = excluded.updated_by,
        updated_at = now()
      where app.competitor_monitor_settings.workspace_id =
          ${scope.workspaceId}::uuid
        and app.competitor_monitor_settings.revision =
          ${input.expectedRevision}
        and exists (
          select 1
          from app.client_projects project
          where project.workspace_id = ${scope.workspaceId}::uuid
            and project.id = ${scope.projectId}::uuid
            and project.archived_at is null
        )
      returning enabled, frequency, revision, updated_at
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      enabled: row["enabled"] === true,
      frequency: "monthly",
      revision: Number(row["revision"]),
      updated_at: canonicalInstant(row["updated_at"]) as string,
    };
  }

  async readContext(scope: ProjectScope): Promise<CompetitorMonitorContextRow | null> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        site.id as site_id,
        site.market_codes,
        site.language_codes,
        (
          select model.revision
          from app.topic_model_revisions model
          where model.workspace_id = site.workspace_id
            and model.project_id = site.project_id
            and model.status = 'confirmed'
          order by model.revision desc
          limit 1
        ) as topic_model_revision,
        exists (
          select 1
          from app.source_connections source
          where source.workspace_id = site.workspace_id
            and source.project_id = site.project_id
            and source.site_id = site.id
            and source.provider = 'dataforseo'
            and source.state = 'connected'
            and source.disconnected_at is null
        ) as source_available
      from app.sites site
      inner join app.client_projects project
        on project.id = site.project_id
       and project.workspace_id = site.workspace_id
      where site.workspace_id = ${scope.workspaceId}::uuid
        and site.project_id = ${scope.projectId}::uuid
        and site.is_primary
        and project.archived_at is null
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      site_id: String(row["site_id"]),
      market_codes: Array.isArray(row["market_codes"])
        ? row["market_codes"].map(String)
        : [],
      language_codes: Array.isArray(row["language_codes"])
        ? row["language_codes"].map(String)
        : [],
      topic_model_revision:
        row["topic_model_revision"] === null
          ? null
          : Number(row["topic_model_revision"]),
      source_available: row["source_available"] === true,
    };
  }

  async listLibraryRows(
    scope: ProjectScope,
  ): Promise<CompetitorMonitorLibraryRow[]> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        competitor.id as competitor_id,
        competitor.domain,
        competitor.name,
        competitor.relationship,
        competitor.analysis_scope as analysis_scopes,
        latest_run.id as monitor_run_id,
        latest_run.run_status,
        latest_run.evaluation_state,
        latest_run.last_collection_at,
        latest_run.next_collection_at,
        latest_run.evaluation_limitation
      from app.competitor_entities competitor
      inner join app.client_projects project
        on project.id = competitor.project_id
       and project.workspace_id = competitor.workspace_id
      left join lateral (
        select
          monitor.id,
          run.status as run_status,
          evaluation.evaluation_state,
          coalesce(
            evaluation.evaluated_at,
            (
              select historical.evaluated_at
              from app.competitor_monitor_evaluations historical
              where historical.workspace_id = monitor.workspace_id
                and historical.project_id = monitor.project_id
                and historical.competitor_id = monitor.competitor_id
              order by
                historical.evaluated_at desc,
                historical.monitor_run_id desc
              limit 1
            )
          ) as last_collection_at,
          case
            when evaluation.monitor_run_id is not null
              then evaluation.evaluated_at + interval '1 month'
            else monitor.created_at + interval '24 hours'
          end as next_collection_at,
          evaluation.limitation as evaluation_limitation
        from app.competitor_monitor_runs monitor
        inner join app.async_runs run on run.id = monitor.id
        left join app.competitor_monitor_evaluations evaluation
          on evaluation.monitor_run_id = monitor.id
        where monitor.workspace_id = competitor.workspace_id
          and monitor.project_id = competitor.project_id
          and monitor.competitor_id = competitor.id
        order by monitor.created_at desc, monitor.id desc
        limit 1
      ) latest_run on true
      where competitor.workspace_id = ${scope.workspaceId}::uuid
        and competitor.project_id = ${scope.projectId}::uuid
        and competitor.review_status = 'approved'
        and project.archived_at is null
      order by competitor.domain asc, competitor.id asc
      limit ${MAX_LIBRARY_ROWS + 1}
    `);
    if (result.rows.length > MAX_LIBRARY_ROWS) {
      throw new RangeError("competitor monitor library limit exceeded");
    }
    return result.rows.map((row) => ({
      competitor_id: String(row["competitor_id"]),
      domain: String(row["domain"]),
      name: row["name"] === null ? null : String(row["name"]),
      relationship: row["relationship"] as CompetitorMonitorLibraryRow["relationship"],
      analysis_scopes: (row["analysis_scopes"] as CompetitorMonitorLibraryRow["analysis_scopes"]) ?? [],
      monitor_run_id:
        row["monitor_run_id"] === null ? null : String(row["monitor_run_id"]),
      run_status:
        row["run_status"] === null ? null : String(row["run_status"]),
      evaluation_state:
        row["evaluation_state"] as CompetitorMonitorLibraryRow["evaluation_state"],
      last_collection_at: canonicalInstant(row["last_collection_at"]),
      next_collection_at: canonicalInstant(row["next_collection_at"]),
      evaluation_limitation:
        row["evaluation_limitation"] === null
          ? null
          : String(row["evaluation_limitation"]),
    }));
  }

  async listSignals(
    scope: ProjectScope,
    monitorRunIds: readonly string[],
  ): Promise<CompetitorMonitorSignalRow[]> {
    if (monitorRunIds.length === 0) return [];
    if (monitorRunIds.length > MAX_LIBRARY_ROWS) {
      throw new RangeError("too many monitor run ids");
    }
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      with ranked_signals as (
        select
          signal.id,
          signal.competitor_id,
          signal.monitor_run_id,
          signal.signal_kind,
          signal.topic_node_id,
          topic.label as topic_label,
          signal.keyword_entity_id,
          keyword.display_keyword as keyword,
          signal.content_url,
          signal.matched_keyword_ids,
          signal.overlap_ratio,
          signal.previous_rank,
          signal.current_rank,
          signal.improvement,
          signal.previous_snapshot_id,
          signal.current_snapshot_id,
          signal.limitation,
          signal.detected_at,
          count(*) over (
            partition by signal.monitor_run_id
          ) as run_signal_count,
          row_number() over (
            partition by signal.monitor_run_id
            order by signal.detected_at desc, signal.id desc
          ) as signal_ordinal
        from app.competitor_monitor_signals signal
        inner join app.competitor_monitor_runs monitor
          on monitor.id = signal.monitor_run_id
         and monitor.workspace_id = signal.workspace_id
         and monitor.project_id = signal.project_id
         and monitor.competitor_id = signal.competitor_id
        inner join app.topic_node_revisions topic
          on topic.workspace_id = signal.workspace_id
         and topic.project_id = signal.project_id
         and topic.topic_node_id = signal.topic_node_id
         and topic.topic_model_revision = signal.topic_model_revision
        left join app.keyword_entities keyword
          on keyword.id = signal.keyword_entity_id
         and keyword.workspace_id = signal.workspace_id
         and keyword.project_id = signal.project_id
        where signal.workspace_id = ${scope.workspaceId}::uuid
          and signal.project_id = ${scope.projectId}::uuid
          and signal.monitor_run_id in (
            ${sql.join(monitorRunIds.map((id) => sql`${id}::uuid`), sql`, `)}
          )
      )
      select
        id,
        competitor_id,
        monitor_run_id,
        signal_kind,
        topic_node_id,
        topic_label,
        keyword_entity_id,
        keyword,
        content_url,
        matched_keyword_ids,
        overlap_ratio,
        previous_rank,
        current_rank,
        improvement,
        previous_snapshot_id,
        current_snapshot_id,
        limitation,
        detected_at,
        run_signal_count
      from ranked_signals
      where signal_ordinal <= ${MAX_SIGNALS_PER_MONITOR_RUN}
      order by detected_at desc, id desc
      limit ${MAX_SIGNAL_ROWS + 1}
    `);
    if (result.rows.length > MAX_SIGNAL_ROWS) {
      throw new RangeError("competitor monitor signal limit exceeded");
    }
    return result.rows.map((row) => ({
      id: String(row["id"]),
      competitor_id: String(row["competitor_id"]),
      monitor_run_id: String(row["monitor_run_id"]),
      signal_kind: row["signal_kind"] as CompetitorMonitorSignalRow["signal_kind"],
      topic_node_id: String(row["topic_node_id"]),
      topic_label: String(row["topic_label"]),
      keyword_entity_id:
        row["keyword_entity_id"] === null
          ? null
          : String(row["keyword_entity_id"]),
      keyword: row["keyword"] === null ? null : String(row["keyword"]),
      content_url:
        row["content_url"] === null ? null : String(row["content_url"]),
      matched_keyword_ids: Array.isArray(row["matched_keyword_ids"])
        ? row["matched_keyword_ids"].map(String)
        : null,
      overlap_ratio:
        row["overlap_ratio"] === null ? null : Number(row["overlap_ratio"]),
      previous_rank:
        row["previous_rank"] === null ? null : Number(row["previous_rank"]),
      current_rank:
        row["current_rank"] === null ? null : Number(row["current_rank"]),
      improvement:
        row["improvement"] === null ? null : Number(row["improvement"]),
      previous_snapshot_id: String(row["previous_snapshot_id"]),
      current_snapshot_id: String(row["current_snapshot_id"]),
      limitation:
        row["limitation"] === null ? null : String(row["limitation"]),
      detected_at: canonicalInstant(row["detected_at"]) as string,
      run_signal_count: Number(row["run_signal_count"]),
    }));
  }

  async listDuePlans(input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<CompetitorMonitorDuePlan[]> {
    const now = canonicalUtcTimestamptz(input.now);
    const limit = positiveLimit(input.limit, MAX_DUE_PLANS, "limit");
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      with due as (
        select
          setting.workspace_id,
          setting.project_id,
          site.id as site_id,
          source.id as source_connection_id,
          setting.updated_by as actor_id,
          competitor.id as competitor_id,
          regexp_replace(competitor.domain, '^www\\.', '') as domain,
          competitor.analysis_scope as analysis_scopes,
          setting.revision as settings_revision,
          topic.revision as topic_model_revision,
          site.market_codes[1] as market,
          site.language_codes[1] as language_tag,
          case
            when latest_attempt.id is null then ${now}::timestamptz
            when latest_attempt.id = evaluation.monitor_run_id
              then evaluation.evaluated_at + interval '1 month'
            else latest_attempt.created_at + interval '24 hours'
          end as scheduled_for,
          evaluation.monitor_run_id as previous_monitor_run_id,
          evaluation.result_snapshot_id as previous_snapshot_id,
          latest_attempt.status as latest_attempt_status
        from app.competitor_monitor_settings setting
        inner join app.client_projects project
          on project.id = setting.project_id
         and project.workspace_id = setting.workspace_id
         and project.archived_at is null
        inner join app.sites site
          on site.project_id = setting.project_id
         and site.workspace_id = setting.workspace_id
         and site.is_primary
         and cardinality(site.market_codes) = 1
         and cardinality(site.language_codes) = 1
        inner join app.competitor_entities competitor
          on competitor.project_id = setting.project_id
         and competitor.workspace_id = setting.workspace_id
         and competitor.review_status = 'approved'
         and (
           'content' = any(competitor.analysis_scope)
           or 'serp_visibility' = any(competitor.analysis_scope)
         )
        inner join lateral (
          select model.revision
          from app.topic_model_revisions model
          where model.workspace_id = setting.workspace_id
            and model.project_id = setting.project_id
            and model.status = 'confirmed'
          order by model.revision desc
          limit 1
        ) topic on true
        inner join lateral (
          select connection.id
          from app.source_connections connection
          where connection.workspace_id = setting.workspace_id
            and connection.project_id = setting.project_id
            and connection.site_id = site.id
            and connection.provider = 'dataforseo'
            and connection.state = 'connected'
            and connection.disconnected_at is null
          order by connection.created_at desc, connection.id desc
          limit 1
        ) source on true
        left join lateral (
          select
            evaluation.monitor_run_id,
            evaluation.result_snapshot_id,
            evaluation.evaluated_at
          from app.competitor_monitor_evaluations evaluation
          where evaluation.workspace_id = setting.workspace_id
            and evaluation.project_id = setting.project_id
            and evaluation.competitor_id = competitor.id
          order by evaluation.evaluated_at desc, evaluation.monitor_run_id desc
          limit 1
        ) evaluation on true
        left join lateral (
          select monitor.id, run.status, monitor.created_at
          from app.competitor_monitor_runs monitor
          inner join app.async_runs run on run.id = monitor.id
          where monitor.workspace_id = setting.workspace_id
            and monitor.project_id = setting.project_id
            and monitor.competitor_id = competitor.id
          order by monitor.created_at desc, monitor.id desc
          limit 1
        ) latest_attempt on true
        where setting.enabled
          and setting.frequency = 'monthly'
      )
      select *
      from due
      where scheduled_for <= ${now}::timestamptz
        and (
          latest_attempt_status is null
          or latest_attempt_status in (
            'completed','partial','failed','cancelled'
          )
        )
      order by scheduled_for asc, project_id asc, competitor_id asc
      limit ${limit}
    `);
    return result.rows.map((row) => ({
      workspaceId: String(row["workspace_id"]),
      projectId: String(row["project_id"]),
      siteId: String(row["site_id"]),
      sourceConnectionId: String(row["source_connection_id"]),
      actorId: String(row["actor_id"]),
      competitorId: String(row["competitor_id"]),
      domain: String(row["domain"]),
      analysisScopes: Array.isArray(row["analysis_scopes"])
        ? row["analysis_scopes"].map(String)
        : [],
      settingsRevision: Number(row["settings_revision"]),
      topicModelRevision: Number(row["topic_model_revision"]),
      market: String(row["market"]),
      languageTag: String(row["language_tag"]),
      scheduledFor: canonicalInstant(row["scheduled_for"]) as string,
      previousMonitorRunId:
        row["previous_monitor_run_id"] === null
          ? null
          : String(row["previous_monitor_run_id"]),
      previousSnapshotId:
        row["previous_snapshot_id"] === null
          ? null
          : String(row["previous_snapshot_id"]),
    }));
  }

  async insertMonitorRun(input: {
    readonly runId: string;
    readonly plan: CompetitorMonitorDuePlan;
  }): Promise<void> {
    await this.exec.insert(competitorMonitorRuns).values({
      id: input.runId,
      workspace_id: input.plan.workspaceId,
      project_id: input.plan.projectId,
      competitor_id: input.plan.competitorId,
      analysis_scopes: [...input.plan.analysisScopes],
      settings_revision: input.plan.settingsRevision,
      topic_model_revision: input.plan.topicModelRevision,
      target_domain: input.plan.domain,
      market: input.plan.market,
      language_tag: input.plan.languageTag,
      scheduled_for: input.plan.scheduledFor,
      previous_monitor_run_id: input.plan.previousMonitorRunId,
      previous_snapshot_id: input.plan.previousSnapshotId,
    });
  }

  async findMonitorRun(
    scope: ProjectScope,
    runId: string,
  ): Promise<CompetitorMonitorRunRow | null> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        id,
        workspace_id,
        project_id,
        competitor_id,
        analysis_scopes,
        topic_model_revision,
        target_domain,
        market,
        language_tag,
        previous_monitor_run_id,
        previous_snapshot_id
      from app.competitor_monitor_runs
      where workspace_id = ${scope.workspaceId}::uuid
        and project_id = ${scope.projectId}::uuid
        and id = ${runId}::uuid
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row["id"]),
      workspace_id: String(row["workspace_id"]),
      project_id: String(row["project_id"]),
      competitor_id: String(row["competitor_id"]),
      analysis_scopes: Array.isArray(row["analysis_scopes"])
        ? row["analysis_scopes"].map(String)
        : [],
      topic_model_revision: Number(row["topic_model_revision"]),
      target_domain: String(row["target_domain"]),
      market: String(row["market"]),
      language_tag: String(row["language_tag"]),
      previous_monitor_run_id:
        row["previous_monitor_run_id"] === null
          ? null
          : String(row["previous_monitor_run_id"]),
      previous_snapshot_id:
        row["previous_snapshot_id"] === null
          ? null
          : String(row["previous_snapshot_id"]),
    };
  }

  async listSnapshotRankFacts(
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<CompetitorRankFactRow[]> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        lower(
          regexp_replace(
            btrim(observation.value_json ->> 'keyword'),
            '\\s+',
            ' ',
            'g'
          )
        ) as normalized_keyword,
        case
          when observation.value_json -> 'currentRank' = 'null'::jsonb
            then null
          else (observation.value_json ->> 'currentRank')::numeric
        end as current_rank,
        observation.value_json ->> 'currentUrl' as current_url
      from app.data_snapshots snapshot
      inner join app.normalized_observations observation
        on observation.snapshot_id = snapshot.id
       and observation.workspace_id = snapshot.workspace_id
       and observation.project_id = snapshot.project_id
      where snapshot.workspace_id = ${scope.workspaceId}::uuid
        and snapshot.project_id = ${scope.projectId}::uuid
        and snapshot.id = ${snapshotId}::uuid
        and snapshot.provider = 'dataforseo'
        and snapshot.dataset_key = 'dataforseo.ranked_keywords.v1'
        and snapshot.method_version = 'dataforseo.ranked_keywords.v1'
        and snapshot.availability in ('available','partial')
        and observation.provider = 'dataforseo'
        and observation.metric_key = 'csv.keyword_gap.v1'
        and observation.subject_type = 'keyword_cluster'
        and observation.availability = 'available'
        and observation.grade = 'B'
        and jsonb_typeof(observation.value_json) = 'object'
      order by normalized_keyword asc, observation.id asc
      limit ${MAX_RANK_FACTS}
    `);
    if (result.rows.length >= MAX_RANK_FACTS) {
      throw new RangeError("competitor rank facts exceed provider cap");
    }
    return result.rows.map((row) => ({
      normalized_keyword: String(row["normalized_keyword"]),
      current_rank:
        row["current_rank"] === null ? null : Number(row["current_rank"]),
      current_url:
        row["current_url"] === null ? null : String(row["current_url"]),
    }));
  }

  async findSnapshotMetadata(
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<CompetitorSnapshotMetadataRow | null> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select id, captured_at, availability
      from app.data_snapshots
      where workspace_id = ${scope.workspaceId}::uuid
        and project_id = ${scope.projectId}::uuid
        and id = ${snapshotId}::uuid
        and provider = 'dataforseo'
        and dataset_key = 'dataforseo.ranked_keywords.v1'
        and method_version = 'dataforseo.ranked_keywords.v1'
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return null;
    const availability = String(row["availability"]);
    if (
      availability !== "available" &&
      availability !== "partial" &&
      availability !== "unavailable"
    ) {
      throw new TypeError("competitor snapshot availability is invalid");
    }
    return {
      id: String(row["id"]),
      captured_at: canonicalInstant(row["captured_at"]) as string,
      availability,
    };
  }

  async listConfirmedTopicKeywords(
    scope: ProjectScope,
    topicModelRevision: number,
    market: string,
    languageTag: string,
  ): Promise<ConfirmedTopicKeywordRow[]> {
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select
        node.topic_node_id,
        node.label as topic_label,
        keyword.id as keyword_entity_id,
        keyword.display_keyword,
        keyword.normalized_keyword
      from app.topic_model_revisions model
      inner join app.topic_node_revisions node
        on node.workspace_id = model.workspace_id
       and node.project_id = model.project_id
       and node.topic_model_revision = model.revision
       and node.lifecycle_state = 'active'
      inner join app.keyword_review_decisions decision
        on decision.workspace_id = model.workspace_id
       and decision.project_id = model.project_id
       and decision.topic_model_revision = model.revision
       and decision.topic_node_id = node.topic_node_id
       and decision.review_state = 'confirmed'
      inner join app.keyword_entities keyword
        on keyword.id = decision.keyword_entity_id
       and keyword.workspace_id = decision.workspace_id
       and keyword.project_id = decision.project_id
       and keyword.mapping_revision = decision.governance_revision
      where model.workspace_id = ${scope.workspaceId}::uuid
        and model.project_id = ${scope.projectId}::uuid
        and model.revision = ${topicModelRevision}
        and model.status = 'confirmed'
        and keyword.market = ${market}
        and keyword.language_tag = ${languageTag}
        and not exists (
          select 1
          from app.keyword_review_decisions newer
          where newer.workspace_id = decision.workspace_id
            and newer.project_id = decision.project_id
            and newer.keyword_entity_id = decision.keyword_entity_id
            and newer.governance_revision > decision.governance_revision
        )
      order by node.topic_node_id asc, keyword.normalized_keyword asc
      limit ${MAX_TOPIC_KEYWORDS}
    `);
    if (result.rows.length >= MAX_TOPIC_KEYWORDS) {
      throw new RangeError("confirmed Topic keyword limit exceeded");
    }
    return result.rows.map((row) => ({
      topic_node_id: String(row["topic_node_id"]),
      topic_label: String(row["topic_label"]),
      keyword_entity_id: String(row["keyword_entity_id"]),
      display_keyword: String(row["display_keyword"]),
      normalized_keyword: String(row["normalized_keyword"]),
    }));
  }

  async insertEvaluation(input: {
    readonly run: CompetitorMonitorRunRow;
    readonly snapshotId: string;
    readonly state: "baseline" | "available" | "unavailable";
    readonly limitation: string | null;
    readonly evaluatedAt: string;
    readonly signals: readonly InsertCompetitorMonitorSignal[];
  }): Promise<void> {
    if (input.signals.length > MAX_SIGNALS_PER_MONITOR_RUN) {
      throw new RangeError(
        `a competitor monitor run may persist at most ${MAX_SIGNALS_PER_MONITOR_RUN} signals`,
      );
    }
    if (
      input.signals.length > 0 &&
      (input.state !== "available" ||
        input.run.previous_snapshot_id === null)
    ) {
      throw new TypeError(
        "competitor signals require an available two-snapshot comparison",
      );
    }
    await this.exec.insert(competitorMonitorEvaluations).values({
      monitor_run_id: input.run.id,
      workspace_id: input.run.workspace_id,
      project_id: input.run.project_id,
      competitor_id: input.run.competitor_id,
      evaluation_state: input.state,
      result_snapshot_id: input.snapshotId,
      previous_snapshot_id: input.run.previous_snapshot_id,
      limitation: input.limitation,
      evaluated_at: input.evaluatedAt,
    });
    if (input.signals.length === 0) return;
    await this.exec.insert(competitorMonitorSignals).values(
      input.signals.map((signal) => ({
        id: signal.id,
        workspace_id: input.run.workspace_id,
        project_id: input.run.project_id,
        competitor_id: input.run.competitor_id,
        monitor_run_id: input.run.id,
        signal_kind: signal.kind,
        topic_node_id: signal.topicNodeId,
        topic_model_revision: input.run.topic_model_revision,
        keyword_entity_id: signal.keywordEntityId,
        content_url: signal.contentUrl,
        matched_keyword_ids: signal.matchedKeywordIds
          ? [...signal.matchedKeywordIds]
          : null,
        overlap_ratio: signal.overlapRatio,
        publication_evidence:
          signal.kind === "new_content_overlap"
            ? "first_observed_in_ranked_keywords"
            : null,
        previous_rank: signal.previousRank,
        current_rank: signal.currentRank,
        improvement: signal.improvement,
        previous_snapshot_id: input.run.previous_snapshot_id!,
        current_snapshot_id: input.snapshotId,
        limitation: signal.limitation,
        detected_at: input.evaluatedAt,
      })),
    );
  }
}
