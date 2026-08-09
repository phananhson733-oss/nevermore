import { z } from "zod";
import { Bcp47Locale } from "@sf/contracts";
import {
  DATAFORSEO_AI_CITATION_MAX_OUTPUT_TOKENS,
  MAX_DATAFORSEO_SOURCE_VERIFICATIONS,
} from "@sf/sources";

const ContentHash = z.string().regex(/^[a-f0-9]{64}$/u);
const NormalizedDomain = z
  .string()
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u,
  );
const AiCitationQuery = z
  .object({
    entityId: z.uuid(),
    revision: z.number().int().positive(),
    query: z.string().min(1).max(500),
    normalizedQuery: z.string().min(1).max(500),
    marketCode: z.string().regex(/^[A-Z]{2}$/u),
    languageTag: Bcp47Locale,
  })
  .strict();
const AiCitationPolicy = z.discriminatedUnion("state", [
  z.object({ state: z.literal("disabled") }).strict(),
  z
    .object({
      state: z.literal("skipped_insufficient_query_cohort"),
      eligibleQueryCount: z.number().int().min(0).max(21),
    })
    .strict(),
  z
    .object({
      state: z.literal("enabled"),
      platform: z.literal("chat_gpt"),
      requestedModel: z.string().regex(/^\S{1,100}$/u),
      attemptedQueries: z.literal(20),
      maxOutputTokens: z.literal(DATAFORSEO_AI_CITATION_MAX_OUTPUT_TOKENS),
      webSearch: z.literal(true),
      querySetHash: ContentHash,
      queries: z.array(AiCitationQuery).length(20),
      trackedCompetitorDomains: z.array(NormalizedDomain),
    })
    .strict(),
]);

/**
 * Immutable, secret-free command accepted by the Analysis Refresh worker.
 * Every object is strict so a producer cannot smuggle credentials or mutable
 * customer content into the durable orchestration payload.
 */
export const AnalysisRefreshRequestPayload = z
  .object({
    siteId: z.uuid(),
    icpProfile: z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        contentHash: ContentHash,
      })
      .strict(),
    outputLocale: Bcp47Locale,
    sourceConnectionIds: z
      .object({
        crawl: z.uuid(),
        gsc: z.uuid().nullable(),
        ga4: z.uuid().nullable(),
      })
      .strict(),
    dataForSeo: z
      .object({
        enabled: z.boolean(),
        maxKeywords: z.number().int().min(1).max(1_000),
        maxCompetitors: z.number().int().min(1).max(1_000),
        // Optional only so already-persisted plan.v1/v2 parents remain
        // recoverable. Every new Web producer freezes one explicit state.
        aiCitations: AiCitationPolicy.optional(),
      })
      .strict(),
    // Optional only so already-persisted plan.v1 parents remain recoverable.
    // The orchestrator requires this object when the durable parent is plan.v2.
    dataForSeoBacklinks: z
      .object({
        enabled: z.boolean(),
        maxBacklinks: z.number().int().min(1).max(1_000),
        maxReferringDomains: z.number().int().min(1).max(1_000),
        maxBacklinkPages: z.number().int().min(1).max(1_000),
        maxSourceVerifications: z
          .number()
          .int()
          .min(0)
          .max(MAX_DATAFORSEO_SOURCE_VERIFICATIONS),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AnalysisRefreshRequestPayload = z.infer<
  typeof AnalysisRefreshRequestPayload
>;

export function parseAnalysisRefreshRequestPayload(
  value: unknown,
): AnalysisRefreshRequestPayload {
  return AnalysisRefreshRequestPayload.parse(value);
}
