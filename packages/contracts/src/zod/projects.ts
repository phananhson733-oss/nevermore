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
export const CreateProjectWireRequest = z
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
export type CreateProjectWireRequest = z.infer<
  typeof CreateProjectWireRequest
>;

/** New project commands must preserve the submitted target as an HTTP(S) origin. */
export const CreateProjectRequest = CreateProjectWireRequest.superRefine(
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
