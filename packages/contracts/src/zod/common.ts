import { z } from "zod";

// Shared API primitives. JSON is camelCase across the contract.
// Each primitive exports both a runtime schema (PascalCase value) and the
// inferred TypeScript type under the same name.

// Strict RFC3339 UTC instant: date-time with a mandatory Zulu ("Z") designator
// and no numeric offset, matching z.iso.datetime({ offset: false }) semantics.
const ISO_UTC_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * SignalFrame's documented protocol ceiling for one RFC 5646 language tag.
 * RFC 5646 has no intrinsic total-length limit, but explicitly permits a
 * protocol to publish one. 255 ASCII characters is broad enough for long
 * extension/private-use sequences while bounding request, log, and index work.
 */
export const MAX_BCP47_LOCALE_LENGTH = 255;

const BCP47_SCHEMA_LANGUAGE =
  "(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4}|[A-Za-z]{5,8})";
const BCP47_SCHEMA_SCRIPT = "(?:-[A-Za-z]{4})?";
const BCP47_SCHEMA_REGION = "(?:-(?:[A-Za-z]{2}|[0-9]{3}))?";
const BCP47_SCHEMA_VARIANT =
  "(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3})";
const BCP47_SCHEMA_SINGLETON = "[0-9A-WY-Za-wy-z]";
const BCP47_SCHEMA_EXTENSION_SUBTAG = "[A-Za-z0-9]{2,8}";
const BCP47_SCHEMA_PREFIX =
  `${BCP47_SCHEMA_LANGUAGE}${BCP47_SCHEMA_SCRIPT}${BCP47_SCHEMA_REGION}`;
const BCP47_SCHEMA_VARIANTS = `(?:-${BCP47_SCHEMA_VARIANT})*`;
const BCP47_SCHEMA_EXTENSION =
  `-${BCP47_SCHEMA_SINGLETON}(?:-${BCP47_SCHEMA_EXTENSION_SUBTAG})+`;
const BCP47_SCHEMA_EXTENSIONS = `(?:${BCP47_SCHEMA_EXTENSION})*`;
const BCP47_SCHEMA_PRIVATE_USE = "[Xx](?:-[A-Za-z0-9]{1,8})+";
const BCP47_SCHEMA_IRREGULAR_GRANDFATHERED = [
  "[Ee][Nn]-[Gg][Bb]-[Oo][Ee][Dd]",
  "[Ii]-(?:[Aa][Mm][Ii]|[Bb][Nn][Nn]|[Dd][Ee][Ff][Aa][Uu][Ll][Tt]|[Ee][Nn][Oo][Cc][Hh][Ii][Aa][Nn]|[Hh][Aa][Kk]|[Kk][Ll][Ii][Nn][Gg][Oo][Nn]|[Ll][Uu][Xx]|[Mm][Ii][Nn][Gg][Oo]|[Nn][Aa][Vv][Aa][Jj][Oo]|[Pp][Ww][Nn]|[Tt][Aa][Oo]|[Tt][Aa][Yy]|[Tt][Ss][Uu])",
  "[Ss][Gg][Nn]-(?:[Bb][Ee]-(?:[Ff][Rr]|[Nn][Ll])|[Cc][Hh]-[Dd][Ee])",
].join("|");

/**
 * Portable ECMA-262 pattern used by OpenAPI and JSON Schema consumers. It
 * expresses the RFC 5646 ABNF, private use, irregular grandfathered tags, and
 * same-case duplicate variant/singleton rejection. Portable JSON Schema has no
 * case-insensitive backreference facility, so the runtime parser and database
 * remain authoritative for mixed-case duplicate rejection.
 */
export const BCP47_PORTABLE_SCHEMA_PATTERN = [
  "^",
  `(?!${BCP47_SCHEMA_PREFIX}${BCP47_SCHEMA_VARIANTS}-(${BCP47_SCHEMA_VARIANT})${BCP47_SCHEMA_VARIANTS}-\\1(?:-|$))`,
  `(?!${BCP47_SCHEMA_PREFIX}${BCP47_SCHEMA_VARIANTS}${BCP47_SCHEMA_EXTENSIONS}-(${BCP47_SCHEMA_SINGLETON})(?:-${BCP47_SCHEMA_EXTENSION_SUBTAG})+${BCP47_SCHEMA_EXTENSIONS}-\\2(?:-|$))`,
  "(?:",
  `${BCP47_SCHEMA_PREFIX}${BCP47_SCHEMA_VARIANTS}${BCP47_SCHEMA_EXTENSIONS}(?:-${BCP47_SCHEMA_PRIVATE_USE})?`,
  `|${BCP47_SCHEMA_PRIVATE_USE}`,
  `|${BCP47_SCHEMA_IRREGULAR_GRANDFATHERED}`,
  ")$",
].join("");

const ALPHA = /^[A-Za-z]+$/;
const ALPHANUMERIC = /^[A-Za-z0-9]+$/;
const REGION = /^(?:[A-Za-z]{2}|[0-9]{3})$/;
const VARIANT = /^(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3})$/;
const EXTENSION_SINGLETON = /^[0-9A-WY-Za-wy-z]$/;

// RFC 5646 section 2.1 fixes this list permanently. Most entries are
// deprecated, but they remain well-formed for backwards compatibility.
const GRANDFATHERED_LANGUAGE_TAGS = new Set([
  "art-lojban",
  "cel-gaulish",
  "en-gb-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "no-bok",
  "no-nyn",
  "sgn-be-fr",
  "sgn-be-nl",
  "sgn-ch-de",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang",
]);

function hasLength(value: string, minimum: number, maximum: number): boolean {
  return value.length >= minimum && value.length <= maximum;
}

function isPrivateUseSubtag(value: string): boolean {
  return hasLength(value, 1, 8) && ALPHANUMERIC.test(value);
}

/**
 * Validate the complete RFC 5646 structural grammar without a live IANA
 * registry dependency. This includes extlangs, script/region/variant order,
 * extensions, private-use-only tags, and the permanent grandfathered list.
 * Duplicate variants and extension singletons are rejected as required by
 * RFC 5646 sections 2.2.5 and 2.2.6.
 */
export function isBcp47LanguageTag(value: string): boolean {
  if (
    !hasLength(value, 2, MAX_BCP47_LOCALE_LENGTH) ||
    !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)
  ) {
    return false;
  }

  const lower = value.toLowerCase();
  if (GRANDFATHERED_LANGUAGE_TAGS.has(lower)) return true;

  const parts = value.split("-");
  if (parts[0]?.toLowerCase() === "x") {
    return parts.length > 1 && parts.slice(1).every(isPrivateUseSubtag);
  }

  const primary = parts[0]!;
  if (!hasLength(primary, 2, 8) || !ALPHA.test(primary)) return false;

  let cursor = 1;
  if (primary.length <= 3) {
    let extlangCount = 0;
    while (
      cursor < parts.length &&
      extlangCount < 3 &&
      parts[cursor]!.length === 3 &&
      ALPHA.test(parts[cursor]!)
    ) {
      cursor += 1;
      extlangCount += 1;
    }
  }

  if (
    cursor < parts.length &&
    parts[cursor]!.length === 4 &&
    ALPHA.test(parts[cursor]!)
  ) {
    cursor += 1;
  }

  if (cursor < parts.length && REGION.test(parts[cursor]!)) cursor += 1;

  const variants = new Set<string>();
  while (cursor < parts.length && VARIANT.test(parts[cursor]!)) {
    const variant = parts[cursor]!.toLowerCase();
    if (variants.has(variant)) return false;
    variants.add(variant);
    cursor += 1;
  }

  const extensionSingletons = new Set<string>();
  while (
    cursor < parts.length &&
    EXTENSION_SINGLETON.test(parts[cursor]!)
  ) {
    const singleton = parts[cursor]!.toLowerCase();
    if (extensionSingletons.has(singleton)) return false;
    extensionSingletons.add(singleton);
    cursor += 1;

    const firstExtensionSubtag = cursor;
    while (
      cursor < parts.length &&
      hasLength(parts[cursor]!, 2, 8) &&
      ALPHANUMERIC.test(parts[cursor]!)
    ) {
      cursor += 1;
    }
    if (cursor === firstExtensionSubtag) return false;
  }

  if (cursor < parts.length && parts[cursor]!.toLowerCase() === "x") {
    cursor += 1;
    const firstPrivateUseSubtag = cursor;
    while (
      cursor < parts.length &&
      isPrivateUseSubtag(parts[cursor]!)
    ) {
      cursor += 1;
    }
    if (cursor === firstPrivateUseSubtag) return false;
  }

  return cursor === parts.length;
}

// ISO 3166-1 alpha-2 market code.
const MARKET_CODE_PATTERN = /^[A-Z]{2}$/;

// Opaque base64url-encoded pagination cursor.
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

// Printable ASCII (space through tilde, 0x20-0x7E).
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/;

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

export const IsoDateTime = z
  .string()
  .regex(ISO_UTC_DATE_TIME_PATTERN, "Must be a strict RFC3339 UTC date-time (Z)");
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const Bcp47Locale = z
  .string()
  .min(2)
  .max(MAX_BCP47_LOCALE_LENGTH)
  .refine(isBcp47LanguageTag, "Must be a valid BCP-47 language tag");
export type Bcp47Locale = z.infer<typeof Bcp47Locale>;

export const MarketCode = z
  .string()
  .regex(MARKET_CODE_PATTERN, "Must be an ISO 3166-1 alpha-2 market code");
export type MarketCode = z.infer<typeof MarketCode>;

export const Cursor = z
  .string()
  .min(1)
  .max(1024)
  .regex(BASE64URL_PATTERN, "Must be a base64url string");
export type Cursor = z.infer<typeof Cursor>;

export const IdempotencyKey = z
  .string()
  .min(1)
  .max(128)
  .regex(PRINTABLE_ASCII_PATTERN, "Must be 1-128 printable ASCII characters");
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

export const RequestId = z.string().min(8).max(128);
export type RequestId = z.infer<typeof RequestId>;
