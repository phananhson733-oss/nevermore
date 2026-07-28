import { sql } from "drizzle-orm";
import {
  actions,
  asyncRuns,
  clientProjects,
  dataSnapshots,
  diagnosticRuns,
  findings,
  findingTargets,
  keywordEntities,
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

export const MAX_INTERNAL_LINK_MAP_OBSERVATIONS = 2_000;
export const MAX_INTERNAL_LINK_MAP_PAGE_LOOKUP = 2_000;
export const MAX_INTERNAL_LINK_MAP_EXECUTION_ROWS =
  MAX_INTERNAL_LINK_MAP_PAGE_LOOKUP * 20;
export const MAX_INTERNAL_LINK_MAP_TOPIC_MAPPINGS =
  MAX_INTERNAL_LINK_MAP_PAGE_LOOKUP * 20;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export type InternalLinkMapIntegrityCode =
  | "CRAWL_OBSERVATION_LIMIT_EXCEEDED"
  | "EXECUTION_REF_LIMIT_EXCEEDED"
  | "TOPIC_MAPPING_LIMIT_EXCEEDED"
  | "TOPIC_AUTHORITY_RESULT_INVALID"
  | "KEYWORD_AUTHORITY_DIVERGED";

export class InternalLinkMapIntegrityError extends Error {
  override readonly name = "InternalLinkMapIntegrityError";

  constructor(readonly code: InternalLinkMapIntegrityCode) {
    super(`Internal Link Map authority failed integrity validation: ${code}`);
  }
}

export interface InternalLinkCrawlObservationRow
  extends Record<string, unknown> {
  readonly observation_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly snapshot_id: string;
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
  readonly normalized_url: string | null;
}

type RawInternalLinkCrawlObservationRow = Omit<
  InternalLinkCrawlObservationRow,
  "observed_at"
> & {
  readonly observed_at: string | Date;
};

export interface InternalLinkExecutionRefRow
  extends Record<string, unknown> {
  readonly site_page_id: string;
  readonly finding_id: string;
  readonly action_id: string | null;
}

export interface InternalLinkPageTopicMapping {
  readonly sitePageId: string;
  readonly topicNodeId: string;
  readonly topicModelRevision: number;
  readonly topicLabel: string;
}

export type InternalLinkPageTopicAuthority =
  | {
      readonly state: "not_requested";
      readonly projectId: string;
    }
  | {
      readonly state: "no_confirmed_model";
      readonly projectId: string;
    }
  | {
      readonly state: "confirmed";
      readonly projectId: string;
      readonly topicModelRevision: number;
      readonly mappings: readonly InternalLinkPageTopicMapping[];
    };

interface TopicAuthorityQueryRow extends Record<string, unknown> {
  readonly project_exists: boolean;
  readonly topic_model_revision: number | null;
  readonly site_page_id: string | null;
  readonly topic_node_id: string | null;
  readonly topic_label: string | null;
  readonly missing_decision_count: number;
  readonly mirror_divergence_count: number;
  readonly invalid_decision_count: number;
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
): string[] {
  const unique = [...new Set(values)].sort();
  if (unique.length > MAX_INTERNAL_LINK_MAP_PAGE_LOOKUP) {
    throw new RangeError(
      `${label} accepts at most ${MAX_INTERNAL_LINK_MAP_PAGE_LOOKUP} unique IDs`,
    );
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

function checkedCount(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_POSTGRES_INTEGER
  ) {
    throw new InternalLinkMapIntegrityError(
      "TOPIC_AUTHORITY_RESULT_INVALID",
    );
  }
  return value;
}

function checkedRevision(value: unknown): number {
  const revision = checkedCount(value);
  if (revision < 1) {
    throw new InternalLinkMapIntegrityError(
      "TOPIC_AUTHORITY_RESULT_INVALID",
    );
  }
  return revision;
}

function normalizedObservation(
  row: RawInternalLinkCrawlObservationRow,
): InternalLinkCrawlObservationRow {
  return {
    ...row,
    observed_at:
      row.observed_at instanceof Date
        ? row.observed_at.toISOString()
        : row.observed_at,
  } as InternalLinkCrawlObservationRow;
}

/**
 * Bounded read authority for the page graph embedded in Growth Map. It never
 * reads mutable current-crawl pointers: every observation must be named by the
 * selected readable DiagnosticRun's immutable manifest.
 */
export class InternalLinkMapRepository extends Repository {
  async listFrozenCrawlObservations(
    scope: ProjectScope,
    input: {
      readonly diagnosticRunId: string;
      readonly crawlSnapshotId: string;
    },
  ): Promise<InternalLinkCrawlObservationRow[]> {
    assertScope(scope);
    assertUuid("diagnosticRunId", input.diagnosticRunId);
    assertUuid("crawlSnapshotId", input.crawlSnapshotId);

    const result =
      await this.exec.execute<RawInternalLinkCrawlObservationRow>(sql`
        with frozen_crawl as materialized (
          select
            ${dataSnapshots.id} as snapshot_id,
            ${diagnosticRuns.site_id} as site_id
          from ${diagnosticRuns}
          inner join ${asyncRuns}
            on ${asyncRuns.id} = ${diagnosticRuns.id}
           and ${asyncRuns.workspace_id} = ${scope.workspaceId}::uuid
           and ${asyncRuns.project_id} = ${scope.projectId}::uuid
          cross join lateral jsonb_array_elements(
            case
              when jsonb_typeof(
                ${diagnosticRuns.input_manifest} -> 'snapshots'
              ) = 'array'
                then ${diagnosticRuns.input_manifest} -> 'snapshots'
              else '[]'::jsonb
            end
          ) frozen_manifest(snapshot_entry)
          inner join ${dataSnapshots}
            on ${dataSnapshots.id}::text =
              frozen_manifest.snapshot_entry ->> 'snapshotId'
           and ${dataSnapshots.provider} =
              frozen_manifest.snapshot_entry ->> 'provider'
          where ${diagnosticRuns.workspace_id} = ${scope.workspaceId}::uuid
            and ${diagnosticRuns.project_id} = ${scope.projectId}::uuid
            and ${diagnosticRuns.id} = ${input.diagnosticRunId}::uuid
            and ${asyncRuns.kind} = 'diagnostic'
            and ${asyncRuns.status} in ('completed', 'partial')
            and ${dataSnapshots.workspace_id} = ${scope.workspaceId}::uuid
            and ${dataSnapshots.project_id} = ${scope.projectId}::uuid
            and ${dataSnapshots.site_id} = ${diagnosticRuns.site_id}
            and ${dataSnapshots.id} = ${input.crawlSnapshotId}::uuid
            and ${dataSnapshots.provider} = 'crawl'
            and frozen_manifest.snapshot_entry ->> 'provider' = 'crawl'
        )
        select
          ${normalizedObservations.id} as observation_id,
          ${normalizedObservations.workspace_id} as workspace_id,
          ${normalizedObservations.project_id} as project_id,
          ${normalizedObservations.snapshot_id} as snapshot_id,
          ${normalizedObservations.site_page_id} as site_page_id,
          ${normalizedObservations.provider} as provider,
          ${normalizedObservations.metric_key} as metric_key,
          ${normalizedObservations.subject_type} as subject_type,
          ${normalizedObservations.subject_ref} as subject_ref,
          ${normalizedObservations.observed_at} as observed_at,
          ${normalizedObservations.availability} as availability,
          ${normalizedObservations.value_numeric} as value_numeric,
          ${normalizedObservations.value_text} as value_text,
          ${normalizedObservations.value_json} as value_json,
          ${normalizedObservations.unit} as unit,
          ${normalizedObservations.origin} as origin,
          ${normalizedObservations.method} as method,
          ${normalizedObservations.grade} as grade,
          ${normalizedObservations.support} as support,
          ${normalizedObservations.limitation} as limitation,
          ${sitePages.normalized_url} as normalized_url
        from frozen_crawl
        inner join ${normalizedObservations}
          on ${normalizedObservations.snapshot_id} =
            frozen_crawl.snapshot_id
         and ${normalizedObservations.workspace_id} =
            ${scope.workspaceId}::uuid
         and ${normalizedObservations.project_id} =
            ${scope.projectId}::uuid
         and ${normalizedObservations.provider} = 'crawl'
         and ${normalizedObservations.metric_key} = 'crawl.page.v1'
         and ${normalizedObservations.subject_type} = 'url'
        left join ${sitePages}
          on ${sitePages.id} = ${normalizedObservations.site_page_id}
         and ${sitePages.workspace_id} = ${scope.workspaceId}::uuid
         and ${sitePages.project_id} = ${scope.projectId}::uuid
         and ${sitePages.site_id} = frozen_crawl.site_id
        order by
          ${normalizedObservations.subject_ref} asc,
          ${sitePages.normalized_url} asc,
          ${normalizedObservations.id} asc
        limit ${MAX_INTERNAL_LINK_MAP_OBSERVATIONS + 1}
      `);
    if (result.rows.length > MAX_INTERNAL_LINK_MAP_OBSERVATIONS) {
      throw new InternalLinkMapIntegrityError(
        "CRAWL_OBSERVATION_LIMIT_EXCEEDED",
      );
    }
    return result.rows.map(normalizedObservation);
  }

  async listExecutionRefs(
    scope: ProjectScope,
    diagnosticRunId: string,
    sitePageIdsInput: readonly string[],
  ): Promise<InternalLinkExecutionRefRow[]> {
    assertScope(scope);
    assertUuid("diagnosticRunId", diagnosticRunId);
    const sitePageIds = uniqueBoundedIds(
      "sitePageIds",
      sitePageIdsInput,
    );
    if (sitePageIds.length === 0) return [];

    const result =
      await this.exec.execute<InternalLinkExecutionRefRow>(sql`
        select
          ${findingTargets.site_page_id} as site_page_id,
          ${findings.id} as finding_id,
          ${actions.id} as action_id
        from ${findingTargets}
        inner join ${findings}
          on ${findings.id} = ${findingTargets.finding_id}
         and ${findings.workspace_id} = ${scope.workspaceId}::uuid
         and ${findings.project_id} = ${scope.projectId}::uuid
         and ${findings.last_seen_run_id} =
            ${diagnosticRunId}::uuid
         and ${findings.rule_id} = 'TECH-LINKGRAPH-005'
         and ${findings.rule_version} = 2
         and ${findings.active} = true
        left join ${actions}
          on ${actions.source_finding_id} = ${findings.id}
         and ${actions.workspace_id} = ${scope.workspaceId}::uuid
         and ${actions.project_id} = ${scope.projectId}::uuid
         and ${actions.status} <> 'dismissed'
        where ${findingTargets.workspace_id} =
              ${scope.workspaceId}::uuid
          and ${findingTargets.project_id} = ${scope.projectId}::uuid
          and ${findingTargets.diagnostic_run_id} =
              ${diagnosticRunId}::uuid
          and ${findingTargets.resolution_state} = 'resolved'
          and ${findingTargets.relation} = 'affected_by_page_set'
          and ${findingTargets.target_kind} = 'page_set'
          and ${findingTargets.basis_kind} = 'crawl_exact_fetch'
          and ${findingTargets.limitation} is null
          and ${findingTargets.site_page_id} in (
            ${uuidList(sitePageIds)}
          )
        order by
          ${findingTargets.site_page_id} asc,
          ${findings.id} asc,
          ${actions.id} asc nulls last
        limit ${MAX_INTERNAL_LINK_MAP_EXECUTION_ROWS + 1}
      `);
    if (result.rows.length > MAX_INTERNAL_LINK_MAP_EXECUTION_ROWS) {
      throw new InternalLinkMapIntegrityError(
        "EXECUTION_REF_LIMIT_EXCEEDED",
      );
    }
    return result.rows;
  }

  async readConfirmedPageTopics(
    scope: ProjectScope,
    sitePageIdsInput: readonly string[],
  ): Promise<InternalLinkPageTopicAuthority> {
    assertScope(scope);
    const sitePageIds = uniqueBoundedIds(
      "sitePageIds",
      sitePageIdsInput,
    );
    if (sitePageIds.length === 0) {
      return { state: "not_requested", projectId: scope.projectId };
    }

    const result =
      await this.exec.execute<TopicAuthorityQueryRow>(sql`
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
            decision.topic_model_revision as decision_topic_model_revision,
            decision.cluster_key_at_decision,
            decision.mapping_decision as decision_mapping_decision,
            decision.mapped_site_page_id as decision_mapped_site_page_id,
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
            order by latest.governance_revision desc, latest.id desc
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
                    (authority.decision_mapped_site_page_id is not null)
                  )
                  or (
                    authority.assignment_invalidated_by is not null
                    and authority.decision_review_state <> 'unreviewed'
                  )
                )
            )::integer as invalid_decision_count
          from current_keyword_authority authority
        ),
        eligible_mappings as materialized (
          select distinct
            authority.decision_mapped_site_page_id as site_page_id,
            node.topic_node_id,
            node.label as topic_label
          from current_keyword_authority authority
          inner join active_nodes node
            on node.topic_node_id =
              authority.decision_topic_node_id
          inner join latest_confirmed model
            on authority.decision_topic_model_revision = model.revision
          where authority.decision_id is not null
            and authority.decision_status <> 'excluded'
            and authority.decision_review_state = 'confirmed'
            and authority.assignment_invalidated_by is null
            and authority.decision_mapping_decision = 'existing_page'
            and authority.decision_mapped_site_page_id in (
              ${uuidList(sitePageIds)}
            )
        )
        select
          exists(select 1 from active_project) as project_exists,
          (
            select model.revision
            from latest_confirmed model
          )::integer as topic_model_revision,
          mapping.site_page_id,
          mapping.topic_node_id,
          mapping.topic_label,
          integrity.missing_decision_count,
          integrity.mirror_divergence_count,
          integrity.invalid_decision_count
        from authority_integrity integrity
        left join eligible_mappings mapping on true
        order by
          mapping.site_page_id asc nulls last,
          mapping.topic_node_id asc nulls last
        limit ${MAX_INTERNAL_LINK_MAP_TOPIC_MAPPINGS + 1}
      `);

    const rows = result.rows;
    if (rows.length > MAX_INTERNAL_LINK_MAP_TOPIC_MAPPINGS) {
      throw new InternalLinkMapIntegrityError(
        "TOPIC_MAPPING_LIMIT_EXCEEDED",
      );
    }
    const first = rows[0];
    if (!first || first.project_exists !== true) {
      throw new InternalLinkMapIntegrityError(
        "TOPIC_AUTHORITY_RESULT_INVALID",
      );
    }
    for (const row of rows) {
      if (
        row.project_exists !== true ||
        checkedCount(row.missing_decision_count) !==
          checkedCount(first.missing_decision_count) ||
        checkedCount(row.mirror_divergence_count) !==
          checkedCount(first.mirror_divergence_count) ||
        checkedCount(row.invalid_decision_count) !==
          checkedCount(first.invalid_decision_count) ||
        row.topic_model_revision !== first.topic_model_revision
      ) {
        throw new InternalLinkMapIntegrityError(
          "TOPIC_AUTHORITY_RESULT_INVALID",
        );
      }
    }
    if (
      first.missing_decision_count !== 0 ||
      first.mirror_divergence_count !== 0 ||
      first.invalid_decision_count !== 0
    ) {
      throw new InternalLinkMapIntegrityError(
        "KEYWORD_AUTHORITY_DIVERGED",
      );
    }
    if (first.topic_model_revision === null) {
      if (
        rows.some(
          (row) =>
            row.site_page_id !== null ||
            row.topic_node_id !== null ||
            row.topic_label !== null,
        )
      ) {
        throw new InternalLinkMapIntegrityError(
          "TOPIC_AUTHORITY_RESULT_INVALID",
        );
      }
      return {
        state: "no_confirmed_model",
        projectId: scope.projectId,
      };
    }

    const revision = checkedRevision(first.topic_model_revision);
    const mappings: InternalLinkPageTopicMapping[] = [];
    let previousKey: string | null = null;
    for (const row of rows) {
      const fields = [
        row.site_page_id,
        row.topic_node_id,
        row.topic_label,
      ];
      if (fields.every((value) => value === null)) continue;
      if (
        typeof row.site_page_id !== "string" ||
        typeof row.topic_node_id !== "string" ||
        typeof row.topic_label !== "string" ||
        !sitePageIds.includes(row.site_page_id) ||
        !UUID.test(row.topic_node_id) ||
        row.topic_label.length < 1 ||
        row.topic_label.length > 200 ||
        row.topic_label.trim() !== row.topic_label
      ) {
        throw new InternalLinkMapIntegrityError(
          "TOPIC_AUTHORITY_RESULT_INVALID",
        );
      }
      const key = `${row.site_page_id}\u0000${row.topic_node_id}`;
      if (previousKey !== null && previousKey >= key) {
        throw new InternalLinkMapIntegrityError(
          "TOPIC_AUTHORITY_RESULT_INVALID",
        );
      }
      previousKey = key;
      mappings.push({
        sitePageId: row.site_page_id,
        topicNodeId: row.topic_node_id,
        topicModelRevision: revision,
        topicLabel: row.topic_label,
      });
    }
    return {
      state: "confirmed",
      projectId: scope.projectId,
      topicModelRevision: revision,
      mappings,
    };
  }
}
