import { z } from "zod";
import { Bcp47Locale } from "@sf/contracts";

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
