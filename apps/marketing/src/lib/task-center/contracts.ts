// @input  -- zod
// @output -- claim channels, account platforms and statuses, drama audiences, clip types, suggested genres, the 选剧台 lookup's platforms and languages (and which platforms 查剧 also reads from their own site), upload limits, and the parsers admin and promoter requests go through
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

/** Who a drama is written for, as platforms sort them (女频 / 男频). */
export const DRAMA_AUDIENCES = ["female", "male"] as const;
export type DramaAudience = (typeof DRAMA_AUDIENCES)[number];

/** What kind of cut a clip is. 0003 repeats this list in a check. */
export const CLIP_TYPES = ["recap", "mixcut", "highlight", "trailer", "episode"] as const;
export type ClipType = (typeof CLIP_TYPES)[number];

/** A genre is a free slug like the platform: lowercase, digits and dashes. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Words that name an audience, not a genre; typed into 题材 they belong in 频道. */
export const AUDIENCE_WORDS: ReadonlySet<string> = new Set(["male", "female", "man", "woman", "men", "women"]);

/** Genres the admin form suggests; any other slug is still accepted. */
export const SUGGESTED_GENRES = [
  "romance", "revenge", "billionaire", "werewolf", "ceo", "mafia", "fantasy", "urban",
  "apocalypse", "system", "comeback", "family", "thriller", "historical", "comedy",
] as const;

/** The platform keys the 选剧台 lookup knows (its BEIDOU_APPS, minus the alias kalos). */
export const LOOKUP_PLATFORMS = [
  "reelshort", "dramabox", "shortmax", "moboreels", "flickreels", "kalostv",
  "netshort", "goodshort", "flareflow", "stardusttv", "yourchannel",
] as const;
export type LookupPlatform = (typeof LOOKUP_PLATFORMS)[number];

/** The lookup platforms 查剧 also reads from their own site (theater-details.ts); the others keep 北斗's details (DramaBox: its site refuses the server). */
export const THEATER_PLATFORMS: ReadonlySet<string> = new Set<LookupPlatform>([
  "reelshort", "stardusttv", "moboreels", "netshort", "yourchannel",
]);

/** 北斗's languages, as the lookup names them. */
export const LOOKUP_LANGUAGES = [
  "en", "es", "pt", "fr", "de", "it", "ru", "tr", "ar", "id", "th", "vi", "ja", "ko", "zh-TW", "ro", "pl", "cs",
] as const;

/** 0004 caps a drama's tags at 20. */
export const MAX_TAGS = 20;

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
    platform: z.string().trim().toLowerCase().regex(SLUG_PATTERN),
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
    // Optional so a form opened before these existed still saves.
    audience: z
      .enum(DRAMA_AUDIENCES)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    genre: optionalText(32)
      .transform((value) => value?.toLowerCase() ?? null)
      .refine((value) => value === null || SLUG_PATTERN.test(value), { message: "invalid_genre" })
      .refine((value) => value === null || !AUDIENCE_WORDS.has(value), { message: "genre_is_audience" }),
    // Left out, an edit keeps the tags the drama has (an import's, say).
    tags: z.array(z.string().trim().min(1).max(40)).max(MAX_TAGS).optional(),
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

/** 查剧: what the operator types on /admin/tasks. */
export const dramaLookupSchema = z
  .object({
    platform: z.enum(LOOKUP_PLATFORMS),
    title: z.string().trim().min(1).max(200).transform((value) => value.replace(/\s+/g, " ")),
    language: z
      .enum(LOOKUP_LANGUAGES)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
  })
  .strict();
export type DramaLookup = z.infer<typeof dramaLookupSchema>;

/** 用这部: the same query plus which of its results to list. */
export const dramaImportSchema = z
  .object({
    platform: z.enum(LOOKUP_PLATFORMS),
    title: z.string().trim().min(1).max(200).transform((value) => value.replace(/\s+/g, " ")),
    language: z
      .enum(LOOKUP_LANGUAGES)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    platformDramaId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  })
  .strict();
export type DramaImport = z.infer<typeof dramaImportSchema>;

export const dramaStatusInputSchema = z
  .object({ status: z.enum(DRAMA_STATUSES) })
  .strict();

export const uploadRequestSchema = z
  .object({
    purpose: z.enum(["cover", "asset"]),
    title: optionalText(200),
    clipType: z
      .enum(CLIP_TYPES)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
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
  z
    .object({
      purpose: z.literal("asset"),
      assetId: z.string().uuid(),
      // Set when the browser managed to cut and upload a still; optional so a
      // page opened before posters existed still completes its upload.
      posterKey: z.string().min(1).max(512).optional(),
    })
    .strict(),
  z
    .object({ purpose: z.literal("cover"), objectKey: z.string().min(1).max(512) })
    .strict(),
]);

/** An admin retagging or renaming a clip: either field or both; a null type clears it. */
export const assetUpdateSchema = z
  .object({
    clipType: z.enum(CLIP_TYPES).nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => value.clipType !== undefined || value.title !== undefined, { message: "nothing_to_change" });
export type AssetUpdate = z.infer<typeof assetUpdateSchema>;

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
