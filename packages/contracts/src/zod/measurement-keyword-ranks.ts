import { z } from "zod";
import {
  GrowthMapCoverage,
  GrowthMapLibraryLanguageTag,
} from "./growth-map.ts";
import {
  IsoDateTime,
  MarketCode,
  Uuid,
} from "./common.ts";
import {
  MeasurementWindowInterval,
} from "./measurement.ts";
import { PublicationHttpUrl } from "./delivery-connections.ts";

const BoundedText = z.string().trim().min(1).max(2_000);
const KeywordText = z.string().trim().min(1).max(500);
const PositiveRevision = z
  .number()
  .int()
  .positive()
  .max(2_147_483_647);

export const MeasurementKeywordRankState = z.enum([
  "observed",
  "insufficient_data",
  "unavailable",
]);
export type MeasurementKeywordRankState = z.infer<
  typeof MeasurementKeywordRankState
>;

export const MeasurementKeywordRankTrend = z.enum([
  "improved",
  "regressed",
  "unchanged",
  "unavailable",
]);
export type MeasurementKeywordRankTrend = z.infer<
  typeof MeasurementKeywordRankTrend
>;

/**
 * Target rank comparison deliberately has a narrower static and runtime type
 * than the Growth Map history point: GSC average position can never be passed
 * through this boundary and mistaken for an absolute SERP rank.
 */
export const MeasurementDataForSeoAbsoluteRankPoint = z
  .object({
    occurrenceId: Uuid,
    snapshotId: Uuid,
    observationId: Uuid,
    provider: z.literal("dataforseo"),
    metric: z.literal("absolute_rank"),
    value: z.number().finite().positive(),
    valuePointer: z.literal("/valueJson/currentRank"),
    observedAt: IsoDateTime,
    providerDataAsOf: z.null(),
    grade: z.literal("B"),
    limitation: BoundedText,
  })
  .strict();
export type MeasurementDataForSeoAbsoluteRankPoint = z.infer<
  typeof MeasurementDataForSeoAbsoluteRankPoint
>;

export const MeasurementTargetKeywordRank = z
  .object({
    keywordId: Uuid,
    displayKeyword: KeywordText,
    normalizedKeyword: KeywordText,
    marketCode: MarketCode,
    languageTag: GrowthMapLibraryLanguageTag,
    topicNodeId: Uuid,
    topicLabel: z.string().trim().min(1).max(200),
    topicModelRevision: PositiveRevision,
    state: MeasurementKeywordRankState,
    baselineObservation:
      MeasurementDataForSeoAbsoluteRankPoint.nullable(),
    outcomeObservation:
      MeasurementDataForSeoAbsoluteRankPoint.nullable(),
    /**
     * Positive means the absolute rank improved. For example, 12 -> 7 is +5.
     * This direction is deliberately different from a raw outcome-baseline
     * subtraction so clients do not need to guess whether a lower rank is
     * better.
     */
    rankImprovement: z.number().finite().nullable(),
    trend: MeasurementKeywordRankTrend,
    limitation: BoundedText.nullable(),
  })
  .strict()
  .superRefine((rank, ctx) => {
    const hasBaseline = rank.baselineObservation !== null;
    const hasOutcome = rank.outcomeObservation !== null;
    const expectedState =
      hasBaseline && hasOutcome
        ? "observed"
        : hasBaseline || hasOutcome
          ? "insufficient_data"
          : "unavailable";
    if (rank.state !== expectedState) {
      ctx.addIssue({
        code: "custom",
        path: ["state"],
        message:
          "Target Keyword rank state must reflect its actual baseline and outcome evidence",
      });
    }

    if (!hasBaseline || !hasOutcome) {
      if (
        rank.rankImprovement !== null ||
        rank.trend !== "unavailable" ||
        rank.limitation === null
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["rankImprovement"],
          message:
            "Incomplete rank evidence requires an unavailable trend, null change, and explicit limitation",
        });
      }
      return;
    }

    const improvement =
      rank.baselineObservation!.value -
      rank.outcomeObservation!.value;
    const expectedTrend =
      improvement > 0
        ? "improved"
        : improvement < 0
          ? "regressed"
          : "unchanged";
    if (
      rank.rankImprovement !== improvement ||
      rank.trend !== expectedTrend
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["rankImprovement"],
        message:
          "Rank change must be derived from the two immutable absolute-rank observations",
      });
    }
  });
export type MeasurementTargetKeywordRank = z.infer<
  typeof MeasurementTargetKeywordRank
>;

export const MeasurementTargetKeywordRanks = z
  .object({
    projectId: Uuid,
    measurementWindowId: Uuid,
    sitePageId: Uuid,
    canonicalUrl: PublicationHttpUrl,
    beforeWindow: MeasurementWindowInterval,
    afterWindow: MeasurementWindowInterval,
    interpretation: z.literal(
      "dataforseo_absolute_rank_observational_non_causal",
    ),
    keywords: z.array(MeasurementTargetKeywordRank).max(200),
    coverage: GrowthMapCoverage,
    generatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((result, ctx) => {
    const beforeStart = Date.parse(result.beforeWindow.startAt);
    const beforeEnd = Date.parse(result.beforeWindow.endAt);
    const afterStart = Date.parse(result.afterWindow.startAt);
    const afterEnd = Date.parse(result.afterWindow.endAt);

    if (beforeEnd > afterStart) {
      ctx.addIssue({
        code: "custom",
        path: ["afterWindow", "startAt"],
        message:
          "Target Keyword comparison windows cannot overlap",
      });
    }

    const identities = new Set<string>();
    let previousKey: string | null = null;
    result.keywords.forEach((keyword, index) => {
      if (identities.has(keyword.keywordId)) {
        ctx.addIssue({
          code: "custom",
          path: ["keywords", index, "keywordId"],
          message:
            "Target Keywords must have unique canonical identities",
        });
      }
      identities.add(keyword.keywordId);

      const orderKey = `${keyword.normalizedKeyword}\u0000${keyword.keywordId}`;
      if (previousKey !== null && previousKey >= orderKey) {
        ctx.addIssue({
          code: "custom",
          path: ["keywords", index],
          message:
            "Target Keywords must use stable normalized-keyword order",
        });
      }
      previousKey = orderKey;

      const baselineAt =
        keyword.baselineObservation === null
          ? null
          : Date.parse(keyword.baselineObservation.observedAt);
      const outcomeAt =
        keyword.outcomeObservation === null
          ? null
          : Date.parse(keyword.outcomeObservation.observedAt);
      if (
        baselineAt !== null &&
        (baselineAt < beforeStart || baselineAt >= beforeEnd)
      ) {
        ctx.addIssue({
          code: "custom",
          path: [
            "keywords",
            index,
            "baselineObservation",
            "observedAt",
          ],
          message:
            "Baseline rank evidence must be inside the half-open baseline window",
        });
      }
      if (
        outcomeAt !== null &&
        (outcomeAt < afterStart || outcomeAt >= afterEnd)
      ) {
        ctx.addIssue({
          code: "custom",
          path: [
            "keywords",
            index,
            "outcomeObservation",
            "observedAt",
          ],
          message:
            "Outcome rank evidence must be inside the half-open outcome window",
        });
      }
    });

    const observed = result.keywords.filter(
      (keyword) => keyword.state === "observed",
    ).length;
    const expectedAvailability =
      result.keywords.length === 0 || observed === 0
        ? "unavailable"
        : observed === result.keywords.length
          ? "available"
          : "partial";
    if (result.coverage.availability !== expectedAvailability) {
      ctx.addIssue({
        code: "custom",
        path: ["coverage", "availability"],
        message:
          "Target Keyword coverage must reflect complete two-window comparisons",
      });
    }
    if (Date.parse(result.generatedAt) < afterEnd) {
      ctx.addIssue({
        code: "custom",
        path: ["generatedAt"],
        message:
          "Target Keyword measurement cannot be generated before the outcome window ends",
      });
    }
  });
export type MeasurementTargetKeywordRanks = z.infer<
  typeof MeasurementTargetKeywordRanks
>;
