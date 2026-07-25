import { sql } from "drizzle-orm";
import { findings, findingTargets, keywordEntities } from "../schema.ts";
import { Repository, type ProjectScope } from "./base.ts";
import type { KeywordMappingReviewState } from "./keywords.ts";

/**
 * TopicCluster / PageAssignment READ MODEL (Slice 2, decision F).
 *
 * There is no `topic_clusters` table and no `page_assignments` table, and this
 * repository is the reason none is needed: a "topic cluster" is the reviewed
 * `keyword_entities.cluster_key` label, and a "page assignment" is the
 * operator's `keyword_entities.mapped_site_page_id`. Both already exist, are
 * already versioned by `mapping_revision`, and are already de-duplicated by the
 * keyword identity — so a parallel table would only be a second copy that can
 * drift. This read never writes and owns no lifecycle.
 *
 * The one thing it projects is the Finding lineage of a cluster: which Findings
 * of the frozen diagnostic run are attached to a page the cluster's keywords are
 * mapped to. A row with a null `finding_id` is a real answer, not a miss: that
 * page IS assigned to the cluster and simply carries no eligible Finding.
 */

export const MAX_TOPIC_CLUSTER_LOOKUP = 100;
const MAX_TOPIC_CLUSTER_KEY_LENGTH = 200;

export interface TopicClusterSupportingFindingRow {
  readonly cluster_key: string;
  readonly site_page_id: string;
  /** Null when the assigned page carries no active Finding in this run. */
  readonly finding_id: string | null;
  readonly mapping_review_state: KeywordMappingReviewState;
}

function assertClusterKey(value: string): void {
  if (
    value.length < 1 ||
    value.length > MAX_TOPIC_CLUSTER_KEY_LENGTH ||
    value.trim() !== value
  ) {
    throw new RangeError(
      `clusterKeys entries must be trimmed and 1 to ${MAX_TOPIC_CLUSTER_KEY_LENGTH} characters`,
    );
  }
}

function assertRunId(value: string): void {
  if (value.trim().length === 0 || value.length > 256) {
    throw new RangeError("diagnosticRunId must be between 1 and 256 characters");
  }
}

function textList(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql`${value}::text`),
    sql`, `,
  );
}

export class TopicClusterReadRepository extends Repository {
  /**
   * One bounded read of the cluster -> assigned page -> Finding chain for a
   * frozen diagnostic run. Only `resolved` FindingTargets participate, because
   * an unresolved or definition-only target has no page membership to assign,
   * and only Findings last seen by this run are eligible, so a stale Finding
   * from an older run can never be cited as support for a current cluster.
   */
  async listSupportingFindings(
    scope: ProjectScope,
    diagnosticRunId: string,
    clusterKeysInput: readonly string[],
  ): Promise<TopicClusterSupportingFindingRow[]> {
    const clusterKeys = [...new Set(clusterKeysInput)];
    if (clusterKeys.length === 0) return [];
    if (clusterKeys.length > MAX_TOPIC_CLUSTER_LOOKUP) {
      throw new RangeError(
        `clusterKeys accepts at most ${MAX_TOPIC_CLUSTER_LOOKUP} unique keys`,
      );
    }
    for (const key of clusterKeys) assertClusterKey(key);
    assertRunId(diagnosticRunId);

    const result = await this.exec.execute<Record<string, unknown>>(sql`
      select distinct
        ${keywordEntities.cluster_key} as cluster_key,
        ${keywordEntities.mapped_site_page_id} as site_page_id,
        ${findings.id} as finding_id,
        ${keywordEntities.mapping_review_state} as mapping_review_state
      from ${keywordEntities}
      left join ${findingTargets}
        on ${findingTargets.workspace_id} = ${keywordEntities.workspace_id}
       and ${findingTargets.project_id} = ${keywordEntities.project_id}
       and ${findingTargets.site_page_id} = ${keywordEntities.mapped_site_page_id}
       and ${findingTargets.diagnostic_run_id} = ${diagnosticRunId}::uuid
       and ${findingTargets.resolution_state} = 'resolved'
      left join ${findings}
        on ${findings.workspace_id} = ${findingTargets.workspace_id}
       and ${findings.project_id} = ${findingTargets.project_id}
       and ${findings.id} = ${findingTargets.finding_id}
       and ${findings.active} = true
       and ${findings.last_seen_run_id} = ${diagnosticRunId}::uuid
      where ${keywordEntities.workspace_id} = ${scope.workspaceId}::uuid
        and ${keywordEntities.project_id} = ${scope.projectId}::uuid
        and ${keywordEntities.cluster_key} in (${textList(clusterKeys)})
        and ${keywordEntities.mapped_site_page_id} is not null
        and ${keywordEntities.mapping_decision} = 'existing_page'
      order by 1 asc, 2 asc, 3 asc
    `);
    return result.rows as unknown as TopicClusterSupportingFindingRow[];
  }
}
