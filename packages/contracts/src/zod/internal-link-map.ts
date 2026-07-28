import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

export const MAX_INTERNAL_LINK_MAP_NODES = 2_000;
export const MAX_INTERNAL_LINK_MAP_EDGES = 20_000;
export const MAX_INTERNAL_LINK_MAP_RECOMMENDATIONS = 50;

const Count = z.number().int().nonnegative().max(2_000_000);
const CanonicalUrl = z.string().trim().url().max(2048);
const BoundedText = z.string().trim().min(1).max(2000);
const NullableTitle = z.string().trim().min(1).max(500).nullable();
const NullableAnchor = z.string().max(512).nullable();
const NullableRel = z.string().max(256).nullable();

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isAsciiSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}

function exactSortedUuidArray(maximum: number) {
  return z
    .array(Uuid)
    .min(1)
    .max(maximum)
    .refine(isUnique, "SitePage identities must be unique")
    .refine(isAsciiSorted, "SitePage identities must use ascending UUID order");
}

const UniqueLimitations = z
  .array(BoundedText)
  .max(100)
  .refine(isUnique, "Limitations must be unique");

export const InternalLinkMapCoverage = z
  .object({
    availability: z.enum(["available", "partial", "unavailable"]),
    crawlCompleteness: z.enum(["complete", "partial", "unavailable"]),
    limitations: UniqueLimitations,
  })
  .strict()
  .superRefine((coverage, ctx) => {
    const expectedCompleteness =
      coverage.availability === "available"
        ? "complete"
        : coverage.availability === "partial"
          ? "partial"
          : "unavailable";
    if (coverage.crawlCompleteness !== expectedCompleteness) {
      ctx.addIssue({
        code: "custom",
        path: ["crawlCompleteness"],
        message:
          "Internal Link Map availability and crawl completeness must agree",
      });
    }
    if (
      (coverage.availability === "available") !==
      (coverage.limitations.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitations"],
        message:
          "Only an available Internal Link Map may omit limitations",
      });
    }
  });
export type InternalLinkMapCoverage = z.infer<
  typeof InternalLinkMapCoverage
>;

export const InternalLinkMapExecutionRef = z
  .object({
    findingId: Uuid,
    actionId: Uuid.nullable(),
  })
  .strict();
export type InternalLinkMapExecutionRef = z.infer<
  typeof InternalLinkMapExecutionRef
>;

export const InternalLinkMapNodeStatus = z.enum([
  "connected",
  "one_way",
  "orphan",
  "unknown",
]);
export type InternalLinkMapNodeStatus = z.infer<
  typeof InternalLinkMapNodeStatus
>;

export const InternalLinkMapNode = z
  .object({
    canonicalUrl: CanonicalUrl,
    sitePageIds: exactSortedUuidArray(2),
    title: NullableTitle,
    inboundCount: Count.max(MAX_INTERNAL_LINK_MAP_NODES),
    outboundCount: Count.max(MAX_INTERNAL_LINK_MAP_NODES),
    status: InternalLinkMapNodeStatus,
    executionRefs: z
      .array(InternalLinkMapExecutionRef)
      .max(20)
      .superRefine((refs, ctx) => {
        const keys = refs.map(
          (ref) => `${ref.findingId}:${ref.actionId ?? ""}`,
        );
        if (!isUnique(keys)) {
          ctx.addIssue({
            code: "custom",
            message: "Execution references must be unique",
          });
        }
        if (!isAsciiSorted(keys)) {
          ctx.addIssue({
            code: "custom",
            message:
              "Execution references must use deterministic ascending order",
          });
        }
      }),
  })
  .strict()
  .superRefine((node, ctx) => {
    if (
      node.status === "connected" &&
      (node.inboundCount === 0 || node.outboundCount === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "A connected page requires observed inbound and outbound links",
      });
    }
    if (
      node.status === "one_way" &&
      ((node.inboundCount === 0) === (node.outboundCount === 0))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "A one-way page requires exactly one observed link direction",
      });
    }
    if (node.status === "orphan" && node.inboundCount !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "An orphan page cannot have an observed inbound link",
      });
    }
    if (
      node.status === "unknown" &&
      (node.inboundCount !== 0 || node.outboundCount !== 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Unknown link state is reserved for pages without observed directions",
      });
    }
  });
export type InternalLinkMapNode = z.infer<
  typeof InternalLinkMapNode
>;

export const InternalLinkMapEdgeFact = z
  .object({
    observationId: Uuid,
    sourceSitePageId: Uuid,
    anchorText: NullableAnchor,
    rel: NullableRel,
  })
  .strict();
export type InternalLinkMapEdgeFact = z.infer<
  typeof InternalLinkMapEdgeFact
>;

function edgeFactKey(fact: InternalLinkMapEdgeFact): string {
  return [
    fact.sourceSitePageId,
    fact.anchorText ?? "",
    fact.rel ?? "",
    fact.observationId,
  ].join("\u0000");
}

export const InternalLinkMapEdge = z
  .object({
    sourceCanonicalUrl: CanonicalUrl,
    targetCanonicalUrl: CanonicalUrl,
    sourceSitePageIds: exactSortedUuidArray(2),
    targetSitePageIds: exactSortedUuidArray(2),
    facts: z
      .array(InternalLinkMapEdgeFact)
      .min(1)
      .max(2),
    reciprocal: z.boolean(),
  })
  .strict()
  .superRefine((edge, ctx) => {
    const factKeys = edge.facts.map(edgeFactKey);
    if (!isUnique(factKeys)) {
      ctx.addIssue({
        code: "custom",
        path: ["facts"],
        message: "Internal link facts must be unique",
      });
    }
    if (!isAsciiSorted(factKeys)) {
      ctx.addIssue({
        code: "custom",
        path: ["facts"],
        message:
          "Internal link facts must use deterministic ascending order",
      });
    }
    edge.facts.forEach((fact, index) => {
      if (!edge.sourceSitePageIds.includes(fact.sourceSitePageId)) {
        ctx.addIssue({
          code: "custom",
          path: ["facts", index, "sourceSitePageId"],
          message:
            "Every edge fact must reference an exact source SitePage variant",
        });
      }
    });
  });
export type InternalLinkMapEdge = z.infer<
  typeof InternalLinkMapEdge
>;

export const InternalLinkRecommendationCoverage = z
  .object({
    availability: z.enum(["available", "partial", "unavailable"]),
    limitations: UniqueLimitations,
  })
  .strict()
  .superRefine((coverage, ctx) => {
    if (
      (coverage.availability === "available") !==
      (coverage.limitations.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitations"],
        message:
          "Only available link recommendations may omit limitations",
      });
    }
  });
export type InternalLinkRecommendationCoverage = z.infer<
  typeof InternalLinkRecommendationCoverage
>;

export const InternalLinkRecommendation = z
  .object({
    sourceCanonicalUrl: CanonicalUrl,
    sourceSitePageIds: exactSortedUuidArray(2),
    targetCanonicalUrl: CanonicalUrl,
    targetSitePageIds: exactSortedUuidArray(2),
    basis: z
      .object({
        kind: z.literal("same_confirmed_topic"),
        topicNodeId: Uuid,
        topicModelRevision: z.number().int().positive(),
        topicLabel: z.string().trim().min(1).max(200),
      })
      .strict(),
    explanation: BoundedText,
  })
  .strict();
export type InternalLinkRecommendation = z.infer<
  typeof InternalLinkRecommendation
>;

export const InternalLinkSelectedPage = z
  .object({
    selectedSitePageId: Uuid,
    canonicalUrl: CanonicalUrl,
    inboundSources: z
      .array(InternalLinkMapEdge)
      .max(MAX_INTERNAL_LINK_MAP_NODES),
    recommendationCoverage: InternalLinkRecommendationCoverage,
    recommendations: z
      .array(InternalLinkRecommendation)
      .max(MAX_INTERNAL_LINK_MAP_RECOMMENDATIONS),
    totalRecommendationCount: Count.max(MAX_INTERNAL_LINK_MAP_NODES),
    recommendationsTruncated: z.boolean(),
  })
  .strict()
  .superRefine((detail, ctx) => {
    const inboundKeys = detail.inboundSources.map(
      (edge) =>
        `${edge.sourceCanonicalUrl}\u0000${edge.targetCanonicalUrl}`,
    );
    if (!isUnique(inboundKeys) || !isAsciiSorted(inboundKeys)) {
      ctx.addIssue({
        code: "custom",
        path: ["inboundSources"],
        message:
          "Inbound sources must be unique and deterministically sorted",
      });
    }
    detail.inboundSources.forEach((edge, index) => {
      if (
        edge.targetCanonicalUrl !== detail.canonicalUrl ||
        !edge.targetSitePageIds.includes(detail.selectedSitePageId)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["inboundSources", index],
          message:
            "Inbound source edges must target the selected canonical page",
        });
      }
    });

    const recommendationKeys = detail.recommendations.map(
      (recommendation) =>
        `${recommendation.sourceCanonicalUrl}\u0000${recommendation.basis.topicNodeId}`,
    );
    if (
      !isUnique(recommendationKeys) ||
      !isAsciiSorted(recommendationKeys)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["recommendations"],
        message:
          "Recommendations must be unique and deterministically sorted",
      });
    }
    detail.recommendations.forEach((recommendation, index) => {
      if (
        recommendation.targetCanonicalUrl !== detail.canonicalUrl ||
        !recommendation.targetSitePageIds.includes(
          detail.selectedSitePageId,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["recommendations", index],
          message:
            "Recommendations must target the selected canonical page",
        });
      }
    });
    if (
      detail.recommendationCoverage.availability === "unavailable" &&
      detail.recommendations.length > 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["recommendations"],
        message:
          "Unavailable recommendation authority cannot return guesses",
      });
    }
    if (
      detail.recommendationsTruncated !==
      (detail.totalRecommendationCount > detail.recommendations.length)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["recommendationsTruncated"],
        message:
          "Recommendation truncation must match the reported total",
      });
    }
  });
export type InternalLinkSelectedPage = z.infer<
  typeof InternalLinkSelectedPage
>;

const InternalLinkMapGraph = z
  .object({
    nodes: z.array(InternalLinkMapNode).max(MAX_INTERNAL_LINK_MAP_NODES),
    edges: z.array(InternalLinkMapEdge).max(MAX_INTERNAL_LINK_MAP_EDGES),
    totalEdgeCount: Count,
    edgesTruncated: z.boolean(),
  })
  .strict();

export const GrowthMapInternalLinkMap = z
  .object({
    projectId: Uuid,
    diagnosticRunId: Uuid.nullable(),
    crawlSnapshot: z
      .object({
        snapshotId: Uuid,
        capturedAt: IsoDateTime,
        availability: z.enum(["available", "partial", "unavailable"]),
        limitation: BoundedText.nullable(),
      })
      .strict()
      .nullable(),
    coverage: InternalLinkMapCoverage,
    graph: InternalLinkMapGraph,
    selectedPage: InternalLinkSelectedPage.nullable(),
    generatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((map, ctx) => {
    const nodeKeys = map.graph.nodes.map((node) => node.canonicalUrl);
    if (!isUnique(nodeKeys) || !isAsciiSorted(nodeKeys)) {
      ctx.addIssue({
        code: "custom",
        path: ["graph", "nodes"],
        message:
          "Internal Link Map nodes must be unique and sorted by canonical URL",
      });
    }
    const nodeByUrl = new Map(
      map.graph.nodes.map((node) => [node.canonicalUrl, node]),
    );
    const pageOwner = new Set<string>();
    map.graph.nodes.forEach((node, nodeIndex) => {
      node.sitePageIds.forEach((sitePageId) => {
        if (pageOwner.has(sitePageId)) {
          ctx.addIssue({
            code: "custom",
            path: ["graph", "nodes", nodeIndex, "sitePageIds"],
            message:
              "One exact SitePage identity cannot belong to two canonical nodes",
          });
        }
        pageOwner.add(sitePageId);
      });
      if (
        map.coverage.crawlCompleteness !== "complete" &&
        node.status === "orphan"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["graph", "nodes", nodeIndex, "status"],
          message:
            "An incomplete crawl cannot support an orphan assertion",
        });
      }
      if (
        map.coverage.crawlCompleteness === "complete" &&
        node.status === "unknown"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["graph", "nodes", nodeIndex, "status"],
          message:
            "A complete crawl must classify every observed page",
        });
      }
    });

    const edgeKeys = map.graph.edges.map(
      (edge) =>
        `${edge.sourceCanonicalUrl}\u0000${edge.targetCanonicalUrl}`,
    );
    if (!isUnique(edgeKeys) || !isAsciiSorted(edgeKeys)) {
      ctx.addIssue({
        code: "custom",
        path: ["graph", "edges"],
        message:
          "Internal Link Map edges must be unique and deterministically sorted",
      });
    }
    const edgeKeySet = new Set(edgeKeys);
    map.graph.edges.forEach((edge, index) => {
      const source = nodeByUrl.get(edge.sourceCanonicalUrl);
      const target = nodeByUrl.get(edge.targetCanonicalUrl);
      if (!source || !target) {
        ctx.addIssue({
          code: "custom",
          path: ["graph", "edges", index],
          message:
            "Every Internal Link Map edge must connect two returned nodes",
        });
        return;
      }
      if (
        JSON.stringify(source.sitePageIds) !==
          JSON.stringify(edge.sourceSitePageIds) ||
        JSON.stringify(target.sitePageIds) !==
          JSON.stringify(edge.targetSitePageIds)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["graph", "edges", index],
          message:
            "Edge SitePage variants must match their canonical nodes",
        });
      }
      if (
        !map.graph.edgesTruncated &&
        edge.reciprocal !==
          edgeKeySet.has(
            `${edge.targetCanonicalUrl}\u0000${edge.sourceCanonicalUrl}`,
          )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["graph", "edges", index, "reciprocal"],
          message:
            "Reciprocity must be derived from the complete returned edge set",
        });
      }
    });

    if (
      map.graph.edgesTruncated !==
      (map.graph.totalEdgeCount > map.graph.edges.length)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["graph", "edgesTruncated"],
        message:
          "Edge truncation must match the reported canonical edge total",
      });
    }
    if (!map.graph.edgesTruncated) {
      for (const [url, node] of nodeByUrl) {
        const inboundCount = map.graph.edges.filter(
          (edge) => edge.targetCanonicalUrl === url,
        ).length;
        const outboundCount = map.graph.edges.filter(
          (edge) => edge.sourceCanonicalUrl === url,
        ).length;
        if (
          node.inboundCount !== inboundCount ||
          node.outboundCount !== outboundCount
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["graph", "nodes"],
            message:
              "Node link counts must match the complete canonical edge set",
          });
          break;
        }
      }
    }

    if (map.coverage.availability === "unavailable") {
      if (
        map.graph.nodes.length > 0 ||
        map.graph.edges.length > 0 ||
        map.graph.totalEdgeCount !== 0 ||
        map.graph.edgesTruncated ||
        map.selectedPage !== null
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["graph"],
          message:
            "An unavailable Internal Link Map cannot expose inferred graph data",
        });
      }
    }
    if (
      (map.diagnosticRunId === null) !==
      (map.crawlSnapshot === null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["crawlSnapshot"],
        message:
          "Diagnostic Run and Crawl Snapshot identities must be present together",
      });
    }
    if (
      map.crawlSnapshot?.availability === "unavailable" &&
      map.coverage.availability !== "unavailable"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["coverage", "availability"],
        message:
          "An unavailable Crawl Snapshot cannot produce a link graph",
      });
    }
    if (
      map.crawlSnapshot?.availability === "partial" &&
      map.coverage.availability !== "partial"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["coverage", "availability"],
        message:
          "A partial Crawl Snapshot must keep the link graph partial",
      });
    }
    if (
      map.crawlSnapshot !== null &&
      map.crawlSnapshot.availability !== "available" &&
      map.crawlSnapshot.limitation === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["crawlSnapshot", "limitation"],
        message:
          "A degraded Crawl Snapshot requires its source limitation",
      });
    }

    if (map.selectedPage !== null) {
      const selectedNode = nodeByUrl.get(map.selectedPage.canonicalUrl);
      if (
        !selectedNode ||
        !selectedNode.sitePageIds.includes(
          map.selectedPage.selectedSitePageId,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["selectedPage"],
          message:
            "Selected page detail must belong to one returned canonical node",
        });
      }
    }
  });
export type GrowthMapInternalLinkMap = z.infer<
  typeof GrowthMapInternalLinkMap
>;
