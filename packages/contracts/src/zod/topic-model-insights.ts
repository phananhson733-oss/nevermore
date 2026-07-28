import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";
import { MAX_POSTGRES_INTEGER_REVISION } from "./keyword-governance.ts";

const Count = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_POSTGRES_INTEGER_REVISION);
const PositiveRevision = z
  .number()
  .int()
  .positive()
  .max(MAX_POSTGRES_INTEGER_REVISION);
const Limitation = z.string().trim().min(1).max(2000);

export const GrowthMapTopicNodeCoverageState = z.enum([
  "empty",
  "uncovered",
  "partial",
  "covered",
  "conflict",
]);
export type GrowthMapTopicNodeCoverageState = z.infer<
  typeof GrowthMapTopicNodeCoverageState
>;

export const GrowthMapTopicNodeInsight = z
  .object({
    projectId: Uuid,
    topicNodeId: Uuid,
    topicModelRevision: PositiveRevision,
    label: z.string().trim().min(1).max(200),
    keywordCount: Count,
    approvedKeywordCount: Count,
    reviewPendingKeywordCount: Count,
    existingPageKeywordCount: Count,
    newAssetKeywordCount: Count,
    unassignedKeywordCount: Count,
    mappedPageCount: Count,
    conflictingIntentCount: Count,
    coverageState: GrowthMapTopicNodeCoverageState,
    limitation: Limitation.nullable(),
  })
  .strict()
  .superRefine((node, ctx) => {
    if (
      node.existingPageKeywordCount +
        node.newAssetKeywordCount +
        node.unassignedKeywordCount !==
      node.keywordCount
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["keywordCount"],
        message:
          "Mapping-decision counts must partition the Topic keyword count",
      });
    }
    for (const field of [
      "approvedKeywordCount",
      "reviewPendingKeywordCount",
      "existingPageKeywordCount",
      "newAssetKeywordCount",
      "unassignedKeywordCount",
      "conflictingIntentCount",
    ] as const) {
      if (node[field] > node.keywordCount) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} cannot exceed keywordCount`,
        });
      }
    }
    if (node.mappedPageCount > node.existingPageKeywordCount) {
      ctx.addIssue({
        code: "custom",
        path: ["mappedPageCount"],
        message:
          "Distinct mapped pages cannot exceed existing-page Keywords",
      });
    }
    if (
      node.conflictingIntentCount > 0 &&
      (node.existingPageKeywordCount < 2 || node.mappedPageCount < 2)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["conflictingIntentCount"],
        message:
          "An intent conflict requires at least two existing-page Keywords and pages",
      });
    }

    const expectedState: GrowthMapTopicNodeCoverageState =
      node.conflictingIntentCount > 0
        ? "conflict"
        : node.keywordCount === 0
          ? "empty"
          : node.existingPageKeywordCount === 0
            ? "uncovered"
            : node.reviewPendingKeywordCount > 0 ||
                node.existingPageKeywordCount < node.keywordCount
              ? "partial"
              : "covered";
    if (node.coverageState !== expectedState) {
      ctx.addIssue({
        code: "custom",
        path: ["coverageState"],
        message:
          "Topic coverage state must be derived from current governed Keyword facts",
      });
    }
    if (
      (node.coverageState === "covered") !==
      (node.limitation === null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message:
          "Only fully covered Topics omit a customer-visible limitation",
      });
    }
  });
export type GrowthMapTopicNodeInsight = z.infer<
  typeof GrowthMapTopicNodeInsight
>;

export const GrowthMapTopicInsightsCoverage = z
  .object({
    availability: z.enum(["available", "partial", "unavailable"]),
    limitations: z
      .array(Limitation)
      .max(20)
      .refine(
        (values) => new Set(values).size === values.length,
        "Coverage limitations must be unique",
      ),
  })
  .strict()
  .superRefine((coverage, ctx) => {
    if (
      coverage.availability !== "available" &&
      coverage.limitations.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitations"],
        message:
          "Partial and unavailable Topic insight coverage requires a limitation",
      });
    }
  });
export type GrowthMapTopicInsightsCoverage = z.infer<
  typeof GrowthMapTopicInsightsCoverage
>;

export const GrowthMapTopicModelInsights = z
  .object({
    projectId: Uuid,
    topicModelRevision: PositiveRevision.nullable(),
    nodes: z.array(GrowthMapTopicNodeInsight).max(500),
    coverage: GrowthMapTopicInsightsCoverage,
    generatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((insights, ctx) => {
    if (insights.topicModelRevision === null) {
      if (insights.nodes.length !== 0) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes"],
          message:
            "Nodes cannot be projected without a confirmed Topic Model",
        });
      }
      if (insights.coverage.availability !== "unavailable") {
        ctx.addIssue({
          code: "custom",
          path: ["coverage", "availability"],
          message:
            "Missing confirmed Topic authority must be unavailable",
        });
      }
      return;
    }

    if (insights.nodes.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message:
          "A confirmed Topic Model must expose at least one active node",
      });
    }
    if (insights.coverage.availability === "unavailable") {
      ctx.addIssue({
        code: "custom",
        path: ["coverage", "availability"],
        message:
          "Confirmed Topic insight authority cannot be reported as unavailable",
      });
    }

    const nodeIds = new Set<string>();
    insights.nodes.forEach((node, index) => {
      if (node.projectId !== insights.projectId) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "projectId"],
          message: "Topic Node project scope must match the response",
        });
      }
      if (node.topicModelRevision !== insights.topicModelRevision) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "topicModelRevision"],
          message:
            "Every Topic insight must use the latest confirmed model revision",
        });
      }
      if (nodeIds.has(node.topicNodeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "topicNodeId"],
          message:
            "Stable Topic Node identities must be unique in one insight response",
        });
      }
      nodeIds.add(node.topicNodeId);
    });
  });
export type GrowthMapTopicModelInsights = z.infer<
  typeof GrowthMapTopicModelInsights
>;
