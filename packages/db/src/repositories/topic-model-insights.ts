import { sql } from "drizzle-orm";
import {
  clientProjects,
  keywordEntities,
  keywordReviewDecisions,
  topicModelRevisions,
  topicNodeRevisions,
} from "../schema.ts";
import {
  Repository,
  type ProjectScope,
} from "./base.ts";

export const MAX_ACTIVE_TOPIC_INSIGHT_NODES = 500;

export type TopicModelInsightsConflictCode = "PROJECT_NOT_FOUND";

export class TopicModelInsightsConflictError extends Error {
  override readonly name = "TopicModelInsightsConflictError";

  constructor(readonly code: TopicModelInsightsConflictCode) {
    super("The Topic insight project does not exist or is archived");
  }
}

export type TopicModelInsightsIntegrityCode =
  | "RESULT_SHAPE_INVALID"
  | "MODEL_LINEAGE_INVALID"
  | "ACTIVE_NODE_LIMIT_EXCEEDED"
  | "ACTIVE_NODE_LINEAGE_INVALID"
  | "KEYWORD_AUTHORITY_DIVERGED"
  | "NODE_AGGREGATE_INVALID"
  | "KEYWORD_SCOPE_PARTITION_INVALID";

export class TopicModelInsightsIntegrityError extends Error {
  override readonly name = "TopicModelInsightsIntegrityError";

  constructor(readonly code: TopicModelInsightsIntegrityCode) {
    super(`Topic Model insights failed integrity validation: ${code}`);
  }
}

export interface TopicNodeInsightFacts {
  readonly topicNodeId: string;
  readonly topicModelRevision: number;
  readonly label: string;
  readonly keywordCount: number;
  readonly approvedKeywordCount: number;
  readonly reviewPendingKeywordCount: number;
  readonly existingPageKeywordCount: number;
  readonly newAssetKeywordCount: number;
  readonly unassignedKeywordCount: number;
  readonly mappedPageCount: number;
  readonly conflictingIntentCount: number;
}

export type TopicModelInsightsAuthority =
  | {
      readonly state: "no_confirmed_model";
      readonly projectId: string;
    }
  | {
      readonly state: "confirmed";
      readonly projectId: string;
      readonly topicModelRevision: number;
      readonly nodes: readonly TopicNodeInsightFacts[];
      readonly nonExcludedKeywordCount: number;
      readonly unassignedTopicKeywordCount: number;
      readonly orphanAssignmentCount: number;
      readonly invalidatedAssignmentCount: number;
    };

interface TopicModelInsightQueryRow extends Record<string, unknown> {
  readonly project_exists: boolean;
  readonly project_id: string;
  readonly model_id: string | null;
  readonly model_workspace_id: string | null;
  readonly model_project_id: string | null;
  readonly topic_model_revision: number | null;
  readonly model_status: string | null;
  readonly topic_node_id: string | null;
  readonly node_workspace_id: string | null;
  readonly node_project_id: string | null;
  readonly node_topic_model_revision: number | null;
  readonly node_label: string | null;
  readonly node_lifecycle_state: string | null;
  readonly keyword_count: number;
  readonly approved_keyword_count: number;
  readonly review_pending_keyword_count: number;
  readonly existing_page_keyword_count: number;
  readonly new_asset_keyword_count: number;
  readonly unassigned_keyword_count: number;
  readonly mapped_page_count: number;
  readonly conflicting_intent_count: number;
  readonly missing_decision_count: number;
  readonly mirror_divergence_count: number;
  readonly decision_shape_invalid_count: number;
  readonly non_excluded_keyword_count: number;
  readonly unassigned_topic_keyword_count: number;
  readonly orphan_assignment_count: number;
  readonly invalidated_assignment_count: number;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

function assertScope(scope: ProjectScope): void {
  if (!UUID.test(scope.workspaceId) || !UUID.test(scope.projectId)) {
    throw new RangeError(
      "Topic Model insight scope must contain canonical UUIDs",
    );
  }
}

function checkedCount(
  value: unknown,
  code: TopicModelInsightsIntegrityCode,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_POSTGRES_INTEGER
  ) {
    throw new TopicModelInsightsIntegrityError(code);
  }
  return value;
}

function checkedRevision(
  value: unknown,
  code: TopicModelInsightsIntegrityCode,
): number {
  const revision = checkedCount(value, code);
  if (revision < 1) {
    throw new TopicModelInsightsIntegrityError(code);
  }
  return revision;
}

function sameGlobalCount(
  rows: readonly TopicModelInsightQueryRow[],
  field:
    | "missing_decision_count"
    | "mirror_divergence_count"
    | "decision_shape_invalid_count"
    | "non_excluded_keyword_count"
    | "unassigned_topic_keyword_count"
    | "orphan_assignment_count"
    | "invalidated_assignment_count",
): number {
  const first = checkedCount(
    rows[0]?.[field],
    "RESULT_SHAPE_INVALID",
  );
  if (
    rows.some(
      (row) =>
        checkedCount(row[field], "RESULT_SHAPE_INVALID") !== first,
    )
  ) {
    throw new TopicModelInsightsIntegrityError(
      "RESULT_SHAPE_INVALID",
    );
  }
  return first;
}

/**
 * Read the latest confirmed Topic Model and current Keyword authority in one
 * bounded project-scoped statement. Draft models are deliberately absent from
 * the query and cannot affect customer-visible insight.
 */
export class TopicModelInsightsRepository extends Repository {
  async readLatestConfirmed(
    scope: ProjectScope,
  ): Promise<TopicModelInsightsAuthority> {
    assertScope(scope);
    const result = await this.exec.execute<TopicModelInsightQueryRow>(sql`
      with
      active_project as materialized (
        select
          ${clientProjects.workspace_id} as workspace_id,
          ${clientProjects.id} as project_id
        from ${clientProjects}
        where ${clientProjects.workspace_id} = ${scope.workspaceId}::uuid
          and ${clientProjects.id} = ${scope.projectId}::uuid
          and ${clientProjects.archived_at} is null
      ),
      latest_confirmed as materialized (
        select
          model.id,
          model.workspace_id,
          model.project_id,
          model.revision,
          model.status
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
          node.workspace_id,
          node.project_id,
          node.topic_node_id,
          node.topic_model_revision,
          node.label,
          node.lifecycle_state
        from ${topicNodeRevisions} node
        inner join latest_confirmed model
          on model.workspace_id = node.workspace_id
         and model.project_id = node.project_id
         and model.revision = node.topic_model_revision
        where node.lifecycle_state = 'active'
      ),
      current_keyword_authority as materialized (
        select
          entity.id as keyword_entity_id,
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
          decision.keyword_entity_id as decision_keyword_entity_id,
          decision.governance_revision as decision_governance_revision,
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
          order by
            latest.governance_revision desc,
            latest.id desc
          limit 1
        ) decision on true
        where entity.workspace_id = ${scope.workspaceId}::uuid
          and entity.project_id = ${scope.projectId}::uuid
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
                or authority.keyword_entity_id is distinct from
                  authority.decision_keyword_entity_id
                or authority.entity_mapping_revision is distinct from
                  authority.decision_governance_revision
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
                  (authority.decision_mapping_decision = 'existing_page') <>
                  (authority.decision_mapped_site_page_id is not null)
                )
                or (
                  authority.assignment_invalidated_by is not null
                  and authority.decision_review_state <> 'unreviewed'
                )
              )
          )::integer as decision_shape_invalid_count,
          count(*) filter (
            where authority.decision_id is not null
              and authority.decision_status <> 'excluded'
          )::integer as non_excluded_keyword_count,
          count(*) filter (
            where authority.decision_id is not null
              and authority.decision_status <> 'excluded'
              and authority.decision_topic_node_id is null
          )::integer as unassigned_topic_keyword_count,
          count(*) filter (
            where authority.decision_id is not null
              and authority.decision_status <> 'excluded'
              and authority.decision_topic_node_id is not null
              and (
                authority.decision_topic_model_revision >
                  coalesce(
                    (select revision from latest_confirmed),
                    0
                  )
                or not exists (
                  select 1
                  from active_nodes node
                  where node.topic_node_id =
                    authority.decision_topic_node_id
                )
              )
          )::integer as orphan_assignment_count,
          count(*) filter (
            where authority.decision_id is not null
              and authority.decision_status <> 'excluded'
              and authority.assignment_invalidated_by is not null
              and authority.decision_topic_model_revision <=
                coalesce(
                  (select revision from latest_confirmed),
                  0
                )
              and exists (
                select 1
                from active_nodes node
                where node.topic_node_id =
                  authority.decision_topic_node_id
              )
          )::integer as invalidated_assignment_count
        from current_keyword_authority authority
      ),
      node_keywords as materialized (
        select authority.*
        from current_keyword_authority authority
        inner join active_nodes node
          on node.topic_node_id = authority.decision_topic_node_id
        inner join latest_confirmed model
          on authority.decision_topic_model_revision <= model.revision
        where authority.decision_id is not null
          and authority.decision_status <> 'excluded'
      ),
      node_counts as materialized (
        select
          keyword.decision_topic_node_id as topic_node_id,
          count(*)::integer as keyword_count,
          count(*) filter (
            where keyword.decision_status = 'approved'
          )::integer as approved_keyword_count,
          count(*) filter (
            where keyword.decision_review_state <> 'confirmed'
              or keyword.assignment_invalidated_by is not null
          )::integer as review_pending_keyword_count,
          count(*) filter (
            where keyword.decision_mapping_decision = 'existing_page'
          )::integer as existing_page_keyword_count,
          count(*) filter (
            where keyword.decision_mapping_decision = 'new_asset'
          )::integer as new_asset_keyword_count,
          count(*) filter (
            where keyword.decision_mapping_decision = 'unassigned'
          )::integer as unassigned_keyword_count,
          count(distinct keyword.decision_mapped_site_page_id) filter (
            where keyword.decision_mapping_decision = 'existing_page'
          )::integer as mapped_page_count
        from node_keywords keyword
        group by keyword.decision_topic_node_id
      ),
      conflicting_intents as materialized (
        select
          keyword.decision_topic_node_id as topic_node_id,
          app.normalize_keyword_relation_semantic(
            keyword.decision_intent
          ) as normalized_intent
        from node_keywords keyword
        where keyword.decision_review_state = 'confirmed'
          and keyword.assignment_invalidated_by is null
          and keyword.decision_intent is not null
          and keyword.decision_mapping_decision = 'existing_page'
        group by
          keyword.decision_topic_node_id,
          app.normalize_keyword_relation_semantic(
            keyword.decision_intent
          )
        having count(
          distinct keyword.decision_mapped_site_page_id
        ) > 1
      ),
      conflict_counts as materialized (
        select
          conflict.topic_node_id,
          count(*)::integer as conflicting_intent_count
        from conflicting_intents conflict
        group by conflict.topic_node_id
      )
      select
        true as project_exists,
        project.project_id,
        model.id as model_id,
        model.workspace_id as model_workspace_id,
        model.project_id as model_project_id,
        model.revision as topic_model_revision,
        model.status as model_status,
        node.topic_node_id,
        node.workspace_id as node_workspace_id,
        node.project_id as node_project_id,
        node.topic_model_revision as node_topic_model_revision,
        node.label as node_label,
        node.lifecycle_state as node_lifecycle_state,
        coalesce(counts.keyword_count, 0)::integer as keyword_count,
        coalesce(
          counts.approved_keyword_count,
          0
        )::integer as approved_keyword_count,
        coalesce(
          counts.review_pending_keyword_count,
          0
        )::integer as review_pending_keyword_count,
        coalesce(
          counts.existing_page_keyword_count,
          0
        )::integer as existing_page_keyword_count,
        coalesce(
          counts.new_asset_keyword_count,
          0
        )::integer as new_asset_keyword_count,
        coalesce(
          counts.unassigned_keyword_count,
          0
        )::integer as unassigned_keyword_count,
        coalesce(counts.mapped_page_count, 0)::integer
          as mapped_page_count,
        coalesce(
          conflicts.conflicting_intent_count,
          0
        )::integer as conflicting_intent_count,
        integrity.missing_decision_count,
        integrity.mirror_divergence_count,
        integrity.decision_shape_invalid_count,
        integrity.non_excluded_keyword_count,
        integrity.unassigned_topic_keyword_count,
        integrity.orphan_assignment_count,
        integrity.invalidated_assignment_count
      from active_project project
      left join latest_confirmed model on true
      left join active_nodes node on model.id is not null
      left join node_counts counts
        on counts.topic_node_id = node.topic_node_id
      left join conflict_counts conflicts
        on conflicts.topic_node_id = node.topic_node_id
      cross join authority_integrity integrity
      order by node.topic_node_id asc nulls last
      limit ${MAX_ACTIVE_TOPIC_INSIGHT_NODES + 1}
    `);

    if (result.rows.length === 0) {
      throw new TopicModelInsightsConflictError("PROJECT_NOT_FOUND");
    }
    if (result.rows.length > MAX_ACTIVE_TOPIC_INSIGHT_NODES) {
      throw new TopicModelInsightsIntegrityError(
        "ACTIVE_NODE_LIMIT_EXCEEDED",
      );
    }
    const rows = result.rows;
    if (
      rows.some(
        (row) =>
          row.project_exists !== true ||
          row.project_id !== scope.projectId,
      )
    ) {
      throw new TopicModelInsightsIntegrityError(
        "RESULT_SHAPE_INVALID",
      );
    }

    const first = rows[0]!;
    if (first.model_id === null) {
      if (
        rows.length !== 1 ||
        first.model_workspace_id !== null ||
        first.model_project_id !== null ||
        first.topic_model_revision !== null ||
        first.model_status !== null ||
        first.topic_node_id !== null
      ) {
        throw new TopicModelInsightsIntegrityError(
          "MODEL_LINEAGE_INVALID",
        );
      }
      return {
        state: "no_confirmed_model",
        projectId: scope.projectId,
      };
    }

    if (
      !UUID.test(first.model_id) ||
      first.model_workspace_id !== scope.workspaceId ||
      first.model_project_id !== scope.projectId ||
      first.model_status !== "confirmed"
    ) {
      throw new TopicModelInsightsIntegrityError(
        "MODEL_LINEAGE_INVALID",
      );
    }
    const modelRevision = checkedRevision(
      first.topic_model_revision,
      "MODEL_LINEAGE_INVALID",
    );
    if (
      rows.some(
        (row) =>
          row.model_id !== first.model_id ||
          row.model_workspace_id !== scope.workspaceId ||
          row.model_project_id !== scope.projectId ||
          row.topic_model_revision !== modelRevision ||
          row.model_status !== "confirmed",
      )
    ) {
      throw new TopicModelInsightsIntegrityError(
        "MODEL_LINEAGE_INVALID",
      );
    }

    const missingDecisionCount = sameGlobalCount(
      rows,
      "missing_decision_count",
    );
    const mirrorDivergenceCount = sameGlobalCount(
      rows,
      "mirror_divergence_count",
    );
    const decisionShapeInvalidCount = sameGlobalCount(
      rows,
      "decision_shape_invalid_count",
    );
    if (
      missingDecisionCount > 0 ||
      mirrorDivergenceCount > 0 ||
      decisionShapeInvalidCount > 0
    ) {
      throw new TopicModelInsightsIntegrityError(
        "KEYWORD_AUTHORITY_DIVERGED",
      );
    }

    const nodeIds = new Set<string>();
    const nodes = rows.map((row): TopicNodeInsightFacts => {
      if (
        row.topic_node_id === null ||
        !UUID.test(row.topic_node_id) ||
        row.node_workspace_id !== scope.workspaceId ||
        row.node_project_id !== scope.projectId ||
        row.node_topic_model_revision !== modelRevision ||
        row.node_lifecycle_state !== "active" ||
        typeof row.node_label !== "string" ||
        row.node_label.length < 1 ||
        row.node_label.length > 200 ||
        row.node_label.trim() !== row.node_label ||
        nodeIds.has(row.topic_node_id)
      ) {
        throw new TopicModelInsightsIntegrityError(
          "ACTIVE_NODE_LINEAGE_INVALID",
        );
      }
      nodeIds.add(row.topic_node_id);

      const keywordCount = checkedCount(
        row.keyword_count,
        "NODE_AGGREGATE_INVALID",
      );
      const approvedKeywordCount = checkedCount(
        row.approved_keyword_count,
        "NODE_AGGREGATE_INVALID",
      );
      const reviewPendingKeywordCount = checkedCount(
        row.review_pending_keyword_count,
        "NODE_AGGREGATE_INVALID",
      );
      const existingPageKeywordCount = checkedCount(
        row.existing_page_keyword_count,
        "NODE_AGGREGATE_INVALID",
      );
      const newAssetKeywordCount = checkedCount(
        row.new_asset_keyword_count,
        "NODE_AGGREGATE_INVALID",
      );
      const unassignedKeywordCount = checkedCount(
        row.unassigned_keyword_count,
        "NODE_AGGREGATE_INVALID",
      );
      const mappedPageCount = checkedCount(
        row.mapped_page_count,
        "NODE_AGGREGATE_INVALID",
      );
      const conflictingIntentCount = checkedCount(
        row.conflicting_intent_count,
        "NODE_AGGREGATE_INVALID",
      );
      if (
        existingPageKeywordCount +
          newAssetKeywordCount +
          unassignedKeywordCount !==
          keywordCount ||
        approvedKeywordCount > keywordCount ||
        reviewPendingKeywordCount > keywordCount ||
        mappedPageCount > existingPageKeywordCount ||
        conflictingIntentCount > existingPageKeywordCount ||
        (conflictingIntentCount > 0 &&
          (existingPageKeywordCount < 2 || mappedPageCount < 2))
      ) {
        throw new TopicModelInsightsIntegrityError(
          "NODE_AGGREGATE_INVALID",
        );
      }
      return {
        topicNodeId: row.topic_node_id,
        topicModelRevision: modelRevision,
        label: row.node_label,
        keywordCount,
        approvedKeywordCount,
        reviewPendingKeywordCount,
        existingPageKeywordCount,
        newAssetKeywordCount,
        unassignedKeywordCount,
        mappedPageCount,
        conflictingIntentCount,
      };
    });
    if (nodes.length === 0) {
      throw new TopicModelInsightsIntegrityError(
        "ACTIVE_NODE_LINEAGE_INVALID",
      );
    }

    const nonExcludedKeywordCount = sameGlobalCount(
      rows,
      "non_excluded_keyword_count",
    );
    const unassignedTopicKeywordCount = sameGlobalCount(
      rows,
      "unassigned_topic_keyword_count",
    );
    const orphanAssignmentCount = sameGlobalCount(
      rows,
      "orphan_assignment_count",
    );
    const invalidatedAssignmentCount = sameGlobalCount(
      rows,
      "invalidated_assignment_count",
    );
    const assignedKeywordCount = nodes.reduce(
      (total, node) => total + node.keywordCount,
      0,
    );
    const reviewPendingKeywordCount = nodes.reduce(
      (total, node) => total + node.reviewPendingKeywordCount,
      0,
    );
    if (
      assignedKeywordCount +
        unassignedTopicKeywordCount +
        orphanAssignmentCount !==
        nonExcludedKeywordCount ||
      invalidatedAssignmentCount > reviewPendingKeywordCount
    ) {
      throw new TopicModelInsightsIntegrityError(
        "KEYWORD_SCOPE_PARTITION_INVALID",
      );
    }

    return {
      state: "confirmed",
      projectId: scope.projectId,
      topicModelRevision: modelRevision,
      nodes,
      nonExcludedKeywordCount,
      unassignedTopicKeywordCount,
      orphanAssignmentCount,
      invalidatedAssignmentCount,
    };
  }
}
