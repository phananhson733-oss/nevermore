import { z } from "zod";
import { Bcp47Locale, MarketCode } from "./common.ts";

/**
 * ICP profile request schemas (spec §6.2, OpenAPI `CompleteIcpProfileInput` /
 * `DraftIcpProfilePatch`). These validate the request body only; the persisted
 * profile snapshot is an opaque object (`IcpProfile.profile`). All object schemas
 * are `.strict()` to mirror `additionalProperties: false`.
 */

// Enumerations shared by draft + complete.
export const CustomerModel = z.enum(["b2b", "b2c", "hybrid"]);
export type CustomerModel = z.infer<typeof CustomerModel>;

export const BusinessProfile = z.enum([
  "b2b_saas",
  "b2b_services",
  "b2c_ecommerce",
  "b2c_subscription",
  "marketplace",
  "publisher",
  "other",
]);
export type BusinessProfile = z.infer<typeof BusinessProfile>;

export const ConversionType = z.enum([
  "demo",
  "signup",
  "trial",
  "purchase",
  "lead",
  "contact",
  "subscribe",
  "offline",
  "other",
]);
export type ConversionType = z.infer<typeof ConversionType>;

/** Reject arrays with duplicate string members (OpenAPI `uniqueItems: true`). */
const unique = <T>(items: readonly T[]): boolean => new Set(items).size === items.length;

const shortText = z.string().min(1).max(500);
const longText = z.string().min(1).max(1000);
const uri = z.url().max(2048);

export const Persona = z
  .object({
    name: z.string().min(1).max(120),
    roleOrContext: z.string().min(1).max(500),
    jobs: z.array(shortText).min(1),
    painPoints: z.array(shortText).min(1),
  })
  .strict();
export type Persona = z.infer<typeof Persona>;

export const PrimaryConversion = z
  .object({
    label: z.string().min(1).max(160),
    type: ConversionType,
    targetUrl: uri.nullable(),
  })
  .strict();
export type PrimaryConversion = z.infer<typeof PrimaryConversion>;

/**
 * Complete-mode ICP input. Every field is required; `businessProfileNote` becomes
 * a required 3–500 char explanation when `businessProfile === "other"` (spec §6.2,
 * OpenAPI if/then). Qualification failures surface as pointer-level 422 (AC-008).
 */
export const CompleteIcpProfileInput = z
  .object({
    productName: z.string().min(1).max(160),
    oneLineDescription: z.string().min(1).max(1000),
    customerModel: CustomerModel,
    businessProfile: BusinessProfile,
    businessProfileNote: z.string().max(500).nullable(),
    marketCodes: z.array(MarketCode).min(1).refine(unique, "marketCodes must be unique"),
    siteLanguageCodes: z
      .array(Bcp47Locale)
      .min(1)
      .refine(unique, "siteLanguageCodes must be unique"),
    defaultDeliveryLocale: Bcp47Locale,
    segments: z.array(shortText).min(1),
    personas: z.array(Persona).min(1),
    useCases: z.array(shortText).min(1),
    offers: z.array(shortText).min(1),
    differentiators: z.array(shortText).min(1),
    primaryConversion: PrimaryConversion,
    priorityProductsOrServices: z.array(shortText).min(1),
    priorityUrls: z.array(uri),
    competitors: z.array(shortText),
    brandConstraints: z.array(longText),
    complianceConstraints: z.array(longText),
    technicalConstraints: z.array(longText),
    resourceConstraints: z.array(longText),
    growthQuestions: z.array(longText).min(1),
    ninetyDayGoals: z.array(longText).min(1),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.businessProfile === "other") {
      const note = data.businessProfileNote;
      if (note === null || note.trim().length < 3) {
        ctx.addIssue({
          code: "custom",
          path: ["businessProfileNote"],
          message: "businessProfileNote is required (min 3 chars) when businessProfile is 'other'",
        });
      }
    }
  });
export type CompleteIcpProfileInput = z.infer<typeof CompleteIcpProfileInput>;

/**
 * Draft-mode partial patch. Every field is optional and nullable; a present
 * `null` clears the field, an absent key inherits the current value (spec §6.2).
 * At least one property must be present (`minProperties: 1`). Draft array items
 * carry no per-item length bounds (unlike complete mode).
 */
export const DraftIcpProfilePatch = z
  .object({
    productName: z.string().max(160).nullable(),
    oneLineDescription: z.string().max(1000).nullable(),
    customerModel: CustomerModel.nullable(),
    businessProfile: BusinessProfile.nullable(),
    businessProfileNote: z.string().max(500).nullable(),
    marketCodes: z.array(MarketCode).nullable(),
    siteLanguageCodes: z.array(Bcp47Locale).nullable(),
    defaultDeliveryLocale: Bcp47Locale.nullable(),
    segments: z.array(z.string()).nullable(),
    personas: z.array(Persona).nullable(),
    useCases: z.array(z.string()).nullable(),
    offers: z.array(z.string()).nullable(),
    differentiators: z.array(z.string()).nullable(),
    primaryConversion: PrimaryConversion.nullable(),
    priorityProductsOrServices: z.array(z.string()).nullable(),
    priorityUrls: z.array(uri).nullable(),
    competitors: z.array(z.string()).nullable(),
    brandConstraints: z.array(z.string()).nullable(),
    complianceConstraints: z.array(z.string()).nullable(),
    technicalConstraints: z.array(z.string()).nullable(),
    resourceConstraints: z.array(z.string()).nullable(),
    growthQuestions: z.array(z.string()).nullable(),
    ninetyDayGoals: z.array(z.string()).nullable(),
  })
  .strict()
  .partial()
  .refine((obj) => Object.keys(obj).length >= 1, "At least one field must be provided");
export type DraftIcpProfilePatch = z.infer<typeof DraftIcpProfilePatch>;
