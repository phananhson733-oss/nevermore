import { describe, expect, it } from "vitest";
import {
  EMPTY_TOPIC_CLUSTER_SUPPORT,
  MAX_SUPPORTING_FINDING_IDS,
  groupTopicClusterSupportRows,
  resolveTopicClusterSupport,
  topicClusterSupportLimitations,
  type TopicClusterSupportRow,
} from "./topic-cluster-projection";

const PRIMARY = "40000000-0000-4000-8000-000000000001";
const SUPPORT_A = "40000000-0000-4000-8000-000000000002";
const SUPPORT_B = "40000000-0000-4000-8000-000000000003";
const PAGE_A = "40000000-0000-4000-8000-000000000011";
const PAGE_B = "40000000-0000-4000-8000-000000000012";

function row(
  overrides: Partial<TopicClusterSupportRow> = {},
): TopicClusterSupportRow {
  return {
    clusterKey: "customer-onboarding",
    sitePageId: PAGE_A,
    findingId: SUPPORT_A,
    mappingConfirmed: true,
    ...overrides,
  };
}

describe("groupTopicClusterSupportRows", () => {
  it("buckets rows by their cluster label and keeps every row", () => {
    const grouped = groupTopicClusterSupportRows([
      row(),
      row({ sitePageId: PAGE_B, findingId: SUPPORT_B }),
      row({ clusterKey: "pricing", findingId: null }),
    ]);
    expect([...grouped.keys()].sort()).toEqual(["customer-onboarding", "pricing"]);
    expect(grouped.get("customer-onboarding")).toHaveLength(2);
    expect(grouped.get("pricing")).toHaveLength(1);
  });

  it("returns an empty map for no rows", () => {
    expect(groupTopicClusterSupportRows([]).size).toBe(0);
  });
});

describe("resolveTopicClusterSupport", () => {
  it("reports the empty support for a cluster with no assignment row", () => {
    expect(resolveTopicClusterSupport([], PRIMARY)).toEqual(
      EMPTY_TOPIC_CLUSTER_SUPPORT,
    );
  });

  it("collects the distinct Findings attached to the assigned pages", () => {
    const support = resolveTopicClusterSupport(
      [
        row({ findingId: SUPPORT_B }),
        row({ findingId: SUPPORT_A }),
        // The same Finding reached through a second assigned page.
        row({ sitePageId: PAGE_B, findingId: SUPPORT_A }),
      ],
      PRIMARY,
    );
    expect(support.assignedPageCount).toBe(2);
    expect(support.findingIds).toEqual([SUPPORT_A, SUPPORT_B]);
    expect(support.truncated).toBe(false);
    expect(support.unconfirmedMapping).toBe(false);
  });

  it("never lets the Opportunity's own Finding support itself", () => {
    const support = resolveTopicClusterSupport(
      [row({ findingId: PRIMARY }), row({ findingId: SUPPORT_A })],
      PRIMARY,
    );
    expect(support.findingIds).toEqual([SUPPORT_A]);
  });

  it("counts an assigned page that carries no Finding", () => {
    const support = resolveTopicClusterSupport([row({ findingId: null })], PRIMARY);
    expect(support.assignedPageCount).toBe(1);
    expect(support.findingIds).toEqual([]);
  });

  it("flags an unconfirmed keyword-to-page mapping", () => {
    const support = resolveTopicClusterSupport(
      [row(), row({ sitePageId: PAGE_B, mappingConfirmed: false })],
      PRIMARY,
    );
    expect(support.unconfirmedMapping).toBe(true);
  });

  it("caps the list at the contract maximum and says so", () => {
    const rows = Array.from({ length: MAX_SUPPORTING_FINDING_IDS + 5 }, (_, i) =>
      row({ findingId: `40000000-0000-4000-8000-${String(i).padStart(12, "0")}` }),
    );
    const support = resolveTopicClusterSupport(rows, PRIMARY);
    expect(support.findingIds).toHaveLength(MAX_SUPPORTING_FINDING_IDS);
    expect(support.truncated).toBe(true);
    // The cap is applied after the exclusion, so it counts what is listed.
    expect(support.findingIds).not.toContain(PRIMARY);
  });
});

describe("topicClusterSupportLimitations", () => {
  it("says the cluster is unmapped rather than showing a bare empty list", () => {
    expect(topicClusterSupportLimitations(EMPTY_TOPIC_CLUSTER_SUPPORT)).toEqual([
      "This keyword cluster is not mapped to any owned page yet, so no supporting Findings could be derived.",
    ]);
  });

  it("distinguishes a mapped cluster whose pages carry no Finding", () => {
    const limitations = topicClusterSupportLimitations({
      assignedPageCount: 2,
      findingIds: [],
      truncated: false,
      unconfirmedMapping: false,
    });
    expect(limitations).toEqual([
      "No active Finding of this audit is attached to the pages this keyword cluster is mapped to, so no supporting Findings could be derived.",
    ]);
  });

  it("names the derivation, the truncation, and the unconfirmed mapping", () => {
    const limitations = topicClusterSupportLimitations({
      assignedPageCount: 3,
      findingIds: [SUPPORT_A],
      truncated: true,
      unconfirmedMapping: true,
    });
    expect(limitations).toEqual([
      "Supporting Findings are projected from the reviewed keyword cluster label and the operator's keyword-to-page mapping; they are not a separate rule result.",
      `Only the first ${MAX_SUPPORTING_FINDING_IDS} supporting Findings are listed for this cluster.`,
      "At least one keyword-to-page mapping behind this cluster has not been confirmed by a reviewer.",
    ]);
  });
});
