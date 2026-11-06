// @input  -- zod
// @output -- claim channels, account platforms and statuses, upload limits, and the parsers admin and promoter requests go through
// @pos    -- the task center's request contract; the SQL checks in db/tasks repeat these limits
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { z } from "zod";

export const PROMO_CHANNELS = [
  "tiktok",
  "facebook",
  "instagram",
  "youtube",
] as const;
export type PromoChannel = (typeof PROMO_CHANNELS)[number];

/**
 * A claim's channel. New claims are always "all": one link per drama, posted
 * anywhere. The four named channels are codes handed out before that and
 * still redirect.
 */
export const CLAIM_CHANNELS = [...PROMO_CHANNELS, "all"] as const;
export type ClaimChannel = (typeof CLAIM_CHANNELS)[number];

/** Where a promoter can ask the operators to whitelist an account. */
export const ACCOUNT_PLATFORMS = ["tiktok", "facebook"] as const;
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number];

export const ACCOUNT_STATUSES = ["submitted", "whitelisted", "rejected"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** How many accounts one person may have on file; plenty for real use, a cap on junk. */
export const MAX_ACCOUNTS_PER_USER = 20;

export const DRAMA_STATUSES = ["draft", "published", "archived"] as const;
export type DramaStatus = (typeof DRAMA_STATUSES)[number];

export const VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type UploadContentType = (typeof VIDEO_TYPES)[number] | (typeof IMAGE_TYPES)[number];

/** The extension an object key gets; keys never carry the uploader's file name. */
export const CONTENT_TYPE_EXTENSIONS: Readonly<Record<UploadContentType, string>> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Under R2's single-PUT ceiling of about 5 GiB, with room to spare. */
export const MAX_VIDEO_BYTES = 4 * 1024 ** 3;
export const MAX_IMAGE_BYTES = 20 * 1024 ** 2;

export const PAGE_SIZE = 24;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

const optionalCount = (max: number) =>
  z
    .number()
    .int()
    .min(1)
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value ?? null);

export const dramaInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    titleCn: optionalText(200),
    platform: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    language: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/),
    episodes: optionalCount(2000),
    payStart: optionalCount(2000),
    synopsis: optionalText(4000),
    promoTargetUrl: optionalText(2048).refine(
      (value) => value === null || isHttpsUrl(value),
      { message: "https_required" },
    ),
    promoCodeParam: optionalText(32).refine(
      (value) => value === null || /^[A-Za-z0-9_]{1,32}$/.test(value),
      { message: "invalid_param" },
    ),
  })
  .strict()
  .refine(
    (value) =>
      value.payStart === null ||
      value.episodes === null ||
      value.payStart <= value.episodes,
    { message: "pay_start_after_last_episode", path: ["payStart"] },
  );
export type DramaInput = z.infer<typeof dramaInputSchema>;

export const dramaStatusInputSchema = z
  .object({ status: z.enum(DRAMA_STATUSES) })
  .strict();

export const uploadRequestSchema = z
  .object({
    purpose: z.enum(["cover", "asset"]),
    title: optionalText(200),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.enum([...VIDEO_TYPES, ...IMAGE_TYPES]),
    byteSize: z.number().int().min(1),
  })
  .strict()
  .refine(
    (value) =>
      value.purpose === "asset" ||
      (IMAGE_TYPES as readonly string[]).includes(value.contentType),
    { message: "cover_must_be_image", path: ["contentType"] },
  )
  .refine(
    (value) =>
      value.byteSize <=
      (isVideoType(value.contentType) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES),
    { message: "too_large", path: ["byteSize"] },
  );
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const uploadCompleteSchema = z.union([
  z.object({ purpose: z.literal("asset"), assetId: z.string().uuid() }).strict(),
  z
    .object({ purpose: z.literal("cover"), objectKey: z.string().min(1).max(512) })
    .strict(),
]);

/**
 * A claim needs no input: the drama is in the path and the channel is always
 * "all". A named channel is still accepted, and ignored, so a page opened
 * before the one-link change can still claim while a deploy rolls out.
 */
export const claimInputSchema = z
  .object({ channel: z.enum(PROMO_CHANNELS).optional() })
  .strict();

export const accountInputSchema = z
  .object({
    platform: z.enum(ACCOUNT_PLATFORMS),
    // A handle like @name or a profile URL; whichever the promoter has.
    handle: z.string().trim().min(1).max(200),
  })
  .strict();
export type AccountInput = z.infer<typeof accountInputSchema>;

export const accountReviewSchema = z
  .object({ status: z.enum(["whitelisted", "rejected"]) })
  .strict();

export function isVideoType(contentType: string): boolean {
  return contentType.startsWith("video/");
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "" && !/\s/.test(value);
  } catch {
    return false;
  }
}

/** Codes are 8 characters of this alphabet: lowercase, no 0/o/1/l/i. */
export const PROMO_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const PROMO_CODE_PATTERN = /^[a-hjkmnp-z2-9]{8}$/;

export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return PROMO_CODE_PATTERN.test(code) ? code : null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
