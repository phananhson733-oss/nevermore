import { z } from "zod";
import { GrowthMapCompetitorRelationship } from "./growth-map.ts";
import { ProductProfileCompetitorAnalysisScope } from "./product-profile.ts";

const CanonicalInstant = z.iso.datetime({ offset: true });
const Limitation = z.string().trim().min(1).max(2_000);

export const CompetitorMonitorFrequency = z.literal("monthly");
export type CompetitorMonitorFrequency = z.infer<
  typeof CompetitorMonitorFrequency
>;

export const UpdateCompetitorMonitorRequest = z
  .object({
    expectedRevision: z.number().int().min(0).max(2_147_483_646),
    enabled: z.boolean(),
    frequency: CompetitorMonitorFrequency,
  })
  .strict();
export type UpdateCompetitorMonitorRequest = z.infer<
  typeof UpdateCompetitorMonitorRequest
>;

export const CompetitorMonitorConfig = z
  .object({
    enabled: z.boolean(),
    frequency: CompetitorMonitorFrequency,
    revision: z.number().int().min(0).max(2_147_483_647),
    updatedAt: CanonicalInstant,
  })
  .strict();
export type CompetitorMonitorConfig = z.infer<
  typeof CompetitorMonitorConfig
>;

export const CompetitorMonitorScope = z
  .object({
    market: z.string().regex(/^[A-Z]{2}$/u),
    languageTag: z.string().trim().min(1).max(255),
    topicModelRevision: z.number().int().positive(),
  })
  .strict();
export type CompetitorMonitorScope = z.infer<
  typeof CompetitorMonitorScope
>;

const OpportunityUpdate = z
  .object({
    state: z.literal("ready"),
    growthMapSection: z.literal("competitor_library"),
    sourceRef: z.string().regex(
      /^competitor_monitor_signal:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    ),
  })
  .strict();

const SignalCommon = z.object({
  signalId: z.uuid(),
  competitorId: z.uuid(),
  detectedAt: CanonicalInstant,
  currentSnapshotId: z.uuid(),
  previousSnapshotId: z.uuid(),
  topicNodeId: z.uuid(),
  topicLabel: z.string().trim().min(1).max(160),
  limitation: Limitation.nullable(),
  opportunityUpdate: OpportunityUpdate,
});

export const CompetitorMonitorRankGainSignal = SignalCommon.extend({
  kind: z.literal("rank_gain"),
  keywordId: z.uuid(),
  keyword: z.string().trim().min(1).max(500),
  previousRank: z.number().positive().finite(),
  currentRank: z.number().positive().finite(),
  improvement: z.number().finite().gt(5),
})
  .strict()
  .superRefine((value, context) => {
    const exact = value.previousRank - value.currentRank;
    if (Math.abs(exact - value.improvement) > Number.EPSILON * 16) {
      context.addIssue({
        code: "custom",
        path: ["improvement"],
        message: "improvement must equal previousRank - currentRank",
      });
    }
  });

export const CompetitorMonitorNewContentSignal = SignalCommon.extend({
  kind: z.literal("new_content_overlap"),
  url: z.url().max(2_048),
  matchedKeywordIds: z.array(z.uuid()).min(2).max(500),
  overlapRatio: z.number().finite().min(0.5).max(1),
  publicationEvidence: z.literal("first_observed_in_ranked_keywords"),
  limitation: Limitation,
})
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.matchedKeywordIds).size !== value.matchedKeywordIds.length) {
      context.addIssue({
        code: "custom",
        path: ["matchedKeywordIds"],
        message: "matchedKeywordIds must be unique",
      });
    }
  });

export const CompetitorMonitorSignal = z.discriminatedUnion("kind", [
  CompetitorMonitorRankGainSignal,
  CompetitorMonitorNewContentSignal,
]);
export type CompetitorMonitorSignal = z.infer<
  typeof CompetitorMonitorSignal
>;

export const CompetitorMonitorItem = z
  .object({
    competitorId: z.uuid(),
    domain: z.string().trim().min(1).max(253),
    name: z.string().trim().min(1).max(160).nullable(),
    relationship: GrowthMapCompetitorRelationship,
    analysisScopes: z
      .array(ProductProfileCompetitorAnalysisScope)
      .min(1)
      .max(5),
    eligibility: z.enum(["eligible", "ineligible", "unavailable"]),
    collectionState: z.enum([
      "never_collected",
      "collecting",
      "collected",
      "unavailable",
    ]),
    evaluationState: z.enum([
      "pending",
      "baseline",
      "available",
      "unavailable",
    ]),
    lastCollectionAt: CanonicalInstant.nullable(),
    nextCollectionAt: CanonicalInstant.nullable(),
    limitation: Limitation.nullable(),
    recentSignals: z.array(CompetitorMonitorSignal).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.evaluationState !== "available" &&
      value.recentSignals.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["recentSignals"],
        message: "only an available comparison may expose signals",
      });
    }
    if (new Set(value.analysisScopes).size !== value.analysisScopes.length) {
      context.addIssue({
        code: "custom",
        path: ["analysisScopes"],
        message: "analysisScopes must be unique",
      });
    }
    if (
      (value.eligibility !== "eligible" ||
        value.collectionState === "unavailable" ||
        value.evaluationState === "baseline" ||
        value.evaluationState === "unavailable") &&
      value.limitation === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["limitation"],
        message: "non-actionable monitor state requires a limitation",
      });
    }
  });
export type CompetitorMonitorItem = z.infer<
  typeof CompetitorMonitorItem
>;

export const CompetitorMonitorResponse = z
  .object({
    projectId: z.uuid(),
    config: CompetitorMonitorConfig.nullable(),
    scope: CompetitorMonitorScope.nullable(),
    availability: z.enum(["available", "unavailable"]),
    limitation: Limitation.nullable(),
    competitors: z.array(CompetitorMonitorItem).max(500),
    generatedAt: CanonicalInstant,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.availability === "unavailable") {
      if (value.scope !== null || value.limitation === null) {
        context.addIssue({
          code: "custom",
          path: ["availability"],
          message:
            "unavailable monitor response requires null scope and a limitation",
        });
      }
    } else if (value.scope === null || value.limitation !== null) {
      context.addIssue({
        code: "custom",
        path: ["availability"],
        message:
          "available monitor response requires a complete scope and no project limitation",
      });
    }
  });
export type CompetitorMonitorResponse = z.infer<
  typeof CompetitorMonitorResponse
>;
