import { describe, expect, it } from "vitest";
import { CONTEXTUAL_ALL_RULES } from "../../../engine/src/rules/index.ts";
import {
  CandidateOpportunity,
  ConfirmedOpportunity,
  GrowthOpportunity,
  OpportunityRuleId,
  OpportunityRuleReference,
  PrimaryOpportunityTarget,
  ReviewableOpportunity,
  RULE_OPPORTUNITY_PROJECTION,
  resolveRuleOpportunityWorkShape,
  WorkShape,
} from "./opportunities.ts";
import { ExecutionPreview } from "./execution-preview.ts";

const findingId = "30000000-0000-4000-8000-000000000001";
const supportingFindingId = "30000000-0000-4000-8000-000000000002";
const actionId = "30000000-0000-4000-8000-000000000003";

const contentBriefPreview = {
  templateId: "improve_content_coverage.v1",
  templateVersion: 1,
  artifactType: "content_brief",
  effort: "medium",
  risk: "low",
  contentLocale: "zh-CN",
  title: "完善内容覆盖",
  description: "补充缺失的主题和答案结构。",
  expectedOutcome: "验证目标：页面更完整地满足目标搜索意图。",
} as const;

const baseOpportunity = {
  opportunityKey: "url:/customer-onboarding/:CONTENT-COVERAGE-001",
  title: "Make the onboarding page a citation-ready answer asset",
  workShape: "improve",
  primaryTarget: "url",
  targetRef: "https://example.com/customer-onboarding/",
  evidenceSummary: [
    {
      traceKind: "evidence",
      evidenceId: "30000000-0000-4000-8000-000000000011",
      diagnosticRunId: "30000000-0000-4000-8000-000000000012",
      snapshotId: "30000000-0000-4000-8000-000000000013",
      collectionRunId: "30000000-0000-4000-8000-000000000015",
      sourceProvider: "crawl",
      availability: "available",
      support: "supports",
      observedAt: "2026-07-21T08:00:00Z",
      freshness: "current",
      claim: "The owned page lacks a concise answer block.",
      limitation: "Single immutable crawl snapshot.",
    },
  ],
  searchQueries: [],
  generativeQueries: [],
  competitorRefs: [],
  currentOwnedAsset: {
    sitePageId: "30000000-0000-4000-8000-000000000014",
    snapshotId: "30000000-0000-4000-8000-000000000013",
    url: "https://example.com/customer-onboarding/",
    suitableForIntent: true,
  },
  supportingFindingIds: [],
  lenses: ["demand_competition", "search_ai_visibility"],
  coverageAndLimitations: [
    "Generative visibility is based on an eight-answer sample.",
  ],
} as const;

describe("Growth Opportunity projection contracts", () => {
  it("accepts only the three approved work shapes and five target types", () => {
    expect(WorkShape.options).toEqual(["fix", "improve", "create"]);
    expect(WorkShape.safeParse("expand").success).toBe(false);
    expect(PrimaryOpportunityTarget.options).toEqual([
      "site",
      "template",
      "url",
      "topic",
      "new_asset",
    ]);
    expect(PrimaryOpportunityTarget.safeParse("keyword").success).toBe(false);
  });

  it("keeps candidates observation-backed and non-confirmable", () => {
    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
      }).success,
    ).toBe(true);
    expect(() =>
      CandidateOpportunity.parse({
        ...baseOpportunity,
        readiness: "candidate",
        primaryFindingId: findingId,
      }),
    ).toThrow();
    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
        executionPreview: null,
      }).success,
    ).toBe(false);
    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
        executionPreview: undefined,
      }).success,
    ).toBe(false);

    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        evidenceSummary: [],
        readiness: "candidate",
      }).success,
    ).toBe(false);

    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
        evidenceSummary: baseOpportunity.evidenceSummary.map((trace) => ({
          ...trace,
          snapshotId: null,
          analysisInvocationId: null,
        })),
      }).success,
    ).toBe(false);
  });

  it("keeps preview template versions aligned with the ActionTemplate registry", () => {
    expect(ExecutionPreview.safeParse(contentBriefPreview).success).toBe(true);
    expect(
      ExecutionPreview.safeParse({
        ...contentBriefPreview,
        templateVersion: 3,
      }).success,
    ).toBe(false);
  });

  it("requires exactly one primary Finding for a reviewable Opportunity", () => {
    expect(() =>
      ReviewableOpportunity.parse({
        ...baseOpportunity,
        readiness: "reviewable",
        primaryFindingSeverity: "high",
        primaryFindingReviewRevision: 0,
        primaryFindingId: undefined,
        executionPreview: null,
      }),
    ).toThrow();

    expect(
      GrowthOpportunity.parse({
        ...baseOpportunity,
        readiness: "reviewable",
        primaryFindingSeverity: "high",
        primaryFindingReviewRevision: 0,
        primaryFindingId: findingId,
        primaryRule: {
          ruleId: "CONTENT-COVERAGE-001",
          ruleVersion: 1,
        },
        supportingFindingIds: [supportingFindingId],
        actionId: undefined,
        executionPreview: contentBriefPreview,
      }),
    ).toBeTruthy();

    expect(
      ReviewableOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "reviewable",
        primaryFindingSeverity: "high",
        primaryFindingReviewRevision: 0,
        primaryFindingId: findingId,
        primaryRule: {
          ruleId: "CONTENT-COVERAGE-001",
          ruleVersion: 1,
        },
        supportingFindingIds: [findingId],
        executionPreview: null,
      }).success,
    ).toBe(false);
    expect(
      ReviewableOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "reviewable",
        primaryFindingSeverity: "high",
        primaryFindingReviewRevision: 0,
        primaryFindingId: findingId,
        primaryRule: {
          ruleId: "CONTENT-COVERAGE-001",
          ruleVersion: 1,
        },
        currentOwnedAsset: {
          ...baseOpportunity.currentOwnedAsset,
          suitableForIntent: false,
        },
        workShape: "create",
        executionPreview: null,
      }).success,
    ).toBe(true);
  });

  it("binds reviewable work shape and lens to the frozen primary Rule", () => {
    expect(
      ReviewableOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "reviewable",
        primaryFindingSeverity: "high",
        primaryFindingReviewRevision: 0,
        primaryFindingId: findingId,
        primaryRule: { ruleId: "TECH-FOO-999", ruleVersion: 1 },
        executionPreview: null,
      }).success,
    ).toBe(false);
    expect(
      ReviewableOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "reviewable",
        primaryFindingSeverity: "high",
        primaryFindingReviewRevision: 0,
        primaryFindingId: findingId,
        primaryRule: { ruleId: "GEO-CRAWLER-002", ruleVersion: 1 },
        workShape: "create",
        executionPreview: null,
      }).success,
    ).toBe(false);
    expect(
      ReviewableOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "reviewable",
        primaryFindingSeverity: "high",
        primaryFindingReviewRevision: 0,
        primaryFindingId: findingId,
        primaryRule: {
          ruleId: "CONTENT-COVERAGE-001",
          ruleVersion: 1,
        },
        lenses: ["site_health"],
        executionPreview: null,
      }).success,
    ).toBe(false);
  });

  it("pins exact-variant technical rules to v2 and unchanged rules to v1", () => {
    expect(
      OpportunityRuleReference.safeParse({
        ruleId: "TECH-HTTP-001",
        ruleVersion: 2,
      }).success,
    ).toBe(true);
    expect(
      OpportunityRuleReference.safeParse({
        ruleId: "TECH-HTTP-001",
        ruleVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      OpportunityRuleReference.safeParse({
        ruleId: "CONTENT-COVERAGE-001",
        ruleVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      OpportunityRuleReference.safeParse({
        ruleId: "CONTENT-COVERAGE-001",
        ruleVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      OpportunityRuleReference.safeParse({
        ruleId: "TECH-INDEXABILITY-006",
        ruleVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      OpportunityRuleReference.safeParse({
        ruleId: "TECH-INDEXABILITY-006",
        ruleVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("requires a confirmed Action to belong to the primary Finding", () => {
    const confirmed = {
      ...baseOpportunity,
      readiness: "confirmed",
        primaryFindingSeverity: "high",
      primaryFindingId: findingId,
      primaryRule: {
        ruleId: "CONTENT-COVERAGE-001",
        ruleVersion: 1,
      },
      actionId,
      action: {
        actionId,
        findingId,
        status: "planned",
        artifactType: "content_brief",
      },
      executionPreview: contentBriefPreview,
    } as const;

    expect(ConfirmedOpportunity.safeParse(confirmed).success).toBe(true);
    expect(
      ConfirmedOpportunity.safeParse({
        ...confirmed,
        actionId: undefined,
      }).success,
    ).toBe(false);
    expect(
      ConfirmedOpportunity.safeParse({
        ...confirmed,
        action: { ...confirmed.action, findingId: supportingFindingId },
      }).success,
    ).toBe(false);
    expect(
      ConfirmedOpportunity.safeParse({
        ...confirmed,
        action: {
          ...confirmed.action,
          actionId: "30000000-0000-4000-8000-000000000004",
        },
      }).success,
    ).toBe(false);
    expect(
      ConfirmedOpportunity.safeParse({
        ...confirmed,
        action: {
          ...confirmed.action,
          artifactType: "technical_ticket",
        },
      }).success,
    ).toBe(false);
  });

  it("carries exactly one fixed Artifact type in an Action summary", () => {
    expect(
      ConfirmedOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "confirmed",
        primaryFindingSeverity: "high",
        primaryFindingId: findingId,
        primaryRule: {
          ruleId: "CONTENT-COVERAGE-001",
          ruleVersion: 1,
        },
        actionId,
        action: {
          actionId,
          findingId,
          status: "planned",
          artifactType: "content_brief",
        },
        executionPreview: null,
      }).success,
    ).toBe(true);
    expect(
      ConfirmedOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "confirmed",
        primaryFindingSeverity: "high",
        primaryFindingId: findingId,
        primaryRule: {
          ruleId: "CONTENT-COVERAGE-001",
          ruleVersion: 1,
        },
        actionId,
        action: {
          actionId,
          findingId,
          status: "planned",
          artifactType: ["content_brief", "metadata_rewrite"],
        },
        executionPreview: null,
      }).success,
    ).toBe(false);
  });

  it("requires a nullable preview key for reviewable and confirmed Opportunities", () => {
    const reviewable = {
      ...baseOpportunity,
      readiness: "reviewable",
        primaryFindingSeverity: "high",
        primaryFindingReviewRevision: 0,
      primaryFindingId: findingId,
      primaryRule: {
        ruleId: "CONTENT-COVERAGE-001",
        ruleVersion: 1,
      },
    } as const;

    expect(ReviewableOpportunity.safeParse(reviewable).success).toBe(false);
    expect(
      ReviewableOpportunity.safeParse({
        ...reviewable,
        executionPreview: null,
      }).success,
    ).toBe(true);
    expect(
      ReviewableOpportunity.safeParse({
        ...reviewable,
        executionPreview: contentBriefPreview,
      }).success,
    ).toBe(true);

    expect(
      ConfirmedOpportunity.safeParse({
        ...reviewable,
        readiness: "confirmed",
        primaryFindingSeverity: "high",
        actionId,
        action: {
          actionId,
          findingId,
          status: "planned",
          artifactType: "content_brief",
        },
      }).success,
    ).toBe(false);
  });

  it("keeps previews presentational, strict, and fixed to the primary Rule Artifact type", () => {
    const reviewable = {
      ...baseOpportunity,
      readiness: "reviewable",
        primaryFindingSeverity: "high",
        primaryFindingReviewRevision: 0,
      primaryFindingId: findingId,
      primaryRule: {
        ruleId: "CONTENT-COVERAGE-001",
        ruleVersion: 1,
      },
    } as const;

    expect(ExecutionPreview.parse(contentBriefPreview)).toEqual(
      contentBriefPreview,
    );
    expect(
      ReviewableOpportunity.safeParse({
        ...reviewable,
        executionPreview: {
          ...contentBriefPreview,
          artifactType: "technical_ticket",
        },
      }).success,
    ).toBe(false);

    for (const forbidden of [
      "actionId",
      "status",
      "revision",
      "baseRevision",
      "queued",
      "artifactId",
      "measurementId",
    ] as const) {
      expect(
        ExecutionPreview.safeParse({
          ...contentBriefPreview,
          [forbidden]: forbidden === "queued" ? true : "not-presentational",
        }).success,
      ).toBe(false);
    }
  });

  it("requires a canonical evidence or observation trace with supporting provenance", () => {
    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
        evidenceSummary: [
          {
            traceKind: "observation",
            observationId: "30000000-0000-4000-8000-000000000021",
            snapshotId: "30000000-0000-4000-8000-000000000022",
            sourceProvider: "dataforseo",
            availability: "partial",
            support: "supports",
            observedAt: "2026-07-21T08:00:00Z",
            freshness: "stale",
            claim: "Observed demand exists for the target topic.",
            limitation: "Vendor estimate from the frozen snapshot.",
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
        evidenceSummary: baseOpportunity.evidenceSummary.map((trace) => ({
          ...trace,
          support: "context",
        })),
      }).success,
    ).toBe(false);
  });

  it("preserves the mutually exclusive collection, system, and LLM Evidence lineage shapes", () => {
    const sourceBacked = CandidateOpportunity.parse({
      ...baseOpportunity,
      readiness: "candidate",
    });
    expect(sourceBacked.evidenceSummary[0]).toMatchObject({
      snapshotId: "30000000-0000-4000-8000-000000000013",
      collectionRunId: "30000000-0000-4000-8000-000000000015",
      analysisInvocationId: null,
    });

    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
        evidenceSummary: baseOpportunity.evidenceSummary.map((trace) => ({
          ...trace,
          collectionRunId: null,
        })),
      }).success,
    ).toBe(false);

    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
        evidenceSummary: baseOpportunity.evidenceSummary.map((trace) => ({
          ...trace,
          sourceProvider: "system",
          snapshotId: null,
          collectionRunId: null,
          analysisInvocationId: null,
        })),
      }).success,
    ).toBe(true);

    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
        evidenceSummary: baseOpportunity.evidenceSummary.map((trace) => ({
          ...trace,
          sourceProvider: "llm",
          snapshotId: null,
          collectionRunId: null,
          analysisInvocationId: "30000000-0000-4000-8000-000000000016",
        })),
      }).success,
    ).toBe(true);
    expect(
      CandidateOpportunity.safeParse({
        ...baseOpportunity,
        readiness: "candidate",
        evidenceSummary: baseOpportunity.evidenceSummary.map((trace) => ({
          ...trace,
          sourceProvider: "llm",
          snapshotId: null,
          collectionRunId: "30000000-0000-4000-8000-000000000015",
          analysisInvocationId: "30000000-0000-4000-8000-000000000016",
        })),
      }).success,
    ).toBe(false);
  });

  it("maps every contextual executor rule exactly once", () => {
    expect(OpportunityRuleId.options).toEqual(
      CONTEXTUAL_ALL_RULES.map((rule) => rule.id),
    );
    expect(Object.keys(RULE_OPPORTUNITY_PROJECTION)).toEqual(
      CONTEXTUAL_ALL_RULES.map((rule) => rule.id),
    );
  });

  it("uses an existing-page-first policy for both content coverage rules", () => {
    for (const ruleId of [
      "CONTENT-COVERAGE-001",
      "CONTENT-GAP-011",
    ] as const) {
      expect(RULE_OPPORTUNITY_PROJECTION[ruleId].workShapePolicy).toBe(
        "existing_page_first",
      );
      expect(
        resolveRuleOpportunityWorkShape(ruleId, {
          hasSuitableOwnedAsset: true,
        }),
      ).toBe("improve");
      expect(
        resolveRuleOpportunityWorkShape(ruleId, {
          hasSuitableOwnedAsset: false,
        }),
      ).toBe("create");
    }
  });
});
