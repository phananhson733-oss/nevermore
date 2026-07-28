import { describe, expect, it } from "vitest";
import {
  GrowthMapInternalLinkMap,
  MAX_INTERNAL_LINK_MAP_EDGES,
} from "./internal-link-map.ts";

const ids = {
  project: "97000000-0000-4000-8000-000000000001",
  run: "97000000-0000-4000-8000-000000000002",
  snapshot: "97000000-0000-4000-8000-000000000003",
  pageA: "97000000-0000-4000-8000-000000000004",
  pageAVariant: "97000000-0000-4000-8000-000000000005",
  pageB: "97000000-0000-4000-8000-000000000006",
  observationA: "97000000-0000-4000-8000-000000000007",
  observationAVariant: "97000000-0000-4000-8000-000000000008",
  observationB: "97000000-0000-4000-8000-000000000009",
  finding: "97000000-0000-4000-8000-000000000010",
  action: "97000000-0000-4000-8000-000000000011",
  topic: "97000000-0000-4000-8000-000000000012",
} as const;

const pageAUrl = "https://example.com/customer-onboarding";
const pageBUrl = "https://example.com/customer-onboarding/checklist";

function edge(
  sourceCanonicalUrl = pageAUrl,
  targetCanonicalUrl = pageBUrl,
) {
  const forward = sourceCanonicalUrl === pageAUrl;
  return {
    sourceCanonicalUrl,
    targetCanonicalUrl,
    sourceSitePageIds: forward
      ? [ids.pageA, ids.pageAVariant]
      : [ids.pageB],
    targetSitePageIds: forward
      ? [ids.pageB]
      : [ids.pageA, ids.pageAVariant],
    facts: forward
      ? [
          {
            observationId: ids.observationA,
            sourceSitePageId: ids.pageA,
            anchorText: "Customer onboarding checklist",
            rel: null,
          },
          {
            observationId: ids.observationAVariant,
            sourceSitePageId: ids.pageAVariant,
            anchorText: "Onboarding checklist",
            rel: "nofollow",
          },
        ]
      : [
          {
            observationId: ids.observationB,
            sourceSitePageId: ids.pageB,
            anchorText: "Customer onboarding",
            rel: null,
          },
        ],
    reciprocal: true,
  };
}

function completeResponse() {
  const forward = edge();
  const backward = edge(pageBUrl, pageAUrl);
  return {
    projectId: ids.project,
    diagnosticRunId: ids.run,
    crawlSnapshot: {
      snapshotId: ids.snapshot,
      capturedAt: "2026-07-28T08:00:00.000Z",
      availability: "available" as const,
      limitation: null,
    },
    coverage: {
      availability: "available" as const,
      crawlCompleteness: "complete" as const,
      limitations: [],
    },
    graph: {
      nodes: [
        {
          canonicalUrl: pageAUrl,
          sitePageIds: [ids.pageA, ids.pageAVariant],
          title: "Customer onboarding",
          inboundCount: 1,
          outboundCount: 1,
          status: "connected" as const,
          executionRefs: [
            { findingId: ids.finding, actionId: ids.action },
          ],
        },
        {
          canonicalUrl: pageBUrl,
          sitePageIds: [ids.pageB],
          title: "Customer onboarding checklist",
          inboundCount: 1,
          outboundCount: 1,
          status: "connected" as const,
          executionRefs: [],
        },
      ],
      edges: [forward, backward],
      totalEdgeCount: 2,
      edgesTruncated: false,
    },
    selectedPage: {
      selectedSitePageId: ids.pageB,
      canonicalUrl: pageBUrl,
      inboundSources: [forward],
      recommendationCoverage: {
        availability: "available" as const,
        limitations: [],
      },
      recommendations: [
        {
          sourceCanonicalUrl: pageAUrl,
          sourceSitePageIds: [ids.pageA, ids.pageAVariant],
          targetCanonicalUrl: pageBUrl,
          targetSitePageIds: [ids.pageB],
          basis: {
            kind: "same_confirmed_topic" as const,
            topicNodeId: ids.topic,
            topicModelRevision: 3,
            topicLabel: "Customer onboarding",
          },
          explanation:
            "来源页与目标页属于同一个已确认 Topic，且冻结 Crawl 中未观察到该方向的内链。",
        },
      ],
      totalRecommendationCount: 1,
      recommendationsTruncated: false,
    },
    generatedAt: "2026-07-28T08:05:00.000Z",
  };
}

describe("Growth Map Internal Link Map contract", () => {
  it("accepts one deterministic complete graph with exact-variant evidence and real execution refs", () => {
    const parsed = GrowthMapInternalLinkMap.parse(completeResponse());

    expect(parsed.graph.nodes[0]?.sitePageIds).toEqual([
      ids.pageA,
      ids.pageAVariant,
    ]);
    expect(parsed.graph.edges[0]?.facts).toHaveLength(2);
    expect(parsed.selectedPage?.inboundSources[0]).toEqual(
      parsed.graph.edges[0],
    );
    expect(parsed.graph.nodes[0]?.executionRefs).toEqual([
      { findingId: ids.finding, actionId: ids.action },
    ]);
  });

  it("rejects unstable node, edge, exact-variant, fact, and execution ordering", () => {
    const valid = completeResponse();
    for (const invalid of [
      {
        ...valid,
        graph: {
          ...valid.graph,
          nodes: [...valid.graph.nodes].reverse(),
        },
      },
      {
        ...valid,
        graph: {
          ...valid.graph,
          edges: [...valid.graph.edges].reverse(),
        },
      },
      {
        ...valid,
        graph: {
          ...valid.graph,
          nodes: [
            {
              ...valid.graph.nodes[0],
              sitePageIds: [
                ids.pageAVariant,
                ids.pageA,
              ],
            },
            valid.graph.nodes[1],
          ],
        },
      },
      {
        ...valid,
        graph: {
          ...valid.graph,
          edges: [
            {
              ...valid.graph.edges[0],
              facts: [...valid.graph.edges[0]!.facts].reverse(),
            },
            valid.graph.edges[1],
          ],
        },
      },
      {
        ...valid,
        graph: {
          ...valid.graph,
          nodes: [
            {
              ...valid.graph.nodes[0],
              executionRefs: [
                { findingId: ids.finding, actionId: ids.action },
                { findingId: ids.finding, actionId: null },
              ],
            },
            valid.graph.nodes[1],
          ],
        },
      },
    ]) {
      expect(GrowthMapInternalLinkMap.safeParse(invalid).success).toBe(false);
    }
  });

  it("rejects duplicate page ownership, unknown endpoints, and count drift in a complete graph", () => {
    const valid = completeResponse();
    for (const invalid of [
      {
        ...valid,
        graph: {
          ...valid.graph,
          nodes: [
            valid.graph.nodes[0],
            {
              ...valid.graph.nodes[1],
              sitePageIds: [ids.pageA],
            },
          ],
        },
      },
      {
        ...valid,
        graph: {
          ...valid.graph,
          edges: [
            {
              ...valid.graph.edges[0],
              targetCanonicalUrl: "https://example.com/not-in-graph",
            },
            valid.graph.edges[1],
          ],
        },
      },
      {
        ...valid,
        graph: {
          ...valid.graph,
          nodes: [
            {
              ...valid.graph.nodes[0],
              inboundCount: 2,
            },
            valid.graph.nodes[1],
          ],
        },
      },
      {
        ...valid,
        graph: {
          ...valid.graph,
          totalEdgeCount: 3,
        },
      },
    ]) {
      expect(GrowthMapInternalLinkMap.safeParse(invalid).success).toBe(false);
    }
  });

  it("allows partial observed facts but never permits an orphan assertion", () => {
    const valid = completeResponse();
    const partial = {
      ...valid,
      crawlSnapshot: {
        ...valid.crawlSnapshot,
        availability: "partial" as const,
        limitation: "Crawl reached the fixed wall-clock budget.",
      },
      coverage: {
        availability: "partial" as const,
        crawlCompleteness: "partial" as const,
        limitations: [
          "抓取不完整，因此不能断言没有观察到入链的页面是孤岛。",
        ],
      },
      graph: {
        nodes: [
          {
            ...valid.graph.nodes[0],
            inboundCount: 0,
            outboundCount: 0,
            status: "unknown" as const,
          },
        ],
        edges: [],
        totalEdgeCount: MAX_INTERNAL_LINK_MAP_EDGES + 1,
        edgesTruncated: true,
      },
      selectedPage: null,
    };

    expect(GrowthMapInternalLinkMap.safeParse(partial).success).toBe(true);
    expect(
      GrowthMapInternalLinkMap.safeParse({
        ...partial,
        graph: {
          ...partial.graph,
          nodes: [
            {
              ...partial.graph.nodes[0],
              status: "orphan",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("requires an unavailable graph to stay empty and explain missing crawl authority", () => {
    const unavailable = {
      ...completeResponse(),
      diagnosticRunId: null,
      crawlSnapshot: null,
      coverage: {
        availability: "unavailable" as const,
        crawlCompleteness: "unavailable" as const,
        limitations: ["当前没有可读取的冻结 Crawl 数据。"],
      },
      graph: {
        nodes: [],
        edges: [],
        totalEdgeCount: 0,
        edgesTruncated: false,
      },
      selectedPage: null,
    };
    expect(GrowthMapInternalLinkMap.safeParse(unavailable).success).toBe(true);

    expect(
      GrowthMapInternalLinkMap.safeParse({
        ...unavailable,
        graph: completeResponse().graph,
      }).success,
    ).toBe(false);
    expect(
      GrowthMapInternalLinkMap.safeParse({
        ...unavailable,
        coverage: {
          ...unavailable.coverage,
          limitations: [],
        },
      }).success,
    ).toBe(false);
  });

  it("requires recommendations to carry confirmed Topic evidence and unavailable authority to return no guesses", () => {
    const valid = completeResponse();
    expect(GrowthMapInternalLinkMap.safeParse(valid).success).toBe(true);

    expect(
      GrowthMapInternalLinkMap.safeParse({
        ...valid,
        selectedPage: {
          ...valid.selectedPage,
          recommendationCoverage: {
            availability: "unavailable",
            limitations: ["目标页没有已确认的 Topic mapping。"],
          },
          recommendations: valid.selectedPage.recommendations,
        },
      }).success,
    ).toBe(false);
    expect(
      GrowthMapInternalLinkMap.safeParse({
        ...valid,
        selectedPage: {
          ...valid.selectedPage,
          recommendations: [
            {
              ...valid.selectedPage.recommendations[0],
              targetCanonicalUrl: pageAUrl,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
