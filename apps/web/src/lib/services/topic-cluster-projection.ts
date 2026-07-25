/**
 * TopicCluster / PageAssignment projection (Slice 2, decision F). Pure
 * functions over the rows `TopicClusterReadRepository` returns; no table, no
 * lifecycle, no second card model. Their only consumer is the Opportunity read
 * model's `supportingFindingIds`.
 *
 * Every branch here is written so that "we could not derive support" is said
 * out loud rather than rendered as a confident empty list.
 */

/** The Opportunity contract caps `supportingFindingIds` at 100 entries. */
export const MAX_SUPPORTING_FINDING_IDS = 100;

export interface TopicClusterSupportRow {
  readonly clusterKey: string;
  /** The owned page the cluster's keywords are mapped to. */
  readonly sitePageId: string;
  /** Null when that page carries no active Finding in the frozen run. */
  readonly findingId: string | null;
  readonly mappingConfirmed: boolean;
}

export interface TopicClusterSupport {
  /** Distinct owned pages this cluster is mapped to, Findings or not. */
  readonly assignedPageCount: number;
  readonly findingIds: readonly string[];
  readonly truncated: boolean;
  readonly unconfirmedMapping: boolean;
}

const NO_ASSIGNMENT_LIMITATION =
  "This keyword cluster is not mapped to any owned page yet, so no supporting Findings could be derived.";
const NO_SUPPORT_LIMITATION =
  "No active Finding of this audit is attached to the pages this keyword cluster is mapped to, so no supporting Findings could be derived.";
const DERIVATION_LIMITATION =
  "Supporting Findings are projected from the reviewed keyword cluster label and the operator's keyword-to-page mapping; they are not a separate rule result.";
const UNCONFIRMED_MAPPING_LIMITATION =
  "At least one keyword-to-page mapping behind this cluster has not been confirmed by a reviewer.";
const TRUNCATED_LIMITATION = `Only the first ${MAX_SUPPORTING_FINDING_IDS} supporting Findings are listed for this cluster.`;

/** The answer for a cluster the read model returned no assignment row for. */
export const EMPTY_TOPIC_CLUSTER_SUPPORT: TopicClusterSupport = {
  assignedPageCount: 0,
  findingIds: [],
  truncated: false,
  unconfirmedMapping: false,
};

export function groupTopicClusterSupportRows(
  rows: readonly TopicClusterSupportRow[],
): Map<string, TopicClusterSupportRow[]> {
  const byCluster = new Map<string, TopicClusterSupportRow[]>();
  for (const row of rows) {
    const bucket = byCluster.get(row.clusterKey) ?? [];
    bucket.push(row);
    byCluster.set(row.clusterKey, bucket);
  }
  return byCluster;
}

/**
 * Fold one cluster's assignment rows into the support this Opportunity may
 * claim. The primary Finding is never its own support (the contract rejects
 * that), ordering is by Finding id so two reads of one frozen run agree, and
 * the cap is applied after the exclusion so it counts what is actually listed.
 */
export function resolveTopicClusterSupport(
  rows: readonly TopicClusterSupportRow[],
  primaryFindingId: string,
): TopicClusterSupport {
  if (rows.length === 0) return EMPTY_TOPIC_CLUSTER_SUPPORT;
  const pages = new Set<string>();
  const findingIds = new Set<string>();
  let unconfirmedMapping = false;
  for (const row of rows) {
    pages.add(row.sitePageId);
    if (!row.mappingConfirmed) unconfirmedMapping = true;
    if (row.findingId !== null && row.findingId !== primaryFindingId) {
      findingIds.add(row.findingId);
    }
  }
  const ordered = [...findingIds].sort();
  return {
    assignedPageCount: pages.size,
    findingIds: ordered.slice(0, MAX_SUPPORTING_FINDING_IDS),
    truncated: ordered.length > MAX_SUPPORTING_FINDING_IDS,
    unconfirmedMapping,
  };
}

/**
 * What the reader has to be told about the list above. This is deliberately
 * verbose on the empty cases: a topic Opportunity with no supporting Findings
 * must not read as "we checked and there is nothing", it must say which half
 * of the chain was missing.
 */
export function topicClusterSupportLimitations(
  support: TopicClusterSupport,
): string[] {
  if (support.assignedPageCount === 0) return [NO_ASSIGNMENT_LIMITATION];
  const limitations: string[] = [];
  if (support.findingIds.length === 0) {
    limitations.push(NO_SUPPORT_LIMITATION);
  } else {
    limitations.push(DERIVATION_LIMITATION);
    if (support.truncated) limitations.push(TRUNCATED_LIMITATION);
  }
  if (support.unconfirmedMapping) {
    limitations.push(UNCONFIRMED_MAPPING_LIMITATION);
  }
  return limitations;
}
