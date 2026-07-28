import type { TopicReference } from "@sf/contracts";
import {
  and,
  eq,
  gte,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import {
  topicClusterAliases,
  topicModelRevisions,
  topicNodeRevisions,
} from "../schema.ts";
import {
  projectPredicate,
  Repository,
  type ProjectScope,
} from "./base.ts";

export interface ResolvedTopicAlias {
  readonly version: 2;
  readonly topicNodeId: string;
  readonly topicModelRevision: number;
  readonly clusterKeyAtObservation: string;
}

function assertAliasInput(clusterKey: string, revision: number): void {
  if (
    clusterKey.length < 1 ||
    clusterKey.length > 200 ||
    clusterKey.trim() !== clusterKey
  ) {
    throw new RangeError(
      "clusterKey must contain 1 to 200 trimmed characters",
    );
  }
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > 2_147_483_647
  ) {
    throw new RangeError(
      "topicModelRevision must be a positive PostgreSQL integer",
    );
  }
}

/**
 * Historical alias authority.
 *
 * Resolution is always pinned to an already-confirmed model revision. Draft
 * aliases whose validity begins in a future revision can therefore never
 * change what the current confirmed model resolves.
 */
export class TopicClusterResolverRepository extends Repository {
  async resolveAliasAtConfirmedRevision(
    scope: ProjectScope,
    clusterKey: string,
    topicModelRevision: number,
  ): Promise<ResolvedTopicAlias | null> {
    assertAliasInput(clusterKey, topicModelRevision);
    const rows = await this.exec
      .select({
        topic_node_id: topicClusterAliases.topic_node_id,
      })
      .from(topicClusterAliases)
      .innerJoin(
        topicModelRevisions,
        and(
          projectPredicate(topicModelRevisions, scope),
          eq(topicModelRevisions.revision, topicModelRevision),
          eq(topicModelRevisions.status, "confirmed"),
        ),
      )
      .innerJoin(
        topicNodeRevisions,
        and(
          projectPredicate(topicNodeRevisions, scope),
          eq(
            topicNodeRevisions.topic_node_id,
            topicClusterAliases.topic_node_id,
          ),
          eq(
            topicNodeRevisions.topic_model_revision,
            topicModelRevision,
          ),
        ),
      )
      .where(
        and(
          projectPredicate(topicClusterAliases, scope),
          eq(topicClusterAliases.legacy_cluster_key, clusterKey),
          lte(
            topicClusterAliases.valid_from_revision,
            topicModelRevision,
          ),
          or(
            isNull(topicClusterAliases.valid_to_revision),
            gte(
              topicClusterAliases.valid_to_revision,
              topicModelRevision,
            ),
          ),
        ),
      )
      .limit(2);
    if (rows.length > 1) {
      throw new Error(
        "Topic alias authority returned overlapping confirmed windows",
      );
    }
    const row = rows[0];
    if (!row) return null;
    const reference = {
      version: 2,
      topicNodeId: row.topic_node_id,
      topicModelRevision,
      clusterKeyAtObservation: clusterKey,
    } as const satisfies TopicReference;
    return reference;
  }
}
