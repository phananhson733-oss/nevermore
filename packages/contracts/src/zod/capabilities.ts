import { z } from "zod";
import { Bcp47Locale, Uuid } from "./common.ts";

export const GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION =
  "growth-audit.0.3.0" as const;

const uniqueTargetRefs = (item: z.ZodType<string>) =>
  z
    .array(item)
    .min(1)
    .max(1000)
    .refine((refs) => new Set(refs).size === refs.length, {
      message: "targetRefs must be unique",
    });

const SiteGrowthAuditScope = z
  .object({
    kind: z.literal("site"),
    targetRefs: z.undefined().optional(),
  })
  .strict();

const TemplateGrowthAuditScope = z
  .object({
    kind: z.literal("template"),
    targetRefs: uniqueTargetRefs(z.string().trim().min(1).max(500)),
  })
  .strict();

const UrlGrowthAuditScope = z
  .object({
    kind: z.literal("url"),
    targetRefs: uniqueTargetRefs(z.string().trim().url().max(2048)),
  })
  .strict();

export const GrowthAuditScope = z.discriminatedUnion("kind", [
  SiteGrowthAuditScope,
  TemplateGrowthAuditScope,
  UrlGrowthAuditScope,
]);
export type GrowthAuditScope = z.infer<typeof GrowthAuditScope>;

/**
 * Immutable input for the Growth Audit capability. Confirmation is deliberately
 * absent: an Opportunity reuses the canonical Finding Review transaction.
 */
export const CreateGrowthAuditRunRequest = z
  .object({
    siteId: Uuid,
    icpProfileId: Uuid,
    scope: GrowthAuditScope,
    outputLocale: Bcp47Locale,
    capabilityContractVersion: z.literal(
      GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
    ),
  })
  .strict();
export type CreateGrowthAuditRunRequest = z.infer<
  typeof CreateGrowthAuditRunRequest
>;
