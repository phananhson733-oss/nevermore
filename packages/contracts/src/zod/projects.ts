import { z } from "zod";
import { Bcp47Locale, MarketCode } from "./common.ts";
import { CompleteIcpProfileInput, DraftIcpProfilePatch } from "./icp.ts";

/**
 * Project + context request schemas (spec §6.1, §6.2; OpenAPI `CreateProjectRequest`,
 * `DraftContextRequest`, `CompleteContextRequest`). `.strict()` mirrors
 * `additionalProperties: false`.
 */

const unique = <T>(items: readonly T[]): boolean => new Set(items).size === items.length;

const SiteUrl = z.url().max(2048);
const RESERVED_PLACEHOLDER_TLD_SUFFIXES = [
  ".test",
  ".invalid",
  ".example",
] as const;

function isObviouslyNonPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  const ipv6 = normalized.replace(/^\[|\]$/g, "");
  const isIpv6Literal = ipv6.includes(":");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa") ||
    normalized.endsWith(".onion") ||
    RESERVED_PLACEHOLDER_TLD_SUFFIXES.some((suffix) =>
      normalized.endsWith(suffix),
    ) ||
    (!isIpv6Literal && !normalized.includes("."))
  ) {
    return true;
  }

  const ipv4 = normalized.split(".").map(Number);
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [a, b] = ipv4 as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && ipv4[2] === 0) ||
      (a === 192 && b === 0 && ipv4[2] === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && ipv4[2] === 100) ||
      (a === 203 && b === 0 && ipv4[2] === 113) ||
      a >= 224
    );
  }

  return (
    ipv6 === "::" ||
    ipv6 === "::1" ||
    /^::ffff:/i.test(ipv6) ||
    /^f[cd][0-9a-f:]*$/i.test(ipv6) ||
    /^fe[89ab][0-9a-f:]*$/i.test(ipv6) ||
    /^ff[0-9a-f:]*$/i.test(ipv6) ||
    /^2001:db8(?::|$)/i.test(ipv6)
  );
}

function isPublicProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      !isObviouslyNonPublicHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

function isSiteOriginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

/**
 * Validated historical wire shape. The route preserves a previously accepted
 * URL value until the service has checked for a completed idempotency replay.
 */
export const LegacyCreateProjectWireRequest = z
  .object({
    clientName: z.string().min(1).max(160),
    projectName: z.string().min(1).max(160),
    siteUrl: SiteUrl,
    marketCodes: z
      .array(MarketCode)
      .min(1)
      .max(20)
      .refine(unique, "marketCodes must be unique"),
    siteLanguageCodes: z
      .array(Bcp47Locale)
      .min(1)
      .max(20)
      .refine(unique, "siteLanguageCodes must be unique"),
    defaultDeliveryLocale: Bcp47Locale,
  })
  .strict();
export type LegacyCreateProjectWireRequest = z.infer<
  typeof LegacyCreateProjectWireRequest
>;

export const ProductProfileBusinessHint = z.string().trim().min(1).max(1000);
export type ProductProfileBusinessHint = z.infer<
  typeof ProductProfileBusinessHint
>;

export const ProductProfileProductUrl = z
  .url()
  .max(2048)
  .refine(isPublicProductUrl, {
    message:
      "productUrl must be a public http(s) URL without credentials or a fragment",
  });
export type ProductProfileProductUrl = z.infer<typeof ProductProfileProductUrl>;

export const ProductProfileCreateProjectRequest = z
  .object({
    mode: z.literal("product_profile"),
    productUrl: ProductProfileProductUrl,
    businessHint: ProductProfileBusinessHint.optional(),
  })
  .strict();
export type ProductProfileCreateProjectRequest = z.infer<
  typeof ProductProfileCreateProjectRequest
>;

export const CreateProjectWireRequest = z.union([
  LegacyCreateProjectWireRequest,
  ProductProfileCreateProjectRequest,
]);
export type CreateProjectWireRequest = z.infer<
  typeof CreateProjectWireRequest
>;

/** New project commands must preserve the submitted target as an HTTP(S) origin. */
export const LegacyCreateProjectRequest = LegacyCreateProjectWireRequest.superRefine(
  (value, ctx) => {
    if (!isSiteOriginUrl(value.siteUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["siteUrl"],
        message: "siteUrl must be an origin-only http(s) URL",
      });
    }
  },
);
export type LegacyCreateProjectRequest = z.infer<
  typeof LegacyCreateProjectRequest
>;

export const CreateProjectRequest = z.union([
  LegacyCreateProjectRequest,
  ProductProfileCreateProjectRequest,
]);
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

/** Optimistic-concurrency draft save; `baseVersion` is carried in the body (spec §5.3). */
export const DraftContextRequest = z
  .object({
    mode: z.literal("draft"),
    baseVersion: z.number().int().min(0),
    profile: DraftIcpProfilePatch,
  })
  .strict();
export type DraftContextRequest = z.infer<typeof DraftContextRequest>;

/** Complete save; the full profile must pass qualification (spec §6.2). */
export const CompleteContextRequest = z
  .object({
    mode: z.literal("complete"),
    baseVersion: z.number().int().min(0),
    profile: CompleteIcpProfileInput,
  })
  .strict();
export type CompleteContextRequest = z.infer<typeof CompleteContextRequest>;

/** `PATCH /projects/{id}/context` body: discriminated on `mode` (spec §6.2). */
export const UpdateContextRequest = z.discriminatedUnion("mode", [
  DraftContextRequest,
  CompleteContextRequest,
]);
export type UpdateContextRequest = z.infer<typeof UpdateContextRequest>;
