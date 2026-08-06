import { z } from "zod";
import { Bcp47Locale } from "@sf/contracts";
import { MAX_DATAFORSEO_SOURCE_VERIFICATIONS } from "@sf/sources";

const ContentHash = z.string().regex(/^[a-f0-9]{64}$/u);

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
